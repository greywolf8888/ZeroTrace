import { Client as MinioClient } from 'minio';
import type { Readable } from 'node:stream';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import { RawArtifactEnvelopeSchema, type RawArtifactEnvelope } from '@zerotrace/schemas';

export type ObjectStoreErrorCode =
  | 'OBJECT_STORE_UNAVAILABLE'
  | 'OBJECT_STORE_NOT_INITIALIZED'
  | 'ARTIFACT_TOO_LARGE'
  | 'ARTIFACT_CONFLICT'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_INVALID';

export class ObjectStoreError extends Error {
  readonly code: ObjectStoreErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ObjectStoreErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ObjectStoreError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface RawArtifactWriteResult {
  ref: string;
  bucket: string;
  key: string;
  artifactHash: string;
  payloadHash: string;
  size: number;
  created: boolean;
}

export interface ObjectStoreHealth {
  status: 'UP' | 'DOWN';
  backend: 'S3_COMPATIBLE';
  durable: true;
  checkedAt: string;
  bucket: string;
  versioning: true;
  errorCode?: ObjectStoreErrorCode;
}

export interface RawArtifactStoreOptions {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket?: string;
  region?: string;
  maxArtifactBytes?: number;
}

interface ObjectStoreClient {
  bucketExists(bucketName: string): Promise<boolean>;
  makeBucket(
    bucketName: string,
    region?: string,
    options?: { ObjectLocking?: boolean },
  ): Promise<void>;
  setBucketVersioning(
    bucketName: string,
    configuration: { Status: 'Enabled' | 'Suspended' },
  ): Promise<void>;
  getBucketVersioning(bucketName: string): Promise<{ Status?: 'Enabled' | 'Suspended' }>;
  getObject(bucketName: string, objectName: string): Promise<Readable>;
  putObject(
    bucketName: string,
    objectName: string,
    value: Buffer,
    size: number,
    metadata: Record<string, string>,
  ): Promise<{ etag: string; versionId?: string | null }>;
}

interface InternalRawArtifactStoreOptions {
  client: ObjectStoreClient;
  bucket: string;
  region: string;
  maxArtifactBytes: number;
}

const BUCKET_NAME = /^(?!.*\.\.)(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ARTIFACT_REF = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/(.+)#sha256=([0-9a-f]{64})$/;

function requireArtifactSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 1_000_000_000) {
    throw new RangeError('maxArtifactBytes must be between 1024 and 1000000000.');
  }
  return value;
}

function validateBucket(bucket: string): string {
  if (!BUCKET_NAME.test(bucket)) throw new RangeError('Object-store bucket name is invalid.');
  return bucket;
}

function createMinioClient(options: RawArtifactStoreOptions): ObjectStoreClient {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch (error) {
    throw new ObjectStoreError(
      'OBJECT_STORE_NOT_INITIALIZED',
      'Object-store endpoint is invalid.',
      {
        cause: error,
      },
    );
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    (endpoint.pathname !== '' && endpoint.pathname !== '/') ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new ObjectStoreError(
      'OBJECT_STORE_NOT_INITIALIZED',
      'Object-store endpoint must be an HTTP(S) origin without embedded credentials.',
    );
  }
  if (options.accessKey.trim() === '' || options.secretKey.trim() === '') {
    throw new ObjectStoreError(
      'OBJECT_STORE_NOT_INITIALIZED',
      'Object-store credentials must be configured outside the endpoint URL.',
    );
  }
  const defaultPort = endpoint.protocol === 'https:' ? 443 : 80;
  return new MinioClient({
    endPoint: endpoint.hostname,
    port: endpoint.port === '' ? defaultPort : Number(endpoint.port),
    useSSL: endpoint.protocol === 'https:',
    accessKey: options.accessKey,
    secretKey: options.secretKey,
    region: options.region ?? 'us-east-1',
    pathStyle: true,
  });
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  return typeof record.code === 'string' ? record.code : undefined;
}

function isMissingObject(error: unknown): boolean {
  return ['NoSuchKey', 'NoSuchObject', 'NotFound'].includes(errorCode(error) ?? '');
}

