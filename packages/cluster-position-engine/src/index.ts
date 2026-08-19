import { hashPayload } from '@zerotrace/evidence';
import {
  ClusterPositionSchema,
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type ClusterPosition,
  type KnowledgeValue,
  type TokenFlowEdge,
} from '@zerotrace/schemas';
import { deduplicateTokenFlowEdges, summarizeClusterFlows } from '@zerotrace/token-flow-engine';

export const CLUSTER_POSITION_ENGINE_MODEL_VERSION = 'cluster-position-v1.0.0' as const;

export interface BuildClusterPositionInput {
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  chainId: string;
  token: string;
  campaignId: string;
  clusterVersionId: string;
  memberWalletIds: readonly string[];
  initialTokenBalanceRaw: string;
  initialWalletBalances?: Readonly<Record<string, string>>;
  circulatingSupplyRaw?: string;
  sellReadyMemberWalletIds?: readonly string[];
  snapshot: AnalysisSnapshot;
  edges: readonly TokenFlowEdge[];
  membershipEvidenceIds: readonly string[];
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  sourceSet: readonly string[];
  freshness?: string;
  confidence?: KnowledgeValue<number>;
  realizableQuoteValue?: KnowledgeValue<string>;
}

export interface PositionConservation {
  initialBalanceRaw: string;
  externalInflowRaw: string;
  externalOutflowRaw: string;
  mintRaw: string;
  burnRaw: string;
  expectedBalanceRaw: string;
  actualBalanceRaw: string;
  errorRaw: string;
  passed: boolean;
}

export class ClusterPositionConservationError extends Error {
  readonly conservation: PositionConservation;

  constructor(conservation: PositionConservation) {
    super(`Cluster position conservation failed by ${conservation.errorRaw} raw units.`);
    this.name = 'ClusterPositionConservationError';
    this.conservation = conservation;
  }
}

