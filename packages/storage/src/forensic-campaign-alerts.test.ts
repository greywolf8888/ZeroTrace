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

  it('replays object and JSON payloads, lists alerts, and exposes durable health states', async () => {
    const row = { payload: alert, evidence_ids: [...alert.evidenceIds] };
    const repository = PostgresForensicCampaignAlertRepository.fromPool({
      query: vi.fn(async (text: string) => {
        if (text.includes('to_regclass')) {
          return {
            rows: [
              {
                alert_table: 'control_campaign_alerts',
                evidence_table: 'control_campaign_alert_evidence',
                migration_applied: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [row], rowCount: 1 };
      }),
      connect: vi.fn(),
      end: vi.fn(),
    });

    await expect(repository.get(alert.id)).resolves.toEqual(alert);
    await expect(repository.listByCampaign(alert.campaignId, 1)).resolves.toEqual([alert]);
    await expect(repository.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
    });

    const jsonRepository = PostgresForensicCampaignAlertRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ payload: JSON.stringify(alert), evidence_ids: [...alert.evidenceIds] }],
        rowCount: 1,
      })),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(jsonRepository.get(alert.id)).resolves.toEqual(alert);

    await expect(repository.listByCampaign(alert.campaignId, 0)).rejects.toMatchObject({
      code: 'FORENSIC_ALERT_STORAGE_CONFLICT',
    });

    const notInitialized = PostgresForensicCampaignAlertRepository.fromPool({
      query: vi.fn(async (text: string) =>
        text.includes('to_regclass')
          ? {
              rows: [
                {
                  alert_table: 'control_campaign_alerts',
                  evidence_table: 'wrong_table',
                  migration_applied: false,
                },
              ],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 },
      ),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(notInitialized.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'FORENSIC_ALERT_STORAGE_NOT_INITIALIZED',
    });

    const unavailable = PostgresForensicCampaignAlertRepository.fromPool({
      query: vi.fn().mockRejectedValue(new Error('offline')),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(unavailable.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'FORENSIC_ALERT_STORAGE_UNAVAILABLE',
    });
    await expect(unavailable.get(alert.id)).rejects.toMatchObject({
      code: 'FORENSIC_ALERT_STORAGE_READ_FAILED',
      retryable: true,
    });
  });

  it('fails closed on invalid Evidence edges and unavailable durable writes', async () => {
    const mismatch = PostgresForensicCampaignAlertRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ payload: alert, evidence_ids: [`ev_${'9'.repeat(24)}`] }],
        rowCount: 1,
      })),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(mismatch.get(alert.id)).rejects.toMatchObject({
      code: 'FORENSIC_ALERT_STORAGE_CONFLICT',
    });

    const malformedJson = PostgresForensicCampaignAlertRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ payload: '{not-json', evidence_ids: [...alert.evidenceIds] }],
        rowCount: 1,
      })),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(malformedJson.get(alert.id)).rejects.toMatchObject({
      code: 'FORENSIC_ALERT_STORAGE_CONFLICT',
    });

    const connectFailure = PostgresForensicCampaignAlertRepository.fromPool({
      query: vi.fn(),
      connect: vi.fn().mockRejectedValue(new Error('offline')),
      end: vi.fn(),
    });
    await expect(connectFailure.put(alert)).rejects.toMatchObject({
      code: 'FORENSIC_ALERT_STORAGE_UNAVAILABLE',
      retryable: true,
    });
  });
});
