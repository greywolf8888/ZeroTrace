import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export type LiveCaseStatus = 'PASS' | 'FAIL' | 'BLOCKED_EXTERNAL' | 'UNSUPPORTED';

export interface LiveCaseSummary {
  caseId: string;
  status: LiveCaseStatus;
  failureClass: 'SOURCE_UNAVAILABLE' | 'SOURCE_CONFLICT' | null;
}

export interface LiveMeasurement {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  peakRssBytes: number;
  cases: Array<{ caseId: string; durationMs: number }>;
}

export interface LiveSummary {
  sha: string;
  pass: number;
  fail: number;
  blockedExternal: number;
  unsupported: number;
  sourceSet: string[];
  cases: LiveCaseSummary[];
  measurement: LiveMeasurement;
}

export interface PerformancePolicy {
  schemaVersion: 'zerotrace-performance-budget-policy-v1';
  policyVersion: string;
  benchmarkId: string;
  providerEndpointRefs: string[];
  minimumBaselineSamples: number;
  checkSamples: number;
  commandTimeoutMs: number;
  maximumBaselineAgeDays: number;
  regressionAllowance: {
    totalDurationMultiplier: number;
    singleCaseDurationMultiplier: number;
    peakRssMultiplier: number;
    minimumDurationHeadroomMs: number;
    minimumRssHeadroomBytes: number;
  };
  requiredCaseStatuses: Record<string, LiveCaseStatus>;
}

export interface SoakPolicy {
  schemaVersion: 'zerotrace-soak-policy-v1';
  policyVersion: string;
  benchmarkId: string;
  minimumDurationMs: number;
  intervalMs: number;
  maximumStartGapMs: number;
  commandTimeoutMs: number;
  maximumRecoveredExternalBlockedCycles: number;
  maximumConsecutiveExternalBlockedCycles: number;
}

export interface HardwareProfile {
  fingerprint: string;
  platform: string;
  release: string;
  architecture: string;
  cpuModel: string;
  logicalCpuCount: number;
  totalMemoryBytes: number;
  nodeVersion: string;
}

export interface PerformanceSample {
  capturedAt: string;
  implementationSha: string;
  summaryHash: string;
  totalDurationMs: number;
  maximumCaseDurationMs: number;
  peakRssBytes: number;
  pass: number;
  fail: number;
  blockedExternal: number;
  unsupported: number;
  sourceSet: string[];
  caseStatuses: Record<string, LiveCaseStatus>;
}

export interface PerformanceBudgets {
  maximumTotalDurationMs: number;
  maximumCaseDurationMs: number;
  maximumPeakRssBytes: number;
}

export interface PerformanceBaseline {
  schemaVersion: 'zerotrace-performance-baseline-v2';
  status: 'NOT_RUN' | 'MEASURED';
  benchmarkId?: string;
  capturedAt?: string;
  sourceFingerprint?: string;
  implementationSha?: string;
  hardware?: HardwareProfile;
  policy?: { version: string; sha256: string };
  samples?: PerformanceSample[];
  observed?: {
    totalDurationP95Ms: number;
    maximumCaseDurationMs: number;
    maximumPeakRssBytes: number;
  };
  budgets?: PerformanceBudgets;
  notes: string[];
}

export interface LiveExecution {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  summary?: LiveSummary;
  summaryHash?: string;
}

export interface SoakRunMetadata {
  schemaVersion: 'zerotrace-soak-run-v1';
  runId: string;
  benchmarkId: string;
  sourceFingerprint: string;
  implementationSha: string;
  hardware: HardwareProfile;
  policy: { version: string; sha256: string };
  startedAt: string;
  minimumDurationMs: number;
  intervalMs: number;
  command: string;
  metadataHash: string;
}

export interface SoakEvent {
  sequence: number;
  scheduledAt: string;
  startedAt: string;
  completedAt: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED_EXTERNAL';
  implementationSha: string;
  summaryHash: string;
  totalDurationMs: number;
  pass: number;
  fail: number;
  blockedExternal: number;
  unsupported: number;
  sourceSet: string[];
  previousEventHash: string | null;
  eventHash: string;
}

