import {
  ProviderError,
  type EvmLogReader,
  type EvmLogRecord,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import type { CustodyObservation } from '@zerotrace/claim-audit';
import { canonicalJson, createEvidence } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  EvmSnapshotSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type ChainAnchorRead,
  type Evidence,
  type EvmClaimTransferObservation,
} from '@zerotrace/schemas';
import { decodeFunctionResult, encodeFunctionData } from 'viem';
import type { z } from 'zod';

type EvmSnapshot = z.infer<typeof EvmSnapshotSchema>;

export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const SAFE_COMPATIBLE_READ_MODEL_VERSION = 'safe-compatible-read-v1.1.0';
export const ERC20_CLAIM_TRANSFER_MODEL_VERSION = 'erc20-claim-transfer-v1.0.0';

export const OFFICIAL_SAFE_IMPLEMENTATIONS = [
  {
    address: '0x3e5c63644e683549055b9be8653de26e0b4cd36e',
    version: '1.3.0',
    variant: 'GnosisSafeL2',
    source: 'https://github.com/safe-fndn/safe-smart-account/blob/v1.3.0/CHANGELOG.md',
    sourceRevision: '186a21a74b327f17fc41217a927dea7064f74604',
  },
] as const;

export interface SafeImplementationDescriptor {
  address: string;
  version: string;
  variant: string;
  source: string;
  sourceRevision: string;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_WORD = /^0x[0-9a-fA-F]{64}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

const safeReadAbi = [
  {
    type: 'function',
    name: 'VERSION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nonce',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export interface EvmClaimReadAdapter {
  readonly sourceId: string;
  readonly config: { chainId: number };
  getCodeObservation(address: string, blockTag: string): Promise<TransportObservation<string>>;
  callObservation(
    to: string,
    data: string,
    blockTag: string,
  ): Promise<TransportObservation<string>>;
  readSourced<T>(
    method: string,
    params?: readonly unknown[],
    options?: TransportReadOptions,
  ): Promise<TransportObservation<T>>;
}

export interface EvmBlockAnchorReader {
  readAnchorAt(position: string): Promise<ChainAnchorRead>;
}

export interface EvmCustodyInspection {
  custody: CustodyObservation;
  evidence: Evidence[];
  metadata: AnalysisMetadata;
}

function observationMetadata(options: {
  snapshot: EvmSnapshot;
  sourceSet: Iterable<string>;
  evidence: readonly Evidence[];
  modelVersion: string;
  historyCoverage: number;
  confidence: number;
}): AnalysisMetadata {
  const sourceSet = [...new Set(options.sourceSet)].sort();
  return AnalysisMetadataSchema.parse({
    snapshot: options.snapshot,
    dataCoverage: 1,
    // This adapter performs one logical observation. Additional endpoint IDs may only provide
    // field-level failover or timestamp anchoring, not an independently repeated full result.
    sourceCoverage: 0.5,
    historyCoverage: options.historyCoverage,
    simulationCoverage: 0,
    freshness: options.snapshot.capturedAt,
    sourceSet,
    modelVersion: options.modelVersion,
    confidence: options.confidence,
    evidenceIds: [...new Set(options.evidence.map((item) => item.id))].sort(),
  });
}

function normalizeAddress(value: string, field: string): string {
  if (!EVM_ADDRESS.test(value)) throw new Error(`${field} must be an EVM address.`);
  return value.toLowerCase();
}

function requireWord(value: unknown, field: string): string {
  if (typeof value !== 'string' || !EVM_WORD.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `${field} must be one EVM word.`);
  }
  return value.toLowerCase();
}

function blockTag(snapshot: EvmSnapshot): string {
  return `0x${BigInt(snapshot.blockNumber).toString(16)}`;
}

function safeCallData(functionName: 'VERSION' | 'getOwners' | 'getThreshold' | 'nonce'): string {
  return encodeFunctionData({ abi: safeReadAbi, functionName });
}

function decodeSafeResult(
  functionName: 'VERSION' | 'getOwners' | 'getThreshold' | 'nonce',
  data: string,
): unknown {
  try {
    return decodeFunctionResult({ abi: safeReadAbi, functionName, data: data as `0x${string}` });
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', `Safe ${functionName} result is malformed.`, {
      cause: error,
    });
  }
}

function nonretryableCallFailure(error: unknown): boolean {
  return error instanceof ProviderError && error.code === 'RPC_ERROR' && !error.retryable;
}

