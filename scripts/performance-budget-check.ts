import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkPerformanceSamples,
  hardwareProfile,
  performanceSample,
  policyHash,
  readJson,
  runLiveCase,
  sourceFingerprint,
  validateLiveSummary,
  validatePerformanceBaseline,
  type PerformanceBaseline,
  type PerformancePolicy,
  type PerformanceSample,
} from './operational-gates.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'docs', 'terminal-market-structure', '性能基线.json');
const policyPath = join(root, 'config', 'performance_budget_policy.json');
const baseline = readJson<PerformanceBaseline>(baselinePath);
const policy = readJson<PerformancePolicy>(policyPath);
const errors = validatePerformanceBaseline({
  baseline,
  policy,
  policySha256: policyHash(policyPath),
  sourceFingerprint: sourceFingerprint(root),
  hardware: hardwareProfile(),
  now: new Date(),
});

if (errors.length > 0 || baseline.budgets === undefined) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: baseline.status === 'MEASURED' ? 'STALE' : 'NOT_RUN',
        reasons: errors,
        notes: baseline.notes,
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 2;
} else {
  const samples: PerformanceSample[] = [];
  const executionErrors: string[] = [];
  let blockedExternal = false;
  for (let index = 0; index < policy.checkSamples; index += 1) {
    const execution = await runLiveCase(root, policy.commandTimeoutMs);
    if (execution.summary === undefined || execution.summaryHash === undefined) {
      executionErrors.push(`检查样本 ${index + 1} 没有可校验摘要。${execution.stderr}`);
      blockedExternal ||= execution.timedOut;
      break;
    }
    if (execution.summary.blockedExternal > 0) blockedExternal = true;
    const liveErrors = validateLiveSummary(execution.summary, policy.requiredCaseStatuses);
    if (execution.exitCode !== 0) liveErrors.push(`实链执行退出码为 ${execution.exitCode}。`);
    if (liveErrors.length > 0) {
      executionErrors.push(...liveErrors.map((error) => `检查样本 ${index + 1}：${error}`));
      break;
    }
    samples.push(performanceSample(execution));
  }
  const budgetErrors = checkPerformanceSamples(
    samples,
    baseline.budgets,
    policy.requiredCaseStatuses,
  );
  const allErrors = [...executionErrors, ...budgetErrors];
  const status =
    allErrors.length === 0 && samples.length === policy.checkSamples
      ? 'PASS'
      : blockedExternal
        ? 'BLOCKED_EXTERNAL'
        : 'FAIL';
  process.stdout.write(
    `${JSON.stringify(
      {
        status,
        benchmarkId: policy.benchmarkId,
        sourceFingerprint: baseline.sourceFingerprint,
        hardwareFingerprint: baseline.hardware?.fingerprint,
        baselineCapturedAt: baseline.capturedAt,
        budgets: baseline.budgets,
        samples,
        errors: allErrors,
        note: 'PASS 只证明当前固定硬件上的该真实主网基准未超过版本化预算。',
      },
      null,
      2,
    )}\n`,
  );
  if (status !== 'PASS') process.exitCode = status === 'FAIL' ? 1 : 2;
}
