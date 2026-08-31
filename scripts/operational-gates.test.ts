import { describe, expect, it } from 'vitest';

import {
  checkPerformanceSamples,
  createSoakEvent,
  createSoakMetadata,
  derivePerformanceBudgets,
  evaluateSoak,
  hashDocument,
  validatePerformanceBaseline,
  validateSoakChain,
  type HardwareProfile,
  type PerformanceBaseline,
  type PerformancePolicy,
  type PerformanceSample,
  type SoakEvent,
  type SoakPolicy,
} from './operational-gates.js';

const hardware: HardwareProfile = {
  fingerprint: 'hardware-fingerprint',
  platform: 'win32',
  release: 'test-release',
  architecture: 'x64',
  cpuModel: 'test-cpu',
  logicalCpuCount: 8,
  totalMemoryBytes: 16_000_000_000,
  nodeVersion: 'v24.0.0',
};

const performancePolicy: PerformancePolicy = {
  schemaVersion: 'zerotrace-performance-budget-policy-v1',
  policyVersion: 'test-v1',
  benchmarkId: 'benchmark-v1',
  providerEndpointRefs: ['https://operator-a.example', 'https://operator-b.example'],
  minimumBaselineSamples: 1,
  checkSamples: 1,
  commandTimeoutMs: 1_000,
  maximumBaselineAgeDays: 30,
  regressionAllowance: {
    totalDurationMultiplier: 1.5,
    singleCaseDurationMultiplier: 2,
    peakRssMultiplier: 1.25,
    minimumDurationHeadroomMs: 250,
    minimumRssHeadroomBytes: 16,
  },
  requiredCaseStatuses: { REAL_CASE: 'PASS', NEGATIVE_CASE: 'UNSUPPORTED' },
};

const sample: PerformanceSample = {
  capturedAt: '2026-08-31T00:00:02.000Z',
  implementationSha: 'implementation-sha',
  summaryHash: 'summary-hash',
  totalDurationMs: 1_000,
  maximumCaseDurationMs: 600,
  peakRssBytes: 1_000,
  pass: 1,
  fail: 0,
  blockedExternal: 0,
  unsupported: 1,
  sourceSet: ['https://operator-a.example', 'https://operator-b.example'],
  caseStatuses: { REAL_CASE: 'PASS', NEGATIVE_CASE: 'UNSUPPORTED' },
};

function measuredBaseline(): PerformanceBaseline {
  const observed = {
    totalDurationP95Ms: 1_000,
    maximumCaseDurationMs: 600,
    maximumPeakRssBytes: 1_000,
  };
  return {
    schemaVersion: 'zerotrace-performance-baseline-v2',
    status: 'MEASURED',
    benchmarkId: performancePolicy.benchmarkId,
    capturedAt: sample.capturedAt,
    sourceFingerprint: 'source-fingerprint',
    implementationSha: sample.implementationSha,
    hardware,
    policy: { version: performancePolicy.policyVersion, sha256: 'policy-hash' },
    samples: [sample],
    observed,
    budgets: derivePerformanceBudgets(observed, performancePolicy),
    notes: [],
  };
}

const soakPolicy: SoakPolicy = {
  schemaVersion: 'zerotrace-soak-policy-v1',
  policyVersion: 'test-v1',
  benchmarkId: 'benchmark-v1',
  minimumDurationMs: 2_000,
  intervalMs: 1_000,
  maximumStartGapMs: 1_500,
  commandTimeoutMs: 1_000,
  maximumRecoveredExternalBlockedCycles: 2,
  maximumConsecutiveExternalBlockedCycles: 1,
};

function metadata() {
  return createSoakMetadata({
    runId: 'test-run',
    benchmarkId: soakPolicy.benchmarkId,
    sourceFingerprint: 'source-fingerprint',
    implementationSha: 'implementation-sha',
    hardware,
    policyVersion: soakPolicy.policyVersion,
    policySha256: 'policy-hash',
    startedAt: '2026-08-31T00:00:00.000Z',
    minimumDurationMs: soakPolicy.minimumDurationMs,
    intervalMs: soakPolicy.intervalMs,
  });
}

