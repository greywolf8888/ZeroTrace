import { createEvidence, hashPayload, type EvidenceLedger } from '@zerotrace/evidence';
import { discoverCandidateWallets } from '@zerotrace/candidate-discovery';
import { buildClusterPosition } from '@zerotrace/cluster-position-engine';
import { detectBehaviorEvent } from '@zerotrace/behavior-engine';
import {
  buildControlCampaign,
  buildControlClusterVersion,
  campaignWalletRoleFor,
  controlCampaignIdFor,
} from './index.js';
import {
  buildControlCampaignBundle,
  buildForensicEvidenceLine,
  createCampaignEvidenceItem,
  createDerivedCampaignEvidence,
} from '@zerotrace/forensic-evidence';
import {
  FundingSettlementReportSchema,
  TokenHistoryDiscoveryReportSchema,
  knownValue,
  type AnalysisSnapshot,
  type BehaviorEvent,
  type CampaignEvidenceItem,
  type CandidateDiscoveryResult,
  type ControlCampaignBundle,
  type FundingSettlementReport,
  type Evidence,
  type TokenFlowEdge,
  type TokenHistoryDiscoveryReport,
} from '@zerotrace/schemas';
import { createTokenFlowEdge } from '@zerotrace/token-flow-engine';
import type { TokenFlowKind } from '@zerotrace/schemas';

/**
 * Phase 3 is intentionally an orchestration extension around the existing P0 engines. It takes
 * provider-backed reports, turns their exact observations into the canonical Token Flow graph,
 * then builds the existing Candidate -> Cluster Position -> Behavior -> Campaign -> Forensic
 * Bundle chain. It never mutates Entity membership and never turns an uncalibrated score into a
 * probability.
 */
export const PROVIDER_CAMPAIGN_RECONSTRUCTION_MODEL_VERSION =
  'provider-campaign-reconstruction-v1.0.0' as const;

export type ProviderCampaignReconstructionErrorCode =
  | 'HISTORY_INVALID'
  | 'SOURCE_EVIDENCE_UNAVAILABLE'
  | 'NO_CANDIDATE_WALLETS'
  | 'POSITION_CONSERVATION_UNAVAILABLE'
  | 'CAMPAIGN_RECONSTRUCTION_INVALID';

export class ProviderCampaignReconstructionError extends Error {
  readonly code: ProviderCampaignReconstructionErrorCode;

  constructor(code: ProviderCampaignReconstructionErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ProviderCampaignReconstructionError';
    this.code = code;
  }
}

export interface ProviderCampaignReconstructionInput {
  history: TokenHistoryDiscoveryReport;
  fundingSettlement?: FundingSettlementReport;
  evidenceLedger: EvidenceLedger;
  serviceWalletIds?: readonly string[];
  cexBoundaryWalletIds?: readonly string[];
  bridgeEndpointIds?: readonly string[];
  dexRouterIds?: readonly string[];
  maxMembers?: number;
  maxStageSnapshots?: number;
  minimumCandidateTransactions?: number;
}

export interface ProviderCampaignReconstructionResult {
  bundle: ControlCampaignBundle;
  derivedEvidence: readonly Evidence[];
  tokenFlowEdges: readonly TokenFlowEdge[];
  candidateDiscovery: CandidateDiscoveryResult;
  selectedWalletIds: readonly string[];
  openingBalanceUnknownWalletIds: readonly string[];
  stageBlocks: readonly string[];
  originResolved: boolean;
}

interface WalletScore {
  walletId: string;
  relationTouch: number;
  reasonCount: number;
  transactionCount: number;
  evidenceCount: number;
}

interface EvidenceAnchor {
  evidenceIds: readonly string[];
  snapshot: AnalysisSnapshot;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function quantity(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new TypeError(`${field} must be an unsigned decimal string.`);
  return BigInt(value);
}

function canonicalAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError('EVM wallet identity is invalid.');
  return value.toLowerCase();
}

function observationKind(
  kind: TokenHistoryDiscoveryReport['observations'][number]['kind'],
): TokenFlowKind {
  return kind;
}

function toTokenFlowEdges(history: TokenHistoryDiscoveryReport): TokenFlowEdge[] {
  return history.observations
    .map((observation) =>
      createTokenFlowEdge({
        ledger: 'EVM',
        chainId: history.chainId,
        token: history.token.toLowerCase(),
        blockNumber: observation.blockNumber,
        blockHash: observation.blockHash,
        transactionHash: observation.transactionHash,
        transactionIndex: observation.transactionIndex,
        logIndex: observation.logIndex,
        from: observation.from,
        to: observation.to,
        amountRaw: observation.amountRaw,
        kind: observationKind(observation.kind),
        execution:
          observation.application === 'SUCCESS'
            ? 'SUCCESS'
            : observation.application === 'FAILED'
              ? 'FAILED'
              : 'UNKNOWN',
        // A finalized block is not the same thing as a successfully executed transaction. Failed
        // or unresolved receipts remain visible to drilldown but cannot enter final position math.
        finality: observation.application === 'SUCCESS' ? 'FINAL' : 'PROVISIONAL',
        evidenceId: observation.evidenceIds[0]!,
        observedAt: observation.observedAt,
        ...(observation.rawArtifactRef === undefined
          ? {}
          : { rawArtifactRef: observation.rawArtifactRef }),
        counterparties: [observation.from, observation.to],
      }),
    )
    .sort((left, right) => {
      const block =
        quantity(left.blockNumber, 'left block') - quantity(right.blockNumber, 'right block');
      if (block !== 0n) return block < 0n ? -1 : 1;
      const tx = left.transactionIndex.localeCompare(right.transactionIndex, 'en', {
        numeric: true,
      });
      if (tx !== 0) return tx;
      const log = left.logIndex.localeCompare(right.logIndex, 'en', { numeric: true });
      return log !== 0 ? log : left.id.localeCompare(right.id);
    });
}

