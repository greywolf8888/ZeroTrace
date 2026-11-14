import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { S3ObjectClient } from './s3-client.js';

const servers: Server[] = [];
const clients: S3ObjectClient[] = [];

async function endpoint(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('测试服务未取得端口');
  return `http://127.0.0.1:${address.port}`;
}

function client(url: string): S3ObjectClient {
  const result = new S3ObjectClient({
    endpoint: url,
    accessKey: 'test-only',
    secretKey: 'test-only',
  });
  clients.push(result);
  return result;
}

afterEach(async () => {
  for (const value of clients.splice(0)) value.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

describe('既有 S3 存储传输边界', () => {
  it('只把明确的 404 当作桶不存在，拒绝把权限失败当作空桶', async () => {
    let status = 404;
    const url = await endpoint((_request, response) => {
      response.writeHead(status).end();
    });
    const store = client(url);
    await expect(store.bucketExists('evidence')).resolves.toBe(false);
    status = 403;
    await expect(store.bucketExists('evidence')).rejects.toBeDefined();
    status = 503;
    await expect(store.bucketExists('evidence')).rejects.toBeDefined();
  });

  it('保留原件缺失的标准错误名供既有只读回放识别', async () => {
    const url = await endpoint((_request, response) => {
      response.writeHead(404, { 'content-type': 'application/xml' });
      response.end('<Error><Code>NoSuchKey</Code><Message>不存在</Message></Error>');
    });
    await expect(client(url).getObject('evidence', 'missing')).rejects.toMatchObject({
      name: 'NoSuchKey',
    });
  });

  it('保存精确字节、内容类型与摘要元数据，读取保持为有界消费的数据流', async () => {
    const bytes = Buffer.from('原件\u0000内容', 'utf8');
    const received: Buffer[] = [];
    let headers: Record<string, string | string[] | undefined> = {};
    const url = await endpoint((request, response) => {
      if (request.method === 'PUT') {
        headers = request.headers;
        request.on('data', (chunk: Buffer) => received.push(chunk));
        request.on('end', () => response.writeHead(200, { etag: 'test-only' }).end());
      } else {
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': bytes.length,
        });
        response.end(bytes);
      }
    });
    const store = client(url);
    await store.putObject('evidence', 'raw.json', bytes, bytes.length, {
      'content-type': 'application/json',
      sha256: 'test-only-sha256',
    });
    expect(Buffer.concat(received)).toEqual(bytes);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-amz-meta-sha256']).toBe('test-only-sha256');
    const stream = await store.getObject('evidence', 'raw.json');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
  });

  it('不回退到账户环境凭据，也不接受夹带路径或凭据的来源', () => {
    for (const url of [
      'https://key:secret@example.com',
      'https://example.com/path',
      'https://example.com/?key=value',
      'file:///tmp/data',
    ]) {
      expect(() => client(url)).toThrow();
    }
    expect(
      () => new S3ObjectClient({ endpoint: 'http://localhost', accessKey: '', secretKey: '' }),
    ).toThrow();
  });
});
