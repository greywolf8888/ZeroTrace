import { hashPayload } from '@zerotrace/evidence';
import {
  CandidateDiscoveryResultSchema,
  CandidateWalletSchema,
  unknownValue,
  type AnalysisSnapshot,
  type CandidateDiscoveryReason,
  type CandidateDiscoveryResult,
  type CandidateWallet,
  type TokenFlowEdge,
} from '@zerotrace/schemas';
import { deduplicateTokenFlowEdges } from '@zerotrace/token-flow-engine';

export const CANDIDATE_DISCOVERY_MODEL_VERSION = 'candidate-discovery-v1.0.0' as const;

export interface DiscoverCandidateWalletsInput {
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  chainId: string;
  token: string;
  fromBlock: string;
  toBlock: string;
  edges: readonly TokenFlowEdge[];
  snapshot: AnalysisSnapshot;
  serviceWalletIds?: readonly string[];
  earlyWindowBlocks?: bigint;
  minimumTransactionCount?: number;
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  sourceSet: readonly string[];
  freshness?: string;
}

interface CandidateAccumulator {
  firstObservedBlock: bigint;
  netDelta: bigint;
  transactionCount: number;
  evidenceIds: Set<string>;
  reasons: Set<CandidateDiscoveryReason>;
  outgoing: Set<string>;
  incoming: Set<string>;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function unsigned(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new TypeError(`${field} must be an unsigned integer string.`);
  return BigInt(value);
}

function canonicalTime(value: string | undefined, fallback: string): string {
  const date = new Date(value ?? fallback);
  if (Number.isNaN(date.getTime()))
    throw new TypeError('Candidate freshness must be an ISO date-time.');
  return date.toISOString();
}

function candidateIdFor(value: Omit<CandidateWallet, 'id' | 'resultHash'>): string {
  return `cw_${hashPayload({ schema: 'candidate-wallet-v1', value }).slice(0, 24)}`;
}

function add(
  accumulators: Map<string, CandidateAccumulator>,
  wallet: string,
  value: Partial<CandidateAccumulator> & Pick<CandidateAccumulator, 'firstObservedBlock'>,
): CandidateAccumulator {
  const current = accumulators.get(wallet);
  if (current !== undefined) return current;
  const created: CandidateAccumulator = {
    firstObservedBlock: value.firstObservedBlock,
    netDelta: 0n,
    transactionCount: 0,
    evidenceIds: new Set(),
    reasons: new Set(),
    outgoing: new Set(),
    incoming: new Set(),
  };
  accumulators.set(wallet, created);
  return created;
}

export function discoverCandidateWallets(
  input: DiscoverCandidateWalletsInput,
): CandidateDiscoveryResult {
  const fromBlock = unsigned(input.fromBlock, 'fromBlock');
  const toBlock = unsigned(input.toBlock, 'toBlock');
  if (toBlock < fromBlock) throw new TypeError('Candidate discovery range is reversed.');
  const serviceWalletIds = new Set(input.serviceWalletIds ?? []);
  if (input.snapshot.ledger !== input.ledger || input.snapshot.chainId !== input.chainId) {
    throw new TypeError('Candidate discovery Snapshot and input identity must agree.');
  }
  const sourceSet = sortedUnique(input.sourceSet);
  if (sourceSet.length === 0) throw new TypeError('Candidate discovery requires a source set.');
  const freshness = canonicalTime(input.freshness, input.snapshot.capturedAt);
  const earlyWindow = input.earlyWindowBlocks ?? 100_000n;
  const minimumTransactions = input.minimumTransactionCount ?? 1;
  const accumulators = new Map<string, CandidateAccumulator>();
  const normalized = deduplicateTokenFlowEdges(input.edges).filter(
    (edge) =>
      edge.ledger === input.ledger &&
      edge.chainId === input.chainId &&
      edge.token === input.token &&
      edge.execution === 'SUCCESS' &&
      BigInt(edge.blockNumber) >= fromBlock &&
      BigInt(edge.blockNumber) <= toBlock,
  );
  for (const edge of normalized) {
    const amount = BigInt(edge.amountRaw);
    const firstBlock = BigInt(edge.blockNumber);
    const fromService = serviceWalletIds.has(edge.from);
    const toService = serviceWalletIds.has(edge.to);
    if (!fromService && !/^0x0{40}$/.test(edge.from)) {
      const accumulator = add(accumulators, edge.from, { firstObservedBlock: firstBlock });
      accumulator.firstObservedBlock =
        accumulator.firstObservedBlock < firstBlock ? accumulator.firstObservedBlock : firstBlock;
      accumulator.netDelta -= amount;
      accumulator.transactionCount += 1;
      accumulator.evidenceIds.add(edge.evidenceId);
      accumulator.outgoing.add(edge.to);
      if (edge.kind === 'DEX_SELL') accumulator.reasons.add('DEX_ACTIVITY');
      if (firstBlock - fromBlock <= earlyWindow) accumulator.reasons.add('EARLY_TOKEN_ACTIVITY');
      if (edge.kind === 'SETTLEMENT') accumulator.reasons.add('SETTLEMENT_COUNTERPARTY');
    }
    if (!toService && !/^0x0{40}$/.test(edge.to)) {
      const accumulator = add(accumulators, edge.to, { firstObservedBlock: firstBlock });
      accumulator.firstObservedBlock =
        accumulator.firstObservedBlock < firstBlock ? accumulator.firstObservedBlock : firstBlock;
      accumulator.netDelta += amount;
      accumulator.transactionCount += 1;
      accumulator.evidenceIds.add(edge.evidenceId);
      accumulator.incoming.add(edge.from);
      if (edge.kind === 'DEX_BUY') accumulator.reasons.add('DEX_ACTIVITY');
      if (firstBlock - fromBlock <= earlyWindow) accumulator.reasons.add('EARLY_TOKEN_ACTIVITY');
      if (edge.kind === 'SETTLEMENT') accumulator.reasons.add('SETTLEMENT_COUNTERPARTY');
    }
  }
  for (const [wallet, accumulator] of accumulators) {
    if (accumulator.outgoing.size >= 3) accumulator.reasons.add('FAN_OUT_SOURCE');
    if (accumulator.incoming.size >= 3) accumulator.reasons.add('FAN_IN_DESTINATION');
    if (accumulator.netDelta > 0n) accumulator.reasons.add('TOKEN_INFLOW');
    if (accumulator.netDelta < 0n) accumulator.reasons.add('TOKEN_OUTFLOW');
    if (accumulator.transactionCount < minimumTransactions) accumulators.delete(wallet);
  }
  const candidates = [...accumulators.entries()]
    .filter(([wallet]) => !serviceWalletIds.has(wallet))
    .map(([wallet, accumulator]) => {
      const value: Omit<CandidateWallet, 'id' | 'resultHash'> = {
        schemaVersion: 'candidate-wallet-v1',
        ledger: input.ledger,
        chainId: input.chainId,
        token: input.token,
        walletId: wallet,
        reasons: [...accumulator.reasons].sort(),
        firstObservedBlock: accumulator.firstObservedBlock.toString(),
        netTokenDeltaRaw: accumulator.netDelta.toString(),
        transactionCount: accumulator.transactionCount,
        evidenceIds: [...accumulator.evidenceIds].sort(),
        serviceSuppressed: false,
        automaticEntityMembershipAllowed: false,
      };
      return CandidateWalletSchema.parse({
        ...value,
        id: candidateIdFor(value),
        resultHash: hashPayload(value),
      });
    })
    .sort((left, right) => left.walletId.localeCompare(right.walletId));
  const evidenceIds = sortedUnique(normalized.map((edge) => edge.evidenceId));
  const withoutIdentity = {
    schemaVersion: 'candidate-discovery-v1' as const,
    ledger: input.ledger,
    chainId: input.chainId,
    token: input.token,
    snapshot: input.snapshot,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    candidates,
    excludedServiceWalletIds: [...serviceWalletIds].sort(),
    evidenceIds,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    freshness,
    sourceSet,
    modelVersion: CANDIDATE_DISCOVERY_MODEL_VERSION,
    confidence: unknownValue(
      'NOT_QUERIED',
      'Candidate discovery is a screening result, not a calibrated probability.',
    ),
    automaticEntityMembershipAllowed: false as const,
  };
  return CandidateDiscoveryResultSchema.parse({
    ...withoutIdentity,
    id: `cd_${hashPayload({ schema: 'candidate-discovery-v1', value: withoutIdentity }).slice(0, 24)}`,
    resultHash: hashPayload(withoutIdentity),
  });
}