function custodyEvidence(
  snapshot: EvmSnapshot,
  source: string,
  address: string,
  payload: unknown,
  summary: string,
  observedAt: string,
): Evidence {
  return createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'CONTRACT_STATE',
    source,
    locator: `evm-custody:${address}:${snapshot.blockNumber}`,
    payload,
    summary,
    observedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
  });
}

export async function inspectEvmCustody(options: {
  address: string;
  snapshot: EvmSnapshot;
  adapter: EvmClaimReadAdapter;
  safeImplementations?: readonly SafeImplementationDescriptor[] | undefined;
  now?: (() => string) | undefined;
}): Promise<EvmCustodyInspection> {
  const snapshot = EvmSnapshotSchema.parse(options.snapshot);
  if (snapshot.finality !== 'finalized') {
    throw new Error('Custody inspection requires a finalized EVM Snapshot.');
  }
  if (options.adapter.config.chainId !== Number(snapshot.chainId.slice('eip155:'.length))) {
    throw new Error('Custody adapter chain does not match the Snapshot.');
  }
  const address = normalizeAddress(options.address, 'custody address');
  const at = blockTag(snapshot);
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const codeObservation = await options.adapter.getCodeObservation(address, at);
  const sourceSet = new Set([codeObservation.endpointId]);
  const code = codeObservation.value.toLowerCase();

  if (code === '0x') {
    const evidence = custodyEvidence(
      snapshot,
      codeObservation.endpointId,
      address,
      { address, code, blockTag: at },
      'Address has no contract bytecode at the finalized Snapshot and is classified as an EOA.',
      observedAt,
    );
    return {
      custody: {
        address,
        kind: 'EOA',
        canMoveFunds: knownValue(true),
        evidenceIds: [evidence.id],
      },
      evidence: [evidence],
      metadata: observationMetadata({
        snapshot,
        sourceSet,
        evidence: [evidence],
        modelVersion: SAFE_COMPATIBLE_READ_MODEL_VERSION,
        historyCoverage: 0,
        confidence: 0.95,
      }),
    };
  }

  const singletonObservation = await options.adapter.readSourced<unknown>(
    'eth_getStorageAt',
    [address, '0x0', at],
    { cacheMode: 'bypass' },
  );
  sourceSet.add(singletonObservation.endpointId);
  const singletonWord = requireWord(singletonObservation.value, 'Safe singleton storage');
  const singleton = `0x${singletonWord.slice(-40)}`;
  const cleanSingletonWord = singletonWord.slice(2, 26) === '0'.repeat(24);

  let versionObservation: TransportObservation<string>;
  try {
    versionObservation = await options.adapter.callObservation(
      address,
      safeCallData('VERSION'),
      at,
    );
  } catch (error) {
    if (!nonretryableCallFailure(error)) throw error;
    const evidence = custodyEvidence(
      snapshot,
      singletonObservation.endpointId,
      address,
      { address, code, singletonWord, blockTag: at, versionCall: 'UNSUPPORTED' },
      'Contract bytecode is present, but the Safe-compatible VERSION read is unsupported.',
      observedAt,
    );
    return {
      custody: {
        address,
        kind: 'CONTRACT',
        canMoveFunds: unknownValue(
          'INSUFFICIENT_DATA',
          'Generic contract control requires a protocol-specific authority adapter.',
        ),
        evidenceIds: [evidence.id],
      },
      evidence: [evidence],
      metadata: observationMetadata({
        snapshot,
        sourceSet,
        evidence: [evidence],
        modelVersion: SAFE_COMPATIBLE_READ_MODEL_VERSION,
        historyCoverage: 0,
        confidence: 0.7,
      }),
    };
  }
  sourceSet.add(versionObservation.endpointId);
  if (!cleanSingletonWord || singleton === ZERO_ADDRESS) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Safe-compatible VERSION is present but proxy singleton storage is invalid.',
    );
  }
  const version = decodeSafeResult('VERSION', versionObservation.value);
  if (typeof version !== 'string' || version.length === 0 || version.length > 64) {
    throw new ProviderError('INVALID_RESPONSE', 'Safe VERSION is invalid.');
  }
  const implementationRegistry = options.safeImplementations ?? OFFICIAL_SAFE_IMPLEMENTATIONS;
  const implementations = new Map<string, SafeImplementationDescriptor>();
  for (const descriptor of implementationRegistry) {
    const implementationAddress = normalizeAddress(
      descriptor.address,
      'Safe implementation address',
    );
    if (
      descriptor.version.length === 0 ||
      descriptor.version.length > 64 ||
      descriptor.variant.length === 0 ||
      descriptor.source.length === 0 ||
      !/^[0-9a-f]{40}$/i.test(descriptor.sourceRevision)
    ) {
      throw new Error('Safe implementation descriptor is invalid.');
    }
    if (implementations.has(implementationAddress)) {
      throw new Error('Safe implementation registry contains duplicate addresses.');
    }
    implementations.set(implementationAddress, descriptor);
  }
  const implementation = implementations.get(singleton);
  if (implementation === undefined) {
    const evidence = custodyEvidence(
      snapshot,
      [...sourceSet].sort().join('+'),
      address,
      {
        address,
        code,
        singleton,
        singletonWord,
        version,
        versionCall: versionObservation.value,
        blockTag: at,
        implementationRegistry: [...implementations.keys()].sort(),
      },
      'Contract exposes Safe-compatible reads, but its implementation is not in the configured official registry.',
      observedAt,
    );
    return {
      custody: {
        address,
        kind: 'CONTRACT',
        canMoveFunds: unknownValue(
          'INSUFFICIENT_DATA',
          'Unregistered Safe-compatible implementation requires protocol-specific verification.',
        ),
        implementationAddress: singleton,
        implementationVersion: version,
        evidenceIds: [evidence.id],
      },
      evidence: [evidence],
      metadata: observationMetadata({
        snapshot,
        sourceSet,
        evidence: [evidence],
        modelVersion: SAFE_COMPATIBLE_READ_MODEL_VERSION,
        historyCoverage: 0,
        confidence: 0.7,
      }),
    };
  }
  if (implementation.version !== version) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Safe implementation version disagrees with the configured official registry.',
    );
  }
  const [ownersObservation, thresholdObservation, nonceObservation] = await Promise.all([
    options.adapter.callObservation(address, safeCallData('getOwners'), at),
    options.adapter.callObservation(address, safeCallData('getThreshold'), at),
    options.adapter.callObservation(address, safeCallData('nonce'), at),
  ]);
  sourceSet.add(ownersObservation.endpointId);
  sourceSet.add(thresholdObservation.endpointId);
  sourceSet.add(nonceObservation.endpointId);
  const rawOwners = decodeSafeResult('getOwners', ownersObservation.value);
  const rawThreshold = decodeSafeResult('getThreshold', thresholdObservation.value);
  const rawNonce = decodeSafeResult('nonce', nonceObservation.value);
  if (!Array.isArray(rawOwners) || rawOwners.length === 0 || rawOwners.length > 100) {
    throw new ProviderError('INVALID_RESPONSE', 'Safe owners are invalid or unbounded.');
  }
  const owners = rawOwners.map((owner) => normalizeAddress(String(owner), 'Safe owner'));
  if (new Set(owners).size !== owners.length) {
    throw new ProviderError('INVALID_RESPONSE', 'Safe owners contain duplicates.');
  }
  if (
    typeof rawThreshold !== 'bigint' ||
    rawThreshold < 1n ||
    rawThreshold > BigInt(owners.length)
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'Safe threshold is invalid for its owner set.');
  }
  if (typeof rawNonce !== 'bigint' || rawNonce < 0n || rawNonce > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProviderError('INVALID_RESPONSE', 'Safe nonce is outside the safe reporting range.');
  }
  const evidence = custodyEvidence(
    snapshot,
    [...sourceSet].sort().join('+'),
    address,
    {
      address,
      code,
      singleton,
      singletonWord,
      version,
      implementationDescriptor: implementation,
      owners,
      threshold: rawThreshold.toString(),
      nonce: rawNonce.toString(),
      blockTag: at,
      rawCallResults: {
        version: versionObservation.value,
        owners: ownersObservation.value,
        threshold: thresholdObservation.value,
        nonce: nonceObservation.value,
      },
    },
    `Safe-compatible ${rawThreshold.toString()}-of-${owners.length} custody is movable by its configured owners.`,
    observedAt,
  );
  return {
    custody: {
      address,
      kind: 'SAFE_MULTISIG',
      canMoveFunds: knownValue(true),
      threshold: Number(rawThreshold),
      ownerCount: owners.length,
      executedTransactions: Number(rawNonce),
      implementationAddress: singleton,
      implementationVersion: version,
      evidenceIds: [evidence.id],
    },
    evidence: [evidence],
    metadata: observationMetadata({
      snapshot,
      sourceSet,
      evidence: [evidence],
      modelVersion: SAFE_COMPATIBLE_READ_MODEL_VERSION,
      historyCoverage: 0,
      confidence: 0.98,
    }),
  };
}

