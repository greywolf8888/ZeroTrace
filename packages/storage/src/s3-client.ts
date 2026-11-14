import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { Readable } from 'node:stream';

/** 既有 S3 存储的传输适配；不创建新的证据或存储权威。 */
export class S3ObjectClient {
  readonly #client: S3Client;

  constructor(options: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    region?: string;
  }) {
    const endpoint = new URL(options.endpoint);
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username !== '' ||
      endpoint.password !== '' ||
      !['', '/'].includes(endpoint.pathname) ||
      endpoint.search !== '' ||
      endpoint.hash !== '' ||
      options.accessKey.trim() === '' ||
      options.secretKey.trim() === ''
    ) {
      throw new TypeError('S3 存储必须配置明确的 HTTP(S) 来源及独立凭据。');
    }
    this.#client = new S3Client({
      endpoint: endpoint.origin,
      region: options.region ?? 'us-east-1',
      credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
      forcePathStyle: true,
      followRegionRedirects: false,
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: new NodeHttpHandler({
        httpAgent: new HttpAgent({ keepAlive: true }),
        httpsAgent: new HttpsAgent({ keepAlive: true }),
      }),
    });
  }

  async bucketExists(bucket: string): Promise<boolean> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  async makeBucket(
    bucket: string,
    region = 'us-east-1',
    options?: { ObjectLocking?: boolean },
  ): Promise<void> {
    await this.#client.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ...(region === 'us-east-1'
          ? {}
          : {
              CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint },
            }),
        ...(options?.ObjectLocking === true ? { ObjectLockEnabledForBucket: true } : {}),
      }),
    );
  }

  async getBucketVersioning(bucket: string): Promise<{ Status?: 'Enabled' | 'Suspended' }> {
    const result = await this.#client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    return result.Status === undefined ? {} : { Status: result.Status };
  }

  async setBucketVersioning(
    bucket: string,
    configuration: { Status: 'Enabled' | 'Suspended' },
  ): Promise<void> {
    await this.#client.send(
      new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: configuration }),
    );
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    size = body.byteLength,
    metadata: Record<string, string> = {},
  ): Promise<{ etag: string; versionId?: string }> {
    const { 'content-type': contentType, ...userMetadata } = metadata;
    const result = await this.#client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: size,
        Metadata: userMetadata,
        ...(contentType === undefined ? {} : { ContentType: contentType }),
      }),
    );
    if (result.ETag === undefined) throw new TypeError('S3 未返回原件写入标识。');
    return {
      etag: result.ETag.replace(/^"|"$/gu, ''),
      ...(result.VersionId === undefined ? {} : { versionId: result.VersionId }),
    };
  }

  async getObject(bucket: string, key: string): Promise<Readable> {
    const result = await this.#client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!(result.Body instanceof Readable)) throw new TypeError('S3 未返回可读取的原件数据流。');
    return result.Body;
  }

  async removeObject(bucket: string, key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  close(): void {
    this.#client.destroy();
  }
}
