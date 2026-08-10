import { describe, expect, it, vi } from 'vitest';

import { createEvidence, hashPayload } from '@zerotrace/evidence';
import { FlapEventHistorySchema, unknownValue, type FlapEventHistory } from '@zerotrace/schemas';

import { PostgresFlapHistoryProjectionRepository } from './flap-history.js';

const scanId = '22222222-2222-4222-8222-222222222222';
const token = '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777';
const modelVersion = 'flap-bounded-event-history-v1';
const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '19',
  blockHash: `0x${'a'.repeat(64)}`,
  parentBlockHash: `0x${'b'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-10T00:00:00.000Z',
  providerVersions: { 'bsc-rpc@example': 'evm-ledger-v0.1.0' },
  adapterVersions: { evm: 'evm-ledger-v0.1.0' },
  configHash: 'c'.repeat(64),
  entityModelVersion: 'entity-model-unapplied',
  labelSnapshot: 'labels-unapplied',
};
const rangeEvidence = createEvidence({
  ledger: 'EVM',
  chainId: snapshot.chainId,
  kind: 'PROVIDER_OBSERVATION',
  source: 'sqd:binance-mainnet',
  locator: `flap-portal-logs:portal:0-19`,
  payload: { logs: [] },
  observedAt: snapshot.capturedAt,
  blockOrSlot: snapshot.blockNumber,
  finality: snapshot.finality,
  summary: 'Bounded Flap Portal logs.',
});
const terminalEvidence = createEvidence({
  ledger: 'EVM',
  chainId: snapshot.chainId,
  kind: 'NEGATIVE_EVIDENCE',
  source: `zerotrace:${modelVersion}`,
  locator: `flap-event-history:${token}:0-19`,
  payload: { token, chronology: [] },
  observedAt: snapshot.capturedAt,
  blockOrSlot: snapshot.blockNumber,
  finality: snapshot.finality,
  summary: 'No supported event was found in the bounded range.',
  sourceEvidenceIds: [rangeEvidence.id],
});
const evidenceIds = [rangeEvidence.id, terminalEvidence.id].sort();
const sourceSet = ['bsc-rpc@example', 'sqd:binance-mainnet'];

const history: FlapEventHistory = FlapEventHistorySchema.parse({
  platform: 'flap',
  token,
  requestedRange: { fromBlock: '0', toBlock: '19', chunkSize: 10, chunkCount: 2 },
  requestedRangeCoverage: 1,
  lifetimeCoverage: unknownValue('INSUFFICIENT_DATA'),
  chronology: [],
  transactions: [],
  unrecognizedPortalLogCount: 0,
  metadata: {
    snapshot,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet,
    modelVersion,
    confidence: 0.95,
    evidenceIds,
  },
  evidence: [rangeEvidence, terminalEvidence],
});

function segmentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const resultHash = hashPayload(history);
  return {
    id: `fhs_${hashPayload({
      schema: 'zerotrace-flap-history-segment-v1',
      scanId,
      resultHash,
    }).slice(0, 24)}`,
    scan_id: scanId,
    chain_id: snapshot.chainId,
    token,
    from_block: '0',
    to_block: '19',
    result_hash: resultHash,
    result: history,
    snapshot_hash: hashPayload(snapshot),
    terminal_evidence_id: terminalEvidence.id,
    evidence_ids: evidenceIds,
    source_set: sourceSet,
    model_version: modelVersion,
    transaction_count: 0,
    unrecognized_portal_log_count: 0,
    created_at: new Date('2026-08-10T00:01:00.000Z'),
    ...overrides,
  };
}

function poolWith(
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>,
) {
  return { query: vi.fn(query), end: vi.fn(async () => undefined) };
}

describe('PostgreSQL Flap history projection', () => {
  it('stores one immutable bounded segment, replays it idempotently, and pages by scan', async () => {
    let stored = false;
    const pool = poolWith(async (text, values) => {
      if (text.includes('INSERT INTO flap_history_segments')) {
        stored = true;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('LIMIT $3')) {
        const rows = stored && values?.[1] === null ? [segmentRow()] : [];
        return { rows, rowCount: rows.length };
      }
      return { rows: stored ? [segmentRow()] : [], rowCount: stored ? 1 : 0 };
    });
    const repository = PostgresFlapHistoryProjectionRepository.fromPool(pool);

    const first = await repository.putSegment({ scanId, result: history });
    expect(first).toMatchObject({
      scanId,
      token,
      fromBlock: 0,
      toBlock: 19,
      transactionCount: 0,
      terminalEvidenceId: terminalEvidence.id,
    });
    await expect(repository.putSegment({ scanId, result: history })).resolves.toEqual(first);
    await expect(repository.listSegments(scanId, { limit: 25 })).resolves.toEqual([first]);
    await expect(repository.listSegments(scanId, { afterBlock: 0, limit: 25 })).resolves.toEqual(
      [],
    );
    expect(
      pool.query.mock.calls.filter((call) => String(call[0]).includes('INSERT INTO')).length,
    ).toBe(1);
    await repository.close();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('fails closed on conflicting stored hashes and unavailable storage', async () => {
    const conflicting = PostgresFlapHistoryProjectionRepository.fromPool(
      poolWith(async () => ({ rows: [segmentRow({ result_hash: 'f'.repeat(64) })], rowCount: 1 })),
    );
    await expect(conflicting.listSegments(scanId)).rejects.toMatchObject({
      code: 'FLAP_HISTORY_PROJECTION_CONFLICT',
    });

    const unavailable = PostgresFlapHistoryProjectionRepository.fromPool(
      poolWith(async () => Promise.reject(new Error('postgresql://user:secret@database.example'))),
    );
    await expect(unavailable.putSegment({ scanId, result: history })).rejects.toMatchObject({
      code: 'FLAP_HISTORY_PROJECTION_UNAVAILABLE',
      retryable: true,
      message: 'Flap history segment write failed.',
    });
    expect(JSON.stringify(await unavailable.health())).not.toMatch(/secret|database\.example/);
  });

  it('distinguishes initialized and missing projection schemas and validates page inputs', async () => {
    const initialized = PostgresFlapHistoryProjectionRepository.fromPool(
      poolWith(async () => ({
        rows: [{ table_name: 'flap_history_segments', migration_applied: true }],
        rowCount: 1,
      })),
    );
    await expect(initialized.health()).resolves.toMatchObject({ status: 'UP', durable: true });

    const missing = PostgresFlapHistoryProjectionRepository.fromPool(
      poolWith(async () => ({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      })),
    );
    await expect(missing.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'FLAP_HISTORY_PROJECTION_NOT_INITIALIZED',
    });
    await expect(missing.listSegments('not-a-uuid')).rejects.toMatchObject({
      code: 'FLAP_HISTORY_PROJECTION_INVALID',
    });
    await expect(missing.listSegments(scanId, { limit: 0 })).rejects.toMatchObject({
      code: 'FLAP_HISTORY_PROJECTION_INVALID',
    });
  });
});
