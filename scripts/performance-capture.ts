import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  currentGitSha,
  derivePerformanceBudgets,
  hardwareProfile,
  hasTrackedChanges,
  hashDocument,
  observedPerformance,
  performanceSample,
  policyHash,
  readJson,
  runLiveCase,
  sourceFingerprint,
  validateLiveSummary,
  type PerformanceBaseline,
  type PerformancePolicy,
  type PerformanceSample,
} from './operational-gates.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const policyPath = join(root, 'config', 'performance_budget_policy.json');
const policy = readJson<PerformancePolicy>(policyPath);

if (hasTrackedChanges(root)) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'NOT_RUN',
        reason: '性能捕获要求已跟踪源码和暂存区无改动；未跟踪的运行输出不影响捕获。',
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 2;
} else {
  const samples: PerformanceSample[] = [];
  const failures: string[] = [];
  for (let index = 0; index < policy.minimumBaselineSamples; index += 1) {
    const execution = await runLiveCase(root, policy.commandTimeoutMs, policy.providerEndpointRefs);
    if (execution.summary === undefined || execution.summaryHash === undefined) {
      failures.push(`样本 ${index + 1} 未生成可校验摘要：${execution.stderr || '没有错误输出'}。`);
      break;
    }
    const errors = validateLiveSummary(
      execution.summary,
      policy.requiredCaseStatuses,
      policy.providerEndpointRefs,
    );
    if (execution.exitCode !== 0) errors.push(`实链执行退出码为 ${execution.exitCode}。`);
    if (execution.timedOut) errors.push('实链执行超时。');
    if (errors.length > 0) {
      failures.push(...errors.map((error) => `样本 ${index + 1}：${error}`));
      break;
    }
    samples.push(performanceSample(execution));
  }

  if (failures.length > 0 || samples.length < policy.minimumBaselineSamples) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'NOT_MEASURED',
          benchmarkId: policy.benchmarkId,
          samples: samples.length,
          failures,
          reason: '基线样本不完整或含失败/外部阻塞，不得生成可提升基线。',
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 2;
  } else {
    const observed = observedPerformance(samples);
    const capturedAt = samples.at(-1)!.capturedAt;
    const baseline: PerformanceBaseline = {
      schemaVersion: 'zerotrace-performance-baseline-v2',
      status: 'MEASURED',
      benchmarkId: policy.benchmarkId,
      capturedAt,
      sourceFingerprint: sourceFingerprint(root),
      implementationSha: currentGitSha(root),
      hardware: hardwareProfile(),
      policy: { version: policy.policyVersion, sha256: policyHash(policyPath) },
      samples,
      observed,
      budgets: derivePerformanceBudgets(observed, policy),
      notes: [
        '观测值来自当前固定硬件上的双独立 BSC Operator 只读真实主网案例。',
        '预算由版本化回归余量策略推导；不得手工放宽，也不代表完整盘面能力已完成。',
      ],
    };
    const stamp = capturedAt.replaceAll(':', '-');
    const outputDirectory = join(root, 'output', 'performance');
    const outputPath = join(outputDirectory, `${stamp}-${baseline.sourceFingerprint}.json`);
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'MEASURED_CANDIDATE',
          outputPath,
          candidateHash: hashDocument(baseline),
          benchmarkId: baseline.benchmarkId,
          implementationSha: baseline.implementationSha,
          sourceFingerprint: baseline.sourceFingerprint,
          hardwareFingerprint: baseline.hardware?.fingerprint,
          samples: samples.length,
          observed: baseline.observed,
          budgets: baseline.budgets,
          note: '候选记录尚未自动写入受版本控制的性能基线。',
        },
        null,
        2,
      )}\n`,
    );
  }
}