function chainPath(chainId: string): string {
  const safe = chainId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .slice(0, 80);
  return `${safe === '' ? 'chain' : safe}-${hashPayload(chainId).slice(0, 8)}`;
}

function artifactKey(envelope: RawArtifactEnvelope, artifactHash: string): string {
  return [
    'v1',
    envelope.ledger.toLowerCase(),
    chainPath(envelope.chainId),
    envelope.blockOrSlot.padStart(20, '0'),
    `${artifactHash}.json`,
  ].join('/');
}

export function parseRawArtifactRef(ref: string): {
  bucket: string;
  key: string;
  artifactHash: string;
} {
  const match = ARTIFACT_REF.exec(ref);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new ObjectStoreError('ARTIFACT_INVALID', 'Raw artifact reference is invalid.');
  }
  if (match[2].includes('..') || match[2].startsWith('/') || match[2].endsWith('/')) {
    throw new ObjectStoreError('ARTIFACT_INVALID', 'Raw artifact key is invalid.');
  }
  return { bucket: match[1], key: match[2], artifactHash: match[3] };
}

async function readBounded(stream: Readable, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > maximum) {
      stream.destroy();
      throw new ObjectStoreError('ARTIFACT_TOO_LARGE', 'Raw artifact exceeds the size limit.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

export class RawArtifactStore {
  readonly #client: ObjectStoreClient;
  readonly #bucket: string;
  readonly #region: string;
  readonly #maxArtifactBytes: number;
  #initialization: Promise<void> | undefined;

  constructor(options: RawArtifactStoreOptions | InternalRawArtifactStoreOptions) {
    if ('client' in options) {
      this.#client = options.client;
      this.#bucket = validateBucket(options.bucket);
      this.#region = options.region;
      this.#maxArtifactBytes = requireArtifactSize(options.maxArtifactBytes);
    } else {
      this.#client = createMinioClient(options);
      this.#bucket = validateBucket(options.bucket ?? 'zerotrace-raw');
      this.#region = options.region ?? 'us-east-1';
      this.#maxArtifactBytes = requireArtifactSize(options.maxArtifactBytes ?? 16_000_000);
    }
  }

  static fromClient(options: InternalRawArtifactStoreOptions): RawArtifactStore {
    return new RawArtifactStore(options);
  }

  async initialize(): Promise<void> {
    this.#initialization ??= this.#initialize().catch((error: unknown) => {
      this.#initialization = undefined;
      throw error;
    });
    return this.#initialization;
  }

  async put(input: Omit<RawArtifactEnvelope, 'schema'>): Promise<RawArtifactWriteResult> {
    const envelope = RawArtifactEnvelopeSchema.parse({
      schema: 'zerotrace-raw-artifact-v1',
      ...input,
    });
    const encoded = Buffer.from(canonicalJson(envelope));
    if (encoded.byteLength > this.#maxArtifactBytes) {
      throw new ObjectStoreError('ARTIFACT_TOO_LARGE', 'Raw artifact exceeds the size limit.');
    }
    const artifactHash = hashPayload(envelope);
    const payloadHash = hashPayload(envelope.payload);
    const key = artifactKey(envelope, artifactHash);
    const ref = `s3://${this.#bucket}/${key}#sha256=${artifactHash}`;
    await this.initialize();

    const existing = await this.#readIfPresent(key);
    if (existing !== undefined) {
      if (!existing.equals(encoded)) {
        throw new ObjectStoreError(
          'ARTIFACT_CONFLICT',
          'Content-addressed raw artifact conflicts with stored bytes.',
        );
      }
      return {
        ref,
        bucket: this.#bucket,
        key,
        artifactHash,
        payloadHash,
        size: encoded.byteLength,
        created: false,
      };
    }

    try {
      await this.#client.putObject(this.#bucket, key, encoded, encoded.byteLength, {
        'content-type': 'application/json',
        sha256: artifactHash,
        schema: envelope.schema,
      });
    } catch (error) {
      throw new ObjectStoreError('OBJECT_STORE_UNAVAILABLE', 'Raw artifact write failed.', {
        retryable: true,
        cause: error,
      });
    }
    const verified = await this.#readIfPresent(key);
    if (verified === undefined || !verified.equals(encoded)) {
      throw new ObjectStoreError(
        'ARTIFACT_CONFLICT',
        'Raw artifact could not be verified after upload.',
        { retryable: true },
      );
    }
    return {
      ref,
      bucket: this.#bucket,
      key,
      artifactHash,
      payloadHash,
      size: encoded.byteLength,
      created: true,
    };
  }

  async get(ref: string): Promise<RawArtifactEnvelope> {
    const parsedRef = parseRawArtifactRef(ref);
    if (parsedRef.bucket !== this.#bucket) {
      throw new ObjectStoreError('ARTIFACT_INVALID', 'Raw artifact belongs to another bucket.');
    }
    await this.initialize();
    const bytes = await this.#readIfPresent(parsedRef.key);
    if (bytes === undefined) {
      throw new ObjectStoreError('ARTIFACT_NOT_FOUND', 'Raw artifact was not found.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch (error) {
      throw new ObjectStoreError('ARTIFACT_INVALID', 'Raw artifact is not valid JSON.', {
        cause: error,
      });
    }
    let envelope: RawArtifactEnvelope;
    try {
      envelope = RawArtifactEnvelopeSchema.parse(parsed);
    } catch (error) {
      throw new ObjectStoreError('ARTIFACT_CONFLICT', 'Raw artifact schema is invalid.', {
        cause: error,
      });
    }
    if (
      hashPayload(envelope) !== parsedRef.artifactHash ||
      !bytes.equals(Buffer.from(canonicalJson(envelope)))
    ) {
      throw new ObjectStoreError('ARTIFACT_CONFLICT', 'Raw artifact integrity check failed.');
    }
    return envelope;
  }

  async health(): Promise<ObjectStoreHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await this.initialize();
      if (!(await this.#client.bucketExists(this.#bucket))) {
        return {
          status: 'DOWN',
          backend: 'S3_COMPATIBLE',
          durable: true,
          checkedAt,
          bucket: this.#bucket,
          versioning: true,
          errorCode: 'OBJECT_STORE_NOT_INITIALIZED',
        };
      }
      const versioning = await this.#client.getBucketVersioning(this.#bucket);
      if (versioning.Status !== 'Enabled') {
        return {
          status: 'DOWN',
          backend: 'S3_COMPATIBLE',
          durable: true,
          checkedAt,
          bucket: this.#bucket,
          versioning: true,
          errorCode: 'OBJECT_STORE_NOT_INITIALIZED',
        };
      }
      return {
        status: 'UP',
        backend: 'S3_COMPATIBLE',
        durable: true,
        checkedAt,
        bucket: this.#bucket,
        versioning: true,
      };
    } catch {
      return {
        status: 'DOWN',
        backend: 'S3_COMPATIBLE',
        durable: true,
        checkedAt,
        bucket: this.#bucket,
        versioning: true,
        errorCode: 'OBJECT_STORE_UNAVAILABLE',
      };
    }
  }

  async #initialize(): Promise<void> {
    try {
      if (!(await this.#client.bucketExists(this.#bucket))) {
        try {
          await this.#client.makeBucket(this.#bucket, this.#region, { ObjectLocking: false });
        } catch (error) {
          if (
            !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(errorCode(error) ?? '')
          ) {
            throw error;
          }
        }
      }
      await this.#client.setBucketVersioning(this.#bucket, { Status: 'Enabled' });
    } catch (error) {
      throw new ObjectStoreError(
        'OBJECT_STORE_NOT_INITIALIZED',
        'Raw artifact bucket could not be initialized.',
        { retryable: true, cause: error },
      );
    }
  }

  async #readIfPresent(key: string): Promise<Buffer | undefined> {
    try {
      return await readBounded(
        await this.#client.getObject(this.#bucket, key),
        this.#maxArtifactBytes,
      );
    } catch (error) {
      if (isMissingObject(error)) return undefined;
      if (error instanceof ObjectStoreError) throw error;
      throw new ObjectStoreError('OBJECT_STORE_UNAVAILABLE', 'Raw artifact read failed.', {
        retryable: true,
        cause: error,
      });
    }
  }
}