export interface Erc20ClaimTransferCollection {
  tokenAddress: string;
  fromBlock: string;
  toBlock: string;
  transfers: EvmClaimTransferObservation[];
  evidence: Evidence[];
  metadata: AnalysisMetadata;
}

function indexedAddress(topic: string, field: string): string {
  const word = requireWord(topic, field);
  if (word.slice(2, 26) !== '0'.repeat(24)) {
    throw new ProviderError('INVALID_RESPONSE', `${field} has dirty indexed-address padding.`);
  }
  return `0x${word.slice(-40)}`;
}

function decodeTransfer(log: EvmLogRecord): { from: string; to: string; amount: string } {
  if (
    log.topics.length !== 3 ||
    log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC ||
    !EVM_WORD.test(log.data)
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'ERC-20 Transfer log shape is invalid.');
  }
  return {
    from: indexedAddress(log.topics[1] ?? '', 'Transfer from'),
    to: indexedAddress(log.topics[2] ?? '', 'Transfer to'),
    amount: BigInt(log.data).toString(),
  };
}

function decimalBlock(value: string): string {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error('negative');
    return parsed.toString();
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', 'Transfer block number is invalid.', {
      cause: error,
    });
  }
}

function unsignedQuantity(value: string, field: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error('negative');
    return parsed;
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', `${field} is invalid.`, { cause: error });
  }
}