export interface SoakEvaluation {
  status: 'IN_PROGRESS' | 'PASS' | 'FAIL' | 'BLOCKED_EXTERNAL';
  elapsedMs: number;
  cycles: number;
  passingCycles: number;
  externalBlockedCycles: number;
  recoveredExternalBlockedCycles: number;
  maximumConsecutiveExternalBlockedCycles: number;
  maximumObservedStartGapMs: number;
  reason: string;
}

const SOURCE_ROOTS = ['apps/', 'config/', 'crates/', 'packages/', 'scripts/', 'services/'];
const SOURCE_FILES = new Set([
  'Cargo.lock',
  'Cargo.toml',
  'eslint.config.mjs',
  'package-lock.json',
  'package.json',
  'tsconfig.json',
  'tsconfig.packages.json',
  'vitest.config.ts',
]);

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashDocument(value: unknown): string {
  return sha256(canonical(value));
}

export function currentGitSha(root: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown-sha';
  }
}

export function hasTrackedChanges(root: string): boolean {
  try {
    execFileSync('git', ['diff', '--quiet'], { cwd: root });
    execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: root });
    return false;
  } catch {
    return true;
  }
}

export function sourceFingerprint(root: string): string {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root });
  const files = output
    .toString('utf8')
    .split('\0')
    .filter(
      (file) => SOURCE_FILES.has(file) || SOURCE_ROOTS.some((prefix) => file.startsWith(prefix)),
    )
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const path = join(root, ...file.split('/'));
    if (!existsSync(path)) throw new Error(`源码指纹文件缺失：${file}`);
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function hardwareProfile(): HardwareProfile {
  const processors = cpus();
  const identity = {
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpuModel: processors[0]?.model.trim() ?? 'unknown-cpu',
    logicalCpuCount: processors.length,
    totalMemoryBytes: totalmem(),
    nodeVersion: process.version,
  };
  return { fingerprint: hashDocument(identity), ...identity };
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function policyHash(path: string): string {
  return hashDocument(readJson<unknown>(path));
}

export function validateLiveSummary(
  summary: LiveSummary,
  expected: Readonly<Record<string, LiveCaseStatus>>,
  expectedSourceSet?: readonly string[],
): string[] {
  const errors: string[] = [];
  if (!summary.measurement || !Number.isFinite(summary.measurement.durationMs)) {
    errors.push('实链摘要缺少有效总耗时。');
  }
  if (!summary.measurement || !Number.isSafeInteger(summary.measurement.peakRssBytes)) {
    errors.push('实链摘要缺少有效峰值 RSS。');
  }
  const actual = new Map(summary.cases.map((item) => [item.caseId, item.status]));
  for (const [caseId, status] of Object.entries(expected)) {
    if (actual.get(caseId) !== status) {
      errors.push(`${caseId} 应为 ${status}，实际为 ${actual.get(caseId) ?? 'MISSING'}。`);
    }
  }
  if (actual.size !== Object.keys(expected).length) errors.push('实链案例数量与固定基准不一致。');
  if (
    expectedSourceSet !== undefined &&
    hashDocument([...summary.sourceSet].sort()) !== hashDocument([...expectedSourceSet].sort())
  ) {
    errors.push('实链来源集合与版本化性能策略不一致。');
  }
  if (summary.fail !== 0) errors.push(`实链案例包含 ${summary.fail} 个 FAIL。`);
  if (summary.blockedExternal !== 0) {
    errors.push(`实链案例包含 ${summary.blockedExternal} 个外部阻塞。`);
  }
  return errors;
}

export function liveSummaryHasExternalBlocker(summary: LiveSummary): boolean {
  return (
    summary.blockedExternal > 0 ||
    summary.cases.some((item) => item.failureClass === 'SOURCE_UNAVAILABLE')
  );
}

export async function runLiveCase(
  root: string,
  timeoutMs: number,
  providerEndpointRefs?: readonly string[],
): Promise<LiveExecution> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/live-case-runner.ts'], {
      cwd: root,
      env: {
        ...process.env,
        ZERO_TRACE_LIVE_GATE: 'operational',
        ...(providerEndpointRefs === undefined
          ? {}
          : { ZERO_TRACE_LIVE_PROVIDER_ENDPOINT_REFS: JSON.stringify(providerEndpointRefs) }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let summary: LiveSummary | undefined;
      let summaryHash: string | undefined;
      try {
        const report = JSON.parse(stdout) as { sha?: string };
        if (typeof report.sha === 'string') {
          const path = join(root, 'output', 'zero-trust-validation', report.sha, 'summary.json');
          const raw = readFileSync(path, 'utf8');
          summary = JSON.parse(raw) as LiveSummary;
          summaryHash = sha256(raw);
        }
      } catch (error) {
        stderr += `\n无法读取实链摘要：${error instanceof Error ? error.message : '未知错误'}`;
      }
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
        ...(summary === undefined ? {} : { summary }),
        ...(summaryHash === undefined ? {} : { summaryHash }),
      });
    });
  });
}