function unsigned(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new TypeError(`${field} must be an unsigned integer string.`);
  return BigInt(value);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function snapshotPosition(snapshot: AnalysisSnapshot): string {
  switch (snapshot.ledger) {
    case 'EVM':
      return snapshot.blockNumber;
    case 'BITCOIN':
      return snapshot.height;
    case 'SOLANA':
      return snapshot.slot;
  }
}

function snapshotBlockHash(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
}

function canonicalTime(value: string | undefined, fallback: string): string {
  const date = new Date(value ?? fallback);
  if (Number.isNaN(date.getTime()))
    throw new TypeError('Position freshness must be an ISO date-time.');
  return date.toISOString();
}

function fixedDecimalRatio(numerator: bigint, denominator: bigint, scale = 18): string | null {
  if (denominator === 0n) return null;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const factor = 10n ** BigInt(scale);
  const scaled = (absolute * factor) / denominator;
  const whole = scaled / factor;
  const fraction = (scaled % factor).toString().padStart(scale, '0').replace(/0+$/, '');
  const value = fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
  return negative ? `-${value}` : value;
}

function addWalletDelta(balances: Map<string, bigint>, wallet: string, delta: bigint): void {
  if (delta === 0n) return;
  const next = (balances.get(wallet) ?? 0n) + delta;
  if (next < 0n) {
    throw new ClusterPositionConservationError({
      initialBalanceRaw: '0',
      externalInflowRaw: '0',
      externalOutflowRaw: '0',
      mintRaw: '0',
      burnRaw: '0',
      expectedBalanceRaw: '0',
      actualBalanceRaw: next.toString(),
      errorRaw: next.toString(),
      passed: false,
    });
  }
  balances.set(wallet, next);
}

function applyEdgeToWalletBalances(
  edge: TokenFlowEdge,
  memberSet: ReadonlySet<string>,
  balances: Map<string, bigint>,
): void {
  if (edge.execution !== 'SUCCESS') return;
  const amount = BigInt(edge.amountRaw);
  if (memberSet.has(edge.from) && edge.kind !== 'MINT')
    addWalletDelta(balances, edge.from, -amount);
  if (memberSet.has(edge.to) && edge.kind !== 'BURN') addWalletDelta(balances, edge.to, amount);
}

function balanceOfMembers(
  balances: ReadonlyMap<string, bigint>,
  members: readonly string[],
): bigint {
  return members.reduce((total, wallet) => total + (balances.get(wallet) ?? 0n), 0n);
}

function topKRatio(
  balances: ReadonlyMap<string, bigint>,
  members: readonly string[],
  k: number,
): KnowledgeValue<string> {
  const total = balanceOfMembers(balances, members);
  const top = members
    .map((wallet) => balances.get(wallet) ?? 0n)
    .sort((left, right) => (left === right ? 0 : left > right ? -1 : 1))
    .slice(0, k)
    .reduce((sum, value) => sum + value, 0n);
  const ratio = fixedDecimalRatio(top, total);
  return ratio === null
    ? unknownValue('INSUFFICIENT_DATA', 'Cluster has no token balance.')
    : knownValue(ratio);
}

function quoteValueDefault(): KnowledgeValue<string> {
  return unknownValue('NOT_QUERIED', 'Realizable quote value requires a pool/RV observation.');
}

export function positionConservationFor(input: {
  initialBalanceRaw: string;
  summary: ReturnType<typeof summarizeClusterFlows>;
  actualBalanceRaw: string;
}): PositionConservation {
  const initial = unsigned(input.initialBalanceRaw, 'initialBalanceRaw');
  const expected =
    initial +
    BigInt(input.summary.externalTokenInflowRaw) -
    BigInt(input.summary.externalTokenOutflowRaw) +
    BigInt(input.summary.mintRaw) -
    BigInt(input.summary.burnRaw);
  const actual = unsigned(input.actualBalanceRaw, 'actualBalanceRaw');
  const error = actual - expected;
  return {
    initialBalanceRaw: initial.toString(),
    externalInflowRaw: input.summary.externalTokenInflowRaw,
    externalOutflowRaw: input.summary.externalTokenOutflowRaw,
    mintRaw: input.summary.mintRaw,
    burnRaw: input.summary.burnRaw,
    expectedBalanceRaw: expected.toString(),
    actualBalanceRaw: actual.toString(),
    errorRaw: error.toString(),
    passed: error === 0n,
  };
}

export function buildClusterPosition(input: BuildClusterPositionInput): ClusterPosition {
  const atBlock = snapshotPosition(input.snapshot);
  if (input.snapshot.ledger !== input.ledger || input.snapshot.chainId !== input.chainId) {
    throw new TypeError('Cluster position input and Snapshot ledger/chain must agree.');
  }
  const members = sortedUnique(input.memberWalletIds);
  if (members.length === 0) throw new TypeError('A cluster position requires at least one member.');
  const sourceSet = sortedUnique(input.sourceSet);
  if (sourceSet.length === 0) throw new TypeError('Cluster position requires a source set.');
  const membershipEvidenceIds = sortedUnique(input.membershipEvidenceIds);
  if (membershipEvidenceIds.length === 0) {
    throw new TypeError('Cluster position requires membership Evidence.');
  }
  const freshness = canonicalTime(input.freshness, input.snapshot.capturedAt);
  const memberSet = new Set(members);
  const initial = unsigned(input.initialTokenBalanceRaw, 'initialTokenBalanceRaw');
  const balances = new Map<string, bigint>();
  for (const member of members) {
    const raw = input.initialWalletBalances?.[member] ?? '0';
    balances.set(member, unsigned(raw, `initialWalletBalances.${member}`));
  }
  const initialBalanceFromWallets = balanceOfMembers(balances, members);
  if (initialBalanceFromWallets !== initial) {
    throw new TypeError('initialTokenBalanceRaw must equal the sum of initialWalletBalances.');
  }
  const normalizedEdges = deduplicateTokenFlowEdges(input.edges).filter(
    (edge) => BigInt(edge.blockNumber) <= BigInt(atBlock),
  );
  for (const edge of normalizedEdges) applyEdgeToWalletBalances(edge, memberSet, balances);
  const summary = summarizeClusterFlows(normalizedEdges, members, { atBlock });
  const actualBalance = balanceOfMembers(balances, members);
  const conservation = positionConservationFor({
    initialBalanceRaw: initial.toString(),
    summary,
    actualBalanceRaw: actualBalance.toString(),
  });
  if (!conservation.passed) throw new ClusterPositionConservationError(conservation);
  const circulatingSupplyRaw = input.circulatingSupplyRaw;
  const supply =
    circulatingSupplyRaw === undefined
      ? unknownValue('NOT_QUERIED', 'Circulating supply was not supplied.')
      : (() => {
          const ratio = fixedDecimalRatio(
            actualBalance,
            unsigned(circulatingSupplyRaw, 'circulatingSupplyRaw'),
          );
          return ratio === null ? unknownValue('INSUFFICIENT_DATA') : knownValue(ratio);
        })();
  const sellReady =
    input.sellReadyMemberWalletIds === undefined
      ? unknownValue('NOT_QUERIED', 'Sell-ready status was not observed.')
      : knownValue(
          balanceOfMembers(balances, sortedUnique(input.sellReadyMemberWalletIds)).toString(),
        );
  const positionWithoutIdentity = {
    schemaVersion: 'cluster-position-v1' as const,
    campaignId: input.campaignId,
    ledger: input.ledger,
    chainId: input.chainId,
    token: input.token,
    clusterVersionId: input.clusterVersionId,
    atBlock,
    blockHash: snapshotBlockHash(input.snapshot),
    tokenBalanceRaw: actualBalance.toString(),
    controlledSupplyRatio: supply,
    externalTokenInflowRaw: summary.externalTokenInflowRaw,
    externalTokenOutflowRaw: summary.externalTokenOutflowRaw,
    mintRaw: summary.mintRaw,
    burnRaw: summary.burnRaw,
    internalTransferRaw: summary.internalTransferRaw,
    dexBuyRaw: summary.dexBuyRaw,
    dexSellRaw: summary.dexSellRaw,
    quoteAssets: summary.quoteAssets,
    sellReadyTokenRaw: sellReady,
    realizableQuoteValue: input.realizableQuoteValue ?? quoteValueDefault(),
    top1Concentration: topKRatio(balances, members, 1),
    top3Concentration: topKRatio(balances, members, 3),
    walletCount: members.filter((wallet) => (balances.get(wallet) ?? 0n) > 0n).length,
    positionEvidenceIds: sortedUnique([...summary.evidenceIds, ...membershipEvidenceIds]),
    membershipEvidenceIds,
    snapshot: input.snapshot,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    freshness,
    sourceSet,
    modelVersion: CLUSTER_POSITION_ENGINE_MODEL_VERSION,
    confidence:
      input.confidence ?? unknownValue('NOT_QUERIED', 'Position confidence is not calibrated.'),
  };
  return ClusterPositionSchema.parse({
    ...positionWithoutIdentity,
    id: `cp_${hashPayload({ schema: 'cluster-position-v1', value: positionWithoutIdentity }).slice(0, 24)}`,
    resultHash: hashPayload(positionWithoutIdentity),
  });
}

export function clusterPositionDelta(before: ClusterPosition, after: ClusterPosition): string {
  if (
    before.ledger !== after.ledger ||
    before.chainId !== after.chainId ||
    before.token !== after.token ||
    before.clusterVersionId !== after.clusterVersionId
  ) {
    throw new TypeError(
      'Cluster position deltas require one ledger, chain, token and cluster version.',
    );
  }
  return (BigInt(after.tokenBalanceRaw) - BigInt(before.tokenBalanceRaw)).toString();
}