function events(
  results: Array<SoakEvent['result']>,
  starts = results.map((_, index) => index * 1_000),
) {
  const output: SoakEvent[] = [];
  for (const [index, result] of results.entries()) {
    const startedAt = new Date(
      Date.parse('2026-08-31T00:00:00.000Z') + starts[index]!,
    ).toISOString();
    output.push(
      createSoakEvent({
        sequence: index + 1,
        scheduledAt: startedAt,
        startedAt,
        completedAt: new Date(Date.parse(startedAt) + 10).toISOString(),
        result,
        implementationSha: 'implementation-sha',
        summaryHash: `summary-${index}`,
        totalDurationMs: 10,
        pass: result === 'PASS' ? 8 : 0,
        fail: result === 'FAIL' ? 1 : 0,
        blockedExternal: result === 'BLOCKED_EXTERNAL' ? 1 : 0,
        unsupported: result === 'PASS' ? 1 : 0,
        sourceSet: performancePolicy.providerEndpointRefs,
        previousEventHash: output.at(-1)?.eventHash ?? null,
      }),
    );
  }
  return output;
}

describe('performance operational gate', () => {
  it('keeps an unmeasured baseline at NOT_RUN', () => {
    const errors = validatePerformanceBaseline({
      baseline: {
        schemaVersion: 'zerotrace-performance-baseline-v2',
        status: 'NOT_RUN',
        notes: [],
      },
      policy: performancePolicy,
      policySha256: 'policy-hash',
      sourceFingerprint: 'source-fingerprint',
      hardware,
      now: new Date('2026-08-31T00:00:03.000Z'),
    });
    expect(errors).toContain('性能基线尚未实测。');
  });

  it('rejects a manually relaxed budget', () => {
    const baseline = measuredBaseline();
    baseline.budgets = { ...baseline.budgets!, maximumTotalDurationMs: 999_999 };
    const errors = validatePerformanceBaseline({
      baseline,
      policy: performancePolicy,
      policySha256: 'policy-hash',
      sourceFingerprint: 'source-fingerprint',
      hardware,
      now: new Date('2026-08-31T00:00:03.000Z'),
    });
    expect(errors).toContain('性能预算不是由当前策略和观测值推导，拒绝手工放宽。');
  });

  it('fails a current sample that exceeds the derived budget', () => {
    const baseline = measuredBaseline();
    const slow = { ...sample, totalDurationMs: baseline.budgets!.maximumTotalDurationMs + 1 };
    const errors = checkPerformanceSamples(
      [slow],
      baseline.budgets!,
      performancePolicy.requiredCaseStatuses,
    );
    expect(errors.some((error) => error.includes('总耗时'))).toBe(true);
  });
});

describe('24-hour soak evidence chain', () => {
  it('cannot pass before the real elapsed duration', () => {
    const result = evaluateSoak(
      metadata(),
      events(['PASS']),
      soakPolicy,
      new Date('2026-08-31T00:00:01.000Z'),
    );
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('passes a continuous run and records a recovered external block', () => {
    const result = evaluateSoak(
      metadata(),
      events(['PASS', 'BLOCKED_EXTERNAL', 'PASS']),
      soakPolicy,
      new Date('2026-08-31T00:00:03.000Z'),
    );
    expect(result).toMatchObject({
      status: 'PASS',
      cycles: 3,
      recoveredExternalBlockedCycles: 1,
      maximumConsecutiveExternalBlockedCycles: 1,
    });
  });

  it('does not pass while the last provider cycle remains blocked', () => {
    const result = evaluateSoak(
      metadata(),
      events(['PASS', 'PASS', 'BLOCKED_EXTERNAL']),
      soakPolicy,
      new Date('2026-08-31T00:00:03.000Z'),
    );
    expect(result.status).toBe('BLOCKED_EXTERNAL');
  });

  it('fails a continuity gap after the required duration', () => {
    const result = evaluateSoak(
      metadata(),
      events(['PASS', 'PASS', 'PASS'], [0, 1_000, 3_000]),
      soakPolicy,
      new Date('2026-08-31T00:00:04.000Z'),
    );
    expect(result.status).toBe('FAIL');
    expect(result.maximumObservedStartGapMs).toBe(2_000);
  });

  it('detects a modified append-only event', () => {
    const chain = events(['PASS', 'PASS', 'PASS']);
    const changed = chain.map((event) => ({ ...event }));
    changed[1]!.pass = 7;
    expect(() => validateSoakChain(metadata(), changed)).toThrow('Soak 事件哈希不匹配。');
    expect(hashDocument(changed[1])).not.toBe(chain[1]!.eventHash);
  });
});
