import { Pool } from 'pg';
import { Client as MinioClient } from 'minio';

import type { ArtifactRecord, ArtifactStore, DataClass, MetadataStore } from '@zerotrace/storage-plane';

export class PostgresMetadataStore implements MetadataStore {
  readonly #pool: Pool;
  #ready: Promise<void> | undefined;

  constructor(connectionString: string) {
    this.#pool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000 });
    this.#pool.on('error', () => undefined);
  }

  async #ensure(): Promise<void> {
    this.#ready ??= this.#pool
      .query(
        `CREATE TABLE IF NOT EXISTS storage_plane_kv (
           key text PRIMARY KEY,
           value text NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
      )
      .then(() => undefined);
    await this.#ready;
  }

  async get(key: string): Promise<string | undefined> {
    await this.#ensure();
    const result = await this.#pool.query('SELECT value FROM storage_plane_kv WHERE key = $1', [key]);
    const value = result.rows[0]?.value;
    return typeof value === 'string' ? value : undefined;
  }

  async put(key: string, value: string): Promise<void> {
    await this.#ensure();
    await this.#pool.query(
      `INSERT INTO storage_plane_kv (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value],
    );
  }

  async list(prefix: string): Promise<string[]> {
    await this.#ensure();
    const result = await this.#pool.query(
      `SELECT key FROM storage_plane_kv WHERE key LIKE $1 ORDER BY key`,
      [`${prefix}%`],
    );
    return result.rows.map((row) => String(row.key));
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}

export class ObjectStoreArtifactStore implements ArtifactStore {
  readonly #client: MinioClient;
  readonly #bucket: string;
  readonly #prefix: string;

  constructor(input: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    prefix?: string;
  }) {
    const url = new URL(input.endpoint);
    this.#client = new MinioClient({
      endPoint: url.hostname,
      port: url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port),
      useSSL: url.protocol === 'https:',
      accessKey: input.accessKey,
      secretKey: input.secretKey,
    });
    this.#bucket = input.bucket;
    this.#prefix = input.prefix ?? 'storage-plane/artifacts/';
  }

  #key(id: string): string {
    return `${this.#prefix}${id}`;
  }

  #metaKey(id: string): string {
    return `${this.#prefix}meta/${id}.json`;
  }

  async put(
    id: string,
    bytes: Uint8Array,
    meta: { dataClass: DataClass; contentType: string; permanent?: boolean },
  ): Promise<ArtifactRecord> {
    const record: ArtifactRecord = {
      id,
      dataClass: meta.dataClass,
      contentType: meta.contentType,
      bytes: bytes.byteLength,
      sha256: '',
      createdAt: new Date().toISOString(),
      lastAccessAt: new Date().toISOString(),
      permanent: meta.permanent === true || meta.dataClass === 'PERMANENT_EVIDENCE',
    };
    await this.#client.putObject(this.#bucket, this.#key(id), Buffer.from(bytes));
    await this.#client.putObject(this.#bucket, this.#metaKey(id), Buffer.from(JSON.stringify(record)));
    return record;
  }

  async get(id: string): Promise<Uint8Array | undefined> {
    try {
      const stream = await this.#client.getObject(this.#bucket, this.#key(id));
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch {
      return undefined;
    }
  }

  async stat(id: string): Promise<ArtifactRecord | undefined> {
    try {
      const stream = await this.#client.getObject(this.#bucket, this.#metaKey(id));
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ArtifactRecord;
    } catch {
      return undefined;
    }
  }

  async deleteEphemeral(id: string): Promise<boolean> {
    const record = await this.stat(id);
    if (record === undefined || record.permanent || record.dataClass === 'PERMANENT_EVIDENCE') {
      return false;
    }
    await this.#client.removeObject(this.#bucket, this.#key(id));
    await this.#client.removeObject(this.#bucket, this.#metaKey(id));
    return true;
  }

  async list(): Promise<ArtifactRecord[]> {
    return [];
  }

  async byteSize(): Promise<number> {
    return 0;
  }
}
