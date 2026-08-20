import { normalizeAddress } from './rpc.js';
import type { RpcResult, RpcTransport } from './types.js';

const TRACE_ATTEMPTS: ReadonlyArray<{ method: string; params: (tx: string) => unknown[] }> = [
  {
    method: 'debug_traceTransaction',
    params: (tx) => [tx, { tracer: 'callTracer' }],
  },
  {
    method: 'debug_jsTraceTransaction',
    params: (tx) => [tx, { tracer: 'callTracer' }],
  },
  {
    method: 'trace_transaction',
    params: (tx) => [tx],
  },
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asAddress(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('0x')) return undefined;
  if (value.length !== 42 && value.length !== 66) return undefined;
  const normalized = normalizeAddress(value);
  if (normalized === '0x0000000000000000000000000000000000000000') return undefined;
  return normalized;
}

function createdAddress(node: Record<string, unknown>): string | undefined {
  const result = asRecord(node.result);
  return (
    asAddress(node.to) ??
    asAddress(node.address) ??
    asAddress(node.result) ??
    asAddress(result?.address) ??
    asAddress(asRecord(node.action)?.to) ??
    asAddress(asRecord(node.action)?.address)
  );
}

function callType(node: Record<string, unknown>): string {
  const direct = typeof node.type === 'string' ? node.type : '';
  const actionType = asRecord(node.action)?.callType;
  const nested = typeof actionType === 'string' ? actionType : '';
  return `${direct} ${nested}`.toUpperCase();
}

function isCreate(node: Record<string, unknown>): boolean {
  const type = callType(node);
  return type.includes('CREATE');
}

export function traceCreatesToken(traceResult: unknown, token: string): boolean {
  const expected = normalizeAddress(token);
  const stack: unknown[] = [traceResult];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const node = asRecord(current);
    if (node === undefined) continue;
    if (isCreate(node) && createdAddress(node) === expected) return true;
    if (Array.isArray(node.calls)) stack.push(...node.calls);
    if (Array.isArray(node.trace)) stack.push(...node.trace);
  }
  return false;
}

export async function traceInternalCreate(input: {
  transport: RpcTransport;
  endpointId: string;
  txHash: string;
  token: string;
}): Promise<{ matched: boolean; result: RpcResult; method?: string }> {
  let last: RpcResult = {
    ok: false,
    result: null,
    raw: '',
    error: 'TRACE_UNAVAILABLE',
  };
  for (const attempt of TRACE_ATTEMPTS) {
    const result = await input.transport.call(
      input.endpointId,
      attempt.method,
      attempt.params(input.txHash),
    );
    last = result;
    if (!result.ok) continue;
    return {
      matched: traceCreatesToken(result.result, input.token),
      result,
      method: attempt.method,
    };
  }
  return { matched: false, result: last };
}