function blockTime(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    throw new ProviderError('INVALID_RESPONSE', 'Transfer block timestamp is invalid.');
  }
  return time.toISOString();
}

export async function collectErc20ClaimTransfers(options: {
  tokenAddress: string;
  subjectAddress?: string | undefined;
  fromBlock: string;
  toBlock: string;
  snapshot: EvmSnapshot;
  logReader: EvmLogReader;
  blockReader?: EvmBlockAnchorReader | undefined;
  maxBlocksPerRequest?: number | undefined;
  maxRequests?: number | undefined;
  maxTransfers?: number | undefined;
  now?: (() => string) | undefined;
}): Promise<Erc20ClaimTransferCollection> {
  const snapshot = EvmSnapshotSchema.parse(options.snapshot);
  if (snapshot.finality !== 'finalized') {
    throw new Error('ERC-20 claim transfer collection requires a finalized Snapshot.');
  }
  const tokenAddress = normalizeAddress(options.tokenAddress, 'token address');
  const subjectAddress =
    options.subjectAddress === undefined
      ? undefined
      : normalizeAddress(options.subjectAddress, 'subject address');
  if (!/^(0|[1-9]\d*)$/.test(options.fromBlock) || !/^(0|[1-9]\d*)$/.test(options.toBlock)) {
    throw new Error('ERC-20 claim transfer range must use unsigned integer strings.');
  }
  const fromBlock = BigInt(options.fromBlock);
  const toBlock = BigInt(options.toBlock);
  if (fromBlock < 0n || toBlock < fromBlock || toBlock > BigInt(snapshot.blockNumber)) {
    throw new Error('ERC-20 claim transfer range is invalid or exceeds the Snapshot.');
  }
  const maxBlocksPerRequest = options.maxBlocksPerRequest ?? 50_000;
  const maxRequests = options.maxRequests ?? 1_000;
  const maxTransfers = options.maxTransfers ?? 25_000;
  if (
    !Number.isSafeInteger(maxBlocksPerRequest) ||
    maxBlocksPerRequest < 1 ||
    maxBlocksPerRequest > 1_000_000
  ) {
    throw new Error('maxBlocksPerRequest must be between 1 and 1000000.');
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 10_000) {
    throw new Error('maxRequests must be between 1 and 10000.');
  }
  if (!Number.isSafeInteger(maxTransfers) || maxTransfers < 1 || maxTransfers > 1_000_000) {
    throw new Error('maxTransfers must be between 1 and 1000000.');
  }
  const requestVariants = subjectAddress === undefined ? 1n : 2n;
  const requiredRequests =
    ((toBlock - fromBlock) / BigInt(maxBlocksPerRequest) + 1n) * requestVariants;
  if (requiredRequests > BigInt(maxRequests)) {
    throw new Error('ERC-20 claim transfer range exceeds the configured request budget.');
  }
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const logs: Array<{
    log: EvmLogRecord;
    source: string;
    direction: 'ALL' | 'FROM' | 'TO';
  }> = [];
  const crossQueryLogs = new Map<string, string>();
  const queryEvidence: Evidence[] = [];
  const sourceSet = new Set<string>();
  for (let cursor = fromBlock; cursor <= toBlock; cursor += BigInt(maxBlocksPerRequest)) {
    const end = cursor + BigInt(maxBlocksPerRequest) - 1n;
    const requestedEnd = end < toBlock ? end : toBlock;
    const indexedSubject =
      subjectAddress === undefined ? undefined : `0x${'0'.repeat(24)}${subjectAddress.slice(2)}`;
    const queries =
      indexedSubject === undefined
        ? [{ direction: 'ALL' as const, topics: [ERC20_TRANSFER_TOPIC] as const }]
        : [
            {
              direction: 'FROM' as const,
              topics: [ERC20_TRANSFER_TOPIC, indexedSubject, null] as const,
            },
            {
              direction: 'TO' as const,
              topics: [ERC20_TRANSFER_TOPIC, null, indexedSubject] as const,
            },
          ];
    for (const query of queries) {
      const observation = await options.logReader.getLogsObservation({
        address: tokenAddress,
        fromBlock: cursor.toString(),
        toBlock: requestedEnd.toString(),
        topics: query.topics,
      });
      sourceSet.add(observation.endpointId);
      queryEvidence.push(
        createEvidence({
          ledger: 'EVM',
          chainId: snapshot.chainId,
          kind: 'PROVIDER_OBSERVATION',
          source: observation.endpointId,
          locator: `erc20-transfer-range:${tokenAddress}:${cursor.toString()}-${requestedEnd.toString()}:${query.direction.toLowerCase()}`,
          payload: {
            query: {
              address: tokenAddress,
              fromBlock: cursor.toString(),
              toBlock: requestedEnd.toString(),
              topics: query.topics,
            },
            resultCount: observation.value.length,
            resultIdentities: observation.value.map((log) => ({
              blockHash: log.blockHash,
              transactionHash: log.transactionHash,
              logIndex: log.logIndex,
            })),
          },
          summary:
            observation.value.length === 0
              ? 'Finalized ERC-20 Transfer range query returned no observations.'
              : 'Finalized ERC-20 Transfer range query returned observations for strict decoding.',
          observedAt,
          ...(cursor === requestedEnd ? { blockOrSlot: cursor.toString() } : {}),
          finality: 'finalized',
        }),
      );
      const responseIdentities = new Set<string>();
      for (const log of observation.value) {
        const identity = `${log.transactionHash.toLowerCase()}:${log.logIndex.toLowerCase()}`;
        if (responseIdentities.has(identity)) {
          throw new ProviderError(
            'INVALID_RESPONSE',
            'ERC-20 transfer query response contains duplicates.',
          );
        }
        responseIdentities.add(identity);
        const fingerprint = canonicalJson({
          address: log.address,
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          blockTimestamp: log.blockTimestamp ?? null,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          logIndex: log.logIndex,
          data: log.data,
          topics: log.topics,
          removed: log.removed,
        });
        const existing = crossQueryLogs.get(identity);
        if (existing !== undefined) {
          if (existing !== fingerprint) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              'Overlapping ERC-20 transfer queries returned conflicting records.',
            );
          }
          continue;
        }
        crossQueryLogs.set(identity, fingerprint);
        logs.push({ log, source: observation.endpointId, direction: query.direction });
      }
    }
    if (logs.length > maxTransfers) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `ERC-20 claim transfer result exceeds the configured ${maxTransfers}-record limit.`,
      );
    }
  }
  const timestampCache = new Map<string, string>();
  const identities = new Set<string>();
  const evidence: Evidence[] = [...queryEvidence];
  const transfers: EvmClaimTransferObservation[] = [];
  logs.sort((left, right) => {
    const blockOrder =
      unsignedQuantity(left.log.blockNumber, 'Transfer block number') -
      unsignedQuantity(right.log.blockNumber, 'Transfer block number');
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
    const transactionOrder =
      unsignedQuantity(left.log.transactionIndex, 'Transfer transaction index') -
      unsignedQuantity(right.log.transactionIndex, 'Transfer transaction index');
    if (transactionOrder !== 0n) return transactionOrder < 0n ? -1 : 1;
    const logOrder =
      unsignedQuantity(left.log.logIndex, 'Transfer log index') -
      unsignedQuantity(right.log.logIndex, 'Transfer log index');
    return logOrder === 0n ? 0 : logOrder < 0n ? -1 : 1;
  });
  for (const item of logs) {
    const log = item.log;
    if (
      log.address.toLowerCase() !== tokenAddress ||
      !EVM_HASH.test(log.blockHash) ||
      !EVM_HASH.test(log.transactionHash) ||
      log.removed
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Transfer log token, identity, block hash, or canonical status is invalid.',
      );
    }
    const position = decimalBlock(log.blockNumber);
    const numericPosition = BigInt(position);
    if (numericPosition < fromBlock || numericPosition > toBlock) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Transfer log falls outside the requested range.',
      );
    }
    if (
      position === snapshot.blockNumber &&
      log.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase()
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Transfer log at the target height disagrees with the analysis Snapshot.',
      );
    }
    const logIndex = unsignedQuantity(log.logIndex, 'Transfer log index').toString();
    unsignedQuantity(log.transactionIndex, 'Transfer transaction index');
    const identity = `${log.transactionHash.toLowerCase()}:${logIndex}`;
    if (identities.has(identity)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'ERC-20 transfer collection contains duplicates.',
      );
    }
    identities.add(identity);
    const decoded = decodeTransfer(log);
    if (
      subjectAddress !== undefined &&
      ((item.direction === 'FROM' && decoded.from !== subjectAddress) ||
        (item.direction === 'TO' && decoded.to !== subjectAddress))
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Transfer log disagrees with the requested subject topic direction.',
      );
    }
    if (
      subjectAddress !== undefined &&
      decoded.from !== subjectAddress &&
      decoded.to !== subjectAddress
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Transfer log falls outside the requested subject filter.',
      );
    }
    let timestamp = log.blockTimestamp;
    if (timestamp === undefined) {
      const cached = timestampCache.get(position);
      if (cached !== undefined) {
        timestamp = cached;
      } else {
        if (options.blockReader === undefined) {
          throw new ProviderError(
            'INVALID_RESPONSE',
            'Transfer source omitted block time and no exact anchor reader is configured.',
          );
        }
        const anchor = await options.blockReader.readAnchorAt(position);
        if (
          anchor.anchor.ledger !== 'EVM' ||
          anchor.anchor.chainId !== snapshot.chainId ||
          anchor.anchor.hash.toLowerCase() !== log.blockHash.toLowerCase() ||
          anchor.anchor.finality !== 'finalized' ||
          anchor.snapshot.ledger !== 'EVM' ||
          anchor.snapshot.blockTimestamp === undefined
        ) {
          throw new ProviderError(
            'INVALID_RESPONSE',
            'Transfer block anchor does not match the finalized log.',
          );
        }
        timestamp = anchor.snapshot.blockTimestamp;
        timestampCache.set(position, timestamp);
        sourceSet.add(anchor.anchor.source);
      }
    }
    const normalizedTimestamp = blockTime(timestamp);
    const node = createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'LOG',
      source: item.source,
      locator: `erc20-transfer:${identity}`,
      payload: {
        raw: log.raw,
        normalized: {
          ...decoded,
          tokenAddress,
          position,
          blockHash: log.blockHash.toLowerCase(),
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex,
        },
      },
      summary: 'Finalized ERC-20 Transfer log decoded for deterministic claim-flow analysis.',
      observedAt,
      blockOrSlot: position,
      finality: 'finalized',
    });
    evidence.push(node);
    transfers.push({
      id: `erc20:${identity}`,
      from: decoded.from,
      to: decoded.to,
      amount: decoded.amount,
      observedAt: normalizedTimestamp,
      transactionId: log.transactionHash.toLowerCase(),
      evidenceIds: [node.id],
      blockNumber: position,
      blockHash: log.blockHash.toLowerCase(),
      transactionIndex: unsignedQuantity(
        log.transactionIndex,
        'Transfer transaction index',
      ).toString(),
      logIndex,
    });
  }
  const metadata = observationMetadata({
    snapshot,
    sourceSet,
    evidence,
    modelVersion: ERC20_CLAIM_TRANSFER_MODEL_VERSION,
    historyCoverage: 1,
    confidence: 0.95,
  });
  return {
    tokenAddress,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    transfers,
    evidence,
    metadata,
  };
}
