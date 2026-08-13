import { describe, expect, it, vi } from 'vitest';

import { PostgresControlCampaignReportRepository } from './control-campaign-reports.js';

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
});
