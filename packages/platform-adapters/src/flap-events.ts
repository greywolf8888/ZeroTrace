import { ProviderError, type EvmLedgerAdapter } from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  FlapEventTransactionSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type Evidence,
  type EvmEventPosition,
  type FlapEventTransaction,
  type FlapLaunchConfiguration,
  type FlapMigrationEvent,
} from '@zerotrace/schemas';
import { decodeEventLog, getAddress, toEventSelector } from 'viem';

import {
  FLAP_INTERFACE_SOURCE_REVISION,
  FLAP_TOKEN_VERSION_NAMES,
  type FlapDeployment,
  type FlapEvidenceWriter,
} from './flap.js';

export const FLAP_EVENT_MODEL_VERSION = 'flap-event-transaction-v1';
export const FLAP_EVENT_GUIDE =
  'https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/index-token-created-events';

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const DEFAULT_CURVE_PARAMETER = (16n * 10n ** 18n).toString();
const DEFAULT_DEX_SUPPLY_THRESHOLD = (667_000_000n * 10n ** 18n).toString();

const MIGRATOR_NAMES = [
  'V3_MIGRATOR',
  'V2_MIGRATOR',
  'V4_UNI_MIGRATOR',
  'PCS_INFINITY_CL_MIGRATOR',
] as const;
const DEX_NAMES = ['DEX0', 'DEX1', 'DEX2'] as const;
const LP_FEE_PROFILE_NAMES = ['STANDARD', 'LOW', 'HIGH'] as const;
const CONFIGURATION_EVENT_NAMES = new Set([
  'TokenCurveSet',
  'TokenCurveSetV2',
  'TokenDexSupplyThreshSet',
  'TokenQuoteSet',
  'TokenMigratorSet',
  'TokenVersionSet',
  'FlapTokenTaxSet',
  'FlapTokenAsymmetricTaxSet',
  'TokenExtensionEnabled',
  'TokenDexPreferenceSet',
]);

const FLAP_EVENT_ABI = [
  {
    type: 'event',
    name: 'TokenCreated',
    inputs: [
      { name: 'ts', type: 'uint256', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'token', type: 'address', indexed: false },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'meta', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FlapTokenStaged',
    inputs: [
      { name: 'ts', type: 'uint256', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
      { name: 'token', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenCurveSet',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'curve', type: 'address', indexed: false },
      { name: 'curveParameter', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenCurveSetV2',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'r', type: 'uint256', indexed: false },
      { name: 'h', type: 'uint256', indexed: false },
      { name: 'k', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenDexSupplyThreshSet',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'dexSupplyThresh', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenQuoteSet',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'quoteToken', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenMigratorSet',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'migratorType', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenVersionSet',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'version', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FlapTokenTaxSet',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'tax', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FlapTokenAsymmetricTaxSet',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'buyTax', type: 'uint256', indexed: false },
      { name: 'sellTax', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenExtensionEnabled',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'extensionID', type: 'bytes32', indexed: false },
      { name: 'extensionAddress', type: 'address', indexed: false },
      { name: 'version', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenDexPreferenceSet',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'dexId', type: 'uint8', indexed: false },
      { name: 'lpFeeProfile', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LaunchedToDEX',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      { name: 'pool', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'eth', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenPoolInfoUpdated',
    inputs: [
      { name: 'token', type: 'address', indexed: false },
      {
        name: 'poolInfo',
        type: 'tuple',
        indexed: false,
        components: [
          { name: 'pool', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'poolType', type: 'uint8' },
          { name: 'unused', type: 'uint64' },
        ],
      },
    ],
  },
] as const;

const SUPPORTED_EVENT_TOPICS = new Set([
  toEventSelector('TokenCreated(uint256,address,uint256,address,string,string,string)'),
  toEventSelector('FlapTokenStaged(uint256,address,address)'),
  toEventSelector('TokenCurveSet(address,address,uint256)'),
  toEventSelector('TokenCurveSetV2(address,uint256,uint256,uint256)'),
  toEventSelector('TokenDexSupplyThreshSet(address,uint256)'),
  toEventSelector('TokenQuoteSet(address,address)'),
  toEventSelector('TokenMigratorSet(address,uint8)'),
  toEventSelector('TokenVersionSet(address,uint8)'),
  toEventSelector('FlapTokenTaxSet(address,uint256)'),
  toEventSelector('FlapTokenAsymmetricTaxSet(address,uint256,uint256)'),
  toEventSelector('TokenExtensionEnabled(address,bytes32,address,uint8)'),
  toEventSelector('TokenDexPreferenceSet(address,uint8,uint8)'),
  toEventSelector('LaunchedToDEX(address,address,uint256,uint256)'),
  toEventSelector('TokenPoolInfoUpdated(address,(address,uint24,uint8,uint64))'),
]);

interface StrictReceiptLog {
  address: string;
  blockHash: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  data: `0x${string}`;
  topics: [`0x${string}`, ...`0x${string}`[]];
  removed: false;
  raw: Readonly<Record<string, unknown>>;
}

interface DecodedPortalEvent {
  eventName: string;
  args: Record<string, unknown>;
  log: StrictReceiptLog;
  evidence?: Evidence;
}

function canonicalAddress(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not an EVM address.`);
  }
  try {
    return getAddress(value).toLowerCase();
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not an EVM address.`, {
      cause: error,
    });
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function evidenceJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => evidenceJsonValue(item));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, evidenceJsonValue(item)]),
    );
  }
  return value;
}

function hexData(value: unknown, field: string): `0x${string}` {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not canonical hex data.`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function hash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not a 32-byte hash.`);
  }
  return value.toLowerCase();
}

