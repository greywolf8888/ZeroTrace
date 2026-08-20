import { parquetReadObjects } from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';

import type { NormalizedFact } from './types.js';

export const FACT_FIELDS: ReadonlyArray<keyof NormalizedFact> = [
  'token',
  'blockOrSlot',
  'blockHash',
  'transactionId',
  'transactionIndex',
  'logOrInstructionIndex',
  'subjectA',
  'subjectB',
  'asset',
  'amountAtomic',
  'eventType',
  'evidenceId',
  'sourceId',
  'adapterVersion',
];

export function tokenBucket(token: string): string {
  const hex = token.toLowerCase().replace(/^0x/, '');
  return hex.slice(0, 2).padEnd(2, '0');
}

export function monthKey(observedAt: string): string {
  const stamp = Date.parse(observedAt);
  const date = Number.isFinite(stamp) ? new Date(stamp) : new Date();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

export function encodeParquet(facts: readonly NormalizedFact[]): Buffer {
  const columnData = FACT_FIELDS.map((name) => ({
    name,
    data: facts.map((row) => row[name]),
    type: 'STRING' as const,
  }));
  const buffer = parquetWriteBuffer({
    columnData,
    codec: 'SNAPPY',
    statistics: true,
    rowGroupSize: Math.max(facts.length, 1),
  });
  return Buffer.from(buffer);
}

export async function decodeParquet(bytes: Buffer): Promise<NormalizedFact[]> {
  if (bytes.length < 8) throw new Error('Parquet 文件过短。');
  const magic = bytes.subarray(0, 4).toString('ascii');
  const trailer = bytes.subarray(bytes.length - 4).toString('ascii');
  if (magic !== 'PAR1' || trailer !== 'PAR1') {
    throw new Error('不是 Apache Parquet（缺少 PAR1 魔数）。');
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const rows = await parquetReadObjects({ file: copy.buffer });
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const fact = {} as NormalizedFact;
    for (const field of FACT_FIELDS) {
      const value = record[field];
      fact[field] = typeof value === 'string' ? value : String(value ?? '');
    }
    return fact;
  });
}

export function factsResultHash(facts: readonly NormalizedFact[]): string {
  const ordered = [...facts].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
  return hashPayload(ordered);
}

export function uncompressedFactBytes(facts: readonly NormalizedFact[]): number {
  return Buffer.byteLength(facts.map((item) => canonicalJson(item)).join('\n'));
}
