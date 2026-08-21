import { type EvidenceRecord, type HealthResponse } from '../../generated-api/client.js';
import { zhStatus } from '../../i18n/zh-CN.js';
import { useState, type FormEvent } from 'react';
import {
  type Theme,
  type View,
  NAVIGATION,
  DEVELOPER_NAVIGATION,
  Icon,
  StatusPill,
  titleCase,
  formatTime,
  shortId,
} from './part-01.js';

export function ledgerLabel(ledger: string): string {
  if (ledger === 'BITCOIN') return 'Bitcoin';
  if (ledger === 'SOLANA') return 'Solana';
  return ledger;
}

export function Header({
  theme,
  setTheme,
  health,
  presentation,
  setPresentation,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  presentation: 'novice' | 'expert';
  setPresentation: (mode: 'novice' | 'expert') => void;
  health?: HealthResponse | undefined;
}) {
  const healthLabel = health === undefined ? '检查中' : zhStatus(health.status);
  return (
    <header className="topbar">
      <div className="brand">
        <img src="/zerotrace-company-icon.png" alt="ZeroTrace 图标" width="44" height="44" />
        <div>
          <strong>ZeroTrace</strong>
          <span>链上盘面结构取证系统</span>
        </div>
      </div>
      <div className="topbar-actions">
        <div className="read-only-badge">
          <span className="pulse-dot" />
          链上只读
        </div>
        <label className="presentation-switch" htmlFor="presentation-mode">
          工作站层级
          <select
            id="presentation-mode"
            value={presentation}
            onChange={(event) =>
              setPresentation(event.target.value === 'expert' ? 'expert' : 'novice')
            }
          >
            <option value="novice">简明</option>
            <option value="expert">专家</option>
          </select>
        </label>
        <div
          className="api-state"
          title={health?.checkedAt}
          aria-label={'数据服务状态 ' + healthLabel}
        >
          <span
            className={'state-light ' + (health?.status === 'UP' ? 'state-up' : 'state-warn')}
          />
          数据服务 {healthLabel}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☼' : '◐'}
        </button>
      </div>
    </header>
  );
}

export function Sidebar({ view, setView }: { view: View; setView: (view: View) => void }) {
  const diagnosticsEnabled = window.localStorage.getItem('zerotrace-diagnostics') === 'enabled';
  const primaryView: View =
    view === 'workbench' || view === 'overview'
      ? 'workbench'
      : view === 'monitoring' || view === 'campaigns'
        ? 'monitoring'
        : view === 'system' || view === 'health' || view === 'control'
          ? 'system'
          : 'cases';
  return (
    <aside className="sidebar">
      <nav aria-label="主导航">
        <div className="nav-caption">取证工作站</div>
        {NAVIGATION.map((item) => (
          <button
            key={item.id}
            type="button"
            className={'nav-item ' + (primaryView === item.id ? 'nav-active' : '')}
            onClick={() => setView(item.id)}
          >
            <Icon>{item.marker}</Icon>
            <span>{item.label}</span>
          </button>
        ))}
        {diagnosticsEnabled ? (
          <details className="developer-navigation">
            <summary>诊断视图</summary>
            {DEVELOPER_NAVIGATION.map((item) => (
              <button
                key={item.id}
                type="button"
                className={'nav-item nav-item-developer ' + (view === item.id ? 'nav-active' : '')}
                onClick={() => setView(item.id)}
              >
                <Icon>{item.marker}</Icon>
                <span>{item.label}</span>
              </button>
            ))}
          </details>
        ) : null}
      </nav>
      <div className="sidebar-note">
        <span>安全不变量</span>
        <strong>无私钥、无签名、无广播。</strong>
        <p>链上只读 · 内部证据与案件数据会持久化</p>
      </div>
    </aside>
  );
}

export function SearchBox({
  onSearch,
  busy,
}: {
  onSearch: (query: string, network: string) => Promise<void>;
  busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const [network, setNetwork] = useState('auto');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length > 0) void onSearch(query.trim(), network);
  };

  return (
    <form className="search-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="global-query">
        地址或交易标识
      </label>
      <div className="search-input-wrap">
        <span aria-hidden="true" className="search-symbol">
          ⌕
        </span>
        <input
          id="global-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="地址、交易哈希、Bitcoin 交易输出点、Solana 公钥…"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <label className="sr-only" htmlFor="network-filter">
        网络
      </label>
      <select
        id="network-filter"
        value={network}
        onChange={(event) => setNetwork(event.target.value)}
      >
        <option value="auto">自动识别</option>
        <option value="ethereum">以太坊</option>
        <option value="bsc">BNB 智能链</option>
        <option value="bitcoin">Bitcoin</option>
        <option value="solana">Solana</option>
      </select>
      <button className="primary-button" type="submit" disabled={busy || query.trim().length === 0}>
        {busy ? '追踪中…' : '追踪'}
      </button>
    </form>
  );
}

