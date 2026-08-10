import { describe, expect, it, vi } from 'vitest';

import { EvmControlCoverageDomainSchema, type EvmControlSurfaceReport } from '@zerotrace/schemas';

import {
  ControlSurfaceReportStorageError,
  PostgresEvmControlSurfaceRepository,
} from './control-surface-reports.js';

const subject = `0x${'a'.repeat(40)}`;
const terminalEvidence = `ev_${'1'.repeat(24)}`;
const capturedAt = '2026-08-11T00:00:01.000Z';
const blockHash = `0x${'b'.repeat(64)}`;

function report(): EvmControlSurfaceReport {
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '100',
    blockHash,
    parentBlockHash: `0x${'c'.repeat(64)}`,
    finality: 'finalized' as const,
    blockTimestamp: '2026-08-11T00:00:00.000Z',
    capturedAt,
    providerVersions: { fixture: 'json-rpc' },
    adapterVersions: { evm: 'fixture' },
    configHash: 'd'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
  return {
    ledger: 'EVM',
    chainId: 'eip155:56',
    subject,
    contractKind: { state: 'known', value: 'DIRECT_CONTRACT' },
    implementationAddress: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    proxyAdminAddress: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    beaconAddress: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    ownerAddress: { state: 'unknown', reason: 'UNSUPPORTED' },
    safe: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    logicCode: {
      state: 'known',
      value: {
        address: subject,
        relation: 'SUBJECT',
        runtimeBytecodeHash: `0x${'f'.repeat(64)}`,
        runtimeBytecodeBytes: 2,
      },
    },
    verifiedSource: { state: 'unknown', reason: 'PROVIDER_UNCONFIGURED' },
    declaredCapabilities: [],
    sourceAgreement: { state: 'known', value: true },
    sourceIndependence: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    rights: [],
    coverage: EvmControlCoverageDomainSchema.options.map((domain) => ({
      domain,
      observed:
        domain === 'CONTRACT_CODE'
          ? ({ state: 'known', value: true } as const)
          : ({ state: 'unknown', reason: 'NOT_QUERIED' } as const),
      detail: `${domain} fixture coverage.`,
      evidenceIds: domain === 'CONTRACT_CODE' ? [terminalEvidence] : [],
    })),
    terminalEvidenceId: terminalEvidence,
    metadata: {
      snapshot,
      dataCoverage: 1 / EvmControlCoverageDomainSchema.options.length,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: ['fixture'],
      modelVersion: 'evm-control-surface-v1.1.0',
      confidence: 0.8,
      evidenceIds: [terminalEvidence],
    },
    evidence: [
      {
        id: terminalEvidence,
        ledger: 'EVM',
        chainId: 'eip155:56',
        kind: 'DERIVED_FEATURE',
        source: 'zerotrace:evm-control-surface-v1.1.0',
        locator: `evm-control-surface-report:${subject}@${blockHash}`,
        payloadHash: 'e'.repeat(64),
        observedAt: capturedAt,
        blockOrSlot: '100',
        finality: 'finalized',
        summary: 'Fixture EVM control surface.',
      },
    ],
  };
}

function storedRow(values: readonly unknown[]): Record<string, unknown> {
  return {
    id: values[0],
    chain_id: values[1],
    subject_address: values[2],
    snapshot_block: values[3],
    snapshot_hash: values[4],
    result_hash: values[5],
    report: values[6],
    terminal_evidence_id: values[7],
    evidence_ids: values[8],
    source_set: values[9],
    model_version: values[10],
    captured_at: values[11],
    created_at: '2026-08-11T00:00:02.000Z',
  };
}

describe('Postgres EVM control surface repository', () => {
  it('replays immutable v1.0 reports without fabricating v1.1 source fields', async () => {
    const legacy = report();
    delete legacy.logicCode;
    delete legacy.verifiedSource;
    delete legacy.declaredCapabilities;
    legacy.coverage = legacy.coverage.filter(
      (item) => !['LOGIC_CODE', 'MIGRATION'].includes(item.domain),
    );
    legacy.metadata.modelVersion = 'evm-control-surface-v1.0.0';
    legacy.metadata.dataCoverage = 1 / legacy.coverage.length;
    const source = legacy.evidence[0];
    if (source !== undefined) source.source = 'zerotrace:evm-control-surface-v1.0.0';
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO evm_control_surface_reports')) {
        row ??= storedRow(values);
        return { rows: [], rowCount: 1 };
      }
      return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
    });
    const repository = PostgresEvmControlSurfaceRepository.fromPool({ query, end: vi.fn() });

    const stored = await repository.put(legacy);
    expect(stored.report.logicCode).toBeUndefined();
    expect(stored.report.coverage).toHaveLength(23);
    await expect(repository.get(stored.id)).resolves.toEqual(stored);
  });

  it('writes once, verifies replay, and reads the latest report', async () => {
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO evm_control_surface_reports')) {
        row ??= storedRow(values);
        return { rows: [], rowCount: 1 };
      }
      return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
    });
    const repository = PostgresEvmControlSurfaceRepository.fromPool({ query, end: vi.fn() });

    const first = await repository.put(report());
    const second = await repository.put(report());
    const latest = await repository.latest('eip155:56', subject);

    expect(first.id).toMatch(/^ecs_[0-9a-f]{24}$/);
    expect(second).toEqual(first);
    expect(latest).toEqual(first);
    expect(query.mock.calls.filter(([text]) => String(text).includes('INSERT INTO'))).toHaveLength(
      1,
    );
    expect(first).toMatchObject({
      chainId: 'eip155:56',
      subject,
      snapshotBlock: '100',
      terminalEvidenceId: terminalEvidence,
      capturedAt,
    });
  });

  it('rejects invalid provenance and corrupt stored content', async () => {
    const invalid = report();
    invalid.metadata.evidenceIds = [];
    const repository = PostgresEvmControlSurfaceRepository.fromPool({
      query: vi.fn(),
      end: vi.fn(),
    });
    await expect(repository.put(invalid)).rejects.toMatchObject({
      code: 'CONTROL_SURFACE_INVALID',
    });

    let corruptRow: Record<string, unknown> | undefined;
    const corrupt = PostgresEvmControlSurfaceRepository.fromPool({
      query: vi.fn(async (text: string, values: readonly unknown[] = []) => {
        if (text.includes('INSERT INTO evm_control_surface_reports')) {
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
    await expect(corrupt.put(report())).rejects.toBeInstanceOf(ControlSurfaceReportStorageError);
    await expect(corrupt.put(report())).rejects.toMatchObject({
      code: 'CONTROL_SURFACE_CONFLICT',
    });
  });

  it('reports migration health and validates identities before querying', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ table_name: 'evm_control_surface_reports', migration_applied: true }],
      rowCount: 1,
    });
    const repository = PostgresEvmControlSurfaceRepository.fromPool({ query, end: vi.fn() });
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'CONTROL_SURFACE_INVALID',
    });
    await expect(repository.latest('eip155:0', subject)).rejects.toMatchObject({
      code: 'CONTROL_SURFACE_INVALID',
    });
    expect(query).toHaveBeenCalledTimes(1);

    const unavailable = PostgresEvmControlSurfaceRepository.fromPool({
      query: vi.fn().mockRejectedValue(new Error('offline')),
      end: vi.fn(),
    });
    await expect(unavailable.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'CONTROL_SURFACE_UNAVAILABLE',
    });
  });
});
