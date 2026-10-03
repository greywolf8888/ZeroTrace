import { it, expect } from 'vitest';
import {
  isPrivateOrReservedIp,
  validateProviderUrlSyntax,
} from '@zerotrace/chain-adapters/security';
import { cursorCodec } from '../../../apps/arc-task-ledger-api/src/app.js';
import { hashPayload } from '../../../packages/evidence/src/hash.js';
it('ATL-36 SSRF 地址、明文凭据、重定向目标不进入配置', () => {
  for (const url of [
    'http://rpc.mainnet.arc.io',
    'https://127.0.0.1',
    'https://169.254.169.254',
    'https://user:key@rpc.mainnet.arc.io',
    'https://evil.example',
  ])
    expect(() =>
      validateProviderUrlSyntax(url, {
        allowedHosts: ['rpc.mainnet.arc.io'],
        allowPrivateNetworks: false,
      }),
    ).toThrow();
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1'])
    expect(isPrivateOrReservedIp(ip)).toBe(true);
});
it('分页游标签名防伪造与 SQL 字符串', () => {
  const codec = cursorCodec('x'.repeat(32));
  const cursor = {
    run: 'run_a',
    filter: hashPayload({}),
    last: '9007199254740993',
    kind: 'jobs' as const,
  };
  expect(codec.decode(codec.encode(cursor))).toEqual(cursor);
  expect(() => codec.decode(codec.encode(cursor) + 'x')).toThrow();
  expect(() => codec.decode(codec.encode({ ...cursor, last: '1;DELETE' }))).toThrow();
  expect(() => codec.decode('x'.repeat(3000))).toThrow();
});
