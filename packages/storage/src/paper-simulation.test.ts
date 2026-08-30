import { describe, expect, it } from 'vitest';

import { createPaperExperiment, type PaperCommand } from '@zerotrace/asset-ledger';

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
            migration_applied: true,
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
        if (text.includes('FROM paper_experiments')) {
          return { rows: this.row === undefined ? [] : [this.row], rowCount: this.row ? 1 : 0 };
        }
        if (text.includes('INSERT INTO paper_experiment_commands')) {
          this.commands.push({ payload: values[4], command_id: values[1] });
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('INSERT INTO paper_experiment_events')) {
          this.events.push({ payload: values[4], id: values[0] });
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('INSERT INTO paper_notification_outbox')) {
          this.outbox.push({
            id: values[0],
            business_key: values[2],
            event_id: values[3],
            event_type: values[4],
            urgency: values[5],
            delivery_state: 'PENDING',
            payload_hash: values[6],
            payload: values[7],
            created_at: values[8],
          });
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
});
