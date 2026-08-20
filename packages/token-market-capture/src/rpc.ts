import { createHash } from 'node:crypto';

import type { RpcResult, RpcTransport } from './types.js';

export function normalizeAddress(value: string): string {
  const hex = value.toLowerCase();
  if (hex.startsWith('0x') && hex.length === 42) return hex;
  if (hex.startsWith('0x') && hex.length === 66) return `0x${hex.slice(-40)}`;
  return hex;
}

export function toHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

export function fromHex(value: string): bigint {
  if (value === '0x' || value === '') return 0n;
  return BigInt(value);
}

export function decimalQuantity(value: bigint): string {
  return value.toString(10);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export async function callBoth(
  transport: RpcTransport,
  endpoints: readonly string[],
  method: string,
  params: unknown[],
): Promise<{ left: RpcResult; right: RpcResult; agree: boolean }> {
  const [left, right] = await Promise.all([
    transport.call(endpoints[0]!, method, params),
    transport.call(endpoints[1]!, method, params),
  ]);
  const agree = left.ok && right.ok && canonicalJson(left.result) === canonicalJson(right.result);
  return { left, right, agree };
}

export function topicAddress(topic: string): string {
  return `0x${topic.slice(-40).toLowerCase()}`;
}

export function decodeUint(data: string): bigint {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length === 0) return 0n;
  return BigInt(`0x${hex}`);
}
