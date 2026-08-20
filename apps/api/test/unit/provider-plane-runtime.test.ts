import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CaptureReport } from '@zerotrace/token-market-capture';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { createStoragePlane } from '../../src/storage-plane-bind.js';
import {
  createTokenCaptureRuntime,
  operatorsFromPlane,
  wrapSqdBulkSource,
  wrapSqdCreationSource,
} from '../../src/token-capture-runtime.js';
import { buildProviderPlaneBindings } from '../../src/provider-slots.js';

describe('provider plane runtime wiring', () => {
  it('starts without free keys and keeps those slots UNCONFIGURED', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    const runtime = createTokenCaptureRuntime(config);
    expect(runtime).toBeDefined();
    expect(config.providerSlotStatus.NODEREAL_API_KEY).toBe('UNCONFIGURED');
    expect(runtime?.traceAvailable).toBe(false);
    const operators = operatorsFromPlane(config);
    expect(new Set(operators.map((item) => item.independenceGroup)).size).toBeGreaterThanOrEqual(2);
    expect(
      operators.every(
        (item) => item.logsCapability === 'denied' || item.logsCapability === 'declared',
      ),
    ).toBe(true);
  });

  it('does not put API keys into selection records or JSON', () => {
    const config = loadConfig({ NODE_ENV: 'test', NODEREAL_API_KEY: 'nodereal-secret-key' });
    const plane = buildProviderPlaneBindings(config);
    expect(plane.keyedArchiveAvailable).toBe(true);
    expect(JSON.stringify(plane.records)).not.toContain('nodereal-secret-key');
    expect(plane.records.some((item) => item.providerId === 'slot-nodereal-free')).toBe(true);
  });

  it('exposes a generic TRACE slot without embedding the secret in records', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      BSC_TRACE_RPC_URL: 'https://bsc-mainnet.nodereal.io/v1/trace-secret-key-value',
    });
    const runtime = createTokenCaptureRuntime(config);
    expect(runtime?.traceAvailable).toBe(true);
    expect(runtime?.traceEndpointId).toBe('slot-bsc-trace');
    const plane = buildProviderPlaneBindings(config);
    expect(JSON.stringify(plane.records)).not.toContain('trace-secret-key-value');
  });

  it('registers optional keyed and bulk slots without putting secrets into selection records', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      ANKR_API_KEY: 'ankr-secret-key-value',
      CHAINSTACK_BSC_RPC_URL: 'https://chainstack.example/bsc',
      DRPC_API_KEY: 'drpc-secret-key-value',
      HELIUS_API_KEY: 'helius-secret-key-value',
      SQD_PORTAL_URL: 'https://portal.sqd.dev',
    });
    const plane = buildProviderPlaneBindings(config);
    expect(plane.records.some((item) => item.providerId === 'slot-ankr-freemium')).toBe(true);
    expect(plane.records.some((item) => item.providerId === 'slot-chainstack-bsc')).toBe(true);
    expect(plane.records.some((item) => item.providerId === 'slot-drpc')).toBe(true);
    expect(plane.records.some((item) => item.providerId === 'slot-helius')).toBe(true);
    expect(plane.records.some((item) => item.providerId === 'bulk-sqd-binance-mainnet')).toBe(true);
    const serialized = JSON.stringify(plane.records);
    expect(serialized).not.toContain('ankr-secret-key-value');
    expect(serialized).not.toContain('drpc-secret-key-value');
    expect(serialized).not.toContain('helius-secret-key-value');
  });

  it('rejects invalid bulk filters and keeps creation-trace failures as unknown, not zero', async () => {
    expect(wrapSqdBulkSource(undefined)).toBeUndefined();
    expect(wrapSqdCreationSource(undefined)).toBeUndefined();
    const bulk = wrapSqdBulkSource({
      getLogsObservation: async () => ({ value: [] }),
    } as never);
    expect(await bulk!.getLogs([])).toMatchObject({ ok: false, error: 'invalid log filter' });
    expect(
      await bulk!.getLogs([
        { fromBlock: '0x1', toBlock: '0x2', address: '0xabc', topics: ['0x1'] },
      ]),
    ).toMatchObject({ ok: true });
    const failingBulk = wrapSqdBulkSource({
      getLogsObservation: async () => {
        throw 'bulk down';
      },
    } as never);
    expect(
      await failingBulk!.getLogs([{ fromBlock: '0x1', toBlock: '0x2', address: '0xabc' }]),
    ).toMatchObject({ ok: false, error: 'bulk logs failed' });
    const creations = wrapSqdCreationSource({
      getContractCreationsObservation: async () => {
        throw new Error('creation down');
      },
    } as never);
    expect(
      await creations!.getCreations({ address: '0xabc', fromBlock: '0x1', toBlock: '0x2' }),
    ).toMatchObject({ ok: false, error: 'creation down' });
    const okCreations = wrapSqdCreationSource({
      getContractCreationsObservation: async () => ({ value: [] }),
    } as never);
    expect(
      (await okCreations!.getCreations({ address: '0xabc', fromBlock: '0x1', toBlock: '0x2' })).ok,
    ).toBe(true);
  });
});

