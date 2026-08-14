import { hashPayload } from '@zerotrace/evidence';
import bs58 from 'bs58';
import {
  buildClusterPosition,
  ClusterPositionConservationError,
} from '@zerotrace/cluster-position-engine';
import { detectBehaviorEvent } from '@zerotrace/behavior-engine';
import {
  buildControlCampaign,
  buildControlClusterVersion,
  controlCampaignIdFor,
  createForensicCampaignAlert,
} from './index.js';
import {
  buildControlCampaignBundle,
  buildForensicEvidenceLine,
  createCampaignEvidenceItem,
  createDerivedCampaignEvidence,
} from '@zerotrace/forensic-evidence';
import {
  SolanaDealerAssetObservationSchema,
  SolanaDealerCampaignReportSchema,
  SolanaDealerFundingEdgeSchema,
  SolanaDealerSettlementEdgeSchema,
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type ControlCampaignBundle,
  type Evidence,
  type SolanaAssetFlow,
  type SolanaDealerAssetObservation,
  type SolanaDealerCampaignReport,
  type SolanaDealerFundingEdge,
  type SolanaDealerHolder,
  type SolanaDealerSettlementEdge,
  type SolanaTransactionIntelligenceReport,
  type TokenFlowEdge,
} from '@zerotrace/schemas';
import { createTokenFlowEdge } from '@zerotrace/token-flow-engine';

export const SOLANA_DEALER_CAMPAIGN_MODEL_VERSION = 'solana-dealer-campaign-v1.0.0' as const;
export const SOLANA_DEALER_CAMPAIGN_POLICY_VERSION = 'solana-dealer-policy-v1.0.0' as const;

export interface SolanaDealerTransactionInput {
  report: SolanaTransactionIntelligenceReport;
  transactionIndex: string;
}

export interface SolanaDealerBuildInput {
  mint: string;
  fromSlot: string;
  toSlot: string;
  snapshot: AnalysisSnapshot;
  transactions: readonly SolanaDealerTransactionInput[];
  rangeEvidence: readonly Evidence[];
  sourceSet: readonly string[];
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  maxMembers?: number;
  allowComplete?: boolean;
}

export interface SolanaDealerBuildResult {
  report: SolanaDealerCampaignReport;
  derivedEvidence: readonly Evidence[];
  derivedEvidenceSources: Readonly<Record<string, readonly string[]>>;
  tokenFlowEdges: readonly TokenFlowEdge[];
}

export type SolanaDealerReconstructionErrorCode =
  | 'SOLANA_DEALER_INVALID_INPUT'
  | 'SOLANA_DEALER_NO_EVIDENCE'
  | 'SOLANA_DEALER_NO_TOKEN_ACTIVITY'
  | 'SOLANA_DEALER_POSITION_UNAVAILABLE';

export class SolanaDealerReconstructionError extends Error {
  readonly code: SolanaDealerReconstructionErrorCode;

  constructor(code: SolanaDealerReconstructionErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SolanaDealerReconstructionError';
    this.code = code;
  }
}

const MINT_SOURCE_PREFIX = 'solana:mint:';

function unsigned(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new SolanaDealerReconstructionError(
      'SOLANA_DEALER_INVALID_INPUT',
      `${field} must be an unsigned decimal string.`,
    );
  }
  return BigInt(value);
}

function canonicalPublicKey(value: string, field: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new SolanaDealerReconstructionError(
      'SOLANA_DEALER_INVALID_INPUT',
      `${field} must be a Solana public key.`,
    );
  }
  return value;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

const ED25519_P = (1n << 255n) - 19n;
const ED25519_D = (-121665n * modInverse(121666n, ED25519_P)) % ED25519_P;

function mod(value: bigint): bigint {
  const result = value % ED25519_P;
  return result < 0n ? result + ED25519_P : result;
}

function modPow(base: bigint, exponent: bigint): bigint {
  let value = mod(base);
  let power = exponent;
  let result = 1n;
  while (power > 0n) {
    if (power & 1n) result = mod(result * value);
    value = mod(value * value);
    power >>= 1n;
  }
  return result;
}

function modInverse(value: bigint, prime: bigint): bigint {
  return modPow(value, prime - 2n);
}

function littleEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) + BigInt(bytes[index]!);
  }
  return value;
}

/** Solana PDAs are the canonical off-curve Ed25519 public-key encodings. */
export function isLikelySolanaPda(value: string): boolean {
  try {
    const bytes = Uint8Array.from(bs58.decode(value));
    if (bytes.length !== 32) return false;
    const y = littleEndian(bytes) & ((1n << 255n) - 1n);
    if (y >= ED25519_P) return false;
    const ySquared = mod(y * y);
    const xSquared = mod((ySquared - 1n) * modInverse(ED25519_D * ySquared + 1n, ED25519_P));
    let x = modPow(xSquared, (ED25519_P + 3n) / 8n);
    if (mod(x * x - xSquared) !== 0n) {
      x = mod(x * modPow(2n, (ED25519_P - 1n) / 4n));
    }
    return mod(x * x - xSquared) !== 0n;
  } catch {
    return false;
  }
}

