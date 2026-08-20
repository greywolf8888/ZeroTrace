import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { coverageGaps, mergeSpans, type CoverageSpan } from '@zerotrace/local-index';

import type { CoverageRecord, CoverageRegistry } from './types.js';

function coveragePath(rootDir: string, chainId: string, token: string, factType: string): string {
  return join(rootDir, 'coverage', chainId.replaceAll(':', '_'), `${token.toLowerCase()}.${factType}.json`);
}

function toSpans(records: readonly CoverageRecord[]): CoverageSpan[] {
  return records.map((item) => ({
    startBlock: BigInt(item.startBlock),
    endBlock: BigInt(item.endBlock),
  }));
}

export class FileCoverageRegistry implements CoverageRegistry {
  constructor(private readonly rootDir: string) {}

  async read(chainId: string, token: string, factType = 'Transfer'): Promise<CoverageRecord[]> {
    const path = coveragePath(this.rootDir, chainId, token, factType);
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as CoverageRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async commit(record: CoverageRecord): Promise<void> {
    const existing = await this.read(record.chainId, record.token, record.factType);
    const merged = mergeSpans(
      toSpans([...existing, record]),
    );
    const next: CoverageRecord[] = merged.map((span) => ({
      chainId: record.chainId,
      token: record.token.toLowerCase(),
      factType: record.factType,
      startBlock: span.startBlock.toString(10),
      endBlock: span.endBlock.toString(10),
      updatedAt: record.updatedAt,
      ...(record.headBlock === undefined ? {} : { headBlock: record.headBlock }),
    }));
    const path = coveragePath(this.rootDir, record.chainId, record.token, record.factType);
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(next)}\n`);
    renameSync(temp, path);
  }
}

export function missingRanges(
  records: readonly CoverageRecord[],
  startBlock: bigint,
  endBlock: bigint,
): CoverageSpan[] {
  return coverageGaps(toSpans(records), startBlock, endBlock);
}
