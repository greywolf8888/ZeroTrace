import { describe, expect, it, vi } from 'vitest';

import { defineCaptureSchedule } from '@zerotrace/capture-scheduler';

import { PostgresCaptureScheduleRepository } from './capture-schedules.js';

describe('Postgres capture schedule queries', () => {
  it('lists schedules by immutable target and capture kind', async () => {
    const schedule = defineCaptureSchedule({
      captureKind: 'TOKEN_HISTORY_BACKFILL',
      target: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'TOKEN',
        normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      },
      parameters: {
        schemaVersion: 'token-history-backfill-v1',
        dataset: 'binance-mainnet',
        token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
        fromBlock: '100',
        toBlock: '200',
        modelVersion: 'token-history-backfill-v1.0.0',
        policyVersion: 'token-history-policy-v1.0.0',
      },
      trigger: { type: 'ONCE', at: '2026-08-14T00:00:00.000Z' },
      retryPolicy: {
        maxAttempts: 3,
        initialDelaySeconds: 30,
        maximumDelaySeconds: 900,
        backoffMultiplierBps: 20_000,
      },
      createdAt: '2026-08-13T23:59:00.000Z',
    });
    const query = vi.fn(async (text: string) => {
      if (text.includes('FROM capture_schedules')) {
        return {
          rows: [
            {
              id: schedule.definition.id,
              identity_hash: schedule.definition.identityHash,
              definition: schedule.definition,
              status: schedule.status,
              next_run_at: schedule.nextRunAt.state === 'known' ? schedule.nextRunAt.value : null,
              revision: schedule.revision,
              created_at: schedule.createdAt,
              updated_at: schedule.updatedAt,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresCaptureScheduleRepository.fromPool({
      query,
      connect: vi.fn(),
      end: vi.fn(),
    });

    await expect(
      repository.listSchedules({
        target: schedule.definition.target,
        captureKind: 'TOKEN_HISTORY_BACKFILL',
        limit: 10,
      }),
    ).resolves.toEqual([schedule]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('normalized_identifier = $4'), [
      'EVM',
      'eip155:56',
      'TOKEN',
      '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      'TOKEN_HISTORY_BACKFILL',
      10,
    ]);
  });

  it('rejects malformed run lookup identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresCaptureScheduleRepository.fromPool({
      query,
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(repository.listRunsForSchedule('invalid')).rejects.toMatchObject({
      code: 'CAPTURE_SCHEDULER_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
  });
});