export function performanceSample(execution: LiveExecution): PerformanceSample {
  if (execution.summary === undefined || execution.summaryHash === undefined) {
    throw new Error('实链执行没有可校验的 summary.json。');
  }
  const { summary } = execution;
  const maximumCaseDurationMs = Math.max(
    0,
    ...summary.measurement.cases.map((item) => item.durationMs),
  );
  return {
    capturedAt: summary.measurement.completedAt,
    implementationSha: summary.sha,
    summaryHash: execution.summaryHash,
    totalDurationMs: summary.measurement.durationMs,
    maximumCaseDurationMs,
    peakRssBytes: summary.measurement.peakRssBytes,
    pass: summary.pass,
    fail: summary.fail,
    blockedExternal: summary.blockedExternal,
    unsupported: summary.unsupported,
    sourceSet: summary.sourceSet,
    caseStatuses: Object.fromEntries(summary.cases.map((item) => [item.caseId, item.status])),
  };
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) throw new RangeError('百分位数至少需要一个样本。');
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1);
  return ordered[index] ?? ordered[ordered.length - 1]!;
}

export function observedPerformance(samples: readonly PerformanceSample[]) {
  if (samples.length === 0) throw new RangeError('性能基线至少需要一个样本。');
  return {
    totalDurationP95Ms: percentile(
      samples.map((item) => item.totalDurationMs),
      95,
    ),
    maximumCaseDurationMs: Math.max(...samples.map((item) => item.maximumCaseDurationMs)),
    maximumPeakRssBytes: Math.max(...samples.map((item) => item.peakRssBytes)),
  };
}

export function derivePerformanceBudgets(
  observed: NonNullable<PerformanceBaseline['observed']>,
  policy: PerformancePolicy,
): PerformanceBudgets {
  const allowance = policy.regressionAllowance;
  return {
    maximumTotalDurationMs: Math.ceil(
      Math.max(
        observed.totalDurationP95Ms * allowance.totalDurationMultiplier,
        observed.totalDurationP95Ms + allowance.minimumDurationHeadroomMs,
      ),
    ),
    maximumCaseDurationMs: Math.ceil(
      Math.max(
        observed.maximumCaseDurationMs * allowance.singleCaseDurationMultiplier,
        observed.maximumCaseDurationMs + allowance.minimumDurationHeadroomMs,
      ),
    ),
    maximumPeakRssBytes: Math.ceil(
      Math.max(
        observed.maximumPeakRssBytes * allowance.peakRssMultiplier,
        observed.maximumPeakRssBytes + allowance.minimumRssHeadroomBytes,
      ),
    ),
  };
}

