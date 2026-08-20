import { originHistoryWithoutReader } from '@zerotrace/forensic-pipeline';
import {
  coverageComplete,
  initialStages,
  markStage,
  MARKET_STRUCTURE_JOB_TYPE,
  type StageState,
} from '@zerotrace/terminal-pipeline';
import { captureTokenMarket, type CaptureReport } from '@zerotrace/token-market-capture';
import type { DurableJob, JobLeaseGuard, JobQueue } from '@zerotrace/workflow-core';

import type { AppRuntime } from '../runtime.js';

interface TokenPayload {
  chainId: string;
  token: string;
  creationTx?: string;
}

interface Checkpoint {
  stages: StageState[];
  capture?: CaptureReport;
}

function parseStages(checkpoint: string | undefined): Checkpoint {
  if (checkpoint === undefined || checkpoint.length === 0) {
    return { stages: initialStages() };
  }
  try {
    const parsed = JSON.parse(checkpoint) as Checkpoint | StageState[];
    if (Array.isArray(parsed)) return { stages: parsed };
    if (Array.isArray(parsed.stages)) return parsed;
  } catch {
    return { stages: initialStages() };
  }
  return { stages: initialStages() };
}

function parseTokenPayload(payload: string | undefined): TokenPayload | undefined {
  if (payload === undefined || payload.length === 0) return undefined;
  try {
    const parsed = JSON.parse(payload) as {
      chainId?: unknown;
      token?: unknown;
      creationTx?: unknown;
    };
    if (typeof parsed.chainId !== 'string' || typeof parsed.token !== 'string') return undefined;
    return {
      chainId: parsed.chainId,
      token: parsed.token,
      ...(typeof parsed.creationTx === 'string' ? { creationTx: parsed.creationTx } : {}),
    };
  } catch {
    return undefined;
  }
}

async function runCapture(
  runtime: AppRuntime,
  payload: TokenPayload,
): Promise<CaptureReport | undefined> {
  if (runtime.tokenCapture === undefined) return undefined;
  return captureTokenMarket(runtime.tokenCapture, {
    chainId: payload.chainId,
    token: payload.token,
    ...(payload.creationTx === undefined ? {} : { creationTx: payload.creationTx }),
    logBudgetChunks: 4,
  });
}

async function processClaimedJob(
  queue: JobQueue,
  runtime: AppRuntime,
  job: DurableJob,
  guard: JobLeaseGuard,
) {
  if (job.type === 'TOKEN_ORIGIN_HISTORY') {
    const payload = parseTokenPayload(job.payload);
    const capture = payload === undefined ? undefined : await runCapture(runtime, payload);
    if (capture !== undefined) {
      await queue.checkpoint(
        job.id,
        JSON.stringify({ stages: capture.stages, capture } satisfies Checkpoint),
        guard,
      );
      return queue.succeed(job.id, capture.origin.status, guard);
    }
    if (runtime.sqdBscCreationReader === undefined) {
      return queue.succeed(job.id, originHistoryWithoutReader().status, guard);
    }
    return queue.succeed(job.id, 'ORIGIN_CAPTURE_NOT_STARTED', guard);
  }
  if (job.type === MARKET_STRUCTURE_JOB_TYPE) {
    let { stages } = parseStages(job.checkpoint);
    const payload = parseTokenPayload(job.payload);
    if (payload === undefined) {
      return queue.fail(
        job.id,
        'TOKEN_MARKET_STRUCTURE requires a token-only payload; refusing empty materialization.',
        guard,
      );
    }
    const capture = await runCapture(runtime, payload);
    if (capture !== undefined) {
      await queue.checkpoint(
        job.id,
        JSON.stringify({ stages: capture.stages, capture } satisfies Checkpoint),
        guard,
      );
      const status = coverageComplete(capture.stages) ? 'COMPLETE' : 'PARTIAL';
      return queue.succeed(job.id, status, guard);
    }
    stages = markStage(stages, 'CAPABILITY', 'COMPLETE');
    stages = markStage(stages, 'SNAPSHOT', 'PARTIAL', '当前快照检查不是完整历史。');
    if (runtime.sqdBscCreationReader === undefined) {
      const origin = originHistoryWithoutReader();
      stages = markStage(
        stages,
        'ORIGIN',
        'PARTIAL',
        origin.limitations[0] ?? '起源与历史任务需要只读读取器。',
      );
      stages = markStage(stages, 'HISTORY', 'PARTIAL', '历史任务未配置只读读取器。');
    } else {
      stages = markStage(stages, 'ORIGIN', 'PARTIAL', '读取器存在但尚未完成起源闭合。');
      stages = markStage(stages, 'HISTORY', 'PARTIAL', '历史覆盖未到 1。');
    }
    stages = markStage(stages, 'SUPPLY', 'PARTIAL', '供应单元格来自观察，不是调用方 JSON。');
    stages = markStage(stages, 'ENTITY', 'PARTIAL', '无校准语料，只输出证据分。');
    stages = markStage(stages, 'CAMPAIGN', 'PARTIAL', '无完整持有人时间线，不得伪造窗口。');
    stages = markStage(stages, 'CAPITAL', 'PARTIAL', '无自动 Lot，不得手填成本。');
    stages = markStage(stages, 'RV', 'UNSUPPORTED', '物质性场所未做 pinned VM 执行。');
    stages = markStage(stages, 'REPLAY', 'PARTIAL', '案件包哈希尚未与完整 Decoder 对齐。');
    await queue.checkpoint(job.id, JSON.stringify({ stages } satisfies Checkpoint), guard);
    const status = coverageComplete(stages) ? 'COMPLETE' : 'PARTIAL';
    return queue.succeed(job.id, status, guard);
  }
  return queue.fail(job.id, `Unsupported forensic job type ${job.type}`, guard);
}

export async function processOneForensicJob(
  queue: JobQueue,
  runtime: AppRuntime,
  options: { workerId?: string; leaseMs?: number; heartbeatMs?: number } = {},
) {
  const workerId = options.workerId ?? 'forensic-worker';
  const leaseMs = options.leaseMs ?? 30_000;
  const job = await queue.claim(workerId, new Date(), leaseMs);
  if (job === undefined) return undefined;
  if (job.fencingToken === undefined) {
    return queue.fail(job.id, 'Claimed job is missing a fencing token.');
  }
  const guard = { workerId, fencingToken: job.fencingToken };
  let heartbeatFailure: unknown;
  const heartbeat = setInterval(
    () => {
      void Promise.resolve(queue.heartbeat(job.id, guard, new Date(), leaseMs)).catch((error) => {
        heartbeatFailure = error;
      });
    },
    options.heartbeatMs ?? Math.max(1_000, Math.floor(leaseMs / 3)),
  );
  heartbeat.unref();
  try {
    const result = await processClaimedJob(queue, runtime, job, guard);
    if (heartbeatFailure !== undefined) throw heartbeatFailure;
    return result;
  } catch (error) {
    return queue.fail(job.id, error instanceof Error ? error.message : '取证任务执行失败。', guard);
  } finally {
    clearInterval(heartbeat);
  }
}
