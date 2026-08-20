export const STATUS_LABELS: Record<string, string> = {
  PINNED: '已钉扎',
  Pinned: '已钉扎',
  PROVENANCE_PENDING: '来源待确认',
  LICENSE_REVIEW_REQUIRED: '许可证待审',
  NOT_APPLICABLE: '不适用',
  READY_READ_ONLY: '只读就绪',
  PARTIAL_READ_ONLY: '部分只读',
  NOT_AVAILABLE: '不可用',
  HEURISTIC_ONLY: '仅启发式',
  UP: '可用',
  DOWN: '不可用',
  UNKNOWN: '未知',
  UNAVAILABLE: '数据不可用',
  IMPLEMENTED: '已实现',
  IMPLEMENTED_DURABLE: '已实现（持久化）',
  IMPLEMENTED_EPHEMERAL: '已实现（进程内）',
  IMPLEMENTED_DETERMINISTIC: '已实现（确定性）',
  PROVIDER_REQUIRED: '需要数据源',
  DURABLE_STORAGE_REQUIRED: '需要持久化存储',
  Resolved: '已解析',
  RESOLVED: '已解析',
  Matched: '已匹配',
  MATCHED: '已匹配',
  Replayed: '已回放',
  REPLAYED: '已回放',
  Observed: '已观测',
  OBSERVED: '已观测',
  Materialized: '已物化',
  Working: '处理中',
  Loading: '加载中',
  CHECKSUM_VALID: '校验和有效',
  STRUCTURALLY_VALID: '结构有效',
  AMBIGUOUS: '歧义',
  UNCONFIGURED: '未配置',
  NOT_RUN: '未运行',
  READ_ONLY: '只读',
  AGREEMENT: '一致',
  PARTIAL: '部分',
  ACTIVE: '活跃',
  FINAL: '终局',
  HIGH: '高',
  NONE_OBSERVED: '未观测',
  UNCALIBRATED: '未校准',
};

export const REASON_LABELS: Record<string, string> = {
  NOT_QUERIED: '未查询',
  NOT_APPLICABLE: '不适用',
  INSUFFICIENT_DATA: '覆盖不足',
  UNSUPPORTED: '协议未识别',
  NOT_IMPLEMENTED: '能力未实现',
  PROVIDER_UNCONFIGURED: '数据源未配置',
  PROVIDER_DOWN: '数据源不可用',
  STORAGE_UNCONFIGURED: '存储未配置',
  STORAGE_DOWN: '存储不可用',
  RATE_LIMITED: '速率受限',
  STALE: '状态已过期',
  CONFLICTING_SOURCES: '来源冲突',
  INVALID_INPUT: '输入无效',
  EXECUTION_BLOCKED: '执行被阻止',
  PRECISION_UNSAFE: '精度不安全',
  unknown: '未知',
  unavailable: '数据不可用',
};

export const CAPABILITY_TITLES: Record<string, string> = {
  'canonical-schemas': '规范契约',
  'evidence-ledger': '证据账本',
  'control-campaign-p0': '控制活动',
  'global-intelligence-search': '全局智能检索',
  'label-intelligence': '标签情报',
  'evm-current-state': 'EVM 当前状态',
  'bitcoin-esplora': 'Bitcoin Esplora',
  'solana-current-state': 'Solana 当前状态',
  'typed-ledger-query': '类型化账本查询',
  'flap-bsc-inspection': 'Flap BSC 检查',
  'flap-event-transaction': 'Flap 事件交易',
  'flap-bounded-event-history': 'Flap 有界事件历史',
  'flap-event-history-projection': 'Flap 事件历史投影',
  'erc20-burn-candidate-promotion': 'ERC-20 销毁候选晋升',
  'evm-pension-behavior-candidate-discovery': '养老金行为候选发现',
  'flap-pension-entry-economics': '养老金入场经济',
  'erc20-supply-continuity': 'ERC-20 供应连续性',
  'flap-lifetime-materialization': 'Flap 全生命周期物化',
  'flap-lifetime-heads': 'Flap 生命周期头',
  'flap-token-origin': 'Flap Token 起源',
  'flap-bsc-sell-preview': 'Flap BSC 卖出预览',
  'cross-source-anchor-reconciliation': '跨源锚点对账',
  'typed-discrepancy-audit': '类型化差异审计',
  'flap-pancake-v2-multi-source-reconciliation': 'Flap/Pancake V2 多源对账',
  'evm-control-surface': 'EVM 控制面',
  'solana-control-surface': 'Solana 控制面',
  'solana-transaction-semantic-replay': 'Solana 交易语义回放',
  'action-semantics': '动作语义',
  'claim-declaration-replay': '声明回放',
  'claim-rule-review-replay': '规则审阅回放',
  'claim-verification-observation': '声明核验观测',
  'finalized-historical-ingestion': '终局历史摄入',
  'durable-capture-scheduling': '持久化捕获调度',
  'entity-evidence-fusion': '实体证据融合',
  'constant-product-rv': '恒定乘积可兑现价值',
  'shared-liquidity-exit-race': '共享流动性退出竞赛',
};

