import { describe, expect, it, vi } from 'vitest';

import type { EvmClaimAddressObservation } from '@zerotrace/schemas';

import { ClaimReportStorageError, PostgresClaimReportRepository } from './claim-reports.js';

const custodyEvidence = `ev_${'1'.repeat(24)}`;
const queryEvidence = `ev_${'2'.repeat(24)}`;
const flowEvidence = `ev_${'3'.repeat(24)}`;
const terminalEvidence = `ev_${'4'.repeat(24)}`;
const token = `0x${'a'.repeat(40)}`;
const subject = `0x${'b'.repeat(40)}`;
const counterparty = `0x${'c'.repeat(40)}`;

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'d'.repeat(64)}`,
  finality: 'finalized' as const,
  blockTimestamp: '2026-08-10T00:00:00.000Z',
  capturedAt: '2026-08-10T08:00:01+08:00',
  providerVersions: { fixture: '1' },
  adapterVersions: { claim: '1' },
  configHash: 'e'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-v1',
};

function report(): EvmClaimAddressObservation {
  const window = {
    from: '2026-08-02T00:00:00.000Z',
    to: '2026-08-10T00:00:00.000Z',
  };
  return {
    tokenAddress: token,
    address: subject,
    fromBlock: '90',
    toBlock: '100',
    window,
    custody: {
      address: subject,
      kind: 'SAFE_MULTISIG',
      canMoveFunds: { state: 'known', value: true },
      threshold: 2,
      ownerCount: 3,
      executedTransactions: 1,
      implementationAddress: `0x${'f'.repeat(40)}`,
      implementationVersion: '1.3.0',
      evidenceIds: [custodyEvidence],
    },
    custodyMetadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: ['rpc:bsc'],
      modelVersion: 'safe-compatible-read-v1.1.0',
      confidence: 0.95,
      evidenceIds: [custodyEvidence],
    },
    flow: {
      address: subject,
      window,
      inflow: {
        observedAmount: '1000000',
        actualAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        transferCount: 1,
        uniqueCounterparties: 1,
        firstObservedAt: { state: 'known', value: '2026-08-03T00:00:00.000Z' },
        lastObservedAt: { state: 'known', value: '2026-08-03T00:00:00.000Z' },
        evidenceIds: [flowEvidence],
      },
      outflow: {
        observedAmount: '0',
        actualAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        transferCount: 0,
        uniqueCounterparties: 0,
        firstObservedAt: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        lastObservedAt: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        evidenceIds: [],
      },
      shareUnitAssessment: {
        unit: '1000000',
        observedDeposits: 1,
        exactUnitDeposits: 1,
        exactMultipleDeposits: 1,
        nonMultipleDeposits: 0,
        observedWholeShares: '1',
        nonMultipleObservedAmount: '0',
        exactMultipleCoverage: { state: 'known', value: 1 },
      },
      selfTransferCount: 0,
      selfTransferObservedAmount: '0',
      topCounterparties: [
        {
          direction: 'INFLOW',
          address: counterparty,
          observedAmount: '1000000',
          transferCount: 1,
          firstObservedAt: '2026-08-03T00:00:00.000Z',
          lastObservedAt: '2026-08-03T00:00:00.000Z',
          evidenceIds: [flowEvidence],
        },
      ],
      metadata: {
        snapshot,
        dataCoverage: 1,
        sourceCoverage: 0.5,
        historyCoverage: 1,
        simulationCoverage: 0,
        freshness: snapshot.blockTimestamp,
        sourceSet: ['sqd:bsc'],
        modelVersion: 'claim-flow-summary-v1.0.0',
        confidence: 0.95,
        evidenceIds: [flowEvidence, queryEvidence].sort(),
      },
    },
    terminalEvidenceId: terminalEvidence,
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: ['rpc:bsc', 'sqd:bsc'],
      modelVersion: 'evm-claim-address-observation-v1.0.0',
      confidence: 0.95,
      evidenceIds: [custodyEvidence, flowEvidence, queryEvidence, terminalEvidence].sort(),
    },
  };
}

function storedRow(values: readonly unknown[]): Record<string, unknown> {
  return {
    id: values[0],
    chain_id: values[1],
    token_address: values[2],
    subject_address: values[3],
    from_block: values[4],
    to_block: values[5],
    snapshot_block: values[6],
    snapshot_hash: values[7],
    result_hash: values[8],
    report: values[9],
    terminal_evidence_id: values[10],
    evidence_ids: values[11],
    source_set: values[12],
    model_version: values[13],
    captured_at: values[14],
    created_at: '2026-08-10T00:00:02.000Z',
  };
}

describe('Postgres Claim Report repository', () => {
  it('writes once, hash-verifies replay, and reads the latest subject report', async () => {
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO evm_claim_reports')) {
        row ??= storedRow(values);
        return { rows: [], rowCount: 1 };
      }
      return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
    });
    const repository = PostgresClaimReportRepository.fromPool({ query, end: vi.fn() });

    const first = await repository.put(report());
    const second = await repository.put(report());
    const latest = await repository.latest('eip155:56', token, subject);

    expect(first.id).toMatch(/^ecr_[0-9a-f]{24}$/);
    expect(second).toEqual(first);
    expect(latest).toEqual(first);
    expect(query.mock.calls.filter(([text]) => String(text).includes('INSERT INTO'))).toHaveLength(
      1,
    );
    expect(first).toMatchObject({
      tokenAddress: token,
      address: subject,
      snapshotBlock: '100',
      terminalEvidenceId: terminalEvidence,
      capturedAt: '2026-08-10T00:00:01.000Z',
    });
  });

  it('rejects missing nested provenance and corrupt stored content', async () => {
    const invalid = report();
    invalid.metadata.evidenceIds = invalid.metadata.evidenceIds.filter(
      (item) => item !== flowEvidence,
    );
    const repository = PostgresClaimReportRepository.fromPool({
      query: vi.fn(),
      end: vi.fn(),
    });
    await expect(repository.put(invalid)).rejects.toMatchObject({
      code: 'CLAIM_REPORT_INVALID',
    });

    const valid = report();
    let corruptRow: Record<string, unknown> | undefined;
    const corrupt = PostgresClaimReportRepository.fromPool({
      query: vi.fn(async (text: string, values: readonly unknown[] = []) => {
        if (text.includes('INSERT INTO evm_claim_reports')) {
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
    await expect(corrupt.put(valid)).rejects.toBeInstanceOf(ClaimReportStorageError);
    await expect(corrupt.put(valid)).rejects.toMatchObject({ code: 'CLAIM_REPORT_CONFLICT' });
  });

  it('reports migration-aware health and validates read identities before querying', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ table_name: 'evm_claim_reports', migration_applied: true }],
      rowCount: 1,
    });
    const repository = PostgresClaimReportRepository.fromPool({ query, end: vi.fn() });
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'CLAIM_REPORT_INVALID',
    });
    await expect(repository.latest('eip155:0', token, subject)).rejects.toMatchObject({
      code: 'CLAIM_REPORT_INVALID',
    });
    expect(query).toHaveBeenCalledTimes(1);

    const missingMigration = PostgresClaimReportRepository.fromPool({
      query: vi.fn().mockResolvedValue({
        rows: [{ table_name: 'evm_claim_reports', migration_applied: false }],
        rowCount: 1,
      }),
      end: vi.fn(),
    });
    await expect(missingMigration.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'CLAIM_REPORT_NOT_INITIALIZED',
    });

    const unavailable = PostgresClaimReportRepository.fromPool({
      query: vi.fn().mockRejectedValue(new Error('offline')),
      end: vi.fn(),
    });
    await expect(unavailable.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'CLAIM_REPORT_UNAVAILABLE',
    });
  });
});