function relationWallets(report: FundingSettlementReport | undefined): Set<string> {
  return new Set(
    (report === undefined
      ? []
      : [
          ...report.fundingEdges.flatMap((edge) => [edge.source, edge.destination]),
          ...report.settlementEdges.flatMap((edge) => [edge.source, edge.destination]),
        ]
    ).map(canonicalAddress),
  );
}

function sourceIdsForReport(
  history: TokenHistoryDiscoveryReport,
  fundingSettlement: FundingSettlementReport | undefined,
): string[] {
  return sortedUnique([
    ...history.sourceSet,
    ...(fundingSettlement?.sourceSet ?? []),
    'zerotrace:provider-campaign-reconstruction-v1.0.0',
  ]);
}

function ratioMinimum(
  history: TokenHistoryDiscoveryReport,
  fundingSettlement: FundingSettlementReport | undefined,
  field: 'dataCoverage' | 'sourceCoverage' | 'historyCoverage',
): number {
  return Math.min(history[field], fundingSettlement?.[field] ?? history[field]);
}

function suppressionWallets(input: ProviderCampaignReconstructionInput): Set<string> {
  return new Set(
    [
      ...(input.serviceWalletIds ?? []),
      ...(input.cexBoundaryWalletIds ?? []),
      ...(input.bridgeEndpointIds ?? []),
      ...(input.dexRouterIds ?? []),
    ].map(canonicalAddress),
  );
}

function openingBalanceUnknownWallets(
  edges: readonly TokenFlowEdge[],
  walletIds: readonly string[],
): Set<string> {
  const members = new Set(walletIds);
  const balances = new Map<string, bigint>(walletIds.map((wallet) => [wallet, 0n]));
  const unknown = new Set<string>();
  for (const edge of edges) {
    if (edge.execution !== 'SUCCESS') continue;
    const amount = quantity(edge.amountRaw, 'flow amount');
    if (members.has(edge.from) && edge.kind !== 'MINT') {
      const next = (balances.get(edge.from) ?? 0n) - amount;
      balances.set(edge.from, next);
      if (next < 0n) unknown.add(edge.from);
    }
    if (members.has(edge.to) && edge.kind !== 'BURN') {
      balances.set(edge.to, (balances.get(edge.to) ?? 0n) + amount);
    }
  }
  return unknown;
}

function canonicalHistorySnapshot(snapshot: AnalysisSnapshot, chainId: string): AnalysisSnapshot {
  return snapshot.ledger === 'EVM' ? { ...snapshot, chainId } : snapshot;
}

function sampleSnapshots(
  history: TokenHistoryDiscoveryReport,
  maxStageSnapshots: number,
): AnalysisSnapshot[] {
  if (
    !Number.isSafeInteger(maxStageSnapshots) ||
    maxStageSnapshots < 2 ||
    maxStageSnapshots > 100
  ) {
    throw new TypeError('maxStageSnapshots must be an integer from 2 to 100.');
  }
  const byIdentity = new Map<string, AnalysisSnapshot>();
  for (const observation of history.observations) {
    const snapshot = canonicalHistorySnapshot(observation.snapshot, history.chainId);
    if (snapshot.ledger !== 'EVM') continue;
    byIdentity.set(`${snapshot.blockNumber}:${snapshot.blockHash.toLowerCase()}`, snapshot);
  }
  const finalSnapshot = canonicalHistorySnapshot(history.snapshot, history.chainId);
  if (finalSnapshot.ledger !== 'EVM') throw new TypeError('Provider campaign history must be EVM.');
  byIdentity.set(
    `${finalSnapshot.blockNumber}:${finalSnapshot.blockHash.toLowerCase()}`,
    finalSnapshot,
  );
  const ordered = [...byIdentity.values()].sort((left, right) => {
    const leftBlock = quantity(left.ledger === 'EVM' ? left.blockNumber : '0', 'snapshot block');
    const rightBlock = quantity(right.ledger === 'EVM' ? right.blockNumber : '0', 'snapshot block');
    return leftBlock === rightBlock ? 0 : leftBlock < rightBlock ? -1 : 1;
  });
  if (ordered.length <= maxStageSnapshots) return ordered;
  const indexes = new Set<number>([0, ordered.length - 1]);
  for (let index = 1; index < maxStageSnapshots - 1; index += 1) {
    indexes.add(Math.round((index * (ordered.length - 1)) / (maxStageSnapshots - 1)));
  }
  return [...indexes].sort((left, right) => left - right).map((index) => ordered[index]!);
}

