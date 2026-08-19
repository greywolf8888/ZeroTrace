import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appPath = join(root, 'apps/web/src/App.tsx');
let source = readFileSync(appPath, 'utf8');

const replacements = [
  [
    "type View =\n  'overview' | 'search' | 'entities' | 'control' | 'campaigns' | 'claims' | 'scenario' | 'health';",
    "type View =\n  | 'overview'\n  | 'search'\n  | 'entities'\n  | 'control'\n  | 'campaigns'\n  | 'claims'\n  | 'scenario'\n  | 'health'\n  | 'supply'\n  | 'capital'\n  | 'profit'\n  | 'evidence'\n  | 'analyst';",
  ],
  [
    "{ id: 'overview', label: 'Market Reality', marker: 'MR' }",
    "{ id: 'overview', label: '盘面总览', marker: '总览' }",
  ],
  [
    "{ id: 'search', label: 'Intelligence Search', marker: 'IS' }",
    "{ id: 'search', label: '案件与调查', marker: '调查' }",
  ],
  [
    "{ id: 'entities', label: 'Entity Intelligence', marker: 'EI' }",
    "{ id: 'entities', label: '实体与角色', marker: '实体' }",
  ],
  [
    "{ id: 'control', label: 'Control Rights', marker: 'CR' }",
    "{ id: 'control', label: '权限与控制', marker: '权限' }",
  ],
  [
    "{ id: 'campaigns', label: 'Control Campaigns', marker: 'CC' }",
    "{ id: 'campaigns', label: '坐庄时间线', marker: '活动' }",
  ],
  [
    "{ id: 'claims', label: 'Claim Audit', marker: 'CA' }",
    "{ id: 'claims', label: '声明核验', marker: '声明' }",
  ],
  [
    "{ id: 'scenario', label: 'Scenario Lab', marker: 'SL' }",
    "{ id: 'scenario', label: '可兑现价值', marker: '兑现' }",
  ],
  [
    "{ id: 'health', label: 'Data Health', marker: 'DH' }",
    "{ id: 'health', label: '数据健康', marker: '健康' }",
  ],
  [
    "const FUTURE_DOMAINS = ['Evidence Ledger', 'Analyst Workbench'];",
    'const FUTURE_DOMAINS = [];',
  ],
  ["{ id: 'combined', label: 'Combined' }", "{ id: 'combined', label: '合并' }"],
  ["{ id: 'token', label: 'Token' }", "{ id: 'token', label: 'Token' }"],
  ["{ id: 'funding', label: 'Funding' }", "{ id: 'funding', label: '资金' }"],
  ["{ id: 'settlement', label: 'Settlement' }", "{ id: 'settlement', label: '结算' }"],
  ["{ id: 'behavior', label: 'Behavior' }", "{ id: 'behavior', label: '行为' }"],
  ['alt="ZeroTrace company icon"', 'alt="ZeroTrace 图标"'],
  ['<span>Evidence-first intelligence</span>', '<span>链上盘面结构取证系统</span>'],
  ['Read-only', '链上只读'],
  [
    "aria-label={'API status ' + (health?.status ?? 'checking')}",
    "aria-label={'接口状态 ' + (health?.status ?? '检查中')}",
  ],
  ["API {health?.status ?? 'checking'}", "接口 {health?.status ?? '检查中'}"],
  [
    "aria-label={'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme'}",
    "aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}",
  ],
  ['API Docs', '接口文档'],
  ['aria-label="Primary"', 'aria-label="主导航"'],
  [
    '<div className="nav-caption">Intelligence</div>',
    '<div className="nav-caption">取证工作站</div>',
  ],
  [
    '<div className="nav-caption nav-caption-spaced">Terminal architecture</div>',
    '<div className="nav-caption nav-caption-spaced">系统</div>',
  ],
  ['<span>Safety invariant</span>', '<span>安全不变量</span>'],
  [
    '<strong>No keys. No signing. No broadcast.</strong>',
    '<strong>无私钥、无签名、无广播。</strong>',
  ],
  [
    '<p>Simulation is restricted to offline or non-broadcast execution.</p>',
    '<p>链上只读 · 内部证据与案件数据会持久化</p>',
  ],
  [
    '<div className="eyebrow">Multi-chain intelligence / evidence first</div>',
    '<div className="eyebrow">监管取证级 · 证据优先 · 可回放</div>',
  ],
  [
    '<h1>See control, liquidity, and realizable value as chain facts—not assumptions.</h1>',
    '<h1>以链上事实重建控制关系、供应现实、坐庄活动与可兑现 U 价值。</h1>',
  ],
  [
    'Query EVM, Bitcoin, and Solana through a read-only boundary. Every supported result\n          carries freshness, coverage, snapshot context, and evidence.',
    '在只读边界内查询 EVM、Bitcoin 与 Solana。每项结论绑定新鲜度、覆盖率、快照与证据。',
  ],
  ['providers online', '个数据源在线'],
  ['ledger families retained', '个账本族'],
  ['transaction write methods', '个写链方法'],
  [
    '<span className="eyebrow">No asset selected</span>',
    '<span className="eyebrow">尚未选择调查对象</span>',
  ],
  ['<h2>Market Reality</h2>', '<h2>盘面总览</h2>'],
  ['Snapshot required for metrics', '指标需要快照'],
  ['Nominal market cap', '名义市值'],
  ['Unknown · select an asset', '未知 · 请选择资产'],
  ['Stable realizable capacity', '稳定可兑现容量'],
  ['Unknown · route not simulated', '未知 · 尚未仿真路由'],
  ['Controller supply', '控制供应'],
  ['Unknown · entity evidence absent', '未知 · 缺少实体证据'],
  ['Independent entities', '独立自然交易者'],
  ['Unknown · holder graph absent', '未知 · 持有图未建立'],
  ['Organic flow ratio', '自然资本占比'],
  ['Unknown · history not indexed', '未知 · 历史未索引'],
  ['Effective liquidity', '有效流动性'],
  ['Unknown · venues not discovered', '未知 · 场所未发现'],
  ['Exit concentration (EC-20)', '价格冲击容量 EC-20'],
  ['Capability ledger', '能力账本'],
  ['Platform adapter boundaries', '平台适配边界'],
  ['No pinned version', '无钉扎版本'],
  ['2 pinned versions', '2 个钉扎版本'],
  ['Provenance Pending', '来源待确认'],
];

let applied = 0;
for (const [from, to] of replacements) {
  if (source.includes(from)) {
    source = source.split(from).join(to);
    applied += 1;
  } else {
    console.error('missing fragment:', from.slice(0, 80));
  }
}

writeFileSync(appPath, source);
console.log(`applied ${applied}/${replacements.length}`);
