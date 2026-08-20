import {
  type Capability,
  type EvidenceRecord,
  type HealthResponse,
  type LaunchpadRegistryEntry,
  type PlatformDescriptor,
} from '../../generated-api/client.js';
import { zhCapabilityTitle, zhDetail } from '../../i18n/zh-CN.js';
import { useState, type FormEvent } from 'react';
import {
  type Theme,
  type View,
  NAVIGATION,
  DEVELOPER_NAVIGATION,
  Icon,
  FUTURE_DOMAINS,
  StatusPill,
  titleCase,
  formatTime,
  shortId,
} from './part-01.js';

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
          aria-label={'接口状态 ' + (health?.status ?? '检查中')}
        >
          <span
            className={'state-light ' + (health?.status === 'UP' ? 'state-up' : 'state-warn')}
          />
          接口 {health?.status ?? '检查中'}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☼' : '◐'}
        </button>
        <a className="docs-link" href="/docs" target="_blank" rel="noreferrer">
          接口文档
        </a>
      </div>
    </header>
  );
}

export function Sidebar({ view, setView }: { view: View; setView: (view: View) => void }) {
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
        <details className="developer-navigation" open>
          <summary>开发者能力</summary>
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
        <div className="nav-caption nav-caption-spaced">架构域</div>
        {FUTURE_DOMAINS.map((domain) => (
          <div
            className="nav-item nav-disabled"
            key={domain}
            title="契约保留；实现已接入取证工作站"
          >
            <Icon>·</Icon>
            <span>{domain}</span>
            <span className="nav-lock">门禁</span>
          </div>
        ))}
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
          placeholder="地址、交易哈希、outpoint、Solana 公钥…"
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
        <option value="ethereum">Ethereum</option>
        <option value="bsc">BNB Smart Chain</option>
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
            <th>端点</th>
            <th>熔断</th>
            <th>链头</th>
            <th>延迟</th>
          </tr>
        </thead>
        <tbody>
          {providers.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-cell">
                数据源健康尚未加载。
              </td>
            </tr>
          ) : (
            providers.map((provider) => (
              <tr key={provider.id}>
                <td>
                  <strong>{provider.id}</strong>
                </td>
                <td>
                  <span className={'chain-tag chain-' + provider.ledger.toLowerCase()}>
                    {provider.ledger}
                  </span>
                </td>
                <td>
                  <StatusPill status={provider.status} />
                </td>
                <td>
                  <code>
                    {provider.transport?.activeEndpointId ?? provider.transport?.endpointId ?? '—'}
                  </code>
                </td>
                <td>{provider.transport?.circuitState ?? '—'}</td>
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
  capabilities,
  platforms,
  launchpadRegistry,
  onSearch,
  searchBusy,
}: {
  health?: HealthResponse | undefined;
  capabilities: Capability[];
  platforms: PlatformDescriptor[];
  launchpadRegistry: LaunchpadRegistryEntry[];
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
        <p>
          统一识别 Token、钱包、交易哈希和案件编号；所有结论必须绑定 Snapshot、Coverage 与
          Evidence。
        </p>
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
            <small>仅展示绑定 Evidence 的持久告警。</small>
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

      <section className="two-column">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">运行时事实</span>
              <h3>数据源健康</h3>
            </div>
            <span className="freshness">{formatTime(health?.checkedAt)}</span>
          </div>
          <ProviderTable health={health} />
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">交付门禁</span>
              <h3>能力账本</h3>
            </div>
          </div>
          <div className="capability-list">
            {capabilities.map((capability) => (
              <div className="capability-row" key={capability.id}>
                <div>
                  <strong>{zhCapabilityTitle(capability.id)}</strong>
                  {capability.detail === undefined ? null : (
                    <small>{zhDetail(capability.detail)}</small>
                  )}
                </div>
                <StatusPill status={capability.status} />
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel platform-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">机制感知架构</span>
            <h3>平台适配边界</h3>
          </div>
          <span className="panel-note">状态表示实现事实，不是产品宣传。</span>
        </div>
        <div className="platform-grid">
          {platforms.map((platform) => (
            <article className="platform-card" key={platform.id}>
              <div className="platform-card-top">
                <strong>{platform.name}</strong>
                <StatusPill status={platform.implementationStatus} />
              </div>
              <div className="platform-ledgers">
                {platform.ledgers.map((ledger) => (
                  <span key={ledger}>{ledger}</span>
                ))}
                {platform.roles.map((role) => (
                  <span className="role-tag" key={role}>
                    {titleCase(role)}
                  </span>
                ))}
              </div>
              {(() => {
                const registry = launchpadRegistry.find((entry) => entry.platform === platform.id);
                return registry === undefined ? null : (
                  <div className="platform-provenance">
                    <StatusPill status={registry.provenanceStatus} />
                    <span>
                      {registry.versions.length > 0
                        ? `${registry.versions.length} 个钉扎版本`
                        : '无钉扎版本'}
                    </span>
                  </div>
                );
              })()}
              <p>{zhDetail(platform.integrationBoundary)}</p>
            </article>
          ))}
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