function snapshotPosition(snapshot: AnalysisSnapshot): string {
  if (snapshot.ledger !== 'SOLANA') throw new TypeError('Solana dealer Snapshot must be Solana.');
  return snapshot.slot;
}

function flowEvidenceId(
  report: SolanaTransactionIntelligenceReport,
  flow: SolanaAssetFlow,
): string {
  const evidence = report.evidence.find((item) =>
    item.locator.includes(`asset-flow:${report.signature}:${flow.id}@`),
  );
  return evidence?.id ?? report.terminalEvidenceId;
}

function knownString(value: { state: string; value?: string | undefined }): string | undefined {
  return value.state === 'known' && typeof value.value === 'string' ? value.value : undefined;
}

function knownQuantity(value: { state: string; value?: string | undefined }): string | undefined {
  return value.state === 'known' && typeof value.value === 'string' ? value.value : undefined;
}

function flowWallets(flow: SolanaAssetFlow): { source?: string; destination?: string } {
  const source = knownString(flow.sourceOwner);
  const destination = knownString(flow.destinationOwner);
  return {
    ...(source === undefined ? {} : { source }),
    ...(destination === undefined ? {} : { destination }),
  };
}

function tokenFlowKind(flow: SolanaAssetFlow): 'TRANSFER' | 'MINT' | 'BURN' {
  return flow.flowKind === 'MINT' ? 'MINT' : flow.flowKind === 'BURN' ? 'BURN' : 'TRANSFER';
}

function syntheticMintSource(mint: string): string {
  return `${MINT_SOURCE_PREFIX}${mint}`;
}

interface SolanaTokenFlowObservation {
  edge: TokenFlowEdge;
  sourceAccount?: string;
  destinationAccount?: string;
}

function createTokenEdge(input: {
  report: SolanaTransactionIntelligenceReport;
  transactionIndex: string;
  flow: SolanaAssetFlow;
  flowIndex: number;
  mint: string;
}): SolanaTokenFlowObservation | undefined {
  const semantics = input.report.facts.transactionSemantics;
  if (semantics.state !== 'known') return undefined;
  const amountRaw = knownQuantity(input.flow.amount);
  if (amountRaw === undefined) return undefined;
  const mint = knownString(input.flow.mint);
  if (mint !== input.mint) return undefined;
  const wallets = flowWallets(input.flow);
  const kind = tokenFlowKind(input.flow);
  const sourceAccount = knownString(input.flow.sourceAccount);
  const destinationAccount = knownString(input.flow.destinationAccount);
  if (kind !== 'MINT' && sourceAccount === undefined) return undefined;
  if (kind !== 'BURN' && destinationAccount === undefined) return undefined;
  const from = kind === 'MINT' ? syntheticMintSource(input.mint) : wallets.source;
  const to = kind === 'BURN' ? syntheticMintSource(input.mint) : wallets.destination;
  if (from === undefined || to === undefined || from === to) return undefined;
  const snapshot = input.report.metadata.snapshot;
  if (snapshot?.ledger !== 'SOLANA') return undefined;
  const execution =
    input.flow.application === 'APPLIED'
      ? 'SUCCESS'
      : input.flow.application === 'NOT_APPLIED'
        ? 'FAILED'
        : 'UNKNOWN';
  const edge = createTokenFlowEdge({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    token: input.mint,
    blockNumber: snapshot.slot,
    blockHash: snapshot.blockhash,
    transactionHash: input.report.signature,
    transactionIndex: input.transactionIndex,
    logIndex: String(input.flowIndex),
    from,
    to,
    amountRaw,
    kind,
    execution,
    finality: execution === 'SUCCESS' ? 'FINAL' : 'PROVISIONAL',
    evidenceId: flowEvidenceId(input.report, input.flow),
    observedAt: snapshot.capturedAt,
    counterparties: [from, to],
  });
  return {
    edge,
    ...(sourceAccount === undefined ? {} : { sourceAccount }),
    ...(destinationAccount === undefined ? {} : { destinationAccount }),
  };
}

