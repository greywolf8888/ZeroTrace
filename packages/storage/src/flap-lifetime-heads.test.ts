import { describe, expect, it, vi } from 'vitest';

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

describe('PostgreSQL Flap lifetime heads', () => {
  it('appends one immutable extension to the exact stored predecessor', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const pool = {
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        if (text.includes('INSERT INTO flap_lifetime_heads')) {
          const row = rowFromInsert(values ?? []);
          rows.set(String(row.scan_id), row);
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('ORDER BY sequence DESC')) {
          const all = [...rows.values()].sort(
            (left, right) => Number(right.sequence) - Number(left.sequence),
          );
          return { rows: all.slice(0, 1), rowCount: Math.min(all.length, 1) };
        }
        const row = rows.get(String(values?.[0]));
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }),
      end: vi.fn(async () => undefined),
    };
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
      pool.query.mock.calls.filter((call) => String(call[0]).includes('INSERT INTO')).length,
    ).toBe(2);
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
        rows: [{ table_name: 'flap_lifetime_heads', migration_applied: true }],
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