export function ProviderTable({ health }: { health?: HealthResponse | undefined }) {
  const providers = health?.providers ?? [];
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>数据源</th>
            <th>账本</th>
            <th>状态</th>
            <th>链头</th>
            <th>延迟</th>
          </tr>
        </thead>
        <tbody>
          {providers.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty-cell">
                数据源健康尚未加载。
              </td>
            </tr>
          ) : (
            providers.map((provider, index) => (
              <tr key={provider.id}>
                <td>
                  <strong>
                    {ledgerLabel(provider.ledger)} 数据源 {index + 1}
                  </strong>
                </td>
                <td>
                  <span className={'chain-tag chain-' + provider.ledger.toLowerCase()}>
                    {ledgerLabel(provider.ledger)}
                  </span>
                </td>
                <td>
                  <StatusPill status={provider.status} />
                </td>
                <td>
                  {provider.head.state === 'known' ? (
                    <code>{provider.head.value}</code>
                  ) : (
                    <span className="unknown-copy">
                      {titleCase(provider.head.reason ?? 'unknown')}
                    </span>
                  )}
                </td>
                <td>{provider.latencyMs === null ? '—' : provider.latencyMs + ' ms'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Overview({
  health,
  onSearch,
  searchBusy,
}: {
  health?: HealthResponse | undefined;
  onSearch: (query: string, network: string) => Promise<void>;
  searchBusy: boolean;
}) {
  const upProviders = health?.providers.filter((provider) => provider.status === 'UP').length ?? 0;
  const totalProviders = health?.providers.length ?? 0;
  return (
    <>
      <section className="panel workbench-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">只读案件工作站</span>
            <h1>工作台 / 查询</h1>
          </div>
          <span className="snapshot-badge">
            数据源 {upProviders}/{totalProviders} 在线
          </span>
        </div>
        <p>统一识别代币、钱包、交易哈希和案件编号；所有结论必须绑定快照、覆盖率与证据。</p>
        <p className="workbench-boundary">链上只读 · 3 个账本族 · 0 个写链方法</p>
        <SearchBox onSearch={onSearch} busy={searchBusy} />
        <div className="workbench-grid">
          <div>
            <span>最近案件</span>
            <strong>尚未加载</strong>
            <small>连接持久案件库后显示，禁止以示例数据填充。</small>
          </div>
          <div>
            <span>运行中任务</span>
            <strong>未知</strong>
            <small>任务列表接口未闭合，不能显示假 0。</small>
          </div>
          <div>
            <span>待处理告警</span>
            <strong>未知</strong>
            <small>仅展示绑定证据的持久化告警。</small>
          </div>
          <div>
            <span>数据源健康</span>
            <strong>
              {upProviders}/{totalProviders}
            </strong>
            <small>{formatTime(health?.checkedAt)}</small>
          </div>
        </div>
      </section>
    </>
  );
}

export function EvidencePanel({
  evidence,
  eyebrow = '指标 → 原始观测',
  title = '证据账本',
}: {
  evidence: EvidenceRecord[];
  eyebrow?: string;
  title?: string;
}) {
  return (
    <section className="panel evidence-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <span className="snapshot-badge">{evidence.length} 条观测</span>
      </div>
      {evidence.map((item) => (
        <details className="evidence-item" key={item.id}>
          <summary>
            <span className="evidence-kind">{titleCase(item.kind)}</span>
            <strong>{item.summary}</strong>
            <code>{shortId(item.id, 8)}</code>
          </summary>
          <dl>
            <div>
              <dt>定位符</dt>
              <dd>
                <code>{item.locator}</code>
              </dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{item.source}</dd>
            </div>
            <div>
              <dt>区块 / slot</dt>
              <dd>{item.blockOrSlot ?? '未绑定'}</dd>
            </div>
            <div>
              <dt>终局性</dt>
              <dd>{item.finality ?? '未报告'}</dd>
            </div>
            <div>
              <dt>已观测</dt>
              <dd>{formatTime(item.observedAt)}</dd>
            </div>
            <div>
              <dt>载荷哈希</dt>
              <dd>
                <code>{item.payloadHash}</code>
              </dd>
            </div>
          </dl>
        </details>
      ))}
    </section>
  );
}
