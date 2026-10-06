// 仅测试路径的合成绘图样例，不是生产链数据或核验结果。
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VerificationFlow } from '../../../apps/arc-task-ledger-web/src/VerificationFlow.js';
import type { UsdcMovement } from '../../../packages/arc-task-ledger/src/verifier-core.js';
import '../../../apps/arc-task-ledger-web/src/verifier.css';
const a = '0x1111111111111111111111111111111111111111';
const b = '0x2222222222222222222222222222222222222222';
const movements = [
  [a, b],
  [a, b],
  [b, a],
  [a, a],
].map(([from, to], i) => ({
  id: `test-only:${i}`,
  from,
  to,
  atomic: '123456789123456789',
  rawAtomic: '123456789123456789',
  kind: from === to ? 'SELF' : 'TRANSFER',
  interface: 'NATIVE',
  decimals: 18,
  mirrorLogIds: [],
  crossCheck: 'absent',
  transactionHash: 'test-only',
  blockHash: 'test-only',
  logIndex: String(i),
})) as UsdcMovement[];
function Harness() {
  const [selected, setSelected] = useState<string>();
  return (
    <main
      style={{
        background: '#030704',
        color: '#bded67',
        maxWidth: 1100,
        margin: 'auto',
        padding: 16,
      }}
    >
      <h1>仅测试：合成平行、反向与自环资金边</h1>
      <VerificationFlow
        movements={movements}
        selected={selected}
        onSelect={setSelected}
        lang="zh"
      />
      <p role="status">所选测试边：{selected ?? '未选择'}</p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
