import { describe, expect, it } from 'vitest';

import {
  BSC_PUBLIC_NO_SLA_ENDPOINTS,
  independentOperatorCount,
  operatorFromEndpoint,
} from '@zerotrace/source-registry';

import { defaultBscPublicCatalog } from './catalog.js';
import { planCorpusIngestion, planLifetimeHistory, planQuery, splitRange } from './plan.js';
import { selectProviders } from './select.js';
import { evaluateShadowPromotion } from './shadow.js';
import { resultHash } from './secrets.js';

describe('provider plane policy', () => {
  it('does not treat two official BNB public URLs as independent sources', () => {
    const left = operatorFromEndpoint({
      endpointId: 'https://bsc-dataseed.bnbchain.org',
      chainId: 'eip155:56',
    });
    const right = operatorFromEndpoint({
      endpointId: 'https://bsc-dataseed-public.bnbchain.org',
      chainId: 'eip155:56',
    });
    expect(left.independenceGroup).toBe(right.independenceGroup);
    expect(independentOperatorCount([left, right])).toBe(1);
  });

  it('forbids eth_getLogs on the default public pool, including official dataseed', () => {
    const catalog = defaultBscPublicCatalog();
    expect(catalog.map((item) => item.endpointRef).sort()).toEqual(
      [...BSC_PUBLIC_NO_SLA_ENDPOINTS].sort(),
    );
    const logs = selectProviders(catalog, {
      chainId: 'eip155:56',
      method: 'eth_getLogs',
      params: [{ fromBlock: '0x1', toBlock: '0x2' }],
      loadBearing: true,
    });
    expect(logs.selected).toEqual([]);
    expect(logs.unavailableReason).toBe('LOGS_REQUIRE_BULK_OR_KEYED');
    expect(logs.rejected.some((item) => item.reason === 'PUBLIC_LOGS_FORBIDDEN')).toBe(true);
  });

  it('selects public operators for code and receipts without using vendor-name branches', () => {
    const catalog = defaultBscPublicCatalog();
    const code = selectProviders(catalog, {
      chainId: 'eip155:56',
      method: 'eth_getCode',
      params: ['0xabc', 'latest'],
      loadBearing: true,
    });
    expect(code.selected).toHaveLength(2);
    expect(new Set(code.selected.map((item) => item.independenceGroup)).size).toBe(2);
    expect(code.selected.every((item) => item.forensicGrade === 'PUBLIC_NO_SLA')).toBe(true);
  });

  it('keeps unconfigured keyed slots out of routing', () => {
    const catalog = [
      ...defaultBscPublicCatalog(),
      {
        ...defaultBscPublicCatalog()[2]!,
        providerId: 'keyed-archive-slot',
        forensicGrade: 'FREE_KEYED' as const,
        credentialStatus: 'UNCONFIGURED' as const,
        archiveDeclared: true,
        logsDeclared: true,
        allowedMethodClasses: ['ARCHIVE_STATE', 'LOGS', 'CODE'] as const,
        deniedMethods: [],
      },
    ];
    const archive = selectProviders(catalog, {
      chainId: 'eip155:56',
      method: 'eth_getCode',
      params: ['0xabc', '0x10'],
      archiveRequired: true,
    });
    expect(archive.selected.some((item) => item.providerId === 'keyed-archive-slot')).toBe(false);
    expect(archive.unavailableReason).toBe('PROVIDER_UNAVAILABLE');
  });

  it('plans corpus ingestion as bulk-first and never as per-token public logs', () => {
    const blocked = planCorpusIngestion({
      tokenCount: 50,
      bulkAvailable: false,
      keyedArchiveAvailable: false,
      traceAvailable: false,
    });
    expect(blocked.strategy).toBe('BLOCKED_NO_BULK');
    expect(blocked.forbidPerTokenPublicLogs).toBe(true);
    const ready = planCorpusIngestion({
      tokenCount: 50,
      bulkAvailable: true,
      keyedArchiveAvailable: true,
      traceAvailable: false,
    });
    expect(ready.strategy).toBe('BULK_THEN_RPC_VERIFY');
    expect(ready.localIndexFirst).toBe(true);
    expect(
      planQuery({
        hasLocalIndex: true,
        bulkAvailable: true,
        archiveRequired: true,
        traceRequired: false,
        loadBearing: true,
        method: 'eth_getLogs',
      }).steps.some((step) => step.source === 'BULK_DATASET'),
    ).toBe(true);
  });

  it('plans lifetime history from local coverage with zero historical RPC', () => {
    const complete = planLifetimeHistory({ coverageComplete: true, bulkAvailable: true });
    expect(complete.estimatedRpcCost).toBe(0);
    expect(complete.steps.some((step) => step.method === 'eth_getLogs')).toBe(false);
    const gap = planLifetimeHistory({ coverageComplete: false, bulkAvailable: true });
    expect(gap.steps.some((step) => step.source === 'BULK_DATASET')).toBe(true);
    expect(gap.steps.some((step) => step.method === 'eth_getLogs')).toBe(false);
  });

  it('promotes a shadow key only when accuracy holds and a threshold is met', () => {
    const baseline = {
      completionRate: 0.4,
      originTraceCompletion: 0,
      p50Ms: 200,
      p95Ms: 1000,
      p99Ms: 2000,
      rateLimited: 20,
      timeouts: 5,
      coverage: 0.4,
      sourceConflicts: 0,
      requestCost: 10,
      costPerCompletedCase: 2,
      resultHashDiffs: 0,
      closedCriticalCapability: false,
    };
    expect(evaluateShadowPromotion(baseline, { ...baseline, completionRate: 0.45 }).promote).toBe(
      false,
    );
    expect(evaluateShadowPromotion(baseline, { ...baseline, completionRate: 0.55 }).promote).toBe(
      true,
    );
    expect(
      evaluateShadowPromotion(baseline, {
        ...baseline,
        closedCriticalCapability: true,
      }).promote,
    ).toBe(true);
    expect(evaluateShadowPromotion(baseline, { ...baseline, p95Ms: 700 }).promote).toBe(true);
    expect(
      evaluateShadowPromotion(baseline, {
        ...baseline,
        completionRate: 0.9,
        sourceConflicts: 1,
      }).promote,
    ).toBe(false);
  });

  it('never puts API keys into a result hash', () => {
    const secret = 'super-secret-key-value';
    expect(resultHash(`https://example/${secret}`, [secret])).not.toContain(secret);
    expect(resultHash(`https://example/${secret}`, [secret])).toBe(
      resultHash('https://example/[REDACTED]'),
    );
  });

  it('binary-splits failed log windows', () => {
    expect(splitRange(10n, 20n)).toEqual({
      left: { from: 10n, to: 14n },
      right: { from: 15n, to: 20n },
    });
  });
});
