import { describe, expect, it, vi } from 'vitest';

import {
  PostgresSolanaDealerCampaignReportRepository,
  SolanaDealerCampaignReportStorageError,
} from './solana-dealer-campaign-reports.js';

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

  it('retains a typed storage error for direct assertions', () => {
    expect(
      new SolanaDealerCampaignReportStorageError('SOLANA_DEALER_REPORT_INVALID', 'invalid'),
    ).toBeInstanceOf(Error);
  });
});
