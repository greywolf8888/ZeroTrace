import { describe, expect, it, vi } from 'vitest';

import type { EvmPensionCandidateDiscovery } from '@zerotrace/schemas';

import {
  PensionCandidateReportStorageError,
  PostgresPensionCandidateReportRepository,
} from './pension-candidate-reports.js';

const tokenAddress = `0x${'1'.repeat(40)}`;
const coverageEvidence = `ev_${'1'.repeat(24)}`;
const terminalEvidence = `ev_${'2'.repeat(24)}`;
const capturedAt = '2026-08-11T05:00:01.000Z';

function report(): EvmPensionCandidateDiscovery {
  return {
    tokenAddress,
    fromBlock: '100',
    toBlock: '120',
    policy: {
      shareUnitAtomic: '1000000000000000000000000',
      minimumExactUnitDeposits: 3,
      minimumUniqueExactUnitDepositors: 3,
      maximumCandidates: 20,
    },
    scannedTransferCount: 0,
    candidates: [],
    coverageEvidenceIds: [coverageEvidence],
    terminalEvidenceId: terminalEvidence,
    metadata: {
      snapshot: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        blockNumber: '120',
        blockHash: `0x${'f'.repeat(64)}`,
        parentBlockHash: `0x${'e'.repeat(64)}`,
        finality: 'finalized',
        blockTimestamp: capturedAt,
        capturedAt,
        providerVersions: { fixture: '1' },
        adapterVersions: { evm: '1' },
        configHash: 'c'.repeat(64),
        entityModelVersion: 'entity-v0.1.0',
        labelSnapshot: 'labels-v1',
      },
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: capturedAt,
      sourceSet: ['sqd:binance-mainnet'],
      modelVersion: 'evm-pension-candidate-discovery-v1.0.0',
      confidence: 0.75,
      evidenceIds: [coverageEvidence, terminalEvidence],
    },
  };
}

function storedRow(values: readonly unknown[]): Record<string, unknown> {
  return {
    id: values[0],
    chain_id: values[1],
    token_address: values[2],
    from_block: values[3],
    to_block: values[4],
    snapshot_hash: values[5],
    result_hash: values[6],
    report: values[7],
    terminal_evidence_id: values[8],
    evidence_ids: values[9],
    source_set: values[10],
    model_version: values[11],
    captured_at: values[12],
    created_at: '2026-08-11T05:00:02.000Z',
  };
}

describe('Postgres EVM pension candidate report repository', () => {
  it('writes once and replays the immutable latest report', async () => {
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO evm_pension_candidate_reports')) {
        row ??= storedRow(values);
        return { rows: [], rowCount: 1 };
      }
      return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
    });
    const repository = PostgresPensionCandidateReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    const first = await repository.put(report());
    const second = await repository.put(report());
    const latest = await repository.latest(tokenAddress);

    expect(first.id).toMatch(/^pcr_[0-9a-f]{24}$/);
    expect(second).toEqual(first);
    expect(latest).toEqual(first);
    expect(first).toMatchObject({
      chainId: 'eip155:56',
      tokenAddress,
      fromBlock: '100',
      toBlock: '120',
      terminalEvidenceId: terminalEvidence,
      capturedAt,
    });
    expect(query.mock.calls.filter(([text]) => String(text).includes('INSERT INTO'))).toHaveLength(
      1,
    );
  });

  it('rejects invalid input and corrupt replay content', async () => {
    const invalid = report();
    invalid.metadata.evidenceIds = [terminalEvidence];
    const repository = PostgresPensionCandidateReportRepository.fromPool({
      query: vi.fn(),
      end: vi.fn(),
    });
    await expect(repository.put(invalid)).rejects.toMatchObject({
      code: 'PENSION_CANDIDATE_REPORT_INVALID',
    });

    let corruptRow: Record<string, unknown> | undefined;
    const corrupt = PostgresPensionCandidateReportRepository.fromPool({
      query: vi.fn(async (text: string, values: readonly unknown[] = []) => {
        if (text.includes('INSERT INTO evm_pension_candidate_reports')) {
          corruptRow = { ...storedRow(values), result_hash: '0'.repeat(64) };
          return { rows: [], rowCount: 1 };
        }
        return {
          rows: corruptRow === undefined ? [] : [corruptRow],
          rowCount: corruptRow === undefined ? 0 : 1,
        };
      }),
      end: vi.fn(),
    });
    await expect(corrupt.put(report())).rejects.toBeInstanceOf(PensionCandidateReportStorageError);
    await expect(corrupt.put(report())).rejects.toMatchObject({
      code: 'PENSION_CANDIDATE_REPORT_CONFLICT',
    });
  });

  it('checks migration health and validates lookup identities before querying', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ table_name: 'evm_pension_candidate_reports', migration_applied: true }],
      rowCount: 1,
    });
    const repository = PostgresPensionCandidateReportRepository.fromPool({
      query,
      end: vi.fn(),
    });
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'PENSION_CANDIDATE_REPORT_INVALID',
    });
    await expect(repository.latest('invalid')).rejects.toMatchObject({
      code: 'PENSION_CANDIDATE_REPORT_INVALID',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
