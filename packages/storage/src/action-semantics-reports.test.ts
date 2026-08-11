import { describe, expect, it, vi } from 'vitest';

import { buildActionSemanticsReport, createActionCandidate } from '@zerotrace/action-semantics';
import { canonicalJson, createEvidence } from '@zerotrace/evidence';
import { knownValue } from '@zerotrace/schemas';

import {
  ActionSemanticsReportStorageError,
  PostgresActionSemanticsReportRepository,
} from './action-semantics-reports.js';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '50000000',
  blockHash: `0x${'ab'.repeat(32)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-12T00:00:10.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { actions: 'action-semantics-v0.1.0' },
  configHash: 'ef'.repeat(32),
  entityModelVersion: 'entity-v1',
  labelSnapshot: 'labels-v1',
};

function report() {
  const evidence = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'RECEIPT',
    source: 'bsc-rpc@test',
    locator: 'action-storage',
    payload: { status: '0x1' },
    observedAt: '2026-08-12T00:00:09.000Z',
    blockOrSlot: snapshot.blockNumber,
    finality: 'finalized',
    summary: 'Action storage source.',
  });
  const candidate = createActionCandidate({
    ledger: 'EVM',
    chainId: 'eip155:56',
    transactionId: `0x${'AA'.repeat(32)}`,
    blockOrSlot: snapshot.blockNumber,
    observedAt: evidence.observedAt,
    proposedKind: 'CONTRACT_CALL',
    application: 'APPLIED',
    actor: knownValue('0x1111111111111111111111111111111111111111'),
    proofKinds: ['EXECUTION_RECEIPT'],
    evidenceIds: [evidence.id],
  });
  return buildActionSemanticsReport({
    snapshot,
    candidates: [candidate],
    evidence: [evidence],
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 0,
  });
}

describe('PostgresActionSemanticsReportRepository', () => {
  it('stores one canonical report and queries an uppercase EVM transaction as lowercase', async () => {
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO action_semantics_reports')) {
        row = {
          id: values[0],
          ledger: values[1],
          chain_id: values[2],
          snapshot_position: values[3],
          snapshot_hash: values[4],
          transaction_ids: values[5],
          result_hash: values[6],
          report: JSON.parse(String(values[7])) as unknown,
          terminal_evidence_id: values[8],
          evidence_ids: values[9],
          source_set: values[10],
          model_version: values[11],
          classification_coverage: values[12],
          captured_at: values[13],
          created_at: '2026-08-12T00:00:11.000Z',
        };
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM action_semantics_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresActionSemanticsReportRepository.fromPool({
      query,
      end: vi.fn(),
    });
    const stored = await repository.put(report());
    expect(stored.id).toMatch(/^asr_[0-9a-f]{24}$/);
    await expect(
      repository.latest({
        ledger: 'EVM',
        chainId: 'eip155:56',
        transactionId: `0x${'AA'.repeat(32)}`,
      }),
    ).resolves.toEqual(stored);
    const latestCall = query.mock.calls.find(([text]) =>
      String(text).includes('transaction_ids @>'),
    );
    expect(latestCall?.[1]).toEqual(['EVM', 'eip155:56', `0x${'aa'.repeat(32)}`]);
  });

  it('rejects a self-inconsistent result before touching storage', async () => {
    const query = vi.fn();
    const repository = PostgresActionSemanticsReportRepository.fromPool({
      query,
      end: vi.fn(),
    });
    const tampered = { ...report(), resultHash: '00'.repeat(32) };
    await expect(repository.put(tampered)).rejects.toMatchObject({
      code: 'ACTION_SEMANTICS_REPORT_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when a stored report no longer matches its materialized identity', async () => {
    const canonical = report();
    const first = PostgresActionSemanticsReportRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(first.put(canonical)).rejects.toBeInstanceOf(ActionSemanticsReportStorageError);

    const corrupt = PostgresActionSemanticsReportRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [
          {
            id: 'asr_000000000000000000000000',
            ledger: 'EVM',
            chain_id: canonical.snapshot.chainId,
            snapshot_position: snapshot.blockNumber,
            snapshot_hash: snapshot.blockHash,
            transaction_ids: canonical.actions.map((item) => item.transactionId),
            result_hash: canonical.resultHash,
            report: canonical,
            terminal_evidence_id: canonical.terminalEvidenceId,
            evidence_ids: canonical.metadata.evidenceIds,
            source_set: canonical.metadata.sourceSet,
            model_version: canonical.metadata.modelVersion,
            classification_coverage: canonical.classificationCoverage,
            captured_at: canonical.snapshot.capturedAt,
            created_at: canonical.snapshot.capturedAt,
          },
        ],
        rowCount: 1,
      })),
      end: vi.fn(),
    });
    await expect(corrupt.get('asr_000000000000000000000000')).rejects.toMatchObject({
      code: 'ACTION_SEMANTICS_REPORT_CONFLICT',
    });
    expect(canonicalJson(canonical.metadata.sourceSet)).toBe(canonicalJson(['bsc-rpc@test']));
  });

  it('reports migration 025 health explicitly', async () => {
    const initialized = PostgresActionSemanticsReportRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ table_name: 'action_semantics_reports', migration_applied: true }],
        rowCount: 1,
      })),
      end: vi.fn(),
    });
    await expect(initialized.health()).resolves.toMatchObject({ status: 'UP', durable: true });

    const missing = PostgresActionSemanticsReportRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      })),
      end: vi.fn(),
    });
    await expect(missing.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'ACTION_SEMANTICS_REPORT_NOT_INITIALIZED',
    });
  });
});
