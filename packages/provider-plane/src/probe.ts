import type { BoundEndpoint, ProviderCapabilitySnapshot, QueryRequest } from './types.js';
import { methodClassOf } from './catalog.js';
import { TRACE_METHODS } from './catalog.js';

export interface ProbeTransport {
  call(
    binding: BoundEndpoint,
    method: string,
    params: unknown[],
  ): Promise<{
    ok: boolean;
    result: unknown;
    raw: string;
    status?: number;
    retryAfter?: string;
    error?: string;
  }>;
}

const HISTORICAL_CODE_BLOCK = '0x1';

export async function probeProvider(
  binding: BoundEndpoint,
  transport: ProbeTransport,
  input: {
    chainId: string;
    timeoutMs: number;
    maxResponseBytes: number;
    logsPolicyDenied: boolean;
    traceConfigured: boolean;
  },
): Promise<ProviderCapabilitySnapshot> {
  const probedAt = new Date().toISOString();
  const base: ProviderCapabilitySnapshot = {
    providerId: binding.providerId,
    operatorId: binding.operatorId,
    endpointRef: binding.endpointRef,
    probedAt,
    chainIdOk: false,
    finalizedOk: false,
    historicalCodeOk: false,
    historicalCallOk: false,
    smallLogsOk: input.logsPolicyDenied ? 'POLICY_DENIED' : false,
    traceOk: input.traceConfigured ? false : 'UNCONFIGURED',
    batchOk: false,
    maxResponseBytes: input.maxResponseBytes,
  };
  try {
    const chainId = await transport.call(binding, 'eth_chainId', []);
    base.chainIdOk = chainId.ok && typeof chainId.result === 'string';
    const finalized = await transport.call(binding, 'eth_getBlockByNumber', ['finalized', false]);
    base.finalizedOk = finalized.ok && finalized.result !== null;
    const code = await transport.call(binding, 'eth_getCode', [
      '0x0000000000000000000000000000000000000000',
      HISTORICAL_CODE_BLOCK,
    ]);
    base.historicalCodeOk = code.ok;
    const call = await transport.call(binding, 'eth_call', [
      { to: '0x0000000000000000000000000000000000000000', data: '0x' },
      HISTORICAL_CODE_BLOCK,
    ]);
    base.historicalCallOk = call.ok;
    if (!input.logsPolicyDenied) {
      const logs = await transport.call(binding, 'eth_getLogs', [
        {
          fromBlock: 'latest',
          toBlock: 'latest',
          address: '0x0000000000000000000000000000000000000000',
        },
      ]);
      base.smallLogsOk = logs.ok;
      if (logs.status === 429 || logs.retryAfter !== undefined) base.retryAfterObserved = true;
    }
    if (input.traceConfigured) {
      const trace = await transport.call(binding, TRACE_METHODS[0], ['0x' + '00'.repeat(32)]);
      base.traceOk = trace.ok;
    }
    base.batchOk = chainId.ok && finalized.ok;
    base.timeoutMsObserved = input.timeoutMs;
    return base;
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : 'probe failed',
    };
  }
}

export function snapshotMeets(
  snapshot: ProviderCapabilitySnapshot,
  request: QueryRequest,
): boolean {
  const methodClass = methodClassOf(request.method, request.params);
  if (!snapshot.chainIdOk) return false;
  if (methodClass === 'ARCHIVE_STATE')
    return snapshot.historicalCodeOk || snapshot.historicalCallOk;
  if (methodClass === 'LOGS') return snapshot.smallLogsOk === true;
  if (methodClass === 'TRACE') return snapshot.traceOk === true;
  return true;
}