export function validatePerformanceBaseline(input: {
  baseline: PerformanceBaseline;
  policy: PerformancePolicy;
  policySha256: string;
  sourceFingerprint: string;
  hardware: HardwareProfile;
  now: Date;
}): string[] {
  const { baseline, policy, policySha256, sourceFingerprint: source, hardware, now } = input;
  const errors: string[] = [];
  if (baseline.schemaVersion !== 'zerotrace-performance-baseline-v2') {
    return ['性能基线 Schema 不受支持。'];
  }
  if (baseline.status !== 'MEASURED') return ['性能基线尚未实测。'];
  if (baseline.benchmarkId !== policy.benchmarkId) errors.push('性能基准 ID 与当前策略不一致。');
  if (baseline.sourceFingerprint !== source) errors.push('性能基线源码指纹已过期。');
  if (baseline.hardware?.fingerprint !== hardware.fingerprint)
    errors.push('性能基线硬件指纹不匹配。');
  if (
    baseline.policy?.version !== policy.policyVersion ||
    baseline.policy.sha256 !== policySha256
  ) {
    errors.push('性能基线策略版本或哈希不匹配。');
  }
  if ((baseline.samples?.length ?? 0) < policy.minimumBaselineSamples) {
    errors.push(`性能基线少于 ${policy.minimumBaselineSamples} 个样本。`);
  }
  for (const sample of baseline.samples ?? []) {
    for (const [caseId, status] of Object.entries(policy.requiredCaseStatuses)) {
      if (sample.caseStatuses[caseId] !== status) {
        errors.push(`性能基线样本 ${sample.summaryHash} 的 ${caseId} 状态不合格。`);
      }
    }
    if (
      hashDocument([...sample.sourceSet].sort()) !==
      hashDocument([...policy.providerEndpointRefs].sort())
    ) {
      errors.push(`性能基线样本 ${sample.summaryHash} 的来源集合不匹配。`);
    }
    if (sample.fail !== 0 || sample.blockedExternal !== 0) {
      errors.push(`性能基线样本 ${sample.summaryHash} 包含失败或外部阻塞。`);
    }
  }
  if (baseline.capturedAt === undefined || !Number.isFinite(Date.parse(baseline.capturedAt))) {
    errors.push('性能基线缺少有效捕获时间。');
  } else {
    const ageMs = now.getTime() - Date.parse(baseline.capturedAt);
    if (ageMs < 0 || ageMs > policy.maximumBaselineAgeDays * 86_400_000) {
      errors.push('性能基线已过期或时间位于未来。');
    }
  }
  if (baseline.observed === undefined || baseline.budgets === undefined) {
    errors.push('性能基线缺少观测值或预算。');
  } else {
    const derived = derivePerformanceBudgets(baseline.observed, policy);
    if (hashDocument(derived) !== hashDocument(baseline.budgets)) {
      errors.push('性能预算不是由当前策略和观测值推导，拒绝手工放宽。');
    }
  }
  return [...new Set(errors)];
}

export function checkPerformanceSamples(
  samples: readonly PerformanceSample[],
  budgets: PerformanceBudgets,
  expected: Readonly<Record<string, LiveCaseStatus>>,
): string[] {
  const errors: string[] = [];
  for (const sample of samples) {
    for (const [caseId, status] of Object.entries(expected)) {
      if (sample.caseStatuses[caseId] !== status) {
        errors.push(
          `${caseId} 应为 ${status}，实际为 ${sample.caseStatuses[caseId] ?? 'MISSING'}。`,
        );
      }
    }
    if (sample.fail !== 0 || sample.blockedExternal !== 0) {
      errors.push('当前性能样本包含失败或外部阻塞。');
    }
    if (sample.totalDurationMs > budgets.maximumTotalDurationMs) {
      errors.push(
        `总耗时 ${sample.totalDurationMs}ms 超过预算 ${budgets.maximumTotalDurationMs}ms。`,
      );
    }
    if (sample.maximumCaseDurationMs > budgets.maximumCaseDurationMs) {
      errors.push(
        `单案例耗时 ${sample.maximumCaseDurationMs}ms 超过预算 ${budgets.maximumCaseDurationMs}ms。`,
      );
    }
    if (sample.peakRssBytes > budgets.maximumPeakRssBytes) {
      errors.push(`峰值 RSS ${sample.peakRssBytes} 超过预算 ${budgets.maximumPeakRssBytes}。`);
    }
  }
  return [...new Set(errors)];
}

