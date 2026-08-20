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
import { createHash } from 'node:crypto';

import { expired, lruOrder } from './ttl.js';
import type { ArtifactRecord, ArtifactStore, DataClass } from './types.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class LocalFsArtifactStore implements ArtifactStore {
  constructor(private readonly rootDir: string) {}

  #blobPath(digest: string): string {
    return join(this.rootDir, 'artifacts', 'sha256', digest.slice(0, 2), digest);
  }

  #metaPath(id: string): string {
    return join(this.rootDir, 'artifacts', 'meta', `${id}.json`);
  }

  async put(
    id: string,
    bytes: Uint8Array,
    meta: { dataClass: DataClass; contentType: string; permanent?: boolean },
  ): Promise<ArtifactRecord> {
    const digest = sha256(bytes);
    const blob = this.#blobPath(digest);
    mkdirSync(dirname(blob), { recursive: true });
    if (!existsSync(blob)) {
      const temp = `${blob}.tmp`;
      writeFileSync(temp, bytes);
      renameSync(temp, blob);
    }
    const now = new Date().toISOString();
    const record: ArtifactRecord = {
      id,
      dataClass: meta.dataClass,
      contentType: meta.contentType,
      bytes: bytes.byteLength,
      sha256: digest,
      createdAt: now,
      lastAccessAt: now,
      permanent: meta.permanent === true || meta.dataClass === 'PERMANENT_EVIDENCE',
    };
    const metaPath = this.#metaPath(id);
    mkdirSync(dirname(metaPath), { recursive: true });
    writeFileSync(`${metaPath}.tmp`, `${JSON.stringify(record)}\n`);
    renameSync(`${metaPath}.tmp`, metaPath);
    return record;
  }

  async get(id: string): Promise<Uint8Array | undefined> {
    const record = await this.stat(id);
    if (record === undefined) return undefined;
    try {
      const bytes = readFileSync(this.#blobPath(record.sha256));
      record.lastAccessAt = new Date().toISOString();
      writeFileSync(this.#metaPath(id), `${JSON.stringify(record)}\n`);
      return bytes;
    } catch {
      return undefined;
    }
  }

  async stat(id: string): Promise<ArtifactRecord | undefined> {
    try {
      return JSON.parse(readFileSync(this.#metaPath(id), 'utf8')) as ArtifactRecord;
    } catch {
      return undefined;
    }
  }

  async deleteEphemeral(id: string): Promise<boolean> {
    const record = await this.stat(id);
    if (record === undefined) return false;
    if (record.permanent || record.dataClass === 'PERMANENT_EVIDENCE') return false;
    rmSync(this.#metaPath(id), { force: true });
    return true;
  }

  async list(dataClass?: DataClass): Promise<ArtifactRecord[]> {
    const dir = join(this.rootDir, 'artifacts', 'meta');
    const out: ArtifactRecord[] = [];
    const walk = (current: string): void => {
      let names: string[] = [];
      try {
        names = readdirSync(current);
      } catch {
        return;
      }
      for (const name of names) {
        const full = join(current, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith('.json')) continue;
        try {
          const record = JSON.parse(readFileSync(full, 'utf8')) as ArtifactRecord;
          if (dataClass === undefined || record.dataClass === dataClass) out.push(record);
        } catch {
          continue;
        }
      }
    };
    walk(dir);
    return out;
  }

  async byteSize(dataClass?: DataClass): Promise<number> {
    const records = await this.list(dataClass);
    return records.reduce((sum, item) => sum + item.bytes, 0);
  }

  async evictExpired(nowMs: number): Promise<number> {
    let removed = 0;
    for (const record of await this.list()) {
      if (!expired(record.createdAt, nowMs, record.dataClass)) continue;
      if (await this.deleteEphemeral(record.id)) removed += 1;
    }
    return removed;
  }

  async evictLru(targetBytes: number): Promise<number> {
    const ephemeral = (await this.list()).filter(
      (item) => !item.permanent && item.dataClass !== 'PERMANENT_EVIDENCE',
    );
    let remaining = await this.byteSize();
    let removed = 0;
    for (const record of lruOrder(ephemeral)) {
      if (remaining <= targetBytes) break;
      if (await this.deleteEphemeral(record.id)) {
        remaining -= record.bytes;
        removed += 1;
      }
    }
    return removed;
  }
}

export class S3ArtifactStore implements ArtifactStore {
  constructor(private readonly inner: ArtifactStore) {}

  put(
    id: string,
    bytes: Uint8Array,
    meta: { dataClass: DataClass; contentType: string; permanent?: boolean },
  ): Promise<ArtifactRecord> {
    return this.inner.put(id, bytes, meta);
  }

  get(id: string): Promise<Uint8Array | undefined> {
    return this.inner.get(id);
  }

  stat(id: string): Promise<ArtifactRecord | undefined> {
    return this.inner.stat(id);
  }

  deleteEphemeral(id: string): Promise<boolean> {
    return this.inner.deleteEphemeral(id);
  }

  list(dataClass?: DataClass): Promise<ArtifactRecord[]> {
    return this.inner.list(dataClass);
  }

  byteSize(dataClass?: DataClass): Promise<number> {
    return this.inner.byteSize(dataClass);
  }
}

export class MinioArtifactStore extends S3ArtifactStore {}
