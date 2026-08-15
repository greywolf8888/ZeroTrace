import {
  actionSemanticsReportId,
  buildActionSemanticsFromRawFacts,
  type ActionSemanticsReport,
} from '@zerotrace/action-semantics';
import {
  ProviderCapabilityRegistry,
  type EvmContractCreationReader,
  type EvmContractCreationRecord,
  type EvmTransactionReceiptRecord,
  type EvmTransactionRecord,
  type SqdFinalizedBlock,
  type SqdFinalizedRangeRequest,
  type SqdStreamSummary,
  type TransportDiagnostics,
  type TransportObservation,
} from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload, type EvidenceNode } from '@zerotrace/evidence';
import {
  AnalysisSnapshotSchema,
  JsonValueSchema,
  TokenFlowObservationSchema,
  TokenHistoryActionBindingSchema,
  TokenHistoryDiscoveryReportSchema,
  type TokenHistoryProviderCapabilityDeclaration,
  TokenOriginSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisSnapshot,
  type Evidence,
  type KnowledgeValue,
  type RawChainFact,
  type TokenFlowObservation,
  type TokenHistoryActionBinding,
  type TokenHistoryDiscoveryReport,
  type TokenOrigin,
  type ProviderCapability,
} from '@zerotrace/schemas';
import {
  createRawChainFact,
  type IngestionRun,
  type RawArtifactWriteResult,
} from '@zerotrace/storage';

import {
  SQD_INGESTION_VERSION,
  SqdFinalizedIngestionPipeline,
  type SqdFinalizedIngestionOptions,
  type SqdFinalizedSource,
  type SqdIngestionResult,
} from './index.js';

export const TOKEN_HISTORY_DISCOVERY_MODEL_VERSION = 'token-history-discovery-v1.0.0';
export const TOKEN_HISTORY_DISCOVERY_POLICY_VERSION = 'token-history-policy-v1.0.0';
export const TOKEN_HISTORY_EXACT_RPC_ADAPTER_VERSION = 'token-history-exact-rpc-v1.0.0';
export const TOKEN_HISTORY_SOURCE_RECONCILIATION_MODEL_VERSION =
  'token-history-source-reconciliation-v1.0.0';

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const EVM_WORD = /^0x[0-9a-fA-F]{64}$/;

const TOKEN_HISTORY_SQD_CAPABILITIES: ProviderCapability[] = [
  'BLOCK',
  'LOG',
  'TRACE',
  'TRANSACTION',
];
const TOKEN_HISTORY_EXACT_RPC_CAPABILITIES: ProviderCapability[] = [
  'BLOCK',
  'RECEIPT',
  'TRANSACTION',
];

export type TokenHistoryDiscoveryErrorCode =
  | 'TOKEN_HISTORY_INVALID_INPUT'
  | 'TOKEN_HISTORY_REPLAY_UNAVAILABLE'
  | 'TOKEN_HISTORY_REPORT_CONFLICT';

export class TokenHistoryDiscoveryError extends Error {
  readonly code: TokenHistoryDiscoveryErrorCode;

  constructor(code: TokenHistoryDiscoveryErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'TokenHistoryDiscoveryError';
    this.code = code;
  }
}

export interface TokenHistoryExactReader {
  readonly sourceId?: string;
  /** Endpoint IDs participating in an explicit independent-provider comparison. */
  readonly sourceIds?: readonly string[];
  readonly capabilities?: readonly ProviderCapability[];
  diagnostics?(): TransportDiagnostics | undefined;
  getTransactionObservation(
    hash: string,
  ): Promise<TransportObservation<EvmTransactionRecord | null>>;
  getTransactionReceiptObservation(
    hash: string,
  ): Promise<TransportObservation<EvmTransactionReceiptRecord | null>>;
  readAnchorAt?(position: string): Promise<{ snapshot: AnalysisSnapshot }>;
}

function providerCapabilityDeclarations(
  options: TokenHistoryDiscoveryOptions,
): TokenHistoryProviderCapabilityDeclaration[] {
  const chainId = `eip155:${options.source.chainId}`;
  const sqdId = `sqd:${options.source.dataset}`;
  const requestedExactId = options.exactReader?.sourceId ?? `exact-rpc:${chainId}`;
  const configuredExactIds =
    options.exactReader?.sourceIds !== undefined && options.exactReader.sourceIds.length > 0
      ? options.exactReader.sourceIds
      : [requestedExactId];
  const exactIds = [...new Set(configuredExactIds)].map((id) =>
    id === sqdId ? `exact:${id}` : id,
  );
  const exactCapabilities =
    options.exactReader?.capabilities === undefined || options.exactReader.capabilities.length === 0
      ? TOKEN_HISTORY_EXACT_RPC_CAPABILITIES
      : [...options.exactReader.capabilities];
  const registry = new ProviderCapabilityRegistry([
    {
      id: sqdId,
      ledger: 'EVM',
      chainId,
      capabilities: TOKEN_HISTORY_SQD_CAPABILITIES,
      configured: true,
      version: SQD_INGESTION_VERSION,
    },
    ...exactIds.map((id) => ({
      id,
      ledger: 'EVM' as const,
      chainId,
      capabilities: exactCapabilities,
      configured: options.exactReader !== undefined,
      version: TOKEN_HISTORY_EXACT_RPC_ADAPTER_VERSION,
    })),
  ]);
  return registry.declarations().map((declaration) => ({
    id: declaration.id,
    ledger: 'EVM' as const,
    chainId: declaration.chainId,
    capabilities: [...declaration.capabilities],
    configured: declaration.configured,
    version: declaration.version,
  }));
}

export interface TokenHistoryFactReader {
  listRange(input: {
    ledger: 'EVM';
    chainId: string;
    fromBlock: number;
    toBlock: number;
    limit?: number;
    offset?: number;
  }): Promise<readonly RawChainFact[]>;
}

export interface TokenHistoryEvidenceReader {
  get(id: string): Promise<EvidenceNode | undefined>;
}

export interface TokenHistoryReportStore {
  put(report: TokenHistoryDiscoveryReport): Promise<TokenHistoryDiscoveryReport>;
  get(id: string): Promise<TokenHistoryDiscoveryReport | undefined>;
}

export interface TokenHistoryActionSemanticsWriter {
  put(report: ActionSemanticsReport): Promise<unknown>;
}

export interface TokenHistoryDiscoveryOptions extends Pick<
  SqdFinalizedIngestionOptions,
  | 'checkpoints'
  | 'artifacts'
  | 'evidence'
  | 'facts'
  | 'checkpointBatchSize'
  | 'entityModelVersion'
  | 'labelSnapshot'
  | 'adapterVersion'
  | 'nowImplementation'
> {
  source: SqdFinalizedSource;
  token: string;
  fromBlock: number;
  toBlock: number;
  exactReader?: TokenHistoryExactReader;
  originReader?: EvmContractCreationReader & { readonly endpointId?: string };
  factReader?: TokenHistoryFactReader;
  evidenceReader?: TokenHistoryEvidenceReader;
  reportStore?: TokenHistoryReportStore;
  actionSemantics?: TokenHistoryActionSemanticsWriter;
  /**
   * A caller-owned retry identity used only when a terminal report contains unresolved exact
   * observations. The original bounded SQD report remains immutable; a successful rebind is a
   * separate report revision with its own Evidence closure.
   */
  recoveryRevision?: string;
}