export function createSoakMetadata(input: {
  runId: string;
  benchmarkId: string;
  sourceFingerprint: string;
  implementationSha: string;
  hardware: HardwareProfile;
  policyVersion: string;
  policySha256: string;
  startedAt: string;
  minimumDurationMs: number;
  intervalMs: number;
}): SoakRunMetadata {
  const unsigned = {
    schemaVersion: 'zerotrace-soak-run-v1' as const,
    runId: input.runId,
    benchmarkId: input.benchmarkId,
    sourceFingerprint: input.sourceFingerprint,
    implementationSha: input.implementationSha,
    hardware: input.hardware,
    policy: { version: input.policyVersion, sha256: input.policySha256 },
    startedAt: input.startedAt,
    minimumDurationMs: input.minimumDurationMs,
    intervalMs: input.intervalMs,
    command: 'node --import tsx scripts/live-case-runner.ts',
  };
  return { ...unsigned, metadataHash: hashDocument(unsigned) };
}

export function createSoakEvent(input: Omit<SoakEvent, 'eventHash'>): SoakEvent {
  return { ...input, eventHash: hashDocument(input) };
}

export function validateSoakChain(metadata: SoakRunMetadata, events: readonly SoakEvent[]): void {
  const unsignedMetadata = {
    schemaVersion: metadata.schemaVersion,
    runId: metadata.runId,
    benchmarkId: metadata.benchmarkId,
    sourceFingerprint: metadata.sourceFingerprint,
    implementationSha: metadata.implementationSha,
    hardware: metadata.hardware,
    policy: metadata.policy,
    startedAt: metadata.startedAt,
    minimumDurationMs: metadata.minimumDurationMs,
    intervalMs: metadata.intervalMs,
    command: metadata.command,
  };
  if (metadata.metadataHash !== hashDocument(unsignedMetadata)) {
    throw new Error('Soak 元数据哈希不匹配。');
  }
  let previous: string | null = null;
  for (const [index, event] of events.entries()) {
    const unsignedEvent = {
      sequence: event.sequence,
      scheduledAt: event.scheduledAt,
      startedAt: event.startedAt,
      completedAt: event.completedAt,
      result: event.result,
      implementationSha: event.implementationSha,
      summaryHash: event.summaryHash,
      totalDurationMs: event.totalDurationMs,
      pass: event.pass,
      fail: event.fail,
      blockedExternal: event.blockedExternal,
      unsupported: event.unsupported,
      sourceSet: event.sourceSet,
      previousEventHash: event.previousEventHash,
    };
    if (event.sequence !== index + 1) throw new Error('Soak 事件序号不连续。');
    if (event.previousEventHash !== previous) throw new Error('Soak 前序事件哈希不匹配。');
    if (event.eventHash !== hashDocument(unsignedEvent)) throw new Error('Soak 事件哈希不匹配。');
    if (Date.parse(event.completedAt) < Date.parse(event.startedAt)) {
      throw new Error('Soak 事件完成时间早于开始时间。');
    }
    previous = event.eventHash;
  }
}

