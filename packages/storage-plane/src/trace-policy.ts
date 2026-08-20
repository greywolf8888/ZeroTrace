import type { TraceClass } from './types.js';

export const TRACE_REASONS = [
  'Creation/Internal CREATE',
  'Proxy Init',
  'Permission Change',
  'Migration',
  'Critical LP',
  'Material Settlement',
  'Disputed Sell',
] as const;

export type TraceReason = (typeof TRACE_REASONS)[number];

export function classifyTrace(input: {
  reason: TraceReason;
  inActiveCase: boolean;
}): TraceClass {
  if (input.inActiveCase) return 'CASE_TRACE';
  if (
    input.reason === 'Creation/Internal CREATE' ||
    input.reason === 'Migration' ||
    input.reason === 'Material Settlement' ||
    input.reason === 'Disputed Sell'
  ) {
    return 'MATERIAL_TRACE';
  }
  return 'EPHEMERAL_TRACE';
}

export function shouldFetchTrace(reason: string): reason is TraceReason {
  return (TRACE_REASONS as readonly string[]).includes(reason);
}

export function isHistoricalRpc(method: string, params: readonly unknown[]): boolean {
  if (method === 'eth_blockNumber' || method === 'eth_chainId' || method === 'net_version') {
    return false;
  }
  if (method.startsWith('debug_') || method.startsWith('trace_')) return true;
  if (method === 'eth_getCode' || method === 'eth_call') {
    const tag = params[1];
    return tag !== 'latest' && tag !== 'safe' && tag !== 'finalized';
  }
  return true;
}

export function isTraceRpc(method: string): boolean {
  return method.startsWith('debug_') || method.startsWith('trace_');
}
