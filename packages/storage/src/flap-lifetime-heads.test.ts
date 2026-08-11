import { describe, expect, it, vi } from 'vitest';

import { createEvidence } from '@zerotrace/evidence';
import { FlapLifetimeRollbackSchema } from '@zerotrace/schemas';

import {
  flapLifetimeExtensionResult,
  flapLifetimeExtensionScanId,
  flapLifetimeFixtureToken,
  flapLifetimeInitialResult,
  flapLifetimeInitialScanId,
  flapLifetimeSnapshot,
} from './test-fixtures/flap-lifetime.js';

import { PostgresFlapLifetimeHeadRepository } from './flap-lifetime-heads.js';

function rowFromInsert(values: readonly unknown[]): Record<string, unknown> {
  return {
    id: values[0],
    chain_id: values[1],
    token: values[2],
    sequence: String(values[3]),
    scan_id: values[4],
    head_type: values[5],
    predecessor_id: values[6],
    target_block: String(values[7]),
    target_hash: values[8],
    result_hash: values[9],
    result: JSON.parse(String(values[10])) as unknown,
    snapshot_hash: values[11],
    terminal_evidence_id: values[12],
    created_at: new Date('2026-08-10T00:02:00.000Z'),
  };
}

function rowFromInvalidationInsert(values: readonly unknown[]): Record<string, unknown> {
  return {
    id: values[0],
    chain_id: values[1],
    token: values[2],
    event_sequence: String(values[3]),
    invalidated_from_head_id: values[4],
    invalidated_through_head_id: values[5],
    rollback_to_head_id: values[6],
    alert_id: values[7],
    terminal_evidence_id: values[8],
    result_hash: values[9],
    result: JSON.parse(String(values[10])) as unknown,
    snapshot_hash: values[11],
    created_at: new Date('2026-08-10T00:06:00.000Z'),
  };
}

function reference(head: Awaited<ReturnType<PostgresFlapLifetimeHeadRepository['putHead']>>) {
  return {
    headId: head.id,
    scanId: head.scanId,
    targetBlock: String(head.targetBlock),
    targetHash: head.targetHash,
    terminalEvidenceId: head.terminalEvidenceId,
  };
}

function rollbackResult(
  first: Awaited<ReturnType<PostgresFlapLifetimeHeadRepository['putHead']>>,
  second: Awaited<ReturnType<PostgresFlapLifetimeHeadRepository['putHead']>>,
) {
  const snapshot = flapLifetimeSnapshot(107);
  const checkEvidenceId = `ev_${'4'.repeat(24)}`;
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:flap-lifetime-rollback-v1',
    locator: `flap-lifetime-rollback:${second.token}:105-107`,
    payload: { invalidatedHeadId: second.id, rollbackToHeadId: first.id },
    observedAt: snapshot.capturedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: 'finalized',
    summary: 'Fixture accepted-head rollback.',
    sourceEvidenceIds: [first.terminalEvidenceId, second.terminalEvidenceId, checkEvidenceId],
  });
  return FlapLifetimeRollbackSchema.parse({
    chainId: 'eip155:56',
    token: second.token,
    reason: 'FINALIZED_REORG',
    invalidatedHeads: [reference(second)],
    rollbackTo: reference(first),
    observedTarget: { blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash },
    lineageCoverage: 1,
    alertId: `dqa_${'5'.repeat(24)}`,
    terminalEvidenceId: terminal.id,
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.capturedAt,
      sourceSet: ['bsc-rpc-a@test.example', 'bsc-rpc-b@test.example'],
      modelVersion: 'flap-lifetime-rollback-v1',
      confidence: 1,
      evidenceIds: [
        first.terminalEvidenceId,
        second.terminalEvidenceId,
        checkEvidenceId,
        terminal.id,
      ].sort(),
    },
    evidence: [terminal],
  });
}