function quantity(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not a canonical quantity.`);
  }
  return BigInt(value).toString();
}

function uint(value: unknown, field: string): string {
  if (
    (typeof value !== 'bigint' || value < 0n) &&
    (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not an unsigned integer.`);
  }
  return value.toString();
}

function smallUint(value: unknown, field: string): number {
  const parsed = uint(value, field);
  const numeric = Number(parsed);
  if (!Number.isSafeInteger(numeric)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} exceeds the safe enum range.`);
  }
  return numeric;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not a bounded string.`);
  }
  return value;
}

function bytes32(value: unknown, field: string): string {
  return hash(value, field);
}

function parseReceiptLogs(
  rawLogs: unknown,
  receipt: {
    blockHash: string;
    blockNumber: string;
    transactionHash: string;
    transactionIndex: string;
  },
): StrictReceiptLog[] {
  if (!Array.isArray(rawLogs)) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap receipt logs are not an array.');
  }
  const seen = new Set<string>();
  return rawLogs
    .map((value, index) => {
      const raw = record(value, `receipt log ${index}`);
      const topicsValue = raw.topics;
      if (!Array.isArray(topicsValue) || topicsValue.length === 0 || topicsValue.length > 4) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          `Flap receipt log ${index} topics are invalid.`,
        );
      }
      const topics = topicsValue.map((topic, topicIndex) =>
        hash(topic, `receipt log ${index} topic ${topicIndex}`),
      ) as [`0x${string}`, ...`0x${string}`[]];
      const blockHash = hash(raw.blockHash, `receipt log ${index} block hash`);
      const blockNumber = quantity(raw.blockNumber, `receipt log ${index} block number`);
      const transactionHash = hash(raw.transactionHash, `receipt log ${index} transaction hash`);
      const transactionIndex = quantity(
        raw.transactionIndex,
        `receipt log ${index} transaction index`,
      );
      const logIndex = quantity(raw.logIndex, `receipt log ${index} log index`);
      if (
        blockHash !== receipt.blockHash ||
        blockNumber !== receipt.blockNumber ||
        transactionHash !== receipt.transactionHash ||
        transactionIndex !== receipt.transactionIndex
      ) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          `Flap receipt log ${index} placement conflicts with its receipt.`,
        );
      }
      if (raw.removed !== false) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          `Flap receipt log ${index} is removed or lacks finality state.`,
        );
      }
      if (seen.has(logIndex)) {
        throw new ProviderError('INVALID_RESPONSE', 'Flap receipt contains duplicate log indexes.');
      }
      seen.add(logIndex);
      return {
        address: canonicalAddress(raw.address, `receipt log ${index} address`),
        blockHash,
        blockNumber,
        transactionHash,
        transactionIndex,
        logIndex,
        data: hexData(raw.data, `receipt log ${index} data`),
        topics,
        removed: false as const,
        raw,
      };
    })
    .sort((left, right) => Number(BigInt(left.logIndex) - BigInt(right.logIndex)));
}

