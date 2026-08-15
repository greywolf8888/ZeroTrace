import {
  ProviderError,
  type SolanaAccountInfoResponse,
  type TransportObservation,
} from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  RaydiumLaunchlabPoolStateReadSchema,
  SolanaSnapshotSchema,
  UnsignedQuantityStringSchema,
  type AnalysisSnapshot,
  type Evidence,
  type RaydiumLaunchlabPoolStateRead,
} from '@zerotrace/schemas';

import {
  decodeRaydiumLaunchlabPoolState,
  RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH,
  RAYDIUM_LAUNCHLAB_POOL_STATE_DISCRIMINATOR,
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION,
} from './solana-raydium-launchlab.js';

export interface RaydiumLaunchlabPoolStateReadAdapter {
  readonly sourceId: string;
  readonly config: { commitment: 'processed' | 'confirmed' | 'finalized' };
  /**
   * Optional archive-provider capability. Public Solana JSON-RPC does not
   * implement arbitrary historical account reads; when absent, the reader
   * uses getAccountInfo with minContextSlot and preserves MIN_CONTEXT_ONLY.
   */
  getAccountInfoAt?: (
    address: string,
    slot: number,
  ) => Promise<TransportObservation<SolanaAccountInfoResponse>>;
  getAccountInfoObservation(
    address: string,
    minimumContextSlot?: number,
  ): Promise<TransportObservation<SolanaAccountInfoResponse>>;
  readAnchorAt(position: string): Promise<{
    snapshot: AnalysisSnapshot;
  }>;
}

export interface RaydiumLaunchlabPoolStateEvidenceWriter {
  (
    evidence: Evidence,
    sourceEvidenceIds?: readonly string[],
    snapshot?: AnalysisSnapshot,
  ): Promise<Evidence>;
}

function safeSlot(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = UnsignedQuantityStringSchema.parse(value);
  const number = Number(parsed);
  if (!Number.isSafeInteger(number)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Raydium PoolState requested slot exceeds safe precision.',
    );
  }
  return number;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hasDiscriminator(data: Uint8Array): boolean {
  return (
    data.length >= RAYDIUM_LAUNCHLAB_POOL_STATE_DISCRIMINATOR.length &&
    RAYDIUM_LAUNCHLAB_POOL_STATE_DISCRIMINATOR.every((value, index) => data[index] === value)
  );
}

function decodeAccountData(account: NonNullable<SolanaAccountInfoResponse['value']>): Uint8Array {
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length !== account.space) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Raydium PoolState account data length changed after provider validation.',
    );
  }
  return data;
}

/**
 * Read one Raydium LaunchLab PoolState with an explicit historical boundary.
 *
 * Solana JSON-RPC exposes finalized account state with a minimum context slot,
 * not arbitrary historical account snapshots. When the node answers at a later
 * context, the result remains useful for current-state inspection but is marked
 * MIN_CONTEXT_ONLY and never promoted to an exact historical state.
 */