const DETAIL_FRAGMENTS: Array<readonly [string, string]> = [
  [
    'Evidence-grounded same-Snapshot comparisons enforce zero mismatch for exact state',
    '基于同一快照的证据对照要求精确状态零偏差',
  ],
  [
    'EVM logs/traces/state diffs, Bitcoin inputs/outputs, and Solana instructions/logs/balances/token balances/rewards are implemented',
    '已实现 EVM 日志/追踪/状态差、Bitcoin 输入/输出，以及 Solana 指令/日志/余额/Token 余额/奖励',
  ],
  [
    'POSTGRES_URL is absent; Evidence is process-local.',
    '未配置 POSTGRES_URL；证据仅存在于当前进程。',
  ],
  [
    'PostgreSQL append-only Evidence and Snapshot persistence is configured.',
    '已配置 PostgreSQL 只追加证据与快照持久化。',
  ],
];

export function zhReason(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

export function zhCapabilityTitle(id: string): string {
  return CAPABILITY_TITLES[id] ?? id;
}

export function zhDetail(text: string): string {
  let out = text;
  for (const [english, chinese] of [...DETAIL_FRAGMENTS].sort(
    (left, right) => right[0].length - left[0].length,
  )) {
    if (out.includes(english)) out = out.split(english).join(chinese);
  }
  return out;
}

export const ENUM_LABELS: Record<string, string> = {
  SAME_CONTROLLER: '同一控制者',
  COORDINATED_WITH: '协同',
  COORDINATED: '协同',
  COORDINATED_BUT_INDEPENDENT: '协同但独立',
  RELATION_CHANGED: '关系已变更',
  RELATIONSHIP_TERMINATION: '关系终止',
  REVISION: '修订',
  PROBABLE_SAME_CONTROLLER: '疑似同一控制者',
  RAW_TRANSFER_COPY: '原始转账副本',
  PRIMARY_MARKET: '一级市场',
  BLOCKED: '已阻止',
  ALLOWED: '允许',
  EQUAL_OUTPUT_COINJOIN_LIKE: '等额输出类混币形态',
  COINJOIN_EQUAL_OUTPUT_PATTERN: '混币等额输出模式',
  POLICY_BOUNDARY: '策略边界',
  ABSOLUTE_HEIGHT: '绝对高度',
  ABSOLUTE_TIME: '绝对时间',
  RELATIVE_HEIGHT: '相对高度',
  RELATIVE_TIME: '相对时间',
  Unknown: '未知',
  UNKNOWN: '未知',
  Materialized: '已物化',
  MATERIALIZED: '已物化',
  checking: '检查中',
  SETTLEMENT: '结算',
  FUNDING: '资金',
  BEHAVIOR: '行为',
  TOKEN: 'Token',
  COMBINED: '合并',
  CLOSED: '已关闭',
  OPEN: '进行中',
  CRITICAL: '严重',
  INFO: '信息',
  WARNING: '警告',
  EVM_CONTROL_SURFACE: 'EVM 控制面',
  SAFE_MULTISIG: 'Safe 多签',
  COMMUNITY_FUND: '社区基金',
  READY_FOR_REVIEW: '待审阅',
  IMMUTABLE_EXPECTED: '不可变预期',
  VERIFIED_INDEPENDENT: '已独立验证',
  ROLE_UNKNOWN: '角色未知',
  NO_EVENT_CANDIDATES: '无事件候选',
  REQUESTED_RANGE_COMPLETE: '请求区间完整',
  APACHE_AGE: 'Apache AGE',
  TAX_CHANGE: '税率变更',
  SQUADS_CONFIGURATION: 'Squads 配置',
  COORDINATED_SELLING: '协同卖出',
  TRANSACTION_LOCAL: '交易局部',
  FIRST_FUNDER: '首个出资人',
  HISTORICAL_MATCH: '历史匹配',
  LOW_COST_CASE: '低成本案件',
  SELECTIVE_MARKET_INDEX: '选择性市场索引',
  REMOTE_ARCHIVE_HYBRID: '远程归档混合',
  STOP_PREFETCH: '停止预取',
  COMPACT_AND_EVICT: '压缩并驱逐',
  STOP_NEW_FULL_LIFETIME: '停止新的全生命周期',
  EVIDENCE_ONLY: '仅保留案件证据',
  PERMANENT_EVIDENCE: '不可删除证据',
  NORMALIZED_FACT: '规范化事实',
  EPHEMERAL: '可重建缓存',
  ACCUMULATION: '吸筹',
  DIRECT: '直接',
  SUPPORT: '支持',
  UNREVIEWED: '未审阅',
};

function titleCaseFallback(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');
}

export function zhStatus(status: string): string {
  return STATUS_LABELS[status] ?? ENUM_LABELS[status] ?? status;
}

export function zhLabel(value: string): string {
  if (ENUM_LABELS[value] !== undefined) return ENUM_LABELS[value];
  if (STATUS_LABELS[value] !== undefined) return STATUS_LABELS[value];
  if (REASON_LABELS[value] !== undefined) return REASON_LABELS[value];
  if (CAPABILITY_TITLES[value] !== undefined) return CAPABILITY_TITLES[value];
  const snake = value.replace(/-/g, '_').toUpperCase();
  if (ENUM_LABELS[snake] !== undefined) return ENUM_LABELS[snake];
  if (STATUS_LABELS[snake] !== undefined) return STATUS_LABELS[snake];
  if (REASON_LABELS[snake] !== undefined) return REASON_LABELS[snake];
  const titled = titleCaseFallback(value);
  return ENUM_LABELS[titled] ?? STATUS_LABELS[titled] ?? titled;
}