export interface TokenHistoryDiscoveryResult {
  report: TokenHistoryDiscoveryReport;
  ingestion: SqdIngestionResult;
}

interface TokenGroup {
  transactionHash: string;
  facts: RawChainFact[];
}

interface EnrichmentResult {
  application: TokenFlowObservation['application'];
  binding: TokenHistoryActionBinding;
  actionSemanticsId?: string;
  artifact?: RawArtifactWriteResult;
  rpcLogEvidenceIds: string[];
  rpcAgreementEvidenceId?: string;
  rpcProviderEvidenceIds?: readonly string[];
  sourceId?: string;
  sourceIds?: readonly string[];
}

async function persistFacts(
  writer: TokenHistoryDiscoveryOptions['facts'],
  facts: readonly RawChainFact[],
): Promise<void> {
  if (facts.length === 0) return;
  if (writer.putMany !== undefined) {
    await writer.putMany(facts);
    return;
  }
  for (const fact of facts) await writer.put(fact);
}

function canonicalAddress(value: string, field: string): string {
  if (!EVM_ADDRESS.test(value)) {
    throw new TokenHistoryDiscoveryError('TOKEN_HISTORY_INVALID_INPUT', `${field} is invalid.`);
  }
  return value.toLowerCase();
}

function canonicalHash(value: string, field: string): string {
  if (!EVM_HASH.test(value)) {
    throw new TokenHistoryDiscoveryError('TOKEN_HISTORY_INVALID_INPUT', `${field} is invalid.`);
  }
  return value.toLowerCase();
}

function decimal(value: unknown, field: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TokenHistoryDiscoveryError(
        'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
        `${field} is not a safe unsigned integer.`,
      );
    }
    return String(value);
  }
  if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) return value;
  throw new TokenHistoryDiscoveryError(
    'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
    `${field} is not an unsigned decimal value.`,
  );
}

function object(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      `${field} is not a JSON object.`,
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      `${field} is unavailable.`,
    );
  }
  return value;
}

function wordAddress(value: unknown, field: string): string {
  const word = stringValue(value, field);
  if (!EVM_WORD.test(word) || !/^0x0{24}[0-9a-fA-F]{40}$/.test(word)) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      `${field} is not a canonically padded EVM address.`,
    );
  }
  return `0x${word.slice(-40).toLowerCase()}`;
}

function wordAmount(value: unknown, field: string): string {
  const word = stringValue(value, field);
  if (!EVM_WORD.test(word)) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      `${field} is not one EVM uint256 word.`,
    );
  }
  return BigInt(word).toString();
}

function hexQuantityToDecimal(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      `${field} is not a hexadecimal quantity.`,
    );
  }
  return BigInt(value).toString();
}

function hexQuantityToNumber(value: string, field: string): number {
  const parsed = Number(hexQuantityToDecimal(value, field));
  if (!Number.isSafeInteger(parsed)) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      `${field} exceeds safe integer precision.`,
    );
  }
  return parsed;
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'ERROR';
  const value = (error as Record<string, unknown>).code;
  return typeof value === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(value) ? value : 'ERROR';
}

function safeErrorDetail(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : undefined;
  if (message === undefined) return undefined;
  const normalized = message
    .replace(/https?:\/\/[^\s/]+(?:\/[^\s]*)?/gi, '<provider>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return normalized === '' ? undefined : normalized;
}

function errorReason(error: unknown, prefix: string): string {
  const code = safeErrorCode(error);
  const detail = safeErrorDetail(error);
  return detail === undefined ? `${prefix}:${code}` : `${prefix}:${code}:${detail}`.slice(0, 320);
}

function exactSnapshot(
  snapshot: AnalysisSnapshot,
  sourceId: string,
  sourceIds: readonly string[] = [sourceId],
): AnalysisSnapshot {
  if (snapshot.ledger !== 'EVM') throw new Error('Exact token history Snapshot must be EVM.');
  const canonicalSourceIds = canonical([sourceId, ...sourceIds]);
  return AnalysisSnapshotSchema.parse({
    ...snapshot,
    chainId: snapshot.chainId.startsWith('eip155:')
      ? snapshot.chainId
      : `eip155:${snapshot.chainId}`,
    providerVersions: Object.fromEntries([
      ...Object.entries(snapshot.providerVersions),
      ...canonicalSourceIds.map((id) => [id, 'json-rpc']),
    ]),
    adapterVersions: {
      ...snapshot.adapterVersions,
      [TOKEN_HISTORY_EXACT_RPC_ADAPTER_VERSION]: '1.0.0',
    },
    // SQD and exact-RPC observations at the same block are two immutable Snapshot views. They
    // must not share the SQD query identity after exact-provider metadata is added, otherwise
    // PostgreSQL correctly rejects the second payload as a Snapshot conflict.
    configHash: hashPayload({
      schema: 'token-history-exact-snapshot-config-v1',
      baseConfigHash: snapshot.configHash,
      exactSources: canonicalSourceIds,
    }),
  });
}

function historySnapshot(snapshot: AnalysisSnapshot): AnalysisSnapshot {
  if (snapshot.ledger !== 'EVM') {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_INVALID_INPUT',
      'Token history requires an EVM Snapshot.',
    );
  }
  return AnalysisSnapshotSchema.parse({
    ...snapshot,
    chainId: snapshot.chainId.startsWith('eip155:')
      ? snapshot.chainId
      : `eip155:${snapshot.chainId}`,
  });
}

function observationId(content: Omit<TokenFlowObservation, 'id' | 'resultHash'>): string {
  return `tfo_${hashPayload({ schema: 'token-flow-observation-id-v1', content }).slice(0, 24)}`;
}

function observationResultHash(content: Omit<TokenFlowObservation, 'resultHash'>): string {
  return hashPayload({ schema: 'token-flow-observation-result-v1', content });
}