export async function inspectRaydiumLaunchlabPoolState(input: {
  account: string;
  requestedSlot?: string;
  adapter: RaydiumLaunchlabPoolStateReadAdapter;
  writeEvidence: RaydiumLaunchlabPoolStateEvidenceWriter;
}): Promise<RaydiumLaunchlabPoolStateRead> {
  if (input.adapter.config.commitment !== 'finalized') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Raydium LaunchLab PoolState inspection requires finalized account state.',
    );
  }
  const requestedSlot = input.requestedSlot;
  const minimumContextSlot = safeSlot(requestedSlot);
  const accountObservation =
    minimumContextSlot !== undefined && input.adapter.getAccountInfoAt !== undefined
      ? await input.adapter.getAccountInfoAt(input.account, minimumContextSlot)
      : await input.adapter.getAccountInfoObservation(input.account, minimumContextSlot);
  const response = accountObservation.value;
  const observedContextSlot = String(response.context.slot);
  const anchor = await input.adapter.readAnchorAt(observedContextSlot);
  const snapshot = SolanaSnapshotSchema.parse(anchor.snapshot);
  if (snapshot.commitment !== 'finalized') {
    throw new ProviderError('INVALID_RESPONSE', 'Raydium PoolState anchor is not finalized.');
  }

  const account = response.value;
  const exists = account !== null;
  const ownerVerified = account?.owner === RAYDIUM_LAUNCHLAB_PROGRAM_ID;
  const data = account === null ? new Uint8Array() : decodeAccountData(account);
  const discriminatorMatched = hasDiscriminator(data);
  const decoded =
    ownerVerified && discriminatorMatched ? decodeRaydiumLaunchlabPoolState(data) : undefined;
  const decodeWarnings = [
    ...(account === null
      ? ['PoolState account was absent at the observed finalized context.']
      : []),
    ...(exists && !ownerVerified
      ? [`Account owner ${account.owner} is not the pinned Raydium LaunchLab program.`]
      : []),
    ...(ownerVerified && !discriminatorMatched
      ? ['Account data does not carry the pinned Raydium LaunchLab PoolState discriminator.']
      : []),
    ...(decoded?.decodeWarnings ?? []),
  ].slice(0, 16);
  const stateAtRequestedSlot =
    requestedSlot === undefined || minimumContextSlot === response.context.slot
      ? 'EXACT'
      : minimumContextSlot !== undefined && response.context.slot > minimumContextSlot
        ? 'MIN_CONTEXT_ONLY'
        : 'UNKNOWN';
  const sourceSet = sortedUnique([
    ...Object.keys(snapshot.providerVersions),
    accountObservation.endpointId,
  ]);
  const accountEvidence = await input.writeEvidence(
    createEvidence({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      kind: 'ACCOUNT_STATE',
      source: accountObservation.endpointId,
      locator: `raydium-pool-state:${input.account}@${observedContextSlot}`,
      payload: {
        account: input.account,
        requestedSlot: requestedSlot ?? null,
        observedContextSlot,
        owner: account?.owner ?? null,
        executable: account?.executable ?? null,
        lamports: account?.lamports ?? null,
        space: account?.space ?? null,
        dataBase64: account?.data[0] ?? null,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: observedContextSlot,
      finality: snapshot.commitment,
      summary: 'Finalized Raydium LaunchLab PoolState account observation.',
    }),
    [],
    snapshot,
  );
  const derivedEvidence = await input.writeEvidence(
    createEvidence({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION}`,
      locator: `raydium-pool-state-decode:${input.account}@${observedContextSlot}`,
      payload: {
        account: input.account,
        programId: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
        requestedSlot: requestedSlot ?? null,
        observedContextSlot,
        stateAtRequestedSlot,
        accountDataLength: data.length,
        expectedAccountDataLength: RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH,
        decodedFields: decoded?.decodedFields ?? [],
        fieldCoverage: decoded?.fieldCoverage ?? 0,
        decodeWarnings,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: observedContextSlot,
      finality: snapshot.commitment,
      summary:
        stateAtRequestedSlot === 'EXACT'
          ? 'Raydium LaunchLab PoolState fields decoded at the observed finalized context.'
          : 'Raydium LaunchLab PoolState fields decoded from a later minimum-context observation; historical exactness remains open.',
      sourceEvidenceIds: [accountEvidence.id],
    }),
    [accountEvidence.id],
    snapshot,
  );
  const evidenceIds = sortedUnique([accountEvidence.id, derivedEvidence.id]);
  const base = {
    schemaVersion: 'raydium-launchlab-pool-state-read-v1' as const,
    account: input.account,
    programId: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
    exists,
    ownerVerified,
    discriminatorMatched,
    accountDataLength: data.length,
    expectedAccountDataLength: RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH,
    ...(requestedSlot === undefined ? {} : { requestedSlot }),
    observedContextSlot,
    stateAtRequestedSlot: stateAtRequestedSlot as 'EXACT' | 'MIN_CONTEXT_ONLY' | 'UNKNOWN',
    decodedFields: decoded?.decodedFields ?? [],
    fieldCoverage: decoded?.fieldCoverage ?? 0,
    decodeWarnings,
    evidenceIds,
    snapshot,
    dataCoverage: exists && ownerVerified ? (decoded?.fieldCoverage ?? 0.5) : exists ? 0.5 : 0.5,
    sourceCoverage: 0.5,
    historyCoverage: stateAtRequestedSlot === 'EXACT' ? 1 : 0.5,
    freshness: snapshot.blockTimestamp ?? snapshot.capturedAt,
    sourceSet,
    modelVersion: SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION,
  };
  const id = `rlp_${hashPayload({ schema: base.schemaVersion, value: base }).slice(0, 24)}`;
  const withId = { ...base, id };
  return RaydiumLaunchlabPoolStateReadSchema.parse({
    ...withId,
    resultHash: hashPayload(withId),
  });
}