export function evaluateSoak(
  metadata: SoakRunMetadata,
  events: readonly SoakEvent[],
  policy: SoakPolicy,
  now: Date,
): SoakEvaluation {
  validateSoakChain(metadata, events);
  const started = Date.parse(metadata.startedAt);
  const latest = events.at(-1);
  const ended = latest === undefined ? now.getTime() : Date.parse(latest.completedAt);
  const elapsedMs = Math.max(0, ended - started);
  const gaps: number[] = [];
  let previousStart = started;
  let consecutive = 0;
  let maximumConsecutive = 0;
  let recovered = 0;
  let externalSequenceOpen = false;
  for (const event of events) {
    const eventStart = Date.parse(event.startedAt);
    gaps.push(eventStart - previousStart);
    previousStart = eventStart;
    if (event.result === 'BLOCKED_EXTERNAL') {
      consecutive += 1;
      externalSequenceOpen = true;
      maximumConsecutive = Math.max(maximumConsecutive, consecutive);
    } else {
      if (externalSequenceOpen && event.result === 'PASS') recovered += consecutive;
      consecutive = 0;
      externalSequenceOpen = false;
    }
  }
  const passingCycles = events.filter((event) => event.result === 'PASS').length;
  const externalBlockedCycles = events.filter(
    (event) => event.result === 'BLOCKED_EXTERNAL',
  ).length;
  const maximumObservedStartGapMs = Math.max(0, ...gaps);
  if (events.some((event) => event.result === 'FAIL')) {
    return {
      status: 'FAIL',
      elapsedMs,
      cycles: events.length,
      passingCycles,
      externalBlockedCycles,
      recoveredExternalBlockedCycles: recovered,
      maximumConsecutiveExternalBlockedCycles: maximumConsecutive,
      maximumObservedStartGapMs,
      reason: '至少一个实链周期出现确定性失败。',
    };
  }
  if (elapsedMs < policy.minimumDurationMs) {
    return {
      status: 'IN_PROGRESS',
      elapsedMs,
      cycles: events.length,
      passingCycles,
      externalBlockedCycles,
      recoveredExternalBlockedCycles: recovered,
      maximumConsecutiveExternalBlockedCycles: maximumConsecutive,
      maximumObservedStartGapMs,
      reason: `实际经过时间尚未达到 ${policy.minimumDurationMs}ms。`,
    };
  }
  const minimumCycles = Math.floor(policy.minimumDurationMs / policy.intervalMs) + 1;
  if (events.length < minimumCycles || maximumObservedStartGapMs > policy.maximumStartGapMs) {
    return {
      status: 'FAIL',
      elapsedMs,
      cycles: events.length,
      passingCycles,
      externalBlockedCycles,
      recoveredExternalBlockedCycles: recovered,
      maximumConsecutiveExternalBlockedCycles: maximumConsecutive,
      maximumObservedStartGapMs,
      reason: 'Soak 连续性不足：周期数量不足或开始间隔超出策略。',
    };
  }
  if (latest?.result === 'BLOCKED_EXTERNAL') {
    return {
      status: 'BLOCKED_EXTERNAL',
      elapsedMs,
      cycles: events.length,
      passingCycles,
      externalBlockedCycles,
      recoveredExternalBlockedCycles: recovered,
      maximumConsecutiveExternalBlockedCycles: maximumConsecutive,
      maximumObservedStartGapMs,
      reason: '末周期仍为外部阻塞，尚未证明恢复。',
    };
  }
  if (
    recovered > policy.maximumRecoveredExternalBlockedCycles ||
    maximumConsecutive > policy.maximumConsecutiveExternalBlockedCycles
  ) {
    return {
      status: 'FAIL',
      elapsedMs,
      cycles: events.length,
      passingCycles,
      externalBlockedCycles,
      recoveredExternalBlockedCycles: recovered,
      maximumConsecutiveExternalBlockedCycles: maximumConsecutive,
      maximumObservedStartGapMs,
      reason: '外部阻塞次数或连续次数超过稳定性策略。',
    };
  }
  return {
    status: 'PASS',
    elapsedMs,
    cycles: events.length,
    passingCycles,
    externalBlockedCycles,
    recoveredExternalBlockedCycles: recovered,
    maximumConsecutiveExternalBlockedCycles: maximumConsecutive,
    maximumObservedStartGapMs,
    reason: '真实经过时间、连续性、实链状态和恢复约束均满足策略。',
  };
}