function createSolObservation(input: {
  report: SolanaTransactionIntelligenceReport;
  transactionIndex: string;
  flow: SolanaAssetFlow;
  flowIndex: number;
}): SolanaDealerAssetObservation | undefined {
  if (input.flow.assetKind !== 'NATIVE_SOL') return undefined;
  const source = knownString(input.flow.sourceAccount);
  const destination = knownString(input.flow.destinationAccount);
  const amountRaw = knownQuantity(input.flow.amount);
  const snapshot = input.report.metadata.snapshot;
  if (
    source === undefined ||
    destination === undefined ||
    amountRaw === undefined ||
    snapshot?.ledger !== 'SOLANA'
  ) {
    return undefined;
  }
  const execution =
    input.flow.application === 'APPLIED'
      ? 'SUCCESS'
      : input.flow.application === 'NOT_APPLIED'
        ? 'FAILED'
        : 'UNKNOWN';
  const value = {
    schemaVersion: 'solana-dealer-asset-observation-v1' as const,
    assetKind: 'NATIVE_SOL' as const,
    asset: 'SOL' as const,
    source,
    destination,
    amountRaw,
    decimals: 9,
    signature: input.report.signature,
    slot: snapshot.slot,
    blockhash: snapshot.blockhash,
    transactionIndex: input.transactionIndex,
    instructionPath: input.flow.instructionPath,
    execution,
    evidenceIds: [flowEvidenceId(input.report, input.flow)],
    snapshot,
  };
  return SolanaDealerAssetObservationSchema.parse({
    ...value,
    id: `sdao_${hashPayload({ schema: 'solana-dealer-asset-observation-v1', value }).slice(0, 24)}`,
    resultHash: hashPayload(value),
  });
}

function holderState(
  observations: readonly SolanaTokenFlowObservation[],
  mint: string,
): {
  holders: SolanaDealerHolder[];
  openingBalances: Readonly<Record<string, string>>;
  unknownWalletIds: string[];
  pdaSuppressedOwnerIds: string[];
} {
  const state = new Map<
    string,
    {
      balance: bigint;
      minimum: bigint;
      delta: bigint;
      first: bigint;
      last: bigint;
      accounts: Set<string>;
      evidenceIds: Set<string>;
      observedMint: boolean;
    }
  >();
  const ensure = (wallet: string, slot: bigint) => {
    let current = state.get(wallet);
    if (current === undefined) {
      current = {
        balance: 0n,
        minimum: 0n,
        delta: 0n,
        first: slot,
        last: slot,
        accounts: new Set(),
        evidenceIds: new Set(),
        observedMint: false,
      };
      state.set(wallet, current);
    }
    current.first = current.first < slot ? current.first : slot;
    current.last = current.last > slot ? current.last : slot;
    return current;
  };
  for (const observation of observations) {
    const edge = observation.edge;
    const slot = BigInt(edge.blockNumber);
    const amount = BigInt(edge.amountRaw);
    if (edge.from !== syntheticMintSource(mint)) {
      const from = ensure(edge.from, slot);
      from.balance -= edge.execution === 'SUCCESS' && edge.kind !== 'MINT' ? amount : 0n;
      from.delta -= edge.execution === 'SUCCESS' && edge.kind !== 'MINT' ? amount : 0n;
      from.minimum = from.minimum < from.balance ? from.minimum : from.balance;
      from.evidenceIds.add(edge.evidenceId);
      if (observation.sourceAccount !== undefined) from.accounts.add(observation.sourceAccount);
    }
    if (edge.to !== syntheticMintSource(mint)) {
      const to = ensure(edge.to, slot);
      to.balance += edge.execution === 'SUCCESS' && edge.kind !== 'BURN' ? amount : 0n;
      to.delta += edge.execution === 'SUCCESS' && edge.kind !== 'BURN' ? amount : 0n;
      to.evidenceIds.add(edge.evidenceId);
      if (edge.kind === 'MINT' && edge.execution === 'SUCCESS') to.observedMint = true;
      if (observation.destinationAccount !== undefined) {
        to.accounts.add(observation.destinationAccount);
      }
    }
  }
  const holders: SolanaDealerHolder[] = [];
  const openingBalances: Record<string, string> = {};
  const unknownWalletIds: string[] = [];
  for (const [owner, current] of state) {
    const opening = current.minimum < 0n ? -current.minimum : 0n;
    const observed = opening + current.delta;
    if (observed < 0n) continue;
    openingBalances[owner] = opening.toString();
    if (opening > 0n || !current.observedMint) unknownWalletIds.push(owner);
    if (current.accounts.size === 0) continue;
    holders.push({
      owner,
      tokenAccounts: [...current.accounts].sort(),
      observedBalanceRaw: observed.toString(),
      netDeltaRaw: current.delta.toString(),
      firstObservedSlot: current.first.toString(),
      lastObservedSlot: current.last.toString(),
      openingBalance:
        opening > 0n || !current.observedMint
          ? unknownValue(
              'INSUFFICIENT_DATA',
              'The bounded range does not prove the holder opening balance.',
            )
          : knownValue(opening.toString()),
      evidenceIds: [...current.evidenceIds].sort(),
    });
  }
  return {
    holders: holders.sort((left, right) => left.owner.localeCompare(right.owner)),
    openingBalances,
    unknownWalletIds: unknownWalletIds.sort(),
    pdaSuppressedOwnerIds: holders
      .map((holder) => holder.owner)
      .filter(isLikelySolanaPda)
      .sort(),
  };
}

