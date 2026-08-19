import { describe, expect, it, vi } from 'vitest';

import {
  buildReportEnvelope,
  coverageFromRatios,
  inconclusiveSourceIndependence,
} from '@zerotrace/evidence';

import {
  ForensicReportStorageError,
  PostgresForensicReportRepository,
} from './forensic-reports.js';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '10',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-19T00:00:00.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unapplied',
};

function envelope() {
  return buildReportEnvelope({
    schemaVersion: 'report-envelope-v1',
    reportType: 'supply-reality-v1',
    schemaContractVersion: 'supply-reality-v1',
    modelVersion: 'forensic-v1',
    policyVersion: 'policy-v1',
    subject: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectType: 'TOKEN',
      identifier: `0x${'c'.repeat(40)}`,
    },
    snapshot,
    status: 'PARTIAL',
    coverage: coverageFromRatios({ historyCoverage: 0.5 }),
    sourceSet: ['unit'],
    sourceIndependence: inconclusiveSourceIndependence(
      `ev_${'2'.repeat(24)}`,
      `ev_${'3'.repeat(24)}`,
    ),
    evidenceClosure: [`ev_${'1'.repeat(24)}`, `ev_${'2'.repeat(24)}`].sort(),
    createdAt: '2026-08-19T00:00:00.000Z',
    replayRef: {
      command: 'unit',
      snapshot,
      modelVersion: 'forensic-v1',
      policyVersion: 'policy-v1',
      inputHash: 'c'.repeat(64),
    },
    payload: { ok: true },
  });
}

describe('PostgresForensicReportRepository', () => {
  it('persists, reads, and reports health without inventing empty reports', async () => {
    const stored = envelope();
    const query = vi.fn(async (text: string) => {
      if (text.includes('INSERT INTO forensic_reports')) return { rows: [] };
      if (text.includes('ORDER BY created_at DESC')) return { rows: [{ payload: stored }] };
      if (text.includes('WHERE id = $1')) return { rows: [{ payload: stored }] };
      if (text.trim() === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresForensicReportRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });
    await expect(repository.put(stored)).resolves.toMatchObject({ id: stored.id });
    await expect(
      repository.latest('supply-reality-v1', 'eip155:56', `0x${'c'.repeat(40)}`),
    ).resolves.toMatchObject({ id: stored.id });
    await expect(repository.get(stored.id)).resolves.toMatchObject({
      reportType: stored.reportType,
    });
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await repository.close();
  });

  it('keeps missing reads undefined and fail-closes conflicts', async () => {
    const stored = envelope();
    const query = vi.fn(async (text: string) => {
      if (text.includes('INSERT INTO forensic_reports')) {
        const error = new Error('duplicate') as Error & { code?: string };
        error.code = '23505';
        throw error;
      }
      if (text.includes('SELECT payload')) return { rows: [] };
      if (text.trim() === 'SELECT 1') throw new Error('down');
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresForensicReportRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });
    await expect(repository.put(stored)).rejects.toBeInstanceOf(ForensicReportStorageError);
    await expect(repository.latest('supply-reality-v1', 'eip155:56', 'missing')).resolves.toBe(
      undefined,
    );
    await expect(repository.get('missing')).resolves.toBeUndefined();
    await expect(repository.health()).resolves.toMatchObject({ status: 'DOWN' });
  });
});
