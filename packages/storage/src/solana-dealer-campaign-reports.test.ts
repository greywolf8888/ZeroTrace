import { describe, expect, it, vi } from 'vitest';

import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  SolanaDealerCampaignReportSchema,
  type SolanaDealerCampaignReport,
} from '@zerotrace/schemas';
import {
  PostgresSolanaDealerCampaignReportRepository,
  SolanaDealerCampaignReportStorageError,
} from './solana-dealer-campaign-reports.js';

const mint = '11111111111111111111111111111111';

function report(): SolanaDealerCampaignReport {
  const snapshot = {
    ledger: 'SOLANA' as const,
    chainId: 'solana-mainnet' as const,
    slot: '100',
    blockhash: mint,
    commitment: 'finalized' as const,
    capturedAt: '2026-08-14T00:00:00.000Z',
    providerVersions: { 'solana-rpc': 'test' },
    adapterVersions: { solana: 'test' },
    configHash: 'a'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-empty-v1',
  };
  const evidence = createEvidence({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    kind: 'PROVIDER_OBSERVATION',
    source: 'solana-test',
    locator: 'dealer:100',
    payload: { mint, fromSlot: '1', toSlot: '100' },
    blockOrSlot: '100',
    observedAt: snapshot.capturedAt,
    summary: 'Finalized Solana dealer test observation.',
  });
  const value = {
    schemaVersion: 'solana-dealer-campaign-report-v1' as const,
    ledger: 'SOLANA' as const,
    chainId: 'solana-mainnet' as const,
    mint,
    fromSlot: '1',
    toSlot: '100',
    status: 'UNKNOWN' as const,
    origin: { state: 'unknown' as const, reason: 'NOT_QUERIED' as const },
    holders: [],
    tokenFlowEdges: [],
    solTransfers: [],
    fundingEdges: [],
    settlementEdges: [],
    openingBalanceUnknownWalletIds: [],
    pdaSuppressedOwnerIds: [],
    campaign: null,
    alerts: [],
    evidence: [evidence],
    snapshot,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    freshness: snapshot.capturedAt,
    sourceSet: ['solana-test'],
    modelVersion: 'solana-dealer-campaign-v1.0.0' as const,
    policyVersion: 'solana-dealer-policy-v1.0.0' as const,
    evidenceIds: [evidence.id],
  };
  return SolanaDealerCampaignReportSchema.parse({
    ...value,
    id: `sdc_${hashPayload({ schema: value.schemaVersion, value }).slice(0, 24)}`,
    resultHash: hashPayload(value),
  });
}

function rowFor(value: SolanaDealerCampaignReport): Record<string, unknown> {
  if (value.snapshot.ledger !== 'SOLANA') {
    throw new Error('Expected a Solana snapshot in the test fixture.');
  }
  return {
    id: value.id,
    chain_id: value.chainId,
    mint: value.mint,
    snapshot_slot: value.snapshot.slot,
    snapshot_hash: value.snapshot.blockhash,
    result_hash: value.resultHash,
    report: value,
    evidence_ids: value.evidenceIds,
    source_set: value.sourceSet,
    model_version: value.modelVersion,
    policy_version: value.policyVersion,
    captured_at: new Date(value.freshness),
    created_at: value.freshness,
  };
}

describe('Postgres Solana dealer campaign report repository', () => {
  it('fails closed for invalid reports and validates replay identities', async () => {
    const repository = PostgresSolanaDealerCampaignReportRepository.fromPool({
      query: vi.fn(),
      end: vi.fn(),
    });
    await expect(repository.put({} as never)).rejects.toMatchObject({
      code: 'SOLANA_DEALER_REPORT_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'SOLANA_DEALER_REPORT_INVALID',
    });
    await expect(repository.latest('invalid')).rejects.toMatchObject({
      code: 'SOLANA_DEALER_REPORT_INVALID',
    });
  });

  it('checks migration health without treating an unavailable table as ready', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ table_name: 'solana_dealer_campaign_reports', migration_applied: true }],
      rowCount: 1,
    });
    const repository = PostgresSolanaDealerCampaignReportRepository.fromPool({
      query,
      end: vi.fn(),
    });
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('round-trips a canonical report through idempotent storage and mint queries', async () => {
    const expected = report();
    let stored: Record<string, unknown> | undefined;
    const pool = {
      query: vi.fn(async (text: string) => {
        if (text.includes('INSERT INTO solana_dealer_campaign_reports')) {
          stored = rowFor(expected);
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('to_regclass')) {
          return {
            rows: [{ table_name: 'solana_dealer_campaign_reports', migration_applied: true }],
            rowCount: 1,
          };
        }
        return { rows: stored === undefined ? [] : [stored], rowCount: stored ? 1 : 0 };
      }),
      end: vi.fn(async () => undefined),
    };
    const repository = PostgresSolanaDealerCampaignReportRepository.fromPool(pool);

    await expect(repository.put(expected)).resolves.toMatchObject({
      id: expected.id,
      resultHash: expected.resultHash,
      report: expected,
    });
    await expect(repository.put(expected)).resolves.toMatchObject({ id: expected.id });
    await expect(repository.get(expected.id)).resolves.toMatchObject({
      id: expected.id,
      snapshotSlot: '100',
    });
    await expect(repository.list({ mint, limit: 0 })).resolves.toHaveLength(1);
    await expect(repository.latest(mint)).resolves.toMatchObject({ id: expected.id });
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.close()).resolves.toBeUndefined();
  });

  it('keeps JSON replay, row conflicts, and unavailable reads explicit', async () => {
    const expected = report();
    const jsonRepository = PostgresSolanaDealerCampaignReportRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ ...rowFor(expected), report: JSON.stringify(expected) }],
        rowCount: 1,
      })),
      end: vi.fn(async () => undefined),
    });
    await expect(jsonRepository.get(expected.id)).resolves.toMatchObject({ id: expected.id });

    const mismatch = rowFor(expected);
    mismatch.source_set = ['wrong-source'];
    const conflictRepository = PostgresSolanaDealerCampaignReportRepository.fromPool({
      query: vi.fn(async () => ({ rows: [mismatch], rowCount: 1 })),
      end: vi.fn(async () => undefined),
    });
    await expect(conflictRepository.get(expected.id)).rejects.toMatchObject({
      code: 'SOLANA_DEALER_REPORT_CONFLICT',
    });

    const unavailable = PostgresSolanaDealerCampaignReportRepository.fromPool({
      query: vi.fn().mockRejectedValue(new Error('offline')),
      end: vi.fn(async () => undefined),
    });
    await expect(unavailable.get(expected.id)).rejects.toMatchObject({
      code: 'SOLANA_DEALER_REPORT_UNAVAILABLE',
      retryable: true,
    });
    await expect(unavailable.list({ mint })).rejects.toMatchObject({
      code: 'SOLANA_DEALER_REPORT_UNAVAILABLE',
      retryable: true,
    });
    await expect(unavailable.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'SOLANA_DEALER_REPORT_UNAVAILABLE',
    });
  });

  it('retains a typed storage error for direct assertions', () => {
    expect(
      new SolanaDealerCampaignReportStorageError('SOLANA_DEALER_REPORT_INVALID', 'invalid'),
    ).toBeInstanceOf(Error);
  });
});
