import { describe, expect, it, vi } from 'vitest';

import { hashPayload } from '@zerotrace/evidence';
import { buildClusterPosition } from '@zerotrace/cluster-position-engine';
import { detectBehaviorEvent } from '@zerotrace/behavior-engine';
import {
  buildControlCampaign,
  buildControlClusterVersion,
  controlCampaignIdFor,
} from '@zerotrace/campaign-engine';
import { createTokenFlowEdge } from '@zerotrace/token-flow-engine';
import {
  ControlCampaignBundleSchema,
  ForensicEvidenceLineSchema,
  unknownValue,
  type ControlCampaignBundle,
} from '@zerotrace/schemas';
import { PostgresControlCampaignReportRepository } from './control-campaign-reports.js';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-14T00:00:00.000Z',
  providerVersions: { rpc: 'test' },
  adapterVersions: { evm: 'test' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-empty-v1',
};

function buildBundle(): ControlCampaignBundle {
  const cluster = buildControlClusterVersion({
    ledger: 'EVM',
    chainId: 'eip155:56',
    token: '0xtoken',
    validFromBlock: '1',
    memberWalletIds: ['0xa', '0xb'],
    coreWalletIds: ['0xa'],
    satelliteWalletIds: ['0xb'],
    fundingRootIds: ['0xfunder'],
    settlementRootIds: ['0xsettlement'],
    membershipEvidenceIds: ['ev_000000000000000000000001'],
    snapshot,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    sourceSet: ['test-provider'],
  });
  const campaignId = controlCampaignIdFor({
    ledger: 'EVM',
    chainId: 'eip155:56',
    token: '0xtoken',
    originBlock: '1',
    startBlock: '1',
    endBlock: { state: 'unknown', reason: 'NOT_QUERIED' },
    clusterVersionId: cluster.id,
  });
  const edge = createTokenFlowEdge({
    ledger: 'EVM',
    chainId: 'eip155:56',
    token: '0xtoken',
    blockNumber: '100',
    blockHash: snapshot.blockHash,
    transactionHash: '0xtx',
    transactionIndex: '0',
    logIndex: '0',
    from: '0xexternal',
    to: '0xa',
    amountRaw: '100',
    kind: 'DEX_BUY',
    execution: 'SUCCESS',
    finality: 'FINAL',
    evidenceId: 'ev_000000000000000000000002',
    observedAt: snapshot.capturedAt,
  });
  const position = buildClusterPosition({
    ledger: 'EVM',
    chainId: 'eip155:56',
    token: '0xtoken',
    campaignId,
    clusterVersionId: cluster.id,
    memberWalletIds: cluster.memberWalletIds,
    initialTokenBalanceRaw: '0',
    initialWalletBalances: { '0xa': '0', '0xb': '0' },
    circulatingSupplyRaw: '1000',
    snapshot,
    edges: [edge],
    membershipEvidenceIds: cluster.membershipEvidenceIds,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    sourceSet: ['test-provider'],
  });
  const behaviorEvent = detectBehaviorEvent({
    campaignId,
    ledger: 'EVM',
    chainId: 'eip155:56',
    token: '0xtoken',
    clusterVersionId: cluster.id,
    snapshot,
    afterPosition: position,
    edges: [edge],
    actors: ['0xa'],
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    sourceSet: ['test-provider'],
  });
  const campaign = buildControlCampaign({
    ledger: 'EVM',
    chainId: 'eip155:56',
    token: '0xtoken',
    originBlock: '1',
    startBlock: '1',
    clusterVersion: cluster,
    snapshotStart: snapshot,
    snapshotEnd: snapshot,
    positions: [position],
    behaviorEvents: [behaviorEvent],
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    sourceSet: ['test-provider'],
  });
  const lineWithoutIdentity = {
    schemaVersion: 'forensic-evidence-line-v1' as const,
    campaignId,
    phases: [],
    terminalBoundary: 'UNKNOWN' as const,
    itemIds: [],
    evidenceIds: [],
    snapshotStart: snapshot,
    snapshotEnd: snapshot,
    dataCoverage: 1,
    freshness: snapshot.capturedAt,
    sourceSet: ['test-provider'],
    modelVersion: 'forensic-evidence-v1.0.0' as const,
    confidence: unknownValue('NOT_QUERIED'),
    sourceCoverage: 1,
    historyCoverage: 1,
  };
  const evidenceLine = ForensicEvidenceLineSchema.parse({
    ...lineWithoutIdentity,
    resultHash: hashPayload(lineWithoutIdentity),
  });
  const bundleWithoutIdentity = {
    schemaVersion: 'control-campaign-bundle-v1' as const,
    campaign,
    clusterVersion: cluster,
    memberships: [],
    positions: [position],
    behaviorEvents: [behaviorEvent],
    evidenceItems: [],
    evidenceLine,
  };
  return ControlCampaignBundleSchema.parse({
    ...bundleWithoutIdentity,
    resultHash: hashPayload(bundleWithoutIdentity),
  });
}

