import { open } from 'node:fs/promises';
/** CLI 原件读取也有实际字节上限，不依赖可变化的事前 stat。 */
export async function readBundleFile(path: string): Promise<unknown> {
  const handle = await open(path, 'r');
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(1048576);
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
      if (bytes > 16777216) throw Error('Bundle exceeds 16MiB');
      chunks.push(buffer.subarray(0, result.bytesRead));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await handle.close();
  }
}
