import { it, expect } from 'vitest';
import {
  parseInput,
  money,
  semantics,
  type Registry,
} from '../../../apps/arc-task-ledger-web/src/model.js';
import { DEPLOYMENT, NAVIGATION } from '../../../packages/arc-task-ledger/src/config.js';
const registry: Registry = {
  chainId: DEPLOYMENT.chainId,
  adapter: DEPLOYMENT.adapter,
  navigation: NAVIGATION,
};
it('任务号和登记上游任务链接可用；拒绝错误链、部署和任意URL', () => {
  expect(parseInput('19', registry)).toEqual({ jobId: '19' });
  expect(parseInput('https://arcbounty.app/bounty/19', registry)).toEqual({ jobId: '19' });
  for (const bad of [
    'https://evil.test/bounty/19',
    'https://arcbounty.app.evil.test/bounty/19',
    'https://testnet.arcbounty.app/bounty/19',
    'https://u:p@arcbounty.app/bounty/19',
    'https://arcbounty.app/bounty/19?chainId=1',
    'https://arcbounty.app/bounty/19?adapter=0x0',
    '00019',
    String(2n ** 256n),
  ])
    expect(() => parseInput(bad, registry)).toThrow();
});
it('原子精度不经过浮点；零、未知和三种视觉语义区分', () => {
  expect(money({ atomic: { state: 'known', value: '1980000000000000000' }, decimals: 18 })).toBe(
    '1.98 USDC',
  );
  expect(money({ atomic: { state: 'unknown', reason: 'missing' }, decimals: 18 })).not.toBe(
    '0 USDC',
  );
  expect(new Set(['CONFIRMED_DIRECT', 'UNKNOWN', 'CONFLICT'].map(semantics)).size).toBe(3);
});