function createObservation(input: {
  token: string;
  fact: RawChainFact;
  snapshot: AnalysisSnapshot;
  application: TokenFlowObservation['application'];
  actionSemanticsIds: readonly string[];
  evidenceIds: readonly string[];
  rawArtifactRef?: string;
}): TokenFlowObservation {
  const payload = object(input.fact.payload, 'SQD EVM log payload');
  const topics = payload.topics;
  if (
    !Array.isArray(topics) ||
    topics.length !== 3 ||
    typeof topics[0] !== 'string' ||
    topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC
  ) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      'SQD returned a non-ERC-20 Transfer log for the token history query.',
    );
  }
  const address = canonicalAddress(stringValue(payload.address, 'log address'), 'log address');
  if (address !== input.token) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      'SQD returned a log outside the requested token address.',
    );
  }
  const from = wordAddress(topics[1], 'Transfer from topic');
  const to = wordAddress(topics[2], 'Transfer to topic');
  const amountRaw = wordAmount(payload.data, 'Transfer data');
  const kind = from === ZERO_ADDRESS ? 'MINT' : to === ZERO_ADDRESS ? 'BURN' : 'TRANSFER';
  const blockNumber = decimal(input.fact.blockOrSlot, 'block number');
  const blockHash = canonicalHash(input.fact.blockHash, 'block hash');
  const transactionHash = canonicalHash(
    stringValue(payload.transactionHash, 'transaction hash'),
    'transaction hash',
  );
  const content = {
    schemaVersion: 'token-flow-observation-v1' as const,
    ledger: 'EVM' as const,
    chainId: input.snapshot.chainId,
    token: input.token,
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex: decimal(payload.transactionIndex, 'transaction index'),
    logIndex: decimal(payload.logIndex, 'log index'),
    from,
    to,
    amountRaw,
    kind,
    application: input.application,
    finality: 'FINAL' as const,
    observedAt: input.fact.observedAt,
    snapshot: input.snapshot,
    actionSemanticsIds: canonical(input.actionSemanticsIds),
    evidenceIds: canonical(input.evidenceIds),
    ...(input.rawArtifactRef === undefined ? {} : { rawArtifactRef: input.rawArtifactRef }),
  } satisfies Omit<TokenFlowObservation, 'id' | 'resultHash'>;
  return TokenFlowObservationSchema.parse({
    ...content,
    id: observationId(content),
    resultHash: observationResultHash({
      ...content,
      id: observationId(content),
    }),
  });
}

function durableFactBelongsToRequestedToken(fact: RawChainFact, token: string): boolean {
  if (fact.factType !== 'LOG') return false;
  const payload = fact.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const address = payload.address;
  // Durable Raw Facts are shared across bounded captures. A resumed run therefore has to
  // re-apply the query's token predicate before replaying logs; validating the address shape
  // here excludes malformed/shared rows from the selected history facts, while createObservation
  // still validates every selected fact's topics, amount, transaction hash, and block identity.
  return (
    typeof address === 'string' && EVM_ADDRESS.test(address) && address.toLowerCase() === token
  );
}

function replayFactIdentity(fact: RawChainFact): string {
  return [fact.factType, fact.subject, fact.provider, fact.payloadHash].join('\u0000');
}

function canonicalReplayFacts(facts: readonly RawChainFact[]): RawChainFact[] {
  const selected = new Map<string, RawChainFact>();
  for (const fact of facts) {
    const identity = replayFactIdentity(fact);
    const current = selected.get(identity);
    if (current === undefined || fact.id.localeCompare(current.id) < 0) {
      selected.set(identity, fact);
    }
  }
  return [...selected.values()].sort((left, right) => {
    const position = Number(left.blockOrSlot) - Number(right.blockOrSlot);
    if (position !== 0) return position;
    return left.id.localeCompare(right.id);
  });
}

function isGenericSqdLogEvidence(evidence: Evidence): boolean {
  return evidence.kind === 'LOG' && evidence.locator.startsWith('evm-log:');
}

function createBinding(input: {
  transactionHash: string;
  status: TokenHistoryActionBinding['status'];
  evidenceIds: readonly string[];
  reason: string;
  actionSemanticsResultHash?: string;
}): TokenHistoryActionBinding {
  return TokenHistoryActionBindingSchema.parse({
    transactionHash: input.transactionHash,
    status: input.status,
    evidenceIds: canonical(input.evidenceIds),
    reason: input.reason,
    ...(input.actionSemanticsResultHash === undefined
      ? {}
      : { actionSemanticsResultHash: input.actionSemanticsResultHash }),
  });
}

function receiptApplication(
  receipt: EvmTransactionReceiptRecord | null,
): TokenFlowObservation['application'] {
  if (receipt === null || receipt.status === null) return 'UNKNOWN';
  return receipt.status === '0x1' ? 'SUCCESS' : 'FAILED';
}

function validateExactPlacement(
  transaction: EvmTransactionRecord,
  receipt: EvmTransactionReceiptRecord,
  block: SqdFinalizedBlock,
  transactionHash: string,
): void {
  const expectedBlock = String(block.header.number);
  const expectedHash = block.header.hash.toLowerCase();
  if (
    transaction.blockNumber !== `0x${block.header.number.toString(16)}` ||
    transaction.blockHash?.toLowerCase() !== expectedHash ||
    receipt.blockNumber !== `0x${block.header.number.toString(16)}` ||
    receipt.blockHash.toLowerCase() !== expectedHash ||
    receipt.transactionHash.toLowerCase() !== transactionHash
  ) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      `Exact RPC placement conflicts with SQD block ${expectedBlock}.`,
    );
  }
}

