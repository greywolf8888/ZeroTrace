import { describe, it, expect, vi } from 'vitest';
import { liveObserver } from '../../../apps/arc-task-ledger-api/src/live.js';
import { LedgerError } from '../../../packages/arc-task-ledger/src/types.js';
import { snapshot } from '../fixtures/helpers.js';
import { rawEvidence } from '../../../packages/arc-task-ledger/src/protocol.js';

describe('实时只读观察的负载与证据边界', () => {
  it('并发访问合并为一次来源读取，30 秒内复用，不声明持久取证', async () => {
    let time = Date.now();
    const raw = rawEvidence({ block: '0x1' }, snapshot, '测试定位', '临时观察');
    const originalRef = raw.evidence.rawArtifactRef;
    const collect = vi.fn(async () => ({ snapshot, evidence: [raw] }));
    const observer = liveObserver(collect, () => time);
    const results = await Promise.all(Array.from({ length: 20 }, () => observer.read()));
    expect(collect).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({
      state: 'fresh',
      durable: false,
      formalForensicReady: false,
    });
    expect(results[0]?.observation?.evidence[0]?.evidence.rawArtifactRef).toBe(
      `unarchived:sha256:${raw.evidence.payloadHash}`,
    );
    expect(raw.evidence.rawArtifactRef).toBe(originalRef);
    time += 29999;
    await observer.read();
    expect(collect).toHaveBeenCalledTimes(1);
    time += 1;
    await observer.read();
    expect(collect).toHaveBeenCalledTimes(2);
  });
  it('失败也冷却；当前值不可用，上次成功观察不会伪装成当前或零', async () => {
    let time = Date.now();
    const collect = vi
      .fn()
      .mockResolvedValueOnce({ snapshot, evidence: [] })
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce({ snapshot, evidence: [] });
    const observer = liveObserver(collect, () => time);
    await observer.read();
    time += 30000;
    const failed = await observer.read();
    expect(failed).toMatchObject({
      state: 'provider-down',
      observation: null,
      lastSuccessfulObservation: { snapshot },
    });
    await observer.read();
    expect(collect).toHaveBeenCalledTimes(2);
    time += 30000;
    expect((await observer.read()).state).toBe('fresh');
  });
  it('来源冲突和缺失区块分别显示，陈旧来源不能标记 fresh', async () => {
    const conflict = liveObserver(async () => {
      throw new LedgerError('WRONG_CHAIN', '错误链', 409);
    });
    expect((await conflict.read()).state).toBe('conflict');
    const unavailable = liveObserver(async () => {
      throw new LedgerError('INVALID_RESPONSE', '缺失时间');
    });
    expect((await unavailable.read()).state).toBe('unavailable');
    const stale = liveObserver(async () => ({
      snapshot,
      evidence: [],
      blockTimestamp: new Date(Date.now() - 180000).toISOString(),
    }));
    expect(await stale.read()).toMatchObject({
      state: 'stale',
      observation: null,
      lastSuccessfulObservation: { snapshot },
    });
  });
});
