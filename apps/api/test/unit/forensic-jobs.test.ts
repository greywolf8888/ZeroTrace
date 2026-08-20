import { describe, expect, it } from 'vitest';

import { MemoryLocalIndex } from '@zerotrace/local-index';
import { operatorFromEndpoint } from '@zerotrace/source-registry';
import { InMemoryJobQueue } from '@zerotrace/workflow-core';

import type { AppRuntime } from '../../src/runtime.js';
import { processOneForensicJob } from '../../src/workers/forensic-jobs.js';

function runtime(overrides: Partial<AppRuntime> = {}): AppRuntime {
  return overrides as AppRuntime;
}

describe('forensic job worker', () => {
  it('no-ops when the queue is empty', async () => {
    const queue = new InMemoryJobQueue();
    await expect(processOneForensicJob(queue, runtime())).resolves.toBeUndefined();
  });

  it('keeps origin history offline without a creation reader', async () => {
    const queue = new InMemoryJobQueue();
    const job = queue.enqueue({ type: 'TOKEN_ORIGIN_HISTORY', idempotencyKey: 'origin-offline' });
    const result = await processOneForensicJob(queue, runtime());
    expect(result).toMatchObject({ id: job.id, status: 'SUCCEEDED', resultRef: 'OFFLINE' });
  });

  it('does not start origin capture just because a reader exists', async () => {
    const queue = new InMemoryJobQueue();
    queue.enqueue({ type: 'TOKEN_ORIGIN_HISTORY', idempotencyKey: 'origin-reader' });
    const result = await processOneForensicJob(
      queue,
      runtime({ sqdBscCreationReader: { kind: 'stub' } as never }),
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', resultRef: 'ORIGIN_CAPTURE_NOT_STARTED' });
  });

  it('refuses an empty market-structure worker materialization', async () => {
    const queue = new InMemoryJobQueue();
    const job = queue.enqueue({
      type: 'TOKEN_MARKET_STRUCTURE',
      idempotencyKey: 'market',
      maxAttempts: 1,
    });
    const result = await processOneForensicJob(queue, runtime());
    expect(result).toMatchObject({
      id: job.id,
      status: 'DEAD_LETTER',
    });
    expect(result?.lastError).toContain('token-only payload');
  });

  it('runs the stage DAG for a token-only payload without marking COMPLETE', async () => {
    const queue = new InMemoryJobQueue();
    queue.enqueue({
      type: 'TOKEN_MARKET_STRUCTURE',
      idempotencyKey: 'market-payload',
      payload: JSON.stringify({
        ledger: 'EVM',
        chainId: 'eip155:56',
        token: '0xAeCBD0E461047d6B7Cfc82e637AD197097407777',
      }),
    });
    const result = await processOneForensicJob(queue, runtime());
    expect(result?.status).toBe('SUCCEEDED');
    expect(result?.resultRef).toBe('PARTIAL');
    expect(result?.checkpoint).toContain('CAPABILITY');
    expect(result?.checkpoint).not.toContain('"status":"COMPLETE","name":"RV"');
  });

  it('runs origin capture when a token capture runtime is injected', async () => {
    const queue = new InMemoryJobQueue();
    const token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const tx = `0x${'22'.repeat(32)}`;
    const left = 'https://bsc-dataseed.bnbchain.org';
    const right = 'https://bsc.nodereal.io';
    queue.enqueue({
      type: 'TOKEN_MARKET_STRUCTURE',
      idempotencyKey: 'capture',
      payload: JSON.stringify({
        ledger: 'EVM',
        chainId: 'eip155:56',
        token,
        creationTx: tx,
      }),
    });
    const result = await processOneForensicJob(
      queue,
      runtime({
        tokenCapture: {
          transport: {
            async call(_endpoint: string, method: string) {
              if (method === 'eth_blockNumber') {
                return { ok: true, result: '0x20', raw: '{"result":"0x20"}' };
              }
              if (method === 'eth_getTransactionByHash') {
                return {
                  ok: true,
                  result: {
                    hash: tx,
                    from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                    to: null,
                  },
                  raw: '{"result":"tx"}',
                };
              }
              if (method === 'eth_getTransactionReceipt') {
                return {
                  ok: true,
                  result: {
                    status: '0x1',
                    contractAddress: token,
                    blockNumber: '0x10',
                    transactionHash: tx,
                  },
                  raw: '{"result":"receipt"}',
                };
              }
              if (method === 'eth_getCode') {
                return { ok: true, result: '0x6001', raw: '{"result":"0x6001"}' };
              }
              if (method === 'eth_getLogs') {
                return { ok: true, result: [], raw: '{"result":[]}' };
              }
              return { ok: false, result: null, raw: '', error: method };
            },
          },
          operators: [
            operatorFromEndpoint({ endpointId: left, chainId: 'eip155:56' }),
            operatorFromEndpoint({ endpointId: right, chainId: 'eip155:56' }),
          ],
          index: new MemoryLocalIndex(),
          logBudgetChunks: 1,
        },
      }),
    );
    expect(result?.status).toBe('SUCCEEDED');
    expect(result?.resultRef).toBe('PARTIAL');
    expect(result?.checkpoint).toContain('"status":"COMPLETE"');
    expect(result?.checkpoint).toContain('ORIGIN');
  });

  it('dead-letters unsupported forensic job types', async () => {
    const queue = new InMemoryJobQueue();
    queue.enqueue({ type: 'UNKNOWN', idempotencyKey: 'unknown', maxAttempts: 1 });
    const result = await processOneForensicJob(queue, runtime());
    expect(result?.status).toBe('DEAD_LETTER');
    expect(result?.lastError).toContain('Unsupported forensic job type');
  });
});
