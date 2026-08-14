import { describe, expect, it, vi } from 'vitest';

import { PostgresForensicCampaignAlertRepository } from './forensic-campaign-alerts.js';

const alert = {
  schemaVersion: 'forensic-campaign-alert-v1' as const,
  id: `fca_${'1'.repeat(24)}`,
  campaignId: `cc_${'2'.repeat(24)}`,
  behaviorEventId: `be_${'3'.repeat(24)}`,
  severity: 'HIGH' as const,
  classification: 'COORDINATED_SELLING_OBSERVED',
  evidenceIds: [`ev_${'4'.repeat(24)}`],
  snapshot: {
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
  },
  confidence: { state: 'known' as const, value: 0.5 },
  suppressionApplied: [],
  details: { explanation: 'Evidence-bound behavior.' },
  modelVersion: 'forensic-campaign-alert-v1.0.0',
  createdAt: '2026-08-14T00:00:00.000Z',
  resultHash: 'c'.repeat(64),
};

describe('PostgreSQL Forensic Campaign Alert repository', () => {
  it('stores an immutable alert and Evidence edges transactionally', async () => {
    const clientQuery = vi.fn(async (text: string) => {
      if (text.includes('INSERT INTO control_campaign_alerts')) {
        return { rows: [{ id: alert.id }], rowCount: 1 };
      }
      if (text.includes('FROM control_campaign_alerts alert')) {
        return { rows: [{ payload: alert, evidence_ids: [...alert.evidenceIds] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const repository = PostgresForensicCampaignAlertRepository.fromPool({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
      end: vi.fn(),
    });

    await expect(repository.put(alert)).resolves.toEqual(alert);
    expect(
      clientQuery.mock.calls.filter(([text]) =>
        text.includes('INSERT INTO control_campaign_alert_evidence'),
      ),
    ).toHaveLength(1);
    expect(clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects malformed Campaign IDs before reading storage', async () => {
    const query = vi.fn();
    const repository = PostgresForensicCampaignAlertRepository.fromPool({
      query,
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(repository.listByCampaign('invalid')).rejects.toMatchObject({
      code: 'FORENSIC_ALERT_STORAGE_CONFLICT',
    });
    expect(query).not.toHaveBeenCalled();
  });
});
