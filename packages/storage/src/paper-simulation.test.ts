import { describe, expect, it } from 'vitest';

import {
  buildPaperReview,
  createPaperExperiment,
  type PaperCommand,
} from '@zerotrace/asset-ledger';

import {
  PaperSimulationStorageError,
  PostgresPaperSimulationRepository,
} from './paper-simulation.js';

const at = '2026-08-31T00:00:00.000Z';
const evidence = `ev_${'1'.repeat(24)}`;

function initial() {
  return createPaperExperiment({
    name: '持久模拟实验',
    chain: 'SOLANA',
    initialPrincipalAtomic: '1000000000',
    createdAt: at,
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
}

function command(id: string, epoch = id): PaperCommand {
  return {
    type: 'ENTER_CANDIDATE',
    commandId: id,
    assetId: 'So11111111111111111111111111111111111111112',
    strategyVersion: 'strategy-v1',
    candidateEpoch: epoch,
    eventAt: at,
    reasons: ['进入有界跟踪'],
    evidenceIds: [evidence],
  };
}

class MemoryPool {
  row: Record<string, unknown> | undefined;
  commands: Array<Record<string, unknown>> = [];
  events: Array<Record<string, unknown>> = [];
  outbox: Array<Record<string, unknown>> = [];
  deliveries: Array<Record<string, unknown>> = [];
  deliveryEvents: Array<Record<string, unknown>> = [];
  reviews: Array<Record<string, unknown>> = [];
  statements: string[] = [];

  async query(text: string, values: readonly unknown[] = []) {
    this.statements.push(text.trim());
    if (text.includes('INSERT INTO paper_experiments')) {
      if (this.row === undefined) {
        const state = String(values[2]);
        this.row = {
          id: values[0],
          chain: values[1],
          current_state: state,
          current_state_hash: values[3],
          revision: 0,
          created_at: values[4],
          updated_at: values[4],
        };
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM paper_experiments')) {
      return { rows: this.row === undefined ? [] : [this.row], rowCount: this.row ? 1 : 0 };
    }
    if (text.includes('FROM paper_experiment_commands')) {
      return { rows: this.commands, rowCount: this.commands.length };
    }
    if (text.includes('INSERT INTO paper_review_reports')) {
      if (!this.reviews.some((row) => row.id === values[0])) {
        this.reviews.push({
          id: values[0],
          experiment_id: values[1],
          snapshot_id: values[2],
          report_hash: values[3],
          report: values[4],
          as_of: values[5],
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM paper_review_reports')) {
      const rows = this.reviews.filter((row) => row.id === values[0]);
      return { rows, rowCount: rows.length };
    }
    if (
      text.includes('FROM paper_notification_delivery_state') &&
      text.includes('ANY($2::text[])')
    ) {
      const ids = values[1] as string[];
      const rows = this.deliveries.filter(
        (row) => row.experiment_id === values[0] && ids.includes(String(row.outbox_id)),
      );
      return { rows, rowCount: rows.length };
    }
    if (text.includes('SELECT id, created_at FROM paper_notification_outbox')) {
      const found = this.outbox.find((row) => row.id === values[1]);
      return {
        rows: found === undefined ? [] : [{ id: found.id, created_at: found.created_at }],
        rowCount: found ? 1 : 0,
      };
    }
    if (text.includes('FROM paper_notification_outbox')) {
      const cursorTime = values[1] === null ? undefined : new Date(String(values[1])).getTime();
      const cursorId = String(values[2]);
      const limit = Number(values[3]);
      const rows = this.outbox
        .filter((row) => {
          if (cursorTime === undefined) return true;
          const rowTime = new Date(String(row.created_at)).getTime();
          return rowTime > cursorTime || (rowTime === cursorTime && String(row.id) > cursorId);
        })
        .sort(
          (left, right) =>
            String(left.created_at).localeCompare(String(right.created_at)) ||
            String(left.id).localeCompare(String(right.id)),
        )
        .slice(0, limit);
      return { rows, rowCount: rows.length };
    }
    if (text.includes("to_regclass('public.paper_experiments')")) {
      return {
        rows: [
          {
            experiment_table: 'paper_experiments',
            command_table: 'paper_experiment_commands',
            event_table: 'paper_experiment_events',
            outbox_table: 'paper_notification_outbox',
            delivery_table: 'paper_notification_delivery_state',
            delivery_event_table: 'paper_notification_delivery_events',
            review_table: 'paper_review_reports',
            ledger_migration_applied: true,
            review_migration_applied: true,
            delivery_migration_applied: true,
          },
        ],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected pool query: ${text}`);
  }

  async connect() {
    return {
      query: async (text: string, values: readonly unknown[] = []) => {
        this.statements.push(text.trim());
        if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
          return { rows: [], rowCount: null };
        }
        if (
          text.includes('FROM paper_notification_delivery_state AS delivery') &&
          text.includes('FOR UPDATE OF delivery SKIP LOCKED')
        ) {
          const now = new Date(String(values[1])).getTime();
          const limit = Number(values[2]);
          const rows = this.deliveries
            .filter(
              (delivery) =>
                delivery.experiment_id === values[0] &&
                delivery.channel === 'DESKTOP' &&
                ((delivery.state === 'PENDING' &&
                  new Date(String(delivery.next_attempt_at)).getTime() <= now) ||
                  (delivery.state === 'LEASED' &&
                    new Date(String(delivery.lease_expires_at)).getTime() <= now)),
            )
            .map<Record<string, unknown>>((delivery) => {
              const outbox = this.outbox.find((row) => row.id === delivery.outbox_id)!;
              const event = this.events.find((row) => row.id === outbox.event_id)!;
              return { ...outbox, ...delivery, event_payload: event.payload };
            })
            .sort(
              (left, right) =>
                (left.urgency === right.urgency ? 0 : left.urgency === 'URGENT' ? -1 : 1) ||
                String(left.created_at).localeCompare(String(right.created_at)) ||
                String(left.id).localeCompare(String(right.id)),
            )
            .slice(0, limit);
          return { rows, rowCount: rows.length };
        }
        if (
          text.includes('FROM paper_notification_delivery_state') &&
          text.includes('FOR UPDATE')
        ) {
          const channel = text.includes("channel = 'IN_APP'") ? 'IN_APP' : 'DESKTOP';
          const rows = this.deliveries.filter(
            (row) =>
              row.experiment_id === values[0] &&
              row.outbox_id === values[1] &&
              row.channel === channel,
          );
          return { rows, rowCount: rows.length };
        }
        if (
          text.includes('FROM paper_notification_delivery_events') &&
          text.includes("event_type IN ('DISPATCHED', 'DELIVERY_FAILED')")
        ) {
          const rows = this.deliveryEvents
            .filter(
              (row) =>
                row.outbox_id === values[0] &&
                row.lease_token_hash === values[1] &&
                (row.event_type === 'DISPATCHED' || row.event_type === 'DELIVERY_FAILED'),
            )
            .slice(-1)
            .map((row) => ({ event_type: row.event_type }));
          return { rows, rowCount: rows.length };
        }
        if (text.startsWith('UPDATE paper_notification_delivery_state')) {
          const isLease = text.includes("SET state = 'LEASED'");
          const isDispatched = text.includes("SET state = 'DISPATCHED'");
          const isPending = text.includes("SET state = 'PENDING'");
          const isRead = text.includes('SET read_at =');
          const outboxId = String(
            isLease ? values[4] : isDispatched ? values[1] : isPending ? values[3] : values[1],
          );
          const channel = isRead ? 'IN_APP' : 'DESKTOP';
          const delivery = this.deliveries.find(
            (row) => row.outbox_id === outboxId && row.channel === channel,
          );
          if (delivery === undefined) return { rows: [], rowCount: 0 };
          if (isLease) {
            Object.assign(delivery, {
              state: 'LEASED',
              attempt_count: Number(delivery.attempt_count) + 1,
              lease_token_hash: values[0],
              lease_owner_hash: values[1],
              lease_expires_at: values[2],
              updated_at: values[3],
            });
          } else if (isDispatched) {
            Object.assign(delivery, {
              state: 'DISPATCHED',
              lease_token_hash: null,
              lease_owner_hash: null,
              lease_expires_at: null,
              dispatched_at: values[0],
              last_error_code: null,
              updated_at: values[0],
            });
          } else if (isPending) {
            Object.assign(delivery, {
              state: 'PENDING',
              lease_token_hash: null,
              lease_owner_hash: null,
              lease_expires_at: null,
              next_attempt_at: values[0],
              last_error_code: values[1],
              updated_at: values[2],
            });
          } else if (isRead) {
            Object.assign(delivery, { read_at: values[0], updated_at: values[0] });
          }
          return { rows: [{ ...delivery }], rowCount: 1 };
        }
        if (text.includes('INSERT INTO paper_notification_delivery_events')) {
          const claimed = text.includes("'CLAIMED'");
          const expired = text.includes("'LEASE_EXPIRED'");
          const read = text.includes("'READ'");
          this.deliveryEvents.push({
            outbox_id: values[0],
            event_type: claimed ? 'CLAIMED' : expired ? 'LEASE_EXPIRED' : read ? 'READ' : values[2],
            lease_token_hash: claimed || expired ? values[3] : read ? null : values[4],
          });
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('FROM paper_experiments')) {
          return { rows: this.row === undefined ? [] : [this.row], rowCount: this.row ? 1 : 0 };
        }
        if (text.includes('INSERT INTO paper_experiment_commands')) {
          this.commands.push({
            payload: values[4],
            command_id: values[1],
            command_hash: values[3],
          });
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('INSERT INTO paper_experiment_events')) {
          this.events.push({ payload: values[4], id: values[0] });
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('INSERT INTO paper_notification_outbox')) {
          const outbox = {
            id: values[0],
            experiment_id: values[1],
            business_key: values[2],
            event_id: values[3],
            event_type: values[4],
            urgency: values[5],
            delivery_state: 'PENDING',
            payload_hash: values[6],
            payload: values[7],
            created_at: values[8],
          };
          this.outbox.push(outbox);
          this.deliveries.push(
            {
              outbox_id: values[0],
              experiment_id: values[1],
              channel: 'IN_APP',
              state: 'DELIVERED',
              attempt_count: 0,
              lease_token_hash: null,
              lease_owner_hash: null,
              lease_expires_at: null,
              next_attempt_at: values[8],
              delivered_at: values[8],
              dispatched_at: null,
              read_at: null,
              last_error_code: null,
              created_at: values[8],
              updated_at: values[8],
            },
            {
              outbox_id: values[0],
              experiment_id: values[1],
              channel: 'DESKTOP',
              state: 'PENDING',
              attempt_count: 0,
              lease_token_hash: null,
              lease_owner_hash: null,
              lease_expires_at: null,
              next_attempt_at: values[8],
              delivered_at: null,
              dispatched_at: null,
              read_at: null,
              last_error_code: null,
              created_at: values[8],
              updated_at: values[8],
            },
          );
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith('UPDATE paper_experiments')) {
          if (this.row === undefined || String(this.row.revision) !== String(values[5])) {
            return { rows: [], rowCount: 0 };
          }
          this.row = {
            ...this.row,
            current_state: values[0],
            current_state_hash: values[1],
            revision: values[2],
            updated_at: values[3],
          };
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected transaction query: ${text}`);
      },
      release: () => undefined,
    };
  }

  async end() {}
}

describe('PostgreSQL 模拟账本与发件箱', () => {
  it('在同一事务写命令、事件、发件箱和 revision，并可幂等重放', async () => {
    const pool = new MemoryPool();
    const repository = PostgresPaperSimulationRepository.fromPool(pool as never);
    const created = await repository.create(initial());
    const applied = await repository.apply({
      experimentId: created.id,
      command: command('candidate-1'),
      expectedRevision: 0,
    });

    expect(applied.revision).toBe(1);
    expect(pool.commands).toHaveLength(1);
    expect(pool.events).toHaveLength(1);
    expect(pool.outbox).toHaveLength(1);
    expect(pool.statements).toContain('COMMIT');

    const replay = await repository.apply({
      experimentId: created.id,
      command: command('candidate-1'),
      expectedRevision: 0,
    });
    expect(replay.revision).toBe(1);
    expect(pool.commands).toHaveLength(1);
    expect(pool.outbox).toHaveLength(1);
  });

  it('拒绝同 ID 异内容与过期 revision', async () => {
    const pool = new MemoryPool();
    const repository = PostgresPaperSimulationRepository.fromPool(pool as never);
    const created = await repository.create(initial());
    await repository.apply({ experimentId: created.id, command: command('candidate-1') });

    await expect(
      repository.apply({
        experimentId: created.id,
        command: { ...command('candidate-1'), reasons: ['冲突内容'] },
      }),
    ).rejects.toBeInstanceOf(PaperSimulationStorageError);
    await expect(
      repository.apply({
        experimentId: created.id,
        command: command('candidate-2'),
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: 'PAPER_STORAGE_CONFLICT' });
  });

  it('按稳定游标分页且未知游标失败关闭', async () => {
    const pool = new MemoryPool();
    const repository = PostgresPaperSimulationRepository.fromPool(pool as never);
    const created = await repository.create(initial());
    for (const id of ['candidate-1', 'candidate-2', 'candidate-3']) {
      await repository.apply({ experimentId: created.id, command: command(id) });
    }
    const first = await repository.listOutbox({ experimentId: created.id, limit: 2 });
    expect(first.records).toHaveLength(2);
    expect(first.nextCursor).toBe(first.records.at(-1)?.id);
    const second = await repository.listOutbox({
      experimentId: created.id,
      after: first.nextCursor!,
      limit: 2,
    });
    expect(second.records).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    await expect(
      repository.listOutbox({ experimentId: created.id, after: `pob_${'0'.repeat(24)}` }),
    ).rejects.toMatchObject({ code: 'PAPER_STORAGE_INVALID' });
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
  });

  it('发件箱载荷或信封被篡改时失败关闭', async () => {
    const pool = new MemoryPool();
    const repository = PostgresPaperSimulationRepository.fromPool(pool as never);
    const created = await repository.create(initial());
    await repository.apply({ experimentId: created.id, command: command('candidate-1') });
    pool.outbox[0] = { ...pool.outbox[0], urgency: 'URGENT' };

    await expect(repository.listOutbox({ experimentId: created.id })).rejects.toMatchObject({
      code: 'PAPER_STORAGE_CONFLICT',
    });
  });

  it('持久投递按租约重试、拒绝旧租约并独立记录应用内已读', async () => {
    const pool = new MemoryPool();
    const repository = PostgresPaperSimulationRepository.fromPool(pool as never);
    const created = await repository.create(initial());
    const state = await repository.apply({
      experimentId: created.id,
      command: command('candidate-delivery-1'),
    });
    const outboxId = state.outbox[0]!.id;

    const page = await repository.listNotifications({ experimentId: created.id });
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'IN_APP', state: 'DELIVERED', readAt: null }),
        expect.objectContaining({ channel: 'DESKTOP', state: 'PENDING', attemptCount: 0 }),
      ]),
    );

    const firstClaim = await repository.claimDesktopNotifications({
      experimentId: created.id,
      actor: 'desktop-a',
      now: '2026-08-31T00:01:00.000Z',
      leaseDurationMs: 5_000,
    });
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]).toMatchObject({
      record: { id: outboxId },
      event: { id: state.events[0]!.id },
      delivery: { state: 'LEASED', attemptCount: 1 },
    });

    const failed = await repository.settleDesktopNotification({
      experimentId: created.id,
      outboxId,
      actor: 'desktop-a',
      leaseToken: firstClaim[0]!.leaseToken,
      outcome: 'FAILED',
      errorCode: 'DESKTOP_API_UNAVAILABLE',
      now: '2026-08-31T00:01:00.000Z',
    });
    expect(failed).toMatchObject({
      state: 'PENDING',
      attemptCount: 1,
      nextAttemptAt: '2026-08-31T00:01:01.000Z',
      lastErrorCode: 'DESKTOP_API_UNAVAILABLE',
    });
    await expect(
      repository.claimDesktopNotifications({
        experimentId: created.id,
        actor: 'desktop-a',
        now: '2026-08-31T00:01:00.500Z',
      }),
    ).resolves.toEqual([]);

    const retry = await repository.claimDesktopNotifications({
      experimentId: created.id,
      actor: 'desktop-a',
      now: '2026-08-31T00:01:02.000Z',
    });
    const dispatched = await repository.settleDesktopNotification({
      experimentId: created.id,
      outboxId,
      actor: 'desktop-a',
      leaseToken: retry[0]!.leaseToken,
      outcome: 'DISPATCHED',
      now: '2026-08-31T00:01:03.000Z',
    });
    expect(dispatched).toMatchObject({ state: 'DISPATCHED', attemptCount: 2 });
    await expect(
      repository.settleDesktopNotification({
        experimentId: created.id,
        outboxId,
        actor: 'desktop-a',
        leaseToken: retry[0]!.leaseToken,
        outcome: 'DISPATCHED',
        now: '2026-08-31T00:01:04.000Z',
      }),
    ).resolves.toMatchObject({ state: 'DISPATCHED' });

    const read = await repository.markInAppNotificationRead({
      experimentId: created.id,
      outboxId,
      actor: 'analyst-a',
      now: '2026-08-31T00:02:00.000Z',
    });
    expect(read.readAt).toBe('2026-08-31T00:02:00.000Z');
    await expect(
      repository.markInAppNotificationRead({
        experimentId: created.id,
        outboxId,
        actor: 'analyst-a',
        now: '2026-08-31T00:03:00.000Z',
      }),
    ).resolves.toMatchObject({ readAt: '2026-08-31T00:02:00.000Z' });

    const second = await repository.apply({
      experimentId: created.id,
      command: command('candidate-delivery-2'),
    });
    const secondOutboxId = second.outbox[1]!.id;
    const expiring = await repository.claimDesktopNotifications({
      experimentId: created.id,
      actor: 'desktop-a',
      now: '2026-08-31T00:04:00.000Z',
      leaseDurationMs: 5_000,
    });
    const recovered = await repository.claimDesktopNotifications({
      experimentId: created.id,
      actor: 'desktop-b',
      now: '2026-08-31T00:04:06.000Z',
      leaseDurationMs: 5_000,
    });
    expect(recovered[0]).toMatchObject({
      record: { id: secondOutboxId },
      delivery: { state: 'LEASED', attemptCount: 2 },
    });
    await expect(
      repository.settleDesktopNotification({
        experimentId: created.id,
        outboxId: secondOutboxId,
        actor: 'desktop-a',
        leaseToken: expiring[0]!.leaseToken,
        outcome: 'DISPATCHED',
        now: '2026-08-31T00:04:07.000Z',
      }),
    ).rejects.toMatchObject({ code: 'PAPER_STORAGE_CONFLICT' });
  });

  it('完整读取命令日志并幂等保存可重放复盘', async () => {
    const pool = new MemoryPool();
    const repository = PostgresPaperSimulationRepository.fromPool(pool as never);
    const created = await repository.create(initial());
    const state = await repository.apply({
      experimentId: created.id,
      command: command('candidate-1'),
    });
    const journal = await repository.getCommandJournal(created.id);
    const report = buildPaperReview({
      experiment: state,
      commands: journal,
      rejectedCandidates: [],
      asOf: at,
    });

    await expect(repository.saveReview(report)).resolves.toEqual(report);
    await expect(repository.saveReview(report)).resolves.toEqual(report);
    expect(pool.reviews).toHaveLength(1);
    await expect(repository.getReview(report.id)).resolves.toEqual(report);
  });
});
