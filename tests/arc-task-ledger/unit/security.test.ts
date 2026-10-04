import { it, expect } from 'vitest';
import {
  isPrivateOrReservedIp,
  validateProviderUrlSyntax,
} from '@zerotrace/chain-adapters/security';
import { cursorCodec } from '../../../apps/arc-task-ledger-api/src/app.js';
import { hashPayload } from '../../../packages/evidence/src/hash.js';
import { validatePublicAnswers } from '../../../packages/arc-task-ledger/src/public-dns.js';
import { configFromEnv, DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
it('历史窗口与固定目标必须声明合法边界，配置不修改原部署起点', () => {
  const base = { ARC_DATABASE_URL: 'postgresql://test@localhost/arc_task_ledger_test' };
  expect(
    configFromEnv({ ...base, ARC_HISTORY_FROM_BLOCK: '', ARC_SNAPSHOT_BLOCK: '' }),
  ).toMatchObject({ historyFromBlock: undefined, snapshotBlock: undefined });
  const from = (BigInt(DEPLOYMENT.verifiedDeploymentBlock) + 2n).toString();
  expect(
    configFromEnv({ ...base, ARC_HISTORY_FROM_BLOCK: from, ARC_SNAPSHOT_BLOCK: from }),
  ).toMatchObject({ historyFromBlock: from, snapshotBlock: from });
  expect(() => configFromEnv({ ...base, ARC_HISTORY_FROM_BLOCK: '1' })).toThrow();
  expect(() =>
    configFromEnv({
      ...base,
      ARC_HISTORY_FROM_BLOCK: from,
      ARC_SNAPSHOT_BLOCK: DEPLOYMENT.verifiedDeploymentBlock,
    }),
  ).toThrow();
  expect(() => configFromEnv({ ...base, ARC_SNAPSHOT_BLOCK: '1;SELECT' })).toThrow();
});
it('可选公共解析继续拒绝保留地址、混合答案、空答案和解析失败', () => {
  for (const data of ['198.18.0.59', '127.0.0.1', '169.254.169.254', '10.0.0.1'])
    expect(() =>
      validatePublicAnswers({ Status: 0, Answer: [{ type: 1, data, TTL: 60 }] }),
    ).toThrow();
  expect(() =>
    validatePublicAnswers({
      Status: 0,
      Answer: [
        { type: 1, data: '8.8.8.8', TTL: 60 },
        { type: 1, data: '198.18.0.59', TTL: 60 },
      ],
    }),
  ).toThrow();
  expect(() => validatePublicAnswers({ Status: 0, Answer: [] })).toThrow();
  expect(() => validatePublicAnswers({ Status: 3 })).toThrow();
  expect(
    validatePublicAnswers({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8', TTL: 60 }] }),
  ).toEqual([{ address: '8.8.8.8', family: 4 }]);
});
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
