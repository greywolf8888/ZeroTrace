import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const pairs = [
  ['Trace an on-chain subject', '追踪链上调查对象'],
  ['Search evidence ledger', '检索证据账本'],
  ['Immutable control-surface terminal Evidence.', '不可变控制面终端证据。'],
  ['Label Intelligence evidence ledger', '标签情报证据账本'],
  [
    'Immutable Label observation-set review with preserved conflicts.',
    '保留冲突的不可变标签观测集审阅。',
  ],
  ['Solana transaction semantics', 'Solana 交易语义'],
  ['Core asset-flow audit', '核心资产流审计'],
  ['Snapshot-bound ledger record', '绑定快照的账本记录'],
  ['Fee Lamports', '手续费 Lamports'],
  ['Evidence ledger', '证据账本'],
  ['Evidence Ledger', '证据账本'],
  ['Evolution Evidence Ledger', '演化证据账本'],
  ['Entity relationship Evidence', '实体关系证据'],
  ['Entity relationship timeline failed.', '实体关系时间线失败。'],
  ['Entity relationship report replay failed.', '实体关系报告回放失败。'],
  ['No labels-to-merge path', '不存在标签直接合并路径'],
  ['Relationship evolution', '关系演化'],
  ['Timeline Evidence', '时间线证据'],
  ['Materialize evolution', '物化演化'],
  ['Absence ≠ relationship end', '缺失 ≠ 关系结束'],
  ['Cross-Snapshot transitions', '跨快照转换'],
  ['Relation Changed', '关系已变更'],
  ['true continuity', '真实连续性'],
  ['Open terminal Evidence', '打开终端证据'],
  ['Bitcoin UTXO reconciliation', 'Bitcoin UTXO 对账'],
  ['Interactive controller and coordination investigation graph', '交互式控制与协同调查图'],
  ['Selected edge → derivation parents', '选中边 → 派生父证据'],
  ['Loading Evidence lineage…', '正在加载证据谱系…'],
  ['Evidence-backed investigation projection', '有证据支撑的调查投影'],
  ['Load latest accepted head', '加载最新已接受头'],
  ['Loading accepted head…', '正在加载已接受头…'],
  ['Load latest Scenario Report', '加载最新情景报告'],
  ['Load latest report', '加载最新报告'],
  ['Replay exact report', '精确回放报告'],
  ['Reading durable observations…', '正在读取持久化观测…'],
  ['Capture label audit', '捕获标签审计'],
  ['Preserved conflicts', '保留的冲突'],
  ['Materialize graph', '物化图'],
  ['Load latest', '加载最新'],
  ['Replay exact', '精确回放'],
  ['Loading…', '加载中…'],
  ['Working…', '处理中…'],
  ['Same Controller', '同一控制者'],
  ['Checksum Valid', '校验和有效'],
  ['Lookup Writable', '查找表可写'],
  ['Provider Down', '数据源不可用'],
  ['never coerced to an atomic zero', '从未被强制写成原子零'],
  [
    'Solana transaction bound to its committed slot Snapshot.',
    'Solana 交易绑定到其已提交 slot 快照。',
  ],
  ['2 trailing account(s) outside the pinned layout', '2 个尾部账户超出钉扎布局'],
  [
    'EVM logs\\/traces\\/state diffs, Bitcoin inputs\\/outputs, and Solana instructions\\/logs\\/balances\\/token balances\\/rewards are implemented',
    '已实现 EVM 日志/追踪/状态差、Bitcoin 输入/输出，以及 Solana 指令/日志/余额/Token 余额/奖励',
  ],
  [
    'Evidence-grounded same-Snapshot comparisons enforce zero mismatch for exact state',
    '基于同一快照的证据对照要求精确状态零偏差',
  ],
  ['The API could not be reached.', '无法连接接口。'],
  ['The Flap Portal inspection failed.', 'Flap Portal 检查失败。'],
  ['ZeroTrace company icon', 'ZeroTrace 图标'],
  ['0 transaction write methods', '0 个写链方法'],
  ['Unknown · select an asset', '未知 · 请选择资产'],
  ['Capability ledger', '能力账本'],
  ['Platform adapter boundaries', '平台适配边界'],
  ['No pinned version', '无钉扎版本'],
  ['2 pinned versions', '2 个钉扎版本'],
  ['Provenance Pending', '来源待确认'],
  ['aria-label="Primary"', 'aria-label="主导航"'],
  ["getByRole('navigation', { name: 'Primary' })", "getByRole('navigation', { name: '主导航' })"],
  ["name: 'Primary'", "name: '主导航'"],
  ['Market Reality', '盘面总览'],
  ['Intelligence Search', '案件与调查'],
  ['Entity Intelligence', '实体与角色'],
  ['Control Rights', '系统管理'],
  ['Control Campaigns', '坐庄时间线'],
  ['Claim Audit', '声明核验'],
  ['Scenario Lab', '可兑现价值'],
  ['Data Health', '数据健康'],
  ['Read-only', '链上只读'],
  ['API unavailable', '接口不可用'],
  ['Max nodes', '最大节点数'],
  ['Subjects', '主体'],
  ['Not available', '不可用'],
  ['Contract retained; implementation pending', '契约保留；实现已接入取证工作站'],
  ['Address or transaction identifier', '地址或交易标识'],
  ['Auto-detect', '自动识别'],
  ['Tracing…', '追踪中…'],
  ["{busy ? 'Tracing…' : 'Trace'}", "{busy ? '追踪中…' : '追踪'}"],
  ["{ name: 'Trace' }", "{ name: '追踪' }"],
  ["{ name: 'Inspect' }", "{ name: '检查' }"],
  ['1 candidate', '1 个候选'],
  ['Inspect', '检查'],
  ['Label Intelligence', '标签情报'],
  ['Resolved', '已解析'],
  ['Matched', '已匹配'],
  ['Replayed', '已回放'],
  ['Observed', '已观测'],
  ['Pinned', '已钉扎'],
];

const targets = [
  'apps/web/src/app/AppShell.tsx',
  'apps/web/src/InvestigationGraph.tsx',
  'tests/e2e/dashboard.spec.ts',
];

for (const file of targets) {
  let text = readFileSync(join(root, file), 'utf8');
  const before = text;
  for (const [from, to] of [...pairs].sort((a, b) => b[0].length - a[0].length)) {
    if (text.includes(from)) text = text.split(from).join(to);
  }
  if (text !== before) {
    writeFileSync(join(root, file), text);
    console.log('updated', file);
  } else {
    console.log('unchanged', file);
  }
}