function fakePool() {
  const headsByScan = new Map<string, Record<string, unknown>>();
  const invalidations = new Map<string, Record<string, unknown>>();
  const pool = {
    query: vi.fn(async (text: string, values?: readonly unknown[]) => {
      if (text.includes('INSERT INTO flap_lifetime_heads (')) {
        const row = rowFromInsert(values ?? []);
        headsByScan.set(String(row.scan_id), row);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO flap_lifetime_head_invalidations (')) {
        const row = rowFromInvalidationInsert(values ?? []);
        invalidations.set(String(row.id), row);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('COALESCE(MAX(sequence)')) {
        const next = headsByScan.size;
        return { rows: [{ next_sequence: String(next) }], rowCount: 1 };
      }
      if (text.includes('COALESCE(MAX(event_sequence)')) {
        return { rows: [{ next_sequence: String(invalidations.size) }], rowCount: 1 };
      }
      if (text.includes('WHERE id = $1') && text.includes('flap_lifetime_head_invalidations')) {
        const row = invalidations.get(String(values?.[0]));
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      if (text.includes('active_lineage AS')) {
        const all = [...headsByScan.values()].sort(
          (left, right) => Number(right.sequence) - Number(left.sequence),
        );
        const excluded = new Set(
          [...invalidations.values()].map((row) => String(row.invalidated_from_head_id)),
        );
        let changed = true;
        while (changed) {
          changed = false;
          for (const row of all) {
            if (
              row.predecessor_id !== null &&
              excluded.has(String(row.predecessor_id)) &&
              !excluded.has(String(row.id))
            ) {
              excluded.add(String(row.id));
              changed = true;
            }
          }
        }
        const latest = all.find((row) => !excluded.has(String(row.id)));
        const lineage: Record<string, unknown>[] = [];
        let current = latest;
        while (current !== undefined) {
          lineage.push(current);
          const predecessor = current.predecessor_id;
          current =
            predecessor === null
              ? undefined
              : all.find((row) => String(row.id) === String(predecessor));
        }
        return { rows: lineage, rowCount: lineage.length };
      }
      if (
        text.includes('FROM flap_lifetime_head_invalidations') &&
        text.includes('ORDER BY event_sequence DESC')
      ) {
        const rows = [...invalidations.values()].sort(
          (left, right) => Number(right.event_sequence) - Number(left.event_sequence),
        );
        return { rows: rows.slice(0, 1), rowCount: Math.min(rows.length, 1) };
      }
      const row = headsByScan.get(String(values?.[0]));
      return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
    }),
    end: vi.fn(async () => undefined),
  };
  return { pool, headsByScan, invalidations };
}

describe('PostgreSQL Flap lifetime heads', () => {
  it('appends one immutable extension to the exact stored predecessor', async () => {
    const { pool } = fakePool();
    const repository = PostgresFlapLifetimeHeadRepository.fromPool(pool);
    const initial = flapLifetimeInitialResult();
    const first = await repository.putHead({
      scanId: flapLifetimeInitialScanId,
      result: initial,
    });
    expect(first).toMatchObject({ sequence: 0, headType: 'INITIAL', predecessorId: null });

    const extension = flapLifetimeExtensionResult(initial);
    const second = await repository.putHead({
      scanId: flapLifetimeExtensionScanId,
      result: extension,
    });
    expect(second).toMatchObject({
      sequence: 1,
      headType: 'EXTENSION',
      predecessorId: first.id,
      targetBlock: 105,
    });
    await expect(
      repository.putHead({ scanId: flapLifetimeExtensionScanId, result: extension }),
    ).resolves.toEqual(second);
    await expect(repository.latestHead('eip155:56', flapLifetimeFixtureToken)).resolves.toEqual(
      second,
    );
    expect(
      pool.query.mock.calls.filter((call) =>
        String(call[0]).includes('INSERT INTO flap_lifetime_heads'),
      ).length,
    ).toBe(2);
  });

  it('invalidates an exact active suffix and exposes the surviving predecessor', async () => {
    const { pool } = fakePool();
    const repository = PostgresFlapLifetimeHeadRepository.fromPool(pool);
    const initial = flapLifetimeInitialResult();
    const first = await repository.putHead({
      scanId: flapLifetimeInitialScanId,
      result: initial,
    });
    const extension = flapLifetimeExtensionResult(initial);
    const second = await repository.putHead({
      scanId: flapLifetimeExtensionScanId,
      result: extension,
    });
    const rollback = rollbackResult(first, second);
    const invalidation = await repository.putInvalidation({ result: rollback });
    expect(invalidation).toMatchObject({
      eventSequence: 0,
      invalidatedFromHeadId: second.id,
      invalidatedThroughHeadId: second.id,
      rollbackToHeadId: first.id,
    });
    await expect(repository.putInvalidation({ result: rollback })).resolves.toEqual(invalidation);
    await expect(repository.latestHead('eip155:56', flapLifetimeFixtureToken)).resolves.toEqual(
      first,
    );
    await expect(
      repository.listActiveLineage('eip155:56', flapLifetimeFixtureToken),
    ).resolves.toEqual([first]);
    await expect(
      repository.latestInvalidation('eip155:56', flapLifetimeFixtureToken),
    ).resolves.toEqual(invalidation);
    await expect(
      repository.putHead({ scanId: flapLifetimeExtensionScanId, result: extension }),
    ).rejects.toMatchObject({ code: 'FLAP_LIFETIME_HEAD_CONFLICT' });
  });

  it('fails closed on a missing predecessor, corrupt stored state, and unavailable storage', async () => {
    const initial = flapLifetimeInitialResult();
    const extension = flapLifetimeExtensionResult(initial);
    const missing = PostgresFlapLifetimeHeadRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(async () => undefined),
    });
    await expect(
      missing.putHead({ scanId: flapLifetimeExtensionScanId, result: extension }),
    ).rejects.toMatchObject({ code: 'FLAP_LIFETIME_HEAD_CONFLICT' });

    const corrupt = PostgresFlapLifetimeHeadRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [
          rowFromInsert([
            `flh_${'0'.repeat(24)}`,
            'eip155:56',
            flapLifetimeFixtureToken,
            0,
            flapLifetimeInitialScanId,
            'INITIAL',
            null,
            103,
            flapLifetimeSnapshot(103).blockHash,
            'f'.repeat(64),
            JSON.stringify(initial),
            'e'.repeat(64),
            initial.terminalEvidenceId,
          ]),
        ],
        rowCount: 1,
      })),
      end: vi.fn(async () => undefined),
    });
    await expect(corrupt.latestHead('eip155:56', flapLifetimeFixtureToken)).rejects.toMatchObject({
      code: 'FLAP_LIFETIME_HEAD_CONFLICT',
    });

    const unavailable = PostgresFlapLifetimeHeadRepository.fromPool({
      query: vi.fn(async () => Promise.reject(new Error('postgresql://user:secret@example'))),
      end: vi.fn(async () => undefined),
    });
    await expect(
      unavailable.latestHead('eip155:56', flapLifetimeFixtureToken),
    ).rejects.toMatchObject({ code: 'FLAP_LIFETIME_HEAD_UNAVAILABLE', retryable: true });
    expect(JSON.stringify(await unavailable.health())).not.toMatch(/secret|example/);
  });

  it('reports migration-aware health and validates lookup identity', async () => {
    const initialized = PostgresFlapLifetimeHeadRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [
          {
            table_name: 'flap_lifetime_heads',
            invalidation_table: 'flap_lifetime_head_invalidations',
            migration_applied: true,
          },
        ],
        rowCount: 1,
      })),
      end: vi.fn(async () => undefined),
    });
    await expect(initialized.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(
      initialized.latestHead('eip155:1', flapLifetimeFixtureToken),
    ).rejects.toMatchObject({ code: 'FLAP_LIFETIME_HEAD_INVALID' });
    await expect(
      initialized.latestHead('eip155:56', flapLifetimeFixtureToken.toUpperCase()),
    ).rejects.toMatchObject({ code: 'FLAP_LIFETIME_HEAD_INVALID' });
  });
});
