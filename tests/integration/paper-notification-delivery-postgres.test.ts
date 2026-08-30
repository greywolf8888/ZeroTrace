import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPaperExperiment, type PaperCommand } from '@zerotrace/asset-ledger';
import { PostgresPaperSimulationRepository } from '@zerotrace/storage';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;

postgresDescribe('PostgreSQL 持久提醒投递', () => {
  let firstWorker: PostgresPaperSimulationRepository;
  let secondWorker: PostgresPaperSimulationRepository;

  beforeAll(() => {
    firstWorker = new PostgresPaperSimulationRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    secondWorker = new PostgresPaperSimulationRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => Promise.all([firstWorker.close(), secondWorker.close()]));

  it('跨工作进程只租出一次，失败后退避重试，并保存独立已读状态', async () => {
    await expect(firstWorker.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    const nonce = randomUUID();
    const createdAt = new Date().toISOString();
    const experiment = createPaperExperiment({
      name: `投递集成测试-${nonce}`,
      chain: 'SOLANA',
      initialPrincipalAtomic: '1000000000',
      createdAt,
      policy: {
        version: 'V11.0',
        targetPositionBps: 500,
        maxSinglePositionBps: 1_000,
        maxControllerGroupBps: 1_500,
        maxNarrativeGroupBps: 2_500,
        maxTotalInvestedBps: 6_000,
        minimumUncommittedCashBps: 1_500,
        minimumFeeReserveBps: 500,
        opaqueTokenStressLossBps: 10_000,
      },
    });
    await firstWorker.create(experiment);
    const command: PaperCommand = {
      type: 'ENTER_CANDIDATE',
      commandId: `candidate-${nonce}`,
      assetId: 'So11111111111111111111111111111111111111112',
      strategyVersion: 'integration-v1',
      candidateEpoch: nonce,
      eventAt: createdAt,
      reasons: ['持久提醒 PostgreSQL 集成验证'],
      evidenceIds: [`ev_${nonce.replaceAll('-', '').slice(0, 24)}`],
    };
    const state = await firstWorker.apply({ experimentId: experiment.id, command });
    const outboxId = state.outbox[0]!.id;
    const page = await firstWorker.listNotifications({ experimentId: experiment.id });
    expect(page.records[0]?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'IN_APP', state: 'DELIVERED', readAt: null }),
        expect.objectContaining({ channel: 'DESKTOP', state: 'PENDING', attemptCount: 0 }),
      ]),
    );

    const claimAt = new Date(Date.parse(createdAt) + 1_000).toISOString();
    const [left, right] = await Promise.all([
      firstWorker.claimDesktopNotifications({
        experimentId: experiment.id,
        actor: 'integration-desktop-a',
        now: claimAt,
        limit: 1,
      }),
      secondWorker.claimDesktopNotifications({
        experimentId: experiment.id,
        actor: 'integration-desktop-b',
        now: claimAt,
        limit: 1,
      }),
    ]);
    expect(left.length + right.length).toBe(1);
    const claimed = [...left, ...right][0]!;
    const actor = left.length === 1 ? 'integration-desktop-a' : 'integration-desktop-b';
    const failedAt = new Date(Date.parse(claimAt) + 500).toISOString();
    await expect(
      firstWorker.settleDesktopNotification({
        experimentId: experiment.id,
        outboxId,
        actor,
        leaseToken: claimed.leaseToken,
        outcome: 'FAILED',
        errorCode: 'INTEGRATION_DESKTOP_UNAVAILABLE',
        now: failedAt,
      }),
    ).resolves.toMatchObject({
      state: 'PENDING',
      attemptCount: 1,
      lastErrorCode: 'INTEGRATION_DESKTOP_UNAVAILABLE',
    });

    await expect(
      secondWorker.claimDesktopNotifications({
        experimentId: experiment.id,
        actor: 'integration-desktop-b',
        now: new Date(Date.parse(failedAt) + 500).toISOString(),
      }),
    ).resolves.toEqual([]);
    const retry = await secondWorker.claimDesktopNotifications({
      experimentId: experiment.id,
      actor: 'integration-desktop-b',
      now: new Date(Date.parse(failedAt) + 1_500).toISOString(),
    });
    expect(retry).toHaveLength(1);
    const dispatchedAt = new Date(Date.parse(failedAt) + 2_000).toISOString();
    await expect(
      secondWorker.settleDesktopNotification({
        experimentId: experiment.id,
        outboxId,
        actor: 'integration-desktop-b',
        leaseToken: retry[0]!.leaseToken,
        outcome: 'DISPATCHED',
        now: dispatchedAt,
      }),
    ).resolves.toMatchObject({ state: 'DISPATCHED', attemptCount: 2 });
    await expect(
      firstWorker.markInAppNotificationRead({
        experimentId: experiment.id,
        outboxId,
        actor: 'integration-analyst',
        now: dispatchedAt,
      }),
    ).resolves.toMatchObject({ state: 'DELIVERED', readAt: dispatchedAt });

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query(
          'UPDATE paper_notification_delivery_events SET event_type = event_type WHERE outbox_id = $1',
          [outboxId],
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        pool.query(
          'DELETE FROM paper_notification_delivery_state WHERE outbox_id = $1 AND channel = $2',
          [outboxId, 'DESKTOP'],
        ),
      ).rejects.toThrow(/cannot be deleted/);
    } finally {
      await pool.end();
    }
  });
});
