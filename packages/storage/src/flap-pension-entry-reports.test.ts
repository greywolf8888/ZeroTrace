import { describe, expect, it, vi } from 'vitest';

import type { FlapPancakeV2PensionEntryResult } from '@zerotrace/schemas';

import { PostgresFlapPensionEntryReportRepository } from './flap-pension-entry-reports.js';

describe('Postgres Flap pension entry Scenario Report repository', () => {
  it('rejects invalid reports and lookup identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresFlapPensionEntryReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as FlapPancakeV2PensionEntryResult)).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_INVALID',
    });
    await expect(repository.latest('invalid')).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks both the report table and migration marker', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ table_name: 'flap_pension_entry_reports', migration_applied: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresFlapPensionEntryReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'FLAP_PENSION_ENTRY_REPORT_NOT_INITIALIZED',
    });
  });
});