function edgeEvidenceIds(edges: readonly TokenFlowEdge[]): string[] {
  return sortedUnique(edges.map((edge) => edge.evidenceId));
}

type FundingOrSettlementEdge =
  | FundingSettlementReport['fundingEdges'][number]
  | FundingSettlementReport['settlementEdges'][number];

function snapshotForFundingEdge(
  edge: FundingOrSettlementEdge,
  history: TokenHistoryDiscoveryReport,
): Extract<AnalysisSnapshot, { ledger: 'EVM' }> {
  if (history.snapshot.ledger !== 'EVM')
    throw new TypeError('Provider campaign history must be EVM.');
  return {
    ...history.snapshot,
    blockNumber: edge.blockNumber,
    blockHash: edge.blockHash,
    capturedAt: edge.observedAt,
  };
}

function snapshotForSuppressedPath(
  path: FundingSettlementReport['suppressedPaths'][number],
  history: TokenHistoryDiscoveryReport,
): Extract<AnalysisSnapshot, { ledger: 'EVM' }> {
  if (history.snapshot.ledger !== 'EVM')
    throw new TypeError('Provider campaign history must be EVM.');
  return {
    ...history.snapshot,
    blockNumber: path.blockNumber,
    blockHash: path.blockHash,
    capturedAt: path.observedAt,
  };
}

function sourceEvidenceIds(ledger: EvidenceLedger, ids: readonly string[]): string[] {
  const normalized = sortedUnique(ids);
  const missing = normalized.filter((id) => ledger.get(id) === undefined);
  if (missing.length > 0) {
    throw new ProviderCampaignReconstructionError(
      'SOURCE_EVIDENCE_UNAVAILABLE',
      `Provider campaign reconstruction is missing source Evidence: ${missing.join(', ')}.`,
    );
  }
  return normalized;
}

function evidenceAnchor(
  ledger: EvidenceLedger,
  ids: readonly string[],
  history: TokenHistoryDiscoveryReport,
  fallback: AnalysisSnapshot,
): EvidenceAnchor {
  const sourceIds = sourceEvidenceIds(ledger, ids);
  for (const id of sourceIds) {
    const node = ledger.get(id);
    const evidence = node?.evidence;
    if (node?.snapshot !== undefined) {
      const nodePosition =
        node.snapshot.ledger === 'EVM'
          ? node.snapshot.blockNumber
          : node.snapshot.ledger === 'BITCOIN'
            ? node.snapshot.height
            : node.snapshot.slot;
      if (evidence?.blockOrSlot === undefined || evidence.blockOrSlot === nodePosition) {
        return {
          evidenceIds: sourceIds,
          snapshot: canonicalHistorySnapshot(node.snapshot, history.chainId),
        };
      }
    }
    if (evidence?.blockOrSlot === undefined) continue;
    if (
      history.snapshot.ledger === 'EVM' &&
      evidence.blockOrSlot === history.snapshot.blockNumber
    ) {
      return {
        evidenceIds: sourceIds,
        snapshot: canonicalHistorySnapshot(history.snapshot, history.chainId),
      };
    }
    const observation = history.observations.find(
      (item) => item.evidenceIds.includes(id) && item.blockNumber === evidence.blockOrSlot,
    );
    if (observation !== undefined) {
      return {
        evidenceIds: sourceIds,
        snapshot: canonicalHistorySnapshot(observation.snapshot, history.chainId),
      };
    }
  }
  return {
    evidenceIds: sourceIds,
    snapshot: canonicalHistorySnapshot(fallback, history.chainId),
  };
}

function createDerivedNode(
  ledger: EvidenceLedger,
  anchor: EvidenceAnchor,
  payload: unknown,
  summary: string,
  negative = false,
): Evidence {
  const snapshot = anchor.snapshot;
  if (snapshot.ledger !== 'EVM')
    throw new TypeError('Provider campaign reconstruction must use EVM.');
  const blockOrSlot = snapshot.blockNumber;
  const evidence = negative
    ? createEvidence({
        ledger: 'EVM',
        chainId: snapshot.chainId,
        kind: 'NEGATIVE_EVIDENCE',
        source: 'zerotrace:provider-campaign-reconstruction-v1.0.0',
        locator: `provider-campaign-negative:${snapshot.chainId}:${blockOrSlot}:${hashPayload(payload).slice(0, 24)}`,
        blockOrSlot,
        finality: snapshot.finality,
        payload,
        summary,
        observedAt: snapshot.capturedAt,
        sourceEvidenceIds: anchor.evidenceIds,
      })
    : createDerivedCampaignEvidence({
        ledger: 'EVM',
        chainId: snapshot.chainId,
        blockOrSlot,
        finality: snapshot.finality,
        snapshot,
        payload,
        summary,
        sourceEvidenceIds: anchor.evidenceIds,
        observedAt: snapshot.capturedAt,
      });
  ledger.add(evidence, anchor.evidenceIds, snapshot);
  return evidence;
}