describe('storage plane bind', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('hydrates a complete origin and maps every capture stage without inventing missing fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zt-bind-'));
    dirs.push(dir);
    const config = loadConfig({ NODE_ENV: 'test', ZEROTRACE_STORAGE_ROOT: dir });
    const runtime = createTokenCaptureRuntime(config, {
      storagePlane: createStoragePlane(config),
    });
    expect(runtime?.persist).toBeDefined();
    expect(runtime?.hydrate).toBeDefined();
    const token = `0x${'aa'.repeat(20)}`;
    const report: CaptureReport = {
      chainId: 'eip155:56',
      token,
      stages: [
        { name: 'SNAPSHOT', status: 'COMPLETE' },
        { name: 'ORIGIN', status: 'COMPLETE' },
        { name: 'HISTORY', status: 'PARTIAL', limitation: 'log-window' },
        { name: 'SUPPLY', status: 'COMPLETE' },
        { name: 'ENTITY', status: 'PENDING' },
        { name: 'CAMPAIGN', status: 'RUNNING' },
        { name: 'CAPITAL', status: 'COMPLETE' },
        { name: 'RV', status: 'UNSUPPORTED' },
        { name: 'REPLAY', status: 'FAILED' },
        { name: 'CAPABILITY', status: 'COMPLETE' },
      ],
      origin: {
        status: 'COMPLETE',
        creationTx: `0x${'11'.repeat(32)}`,
        deployer: `0x${'bb'.repeat(20)}`,
        createdBlock: '16',
        codeHash: `0x${'cc'.repeat(32)}`,
        limitation: 'sample',
        limitationCode: 'OK',
      },
      history: { status: 'PARTIAL', logCount: 1 },
      holders: [],
      roles: [],
      campaignWindows: [],
      lotCount: 0,
      artifacts: [],
      rawHashesValid: true,
      rpcStats: { current: 0, historical: 0, trace: 0, byMethod: {} },
    };
    await runtime!.persist!({ chainId: 'eip155:56', token }, report);
    await runtime!.hydrate!({ chainId: 'eip155:56', token });
    expect(runtime!.cachedOrigins?.get(token)?.status).toBe('COMPLETE');
    expect(runtime!.cachedOrigins?.get(token)?.creationTx).toBe(report.origin.creationTx);

    const partial: CaptureReport = {
      ...report,
      origin: { status: 'PARTIAL' },
    };
    const other = `0x${'dd'.repeat(20)}`;
    await runtime!.persist!({ chainId: 'eip155:56', token: other }, partial);
    await runtime!.hydrate!({ chainId: 'eip155:56', token: other });
    expect(runtime!.cachedOrigins?.has(other)).toBe(false);
  });

  it('keeps MinIO optional on selective profile without treating unconfigured object storage as empty evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zt-minio-'));
    dirs.push(dir);
    const config = loadConfig({
      NODE_ENV: 'test',
      ZEROTRACE_STORAGE_ROOT: dir,
      ZEROTRACE_STORAGE_PROFILE: 'SELECTIVE_MARKET_INDEX',
      OBJECT_STORE_ENDPOINT: 'https://objects.example',
      OBJECT_STORE_ACCESS_KEY: 'access-key',
      OBJECT_STORE_SECRET_KEY: 'object-secret',
      CLICKHOUSE_URL: 'https://clickhouse.example',
    });
    const plane = createStoragePlane(config);
    expect(plane.profile).toBe('SELECTIVE_MARKET_INDEX');
    expect(plane.hotFacts).toBeDefined();
  });
});
