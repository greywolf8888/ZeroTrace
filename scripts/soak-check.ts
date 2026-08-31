import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSoakEvent,
  createSoakMetadata,
  currentGitSha,
  evaluateSoak,
  hardwareProfile,
  hasTrackedChanges,
  policyHash,
  readJson,
  runLiveCase,
  sha256,
  sourceFingerprint,
  validateLiveSummary,
  validateSoakChain,
  type PerformancePolicy,
  type SoakEvent,
  type SoakPolicy,
  type SoakRunMetadata,
} from './operational-gates.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const soakPolicyPath = join(root, 'config', 'soak_policy.json');
const performancePolicyPath = join(root, 'config', 'performance_budget_policy.json');
const soakPolicy = readJson<SoakPolicy>(soakPolicyPath);
const performancePolicy = readJson<PerformancePolicy>(performancePolicyPath);

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readEvents(path: string): SoakEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SoakEvent);
}

async function waitUntil(epochMs: number, shouldStop: () => boolean): Promise<void> {
  while (Date.now() < epochMs && !shouldStop()) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, epochMs - Date.now())));
  }
}

if (process.env.ZERO_TRACE_SOAK !== '1') {
  emit({
    status: 'NOT_RUN',
    reason: '24 小时 Soak 需要显式设置 ZERO_TRACE_SOAK=1 和唯一运行 ID；未运行不得记 PASS。',
  });
  process.exitCode = 2;
} else {
  const runId = process.env.ZERO_TRACE_SOAK_RUN_ID;
  if (runId === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(runId)) {
    emit({ status: 'NOT_RUN', reason: 'ZERO_TRACE_SOAK_RUN_ID 缺失或格式无效。' });
    process.exitCode = 2;
  } else if (hasTrackedChanges(root)) {
    emit({ status: 'NOT_RUN', reason: 'Soak 要求已跟踪源码和暂存区无改动。' });
    process.exitCode = 2;
  } else if (soakPolicy.benchmarkId !== performancePolicy.benchmarkId) {
    emit({ status: 'FAIL', reason: 'Soak 与实链基准策略 ID 不一致。' });
    process.exitCode = 1;
  } else {
    const runDirectory = join(root, 'output', 'soak', runId);
    const metadataPath = join(runDirectory, 'run.json');
    const eventsPath = join(runDirectory, 'events.jsonl');
    const currentSource = sourceFingerprint(root);
    const currentHardware = hardwareProfile();
    const currentSha = currentGitSha(root);
    const currentPolicyHash = policyHash(soakPolicyPath);
    mkdirSync(runDirectory, { recursive: true });

    let metadata: SoakRunMetadata;
    if (existsSync(metadataPath)) {
      metadata = readJson<SoakRunMetadata>(metadataPath);
    } else {
      metadata = createSoakMetadata({
        runId,
        benchmarkId: soakPolicy.benchmarkId,
        sourceFingerprint: currentSource,
        implementationSha: currentSha,
        hardware: currentHardware,
        policyVersion: soakPolicy.policyVersion,
        policySha256: currentPolicyHash,
        startedAt: new Date().toISOString(),
        minimumDurationMs: soakPolicy.minimumDurationMs,
        intervalMs: soakPolicy.intervalMs,
      });
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
    }

    const mismatches: string[] = [];
    if (metadata.runId !== runId) mismatches.push('运行 ID 不匹配。');
    if (metadata.sourceFingerprint !== currentSource) mismatches.push('源码指纹已变化。');
    if (metadata.hardware.fingerprint !== currentHardware.fingerprint)
      mismatches.push('硬件指纹已变化。');
    if (metadata.implementationSha !== currentSha) mismatches.push('实现提交已变化。');
    if (
      metadata.policy.version !== soakPolicy.policyVersion ||
      metadata.policy.sha256 !== currentPolicyHash
    ) {
      mismatches.push('Soak 策略版本或哈希已变化。');
    }
    if (
      metadata.minimumDurationMs !== soakPolicy.minimumDurationMs ||
      metadata.intervalMs !== soakPolicy.intervalMs
    ) {
      mismatches.push('Soak 时长或间隔与策略不一致。');
    }

    if (mismatches.length > 0) {
      emit({ status: 'STALE', runId, reasons: mismatches });
      process.exitCode = 2;
    } else {
      let events: SoakEvent[] = [];
      try {
        events = readEvents(eventsPath);
        validateSoakChain(metadata, events);
      } catch (error) {
        emit({
          status: 'FAIL',
          runId,
          reason: error instanceof Error ? error.message : 'Soak 事件日志无法校验。',
        });
        process.exitCode = 1;
      }

      if (process.exitCode === undefined) {
        let stopRequested = false;
        const requestStop = () => {
          stopRequested = true;
        };
        process.once('SIGINT', requestStop);
        process.once('SIGTERM', requestStop);
        const once = process.env.ZERO_TRACE_SOAK_ONCE === '1';
        let evaluation = evaluateSoak(metadata, events, soakPolicy, new Date());

        while (
          !stopRequested &&
          evaluation.status === 'IN_PROGRESS' &&
          (!once || events.length === 0)
        ) {
          const scheduledAtMs =
            Date.parse(metadata.startedAt) + events.length * soakPolicy.intervalMs;
          await waitUntil(scheduledAtMs, () => stopRequested);
          if (stopRequested) break;
          const startedAt = new Date().toISOString();
          const execution = await runLiveCase(root, soakPolicy.commandTimeoutMs);
          const completedAt = new Date().toISOString();
          const liveErrors =
            execution.summary === undefined
              ? ['没有可校验的实链摘要。']
              : validateLiveSummary(execution.summary, performancePolicy.requiredCaseStatuses);
          const isExternal = execution.timedOut || (execution.summary?.blockedExternal ?? 0) > 0;
          const result =
            liveErrors.length === 0 && execution.exitCode === 0
              ? 'PASS'
              : isExternal
                ? 'BLOCKED_EXTERNAL'
                : 'FAIL';
          const summary = execution.summary;
          const event = createSoakEvent({
            sequence: events.length + 1,
            scheduledAt: new Date(scheduledAtMs).toISOString(),
            startedAt,
            completedAt,
            result,
            implementationSha: currentSha,
            summaryHash:
              execution.summaryHash ?? sha256(`${execution.stdout}\n${execution.stderr}`),
            totalDurationMs:
              summary?.measurement.durationMs ?? Date.parse(completedAt) - Date.parse(startedAt),
            pass: summary?.pass ?? 0,
            fail: summary?.fail ?? (result === 'FAIL' ? 1 : 0),
            blockedExternal: summary?.blockedExternal ?? (isExternal ? 1 : 0),
            unsupported: summary?.unsupported ?? 0,
            previousEventHash: events.at(-1)?.eventHash ?? null,
          });
          appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
          events = [...events, event];
          evaluation = evaluateSoak(metadata, events, soakPolicy, new Date());
          emit({
            status: evaluation.status,
            runId,
            latestCycle: {
              sequence: event.sequence,
              result: event.result,
              summaryHash: event.summaryHash,
              liveErrors,
            },
            evaluation,
            evidence: { metadataPath, eventsPath },
          });
          if (result === 'FAIL') break;
        }

        if (stopRequested || once) {
          evaluation = evaluateSoak(metadata, events, soakPolicy, new Date());
          emit({
            status: evaluation.status,
            runId,
            evaluation,
            reason: stopRequested
              ? '收到停止信号；已落盘，可用同一运行 ID 续跑。'
              : '单周期探测结束；不能替代 24 小时 Soak。',
          });
        }
        if (evaluation.status !== 'PASS') {
          process.exitCode = evaluation.status === 'FAIL' ? 1 : 2;
        }
      }
    }
  }
}