function evidencePhaseForBehavior(
  type: BehaviorEvent['type'],
):
  | 'FUNDING'
  | 'TOKEN_CONTROL'
  | 'TRADING'
  | 'SELL'
  | 'LIQUIDITY'
  | 'SETTLEMENT'
  | 'CEX_BOUNDARY'
  | 'NEGATIVE' {
  if (type === 'SETTLEMENT_CONVERGENCE' || type === 'CEX_PREPOSITIONING') return 'SETTLEMENT';
  if (type === 'COORDINATED_SELLING' || type === 'SELL_PRESSURE' || type === 'LIQUIDITY_EXIT') {
    return 'SELL';
  }
  if (type === 'ACCUMULATION' || type === 'TOKEN_DISPERSION' || type === 'TOKEN_CONSOLIDATION') {
    return 'TOKEN_CONTROL';
  }
  return 'TRADING';
}

function createMemberships(input: {
  campaignId: string;
  clusterVersionId: string;
  members: readonly string[];
  core: readonly string[];
  fundingRoots: readonly string[];
  settlementRoots: readonly string[];
  serviceWalletIds: readonly string[];
  cexBoundaryWalletIds: readonly string[];
  validFromBlock: string;
  validToBlock: string;
  evidenceByWallet: ReadonlyMap<string, readonly string[]>;
}) {
  return input.members
    .map((walletId) => {
      const value = {
        schemaVersion: 'campaign-wallet-membership-v1' as const,
        campaignId: input.campaignId,
        clusterVersionId: input.clusterVersionId,
        walletId,
        role: campaignWalletRoleFor({
          walletId,
          coreWalletIds: input.core,
          satelliteWalletIds: input.members.filter((item) => !input.core.includes(item)),
          fundingRootIds: input.fundingRoots,
          settlementRootIds: input.settlementRoots,
          serviceWalletIds: input.serviceWalletIds,
          cexBoundaryWalletIds: input.cexBoundaryWalletIds,
        }),
        validFromBlock: input.validFromBlock,
        validToBlock: knownValue(input.validToBlock),
        evidenceIds: sortedUnique(input.evidenceByWallet.get(walletId) ?? []),
        automaticEntityMembershipAllowed: false as const,
      };
      if (value.evidenceIds.length === 0) {
        throw new ProviderCampaignReconstructionError(
          'CAMPAIGN_RECONSTRUCTION_INVALID',
          `Wallet ${walletId} has no membership Evidence.`,
        );
      }
      return {
        ...value,
        resultHash: hashPayload(value),
      };
    })
    .sort((left, right) => left.walletId.localeCompare(right.walletId));
}

function intervalEdges(
  edges: readonly TokenFlowEdge[],
  startBlock: string,
  endBlock: string,
): TokenFlowEdge[] {
  const start = quantity(startBlock, 'startBlock');
  const end = quantity(endBlock, 'endBlock');
  return edges.filter((edge) => {
    const block = quantity(edge.blockNumber, 'edge block');
    return block > start && block <= end;
  });
}

