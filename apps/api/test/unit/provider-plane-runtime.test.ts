import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { createTokenCaptureRuntime, operatorsFromPlane } from '../../src/token-capture-runtime.js';
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
});
