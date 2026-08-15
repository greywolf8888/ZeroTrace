import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { ObjectStoreError, RawArtifactStore } from './raw-artifacts.js';

class FakeObjectStoreClient {
  readonly objects = new Map<string, Buffer>();
  bucket = false;
  versioning = false;
  readonly makeBucket = vi.fn(async () => {
    this.bucket = true;
  });
  readonly setBucketVersioning = vi.fn(async () => {
    this.versioning = true;
  });
  readonly putObject = vi.fn(
    async (
      bucketName: string,
      objectName: string,
      value: Buffer,
      _size: number,
      _metadata: Record<string, string>,
    ) => {
      this.objects.set(`${bucketName}/${objectName}`, Buffer.from(value));
      return { etag: 'test-etag' };
    },
  );
  readonly close = vi.fn(async () => undefined);

  async bucketExists(): Promise<boolean> {
    return this.bucket;
  }

  async getBucketVersioning(): Promise<{ Status?: 'Enabled' | 'Suspended' }> {
    return this.versioning ? { Status: 'Enabled' } : {};
  }

  async getObject(bucketName: string, objectName: string): Promise<Readable> {
    const value = this.objects.get(`${bucketName}/${objectName}`);
    if (value === undefined) {
      const error = new Error('missing') as Error & { code: string };
      error.code = 'NoSuchKey';
      throw error;
    }
    return Readable.from([Buffer.from(value)]);
  }
}

const artifact = {
  ledger: 'EVM' as const,
  chainId: '1',
  blockOrSlot: '42',
  provider: 'sqd:ethereum-mainnet',
  capturedAt: '2026-08-09T13:00:00.000Z',
  payload: { header: { number: 42, hash: '0xabc' }, transactions: [] },
};

function store(client = new FakeObjectStoreClient(), maxArtifactBytes = 16_000_000) {
  return {
    client,
    store: RawArtifactStore.fromClient({
      client,
      bucket: 'zerotrace-raw-test',
      region: 'us-east-1',
      maxArtifactBytes,
    }),
  };
}

describe('RawArtifactStore', () => {
  it('creates a versioned bucket and stores canonical content-addressed artifacts idempotently', async () => {
    const fixture = store();

    const first = await fixture.store.put(artifact);
    const second = await fixture.store.put(artifact);

    expect(first).toMatchObject({
      bucket: 'zerotrace-raw-test',
      created: true,
      size: expect.any(Number),
      artifactHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(first.ref).toBe(`s3://zerotrace-raw-test/${first.key}#sha256=${first.artifactHash}`);
    expect(second).toEqual({ ...first, created: false });
    expect(fixture.client.makeBucket).toHaveBeenCalledOnce();
    expect(fixture.client.setBucketVersioning).toHaveBeenCalledOnce();
    expect(fixture.client.putObject).toHaveBeenCalledOnce();
    await expect(fixture.store.get(first.ref)).resolves.toEqual({
      schema: 'zerotrace-raw-artifact-v1',
      ...artifact,
    });
    await expect(fixture.store.health()).resolves.toMatchObject({
      status: 'UP',
      durable: true,
      versioning: true,
    });
    await expect(fixture.store.close()).resolves.toBeUndefined();
    expect(fixture.client.close).toHaveBeenCalledOnce();
  });

  it('detects corruption instead of overwriting a content-addressed artifact', async () => {
    const fixture = store();
    const result = await fixture.store.put(artifact);
    fixture.client.objects.set(`${result.bucket}/${result.key}`, Buffer.from('{}'));

    await expect(fixture.store.put(artifact)).rejects.toMatchObject({
      code: 'ARTIFACT_CONFLICT',
    });
    await expect(fixture.store.get(result.ref)).rejects.toMatchObject({
      code: 'ARTIFACT_CONFLICT',
    });
    expect(fixture.client.putObject).toHaveBeenCalledOnce();
  });

  it('enforces artifact size and reference boundaries', async () => {
    const fixture = store(new FakeObjectStoreClient(), 1_024);
    await expect(
      fixture.store.put({ ...artifact, payload: { data: 'x'.repeat(2_000) } }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' });
    await expect(
      fixture.store.get(`s3://another-bucket/v1/evm/item.json#sha256=${'a'.repeat(64)}`),
    ).rejects.toMatchObject({ code: 'ARTIFACT_INVALID' });
  });

  it('rejects endpoint credentials and reports unavailable initialization without leaking causes', async () => {
    expect(
      () =>
        new RawArtifactStore({
          endpoint: 'http://user:password@minio:9000',
          accessKey: 'configured-separately',
          secretKey: 'configured-separately',
        }),
    ).toThrow(ObjectStoreError);

    const failing = new FakeObjectStoreClient();
    failing.makeBucket.mockRejectedValueOnce(new Error('credential material from upstream'));
    const fixture = store(failing);
    await expect(fixture.store.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'OBJECT_STORE_UNAVAILABLE',
    });
  });

  it('bounds a stalled object-store health probe instead of hanging the readiness aggregate', async () => {
    const stalled = new FakeObjectStoreClient();
    const bucketExists = vi
      .spyOn(stalled, 'bucketExists')
      .mockImplementation(() => new Promise<boolean>(() => {}));
    const health = RawArtifactStore.fromClient({
      client: stalled,
      bucket: 'zerotrace-raw-test',
      region: 'us-east-1',
      maxArtifactBytes: 16_000_000,
      healthTimeoutMs: 100,
    });

    await expect(health.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'OBJECT_STORE_UNAVAILABLE',
    });

    bucketExists.mockResolvedValue(false);
    await expect(health.put(artifact)).resolves.toMatchObject({ created: true });
  });
});