export function buildProviderBackedControlCampaign(
  input: ProviderCampaignReconstructionInput,
): ProviderCampaignReconstructionResult {
  const history = TokenHistoryDiscoveryReportSchema.parse(input.history);
  const fundingSettlement =
    input.fundingSettlement === undefined
      ? undefined
      : FundingSettlementReportSchema.parse(input.fundingSettlement);
  if (history.ledger !== 'EVM' || history.snapshot.ledger !== 'EVM') {
    throw new ProviderCampaignReconstructionError(
      'HISTORY_INVALID',
      'Provider-backed campaign reconstruction requires an EVM Token History report.',
    );
  }
  if (fundingSettlement !== undefined && fundingSettlement.chainId !== history.chainId) {
    throw new ProviderCampaignReconstructionError(
      'HISTORY_INVALID',
      'Token History and Funding/Settlement reports must share the same chain.',
    );
  }
  const tokenFlowEdges = toTokenFlowEdges(history);
  if (tokenFlowEdges.length === 0) {
    throw new ProviderCampaignReconstructionError(
      'NO_CANDIDATE_WALLETS',
      'Provider-backed campaign reconstruction requires at least one exact token observation.',
    );
  }
  if (!tokenFlowEdges.some((edge) => edge.execution === 'SUCCESS')) {
    throw new ProviderCampaignReconstructionError(
      'NO_CANDIDATE_WALLETS',
      'Provider-backed campaign reconstruction has no successfully executed token observation; unresolved application state remains Unknown.',
    );
  }
  const suppressedWallets = suppressionWallets(input);
  const minimumCandidateTransactions = input.minimumCandidateTransactions ?? 1;
  if (
    !Number.isSafeInteger(minimumCandidateTransactions) ||
    minimumCandidateTransactions < 1 ||
    minimumCandidateTransactions > 1_000
  ) {
    throw new TypeError('minimumCandidateTransactions must be an integer from 1 to 1000.');
  }
  const candidateDiscovery = discoverCandidateWallets({
    ledger: 'EVM',
    chainId: history.chainId,
    token: history.token.toLowerCase(),
    fromBlock: history.fromBlock,
    toBlock: history.snapshot.blockNumber,
    edges: tokenFlowEdges,
    snapshot: history.snapshot,
    serviceWalletIds: [...suppressedWallets],
    minimumTransactionCount: minimumCandidateTransactions,
    dataCoverage: ratioMinimum(history, fundingSettlement, 'dataCoverage'),
    sourceCoverage: ratioMinimum(history, fundingSettlement, 'sourceCoverage'),
    historyCoverage: ratioMinimum(history, fundingSettlement, 'historyCoverage'),
    sourceSet: sourceIdsForReport(history, fundingSettlement),
    freshness: history.freshness,
  });
  const candidates = candidateDiscovery.candidates.filter(
    (candidate) => !suppressedWallets.has(candidate.walletId),
  );
  if (candidates.length === 0) {
    throw new ProviderCampaignReconstructionError(
      'NO_CANDIDATE_WALLETS',
      'No unsuppressed wallet candidate was found in the provider-backed Token History report.',
    );
  }
  const relations = relationWallets(fundingSettlement);
  const scored: WalletScore[] = candidates.map((candidate) => ({
    walletId: candidate.walletId,
    relationTouch: relations.has(candidate.walletId) ? 1 : 0,
    reasonCount: candidate.reasons.length,
    transactionCount: candidate.transactionCount,
    evidenceCount: candidate.evidenceIds.length,
  }));
  scored.sort(
    (left, right) =>
      right.relationTouch - left.relationTouch ||
      right.reasonCount - left.reasonCount ||
      right.transactionCount - left.transactionCount ||
      right.evidenceCount - left.evidenceCount ||
      left.walletId.localeCompare(right.walletId),
  );
  const maxMembers = input.maxMembers ?? 64;
  if (!Number.isSafeInteger(maxMembers) || maxMembers < 1 || maxMembers > 1_000) {
    throw new TypeError('maxMembers must be an integer from 1 to 1000.');
  }
  const selectedInitial = scored.slice(0, maxMembers).map((item) => item.walletId);
  const openingUnknown = openingBalanceUnknownWallets(tokenFlowEdges, selectedInitial);
  const selectedWalletIds = selectedInitial.filter((wallet) => !openingUnknown.has(wallet));
  if (selectedWalletIds.length === 0) {
    throw new ProviderCampaignReconstructionError(
      'POSITION_CONSERVATION_UNAVAILABLE',
      `Every selected candidate has an unobserved opening balance: ${[...openingUnknown].sort().join(', ')}.`,
    );
  }
  const selectedSet = new Set(selectedWalletIds);
  const coreCount = Math.max(1, Math.min(3, Math.ceil(selectedWalletIds.length / 3)));
  const coreWalletIds = scored
    .filter((item) => selectedSet.has(item.walletId))
    .slice(0, coreCount)
    .map((item) => item.walletId)
    .sort();
  const satelliteWalletIds = selectedWalletIds
    .filter((wallet) => !coreWalletIds.includes(wallet))
    .sort();
  const fundingRootIds = sortedUnique(
    fundingSettlement?.fundingEdges
      .map((edge) => edge.source)
      .filter((wallet) => !suppressedWallets.has(wallet)) ?? [],
  );
  const settlementRootIds = sortedUnique(
    fundingSettlement?.settlementEdges
      .map((edge) => edge.source)
      .filter((wallet) => !suppressedWallets.has(wallet)) ?? [],
  );
  const evidenceByWallet = new Map<string, readonly string[]>(
    candidates.map((candidate) => [candidate.walletId, candidate.evidenceIds]),
  );
  const membershipEvidenceIds = sourceEvidenceIds(
    input.evidenceLedger,
    sortedUnique([
      ...selectedWalletIds.flatMap((wallet) => evidenceByWallet.get(wallet) ?? []),
      ...history.rangeEvidenceIds,
      ...(fundingSettlement?.fundingEdges.flatMap((edge) => edge.evidenceIds) ?? []),
      ...(fundingSettlement?.settlementEdges.flatMap((edge) => edge.evidenceIds) ?? []),
    ]),
  );
  const sourceSet = sourceIdsForReport(history, fundingSettlement);
  const clusterVersion = buildControlClusterVersion({
    ledger: 'EVM',
    chainId: history.chainId,
    token: history.token.toLowerCase(),
    validFromBlock: history.fromBlock,
    validToBlock: knownValue(history.snapshot.blockNumber),
    memberWalletIds: selectedWalletIds,
    coreWalletIds,
    satelliteWalletIds,
    fundingRootIds,
    settlementRootIds,
    membershipEvidenceIds,
    snapshot: history.snapshot,
    dataCoverage: ratioMinimum(history, fundingSettlement, 'dataCoverage'),
    sourceCoverage: ratioMinimum(history, fundingSettlement, 'sourceCoverage'),
    historyCoverage: ratioMinimum(history, fundingSettlement, 'historyCoverage'),
    sourceSet,
    freshness: history.freshness,
  });
  const originResolved = history.origin.state === 'known';
  const originBlock =
    history.origin.state === 'known'
      ? history.origin.value.deploymentBlockNumber
      : history.fromBlock;
  const endBlock = knownValue(history.snapshot.blockNumber);
  const campaignId = controlCampaignIdFor({
    ledger: 'EVM',
    chainId: history.chainId,
    token: history.token.toLowerCase(),
    originBlock,
    startBlock: history.fromBlock,
    endBlock,
    clusterVersionId: clusterVersion.id,
  });
  const snapshots = sampleSnapshots(history, input.maxStageSnapshots ?? 8);
  const snapshotStart = snapshots[0]!;
  const snapshotEnd = snapshots.at(-1)!;
  const positions = snapshots.map((snapshot) =>
    buildClusterPosition({
      ledger: 'EVM',
      chainId: history.chainId,
      token: history.token.toLowerCase(),
      campaignId,
      clusterVersionId: clusterVersion.id,
      memberWalletIds: selectedWalletIds,
      initialTokenBalanceRaw: '0',
      initialWalletBalances: Object.fromEntries(selectedWalletIds.map((wallet) => [wallet, '0'])),
      snapshot,
      edges: tokenFlowEdges,
      membershipEvidenceIds,
      dataCoverage: ratioMinimum(history, fundingSettlement, 'dataCoverage'),
      sourceCoverage: ratioMinimum(history, fundingSettlement, 'sourceCoverage'),
      historyCoverage: ratioMinimum(history, fundingSettlement, 'historyCoverage'),
      sourceSet,
      freshness: snapshot.capturedAt,
    }),
  );
  if (positions.length === 0) {
    throw new ProviderCampaignReconstructionError(
      'POSITION_CONSERVATION_UNAVAILABLE',
      'No exact Snapshot could anchor a conserved Cluster Position.',
    );
  }
  const behaviorEvents: BehaviorEvent[] = [];
  for (let index = 1; index < positions.length; index += 1) {
    const beforePosition = positions[index - 1]!;
    const afterPosition = positions[index]!;
    const interval = intervalEdges(tokenFlowEdges, beforePosition.atBlock, afterPosition.atBlock);
    const settlementInterval =
      fundingSettlement?.settlementEdges.filter(
        (edge) =>
          quantity(edge.blockNumber, 'settlement block') >
            quantity(beforePosition.atBlock, 'before') &&
          quantity(edge.blockNumber, 'settlement block') <=
            quantity(afterPosition.atBlock, 'after'),
      ) ?? [];
    const suppressedInterval =
      fundingSettlement?.suppressedPaths.filter(
        (path) =>
          quantity(path.blockNumber, 'suppressed block') >
            quantity(beforePosition.atBlock, 'before') &&
          quantity(path.blockNumber, 'suppressed block') <=
            quantity(afterPosition.atBlock, 'after'),
      ) ?? [];
    if (
      interval.length === 0 &&
      settlementInterval.length === 0 &&
      suppressedInterval.length === 0
    ) {
      continue;
    }
    const settlementSources = new Set(settlementInterval.map((edge) => edge.source));
    const hasCex = settlementInterval.some((edge) => edge.relation === 'CEX_DEPOSIT');
    const explicitType =
      settlementInterval.length === 0
        ? undefined
        : hasCex
          ? ('CEX_PREPOSITIONING' as const)
          : settlementSources.size >= 2
            ? ('SETTLEMENT_CONVERGENCE' as const)
            : ('SETTLEMENT_CONVERGENCE' as const);
    const supportIds = sortedUnique([
      ...edgeEvidenceIds(interval),
      ...settlementInterval.flatMap((edge) => edge.evidenceIds),
    ]);
    const contradictingIds = sortedUnique(suppressedInterval.flatMap((path) => path.evidenceIds));
    const suppressionReasons = sortedUnique(suppressedInterval.map((path) => path.reason)).map(
      (reason) => reason,
    ) as Array<'SERVICE_HUB' | 'CEX_PATH_BREAK' | 'DEX_ROUTER_COMMON_INFRA' | 'BRIDGE_PATH_BREAK'>;
    const actors = sortedUnique([
      ...interval.flatMap((edge) => [edge.from, edge.to]),
      ...settlementInterval.flatMap((edge) => [edge.source, edge.destination]),
    ]).filter((wallet) => selectedSet.has(wallet));
    const counterparties = sortedUnique([
      ...interval.flatMap((edge) => [edge.from, edge.to]),
      ...settlementInterval.flatMap((edge) => [edge.source, edge.destination]),
    ]).filter((wallet) => !selectedSet.has(wallet));
    const event = detectBehaviorEvent({
      campaignId,
      ledger: 'EVM',
      chainId: history.chainId,
      token: history.token.toLowerCase(),
      clusterVersionId: clusterVersion.id,
      snapshot: afterPosition.snapshot,
      beforePosition,
      afterPosition,
      edges: interval,
      actors,
      counterparties,
      ...(explicitType === undefined ? {} : { type: explicitType }),
      startBlock: beforePosition.atBlock,
      endBlock: afterPosition.atBlock,
      startTime: beforePosition.snapshot.capturedAt,
      endTime: afterPosition.snapshot.capturedAt,
      dataCoverage: ratioMinimum(history, fundingSettlement, 'dataCoverage'),
      sourceCoverage: ratioMinimum(history, fundingSettlement, 'sourceCoverage'),
      historyCoverage: ratioMinimum(history, fundingSettlement, 'historyCoverage'),
      sourceSet,
      freshness: afterPosition.snapshot.capturedAt,
      supportingEvidenceIds: supportIds,
      contradictingEvidenceIds: contradictingIds,
      suppressionReasons,
    });
    behaviorEvents.push(event);
  }
  const evidenceItems: CampaignEvidenceItem[] = [];
  const derivedEvidence: Evidence[] = [];
  const addItem = (inputItem: {
    anchor: EvidenceAnchor;
    payload: unknown;
    summary: string;
    negative?: boolean;
    phase: Parameters<typeof createCampaignEvidenceItem>[0]['phase'];
    behaviorEventId?: string;
    polarity?: 'SUPPORT' | 'CONTRADICT' | 'NEUTRAL';
    subjectA?: string;
    subjectB?: string;
    featureKind?: string;
    explanation: string;
  }) => {
    const evidence = createDerivedNode(
      input.evidenceLedger,
      inputItem.anchor,
      inputItem.payload,
      inputItem.summary,
      inputItem.negative ?? false,
    );
    derivedEvidence.push(evidence);
    evidenceItems.push(
      createCampaignEvidenceItem({
        evidence,
        campaignId,
        ...(inputItem.behaviorEventId === undefined
          ? {}
          : { behaviorEventId: inputItem.behaviorEventId }),
        phase: inputItem.phase,
        role: inputItem.negative ? 'DERIVED' : 'DERIVED',
        polarity: inputItem.polarity ?? (inputItem.negative ? 'CONTRADICT' : 'SUPPORT'),
        snapshot: inputItem.anchor.snapshot,
        parentEvidenceIds: inputItem.anchor.evidenceIds,
        ...(inputItem.subjectA === undefined ? {} : { subjectA: inputItem.subjectA }),
        ...(inputItem.subjectB === undefined ? {} : { subjectB: inputItem.subjectB }),
        ...(inputItem.featureKind === undefined ? {} : { featureKind: inputItem.featureKind }),
        strength: inputItem.negative ? 1 : 1,
        reliability: ratioMinimum(history, fundingSettlement, 'sourceCoverage'),
        weight: inputItem.negative ? -1 : 1,
        explanation: inputItem.explanation,
      }),
    );
  };
  for (const candidate of candidates.filter((candidate) => selectedSet.has(candidate.walletId))) {
    const anchor = evidenceAnchor(
      input.evidenceLedger,
      candidate.evidenceIds,
      history,
      history.snapshot,
    );
    addItem({
      anchor,
      payload: {
        modelVersion: PROVIDER_CAMPAIGN_RECONSTRUCTION_MODEL_VERSION,
        candidate: candidate.walletId,
        reasons: candidate.reasons,
        transactionCount: candidate.transactionCount,
        serviceSuppressed: candidate.serviceSuppressed,
      },
      summary: `Provider-backed candidate screening for ${candidate.walletId}.`,
      phase: 'TOKEN_CONTROL',
      subjectA: candidate.walletId,
      featureKind: 'CANDIDATE_SCREEN',
      explanation: `Observed token-flow candidate ${candidate.walletId}; this is a screening feature, not an ownership merge.`,
    });
  }
  for (const edge of fundingSettlement?.fundingEdges ?? []) {
    const anchor = evidenceAnchor(
      input.evidenceLedger,
      edge.evidenceIds,
      history,
      snapshotForFundingEdge(edge, history),
    );
    addItem({
      anchor,
      payload: {
        edgeId: edge.id,
        relation: edge.relation,
        path: edge.path,
        transactionHash: edge.transactionHash,
      },
      summary: `Provider-backed Funding relation ${edge.relation}.`,
      phase: 'FUNDING',
      subjectA: edge.source,
      subjectB: edge.destination,
      featureKind: edge.relation,
      explanation: `Exact Funding evidence records ${edge.relation}; it does not establish common real-world control.`,
    });
  }
  for (const edge of fundingSettlement?.settlementEdges ?? []) {
    const anchor = evidenceAnchor(
      input.evidenceLedger,
      edge.evidenceIds,
      history,
      snapshotForFundingEdge(edge, history),
    );
    addItem({
      anchor,
      payload: {
        edgeId: edge.id,
        relation: edge.relation,
        path: edge.path,
        transactionHash: edge.transactionHash,
      },
      summary: `Provider-backed Settlement relation ${edge.relation}.`,
      phase: edge.relation === 'CEX_DEPOSIT' ? 'CEX_BOUNDARY' : 'SETTLEMENT',
      subjectA: edge.source,
      subjectB: edge.destination,
      featureKind: edge.relation,
      explanation: `Exact Settlement evidence records ${edge.relation}; attribution stops at infrastructure boundaries.`,
    });
  }
  for (const path of fundingSettlement?.suppressedPaths ?? []) {
    const anchor = evidenceAnchor(
      input.evidenceLedger,
      path.evidenceIds,
      history,
      snapshotForSuppressedPath(path, history),
    );
    addItem({
      anchor,
      payload: {
        suppressionId: path.id,
        reason: path.reason,
        path: path.path,
        transactionHash: path.transactionHash,
      },
      summary: `Provider-backed attribution boundary ${path.reason}.`,
      negative: true,
      phase: path.reason === 'CEX_PATH_BREAK' ? 'CEX_BOUNDARY' : 'NEGATIVE',
      subjectA: path.source,
      subjectB: path.destination,
      featureKind: path.reason,
      explanation: `${path.reason} is retained as negative Evidence and suppresses ownership propagation.`,
    });
  }
  for (const event of behaviorEvents) {
    const sourceIds = sortedUnique([
      ...event.supportingEvidenceIds,
      ...event.contradictingEvidenceIds,
    ]);
    const anchor = evidenceAnchor(input.evidenceLedger, sourceIds, history, event.snapshot);
    addItem({
      anchor,
      payload: {
        behaviorEventId: event.id,
        type: event.type,
        featureVector: event.featureVector,
        suppressionReasons: event.suppressionReasons,
      },
      summary: `Provider-backed Behavior Event ${event.type}.`,
      phase: evidencePhaseForBehavior(event.type),
      behaviorEventId: event.id,
      polarity: event.contradictingEvidenceIds.length > 0 ? 'NEUTRAL' : 'SUPPORT',
      featureKind: event.type,
      explanation: event.explanation,
    });
  }
  let evidenceLine;
  try {
    evidenceLine = buildForensicEvidenceLine({
      campaignId,
      items: evidenceItems,
      snapshotStart,
      snapshotEnd,
      dataCoverage: ratioMinimum(history, fundingSettlement, 'dataCoverage'),
      sourceCoverage: ratioMinimum(history, fundingSettlement, 'sourceCoverage'),
      historyCoverage: ratioMinimum(history, fundingSettlement, 'historyCoverage'),
      sourceSet,
      freshness: history.freshness,
    });
  } catch (error) {
    const identity = (value: { ledger: string; chainId: string }) =>
      `${value.ledger}/${value.chainId}`;
    const itemIdentities = sortedUnique(evidenceItems.map((item) => identity(item)));
    throw new ProviderCampaignReconstructionError(
      'CAMPAIGN_RECONSTRUCTION_INVALID',
      `Forensic Evidence line could not align item identities ${itemIdentities.join(', ')} with Snapshot range ${identity(snapshotStart)}: ${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}.`,
      error,
    );
  }
  const memberships = createMemberships({
    campaignId,
    clusterVersionId: clusterVersion.id,
    members: selectedWalletIds,
    core: coreWalletIds,
    fundingRoots: fundingRootIds,
    settlementRoots: settlementRootIds,
    serviceWalletIds: input.serviceWalletIds ?? [],
    cexBoundaryWalletIds: input.cexBoundaryWalletIds ?? [],
    validFromBlock: history.fromBlock,
    validToBlock: history.snapshot.blockNumber,
    evidenceByWallet,
  });
  const campaign = buildControlCampaign({
    ledger: 'EVM',
    chainId: history.chainId,
    token: history.token.toLowerCase(),
    originBlock,
    startBlock: history.fromBlock,
    endBlock,
    clusterVersion,
    snapshotStart,
    snapshotEnd,
    positions,
    behaviorEvents,
    fundingRootIds,
    settlementRootIds,
    evidenceLineItemIds: evidenceItems.map((item) => item.id),
    dataCoverage: ratioMinimum(history, fundingSettlement, 'dataCoverage'),
    sourceCoverage: ratioMinimum(history, fundingSettlement, 'sourceCoverage'),
    historyCoverage: ratioMinimum(history, fundingSettlement, 'historyCoverage'),
    freshness: history.freshness,
    sourceSet,
    calibrationStatus: 'UNCALIBRATED',
  });
  const bundle = buildControlCampaignBundle({
    campaign,
    clusterVersion,
    memberships,
    positions,
    behaviorEvents,
    evidenceItems,
    evidenceLine,
  });
  return {
    bundle,
    derivedEvidence,
    tokenFlowEdges,
    candidateDiscovery,
    selectedWalletIds,
    openingBalanceUnknownWalletIds: [...openingUnknown].sort(),
    stageBlocks: positions.map((position) => position.atBlock),
    originResolved,
  };
}
