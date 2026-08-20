import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { decodeParquet, encodeParquet, factsResultHash, monthKey, tokenBucket } from './parquet.js';
import type { FactStore, NormalizedFact } from './types.js';

function walkParquet(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkParquet(full, files);
    else if (name.endsWith('.parquet')) files.push(full);
  }
  return files;
}

function hivePath(
  rootDir: string,
  chain: string,
  fact: NormalizedFact,
  part: string,
  observedAt: string,
): string {
  return join(
    rootDir,
    'facts',
    `chain=${chain}`,
    `type=${fact.eventType}`,
    `month=${monthKey(observedAt)}`,
    `bucket=${tokenBucket(fact.token)}`,
    part,
  );
}

export class DuckDbParquetFactStore implements FactStore {
  readonly backend = 'DUCKDB_PARQUET' as const;
  #seq = 0;

  constructor(
    private readonly rootDir: string,
    private readonly chain = 'eip155-56',
  ) {}

  async append(facts: readonly NormalizedFact[], observedAt = new Date().toISOString()): Promise<{ bytes: number }> {
    if (facts.length === 0) return { bytes: 0 };
    this.#seq += 1;
    const first = facts[0]!;
    const path = hivePath(
      this.rootDir,
      this.chain,
      first,
      `part-${String(this.#seq).padStart(6, '0')}.parquet`,
      observedAt,
    );
    mkdirSync(dirname(path), { recursive: true });
    const bytes = encodeParquet(facts);
    writeFileSync(`${path}.tmp`, bytes);
    renameSync(`${path}.tmp`, path);
    return { bytes: bytes.length };
  }

  async queryByToken(token: string, factType?: string): Promise<NormalizedFact[]> {
    const wanted = token.toLowerCase();
    const out: NormalizedFact[] = [];
    for (const file of walkParquet(join(this.rootDir, 'facts'))) {
      if (factType !== undefined && !file.includes(`type=${factType}`)) continue;
      const rows = await decodeParquet(readFileSync(file));
      for (const row of rows) {
        if (row.token.toLowerCase() === wanted) out.push(row);
      }
    }
    return out;
  }

  async resultHash(token: string, factType?: string): Promise<string> {
    return factsResultHash(await this.queryByToken(token, factType));
  }

  async byteSize(): Promise<number> {
    return walkParquet(join(this.rootDir, 'facts')).reduce((sum, file) => sum + statSync(file).size, 0);
  }

  async compact(): Promise<{ filesBefore: number; filesAfter: number; bytesAfter: number }> {
    const files = walkParquet(join(this.rootDir, 'facts'));
    const filesBefore = files.length;
    const byDir = new Map<string, string[]>();
    for (const file of files) {
      const dir = dirname(file);
      const list = byDir.get(dir) ?? [];
      list.push(file);
      byDir.set(dir, list);
    }
    for (const [dir, group] of byDir) {
      if (group.length < 2) continue;
      const merged: NormalizedFact[] = [];
      for (const file of group) merged.push(...(await decodeParquet(readFileSync(file))));
      const bytes = encodeParquet(merged);
      const target = join(dir, 'part-compact.parquet');
      writeFileSync(`${target}.tmp`, bytes);
      renameSync(`${target}.tmp`, target);
      for (const file of group) {
        if (file !== target) rmSync(file, { force: true });
      }
    }
    const after = walkParquet(join(this.rootDir, 'facts'));
    return {
      filesBefore,
      filesAfter: after.length,
      bytesAfter: after.reduce((sum, file) => sum + statSync(file).size, 0),
    };
  }
}

export class MemoryFactStore implements FactStore {
  readonly backend = 'MEMORY' as const;
  readonly #rows: NormalizedFact[] = [];

  async append(facts: readonly NormalizedFact[]): Promise<{ bytes: number }> {
    this.#rows.push(...facts);
    return { bytes: Buffer.byteLength(JSON.stringify(facts)) };
  }

  async queryByToken(token: string, factType?: string): Promise<NormalizedFact[]> {
    const wanted = token.toLowerCase();
    return this.#rows.filter(
      (item) =>
        item.token.toLowerCase() === wanted && (factType === undefined || item.eventType === factType),
    );
  }

  async resultHash(token: string, factType?: string): Promise<string> {
    return factsResultHash(await this.queryByToken(token, factType));
  }

  async byteSize(): Promise<number> {
    return Buffer.byteLength(JSON.stringify(this.#rows));
  }

  async compact(): Promise<{ filesBefore: number; filesAfter: number; bytesAfter: number }> {
    return { filesBefore: 1, filesAfter: 1, bytesAfter: await this.byteSize() };
  }
}

export class ClickHouseFactStore implements FactStore {
  readonly backend = 'CLICKHOUSE' as const;
  readonly #rows: NormalizedFact[] = [];
  readonly available: boolean;

  constructor(url?: string) {
    this.available = url !== undefined && url.length > 0;
  }

  async append(facts: readonly NormalizedFact[]): Promise<{ bytes: number }> {
    if (!this.available) throw new Error('CLICKHOUSE_UNAVAILABLE');
    this.#rows.push(...facts);
    return { bytes: Buffer.byteLength(JSON.stringify(facts)) };
  }

  async queryByToken(token: string, factType?: string): Promise<NormalizedFact[]> {
    if (!this.available) throw new Error('CLICKHOUSE_UNAVAILABLE');
    const wanted = token.toLowerCase();
    return this.#rows.filter(
      (item) =>
        item.token.toLowerCase() === wanted && (factType === undefined || item.eventType === factType),
    );
  }

  async resultHash(token: string, factType?: string): Promise<string> {
    return factsResultHash(await this.queryByToken(token, factType));
  }

  async byteSize(): Promise<number> {
    return Buffer.byteLength(JSON.stringify(this.#rows));
  }

  async compact(): Promise<{ filesBefore: number; filesAfter: number; bytesAfter: number }> {
    return { filesBefore: 1, filesAfter: 1, bytesAfter: await this.byteSize() };
  }
}

export class DualFactStore implements FactStore {
  readonly backend = 'DUCKDB_PARQUET' as const;

  constructor(
    private readonly cold: FactStore,
    private readonly hot: FactStore,
  ) {}

  async append(facts: readonly NormalizedFact[], observedAt?: string): Promise<{ bytes: number }> {
    const cold = await this.cold.append(facts, observedAt);
    try {
      await this.hot.append(facts, observedAt);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'CLICKHOUSE_UNAVAILABLE') throw error;
    }
    return cold;
  }

  queryByToken(token: string, factType?: string): Promise<NormalizedFact[]> {
    return this.cold.queryByToken(token, factType);
  }

  resultHash(token: string, factType?: string): Promise<string> {
    return this.cold.resultHash(token, factType);
  }

  byteSize(): Promise<number> {
    return this.cold.byteSize();
  }

  compact(): Promise<{ filesBefore: number; filesAfter: number; bytesAfter: number }> {
    return this.cold.compact();
  }
}
