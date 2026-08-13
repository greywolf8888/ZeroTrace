import { hashPayload } from '@zerotrace/evidence';
import type { EvmTransactionReceiptRecord, EvmTransactionRecord } from '@zerotrace/chain-adapters';
import {
  AnalysisSnapshotSchema,
  EvmAssetTransferObservationSchema,
  FundingEdgeSchema,
  FundingSettlementPatternSchema,
  FundingSettlementReportSchema,
  FundingSettlementSuppressionSchema,
  SettlementEdgeSchema,
  unknownValue,
  type AnalysisSnapshot,
  type EvmAssetTransferObservation,
  type FundingEdge,
  type FundingRelation,
  type FundingSettlementPattern,
  type FundingSettlementCoverageScope,
  type FundingSettlementReport,
  type FundingSettlementSuppression,
  type FundingSettlementSuppressionReason,
  type SettlementEdge,
  type SettlementRelation,
} from '@zerotrace/schemas';

export const FUNDING_SETTLEMENT_MODEL_VERSION = 'funding-settlement-v1.0.0' as const;
export const FUNDING_SETTLEMENT_POLICY_VERSION = 'funding-settlement-policy-v1.0.0' as const;

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const EVM_WORD = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

type EvmSnapshot = Extract<AnalysisSnapshot, { ledger: 'EVM' }>;

export type CreateEvmAssetTransferObservationInput = Omit<
  EvmAssetTransferObservation,
  'schemaVersion' | 'id' | 'ledger'
>;

export interface EvmTransactionCapture {
  transaction: EvmTransactionRecord;
  receipt: EvmTransactionReceiptRecord;
  snapshot: EvmSnapshot;
  transactionEvidenceIds: readonly string[];
  logEvidenceIds?: Readonly<Record<string, string>>;
  rawArtifactRef?: string;
}

export interface FundingSettlementDiscoveryInput {
  token: string;
  fromBlock: string;
  toBlock: string;
  snapshot: EvmSnapshot;
  transfers: readonly EvmAssetTransferObservation[];
  focusWalletIds: readonly string[];
  serviceHubIds?: readonly string[];
  cexEndpointIds?: readonly string[];
  dexRouterIds?: readonly string[];
  bridgeEndpointIds?: readonly string[];
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  sourceSet: readonly string[];
  coverageScope?: FundingSettlementCoverageScope;
  freshness?: string;
  maxHops?: number;
  maxBlockSpan?: string;
}

interface NormalizedDiscoveryInput {
  token: string;
  fromBlock: string;
  toBlock: string;
  snapshot: EvmSnapshot;
  transfers: EvmAssetTransferObservation[];
  focusWalletIds: Set<string>;
  serviceHubIds: Set<string>;
  cexEndpointIds: Set<string>;
  dexRouterIds: Set<string>;
  bridgeEndpointIds: Set<string>;
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  sourceSet: string[];
  coverageScope: FundingSettlementCoverageScope;
  freshness: string;
  maxHops: number;
  maxBlockSpan: bigint;
}

interface EdgeContext {
  input: NormalizedDiscoveryInput;
  transfer: EvmAssetTransferObservation;
  source: string;
  destination: string;
  path: readonly string[];
  evidenceIds: readonly string[];
  rawArtifactRefs: readonly string[];
  relation: FundingRelation | SettlementRelation;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function canonicalAddress(value: string, field: string): string {
  if (!EVM_ADDRESS.test(value)) throw new TypeError(`${field} must be an EVM address.`);
  return value.toLowerCase();
}

function canonicalHash(value: string, field: string): string {
  if (!EVM_HASH.test(value)) throw new TypeError(`${field} must be a 32-byte hash.`);
  return value.toLowerCase();
}

function unsigned(value: string, field: string): string {
  if (!/^\d+$/.test(value)) throw new TypeError(`${field} must be an unsigned decimal string.`);
  return BigInt(value).toString();
}

function hexQuantity(value: string, field: string): bigint {
  if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new TypeError(`${field} must be a canonical hexadecimal quantity.`);
  }
  return BigInt(value);
}