function decodePortalEvent(log: StrictReceiptLog): DecodedPortalEvent | undefined {
  const supported = SUPPORTED_EVENT_TOPICS.has(log.topics[0].toLowerCase() as `0x${string}`);
  try {
    const decoded = decodeEventLog({
      abi: FLAP_EVENT_ABI,
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    return {
      eventName: decoded.eventName,
      args: record(decoded.args, `${decoded.eventName} arguments`),
      log,
    };
  } catch (error) {
    if (!supported) return undefined;
    throw new ProviderError('INVALID_RESPONSE', 'A known Flap event could not be decoded.', {
      cause: error,
    });
  }
}

function tokenForEvent(event: DecodedPortalEvent): string {
  return canonicalAddress(event.args.token, `${event.eventName} token`);
}

function position(log: StrictReceiptLog): EvmEventPosition {
  return {
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
  };
}

function one(events: readonly DecodedPortalEvent[], eventName: string): DecodedPortalEvent | null {
  const matches = events.filter((event) => event.eventName === eventName);
  if (matches.length > 1) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap transaction contains duplicate ${eventName} events for one token.`,
    );
  }
  return matches[0] ?? null;
}

function eventEvidenceIds(event: DecodedPortalEvent): string[] {
  if (event.evidence === undefined) {
    throw new ProviderError('INVALID_RESPONSE', 'Decoded Flap event is missing Evidence.');
  }
  return [event.evidence.id];
}

function knownField(
  value: string,
  evidenceIds: readonly string[],
  source: 'EVENT' | 'OFFICIAL_DEFAULT' = 'EVENT',
) {
  return { value: knownValue(value), source, evidenceIds: [...evidenceIds] };
}

function unknownDefaultField(detail: string, evidenceIds: readonly string[]) {
  return {
    value: unknownValue('NOT_QUERIED', detail),
    source: 'OFFICIAL_DEFAULT' as const,
    evidenceIds: [...evidenceIds],
  };
}

function notApplicableField(detail: string, evidenceIds: readonly string[]) {
  return {
    value: unknownValue('NOT_APPLICABLE', detail),
    source: 'NOT_APPLICABLE' as const,
    evidenceIds: [...evidenceIds],
  };
}

function enumField(
  code: number,
  values: readonly string[],
  field: string,
  evidenceIds: readonly string[],
) {
  const value = values[code];
  return {
    value:
      value === undefined
        ? unknownValue('UNSUPPORTED', `Flap ${field} code ${code} is not recognized.`)
        : knownValue(value),
    source: 'EVENT' as const,
    evidenceIds: [...evidenceIds],
  };
}

function buildConfiguration(
  events: readonly DecodedPortalEvent[],
  defaultEvidence: Evidence,
): FlapLaunchConfiguration {
  const defaults = [defaultEvidence.id];
  const curve = one(events, 'TokenCurveSet');
  const curveV2 = one(events, 'TokenCurveSetV2');
  const threshold = one(events, 'TokenDexSupplyThreshSet');
  const quote = one(events, 'TokenQuoteSet');
  const migrator = one(events, 'TokenMigratorSet');
  const version = one(events, 'TokenVersionSet');
  const tax = one(events, 'FlapTokenTaxSet');
  const asymmetricTax = one(events, 'FlapTokenAsymmetricTaxSet');
  const dexPreference = one(events, 'TokenDexPreferenceSet');
  const extensions = events.filter((event) => event.eventName === 'TokenExtensionEnabled');

  const taxEvidence = asymmetricTax ?? tax;
  const taxEvidenceIds = taxEvidence === null ? defaults : eventEvidenceIds(taxEvidence);
  const symmetricTax = tax === null ? '0' : uint(tax.args.tax, 'tax');
  const configuration = {
    curveAddress:
      curve !== null
        ? knownField(canonicalAddress(curve.args.curve, 'curve address'), eventEvidenceIds(curve))
        : curveV2 !== null
          ? notApplicableField(
              'The V2 reserve curve is configured directly and has no legacy curve address.',
              eventEvidenceIds(curveV2),
            )
          : unknownDefaultField(
              'The official legacy default identifies a curve type but not a version-pinned curve address.',
              defaults,
            ),
    curveParameter:
      curve !== null
        ? knownField(uint(curve.args.curveParameter, 'curve parameter'), eventEvidenceIds(curve))
        : curveV2 !== null
          ? notApplicableField(
              'The legacy single curve parameter is not applicable to an explicit V2 reserve curve.',
              eventEvidenceIds(curveV2),
            )
          : knownField(DEFAULT_CURVE_PARAMETER, defaults, 'OFFICIAL_DEFAULT'),
    virtualQuoteReserve:
      curveV2 === null
        ? unknownDefaultField(
            'Legacy curve defaults do not directly expose the V2 r parameter.',
            defaults,
          )
        : knownField(uint(curveV2.args.r, 'curve r'), eventEvidenceIds(curveV2)),
    virtualBaseReserve:
      curveV2 === null
        ? unknownDefaultField(
            'Legacy curve defaults do not directly expose the V2 h parameter.',
            defaults,
          )
        : knownField(uint(curveV2.args.h, 'curve h'), eventEvidenceIds(curveV2)),
    virtualLiquiditySquared:
      curveV2 === null
        ? unknownDefaultField(
            'Legacy curve defaults do not directly expose the V2 k parameter.',
            defaults,
          )
        : knownField(uint(curveV2.args.k, 'curve k'), eventEvidenceIds(curveV2)),
    dexSupplyThreshold:
      threshold === null
        ? knownField(DEFAULT_DEX_SUPPLY_THRESHOLD, defaults, 'OFFICIAL_DEFAULT')
        : knownField(
            uint(threshold.args.dexSupplyThresh, 'DEX supply threshold'),
            eventEvidenceIds(threshold),
          ),
    quoteTokenAddress:
      quote === null
        ? knownField(ZERO_ADDRESS, defaults, 'OFFICIAL_DEFAULT')
        : knownField(
            canonicalAddress(quote.args.quoteToken, 'quote token'),
            eventEvidenceIds(quote),
          ),
    migratorType:
      migrator === null
        ? knownField(MIGRATOR_NAMES[0], defaults, 'OFFICIAL_DEFAULT')
        : enumField(
            smallUint(migrator.args.migratorType, 'migrator type'),
            MIGRATOR_NAMES,
            'migrator type',
            eventEvidenceIds(migrator),
          ),
    tokenVersion:
      version === null
        ? knownField(FLAP_TOKEN_VERSION_NAMES[0], defaults, 'OFFICIAL_DEFAULT')
        : enumField(
            smallUint(version.args.version, 'token version'),
            FLAP_TOKEN_VERSION_NAMES,
            'token version',
            eventEvidenceIds(version),
          ),
    buyTaxBps:
      asymmetricTax === null
        ? knownField(symmetricTax, taxEvidenceIds, tax === null ? 'OFFICIAL_DEFAULT' : 'EVENT')
        : knownField(uint(asymmetricTax.args.buyTax, 'buy tax'), taxEvidenceIds),
    sellTaxBps:
      asymmetricTax === null
        ? knownField(symmetricTax, taxEvidenceIds, tax === null ? 'OFFICIAL_DEFAULT' : 'EVENT')
        : knownField(uint(asymmetricTax.args.sellTax, 'sell tax'), taxEvidenceIds),
    dexId:
      dexPreference === null
        ? knownField(DEX_NAMES[0], defaults, 'OFFICIAL_DEFAULT')
        : enumField(
            smallUint(dexPreference.args.dexId, 'DEX ID'),
            DEX_NAMES,
            'DEX ID',
            eventEvidenceIds(dexPreference),
          ),
    lpFeeProfile:
      dexPreference === null
        ? knownField(LP_FEE_PROFILE_NAMES[0], defaults, 'OFFICIAL_DEFAULT')
        : enumField(
            smallUint(dexPreference.args.lpFeeProfile, 'LP fee profile'),
            LP_FEE_PROFILE_NAMES,
            'LP fee profile',
            eventEvidenceIds(dexPreference),
          ),
    extensions: extensions.map((event) => ({
      extensionId: bytes32(event.args.extensionID, 'extension ID'),
      extensionAddress: canonicalAddress(event.args.extensionAddress, 'extension address'),
      version: uint(event.args.version, 'extension version'),
      position: position(event.log),
      evidenceIds: eventEvidenceIds(event),
    })),
  };
  const evidenceIds = [
    ...new Set([
      ...defaults,
      ...events
        .filter((event) => CONFIGURATION_EVENT_NAMES.has(event.eventName))
        .flatMap((event) => eventEvidenceIds(event)),
    ]),
  ].sort();
  return {
    ...configuration,
    rawConfigHash: hashPayload(configuration),
    evidenceIds,
  };
}

function buildMigration(events: readonly DecodedPortalEvent[]): FlapMigrationEvent | null {
  const launched = one(events, 'LaunchedToDEX');
  const pool = one(events, 'TokenPoolInfoUpdated');
  if (launched === null && pool === null) return null;
  const evidenceIds = [
    ...new Set([
      ...(launched === null ? [] : eventEvidenceIds(launched)),
      ...(pool === null ? [] : eventEvidenceIds(pool)),
    ]),
  ].sort();
  return {
    launchedToDex:
      launched === null
        ? null
        : {
            token: tokenForEvent(launched),
            pool: canonicalAddress(launched.args.pool, 'launched pool'),
            tokenAmount: uint(launched.args.amount, 'launched token amount'),
            quoteAmount: uint(launched.args.eth, 'launched quote amount'),
            position: position(launched.log),
            evidenceIds: eventEvidenceIds(launched),
          },
    poolConfiguration:
      pool === null
        ? null
        : (() => {
            const poolInfo = record(pool.args.poolInfo, 'pool information');
            return {
              token: tokenForEvent(pool),
              pool: canonicalAddress(poolInfo.pool, 'configured pool'),
              fee: uint(poolInfo.fee, 'pool fee'),
              poolTypeCode: uint(poolInfo.poolType, 'pool type'),
              position: position(pool.log),
              evidenceIds: eventEvidenceIds(pool),
            };
          })(),
    evidenceIds,
  };
}

function analysisMetadata(
  snapshot: AnalysisSnapshot,
  sourceSet: readonly string[],
  evidenceIds: readonly string[],
  dataCoverage: number,
  confidence: number,
): AnalysisMetadata {
  return AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage,
    sourceCoverage: Math.min(1, new Set(sourceSet).size / 2),
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet: [...new Set(sourceSet)].sort(),
    modelVersion: FLAP_EVENT_MODEL_VERSION,
    confidence,
    evidenceIds: [...new Set(evidenceIds)].sort(),
  });
}

export async function inspectFlapEventTransaction(options: {
  adapter: EvmLedgerAdapter;
  token: string;
  transactionHash: string;
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
}): Promise<FlapEventTransaction> {
  const { adapter, deployment, writeEvidence } = options;
  const token = canonicalAddress(options.token, 'token address');
  const portal = canonicalAddress(deployment.portal, 'Portal address');
  if (`eip155:${adapter.config.chainId}` !== deployment.chainId) {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap deployment and EVM adapter chains differ.');
  }
  const receiptObservation = await adapter.getTransactionReceiptObservation(
    options.transactionHash,
  );
  const receipt = receiptObservation.value;
  if (receipt === null) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'The Flap event transaction receipt is unavailable or not finalized.',
      { retryable: true },
    );
  }
  if (receipt.status !== '0x1') {
    throw new ProviderError('INVALID_RESPONSE', 'The Flap event transaction did not succeed.');
  }
  const blockNumber = BigInt(receipt.blockNumber).toString();
  const anchor = await adapter.readAnchorAt(blockNumber);
  if (anchor.snapshot.ledger !== 'EVM' || anchor.snapshot.chainId !== deployment.chainId) {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap receipt Snapshot does not match deployment.');
  }
  if (anchor.snapshot.blockHash !== receipt.blockHash) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'The Flap receipt block hash conflicts with the replay Snapshot.',
    );
  }
  const snapshot = anchor.snapshot;
  const receiptBlockNumber = BigInt(receipt.blockNumber).toString();
  const receiptTransactionIndex = BigInt(receipt.transactionIndex).toString();
  const logs = parseReceiptLogs(receipt.raw.logs, {
    blockHash: receipt.blockHash,
    blockNumber: receiptBlockNumber,
    transactionHash: receipt.transactionHash,
    transactionIndex: receiptTransactionIndex,
  });
  const receiptEvidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'RECEIPT',
      source: receiptObservation.endpointId,
      locator: `transaction-receipt:${receipt.transactionHash}`,
      payload: receipt.raw,
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Flap candidate event transaction receipt observed and rebound to its block.',
    }),
    [],
    snapshot,
  );

  const portalLogs = logs.filter((log) => log.address === portal);
  const decoded: DecodedPortalEvent[] = [];
  let unrecognizedPortalLogCount = 0;
  for (const log of portalLogs) {
    const event = decodePortalEvent(log);
    if (event === undefined) {
      unrecognizedPortalLogCount += 1;
      continue;
    }
    if (tokenForEvent(event) !== token) continue;
    event.evidence = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: deployment.chainId,
        kind: 'LOG',
        source: receiptObservation.endpointId,
        locator: `flap-event:${event.eventName}:${receipt.transactionHash}:${log.logIndex}`,
        payload: {
          raw: log.raw,
          eventName: event.eventName,
          args: evidenceJsonValue(event.args),
        },
        observedAt: snapshot.capturedAt,
        blockOrSlot: snapshot.blockNumber,
        finality: snapshot.finality,
        summary: `Flap ${event.eventName} event decoded from the pinned receipt.`,
      }),
      [],
      snapshot,
    );
    decoded.push(event);
  }

  if (decoded.length === 0) {
    const negative = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: deployment.chainId,
        kind: 'NEGATIVE_EVIDENCE',
        source: 'zerotrace:flap-event-decoder',
        locator: `flap-event-transaction:${token}:${receipt.transactionHash}`,
        payload: { token, portal, matched: false },
        observedAt: snapshot.capturedAt,
        blockOrSlot: snapshot.blockNumber,
        finality: snapshot.finality,
        summary: 'The pinned transaction contains no supported Flap event for this token.',
        sourceEvidenceIds: [receiptEvidence.id],
      }),
      [receiptEvidence.id],
      snapshot,
    );
    const evidence = [receiptEvidence, negative];
    return FlapEventTransactionSchema.parse({
      platform: 'flap',
      token,
      transactionHash: receipt.transactionHash,
      platformMatch: knownValue(false),
      transactionKind: 'UNRECOGNIZED',
      creation: null,
      staged: null,
      configuration: null,
      migration: null,
      decodedEventNames: [],
      unrecognizedPortalLogCount,
      metadata: analysisMetadata(
        snapshot,
        [receiptObservation.endpointId],
        evidence.map((item) => item.id),
        1,
        1,
      ),
      evidence,
    });
  }

  const creationEvent = one(decoded, 'TokenCreated');
  const stagedEvent = one(decoded, 'FlapTokenStaged');
  const defaultEvidence =
    creationEvent === null
      ? undefined
      : await writeEvidence(
          createEvidence({
            ledger: 'EVM',
            chainId: deployment.chainId,
            kind: 'PROVIDER_OBSERVATION',
            source: `flap-official-event-guide@${deployment.registryObservedAt.slice(0, 10)}`,
            sourceUri: FLAP_EVENT_GUIDE,
            locator: `flap-event-defaults:${deployment.documentedVersion}@${snapshot.blockNumber}`,
            payload: {
              interfaceRevision: FLAP_INTERFACE_SOURCE_REVISION,
              documentedVersion: deployment.documentedVersion,
              defaults: {
                curveParameter: DEFAULT_CURVE_PARAMETER,
                dexSupplyThreshold: DEFAULT_DEX_SUPPLY_THRESHOLD,
                quoteTokenAddress: ZERO_ADDRESS,
                migratorType: MIGRATOR_NAMES[0],
                tokenVersion: FLAP_TOKEN_VERSION_NAMES[0],
                taxBps: '0',
                dexId: DEX_NAMES[0],
                lpFeeProfile: LP_FEE_PROFILE_NAMES[0],
              },
            },
            observedAt: deployment.registryObservedAt,
            blockOrSlot: snapshot.blockNumber,
            finality: snapshot.finality,
            summary: 'Official Flap same-transaction event-default policy used for launch config.',
          }),
          [],
          snapshot,
        );
  const configuration =
    creationEvent === null || defaultEvidence === undefined
      ? null
      : buildConfiguration(decoded, defaultEvidence);
  const migration = buildMigration(decoded);
  const creation =
    creationEvent === null
      ? null
      : {
          timestampUnix: uint(creationEvent.args.ts, 'creation timestamp'),
          creator: canonicalAddress(creationEvent.args.creator, 'creator'),
          nonce: uint(creationEvent.args.nonce, 'creation nonce'),
          token,
          name: text(creationEvent.args.name, 'token name', 1_024),
          symbol: text(creationEvent.args.symbol, 'token symbol', 256),
          metadataUri: text(creationEvent.args.meta, 'metadata URI', 4_096),
          position: position(creationEvent.log),
          evidenceIds: eventEvidenceIds(creationEvent),
        };
  const staged =
    stagedEvent === null
      ? null
      : {
          timestampUnix: uint(stagedEvent.args.ts, 'staged timestamp'),
          creator: canonicalAddress(stagedEvent.args.creator, 'staged creator'),
          token,
          position: position(stagedEvent.log),
          evidenceIds: eventEvidenceIds(stagedEvent),
        };
  const hasCreation = creation !== null;
  const hasStaged = staged !== null;
  const hasMigration = migration !== null;
  const transactionKind =
    hasMigration && (hasCreation || hasStaged)
      ? 'MIXED'
      : hasCreation
        ? 'CREATION_CONFIGURATION'
        : hasStaged
          ? 'STAGED'
          : hasMigration
            ? 'MIGRATION'
            : 'UNRECOGNIZED';
  const sourceEvidenceIds = [
    receiptEvidence.id,
    ...decoded.flatMap((event) => eventEvidenceIds(event)),
    ...(defaultEvidence === undefined ? [] : [defaultEvidence.id]),
  ];
  const derived = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${FLAP_EVENT_MODEL_VERSION}`,
      locator: `flap-event-transaction:${token}:${receipt.transactionHash}`,
      payload: {
        token,
        transactionKind,
        creation,
        staged,
        configuration,
        migration,
        unrecognizedPortalLogCount,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Flap transaction-local creation, configuration, or migration events normalized.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    snapshot,
  );
  const evidence = [
    receiptEvidence,
    ...decoded.flatMap((event) => (event.evidence === undefined ? [] : [event.evidence])),
    ...(defaultEvidence === undefined ? [] : [defaultEvidence]),
    derived,
  ];
  const recognizedPortalCount = portalLogs.length - unrecognizedPortalLogCount;
  const dataCoverage =
    portalLogs.length === 0 ? 1 : Math.max(0, recognizedPortalCount / portalLogs.length);
  return FlapEventTransactionSchema.parse({
    platform: 'flap',
    token,
    transactionHash: receipt.transactionHash,
    platformMatch: knownValue(true),
    transactionKind,
    creation,
    staged,
    configuration,
    migration,
    decodedEventNames: decoded.map((event) => event.eventName),
    unrecognizedPortalLogCount,
    metadata: analysisMetadata(
      snapshot,
      [
        receiptObservation.endpointId,
        ...(defaultEvidence === undefined ? [] : [defaultEvidence.source]),
      ],
      evidence.map((item) => item.id),
      dataCoverage,
      unrecognizedPortalLogCount === 0 ? 0.99 : 0.7,
    ),
    evidence,
  });
}