function rowFor(bundle: ControlCampaignBundle): Record<string, unknown> {
  return {
    id: bundle.campaign.id,
    ledger: 'EVM',
    chain_id: bundle.campaign.chainId,
    token: bundle.campaign.token,
    snapshot_position: snapshot.blockNumber,
    snapshot_hash: snapshot.blockHash,
    result_hash: bundle.resultHash,
    bundle,
    evidence_ids: bundle.campaign.metadata.evidenceIds,
    source_set: bundle.campaign.metadata.sourceSet,
    model_version: bundle.campaign.ruleVersion,
    captured_at: new Date(snapshot.capturedAt),
    created_at: snapshot.capturedAt,
  };
}

describe('PostgreSQL Control Campaign report repository', () => {
  it('rejects invalid bundles and identifiers before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresControlCampaignReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as never)).rejects.toMatchObject({
      code: 'CONTROL_CAMPAIGN_REPORT_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'CONTROL_CAMPAIGN_REPORT_INVALID',
    });
    await expect(repository.findByBehaviorEventId('invalid')).rejects.toMatchObject({
      code: 'CONTROL_CAMPAIGN_REPORT_INVALID',
    });
    await expect(repository.findByEvidenceItemId('invalid')).rejects.toMatchObject({
      code: 'CONTROL_CAMPAIGN_REPORT_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports durable storage health without fabricating an UP state', async () => {
    const query = vi.fn().mockRejectedValue(new Error('postgres unavailable'));
    const repository = PostgresControlCampaignReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      backend: 'POSTGRES',
      durable: true,
      errorCode: 'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
    });
  });

  it('round-trips a canonical bundle through put, idempotent replay, lookup, and close', async () => {
    const bundle = buildBundle();
    let stored: Record<string, unknown> | undefined;
    const pool = {
      query: vi.fn(async (text: string) => {
        if (text.includes('INSERT INTO control_campaign_reports')) {
          stored = rowFor(bundle);
          return { rows: [], rowCount: 1 };
        }
        return { rows: stored === undefined ? [] : [stored], rowCount: stored ? 1 : 0 };
      }),
      end: vi.fn(async () => undefined),
    };
    const repository = PostgresControlCampaignReportRepository.fromPool(pool);

    await expect(repository.put(bundle)).resolves.toMatchObject({
      id: bundle.campaign.id,
      resultHash: bundle.resultHash,
      bundle,
    });
    await expect(repository.put(bundle)).resolves.toMatchObject({ id: bundle.campaign.id });
    await expect(repository.get(bundle.campaign.id)).resolves.toMatchObject({
      id: bundle.campaign.id,
      snapshotPosition: '100',
    });
    await expect(
      repository.list({ chainId: bundle.campaign.chainId, token: bundle.campaign.token, limit: 0 }),
    ).resolves.toHaveLength(1);
    await expect(
      repository.latest(bundle.campaign.chainId, bundle.campaign.token),
    ).resolves.toMatchObject({
      id: bundle.campaign.id,
    });
    await expect(
      repository.findByBehaviorEventId(bundle.behaviorEvents[0]!.id),
    ).resolves.toMatchObject({ id: bundle.campaign.id });
    await expect(repository.findByEvidenceItemId(`cei_${'1'.repeat(24)}`)).resolves.toMatchObject({
      id: bundle.campaign.id,
    });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
    });
    await expect(repository.close()).resolves.toBeUndefined();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('keeps stored identity conflicts and unavailable reads explicit', async () => {
    const bundle = buildBundle();
    const invalidRow = rowFor(bundle);
    invalidRow.source_set = ['wrong-source'];
    const conflictRepository = PostgresControlCampaignReportRepository.fromPool({
      query: vi.fn(async () => ({ rows: [invalidRow], rowCount: 1 })),
      end: vi.fn(),
    });
    await expect(conflictRepository.get(bundle.campaign.id)).rejects.toMatchObject({
      code: 'CONTROL_CAMPAIGN_REPORT_CONFLICT',
    });

    const unavailable = PostgresControlCampaignReportRepository.fromPool({
      query: vi.fn().mockRejectedValue(new Error('postgres offline')),
      end: vi.fn(),
    });
    await expect(unavailable.get(bundle.campaign.id)).rejects.toMatchObject({
      code: 'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
      retryable: true,
    });
    await expect(
      unavailable.list({ chainId: bundle.campaign.chainId, token: bundle.campaign.token }),
    ).rejects.toMatchObject({
      code: 'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
      retryable: true,
    });
    await expect(
      unavailable.findByBehaviorEventId(bundle.behaviorEvents[0]!.id),
    ).rejects.toMatchObject({
      code: 'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
      retryable: true,
    });
  });
});