function paddedAddress(value: string, field: string): string {
  if (!EVM_WORD.test(value) || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${field} must be a padded EVM address word.`);
  }
  return `0x${value.slice(-40).toLowerCase()}`;
}

function canonicalTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('The observation time must be ISO-8601.');
  return date.toISOString();
}

function sourceIds(values: readonly string[]): string[] {
  const result = sortedUnique(values);
  if (result.length === 0)
    throw new TypeError('Funding and settlement results require a source set.');
  return result;
}

function confidence() {
  return unknownValue(
    'NOT_QUERIED',
    'The relation is a deterministic graph feature; it is not a calibrated probability.',
  );
}

function compareTransfers(left: EvmAssetTransferObservation, right: EvmAssetTransferObservation) {
  for (const [a, b] of [
    [left.blockNumber, right.blockNumber],
    [left.transactionIndex, right.transactionIndex],
    [left.eventIndex ?? '', right.eventIndex ?? ''],
    [left.id, right.id],
  ] as const) {
    const result = a.localeCompare(b, 'en', { numeric: true });
    if (result !== 0) return result;
  }
  return 0;
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function transferEvidenceIds(transfers: readonly EvmAssetTransferObservation[]): string[] {
  return sortedUnique(transfers.flatMap((transfer) => transfer.evidenceIds));
}

function transferArtifactRefs(transfers: readonly EvmAssetTransferObservation[]): string[] {
  return sortedUnique(
    transfers.flatMap((transfer) =>
      transfer.rawArtifactRef === undefined ? [] : [transfer.rawArtifactRef],
    ),
  );
}

function transferPath(transfers: readonly EvmAssetTransferObservation[]): string[] {
  if (transfers.length === 0)
    throw new TypeError('A transfer path requires at least one transfer.');
  const path = [transfers[0]!.source, ...transfers.map((transfer) => transfer.destination)];
  return path.every((item, index) => index === 0 || item !== path[index - 1])
    ? path
    : [...new Set(path)];
}

function edgeBase(input: NormalizedDiscoveryInput, context: EdgeContext) {
  const transfer = context.transfer;
  return {
    ledger: 'EVM' as const,
    chainId: input.snapshot.chainId,
    source: context.source,
    destination: context.destination,
    asset: transfer.asset,
    amountAtomic: transfer.amountAtomic,
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    transactionHash: transfer.transactionHash,
    observedAt: transfer.observedAt,
    path: [...context.path],
    hopDepth: context.path.length - 1,
    evidenceIds: sortedUnique(context.evidenceIds),
    rawArtifactRefs: sortedUnique(context.rawArtifactRefs),
    snapshot: input.snapshot,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    coverageScope: input.coverageScope ?? 'BOUNDED_RANGE',
    freshness: input.freshness,
    sourceSet: input.sourceSet,
    modelVersion: FUNDING_SETTLEMENT_MODEL_VERSION,
    policyVersion: FUNDING_SETTLEMENT_POLICY_VERSION,
    confidence: confidence(),
    relation: context.relation,
  };
}

export function evmAssetTransferObservationIdFor(
  value: Omit<EvmAssetTransferObservation, 'id'>,
): string {
  return `eat_${hashPayload({ schema: 'evm-asset-transfer-observation-v1', value }).slice(0, 24)}`;
}

export function createEvmAssetTransferObservation(
  input: CreateEvmAssetTransferObservationInput,
): EvmAssetTransferObservation {
  const normalized: Omit<EvmAssetTransferObservation, 'id'> = {
    schemaVersion: 'evm-asset-transfer-observation-v1',
    ledger: 'EVM',
    chainId: input.chainId.trim(),
    asset: input.asset === 'NATIVE' ? 'NATIVE' : canonicalAddress(input.asset, 'asset'),
    source: canonicalAddress(input.source, 'source'),
    destination: canonicalAddress(input.destination, 'destination'),
    amountAtomic: unsigned(input.amountAtomic, 'amountAtomic'),
    blockNumber: unsigned(input.blockNumber, 'blockNumber'),
    blockHash: canonicalHash(input.blockHash, 'blockHash'),
    transactionHash: canonicalHash(input.transactionHash, 'transactionHash'),
    transactionIndex: unsigned(input.transactionIndex, 'transactionIndex'),
    observedAt: canonicalTime(input.observedAt),
    execution: input.execution,
    finality: input.finality,
    evidenceIds: sortedUnique(input.evidenceIds),
    ...(input.eventIndex === undefined
      ? {}
      : { eventIndex: unsigned(input.eventIndex, 'eventIndex') }),
    ...(input.rawArtifactRef === undefined ? {} : { rawArtifactRef: input.rawArtifactRef }),
  };
  return EvmAssetTransferObservationSchema.parse({
    ...normalized,
    id: evmAssetTransferObservationIdFor(normalized),
  });
}

function logRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('The receipt log must be a JSON object.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  return value;
}

function transferEvidenceId(capture: EvmTransactionCapture, eventIndex: string): string {
  const id = capture.logEvidenceIds?.[eventIndex] ?? capture.transactionEvidenceIds[0];
  if (id === undefined || id.length === 0) {
    throw new TypeError(`No Evidence ID is available for receipt event ${eventIndex}.`);
  }
  return id;
}

function assertCapturePlacement(capture: EvmTransactionCapture): void {
  const { transaction, receipt, snapshot } = capture;
  if (transaction.blockNumber === null || transaction.blockHash === null) {
    throw new TypeError('Funding and settlement decoding requires a mined transaction.');
  }
  if (
    transaction.blockNumber !== receipt.blockNumber ||
    transaction.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()
  ) {
    throw new TypeError('Transaction and receipt placement disagree.');
  }
  if (
    canonicalHash(transaction.hash, 'transaction hash') !==
    canonicalHash(receipt.transactionHash, 'receipt transaction hash')
  ) {
    throw new TypeError('Transaction and receipt identities disagree.');
  }
  if (transaction.from.toLowerCase() !== receipt.from.toLowerCase()) {
    throw new TypeError('Transaction and receipt senders disagree.');
  }
  if ((transaction.to?.toLowerCase() ?? null) !== (receipt.to?.toLowerCase() ?? null)) {
    throw new TypeError('Transaction and receipt destinations disagree.');
  }
  if (transaction.transactionIndex !== receipt.transactionIndex) {
    throw new TypeError('Transaction and receipt indexes disagree.');
  }
  if (
    unsigned(snapshot.blockNumber, 'snapshot block') !==
      unsigned(
        hexQuantity(receipt.blockNumber, 'receipt block number').toString(),
        'receipt block',
      ) ||
    canonicalHash(snapshot.blockHash, 'snapshot block hash') !==
      canonicalHash(receipt.blockHash, 'receipt block hash')
  ) {
    throw new TypeError('The exact Snapshot does not match the receipt placement.');
  }
}

/**
 * Decodes only canonical ERC-20 Transfer logs and the transaction's native value. ERC-721-like
 * four-topic transfers, failed transactions, and malformed logs remain explicit observations but
 * cannot silently become inferred funding or settlement edges.
 */
export function decodeEvmAssetTransfers(
  capture: EvmTransactionCapture,
): EvmAssetTransferObservation[] {
  assertCapturePlacement(capture);
  const { transaction, receipt, snapshot } = capture;
  const blockNumber = hexQuantity(receipt.blockNumber, 'receipt block number').toString();
  const transactionIndex = hexQuantity(
    receipt.transactionIndex,
    'receipt transaction index',
  ).toString();
  const execution =
    receipt.status === '0x1' ? 'SUCCESS' : receipt.status === '0x0' ? 'FAILED' : 'UNKNOWN';
  const finality = execution === 'SUCCESS' ? ('FINAL' as const) : ('PROVISIONAL' as const);
  const observedAt = snapshot.blockTimestamp ?? snapshot.capturedAt;
  const transfers: EvmAssetTransferObservation[] = [];

  const nativeAmount = hexQuantity(transaction.value, 'transaction value');
  if (nativeAmount > 0n && transaction.to !== null) {
    transfers.push(
      createEvmAssetTransferObservation({
        chainId: snapshot.chainId,
        asset: 'NATIVE',
        source: transaction.from,
        destination: transaction.to,
        amountAtomic: nativeAmount.toString(),
        blockNumber,
        blockHash: receipt.blockHash,
        transactionHash: receipt.transactionHash,
        transactionIndex,
        observedAt,
        execution,
        finality,
        evidenceIds: [...capture.transactionEvidenceIds],
        ...(capture.rawArtifactRef === undefined ? {} : { rawArtifactRef: capture.rawArtifactRef }),
      }),
    );
  }

  const rawLogs = capture.receipt.raw.logs;
  if (!Array.isArray(rawLogs)) throw new TypeError('The receipt raw logs must be an array.');
  for (const rawLog of rawLogs) {
    const log = logRecord(rawLog);
    const topics = log.topics;
    if (!Array.isArray(topics) || topics.length !== 3) continue;
    const topic0 = stringField(topics[0], 'log topic 0').toLowerCase();
    if (topic0 !== ERC20_TRANSFER_TOPIC) continue;
    const eventIndex = hexQuantity(stringField(log.logIndex, 'log index'), 'log index').toString();
    const data = stringField(log.data, 'log data').toLowerCase();
    if (!EVM_WORD.test(data)) throw new TypeError(`Transfer log ${eventIndex} has invalid data.`);
    const source = paddedAddress(stringField(topics[1], 'Transfer source'), 'Transfer source');
    const destination = paddedAddress(
      stringField(topics[2], 'Transfer destination'),
      'Transfer destination',
    );
    if (source === ZERO_ADDRESS || destination === ZERO_ADDRESS) continue;
    const amountAtomic = BigInt(data).toString();
    if (amountAtomic === '0') continue;
    transfers.push(
      createEvmAssetTransferObservation({
        chainId: snapshot.chainId,
        asset: canonicalAddress(stringField(log.address, 'token address'), 'token address'),
        source,
        destination,
        amountAtomic,
        blockNumber,
        blockHash: receipt.blockHash,
        transactionHash: receipt.transactionHash,
        transactionIndex,
        eventIndex,
        observedAt,
        execution,
        finality,
        evidenceIds: [transferEvidenceId(capture, eventIndex)],
        ...(capture.rawArtifactRef === undefined ? {} : { rawArtifactRef: capture.rawArtifactRef }),
      }),
    );
  }
  return transfers.sort(compareTransfers);
}

function normalizeInput(input: FundingSettlementDiscoveryInput): NormalizedDiscoveryInput {
  const token = canonicalAddress(input.token, 'token');
  const fromBlock = unsigned(input.fromBlock, 'fromBlock');
  const toBlock = unsigned(input.toBlock, 'toBlock');
  const parsedSnapshot = AnalysisSnapshotSchema.parse(input.snapshot);
  if (parsedSnapshot.ledger !== 'EVM') {
    throw new TypeError('Funding and settlement discovery requires a finalized EVM Snapshot.');
  }
  const snapshot = {
    ...parsedSnapshot,
    blockNumber: unsigned(parsedSnapshot.blockNumber, 'snapshot block'),
    blockHash: canonicalHash(parsedSnapshot.blockHash, 'snapshot block hash'),
  };
  if (BigInt(toBlock) < BigInt(fromBlock))
    throw new TypeError('The requested range ends before it begins.');
  if (snapshot.finality !== 'finalized') {
    throw new TypeError('Funding and settlement discovery requires a finalized EVM Snapshot.');
  }
  if (!/^eip155:[1-9]\d*$/.test(snapshot.chainId)) {
    throw new TypeError('Funding and settlement discovery requires a canonical EVM chain ID.');
  }
  if (snapshot.blockNumber !== toBlock) {
    throw new TypeError('The Snapshot must anchor the requested range end.');
  }
  const transfers = input.transfers
    .map((transfer) => EvmAssetTransferObservationSchema.parse(transfer))
    .map((transfer) => ({
      ...transfer,
      chainId: transfer.chainId,
      asset: transfer.asset === 'NATIVE' ? transfer.asset : transfer.asset.toLowerCase(),
      source: transfer.source.toLowerCase(),
      destination: transfer.destination.toLowerCase(),
      blockHash: transfer.blockHash.toLowerCase(),
      transactionHash: transfer.transactionHash.toLowerCase(),
      evidenceIds: sortedUnique(transfer.evidenceIds),
      ...(transfer.rawArtifactRef === undefined ? {} : { rawArtifactRef: transfer.rawArtifactRef }),
    }))
    .sort(compareTransfers);
  for (const transfer of transfers) {
    if (transfer.chainId !== snapshot.chainId)
      throw new TypeError('Transfer chain IDs must match the Snapshot.');
    if (
      BigInt(transfer.blockNumber) < BigInt(fromBlock) ||
      BigInt(transfer.blockNumber) > BigInt(toBlock)
    ) {
      throw new TypeError('Every transfer must be inside the requested range.');
    }
  }
  if (transfers.length === 0) {
    throw new TypeError('At least one exact asset transfer observation is required.');
  }
  const normalizedAddressSet = (values: readonly string[] | undefined) =>
    new Set((values ?? []).map((value) => canonicalAddress(value, 'endpoint')));
  const focusWalletIds = normalizedAddressSet(input.focusWalletIds);
  if (focusWalletIds.size === 0) throw new TypeError('At least one focus wallet is required.');
  const freshness = canonicalTime(input.freshness ?? input.snapshot.capturedAt);
  const maxHops = input.maxHops ?? 2;
  if (!Number.isSafeInteger(maxHops) || maxHops < 1 || maxHops > 7)
    throw new TypeError('maxHops must be an integer from 1 to 7.');
  const maxBlockSpan = BigInt(unsigned(input.maxBlockSpan ?? '100000', 'maxBlockSpan'));
  const coverage = (value: number, field: string): number => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError(`${field} must be a finite ratio from 0 to 1.`);
    }
    return value;
  };
  return {
    token,
    fromBlock,
    toBlock,
    snapshot,
    transfers,
    focusWalletIds,
    serviceHubIds: normalizedAddressSet(input.serviceHubIds),
    cexEndpointIds: normalizedAddressSet(input.cexEndpointIds),
    dexRouterIds: normalizedAddressSet(input.dexRouterIds),
    bridgeEndpointIds: normalizedAddressSet(input.bridgeEndpointIds),
    dataCoverage: coverage(input.dataCoverage, 'dataCoverage'),
    sourceCoverage: coverage(input.sourceCoverage, 'sourceCoverage'),
    historyCoverage: coverage(input.historyCoverage, 'historyCoverage'),
    coverageScope: input.coverageScope ?? 'BOUNDED_RANGE',
    sourceSet: sourceIds(input.sourceSet),
    freshness,
    maxHops,
    maxBlockSpan,
  };
}

function boundaryReason(
  input: NormalizedDiscoveryInput,
  address: string,
): FundingSettlementSuppressionReason | undefined {
  if (input.serviceHubIds.has(address)) return 'SERVICE_HUB';
  if (input.cexEndpointIds.has(address)) return 'CEX_PATH_BREAK';
  if (input.dexRouterIds.has(address)) return 'DEX_ROUTER_COMMON_INFRA';
  if (input.bridgeEndpointIds.has(address)) return 'BRIDGE_PATH_BREAK';
  return undefined;
}

function successfulTransfers(input: NormalizedDiscoveryInput): EvmAssetTransferObservation[] {
  return input.transfers.filter(
    (transfer) =>
      transfer.execution === 'SUCCESS' &&
      transfer.finality === 'FINAL' &&
      BigInt(transfer.amountAtomic) > 0n,
  );
}

function addFundingEdge(
  input: NormalizedDiscoveryInput,
  context: EdgeContext,
  output: Map<string, FundingEdge>,
): void {
  const value = edgeBase(input, context);
  const withoutIdentity = { schemaVersion: 'funding-edge-v1' as const, ...value };
  const edge = FundingEdgeSchema.parse({
    ...withoutIdentity,
    id: `fue_${hashPayload({ schema: 'funding-edge-v1', value: withoutIdentity }).slice(0, 24)}`,
    resultHash: hashPayload({ schema: 'funding-edge-v1-result', value: withoutIdentity }),
  });
  output.set(edge.id, edge);
}

function addSettlementEdge(
  input: NormalizedDiscoveryInput,
  context: EdgeContext,
  output: Map<string, SettlementEdge>,
): void {
  const value = edgeBase(input, context);
  const withoutIdentity = { schemaVersion: 'settlement-edge-v1' as const, ...value };
  const edge = SettlementEdgeSchema.parse({
    ...withoutIdentity,
    id: `see_${hashPayload({ schema: 'settlement-edge-v1', value: withoutIdentity }).slice(0, 24)}`,
    resultHash: hashPayload({ schema: 'settlement-edge-v1-result', value: withoutIdentity }),
  });
  output.set(edge.id, edge);
}

function suppressionFor(
  input: NormalizedDiscoveryInput,
  transfers: readonly EvmAssetTransferObservation[],
  reason: FundingSettlementSuppressionReason,
): FundingSettlementSuppression {
  const terminal = transfers.at(-1)!;
  const value = {
    schemaVersion: 'funding-settlement-suppression-v1' as const,
    ledger: 'EVM' as const,
    chainId: input.snapshot.chainId,
    source: transfers[0]!.source,
    destination: terminal.destination,
    asset: terminal.asset,
    amountAtomic: terminal.amountAtomic,
    blockNumber: terminal.blockNumber,
    blockHash: terminal.blockHash,
    transactionHash: terminal.transactionHash,
    observedAt: terminal.observedAt,
    path: transferPath(transfers),
    reason,
    evidenceIds: transferEvidenceIds(transfers),
    rawArtifactRefs: transferArtifactRefs(transfers),
    snapshot: input.snapshot,
  };
  return FundingSettlementSuppressionSchema.parse({
    ...value,
    id: `fss_${hashPayload({ schema: 'funding-settlement-suppression-v1', value }).slice(0, 24)}`,
  });
}

function pathWithinSpan(
  path: readonly EvmAssetTransferObservation[],
  maxBlockSpan: bigint,
): boolean {
  if (path.length < 2) return true;
  return BigInt(path.at(-1)!.blockNumber) - BigInt(path[0]!.blockNumber) <= maxBlockSpan;
}

interface SequentialPathResult {
  paths: EvmAssetTransferObservation[][];
  suppressed: Array<{
    transfers: EvmAssetTransferObservation[];
    reason: FundingSettlementSuppressionReason;
  }>;
}

function sequentialPaths(
  input: NormalizedDiscoveryInput,
  candidates: readonly EvmAssetTransferObservation[],
): SequentialPathResult {
  const paths: EvmAssetTransferObservation[][] = [];
  const suppressed: SequentialPathResult['suppressed'] = [];
  const visit = (path: EvmAssetTransferObservation[]) => {
    const current = path.at(-1)!;
    if (path.length > 1 && input.focusWalletIds.has(current.destination)) {
      paths.push(path);
      return;
    }
    const currentReason = boundaryReason(input, current.destination);
    if (currentReason !== undefined) {
      suppressed.push({ transfers: path, reason: currentReason });
      return;
    }
    if (path.length >= input.maxHops) return;
    for (const next of candidates) {
      if (next.asset !== current.asset || next.amountAtomic !== current.amountAtomic) continue;
      if (next.source !== current.destination || path.some((item) => item.id === next.id)) continue;
      if (
        BigInt(next.blockNumber) < BigInt(current.blockNumber) ||
        !pathWithinSpan([...path, next], input.maxBlockSpan)
      )
        continue;
      visit([...path, next]);
    }
  };
  for (const candidate of candidates) {
    if (
      input.focusWalletIds.has(candidate.source) ||
      input.focusWalletIds.has(candidate.destination)
    )
      continue;
    const sourceReason = boundaryReason(input, candidate.source);
    if (sourceReason !== undefined) {
      suppressed.push({ transfers: [candidate], reason: sourceReason });
      continue;
    }
    visit([candidate]);
  }
  const seen = new Set<string>();
  return {
    paths: paths.filter((path) => {
      const key = path.map((item) => item.id).join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    suppressed,
  };
}

function addPattern(
  input: NormalizedDiscoveryInput,
  kind: FundingSettlementPattern['kind'],
  edges: readonly (FundingEdge | SettlementEdge)[],
  asset: FundingSettlementPattern['asset'],
  destinations: readonly string[],
  output: Map<string, FundingSettlementPattern>,
  source?: string,
): void {
  if (edges.length === 0) return;
  const edgeList = [...edges].sort(compareIds);
  const value = {
    schemaVersion: 'funding-settlement-pattern-v1' as const,
    ledger: 'EVM' as const,
    chainId: input.snapshot.chainId,
    asset,
    kind,
    ...(source === undefined ? {} : { source }),
    destinations: sortedUnique(destinations),
    edgeIds: edgeList.map((edge) => edge.id),
    transactionHashes: sortedUnique(edgeList.map((edge) => edge.transactionHash)),
    evidenceIds: sortedUnique(edgeList.flatMap((edge) => edge.evidenceIds)),
    snapshot: input.snapshot,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    coverageScope: input.coverageScope,
    freshness: input.freshness,
    sourceSet: input.sourceSet,
    modelVersion: FUNDING_SETTLEMENT_MODEL_VERSION,
    policyVersion: FUNDING_SETTLEMENT_POLICY_VERSION,
    confidence: confidence(),
  };
  const pattern = FundingSettlementPatternSchema.parse({
    ...value,
    id: `fsp_${hashPayload({ schema: 'funding-settlement-pattern-v1', value }).slice(0, 24)}`,
    resultHash: hashPayload({ schema: 'funding-settlement-pattern-result', value }),
  });
  output.set(pattern.id, pattern);
}

function buildDrilldown(transfers: readonly EvmAssetTransferObservation[]) {
  const byTransaction = new Map<string, EvmAssetTransferObservation[]>();
  for (const transfer of transfers) {
    const list = byTransaction.get(transfer.transactionHash) ?? [];
    list.push(transfer);
    byTransaction.set(transfer.transactionHash, list);
  }
  return [...byTransaction.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([transactionHash, items]) => ({
      transactionHash,
      evidenceIds: transferEvidenceIds(items),
      rawArtifactRefs: transferArtifactRefs(items),
    }));
}

/**
 * Builds bounded Funding and Settlement graphs from finalized exact observations. Infrastructure
 * endpoints are path boundaries: they may be shown as direct settlement destinations, but they
 * are never allowed to create an ownership/funding propagation edge or a multi-hop attribution.
 */
export function deriveFundingSettlementReport(
  input: FundingSettlementDiscoveryInput,
): FundingSettlementReport {
  const normalized = normalizeInput(input);
  const observed = successfulTransfers(normalized);
  const targetTransfers = observed.filter((transfer) => transfer.asset === normalized.token);
  const focus = normalized.focusWalletIds;
  const nonTarget = observed.filter((transfer) => transfer.asset !== normalized.token);
  const directFunding = nonTarget.filter(
    (transfer) => focus.has(transfer.destination) && !focus.has(transfer.source),
  );
  const directFundingByDestination = new Map<string, EvmAssetTransferObservation[]>();
  const directFundingBySource = new Map<string, EvmAssetTransferObservation[]>();
  for (const transfer of directFunding) {
    const byDestination = directFundingByDestination.get(transfer.destination) ?? [];
    byDestination.push(transfer);
    directFundingByDestination.set(transfer.destination, byDestination);
    const bySource = directFundingBySource.get(transfer.source) ?? [];
    bySource.push(transfer);
    directFundingBySource.set(transfer.source, bySource);
  }
  const fundingEdges = new Map<string, FundingEdge>();
  const settlementEdges = new Map<string, SettlementEdge>();
  const suppressed = new Map<string, FundingSettlementSuppression>();

  for (const transfer of directFunding) {
    const reason = boundaryReason(normalized, transfer.source);
    if (reason !== undefined) {
      const suppression = suppressionFor(normalized, [transfer], reason);
      suppressed.set(suppression.id, suppression);
      continue;
    }
    const first = [...(directFundingByDestination.get(transfer.destination) ?? [])].sort(
      compareTransfers,
    )[0];
    const sourceFanout = new Set(
      (directFundingBySource.get(transfer.source) ?? []).map((item) => item.destination),
    ).size;
    const relation: FundingRelation =
      first?.id === transfer.id
        ? 'FIRST_FUNDER'
        : sourceFanout > 1
          ? 'COMMON_FUNDER'
          : transfer.asset === 'NATIVE'
            ? 'GAS_FUNDER'
            : 'QUOTE_FUNDER';
    addFundingEdge(
      normalized,
      {
        input: normalized,
        transfer,
        source: transfer.source,
        destination: transfer.destination,
        path: [transfer.source, transfer.destination],
        evidenceIds: transfer.evidenceIds,
        rawArtifactRefs: transfer.rawArtifactRef === undefined ? [] : [transfer.rawArtifactRef],
        relation,
      },
      fundingEdges,
    );
  }

  const sequentialCandidates = nonTarget.filter(
    (transfer) => !focus.has(transfer.source) && BigInt(transfer.amountAtomic) > 0n,
  );
  const sequential = sequentialPaths(normalized, sequentialCandidates);
  for (const item of sequential.suppressed) {
    const suppression = suppressionFor(normalized, item.transfers, item.reason);
    suppressed.set(suppression.id, suppression);
  }
  for (const path of sequential.paths) {
    const terminal = path.at(-1)!;
    addFundingEdge(
      normalized,
      {
        input: normalized,
        transfer: terminal,
        source: path[0]!.source,
        destination: terminal.destination,
        path: transferPath(path),
        evidenceIds: transferEvidenceIds(path),
        rawArtifactRefs: transferArtifactRefs(path),
        relation: 'SEQUENTIAL_FUNDER',
      },
      fundingEdges,
    );
  }

  const targetByTransaction = new Map<string, EvmAssetTransferObservation[]>();
  const quoteByTransaction = new Map<string, EvmAssetTransferObservation[]>();
  for (const transfer of targetTransfers) {
    const list = targetByTransaction.get(transfer.transactionHash) ?? [];
    list.push(transfer);
    targetByTransaction.set(transfer.transactionHash, list);
  }
  for (const transfer of nonTarget) {
    const list = quoteByTransaction.get(transfer.transactionHash) ?? [];
    list.push(transfer);
    quoteByTransaction.set(transfer.transactionHash, list);
  }
  for (const [transactionHash, tokenItems] of targetByTransaction) {
    const quoteItems = quoteByTransaction.get(transactionHash) ?? [];
    for (const tokenTransfer of tokenItems) {
      if (!focus.has(tokenTransfer.source) || focus.has(tokenTransfer.destination)) continue;
      for (const quoteTransfer of quoteItems) {
        if (
          quoteTransfer.source !== tokenTransfer.destination ||
          quoteTransfer.destination !== tokenTransfer.source
        )
          continue;
        addSettlementEdge(
          normalized,
          {
            input: normalized,
            transfer: quoteTransfer,
            source: quoteTransfer.source,
            destination: quoteTransfer.destination,
            path: [quoteTransfer.source, quoteTransfer.destination],
            evidenceIds: [...tokenTransfer.evidenceIds, ...quoteTransfer.evidenceIds],
            rawArtifactRefs: [
              ...(tokenTransfer.rawArtifactRef === undefined ? [] : [tokenTransfer.rawArtifactRef]),
              ...(quoteTransfer.rawArtifactRef === undefined ? [] : [quoteTransfer.rawArtifactRef]),
            ],
            relation: 'SELL_PROCEEDS',
          },
          settlementEdges,
        );
      }
    }
  }

  const settlementCandidates = observed.filter(
    (transfer) => focus.has(transfer.source) && !focus.has(transfer.destination),
  );
  for (const transfer of settlementCandidates) {
    const cex = normalized.cexEndpointIds.has(transfer.destination);
    const bridge = normalized.bridgeEndpointIds.has(transfer.destination);
    if (cex || bridge) {
      addSettlementEdge(
        normalized,
        {
          input: normalized,
          transfer,
          source: transfer.source,
          destination: transfer.destination,
          path: [transfer.source, transfer.destination],
          evidenceIds: transfer.evidenceIds,
          rawArtifactRefs: transfer.rawArtifactRef === undefined ? [] : [transfer.rawArtifactRef],
          relation: cex ? 'CEX_DEPOSIT' : 'BRIDGE_EXIT',
        },
        settlementEdges,
      );
    } else if (boundaryReason(normalized, transfer.destination) !== undefined) {
      const suppression = suppressionFor(
        normalized,
        [transfer],
        boundaryReason(normalized, transfer.destination)!,
      );
      suppressed.set(suppression.id, suppression);
    }
  }

  const bySweep = new Map<string, EvmAssetTransferObservation[]>();
  for (const transfer of settlementCandidates) {
    const key = `${transfer.source}:${transfer.destination}:${transfer.asset}`;
    const list = bySweep.get(key) ?? [];
    list.push(transfer);
    bySweep.set(key, list);
  }
  for (const transfers of bySweep.values()) {
    if (new Set(transfers.map((transfer) => transfer.transactionHash)).size < 2) continue;
    for (const transfer of transfers) {
      if (
        normalized.cexEndpointIds.has(transfer.destination) ||
        normalized.bridgeEndpointIds.has(transfer.destination)
      )
        continue;
      addSettlementEdge(
        normalized,
        {
          input: normalized,
          transfer,
          source: transfer.source,
          destination: transfer.destination,
          path: [transfer.source, transfer.destination],
          evidenceIds: transfer.evidenceIds,
          rawArtifactRefs: transfer.rawArtifactRef === undefined ? [] : [transfer.rawArtifactRef],
          relation: 'SWEEP',
        },
        settlementEdges,
      );
    }
  }

  const convergence = new Map<string, EvmAssetTransferObservation[]>();
  for (const transfer of settlementCandidates) {
    if (boundaryReason(normalized, transfer.destination) !== undefined) continue;
    const key = `${transfer.destination}:${transfer.asset}`;
    const list = convergence.get(key) ?? [];
    list.push(transfer);
    convergence.set(key, list);
  }
  for (const transfers of convergence.values()) {
    if (new Set(transfers.map((transfer) => transfer.source)).size < 2) continue;
    for (const transfer of transfers) {
      addSettlementEdge(
        normalized,
        {
          input: normalized,
          transfer,
          source: transfer.source,
          destination: transfer.destination,
          path: [transfer.source, transfer.destination],
          evidenceIds: transfer.evidenceIds,
          rawArtifactRefs: transfer.rawArtifactRef === undefined ? [] : [transfer.rawArtifactRef],
          relation: 'SETTLEMENT_CONVERGENCE',
        },
        settlementEdges,
      );
    }
  }

  const patterns = new Map<string, FundingSettlementPattern>();
  const sortedFunding = [...fundingEdges.values()].sort(compareIds);
  const sortedSettlement = [...settlementEdges.values()].sort(compareIds);
  for (const [source] of directFundingBySource) {
    const edges = sortedFunding.filter((edge) => edge.source === source);
    const destinations = sortedUnique(edges.map((edge) => edge.destination));
    if (destinations.length < 2) continue;
    addPattern(normalized, 'RADIAL', edges, edges[0]!.asset, destinations, patterns, source);
  }
  const sequentialEdges = sortedFunding.filter((edge) => edge.relation === 'SEQUENTIAL_FUNDER');
  if (sequentialEdges.length > 0) {
    addPattern(
      normalized,
      'SEQUENTIAL',
      sequentialEdges,
      sequentialEdges[0]!.asset,
      sequentialEdges.map((edge) => edge.destination),
      patterns,
    );
  }
  for (const transfers of bySweep.values()) {
    const edges = sortedSettlement.filter((edge) =>
      transfers.some((transfer) => transfer.transactionHash === edge.transactionHash),
    );
    if (transfers.length > 1) {
      addPattern(
        normalized,
        'SWEEP',
        edges,
        transfers[0]!.asset,
        [transfers[0]!.destination],
        patterns,
        transfers[0]!.source,
      );
    }
  }
  for (const transfers of convergence.values()) {
    if (new Set(transfers.map((transfer) => transfer.source)).size < 2) continue;
    const edges = sortedSettlement.filter((edge) =>
      transfers.some((transfer) => transfer.transactionHash === edge.transactionHash),
    );
    addPattern(
      normalized,
      'SETTLEMENT_CONVERGENCE',
      edges,
      transfers[0]!.asset,
      [transfers[0]!.destination],
      patterns,
    );
  }

  const drilldown = buildDrilldown(normalized.transfers);
  const reportCore = {
    schemaVersion: 'funding-settlement-report-v1' as const,
    ledger: 'EVM' as const,
    chainId: normalized.snapshot.chainId,
    token: normalized.token,
    fromBlock: normalized.fromBlock,
    toBlock: normalized.toBlock,
    status:
      observed.length === 0
        ? ('UNKNOWN' as const)
        : normalized.dataCoverage < 1 ||
            normalized.sourceCoverage < 1 ||
            normalized.historyCoverage < 1
          ? ('PARTIAL' as const)
          : ('COMPLETE' as const),
    fundingEdges: sortedFunding,
    settlementEdges: sortedSettlement,
    patterns: [...patterns.values()].sort(compareIds),
    suppressedPaths: [...suppressed.values()].sort(compareIds),
    drilldown,
    snapshot: normalized.snapshot,
    dataCoverage: normalized.dataCoverage,
    sourceCoverage: normalized.sourceCoverage,
    historyCoverage: normalized.historyCoverage,
    coverageScope: normalized.coverageScope,
    freshness: normalized.freshness,
    sourceSet: normalized.sourceSet,
    modelVersion: FUNDING_SETTLEMENT_MODEL_VERSION,
    policyVersion: FUNDING_SETTLEMENT_POLICY_VERSION,
    confidence: confidence(),
    evidenceIds: sortedUnique([
      ...sortedFunding.flatMap((edge) => edge.evidenceIds),
      ...sortedSettlement.flatMap((edge) => edge.evidenceIds),
      ...[...patterns.values()].flatMap((pattern) => pattern.evidenceIds),
      ...[...suppressed.values()].flatMap((path) => path.evidenceIds),
      ...drilldown.flatMap((item) => item.evidenceIds),
    ]),
  };
  return FundingSettlementReportSchema.parse({
    ...reportCore,
    id: `fsr_${hashPayload({
      schema: 'funding-settlement-report-id-v1',
      input: {
        chainId: reportCore.chainId,
        token: reportCore.token,
        fromBlock: reportCore.fromBlock,
        toBlock: reportCore.toBlock,
        snapshot: reportCore.snapshot,
      },
    }).slice(0, 24)}`,
    resultHash: hashPayload({ schema: 'funding-settlement-report-v1', report: reportCore }),
  });
}
