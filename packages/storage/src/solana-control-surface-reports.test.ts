import { describe, expect, it, vi } from 'vitest';

import {
  SolanaControlCoverageDomainSchema,
  type SolanaControlSurfaceReport,
} from '@zerotrace/schemas';

import { ControlSurfaceReportStorageError } from './control-surface-reports.js';
import { PostgresSolanaControlSurfaceRepository } from './solana-control-surface-reports.js';

const subject = 'So11111111111111111111111111111111111111112';
const terminalEvidence = `ev_${'1'.repeat(24)}`;
const capturedAt = '2026-08-11T00:00:01.000Z';
const blockhash = '3ySAYPQqMfpyZL6QhH4RzgT68HWpV72G2JAa2XWrpHEi';

function report(): SolanaControlSurfaceReport {
  const snapshot = {
    ledger: 'SOLANA' as const,
    chainId: 'solana-mainnet' as const,
    slot: '100',
    blockhash,
    parentSlot: '99',
    previousBlockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
    commitment: 'finalized' as const,
    blockTimestamp: '2026-08-11T00:00:00.000Z',
    capturedAt,
    providerVersions: { fixture: 'solana-json-rpc' },
    adapterVersions: { solana: 'fixture' },
    configHash: 'd'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
  return {
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    subject,
    accountKind: { state: 'known', value: 'SPL_TOKEN_MINT' },
    ownerProgram: { state: 'known', value: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
    executable: { state: 'known', value: false },
    mint: {
      state: 'known',
      value: {
        tokenProgram: 'SPL_TOKEN',
        supply: '0',
        decimals: 9,
        initialized: true,
        mintAuthority: { state: 'unknown', reason: 'NOT_APPLICABLE' },
        freezeAuthority: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      },
    },
    tokenAccount: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    multisig: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    program: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    extensions: [],
    sourceAgreement: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    sourceIndependence: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    rights: [],
    coverage: SolanaControlCoverageDomainSchema.options.map((domain) => ({
      domain,
      observed:
        domain === 'ACCOUNT_STATE'
          ? ({ state: 'known', value: true } as const)
          : ({ state: 'unknown', reason: 'NOT_QUERIED' } as const),
      detail: `${domain} fixture coverage.`,
      evidenceIds: domain === 'ACCOUNT_STATE' ? [terminalEvidence] : [],
    })),
    terminalEvidenceId: terminalEvidence,
    metadata: {
      snapshot,
      dataCoverage: 1 / SolanaControlCoverageDomainSchema.options.length,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: ['fixture'],
      modelVersion: 'solana-control-surface-v1.0.0',
      confidence: 0.8,
      evidenceIds: [terminalEvidence],
    },
    evidence: [
      {
        id: terminalEvidence,
        ledger: 'SOLANA',
        chainId: 'solana-mainnet',
        kind: 'DERIVED_FEATURE',
        source: 'zerotrace:solana-control-surface-v1.0.0',
        locator: `solana-control-surface-report:${subject}@${blockhash}`,
        payloadHash: 'e'.repeat(64),
        observedAt: capturedAt,
        blockOrSlot: '100',
        finality: 'finalized',
        summary: 'Fixture Solana control surface.',
      },
    ],
  };
}

function storedRow(values: readonly unknown[]): Record<string, unknown> {
  return {
    id: values[0],
    chain_id: values[1],
    subject_address: values[2],
    snapshot_slot: values[3],
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

describe('Postgres Solana control surface repository', () => {
  it('writes once, verifies immutable replay, and reads latest by subject', async () => {
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO solana_control_surface_reports')) {
        row ??= storedRow(values);
        return { rows: [], rowCount: 1 };
      }
      return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
    });
    const repository = PostgresSolanaControlSurfaceRepository.fromPool({ query, end: vi.fn() });

    const first = await repository.put(report());
    const second = await repository.put(report());
    const latest = await repository.latest(subject);

    expect(first.id).toMatch(/^scs_[0-9a-f]{24}$/);
    expect(second).toEqual(first);
    expect(latest).toEqual(first);
    expect(query.mock.calls.filter(([text]) => String(text).includes('INSERT INTO'))).toHaveLength(
      1,
    );
    expect(first).toMatchObject({
      chainId: 'solana-mainnet',
      subject,
      snapshotSlot: '100',
      terminalEvidenceId: terminalEvidence,
      capturedAt,
    });
  });

  it('rejects invalid provenance and corrupt replay content', async () => {
    const invalid = report();
    invalid.metadata.evidenceIds = [];
    const repository = PostgresSolanaControlSurfaceRepository.fromPool({
      query: vi.fn(),
      end: vi.fn(),
    });
    await expect(repository.put(invalid)).rejects.toMatchObject({
      code: 'CONTROL_SURFACE_INVALID',
    });

    let corruptRow: Record<string, unknown> | undefined;
    const corrupt = PostgresSolanaControlSurfaceRepository.fromPool({
      query: vi.fn(async (text: string, values: readonly unknown[] = []) => {
        if (text.includes('INSERT INTO solana_control_surface_reports')) {
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

  it('reports migration health and validates IDs before querying', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ table_name: 'solana_control_surface_reports', migration_applied: true }],
      rowCount: 1,
    });
    const repository = PostgresSolanaControlSurfaceRepository.fromPool({ query, end: vi.fn() });
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'CONTROL_SURFACE_INVALID',
    });
    await expect(repository.latest('invalid')).rejects.toMatchObject({
      code: 'CONTROL_SURFACE_INVALID',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