function fundingEdges(input: {
  observations: readonly SolanaDealerAssetObservation[];
  tokenOwners: ReadonlySet<string>;
}): SolanaDealerFundingEdge[] {
  return input.observations
    .filter(
      (observation) =>
        observation.execution === 'SUCCESS' && input.tokenOwners.has(observation.destination),
    )
    .map((observation) => {
      const value = {
        schemaVersion: 'solana-dealer-funding-edge-v1' as const,
        source: observation.source,
        destination: observation.destination,
        amountLamports: observation.amountRaw,
        signature: observation.signature,
        slot: observation.slot,
        blockhash: observation.blockhash,
        relation: 'SAME_TRANSACTION_FUNDING' as const,
        evidenceIds: observation.evidenceIds,
        snapshot: observation.snapshot,
        confidence: unknownValue(
          'NOT_QUERIED',
          'Funding identity is an observation-bound relationship, not a calibrated ownership probability.',
        ),
        detail:
          'A finalized native SOL transfer reached a token participant in the same transaction.',
      };
      return SolanaDealerFundingEdgeSchema.parse({
        ...value,
        id: `sdf_${hashPayload({ schema: 'solana-dealer-funding-edge-v1', value }).slice(0, 24)}`,
        resultHash: hashPayload(value),
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function settlementEdges(input: {
  tokenEdges: readonly TokenFlowEdge[];
  observations: readonly SolanaDealerAssetObservation[];
  mint: string;
  suppressedOwners?: ReadonlySet<string>;
}): SolanaDealerSettlementEdge[] {
  const bySignature = new Map<string, SolanaDealerAssetObservation[]>();
  for (const observation of input.observations) {
    const values = bySignature.get(observation.signature) ?? [];
    values.push(observation);
    bySignature.set(observation.signature, values);
  }
  return input.tokenEdges
    .filter(
      (edge) =>
        edge.execution === 'SUCCESS' &&
        edge.kind === 'TRANSFER' &&
        !input.suppressedOwners?.has(edge.from) &&
        !input.suppressedOwners?.has(edge.to),
    )
    .flatMap((edge) => {
      const transfers = bySignature.get(edge.transactionHash) ?? [];
      return transfers
        .filter(
          (transfer) =>
            transfer.execution === 'SUCCESS' &&
            transfer.destination === edge.from &&
            transfer.source !== edge.from,
        )
        .map((transfer) => {
          const value = {
            schemaVersion: 'solana-dealer-settlement-edge-v1' as const,
            source: edge.from,
            destination: transfer.source,
            tokenAmountRaw: edge.amountRaw,
            solAmountLamports: transfer.amountRaw,
            signature: edge.transactionHash,
            slot: edge.blockNumber,
            blockhash: edge.blockHash,
            status: 'POSSIBLE' as const,
            evidenceIds: [...new Set([edge.evidenceId, ...transfer.evidenceIds])].sort(),
            snapshot: transfer.snapshot,
            confidence: unknownValue(
              'NOT_QUERIED',
              'A same-transaction SOL path is a settlement candidate; venue and execution semantics remain unresolved.',
            ),
            detail: `Observed ${input.mint} token movement and native SOL movement in one finalized transaction; no DEX venue decoder was asserted.`,
          };
          return SolanaDealerSettlementEdgeSchema.parse({
            ...value,
            id: `sds_${hashPayload({ schema: 'solana-dealer-settlement-edge-v1', value }).slice(0, 24)}`,
            resultHash: hashPayload(value),
          });
        });
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createSummaryEvidence(input: {
  snapshot: AnalysisSnapshot;
  sourceEvidenceIds: readonly string[];
  payload: unknown;
  summary: string;
}): Evidence {
  return createDerivedCampaignEvidence({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    blockOrSlot: snapshotPosition(input.snapshot),
    finality: 'finalized',
    snapshot: input.snapshot,
    payload: input.payload,
    summary: input.summary,
    sourceEvidenceIds: sortedUnique(input.sourceEvidenceIds),
    observedAt: input.snapshot.capturedAt,
  });
}

function buildCampaign(input: {
  mint: string;
  fromSlot: string;
  toSlot: string;
  snapshot: AnalysisSnapshot;
  edges: readonly TokenFlowEdge[];
  holders: readonly SolanaDealerHolder[];
  openings: Readonly<Record<string, string>>;
  sourceSet: readonly string[];
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  funding: readonly SolanaDealerFundingEdge[];
  settlement: readonly SolanaDealerSettlementEdge[];
}): {
  bundle: ControlCampaignBundle;
  derivedEvidence: Evidence[];
  derivedEvidenceSources: Readonly<Record<string, readonly string[]>>;
} {
  const members = input.holders
    .filter((holder) => BigInt(holder.observedBalanceRaw) > 0n)
    .map((holder) => holder.owner);
  if (members.length === 0) {
    throw new SolanaDealerReconstructionError(
      'SOLANA_DEALER_NO_TOKEN_ACTIVITY',
      'No positive Solana token holder was observed in the requested range.',
    );
  }
  const memberEvidenceIds = sortedUnique(
    input.holders
      .filter((holder) => members.includes(holder.owner))
      .flatMap((holder) => holder.evidenceIds),
  );
  const fundingRoots = sortedUnique(
    input.funding.map((edge) => edge.source).filter((source) => !members.includes(source)),
  );
  const settlementRoots = sortedUnique(input.settlement.map((edge) => edge.destination));
  const core = [...members].sort((left, right) => {
    const leftBalance = BigInt(
      input.holders.find((holder) => holder.owner === left)?.observedBalanceRaw ?? '0',
    );
    const rightBalance = BigInt(
      input.holders.find((holder) => holder.owner === right)?.observedBalanceRaw ?? '0',
    );
    return leftBalance === rightBalance
      ? left.localeCompare(right)
      : leftBalance > rightBalance
        ? -1
        : 1;
  });
  const coreWalletIds = core.slice(0, Math.max(1, Math.ceil(core.length / 3)));
  const satelliteWalletIds = members.filter((member) => !coreWalletIds.includes(member));
  const cluster = buildControlClusterVersion({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    token: input.mint,
    validFromBlock: input.fromSlot,
    validToBlock: knownValue(input.toSlot),
    memberWalletIds: members,
    coreWalletIds,
    satelliteWalletIds,
    fundingRootIds: fundingRoots,
    settlementRootIds: settlementRoots,
    membershipEvidenceIds: memberEvidenceIds,
    snapshot: input.snapshot,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    sourceSet: input.sourceSet,
    confidence: unknownValue('NOT_QUERIED', 'Solana control identity is not calibrated.'),
  });
  const endBlock = knownValue(input.toSlot);
  const campaignId = controlCampaignIdFor({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    token: input.mint,
    originBlock: input.fromSlot,
    startBlock: input.fromSlot,
    endBlock,
    clusterVersionId: cluster.id,
  });
  let position;
  try {
    position = buildClusterPosition({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      token: input.mint,
      campaignId,
      clusterVersionId: cluster.id,
      memberWalletIds: members,
      initialTokenBalanceRaw: members
        .reduce((total, member) => total + BigInt(input.openings[member] ?? '0'), 0n)
        .toString(),
      initialWalletBalances: Object.fromEntries(
        members.map((member) => [member, input.openings[member] ?? '0']),
      ),
      snapshot: input.snapshot,
      edges: input.edges,
      membershipEvidenceIds: memberEvidenceIds,
      dataCoverage: input.dataCoverage,
      sourceCoverage: input.sourceCoverage,
      historyCoverage: input.historyCoverage,
      sourceSet: input.sourceSet,
      confidence: unknownValue('NOT_QUERIED', 'Solana position confidence is not calibrated.'),
    });
  } catch (error) {
    if (error instanceof ClusterPositionConservationError) {
      throw new SolanaDealerReconstructionError(
        'SOLANA_DEALER_POSITION_UNAVAILABLE',
        'Solana token position did not conserve under the observed finalized flow set.',
        error,
      );
    }
    throw error;
  }
  const event = detectBehaviorEvent({
    campaignId,
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    token: input.mint,
    clusterVersionId: cluster.id,
    snapshot: input.snapshot,
    afterPosition: position,
    edges: input.edges,
    actors: members,
    counterparties: sortedUnique([
      ...input.edges.flatMap((edge) => edge.counterparties),
      ...fundingRoots,
      ...settlementRoots,
    ]),
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    sourceSet: input.sourceSet,
    supportingEvidenceIds: sortedUnique([
      ...input.edges.map((edge) => edge.evidenceId),
      ...input.funding.flatMap((edge) => edge.evidenceIds),
      ...input.settlement.flatMap((edge) => edge.evidenceIds),
    ]),
  });
  const derivedEvidence: Evidence[] = [];
  const tokenSummarySourceIds = sortedUnique(input.edges.map((edge) => edge.evidenceId));
  const tokenSummary = createSummaryEvidence({
    snapshot: input.snapshot,
    sourceEvidenceIds: tokenSummarySourceIds,
    payload: { mint: input.mint, members, edges: input.edges, holders: input.holders },
    summary: 'Solana token flow, holder ownership separation, and bounded position summary.',
  });
  derivedEvidence.push(tokenSummary);
  const fundingSummary =
    input.funding.length === 0
      ? undefined
      : createSummaryEvidence({
          snapshot: input.snapshot,
          sourceEvidenceIds: sortedUnique(input.funding.flatMap((edge) => edge.evidenceIds)),
          payload: { funding: input.funding },
          summary:
            'Same-transaction native SOL funding observations for Solana token participants.',
        });
  if (fundingSummary !== undefined) derivedEvidence.push(fundingSummary);
  const fundingSummarySourceIds = sortedUnique(input.funding.flatMap((edge) => edge.evidenceIds));
  const settlementSummarySourceIds =
    input.settlement.length === 0
      ? sortedUnique(input.edges.map((edge) => edge.evidenceId))
      : sortedUnique(input.settlement.flatMap((edge) => edge.evidenceIds));
  const settlementSummary = createSummaryEvidence({
    snapshot: input.snapshot,
    sourceEvidenceIds: settlementSummarySourceIds,
    payload: { settlement: input.settlement, observed: input.settlement.length > 0 },
    summary:
      input.settlement.length === 0
        ? 'No same-transaction SOL settlement path was observed; venue and proceeds remain Unknown.'
        : 'Possible same-transaction Solana token-to-SOL settlement paths; venue semantics remain Unknown.',
  });
  derivedEvidence.push(settlementSummary);
  const items = [
    createCampaignEvidenceItem({
      evidence: tokenSummary,
      campaignId,
      phase: 'TOKEN_CONTROL',
      role: 'DERIVED',
      polarity: 'SUPPORT',
      snapshot: input.snapshot,
      parentEvidenceIds: sortedUnique(input.edges.map((edge) => edge.evidenceId)),
      featureKind: 'SOLANA_TOKEN_FLOW_AND_HOLDER_OWNERSHIP',
      explanation:
        'Token-account owners were resolved separately from token-account addresses; the bounded token flow was then materialized into a conserved cluster position.',
    }),
    ...(fundingSummary === undefined
      ? []
      : [
          createCampaignEvidenceItem({
            evidence: fundingSummary,
            campaignId,
            phase: 'FUNDING',
            role: 'DERIVED',
            polarity: 'SUPPORT',
            snapshot: input.snapshot,
            parentEvidenceIds: sortedUnique(input.funding.flatMap((edge) => edge.evidenceIds)),
            featureKind: 'SOL_FUNDING',
            explanation:
              'Native SOL transfers reaching token participants are retained as funding observations, without converting them into ownership proof.',
          }),
        ]),
    createCampaignEvidenceItem({
      evidence: settlementSummary,
      campaignId,
      phase: input.settlement.length === 0 ? 'NEGATIVE' : 'SETTLEMENT',
      role: 'DERIVED',
      polarity: input.settlement.length === 0 ? 'NEUTRAL' : 'SUPPORT',
      snapshot: input.snapshot,
      parentEvidenceIds:
        input.settlement.length === 0
          ? sortedUnique(input.edges.map((edge) => edge.evidenceId))
          : sortedUnique(input.settlement.flatMap((edge) => edge.evidenceIds)),
      featureKind:
        input.settlement.length === 0 ? 'SETTLEMENT_NOT_OBSERVED' : 'POSSIBLE_SOL_SETTLEMENT',
      explanation:
        input.settlement.length === 0
          ? 'No observed same-transaction SOL path met the bounded settlement candidate rule; this is negative bounded evidence, not proof that settlement did not occur elsewhere.'
          : 'A same-transaction token movement and SOL movement were observed; DEX venue, pricing, and intent remain Unknown.',
    }),
  ];
  const evidenceLine = buildForensicEvidenceLine({
    campaignId,
    items,
    snapshotStart: input.snapshot,
    snapshotEnd: input.snapshot,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    sourceSet: input.sourceSet,
  });
  const campaign = buildControlCampaign({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    token: input.mint,
    originBlock: input.fromSlot,
    startBlock: input.fromSlot,
    endBlock,
    status: 'CLOSED',
    clusterVersion: cluster,
    snapshotStart: input.snapshot,
    snapshotEnd: input.snapshot,
    positions: [position],
    behaviorEvents: [event],
    fundingRootIds: fundingRoots,
    settlementRootIds: settlementRoots,
    evidenceLineItemIds: items.map((item) => item.id),
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    sourceSet: input.sourceSet,
    calibrationStatus: 'UNCALIBRATED',
  });
  return {
    bundle: buildControlCampaignBundle({
      campaign,
      clusterVersion: cluster,
      memberships: members.map((walletId) => ({
        schemaVersion: 'campaign-wallet-membership-v1' as const,
        campaignId,
        clusterVersionId: cluster.id,
        walletId,
        role: coreWalletIds.includes(walletId) ? 'CORE' : 'SATELLITE',
        validFromBlock: input.fromSlot,
        validToBlock: knownValue(input.toSlot),
        evidenceIds: input.holders.find((holder) => holder.owner === walletId)?.evidenceIds ?? [],
        resultHash: hashPayload({ walletId, campaignId, clusterVersionId: cluster.id }),
        automaticEntityMembershipAllowed: false as const,
      })),
      positions: [position],
      behaviorEvents: [event],
      evidenceItems: items,
      evidenceLine,
    }),
    derivedEvidence,
    derivedEvidenceSources: {
      [tokenSummary.id]: tokenSummarySourceIds,
      ...(fundingSummary === undefined ? {} : { [fundingSummary.id]: fundingSummarySourceIds }),
      [settlementSummary.id]: settlementSummarySourceIds,
    },
  };
}

export function buildSolanaDealerCampaign(input: SolanaDealerBuildInput): SolanaDealerBuildResult {
  const mint = canonicalPublicKey(input.mint, 'mint');
  const fromSlot = unsigned(input.fromSlot, 'fromSlot');
  const toSlot = unsigned(input.toSlot, 'toSlot');
  if (toSlot < fromSlot) {
    throw new SolanaDealerReconstructionError(
      'SOLANA_DEALER_INVALID_INPUT',
      'Solana dealer range ends before it begins.',
    );
  }
  if (
    input.snapshot.ledger !== 'SOLANA' ||
    input.snapshot.chainId !== 'solana-mainnet' ||
    input.snapshot.slot !== toSlot.toString()
  ) {
    throw new SolanaDealerReconstructionError(
      'SOLANA_DEALER_INVALID_INPUT',
      'Solana dealer input must carry a finalized Snapshot at toSlot.',
    );
  }
  const sourceSet = sortedUnique([...input.sourceSet, 'zerotrace:solana-dealer-campaign-v1.0.0']);
  if (sourceSet.length === 0 || input.rangeEvidence.length === 0) {
    throw new SolanaDealerReconstructionError(
      'SOLANA_DEALER_NO_EVIDENCE',
      'Solana dealer reconstruction requires range and transaction Evidence.',
    );
  }
  const tokenObservations: SolanaTokenFlowObservation[] = [];
  const solTransfers: SolanaDealerAssetObservation[] = [];
  const allEvidence = new Map<string, Evidence>();
  for (const evidence of input.rangeEvidence) allEvidence.set(evidence.id, evidence);
  for (const transaction of input.transactions) {
    const semantics = transaction.report.facts.transactionSemantics;
    for (const evidence of transaction.report.evidence) allEvidence.set(evidence.id, evidence);
    if (semantics.state !== 'known') continue;
    const flows = semantics.value.assetFlows;
    flows.forEach((flow, index) => {
      const tokenEdge = createTokenEdge({
        report: transaction.report,
        transactionIndex: transaction.transactionIndex,
        flow,
        flowIndex: index,
        mint,
      });
      if (tokenEdge !== undefined) tokenObservations.push(tokenEdge);
      const solObservation = createSolObservation({
        report: transaction.report,
        transactionIndex: transaction.transactionIndex,
        flow,
        flowIndex: index,
      });
      if (solObservation !== undefined) solTransfers.push(solObservation);
    });
  }
  const sortedObservations = tokenObservations.sort((leftObservation, rightObservation) => {
    const left = leftObservation.edge;
    const right = rightObservation.edge;
    const slot = BigInt(left.blockNumber) - BigInt(right.blockNumber);
    if (slot !== 0n) return slot < 0n ? -1 : 1;
    const tx = left.transactionIndex.localeCompare(right.transactionIndex, 'en', { numeric: true });
    return tx === 0 ? left.logIndex.localeCompare(right.logIndex, 'en', { numeric: true }) : tx;
  });
  const sortedEdges = sortedObservations.map((observation) => observation.edge);
  const holderData = holderState(sortedObservations, mint);
  const pdaSuppressedOwnerIds = new Set(holderData.pdaSuppressedOwnerIds);
  const campaignHolders = holderData.holders.filter(
    (holder) => !pdaSuppressedOwnerIds.has(holder.owner),
  );
  const tokenOwners = new Set(campaignHolders.map((holder) => holder.owner));
  const funding = fundingEdges({ observations: solTransfers, tokenOwners });
  const settlement = settlementEdges({
    tokenEdges: sortedEdges,
    observations: solTransfers,
    mint,
    suppressedOwners: pdaSuppressedOwnerIds,
  });
  const pdaSuppressionEvidence =
    pdaSuppressedOwnerIds.size === 0
      ? undefined
      : createSummaryEvidence({
          snapshot: input.snapshot,
          sourceEvidenceIds: sortedUnique([
            ...input.rangeEvidence.map((evidence) => evidence.id),
            ...holderData.holders
              .filter((holder) => pdaSuppressedOwnerIds.has(holder.owner))
              .flatMap((holder) => holder.evidenceIds),
          ]),
          payload: {
            mint,
            ownerIds: [...pdaSuppressedOwnerIds].sort(),
            rule: 'ED25519_OFF_CURVE_OWNER_SUPPRESSION',
          },
          summary:
            'Off-curve Solana owner accounts are retained as observations but suppressed from campaign membership and ownership propagation.',
        });
  const originEdge = sortedEdges.find(
    (edge) => edge.kind === 'MINT' && edge.execution === 'SUCCESS',
  );
  const origin =
    originEdge === undefined
      ? unknownValue(
          'INSUFFICIENT_DATA',
          'No finalized mint instruction was observed in the requested bounded range; deployment origin may precede the range.',
        )
      : knownValue({
          mint,
          tokenProgram:
            input.transactions
              .flatMap((transaction) =>
                transaction.report.facts.transactionSemantics.state === 'known'
                  ? transaction.report.facts.transactionSemantics.value.assetFlows
                  : [],
              )
              .find((flow) => flow.flowKind === 'MINT' && knownString(flow.mint) === mint)
              ?.programFamily === 'TOKEN_2022'
              ? ('TOKEN_2022' as const)
              : ('SPL_TOKEN' as const),
          firstObservedSlot: originEdge.blockNumber,
          firstObservedSignature: originEdge.transactionHash,
          mintInstructionObserved: true,
          evidenceIds: [originEdge.evidenceId],
        });
  let campaign: ControlCampaignBundle | null = null;
  const derivedEvidence: Evidence[] =
    pdaSuppressionEvidence === undefined ? [] : [pdaSuppressionEvidence];
  let derivedEvidenceSources: Readonly<Record<string, readonly string[]>> =
    pdaSuppressionEvidence === undefined
      ? {}
      : {
          [pdaSuppressionEvidence.id]: sortedUnique([
            ...input.rangeEvidence.map((evidence) => evidence.id),
            ...holderData.holders
              .filter((holder) => pdaSuppressedOwnerIds.has(holder.owner))
              .flatMap((holder) => holder.evidenceIds),
          ]),
        };
  if (
    input.allowComplete !== false &&
    holderData.unknownWalletIds.every((walletId) => pdaSuppressedOwnerIds.has(walletId)) &&
    campaignHolders.length > 0
  ) {
    const built = buildCampaign({
      mint,
      fromSlot: fromSlot.toString(),
      toSlot: toSlot.toString(),
      snapshot: input.snapshot,
      edges: sortedEdges,
      holders: campaignHolders,
      openings: holderData.openingBalances,
      sourceSet,
      dataCoverage: input.dataCoverage,
      sourceCoverage: input.sourceCoverage,
      historyCoverage: input.historyCoverage,
      funding,
      settlement,
    });
    campaign = built.bundle;
    derivedEvidence.push(...built.derivedEvidence);
    derivedEvidenceSources = built.derivedEvidenceSources;
  }
  const alertValues =
    campaign === null
      ? []
      : campaign.behaviorEvents.map((event) => createForensicCampaignAlert({ event }));
  const evidenceValues = [...allEvidence.values(), ...derivedEvidence];
  const evidenceIds = sortedUnique(evidenceValues.map((evidence) => evidence.id));
  const status =
    campaign === null
      ? sortedEdges.length === 0
        ? 'UNKNOWN'
        : 'PARTIAL'
      : input.allowComplete === false
        ? 'PARTIAL'
        : 'COMPLETE';
  const value = {
    schemaVersion: 'solana-dealer-campaign-report-v1' as const,
    ledger: 'SOLANA' as const,
    chainId: 'solana-mainnet' as const,
    mint,
    fromSlot: fromSlot.toString(),
    toSlot: toSlot.toString(),
    status,
    origin,
    holders: holderData.holders,
    tokenFlowEdges: sortedEdges,
    solTransfers: solTransfers.sort((left, right) => left.id.localeCompare(right.id)),
    fundingEdges: funding,
    settlementEdges: settlement,
    openingBalanceUnknownWalletIds: holderData.unknownWalletIds,
    pdaSuppressedOwnerIds: [...pdaSuppressedOwnerIds].sort(),
    campaign,
    alerts: alertValues,
    evidence: evidenceValues.sort((left, right) => left.id.localeCompare(right.id)),
    snapshot: input.snapshot,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    freshness: input.snapshot.capturedAt,
    sourceSet,
    modelVersion: SOLANA_DEALER_CAMPAIGN_MODEL_VERSION,
    policyVersion: SOLANA_DEALER_CAMPAIGN_POLICY_VERSION,
    evidenceIds,
  };
  const report = SolanaDealerCampaignReportSchema.parse({
    ...value,
    id: `sdc_${hashPayload({ schema: 'solana-dealer-campaign-report-v1', value }).slice(0, 24)}`,
    resultHash: hashPayload(value),
  });
  return {
    report,
    derivedEvidence,
    derivedEvidenceSources,
    tokenFlowEdges: sortedEdges,
  };
}