async function enrichTransaction(input: {
  group: TokenGroup;
  block: SqdFinalizedBlock;
  snapshot: AnalysisSnapshot;
  options: TokenHistoryDiscoveryOptions;
  evidenceById: Map<string, Evidence>;
  telemetry: { rpcRequests: number; rpcErrors: number; lastError?: string };
}): Promise<EnrichmentResult> {
  const evidenceIds = input.group.facts.map((fact) => fact.evidenceId);
  const exact = input.options.exactReader;
  if (exact === undefined) {
    return {
      application: 'UNKNOWN',
      binding: createBinding({
        transactionHash: input.group.transactionHash,
        status: 'UNKNOWN',
        evidenceIds,
        reason: 'EXACT_RPC_PROVIDER_UNCONFIGURED',
      }),
      rpcLogEvidenceIds: [],
    };
  }

  const transactionObservation = await exact.getTransactionObservation(input.group.transactionHash);
  input.telemetry.rpcRequests += 1;
  const receiptObservation = await exact.getTransactionReceiptObservation(
    input.group.transactionHash,
  );
  input.telemetry.rpcRequests += 1;
  const transaction = transactionObservation.value;
  const receipt = receiptObservation.value;
  const sourceId = exact.sourceId ?? transactionObservation.endpointId;
  const sourceIds = canonical([
    ...(transactionObservation.sourceIds ?? [transactionObservation.endpointId]),
    ...(receiptObservation.sourceIds ?? [receiptObservation.endpointId]),
  ]);
  const independentlyReconciled =
    (transactionObservation.sourceIds?.length ?? 0) >= 2 &&
    (receiptObservation.sourceIds?.length ?? 0) >= 2 &&
    canonical(transactionObservation.sourceIds ?? []).join('|') ===
      canonical(receiptObservation.sourceIds ?? []).join('|');
  if (transaction === null || receipt === null) {
    input.telemetry.rpcErrors += 1;
    input.telemetry.lastError = 'EXACT_RPC_TRANSACTION_OR_RECEIPT_UNAVAILABLE';
    return {
      application: 'UNKNOWN',
      binding: createBinding({
        transactionHash: input.group.transactionHash,
        status: 'UNAVAILABLE',
        evidenceIds,
        reason: 'EXACT_RPC_TRANSACTION_OR_RECEIPT_UNAVAILABLE',
      }),
      rpcLogEvidenceIds: [],
      sourceId,
      sourceIds,
    };
  }

  validateExactPlacement(transaction, receipt, input.block, input.group.transactionHash);
  const exactSnapshotView = exactSnapshot(input.snapshot, sourceId, sourceIds);
  const rawArtifactPayload = JsonValueSchema.parse({
    transaction: transaction.raw,
    receipt: receipt.raw,
    logs: input.group.facts.map((fact) => fact.payload),
  });
  const artifact = await input.options.artifacts.put({
    ledger: 'EVM',
    chainId: input.snapshot.chainId,
    blockOrSlot: String(input.block.header.number),
    provider: sourceId,
    capturedAt: input.snapshot.capturedAt,
    payload: rawArtifactPayload,
  });
  const transactionPayload = JsonValueSchema.parse({
    ...transaction.raw,
    value: hexQuantityToDecimal(transaction.value, 'transaction value'),
    transactionIndex: hexQuantityToNumber(
      transaction.transactionIndex ?? '0x0',
      'transaction index',
    ),
    status: receipt.status,
    receipt: receipt.raw,
  });
  const transactionEvidence = createEvidence({
    ledger: 'EVM',
    chainId: input.snapshot.chainId,
    kind: 'TRANSACTION',
    source: sourceId,
    locator: `token-history-transaction:${input.group.transactionHash}`,
    payload: transactionPayload,
    observedAt: input.snapshot.capturedAt,
    blockOrSlot: String(input.block.header.number),
    finality: 'finalized',
    rawArtifactRef: artifact.ref,
    summary: 'Exact read-only RPC transaction and receipt observation for token history.',
  });
  const transactionNode = await input.options.evidence.put(
    transactionEvidence,
    [],
    exactSnapshotView,
  );
  input.evidenceById.set(transactionNode.evidence.id, transactionNode.evidence);
  const transactionFact = createRawChainFact({
    ledger: 'EVM',
    chainId: input.snapshot.chainId,
    blockOrSlot: String(input.block.header.number),
    blockHash: input.block.header.hash,
    factType: 'TRANSACTION',
    subject: input.group.transactionHash,
    provider: sourceId,
    finality: 'finalized',
    payload: transactionPayload,
    evidenceId: transactionNode.evidence.id,
    rawArtifactRef: artifact.ref,
    observedAt: input.snapshot.capturedAt,
  });
  const rpcLogFacts: RawChainFact[] = [];
  const rpcLogEvidence: Evidence[] = [];
  for (const fact of input.group.facts) {
    const logEvidence = createEvidence({
      ledger: 'EVM',
      chainId: input.snapshot.chainId,
      kind: 'LOG',
      source: sourceId,
      locator: `token-history-rpc-log:${fact.subject}`,
      payload: fact.payload,
      observedAt: input.snapshot.capturedAt,
      blockOrSlot: String(input.block.header.number),
      finality: 'finalized',
      rawArtifactRef: artifact.ref,
      summary: 'Exact-provider token Transfer log bound to the finalized transaction receipt.',
    });
    const node = await input.options.evidence.put(logEvidence, [], exactSnapshotView);
    input.evidenceById.set(node.evidence.id, node.evidence);
    rpcLogEvidence.push(node.evidence);
    rpcLogFacts.push(
      createRawChainFact({
        ledger: 'EVM',
        chainId: input.snapshot.chainId,
        blockOrSlot: String(input.block.header.number),
        blockHash: input.block.header.hash,
        factType: 'LOG',
        subject: fact.subject,
        provider: sourceId,
        finality: 'finalized',
        payload: fact.payload,
        evidenceId: node.evidence.id,
        rawArtifactRef: artifact.ref,
        observedAt: input.snapshot.capturedAt,
      }),
    );
  }
  let rpcAgreementEvidenceId: string | undefined;
  let rpcProviderEvidenceIds: string[] = [];
  if (independentlyReconciled) {
    const providerAttestationEvidenceIds: string[] = [];
    for (const providerSourceId of sourceIds) {
      const providerAttestation = createEvidence({
        ledger: 'EVM',
        chainId: input.snapshot.chainId,
        kind: 'PROVIDER_OBSERVATION',
        source: providerSourceId,
        locator: `token-history-rpc-provider-attestation:${input.group.transactionHash}:${hashPayload(providerSourceId)}`,
        payload: {
          schemaVersion: 'token-history-rpc-provider-attestation-v1',
          transactionHash: input.group.transactionHash,
          sourceId: providerSourceId,
          transactionPayloadHash: hashPayload(transaction.raw),
          receiptPayloadHash: hashPayload(receipt.raw),
          status: 'AGREEMENT',
        },
        observedAt: input.snapshot.capturedAt,
        blockOrSlot: String(input.block.header.number),
        finality: 'finalized',
        summary:
          'Independent exact RPC provider participated in the matching transaction and receipt quorum.',
      });
      const providerNode = await input.options.evidence.put(
        providerAttestation,
        [],
        exactSnapshotView,
      );
      input.evidenceById.set(providerNode.evidence.id, providerNode.evidence);
      providerAttestationEvidenceIds.push(providerNode.evidence.id);
    }
    rpcProviderEvidenceIds = providerAttestationEvidenceIds.sort();
    const sourceEvidenceIds = [
      transactionNode.evidence.id,
      ...rpcLogEvidence.map((item) => item.id),
      ...rpcProviderEvidenceIds,
    ];
    const agreement = createEvidence({
      ledger: 'EVM',
      chainId: input.snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${TOKEN_HISTORY_SOURCE_RECONCILIATION_MODEL_VERSION}`,
      locator: `token-history-rpc-agreement:${input.group.transactionHash}:${hashPayload(sourceIds)}`,
      payload: {
        schemaVersion: 'token-history-source-reconciliation-v1',
        transactionHash: input.group.transactionHash,
        sourceIds,
        observations: [
          { kind: 'TRANSACTION', payloadHash: hashPayload(transaction.raw) },
          { kind: 'RECEIPT', payloadHash: hashPayload(receipt.raw) },
        ],
        status: 'AGREEMENT',
      },
      observedAt: input.snapshot.capturedAt,
      blockOrSlot: String(input.block.header.number),
      finality: 'finalized',
      summary:
        'Independent exact RPC providers returned matching transaction and receipt observations.',
      sourceEvidenceIds,
    });
    const node = await input.options.evidence.put(agreement, sourceEvidenceIds, exactSnapshotView);
    input.evidenceById.set(node.evidence.id, node.evidence);
    rpcAgreementEvidenceId = node.evidence.id;
  }
  await persistFacts(input.options.facts, [transactionFact, ...rpcLogFacts]);

  const report = buildActionSemanticsFromRawFacts({
    snapshot: exactSnapshotView,
    facts: [transactionFact, ...rpcLogFacts],
    evidence: [transactionNode.evidence, ...rpcLogEvidence],
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
  });
  const terminalEvidence = report.evidence.find((item) => item.id === report.terminalEvidenceId);
  if (terminalEvidence === undefined) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      'Action Semantics report is missing its terminal Evidence.',
    );
  }
  const terminalSourceEvidenceIds = [
    ...new Set(report.actions.flatMap((action) => action.evidenceIds)),
  ].sort();
  const terminalNode = await input.options.evidence.put(
    terminalEvidence,
    terminalSourceEvidenceIds,
    report.snapshot,
  );
  input.evidenceById.set(terminalNode.evidence.id, terminalNode.evidence);
  if (input.options.actionSemantics !== undefined) {
    await input.options.actionSemantics.put(report);
  }
  const actionId = actionSemanticsReportId(report.resultHash);
  return {
    application: receiptApplication(receipt),
    binding: createBinding({
      transactionHash: input.group.transactionHash,
      status: 'BOUND',
      evidenceIds: [
        ...report.metadata.evidenceIds,
        ...rpcProviderEvidenceIds,
        ...(rpcAgreementEvidenceId === undefined ? [] : [rpcAgreementEvidenceId]),
      ],
      actionSemanticsResultHash: report.resultHash,
      reason: 'EXACT_RPC_AND_ACTION_SEMANTICS_BOUND',
    }),
    actionSemanticsId: actionId,
    artifact,
    rpcLogEvidenceIds: rpcLogEvidence.map((item) => item.id),
    ...(rpcAgreementEvidenceId === undefined ? {} : { rpcAgreementEvidenceId }),
    ...(rpcProviderEvidenceIds.length === 0 ? {} : { rpcProviderEvidenceIds }),
    sourceId,
    sourceIds,
  };
}

function reportId(input: {
  chainId: string;
  token: string;
  fromBlock: number;
  toBlock: number;
  queryHash: string;
  recoveryRevision?: string;
}): string {
  const { recoveryRevision, ...identity } = input;
  return `thd_${hashPayload({
    schema: 'token-history-discovery-id-v1',
    ...identity,
    ...(recoveryRevision === undefined ? {} : { recoveryRevision }),
  }).slice(0, 24)}`;
}

function coverageRatio(fromBlock: number, toBlock: number, nextBlock: number | null): number {
  const requested = toBlock - fromBlock + 1;
  if (nextBlock === null || requested <= 0) return 0;
  return Math.max(0, Math.min(1, (Math.min(nextBlock, toBlock + 1) - fromBlock) / requested));
}

async function evidenceFor(
  id: string,
  current: Map<string, Evidence>,
  reader: TokenHistoryEvidenceReader | undefined,
): Promise<Evidence> {
  const inMemory = current.get(id);
  if (inMemory !== undefined) return inMemory;
  const stored = reader === undefined ? undefined : await reader.get(id);
  if (stored === undefined) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      `Evidence ${id} required for token-history replay is unavailable.`,
    );
  }
  current.set(id, stored.evidence);
  return stored.evidence;
}

async function snapshotForBlock(input: {
  blockNumber: number;
  current: Map<number, AnalysisSnapshot>;
  exactReader: TokenHistoryExactReader | undefined;
  blockEvidenceIds?: Map<number, string>;
  evidenceReader: TokenHistoryEvidenceReader | undefined;
}): Promise<AnalysisSnapshot | undefined> {
  const current = input.current.get(input.blockNumber);
  if (current !== undefined) return current;
  const blockEvidenceId = input.blockEvidenceIds?.get(input.blockNumber);
  if (blockEvidenceId !== undefined && input.evidenceReader !== undefined) {
    const node = await input.evidenceReader.get(blockEvidenceId);
    if (node?.snapshot !== undefined) return AnalysisSnapshotSchema.parse(node.snapshot);
  }
  if (input.exactReader?.readAnchorAt === undefined) return undefined;
  return AnalysisSnapshotSchema.parse(
    (await input.exactReader.readAnchorAt(String(input.blockNumber))).snapshot,
  );
}

async function discoverOrigin(input: {
  token: string;
  fromBlock: number;
  toBlock: number;
  reader: (EvmContractCreationReader & { readonly endpointId?: string }) | undefined;
  exactReader: TokenHistoryExactReader | undefined;
  options: TokenHistoryDiscoveryOptions;
  snapshots: Map<number, AnalysisSnapshot>;
  blockEvidenceIds: Map<number, string>;
  evidenceById: Map<string, Evidence>;
  evidenceReader: TokenHistoryEvidenceReader | undefined;
}): Promise<{ value: KnowledgeValue<TokenOrigin>; sourceId?: string }> {
  if (input.reader === undefined) {
    return {
      value: unknownValue('NOT_QUERIED', 'Token deployment origin reader is not configured.'),
    };
  }
  try {
    const result = await input.reader.getContractCreationsObservation({
      address: input.token,
      fromBlock: String(input.fromBlock),
      toBlock: String(input.toBlock),
    });
    if (result.value.length === 0) {
      return {
        value: unknownValue(
          'NOT_QUERIED',
          'No deployment creation was observed in the requested range; deployment may precede it.',
        ),
        sourceId: result.endpointId,
      };
    }
    const creations = [...result.value].sort((left, right) => {
      const blockOrder = Number(left.blockNumber) - Number(right.blockNumber);
      return blockOrder !== 0 ? blockOrder : left.traceAddress.length - right.traceAddress.length;
    });
    const creation = creations[0] as EvmContractCreationRecord;
    const blockNumber = Number(creation.blockNumber);
    const snapshot = await snapshotForBlock({
      blockNumber,
      current: input.snapshots,
      exactReader: input.exactReader,
      blockEvidenceIds: input.blockEvidenceIds,
      evidenceReader: input.evidenceReader,
    });
    if (snapshot === undefined) {
      return {
        value: unavailableValue(
          'INSUFFICIENT_DATA',
          'Deployment was observed but its exact finalized block Snapshot is unavailable.',
        ),
        sourceId: result.endpointId,
      };
    }
    const historyBlockSnapshot = historySnapshot(snapshot);
    const payload = JsonValueSchema.parse(creation.raw);
    const artifact = await input.options.artifacts.put({
      ledger: 'EVM',
      chainId: historyBlockSnapshot.chainId,
      blockOrSlot: String(blockNumber),
      provider: result.endpointId,
      capturedAt: historyBlockSnapshot.capturedAt,
      payload,
    });
    const evidence = createEvidence({
      ledger: 'EVM',
      chainId: historyBlockSnapshot.chainId,
      kind: 'TRACE',
      source: result.endpointId,
      locator: `token-origin:${input.token}:${creation.transactionHash}`,
      payload,
      observedAt: historyBlockSnapshot.capturedAt,
      blockOrSlot: String(blockNumber),
      finality: 'finalized',
      rawArtifactRef: artifact.ref,
      summary: 'SQD finalized contract-creation trace for the token deployment origin.',
    });
    const node = await input.options.evidence.put(evidence, [], historyBlockSnapshot);
    input.evidenceById.set(node.evidence.id, node.evidence);
    await input.options.facts.put(
      createRawChainFact({
        ledger: 'EVM',
        chainId: historyBlockSnapshot.chainId,
        blockOrSlot: String(blockNumber),
        blockHash: creation.blockHash,
        factType: 'TRACE',
        subject: creation.transactionHash,
        provider: result.endpointId,
        finality: 'finalized',
        payload,
        evidenceId: node.evidence.id,
        rawArtifactRef: artifact.ref,
        observedAt: historyBlockSnapshot.capturedAt,
      }),
    );
    const content = {
      schemaVersion: 'token-origin-v1' as const,
      token: input.token,
      creator: canonicalAddress(creation.creator, 'token origin creator'),
      deploymentTransactionHash: canonicalHash(
        creation.transactionHash,
        'token origin deployment transaction hash',
      ),
      deploymentBlockNumber: String(blockNumber),
      deploymentBlockHash: canonicalHash(creation.blockHash, 'token origin deployment block hash'),
      bytecodeHash: hashPayload(creation.bytecode),
      source: result.endpointId,
      evidenceIds: [node.evidence.id],
      snapshot: historyBlockSnapshot,
    } satisfies Omit<TokenOrigin, 'resultHash'>;
    const origin = TokenOriginSchema.parse({
      ...content,
      resultHash: hashPayload({ schema: 'token-origin-result-v1', content }),
    });
    return { value: knownValue(origin), sourceId: result.endpointId };
  } catch (error) {
    return {
      value: unavailableValue('PROVIDER_DOWN', errorReason(error, 'TOKEN_ORIGIN_PROVIDER')),
      sourceId: input.reader.endpointId ?? 'sqd:contract-creation',
    };
  }
}

async function buildTokenHistoryReport(input: {
  options: TokenHistoryDiscoveryOptions;
  run: IngestionRun;
  resumedFrom: number;
  sourceSummary: SqdStreamSummary | null;
  collectedFacts: Map<string, RawChainFact>;
  snapshots: Map<number, AnalysisSnapshot>;
  blockEvidenceIds: Map<number, string>;
  evidenceById: Map<string, Evidence>;
  recoveryRevision?: string;
}): Promise<TokenHistoryDiscoveryReport> {
  const { options, run, resumedFrom, sourceSummary, snapshots, blockEvidenceIds, evidenceById } =
    input;
  const queryHash = run.queryHash;
  const id = reportId({
    chainId: `eip155:${options.source.chainId}`,
    token: options.token,
    fromBlock: options.fromBlock,
    toBlock: options.toBlock,
    queryHash,
    ...(input.recoveryRevision === undefined ? {} : { recoveryRevision: input.recoveryRevision }),
  });

  let logFacts = [...input.collectedFacts.values()];
  if (options.factReader !== undefined && resumedFrom > options.fromBlock) {
    const durable: RawChainFact[] = [];
    const pageSize = 10_000;
    let offset = 0;
    for (;;) {
      const page = await options.factReader.listRange({
        ledger: 'EVM',
        chainId: `eip155:${options.source.chainId.replace(/^eip155:/, '')}`,
        fromBlock: options.fromBlock,
        toBlock: options.toBlock,
        limit: pageSize,
        offset,
      });
      durable.push(...page);
      if (page.length < pageSize) break;
      offset += page.length;
      if (offset > 10_000_000) {
        throw new TokenHistoryDiscoveryError(
          'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
          'Durable Raw Fact replay exceeded the bounded pagination limit.',
        );
      }
    }
    const canonicalDurable = canonicalReplayFacts(durable);
    const replayFacts: RawChainFact[] = [];
    for (const fact of canonicalDurable) {
      if (
        fact.provider !== `sqd:${options.source.dataset}` ||
        !durableFactBelongsToRequestedToken(fact, options.token)
      ) {
        continue;
      }
      // Funding/Settlement candidate expansion deliberately shares the Raw Fact store with the
      // token-history query, but its Evidence uses token-history-candidate-log:* locators. Only
      // generic evm-log:* nodes belong to the original SQD token-history request.
      const evidence = await evidenceFor(fact.evidenceId, evidenceById, options.evidenceReader);
      if (isGenericSqdLogEvidence(evidence)) replayFacts.push(fact);
    }
    logFacts = replayFacts;
    for (const fact of canonicalDurable) {
      if (fact.factType === 'BLOCK' && fact.provider === `sqd:${options.source.dataset}`) {
        blockEvidenceIds.set(Number(fact.blockOrSlot), fact.evidenceId);
      }
    }
  } else if (resumedFrom > options.fromBlock) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      'A resumed token history run requires a durable Raw Fact reader to reconstruct prior blocks.',
    );
  }
  logFacts = [...new Map(logFacts.map((fact) => [fact.id, fact])).values()].sort((left, right) => {
    const blockOrder = Number(left.blockOrSlot) - Number(right.blockOrSlot);
    return blockOrder !== 0 ? blockOrder : left.subject.localeCompare(right.subject);
  });
  for (const fact of logFacts)
    await evidenceFor(fact.evidenceId, evidenceById, options.evidenceReader);

  const observations: TokenFlowObservation[] = [];
  const bindings = new Map<string, TokenHistoryActionBinding>();
  const sourceSet = new Set<string>([`sqd:${options.source.dataset}`]);
  const telemetry: { rpcRequests: number; rpcErrors: number; lastError?: string } = {
    rpcRequests: 0,
    rpcErrors: 0,
  };
  const groups = new Map<string, TokenGroup>();
  for (const fact of logFacts) {
    const payload = object(fact.payload, 'SQD log payload');
    const transactionHash = canonicalHash(
      stringValue(payload.transactionHash, 'transaction hash'),
      'transaction hash',
    );
    const group = groups.get(transactionHash) ?? { transactionHash, facts: [] };
    group.facts.push(fact);
    groups.set(transactionHash, group);
  }
  for (const group of groups.values()) {
    const first = group.facts[0] as RawChainFact;
    const blockNumber = Number(first.blockOrSlot);
    const rawSnapshot = await snapshotForBlock({
      blockNumber,
      current: snapshots,
      exactReader: options.exactReader,
      blockEvidenceIds,
      evidenceReader: options.evidenceReader,
    });
    if (rawSnapshot === undefined) {
      throw new TokenHistoryDiscoveryError(
        'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
        `Finalized Snapshot for token history block ${blockNumber} is unavailable.`,
      );
    }
    const snapshot = historySnapshot(rawSnapshot);
    const block: SqdFinalizedBlock = {
      header: {
        number: blockNumber,
        hash: first.blockHash,
        parentHash: `0x${'0'.repeat(64)}`,
        timestamp: null,
      },
    };
    let enrichment: EnrichmentResult;
    try {
      enrichment = await enrichTransaction({
        group,
        block,
        snapshot,
        options,
        evidenceById,
        telemetry,
      });
    } catch (error) {
      telemetry.rpcErrors += 1;
      telemetry.lastError = errorReason(error, 'EXACT_RPC_CONFLICT');
      enrichment = {
        application: 'UNKNOWN',
        binding: createBinding({
          transactionHash: group.transactionHash,
          status: 'UNAVAILABLE',
          evidenceIds: group.facts.map((fact) => fact.evidenceId),
          reason: errorReason(error, 'EXACT_RPC_CONFLICT'),
        }),
        rpcLogEvidenceIds: [],
      };
    }
    if (enrichment.sourceId !== undefined) sourceSet.add(enrichment.sourceId);
    for (const sourceId of enrichment.sourceIds ?? []) sourceSet.add(sourceId);
    bindings.set(group.transactionHash, enrichment.binding);
    for (const fact of group.facts) {
      const actionIds =
        enrichment.actionSemanticsId === undefined ? [] : [enrichment.actionSemanticsId];
      const evidenceIds = [
        fact.evidenceId,
        ...enrichment.rpcLogEvidenceIds,
        ...(enrichment.rpcProviderEvidenceIds ?? []),
        ...(enrichment.rpcAgreementEvidenceId === undefined
          ? []
          : [enrichment.rpcAgreementEvidenceId]),
      ];
      observations.push(
        createObservation({
          token: options.token,
          fact,
          snapshot,
          application: enrichment.application,
          actionSemanticsIds: actionIds,
          evidenceIds,
          rawArtifactRef: enrichment.artifact?.ref ?? fact.rawArtifactRef,
        }),
      );
    }
  }

  const origin = await discoverOrigin({
    token: options.token,
    fromBlock: options.fromBlock,
    toBlock: options.toBlock,
    reader: options.originReader,
    exactReader: options.exactReader,
    options,
    snapshots,
    blockEvidenceIds,
    evidenceById,
    evidenceReader: options.evidenceReader,
  });
  if (origin.sourceId !== undefined) sourceSet.add(origin.sourceId);
  const lastObservedBlock = run.lastBlock;
  const completion: TokenHistoryDiscoveryReport['status'] =
    sourceSummary?.completion === 'SOURCE_HEAD_REACHED' || run.status === 'SOURCE_HEAD_REACHED'
      ? 'SOURCE_HEAD_REACHED'
      : 'COMPLETE';
  const finalBlock =
    completion === 'SOURCE_HEAD_REACHED'
      ? (sourceSummary?.lastBlock ??
        Math.max(options.fromBlock, (sourceSummary?.nextBlock ?? 1) - 1))
      : options.toBlock;
  const rawFinalSnapshot = await snapshotForBlock({
    blockNumber: finalBlock,
    current: snapshots,
    exactReader: options.exactReader,
    blockEvidenceIds,
    evidenceReader: options.evidenceReader,
  });
  if (rawFinalSnapshot === undefined) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
      'The completed token history range has no exact final Snapshot.',
    );
  }
  const finalSnapshot = historySnapshot(rawFinalSnapshot);
  if (finalSnapshot.ledger !== 'EVM') {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_INVALID_INPUT',
      'Token history final Snapshot must be EVM.',
    );
  }
  const coveragePayload = JsonValueSchema.parse({
    schemaVersion: 'token-history-range-coverage-v1',
    dataset: options.source.dataset,
    requestedFrom: String(options.fromBlock),
    requestedTo: String(options.toBlock),
    nextBlock: String(sourceSummary?.nextBlock ?? run.nextBlock),
    lastObservedBlock: lastObservedBlock === null ? null : String(lastObservedBlock),
    finalizedHead: sourceSummary?.finalizedHead ?? null,
    completion,
    queryHash,
  });
  const coverageArtifact = await options.artifacts.put({
    ledger: 'EVM',
    chainId: finalSnapshot.chainId,
    blockOrSlot: finalSnapshot.blockNumber,
    provider: `sqd:${options.source.dataset}`,
    capturedAt: finalSnapshot.capturedAt,
    payload: coveragePayload,
  });
  const coverageNode = await options.evidence.put(
    createEvidence({
      ledger: 'EVM',
      chainId: finalSnapshot.chainId,
      kind: 'PROVIDER_OBSERVATION',
      source: `sqd:${options.source.dataset}`,
      locator: `token-history-range:${options.token}:${options.fromBlock}-${options.toBlock}`,
      payload: coveragePayload,
      blockOrSlot: finalSnapshot.blockNumber,
      finality: finalSnapshot.finality,
      observedAt: finalSnapshot.capturedAt,
      rawArtifactRef: coverageArtifact.ref,
      summary: 'SQD finalized token-history range coverage reached the recorded cursor.',
    }),
    [],
    finalSnapshot,
  );
  evidenceById.set(coverageNode.evidence.id, coverageNode.evidence);
  const rangeEvidenceIds = canonical(
    [
      coverageNode.evidence.id,
      blockEvidenceIds.get(options.fromBlock),
      blockEvidenceIds.get(lastObservedBlock as number),
    ].filter((value): value is string => value !== undefined),
  );
  const sortedObservations = observations.sort((left, right) => {
    const blockOrder = Number(left.blockNumber) - Number(right.blockNumber);
    if (blockOrder !== 0) return blockOrder;
    const transactionOrder = Number(left.transactionIndex) - Number(right.transactionIndex);
    if (transactionOrder !== 0) return transactionOrder;
    return Number(left.logIndex) - Number(right.logIndex);
  });
  const sortedBindings = [...bindings.values()].sort((left, right) =>
    left.transactionHash.localeCompare(right.transactionHash),
  );
  const evidenceIds = canonical([
    ...rangeEvidenceIds,
    ...sortedObservations.flatMap((item) => item.evidenceIds),
    ...sortedBindings.flatMap((item) => item.evidenceIds),
    ...(origin.value.state === 'known' ? origin.value.value.evidenceIds : []),
  ]);
  const checkpointStatus =
    completion === 'SOURCE_HEAD_REACHED' ? 'SOURCE_HEAD_REACHED' : 'REQUESTED_RANGE_COMPLETE';
  const rpcDiagnostics = options.exactReader?.diagnostics?.();
  const reportCore = {
    schemaVersion: 'token-history-discovery-v1' as const,
    id,
    ledger: 'EVM' as const,
    chainId: `eip155:${options.source.chainId}`,
    token: options.token,
    fromBlock: String(options.fromBlock),
    toBlock: String(options.toBlock),
    status: completion,
    origin: origin.value,
    observations: sortedObservations,
    relevantTransactionHashes: canonical(sortedObservations.map((item) => item.transactionHash)),
    actionSemanticsBindings: sortedBindings,
    sourceHead:
      sourceSummary?.finalizedHead === null || sourceSummary?.finalizedHead === undefined
        ? unknownValue('NOT_QUERIED', 'SQD did not return a trusted finalized head.')
        : knownValue(String(sourceSummary.finalizedHead)),
    checkpoint: {
      runId: run.id,
      nextBlock: String(sourceSummary?.nextBlock ?? run.nextBlock),
      status: checkpointStatus,
      lastBlock: String(finalBlock),
      finalizedHead:
        sourceSummary?.finalizedHead === null || sourceSummary?.finalizedHead === undefined
          ? null
          : String(sourceSummary.finalizedHead),
      queryHash,
    },
    providerTelemetry: {
      requests: sourceSummary?.requests ?? 0,
      retries: sourceSummary?.retries ?? 0,
      rateLimitEvents: sourceSummary?.rateLimitEvents ?? 0,
      rangeAdjustments: sourceSummary?.rangeAdjustments ?? 0,
      ...(telemetry.rpcErrors === 0
        ? {}
        : {
            lastProviderError: telemetry.lastError ?? `EXACT_RPC_ERRORS:${telemetry.rpcErrors}`,
          }),
      ...(rpcDiagnostics === undefined ? {} : { rpcDiagnostics }),
    },
    providerCapabilityDeclarations: providerCapabilityDeclarations(options),
    snapshot: finalSnapshot,
    rangeEvidenceIds,
    dataCoverage: coverageRatio(
      options.fromBlock,
      options.toBlock,
      sourceSummary?.nextBlock ?? run.nextBlock,
    ),
    sourceCoverage: coverageRatio(
      options.fromBlock,
      options.toBlock,
      sourceSummary?.nextBlock ?? run.nextBlock,
    ),
    historyCoverage: coverageRatio(
      options.fromBlock,
      options.toBlock,
      sourceSummary?.nextBlock ?? run.nextBlock,
    ),
    freshness: finalSnapshot.capturedAt,
    sourceSet: canonical([...sourceSet]),
    modelVersion: TOKEN_HISTORY_DISCOVERY_MODEL_VERSION,
    policyVersion: TOKEN_HISTORY_DISCOVERY_POLICY_VERSION,
    evidenceIds,
  };
  const report = TokenHistoryDiscoveryReportSchema.parse({
    ...reportCore,
    resultHash: hashPayload({ schema: 'token-history-discovery-result-v1', reportCore }),
  });
  if (options.reportStore === undefined) return report;
  const stored = await options.reportStore.put(report);
  if (stored.resultHash !== report.resultHash) {
    throw new TokenHistoryDiscoveryError(
      'TOKEN_HISTORY_REPORT_CONFLICT',
      'Durable token history report conflicts with the canonical result.',
    );
  }
  return stored;
}

export function tokenHistoryDiscoveryRequest(input: {
  token: string;
  fromBlock: number;
  toBlock: number;
}): SqdFinalizedRangeRequest {
  return {
    fromBlock: input.fromBlock,
    toBlock: input.toBlock,
    includeAllBlocks: false,
    fields: {
      block: { timestamp: true },
      log: {
        logIndex: true,
        transactionIndex: true,
        transactionHash: true,
        address: true,
        topics: true,
        data: true,
      },
    },
    requests: {
      logs: [{ address: [canonicalAddress(input.token, 'token')], topic0: [ERC20_TRANSFER_TOPIC] }],
    },
  };
}

export class TokenHistoryDiscovery {
  readonly #options: TokenHistoryDiscoveryOptions;

  constructor(options: TokenHistoryDiscoveryOptions) {
    if (options.source.ledger !== 'EVM') {
      throw new TokenHistoryDiscoveryError(
        'TOKEN_HISTORY_INVALID_INPUT',
        'Token history requires an EVM SQD source.',
      );
    }
    if (!Number.isSafeInteger(options.fromBlock) || options.fromBlock < 0) {
      throw new TokenHistoryDiscoveryError('TOKEN_HISTORY_INVALID_INPUT', 'fromBlock is invalid.');
    }
    if (!Number.isSafeInteger(options.toBlock) || options.toBlock < options.fromBlock) {
      throw new TokenHistoryDiscoveryError('TOKEN_HISTORY_INVALID_INPUT', 'toBlock is invalid.');
    }
    this.#options = { ...options, token: canonicalAddress(options.token, 'token') };
  }

  async run(): Promise<TokenHistoryDiscoveryResult> {
    const options = this.#options;
    const request = tokenHistoryDiscoveryRequest({
      token: options.token,
      fromBlock: options.fromBlock,
      toBlock: options.toBlock,
    });
    const collectedFacts = new Map<string, RawChainFact>();
    const snapshots = new Map<number, AnalysisSnapshot>();
    const blockEvidenceIds = new Map<number, string>();
    const evidenceById = new Map<string, Evidence>();
    let pendingReport: TokenHistoryDiscoveryReport | undefined;
    const ingestion = new SqdFinalizedIngestionPipeline({
      ...options,
      // Token History must be restartable inside dense historical ranges. The generic ingestion
      // worker keeps its larger write batch, while this bounded semantic path advances the
      // durable cursor after at most 50 materialized event blocks.
      checkpointBatchSize: options.checkpointBatchSize ?? 50,
      onBlockMaterialized: async ({ block, snapshot, facts, evidence }) => {
        snapshots.set(block.header.number, snapshot);
        const blockFact = facts.find((fact) => fact.factType === 'BLOCK');
        if (blockFact !== undefined)
          blockEvidenceIds.set(block.header.number, blockFact.evidenceId);
        for (const item of evidence) evidenceById.set(item.id, item);
        for (const fact of facts) {
          if (fact.factType === 'LOG' && fact.provider === `sqd:${options.source.dataset}`) {
            collectedFacts.set(fact.id, fact);
          }
        }
      },
      onBeforeFinish: async ({ run, resumedFrom, sourceSummary }) => {
        pendingReport = await buildTokenHistoryReport({
          options,
          run,
          resumedFrom,
          sourceSummary,
          collectedFacts,
          snapshots,
          blockEvidenceIds,
          evidenceById,
        });
      },
    });
    const result = await ingestion.run(request);
    const queryHash = result.run.queryHash;
    const id = reportId({
      chainId: `eip155:${options.source.chainId}`,
      token: options.token,
      fromBlock: options.fromBlock,
      toBlock: options.toBlock,
      queryHash,
    });
    if (result.alreadyTerminal) {
      const existing =
        options.reportStore === undefined ? undefined : await options.reportStore.get(id);
      if (existing === undefined) {
        throw new TokenHistoryDiscoveryError(
          'TOKEN_HISTORY_REPLAY_UNAVAILABLE',
          `Completed token history run ${id} has no durable report for replay.`,
        );
      }
      const recoveryRevision = options.recoveryRevision;
      const needsExactRecovery =
        recoveryRevision !== undefined &&
        recoveryRevision.trim() !== '' &&
        options.exactReader !== undefined &&
        (existing.actionSemanticsBindings.some((binding) => binding.status !== 'BOUND') ||
          // A strict quorum report may already have BOUND action semantics while predating the
          // provider-level attestation Evidence required by the durable capture source guard.
          // Rebuild that immutable report revision from the durable SQD Facts so the exact
          // observations and their provider provenance are closed together.
          (options.exactReader.sourceIds?.length ?? 0) >= 2);
      if (needsExactRecovery) {
        // The ingestion cursor is already terminal, but a transient exact-provider or durable
        // Evidence failure may have left the immutable first report with UNAVAILABLE bindings.
        // Reconstruct from the durable SQD Facts and write a revision instead of returning the
        // stale negative result or attempting to mutate the original report.
        const recovered = await buildTokenHistoryReport({
          options,
          run: result.run,
          resumedFrom: result.resumedFrom,
          sourceSummary: null,
          collectedFacts,
          snapshots,
          blockEvidenceIds,
          evidenceById,
          recoveryRevision,
        });
        return { report: recovered, ingestion: result };
      }
      return { report: TokenHistoryDiscoveryReportSchema.parse(existing), ingestion: result };
    }
    if (pendingReport !== undefined) return { report: pendingReport, ingestion: result };
    const report = await buildTokenHistoryReport({
      options,
      run: result.run,
      resumedFrom: result.resumedFrom,
      sourceSummary: result.sourceSummary,
      collectedFacts,
      snapshots,
      blockEvidenceIds,
      evidenceById,
    });
    return { report, ingestion: result };
  }
}
