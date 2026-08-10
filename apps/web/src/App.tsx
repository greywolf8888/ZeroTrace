import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import {
  api,
  type ClaimDeclarationParseResponse,
  type Capability,
  type ClaimReportResponse,
  type EvmClaimBurnCandidateDiscoveryResponse,
  type EvmClaimBurnConservationResponse,
  type EvmClaimBurnPromotionReplayResponse,
  type EvmSupplyContinuityReplayResponse,
  type EvmControlSurfaceResponse,
  type EvidenceRecord,
  type FlapConfigurationField,
  type FlapEventHistoryResponse,
  type FlapHistoryProjectionPageResponse,
  type FlapLifetimeHeadResponse,
  type FlapLifetimeMaterializationResponse,
  type FlapEventTransactionResponse,
  type FlapInspectionResponse,
  type FlapPancakeV2BuyScenarioResponse,
  type FlapPancakeV2ReconciliationResponse,
  type FlapPancakeV2SellScenarioResponse,
  type FlapSellQuoteResponse,
  type HealthResponse,
  type KnowledgeValue,
  type PlatformDescriptor,
  type SearchResponse,
  type SubjectCandidate,
  type SubjectResponse,
} from './api.js';

type View = 'overview' | 'search' | 'control' | 'claims' | 'scenario' | 'health';
type Theme = 'dark' | 'light';

const NAVIGATION: Array<{ id: View; label: string; marker: string }> = [
  { id: 'overview', label: 'Market Reality', marker: 'MR' },
  { id: 'search', label: 'Intelligence Search', marker: 'IS' },
  { id: 'control', label: 'Control Rights', marker: 'CR' },
  { id: 'claims', label: 'Claim Audit', marker: 'CA' },
  { id: 'scenario', label: 'Scenario Lab', marker: 'SL' },
  { id: 'health', label: 'Data Health', marker: 'DH' },
];

const FUTURE_DOMAINS = [
  'Entity Intelligence',
  'Evidence Ledger',
  'Control Timeline',
  'Analyst Workbench',
];

function shortId(value: string, length = 12): string {
  if (value.length <= length * 2 + 1) return value;
  return value.slice(0, length) + '…' + value.slice(-length);
}

function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function titleCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');
}

function isValidBoundedBlockRange(fromBlock: string, toBlock: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(fromBlock) || !/^(?:0|[1-9]\d*)$/.test(toBlock)) return false;
  const from = BigInt(fromBlock);
  const to = BigInt(toBlock);
  return to >= from && to - from + 1n <= 50_000n;
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll('_', '-');
  return <span className={'status-pill status-' + normalized}>{titleCase(status)}</span>;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="icon-box" aria-hidden="true">
      {children}
    </span>
  );
}

function MetricTile({
  label,
  value,
  detail,
  state = 'unknown',
}: {
  label: string;
  value: string;
  detail: string;
  state?: 'known' | 'unknown' | 'unavailable';
}) {
  return (
    <article className={'metric-tile metric-' + state}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">
        <span className="metric-dot" />
        {detail}
      </div>
    </article>
  );
}

function KnowledgeDisplay({ data }: { data: KnowledgeValue<unknown> }) {
  if (data.state === 'known') {
    const display =
      typeof data.value === 'object' ? JSON.stringify(data.value) : String(data.value ?? 'null');
    return <span className="knowledge-known">{display}</span>;
  }
  return (
    <span className={'knowledge-' + data.state} title={data.detail}>
      {titleCase(data.reason ?? data.state)}
    </span>
  );
}

function TokenAmountKnowledge({ data }: { data: KnowledgeValue<{ decimal: string }> }) {
  if (data.state === 'known' && data.value !== undefined) {
    return <span className="knowledge-known">{data.value.decimal}</span>;
  }
  return <KnowledgeDisplay data={data} />;
}

function Header({
  theme,
  setTheme,
  health,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  health?: HealthResponse | undefined;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <img
          src="/zerotrace-company-icon.png"
          alt="ZeroTrace company icon"
          width="44"
          height="44"
        />
        <div>
          <strong>ZeroTrace</strong>
          <span>Evidence-first intelligence</span>
        </div>
      </div>
      <div className="topbar-actions">
        <div className="read-only-badge">
          <span className="pulse-dot" />
          Read-only
        </div>
        <div className="api-state" title={health?.checkedAt}>
          <span
            className={'state-light ' + (health?.status === 'UP' ? 'state-up' : 'state-warn')}
          />
          API {health?.status ?? 'checking'}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☼' : '◐'}
        </button>
        <a className="docs-link" href="/docs" target="_blank" rel="noreferrer">
          API Docs
        </a>
      </div>
    </header>
  );
}

function Sidebar({ view, setView }: { view: View; setView: (view: View) => void }) {
  return (
    <aside className="sidebar">
      <nav aria-label="Primary">
        <div className="nav-caption">Intelligence</div>
        {NAVIGATION.map((item) => (
          <button
            key={item.id}
            type="button"
            className={'nav-item ' + (view === item.id ? 'nav-active' : '')}
            onClick={() => setView(item.id)}
          >
            <Icon>{item.marker}</Icon>
            <span>{item.label}</span>
          </button>
        ))}
        <div className="nav-caption nav-caption-spaced">Terminal architecture</div>
        {FUTURE_DOMAINS.map((domain) => (
          <div
            className="nav-item nav-disabled"
            key={domain}
            title="Contract retained; implementation pending"
          >
            <Icon>·</Icon>
            <span>{domain}</span>
            <span className="nav-lock">gate</span>
          </div>
        ))}
      </nav>
      <div className="sidebar-note">
        <span>Safety invariant</span>
        <strong>No keys. No signing. No broadcast.</strong>
        <p>Simulation is restricted to offline or non-broadcast execution.</p>
      </div>
    </aside>
  );
}

function SearchBox({
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
        Address or transaction identifier
      </label>
      <div className="search-input-wrap">
        <span aria-hidden="true" className="search-symbol">
          ⌕
        </span>
        <input
          id="global-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Address, tx hash, outpoint, Solana pubkey…"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <label className="sr-only" htmlFor="network-filter">
        Network
      </label>
      <select
        id="network-filter"
        value={network}
        onChange={(event) => setNetwork(event.target.value)}
      >
        <option value="auto">Auto-detect</option>
        <option value="ethereum">Ethereum</option>
        <option value="bsc">BNB Smart Chain</option>
        <option value="bitcoin">Bitcoin</option>
        <option value="solana">Solana</option>
      </select>
      <button className="primary-button" type="submit" disabled={busy || query.trim().length === 0}>
        {busy ? 'Tracing…' : 'Trace'}
      </button>
    </form>
  );
}

function ProviderTable({ health }: { health?: HealthResponse | undefined }) {
  const providers = health?.providers ?? [];
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Ledger</th>
            <th>Status</th>
            <th>Endpoint</th>
            <th>Circuit</th>
            <th>Head</th>
            <th>Latency</th>
          </tr>
        </thead>
        <tbody>
          {providers.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-cell">
                Provider health has not loaded.
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

function Overview({
  health,
  capabilities,
  platforms,
  onSearch,
  searchBusy,
}: {
  health?: HealthResponse | undefined;
  capabilities: Capability[];
  platforms: PlatformDescriptor[];
  onSearch: (query: string, network: string) => Promise<void>;
  searchBusy: boolean;
}) {
  const upProviders = health?.providers.filter((provider) => provider.status === 'UP').length ?? 0;
  const totalProviders = health?.providers.length ?? 0;
  return (
    <>
      <section className="hero-panel">
        <img
          className="hero-company-icon"
          src="/zerotrace-company-icon.png"
          alt=""
          aria-hidden="true"
        />
        <div className="eyebrow">Multi-chain intelligence / evidence first</div>
        <h1>See control, liquidity, and realizable value as chain facts—not assumptions.</h1>
        <p>
          Query EVM, Bitcoin, and Solana through a read-only boundary. Every supported result
          carries freshness, coverage, snapshot context, and evidence.
        </p>
        <SearchBox onSearch={onSearch} busy={searchBusy} />
        <div className="hero-foot">
          <span>
            <b>
              {upProviders}/{totalProviders}
            </b>{' '}
            providers online
          </span>
          <span>
            <b>3</b> ledger families retained
          </span>
          <span>
            <b>0</b> transaction write methods
          </span>
        </div>
      </section>

      <div className="section-heading">
        <div>
          <span className="eyebrow">No asset selected</span>
          <h2>Market Reality</h2>
        </div>
        <div className="snapshot-badge">Snapshot required for metrics</div>
      </div>
      <section className="metric-grid">
        <MetricTile label="Nominal market cap" value="—" detail="Unknown · select an asset" />
        <MetricTile
          label="Stable realizable capacity"
          value="—"
          detail="Unknown · route not simulated"
        />
        <MetricTile label="Controller supply" value="—" detail="Unknown · entity evidence absent" />
        <MetricTile label="Independent entities" value="—" detail="Unknown · holder graph absent" />
        <MetricTile label="Organic flow ratio" value="—" detail="Unknown · history not indexed" />
        <MetricTile
          label="Effective liquidity"
          value="—"
          detail="Unknown · venues not discovered"
        />
        <MetricTile
          label="Exit concentration (EC-20)"
          value="—"
          detail="Unknown · RV curve absent"
        />
        <MetricTile label="Support capacity" value="—" detail="Unknown · treasury not resolved" />
      </section>

      <section className="two-column">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Runtime truth</span>
              <h3>Provider health</h3>
            </div>
            <span className="freshness">{formatTime(health?.checkedAt)}</span>
          </div>
          <ProviderTable health={health} />
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Delivery gates</span>
              <h3>Capability ledger</h3>
            </div>
          </div>
          <div className="capability-list">
            {capabilities.map((capability) => (
              <div className="capability-row" key={capability.id}>
                <div>
                  <strong>{titleCase(capability.id)}</strong>
                  {capability.detail === undefined ? null : <small>{capability.detail}</small>}
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
            <span className="eyebrow">Mechanism-aware architecture</span>
            <h3>Platform adapter boundaries</h3>
          </div>
          <span className="panel-note">Status is implementation truth, not product marketing.</span>
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
              <p>{platform.integrationBoundary}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function EvidencePanel({
  evidence,
  eyebrow = 'Metric → raw observation',
  title = 'Evidence ledger',
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
        <span className="snapshot-badge">
          {evidence.length} observation{evidence.length === 1 ? '' : 's'}
        </span>
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
              <dt>Locator</dt>
              <dd>
                <code>{item.locator}</code>
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{item.source}</dd>
            </div>
            <div>
              <dt>Block / slot</dt>
              <dd>{item.blockOrSlot ?? 'Not bound'}</dd>
            </div>
            <div>
              <dt>Finality</dt>
              <dd>{item.finality ?? 'Not reported'}</dd>
            </div>
            <div>
              <dt>Observed</dt>
              <dd>{formatTime(item.observedAt)}</dd>
            </div>
            <div>
              <dt>Payload hash</dt>
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

function ClaimDeclarationPanel({ token }: { token?: string | undefined }) {
  const [tokenInput, setTokenInput] = useState(token ?? '');
  const [text, setText] = useState('');
  const [windowFrom, setWindowFrom] = useState('');
  const [windowTo, setWindowTo] = useState('');
  const [result, setResult] = useState<ClaimDeclarationParseResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const activeToken = token ?? tokenInput;
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(activeToken);
  const hasWindow = windowFrom.length > 0 || windowTo.length > 0;
  const parsedFrom = Date.parse(windowFrom);
  const parsedTo = Date.parse(windowTo);
  const validWindow =
    !hasWindow ||
    (windowFrom.length > 0 &&
      windowTo.length > 0 &&
      Number.isFinite(parsedFrom) &&
      Number.isFinite(parsedTo) &&
      parsedFrom <= parsedTo);

  async function parseDeclaration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim().length === 0 || !validWindow || !validToken) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(
        await api.parseClaimDeclaration(
          activeToken,
          text,
          hasWindow ? { from: windowFrom, to: windowTo } : undefined,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Claim declaration parsing failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel subject-panel quote-panel"
      aria-labelledby="claim-declaration-heading"
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Off-chain statement compiler</span>
          <h3 id="claim-declaration-heading">Claim Declaration Review</h3>
        </div>
        <span className="snapshot-badge">Declaration ≠ chain fact</span>
      </div>
      <p className="panel-copy">
        Paste a public announcement to create Evidence-linked review drafts. Missing addresses,
        exact dates, token decimals, or action proof remain Unknown and cannot enter Chain Verify.
      </p>
      <form
        className="quote-form claim-declaration-form"
        onSubmit={(event) => void parseDeclaration(event)}
      >
        {token === undefined ? (
          <>
            <label htmlFor="claim-declaration-token">BSC token address</label>
            <input
              id="claim-declaration-token"
              spellCheck={false}
              placeholder="0x…"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value.trim())}
            />
          </>
        ) : null}
        <label htmlFor="claim-declaration-text">Announcement text</label>
        <textarea
          id="claim-declaration-text"
          placeholder="Paste the original tax, burn, liquidity, treasury, pension, or dividend statement"
          value={text}
          maxLength={100_000}
          onChange={(event) => setText(event.target.value)}
        />
        <label htmlFor="claim-window-from">
          Audit window start (optional, ISO 8601 with timezone)
        </label>
        <input
          id="claim-window-from"
          spellCheck={false}
          placeholder="2026-08-02T00:00:00+08:00"
          value={windowFrom}
          onChange={(event) => setWindowFrom(event.target.value.trim())}
        />
        <label htmlFor="claim-window-to">Audit window end (optional, ISO 8601 with timezone)</label>
        <input
          id="claim-window-to"
          spellCheck={false}
          placeholder="2026-08-10T23:59:59+08:00"
          value={windowTo}
          onChange={(event) => setWindowTo(event.target.value.trim())}
        />
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || text.trim().length === 0 || !validWindow || !validToken}
        >
          {busy ? 'Compiling…' : 'Compile review drafts'}
        </button>
      </form>
      {!validWindow ? (
        <p className="inline-error">
          Supply both timezone-qualified boundaries and keep the end at or after the start.
        </p>
      ) : null}
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {result === undefined ? null : (
        <>
          <div className="snapshot-strip">
            <span>
              <b>Parser</b> {result.parserVersion}
            </span>
            <span>
              <b>Drafts</b> {result.drafts.length}
            </span>
            <span>
              <b>Analyst Evidence</b> <code>{result.evidence.id}</code>
            </span>
          </div>
          {result.warnings.length === 0 ? null : (
            <div className="claim-warning-list" role="status">
              {result.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          {result.drafts.length === 0 ? (
            <div className="empty-state compact-empty">
              <strong>No supported declaration found</strong>
              <span>The source text is preserved as Analyst Evidence without invented rules.</span>
            </div>
          ) : (
            <div className="claim-draft-list">
              {result.drafts.map((draft) => (
                <article className="claim-draft-card" key={draft.id}>
                  <div className="claim-draft-heading">
                    <div>
                      <span className="eyebrow">{titleCase(draft.role)}</span>
                      <h4>{titleCase(draft.expectedAction)}</h4>
                    </div>
                    <span
                      className={
                        draft.chainVerifyReadiness === 'READY_FOR_REVIEW'
                          ? 'status-chip status-up'
                          : 'status-chip status-degraded'
                      }
                    >
                      {titleCase(draft.chainVerifyReadiness)}
                    </span>
                  </div>
                  <div className="fact-grid">
                    <div className="fact-row">
                      <span>Source</span>
                      <KnowledgeDisplay data={draft.sourceAddress} />
                    </div>
                    <div className="fact-row">
                      <span>Destination</span>
                      <KnowledgeDisplay data={draft.destinationAddress} />
                    </div>
                    <div className="fact-row">
                      <span>Expected share bps</span>
                      <KnowledgeDisplay data={draft.expectedShareBps} />
                    </div>
                    <div className="fact-row">
                      <span>Share unit (tokens)</span>
                      <KnowledgeDisplay data={draft.shareUnitTokens} />
                    </div>
                    <div className="fact-row">
                      <span>No-exit wording</span>
                      <KnowledgeDisplay data={draft.noExit} />
                    </div>
                    <div className="fact-row">
                      <span>Cadence seconds</span>
                      <KnowledgeDisplay data={draft.cadenceSeconds} />
                    </div>
                  </div>
                  <div className="claim-draft-footer">
                    <span>
                      Missing:{' '}
                      {draft.missingFields.length === 0 ? 'none' : draft.missingFields.join(', ')}
                    </span>
                    <span>Human review required</span>
                  </div>
                  <details className="raw-details">
                    <summary>Matched declaration text</summary>
                    <pre>{draft.matchedText}</pre>
                  </details>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ClaimBurnConservationPanel() {
  const [token, setToken] = useState('');
  const [blockNumber, setBlockNumber] = useState('');
  const [result, setResult] = useState<EvmClaimBurnConservationResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(token);
  const validBlock = /^[1-9]\d*$/.test(blockNumber);

  async function inspectBurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken || !validBlock) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.inspectClaimBurnConservation(token, blockNumber));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Burn conservation inspection failed.');
    } finally {
      setBusy(false);
    }
  }

  const report = result?.report;
  const statusClass =
    report?.status === 'VERIFIED'
      ? 'status-chip status-up'
      : report?.status === 'CONTRADICTED'
        ? 'status-chip status-down'
        : 'status-chip status-degraded';

  return (
    <section
      className="panel subject-panel quote-panel"
      aria-labelledby="burn-conservation-heading"
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Finalized block certificate</span>
          <h3 id="burn-conservation-heading">Burn Supply Conservation</h3>
        </div>
        <span className="snapshot-badge">Zero address alone is insufficient</span>
      </div>
      <p className="panel-copy">
        Compare parent/target totalSupply with every Transfer mint and burn in one finalized block.
        This proves or rejects candidate actions for that block; it does not prove a whole window
        has no other actions.
      </p>
      <form className="quote-form claim-burn-form" onSubmit={(event) => void inspectBurn(event)}>
        <div className="claim-burn-field">
          <label htmlFor="claim-burn-token">Burn token address</label>
          <input
            id="claim-burn-token"
            spellCheck={false}
            placeholder="0x…"
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field claim-burn-block-field">
          <label htmlFor="claim-burn-block">Finalized burn block</label>
          <input
            id="claim-burn-block"
            inputMode="numeric"
            placeholder="115000000"
            value={blockNumber}
            onChange={(event) => setBlockNumber(event.target.value.trim())}
          />
        </div>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !validToken || !validBlock}
        >
          {busy ? 'Verifying…' : 'Verify burn conservation'}
        </button>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {report === undefined ? null : (
        <div className="burn-conservation-result">
          <div className="snapshot-strip">
            <span className={statusClass}>{titleCase(report.status)}</span>
            <span>
              <b>Block</b> {report.blockNumber}
            </span>
            <span>
              <b>Terminal Evidence</b> <code>{report.terminalEvidenceId}</code>
            </span>
          </div>
          <div className="fact-grid burn-fact-grid">
            <div className="fact-row">
              <span>Supply before</span>
              <strong>{report.totalSupplyBefore}</strong>
            </div>
            <div className="fact-row">
              <span>Supply after</span>
              <strong>{report.totalSupplyAfter}</strong>
            </div>
            <div className="fact-row">
              <span>Mint events</span>
              <strong>{report.mintedAmount}</strong>
            </div>
            <div className="fact-row">
              <span>Burn events</span>
              <strong>{report.burnedAmount}</strong>
            </div>
            <div className="fact-row">
              <span>Supply delta</span>
              <strong>{report.supplyDelta}</strong>
            </div>
            <div className="fact-row">
              <span>Event net delta</span>
              <strong>{report.eventNetSupplyDelta}</strong>
            </div>
          </div>
          <p className={report.status === 'CONTRADICTED' ? 'inline-error' : 'panel-copy'}>
            {report.status === 'VERIFIED'
              ? 'Supply/event conservation verified. The Evidence-linked actions are eligible for Claim Audit.'
              : report.status === 'CONTRADICTED'
                ? 'Supply/event conservation failed. Zero-address Transfers were not credited as burn actions.'
                : 'The complete block is conserved and contains no non-zero burn action.'}
          </p>
          {report.actions.length === 0 ? null : (
            <div className="claim-draft-list">
              {report.actions.map((action) => (
                <article className="claim-draft-card" key={action.id}>
                  <div className="claim-draft-heading">
                    <div>
                      <span className="eyebrow">Conserved action</span>
                      <h4>Burn {action.amount}</h4>
                    </div>
                    <span className="status-chip status-up">Action generated</span>
                  </div>
                  <div className="fact-grid">
                    <div className="fact-row">
                      <span>Actor</span>
                      <code>{action.actor}</code>
                    </div>
                    <div className="fact-row">
                      <span>Path</span>
                      <code>{action.path.join(' → ')}</code>
                    </div>
                    <div className="fact-row">
                      <span>Transfer</span>
                      <code>{action.transferIds.join(', ')}</code>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ClaimBurnCandidateDiscoveryPanel() {
  const [token, setToken] = useState('');
  const [fromBlock, setFromBlock] = useState('');
  const [toBlock, setToBlock] = useState('');
  const [result, setResult] = useState<EvmClaimBurnCandidateDiscoveryResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(token);
  const validFrom = /^(0|[1-9]\d*)$/.test(fromBlock);
  const validTo = /^[1-9]\d*$/.test(toBlock);
  const ordered = validFrom && validTo && BigInt(fromBlock) <= BigInt(toBlock);

  async function discoverCandidates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken || !ordered) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.discoverClaimBurnCandidates(token, fromBlock, toBlock));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Burn candidate discovery failed.');
    } finally {
      setBusy(false);
    }
  }

  const report = result?.report;
  return (
    <section className="panel subject-panel quote-panel" aria-labelledby="burn-discovery-heading">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Long-range event discovery</span>
          <h3 id="burn-discovery-heading">Burn Candidate Range</h3>
        </div>
        <span className="snapshot-badge">BSC SQD · read-only</span>
      </div>
      <p className="panel-copy">
        Search a finalized range for non-zero ERC-20 Transfers to the zero address. Each candidate
        still needs the exact-block conservation certificate above. Silent or custom supply changes
        are outside this event query and remain Unknown.
      </p>
      <form
        className="quote-form claim-burn-form"
        onSubmit={(event) => void discoverCandidates(event)}
      >
        <div className="claim-burn-field">
          <label htmlFor="claim-burn-discovery-token">Candidate token address</label>
          <input
            id="claim-burn-discovery-token"
            spellCheck={false}
            placeholder="0x…"
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field claim-burn-block-field">
          <label htmlFor="claim-burn-discovery-from">From block</label>
          <input
            id="claim-burn-discovery-from"
            inputMode="numeric"
            placeholder="113485950"
            value={fromBlock}
            onChange={(event) => setFromBlock(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field claim-burn-block-field">
          <label htmlFor="claim-burn-discovery-to">To block</label>
          <input
            id="claim-burn-discovery-to"
            inputMode="numeric"
            placeholder="115154970"
            value={toBlock}
            onChange={(event) => setToBlock(event.target.value.trim())}
          />
        </div>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !validToken || !ordered}
        >
          {busy ? 'Discovering…' : 'Discover burn candidates'}
        </button>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {report === undefined ? null : (
        <div className="burn-conservation-result">
          <div className="snapshot-strip">
            <span
              className={
                report.status === 'CANDIDATES_DISCOVERED'
                  ? 'status-chip status-degraded'
                  : 'status-chip status-up'
              }
            >
              {titleCase(report.status)}
            </span>
            <span>
              <b>Range</b> {report.fromBlock}–{report.toBlock}
            </span>
            <span>
              <b>Terminal Evidence</b> <code>{report.terminalEvidenceId}</code>
            </span>
          </div>
          <div className="fact-grid burn-fact-grid">
            <div className="fact-row">
              <span>Zero-address events</span>
              <strong>{report.zeroAddressEventCount}</strong>
            </div>
            <div className="fact-row">
              <span>Candidate blocks</span>
              <strong>{report.burnCandidateCount}</strong>
            </div>
            <div className="fact-row">
              <span>Coverage scope</span>
              <code>{report.coverageScope}</code>
            </div>
            <div className="fact-row">
              <span>Silent supply changes</span>
              <KnowledgeDisplay data={report.silentSupplyChangeDetection} />
            </div>
          </div>
          <div className="alert alert-warning">
            <strong>Event-only boundary</strong>
            <span>
              {report.silentSupplyChangeDetection.state === 'unknown'
                ? report.silentSupplyChangeDetection.detail
                : 'Silent supply-change coverage must remain Unknown for this query.'}
            </span>
          </div>
          {report.candidates.length === 0 ? (
            <p className="panel-copy">
              No zero-address burn candidate was observed in the complete event query. This is not
              proof that totalSupply never changed silently.
            </p>
          ) : (
            <div className="claim-draft-list">
              {report.candidates.map((candidate) => (
                <article
                  className="claim-draft-card"
                  key={`${candidate.blockNumber}:${candidate.blockHash}`}
                >
                  <div className="claim-draft-heading">
                    <div>
                      <span className="eyebrow">Needs exact-block promotion</span>
                      <h4>Block {candidate.blockNumber}</h4>
                    </div>
                    <span className="status-chip status-degraded">Candidate only</span>
                  </div>
                  <div className="fact-grid">
                    <div className="fact-row">
                      <span>Observed burn events</span>
                      <strong>{candidate.burnedEventAmount}</strong>
                    </div>
                    <div className="fact-row">
                      <span>Same-block mint events</span>
                      <strong>{candidate.mintedEventAmount}</strong>
                    </div>
                    <div className="fact-row">
                      <span>Burn Transfers</span>
                      <strong>{candidate.burnTransferIds.length}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ClaimBurnPromotionReplayPanel() {
  const [token, setToken] = useState('');
  const [scanId, setScanId] = useState('');
  const [result, setResult] = useState<EvmClaimBurnPromotionReplayResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(token);
  const validScanId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId);

  async function replayPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken || !validScanId) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.replayClaimBurnPromotion(token, scanId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Burn promotion replay failed.');
    } finally {
      setBusy(false);
    }
  }

  const terminal = result?.terminalResult ?? null;
  return (
    <section className="panel subject-panel quote-panel" aria-labelledby="burn-promotion-heading">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Durable worker replay</span>
          <h3 id="burn-promotion-heading">Burn Promotion Certificate</h3>
        </div>
        <span className="snapshot-badge">PostgreSQL replay · no provider</span>
      </div>
      <p className="panel-copy">
        Replay a semantic-worker scan by ID. Completed candidate blocks include exact-block supply
        conservation; event coverage never becomes proof of silent supply changes.
      </p>
      <form
        className="quote-form claim-burn-form"
        onSubmit={(event) => void replayPromotion(event)}
      >
        <div className="claim-burn-field">
          <label htmlFor="claim-burn-promotion-token">Promoted token address</label>
          <input
            id="claim-burn-promotion-token"
            spellCheck={false}
            placeholder="0x…"
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="claim-burn-promotion-scan">Promotion scan ID</label>
          <input
            id="claim-burn-promotion-scan"
            spellCheck={false}
            placeholder="00000000-0000-4000-8000-000000000000"
            value={scanId}
            onChange={(event) => setScanId(event.target.value.trim())}
          />
        </div>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !validToken || !validScanId}
        >
          {busy ? 'Replaying…' : 'Replay promotion'}
        </button>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {result === undefined ? null : (
        <div className="burn-conservation-result">
          <div className="snapshot-strip">
            <span
              className={
                result.scan.status === 'REQUESTED_RANGE_COMPLETE'
                  ? 'status-chip status-up'
                  : 'status-chip status-degraded'
              }
            >
              {titleCase(result.scan.status)}
            </span>
            <span>
              <b>Range progress</b> {(result.scan.requestedRangeCoverage * 100).toFixed(2)}%
            </span>
            <span>
              <b>Next block</b> {result.scan.nextBlock}
            </span>
          </div>
          {terminal === null ? (
            <div className="alert alert-warning">
              <strong>Scan is not terminal</strong>
              <span>
                Resume the identical worker command. No result is inferred from partial segments.
                {result.scan.lastErrorCode === null
                  ? ''
                  : ` Last bounded failure: ${result.scan.lastErrorCode}.`}
              </span>
            </div>
          ) : (
            <>
              <div className="fact-grid burn-fact-grid">
                <div className="fact-row">
                  <span>Candidate blocks</span>
                  <strong>{terminal.burnCandidateCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Verified candidates</span>
                  <strong>{terminal.verifiedCandidateCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Contradicted candidates</span>
                  <strong>{terminal.contradictedCandidateCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Verified actions</span>
                  <strong>{terminal.verifiedActionCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Terminal Evidence</span>
                  <code>{terminal.terminalEvidenceId}</code>
                </div>
                <div className="fact-row">
                  <span>Silent supply changes</span>
                  <strong>{titleCase(terminal.silentSupplyChangeDetection.state)}</strong>
                </div>
              </div>
              <div className="alert alert-warning">
                <strong>Scoped certificate</strong>
                <span>
                  {terminal.silentSupplyChangeDetection.state === 'unknown'
                    ? terminal.silentSupplyChangeDetection.detail
                    : 'Silent supply-change detection must remain Unknown.'}
                </span>
              </div>
              <div className="claim-draft-list">
                {terminal.segments.map((segment) => (
                  <article
                    className="claim-draft-card"
                    key={`${segment.fromBlock}:${segment.toBlock}`}
                  >
                    <div className="claim-draft-heading">
                      <div>
                        <span className="eyebrow">Finalized event segment</span>
                        <h4>
                          Blocks {segment.fromBlock}–{segment.toBlock}
                        </h4>
                      </div>
                      <span className="status-chip status-up">
                        {segment.burnCandidateCount} certified
                      </span>
                    </div>
                    <p className="panel-copy">
                      Discovery Evidence <code>{segment.discoveryTerminalEvidenceId}</code>
                    </p>
                    {segment.certificates.map((certificate) => (
                      <div className="fact-grid" key={certificate.terminalEvidenceId}>
                        <div className="fact-row">
                          <span>Certificate block</span>
                          <strong>{certificate.blockNumber}</strong>
                        </div>
                        <div className="fact-row">
                          <span>Conservation status</span>
                          <strong>{titleCase(certificate.status)}</strong>
                        </div>
                        <div className="fact-row">
                          <span>Burned event amount</span>
                          <strong>{certificate.burnedEventAmount}</strong>
                        </div>
                        <div className="fact-row">
                          <span>Certificate Evidence</span>
                          <code>{certificate.terminalEvidenceId}</code>
                        </div>
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function SupplyContinuityReplayPanel() {
  const [token, setToken] = useState('');
  const [scanId, setScanId] = useState('');
  const [result, setResult] = useState<EvmSupplyContinuityReplayResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(token);
  const validScanId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId);

  async function replaySupply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken || !validScanId) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.replaySupplyContinuity(token, scanId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Supply-continuity replay failed.');
    } finally {
      setBusy(false);
    }
  }

  const terminal = result?.terminalResult ?? null;
  const statusClass =
    terminal?.status === 'VERIFIED_NO_CHANGE' ||
    terminal?.status === 'VERIFIED_EVENT_CONSERVED_CHANGES'
      ? 'status-chip status-up'
      : terminal?.status === 'UNEXPLAINED_SUPPLY_CHANGE'
        ? 'status-chip status-down'
        : 'status-chip status-degraded';
  return (
    <section
      className="panel subject-panel quote-panel"
      aria-labelledby="supply-continuity-heading"
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Supply Reality · durable replay</span>
          <h3 id="supply-continuity-heading">All-block Supply Continuity</h3>
        </div>
        <span className="snapshot-badge">PostgreSQL replay · no provider</span>
      </div>
      <p className="panel-copy">
        Verify every finalized totalSupply transition in one exact range. Each state read is pinned
        to a canonical block hash; every observed change must reconcile with complete same-block
        mint and burn events.
      </p>
      <form className="quote-form claim-burn-form" onSubmit={(event) => void replaySupply(event)}>
        <div className="claim-burn-field">
          <label htmlFor="claim-supply-token">Supply token address</label>
          <input
            id="claim-supply-token"
            spellCheck={false}
            placeholder="0x…"
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="claim-supply-scan">Supply scan ID</label>
          <input
            id="claim-supply-scan"
            spellCheck={false}
            placeholder="00000000-0000-4000-8000-000000000000"
            value={scanId}
            onChange={(event) => setScanId(event.target.value.trim())}
          />
        </div>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !validToken || !validScanId}
        >
          {busy ? 'Replaying…' : 'Replay supply proof'}
        </button>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {result === undefined ? null : (
        <div className="burn-conservation-result">
          <div className="snapshot-strip">
            <span
              className={
                result.scan.status === 'REQUESTED_RANGE_COMPLETE'
                  ? 'status-chip status-up'
                  : 'status-chip status-degraded'
              }
            >
              {titleCase(result.scan.status)}
            </span>
            <span>
              <b>Range progress</b> {(result.scan.requestedRangeCoverage * 100).toFixed(2)}%
            </span>
            <span>
              <b>Next block</b> {result.scan.nextBlock}
            </span>
          </div>
          {terminal === null ? (
            <div className="alert alert-warning">
              <strong>Scan is not terminal</strong>
              <span>
                Resume the identical worker command. Partial samples never become a completed supply
                conclusion.
                {result.scan.lastErrorCode === null
                  ? ''
                  : ` Last bounded failure: ${result.scan.lastErrorCode}.`}
              </span>
            </div>
          ) : (
            <>
              <div className="snapshot-strip">
                <span className={statusClass}>{titleCase(terminal.status)}</span>
                <span>
                  <b>Blocks</b> {terminal.fromBlock}–{terminal.toBlock}
                </span>
                <span>
                  <b>Operators</b> {terminal.sourceIndependence.operatorCount}/
                  {terminal.sourceIndependence.requiredOperators}
                </span>
              </div>
              <div className="fact-grid burn-fact-grid">
                <div className="fact-row">
                  <span>Scanned transitions</span>
                  <strong>{terminal.scannedBlockCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Supply samples</span>
                  <strong>{terminal.supplySampleCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Initial supply</span>
                  <strong>{terminal.initialTotalSupply}</strong>
                </div>
                <div className="fact-row">
                  <span>Final supply</span>
                  <strong>{terminal.finalTotalSupply}</strong>
                </div>
                <div className="fact-row">
                  <span>Net supply delta</span>
                  <strong>{terminal.netSupplyDelta}</strong>
                </div>
                <div className="fact-row">
                  <span>Observed changes</span>
                  <strong>{terminal.supplyChangeCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Event-conserved</span>
                  <strong>{terminal.eventConservedChangeCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Unexplained</span>
                  <strong>{terminal.unexplainedChangeCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Terminal Evidence</span>
                  <code>{terminal.terminalEvidenceId}</code>
                </div>
              </div>
              <div
                className={
                  terminal.status === 'UNEXPLAINED_SUPPLY_CHANGE'
                    ? 'alert alert-error'
                    : terminal.status === 'INCONCLUSIVE_SOURCE_INDEPENDENCE'
                      ? 'alert alert-warning'
                      : 'alert alert-success'
                }
              >
                <strong>{titleCase(terminal.status)}</strong>
                <span>
                  {terminal.status === 'VERIFIED_NO_CHANGE'
                    ? 'No totalSupply change occurred inside this exact fully sampled range. This does not describe blocks outside the range.'
                    : terminal.status === 'VERIFIED_EVENT_CONSERVED_CHANGES'
                      ? 'Every observed supply change is exactly explained by complete same-block mint/burn events.'
                      : terminal.status === 'UNEXPLAINED_SUPPLY_CHANGE'
                        ? 'At least one totalSupply change is not explained by standard mint/burn events. It remains an anomaly, not an inferred burn.'
                        : 'All requested transitions were sampled, but the configured endpoints do not establish two independent operators.'}
                </span>
              </div>
              <div className="claim-draft-list">
                {terminal.sourceIndependence.attestations.map((attestation) => (
                  <article className="claim-draft-card" key={attestation.sourceId}>
                    <div className="claim-draft-heading">
                      <div>
                        <span className="eyebrow">Official operator attestation</span>
                        <h4>{attestation.operatorName}</h4>
                      </div>
                      <span className="status-chip status-up">{attestation.operatorId}</span>
                    </div>
                    <p className="panel-copy">
                      {attestation.hostname} · Evidence <code>{attestation.evidenceId}</code> ·{' '}
                      <a href={attestation.officialSource} target="_blank" rel="noreferrer">
                        official source
                      </a>
                    </p>
                  </article>
                ))}
              </div>
              <div className="claim-draft-list">
                {terminal.segments.map((segment) => (
                  <article
                    className="claim-draft-card"
                    key={`${segment.fromBlock}:${segment.toBlock}`}
                  >
                    <div className="claim-draft-heading">
                      <div>
                        <span className="eyebrow">All-block segment</span>
                        <h4>
                          Blocks {segment.fromBlock}–{segment.toBlock}
                        </h4>
                      </div>
                      <span
                        className={
                          segment.unexplainedChangeCount === 0
                            ? 'status-chip status-up'
                            : 'status-chip status-down'
                        }
                      >
                        {segment.sampleCount} samples
                      </span>
                    </div>
                    <div className="fact-grid">
                      <div className="fact-row">
                        <span>Start → end supply</span>
                        <strong>
                          {segment.startTotalSupply} → {segment.endTotalSupply}
                        </strong>
                      </div>
                      <div className="fact-row">
                        <span>Segment Evidence</span>
                        <code>{segment.terminalEvidenceId}</code>
                      </div>
                    </div>
                    {segment.changes.length === 0 ? (
                      <p className="panel-copy">
                        No totalSupply transition occurred in this segment.
                      </p>
                    ) : (
                      segment.changes.map((change) => (
                        <div className="fact-grid" key={change.certificateTerminalEvidenceId}>
                          <div className="fact-row">
                            <span>Change block</span>
                            <strong>{change.blockNumber}</strong>
                          </div>
                          <div className="fact-row">
                            <span>Supply delta</span>
                            <strong>{change.supplyDelta}</strong>
                          </div>
                          <div className="fact-row">
                            <span>Event delta</span>
                            <strong>{change.eventNetSupplyDelta}</strong>
                          </div>
                          <div className="fact-row">
                            <span>Reconciliation</span>
                            <strong>{titleCase(change.reconciliationStatus)}</strong>
                          </div>
                          <div className="fact-row">
                            <span>Certificate Evidence</span>
                            <code>{change.certificateTerminalEvidenceId}</code>
                          </div>
                        </div>
                      ))
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ClaimAuditWorkspace() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Public statement → review draft → Chain Verify</span>
          <h1>Claim Audit</h1>
          <p>
            Compile tax, treasury, burn, liquidity, pension, and dividend announcements without
            treating promotional language as an on-chain result.
          </p>
        </div>
        <StatusPill status="HUMAN_REVIEW_REQUIRED" />
      </div>
      <ClaimDeclarationPanel />
      <ClaimBurnCandidateDiscoveryPanel />
      <ClaimBurnPromotionReplayPanel />
      <SupplyContinuityReplayPanel />
      <ClaimBurnConservationPanel />
    </>
  );
}

function ControlRightsWorkspace() {
  const [subjectAddress, setSubjectAddress] = useState(
    '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
  );
  const [blockNumber, setBlockNumber] = useState('');
  const [result, setResult] = useState<EvmControlSurfaceResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validAddress = /^0x[0-9a-fA-F]{40}$/.test(subjectAddress);
  const validBlock = blockNumber === '' || /^(0|[1-9]\d*)$/.test(blockNumber);

  async function load(mode: 'inspect' | 'replay') {
    if (!validAddress || !validBlock) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(
        mode === 'inspect'
          ? await api.inspectControlSurface(subjectAddress, blockNumber)
          : await api.latestControlSurface(subjectAddress),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Control surface request failed.');
    } finally {
      setBusy(false);
    }
  }

  const record = result?.record;
  const report = record?.report;
  const knownCoverage =
    report?.coverage.filter((item) => item.observed.state === 'known').length ?? 0;
  const coverageCount = report?.coverage.length ?? 0;
  const ownerIsZero =
    report?.ownerAddress.state === 'known' &&
    report.ownerAddress.value === '0x0000000000000000000000000000000000000000';

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Canonical Snapshot · Evidence · explicit Unknown</span>
          <h1>EVM Control Rights</h1>
          <p>
            Inspect standard proxy, owner, and registered Safe control paths without treating an
            unqueried role as absent. Reports are immutable and replay without provider access.
          </p>
        </div>
        <StatusPill status="READ_ONLY" />
      </div>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="control-inspect-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">BNB Smart Chain · eip155:56</span>
            <h3 id="control-inspect-heading">Control surface inspection</h3>
          </div>
          <span className="snapshot-badge">No signing or broadcast</span>
        </div>
        <form
          className="quote-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load('inspect');
          }}
        >
          <label htmlFor="control-subject">Contract address</label>
          <input
            id="control-subject"
            spellCheck={false}
            value={subjectAddress}
            onChange={(event) => setSubjectAddress(event.target.value.trim())}
            placeholder="0x…"
          />
          <label htmlFor="control-block">Finalized block (optional)</label>
          <input
            id="control-block"
            inputMode="numeric"
            spellCheck={false}
            value={blockNumber}
            onChange={(event) => setBlockNumber(event.target.value.trim())}
            placeholder="Leave empty for the common finalized head"
          />
          <div className="control-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={busy || !validAddress || !validBlock}
            >
              {busy ? 'Inspecting…' : 'Inspect and persist'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || !validAddress}
              onClick={() => void load('replay')}
            >
              Replay latest
            </button>
          </div>
        </form>
        <p className="quote-note">
          Current coverage: exact ERC-1167 runtime, EIP-1967 implementation/admin/beacon slots,
          ERC-173-shaped owner(), and allowlisted Safe owner/threshold state. Custom token roles and
          historical validity remain Unknown until separately proved.
        </p>
        {error === undefined ? null : <p className="inline-error">{error}</p>}
      </section>

      {record === undefined || report === undefined ? null : (
        <>
          <section className="panel" aria-labelledby="control-result-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Immutable report {record.id}</span>
                <h3 id="control-result-heading">Observed control surface</h3>
              </div>
              <StatusPill
                status={
                  report.sourceIndependence.state === 'known' &&
                  report.sourceIndependence.value === true
                    ? 'VERIFIED_INDEPENDENT'
                    : 'INCONCLUSIVE_SOURCE_INDEPENDENCE'
                }
              />
            </div>
            <div className="metric-grid compact-grid">
              <MetricTile
                label="Contract shape"
                value={
                  report.contractKind.state === 'known'
                    ? titleCase(String(report.contractKind.value))
                    : 'Unknown'
                }
                detail="Exact runtime and standard-slot classification"
                state={
                  report.contractKind.state === 'stale' ? 'unknown' : report.contractKind.state
                }
              />
              <MetricTile
                label="Direct rights"
                value={String(report.rights.length)}
                detail="Only rights with positive point-in-time Evidence"
                state="known"
              />
              <MetricTile
                label="Domain coverage"
                value={`${knownCoverage}/${coverageCount}`}
                detail={`${Math.round(report.metadata.dataCoverage * 100)}% usable point-in-time coverage`}
                state={knownCoverage === coverageCount ? 'known' : 'unknown'}
              />
              <MetricTile
                label="History coverage"
                value={`${Math.round(report.metadata.historyCoverage * 100)}%`}
                detail="No activation or revocation history inferred"
                state={report.metadata.historyCoverage === 1 ? 'known' : 'unknown'}
              />
            </div>
            <div className="fact-grid">
              <div className="fact-row">
                <span>Implementation</span>
                <KnowledgeDisplay data={report.implementationAddress} />
              </div>
              <div className="fact-row">
                <span>Proxy admin</span>
                <KnowledgeDisplay data={report.proxyAdminAddress} />
              </div>
              <div className="fact-row">
                <span>Beacon</span>
                <KnowledgeDisplay data={report.beaconAddress} />
              </div>
              <div className="fact-row">
                <span>owner()</span>
                <KnowledgeDisplay data={report.ownerAddress} />
              </div>
              <div className="fact-row">
                <span>Source agreement</span>
                <KnowledgeDisplay data={report.sourceAgreement} />
              </div>
              <div className="fact-row">
                <span>Source independence</span>
                <KnowledgeDisplay data={report.sourceIndependence} />
              </div>
            </div>
            {ownerIsZero ? (
              <div className="alert alert-warning">
                <strong>owner() returned the zero address</strong>
                <span>
                  No OWNER right is emitted. This does not prove mint, tax, blacklist, router,
                  treasury, LP, or other custom controls are absent.
                </span>
              </div>
            ) : null}
            <div className="snapshot-strip">
              <span>
                <b>Snapshot</b> {record.snapshotBlock}
              </span>
              <span>
                <b>Block hash</b> <code>{shortId(record.snapshotHash, 16)}</code>
              </span>
              <span>
                <b>Sources</b> {record.sourceSet.join(', ')}
              </span>
              <span>
                <b>Captured</b> {formatTime(record.capturedAt)}
              </span>
            </div>
          </section>

          <section className="panel" aria-labelledby="control-right-list-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Positive Evidence only</span>
                <h3 id="control-right-list-heading">Direct control rights</h3>
              </div>
              <span className="snapshot-badge">Point in time</span>
            </div>
            {report.rights.length === 0 ? (
              <div className="empty-state compact-empty">
                <strong>No direct right was positively established by this adapter set.</strong>
                <span>
                  Review the coverage table; this is not a proof that all control is absent.
                </span>
              </div>
            ) : (
              <div className="claim-draft-list">
                {report.rights.map((controlRight) => (
                  <article className="claim-draft-card" key={controlRight.id}>
                    <div className="claim-draft-heading">
                      <div>
                        <span className="eyebrow">{controlRight.id}</span>
                        <h4>{titleCase(controlRight.rightType)}</h4>
                      </div>
                      <KnowledgeDisplay data={controlRight.threshold} />
                    </div>
                    <div className="fact-grid">
                      <div className="fact-row">
                        <span>Controller</span>
                        <code>{controlRight.controller}</code>
                      </div>
                      <div className="fact-row">
                        <span>Scope</span>
                        <span>{controlRight.scope}</span>
                      </div>
                      <div className="fact-row">
                        <span>Active from</span>
                        <KnowledgeDisplay data={controlRight.activeFrom} />
                      </div>
                      <div className="fact-row">
                        <span>Active to</span>
                        <KnowledgeDisplay data={controlRight.activeTo} />
                      </div>
                    </div>
                    <p className="panel-copy">{controlRight.constraints.join(' ')}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="control-coverage-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Known false is not Unknown</span>
                <h3 id="control-coverage-heading">Coverage matrix</h3>
              </div>
              <code>{record.terminalEvidenceId}</code>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>State</th>
                    <th>Evidence</th>
                    <th>Interpretation</th>
                  </tr>
                </thead>
                <tbody>
                  {report.coverage.map((item) => (
                    <tr key={item.domain}>
                      <td>{titleCase(item.domain)}</td>
                      <td>
                        {item.observed.state === 'known' ? (
                          <StatusPill status={item.observed.value ? 'OBSERVED' : 'NOT_OBSERVED'} />
                        ) : (
                          <KnowledgeDisplay data={item.observed} />
                        )}
                      </td>
                      <td>{item.evidenceIds.length}</td>
                      <td>{item.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function ClaimReportPanel({ token }: { token: string }) {
  const [address, setAddress] = useState('');
  const [reportId, setReportId] = useState('');
  const [result, setResult] = useState<ClaimReportResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validAddress = /^0x[0-9a-fA-F]{40}$/.test(address);
  const validReportId = reportId === '' || /^ecr_[0-9a-f]{24}$/.test(reportId);

  async function replay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAddress || !validReportId) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(
        reportId === ''
          ? await api.latestClaimReport(token, address)
          : await api.claimReport(token, address, reportId),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Claim Report replay failed.');
    } finally {
      setBusy(false);
    }
  }

  const record = result?.record;
  const report = record?.report;
  return (
    <section className="panel subject-panel quote-panel" aria-labelledby="claim-report-heading">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Provider-free, immutable replay</span>
          <h3 id="claim-report-heading">Claim Report</h3>
        </div>
        <span className="snapshot-badge">Observed is not Actual</span>
      </div>
      <p className="panel-copy">
        Replay the latest or an exact persisted custody and token-flow observation. This view does
        not infer a dividend, burn, owner, or withdrawal right from a transfer alone.
      </p>
      <form className="quote-form" onSubmit={(event) => void replay(event)}>
        <label htmlFor="claim-subject-address">Claim wallet address</label>
        <input
          id="claim-subject-address"
          spellCheck={false}
          placeholder="0x…"
          value={address}
          onChange={(event) => setAddress(event.target.value.trim())}
        />
        <label htmlFor="claim-report-id">Exact report ID (optional)</label>
        <input
          id="claim-report-id"
          spellCheck={false}
          placeholder="Leave empty for latest"
          value={reportId}
          onChange={(event) => setReportId(event.target.value.trim().toLowerCase())}
        />
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !validAddress || !validReportId}
        >
          {busy ? 'Loading…' : reportId === '' ? 'Load latest report' : 'Replay exact report'}
        </button>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {record === undefined || report === undefined ? null : (
        <>
          <div className="metric-grid compact-grid">
            <MetricTile
              label="Custody"
              value={titleCase(report.custody.kind)}
              detail={
                report.custody.threshold === undefined
                  ? 'Authority shape at Snapshot'
                  : `${report.custody.threshold}-of-${report.custody.ownerCount ?? '?'} threshold`
              }
              state="known"
            />
            <MetricTile
              label="Observed inflow"
              value={report.flow.inflow.observedAmount}
              detail={`${report.flow.inflow.transferCount} transfers · atomic units`}
              state="known"
            />
            <MetricTile
              label="Observed outflow"
              value={report.flow.outflow.observedAmount}
              detail={`${report.flow.outflow.transferCount} transfers · atomic units`}
              state="known"
            />
            <MetricTile
              label="History coverage"
              value={`${Math.round(report.metadata.historyCoverage * 100)}%`}
              detail="Current custody is not historical authority"
              state={report.metadata.historyCoverage === 1 ? 'known' : 'unknown'}
            />
          </div>
          <div className="fact-grid">
            <div className="fact-row">
              <span>Funds movable</span>
              <KnowledgeDisplay data={report.custody.canMoveFunds} />
            </div>
            <div className="fact-row">
              <span>Actual inflow</span>
              <KnowledgeDisplay data={report.flow.inflow.actualAmount} />
            </div>
            <div className="fact-row">
              <span>Actual outflow</span>
              <KnowledgeDisplay data={report.flow.outflow.actualAmount} />
            </div>
            <div className="fact-row">
              <span>Source coverage</span>
              <span>{Math.round(report.metadata.sourceCoverage * 100)}%</span>
            </div>
            <div className="fact-row">
              <span>Share-unit adherence</span>
              {report.flow.shareUnitAssessment === null ? (
                <span className="knowledge-unknown">Not configured</span>
              ) : (
                <KnowledgeDisplay data={report.flow.shareUnitAssessment.exactMultipleCoverage} />
              )}
            </div>
            <div className="fact-row">
              <span>Exact one-unit deposits</span>
              <span>{report.flow.shareUnitAssessment?.exactUnitDeposits ?? 'Not configured'}</span>
            </div>
            <div className="fact-row">
              <span>Observed whole shares</span>
              <span>
                {report.flow.shareUnitAssessment?.observedWholeShares ?? 'Not configured'}
              </span>
            </div>
            <div className="fact-row">
              <span>Non-multiple deposits</span>
              <span>
                {report.flow.shareUnitAssessment?.nonMultipleDeposits ?? 'Not configured'}
              </span>
            </div>
          </div>
          <div className="snapshot-strip">
            <span>
              <b>Report</b> <code>{record.id}</code>
            </span>
            <span>
              <b>Snapshot</b> {record.snapshotBlock}
            </span>
            <span>
              <b>Window</b> {formatTime(report.window.from)} – {formatTime(report.window.to)}
            </span>
            <span>
              <b>Sources</b> {record.sourceSet.join(', ')}
            </span>
          </div>
          <details className="raw-details">
            <summary>Evidence root and replay identity</summary>
            <dl className="detail-grid">
              <div>
                <dt>Terminal Evidence</dt>
                <dd>
                  <code>{record.terminalEvidenceId}</code>
                </dd>
              </div>
              <div>
                <dt>Snapshot hash</dt>
                <dd>
                  <code>{record.snapshotHash}</code>
                </dd>
              </div>
              <div>
                <dt>Result hash</dt>
                <dd>
                  <code>{record.resultHash}</code>
                </dd>
              </div>
              <div>
                <dt>Captured</dt>
                <dd>{formatTime(record.capturedAt)}</dd>
              </div>
            </dl>
          </details>
          {report.flow.topCounterparties.length === 0 ? null : (
            <details className="raw-details">
              <summary>Observed top counterparties</summary>
              <div className="fact-grid">
                {report.flow.topCounterparties.map((item) => (
                  <div className="fact-row" key={`${item.direction}:${item.address}`}>
                    <span>
                      {item.direction} · {shortId(item.address)}
                    </span>
                    <span>
                      {item.observedAmount} ({item.transferCount})
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function FlapEventTransactionPanel({ token }: { token: string }) {
  const [transactionHash, setTransactionHash] = useState('');
  const [result, setResult] = useState<FlapEventTransactionResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [historyFromBlock, setHistoryFromBlock] = useState('');
  const [historyToBlock, setHistoryToBlock] = useState('');
  const [historyResult, setHistoryResult] = useState<FlapEventHistoryResponse>();
  const [historyError, setHistoryError] = useState<string>();
  const [historyBusy, setHistoryBusy] = useState(false);
  const [projectionScanId, setProjectionScanId] = useState('');
  const [projectionResult, setProjectionResult] = useState<FlapHistoryProjectionPageResponse>();
  const [projectionError, setProjectionError] = useState<string>();
  const [projectionBusy, setProjectionBusy] = useState(false);
  const [lifetimeScanId, setLifetimeScanId] = useState('');
  const [lifetimeResult, setLifetimeResult] = useState<FlapLifetimeMaterializationResponse>();
  const [lifetimeError, setLifetimeError] = useState<string>();
  const [lifetimeBusy, setLifetimeBusy] = useState(false);
  const [latestLifetimeHead, setLatestLifetimeHead] = useState<FlapLifetimeHeadResponse>();
  const [latestLifetimeError, setLatestLifetimeError] = useState<string>();
  const [latestLifetimeBusy, setLatestLifetimeBusy] = useState(false);
  const validTransactionHash = /^0x[0-9a-fA-F]{64}$/.test(transactionHash);
  const validHistoryRange = isValidBoundedBlockRange(historyFromBlock, historyToBlock);
  const validProjectionScanId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      projectionScanId,
    );
  const validLifetimeScanId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      lifetimeScanId,
    );

  async function inspectTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validTransactionHash) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.flapEventTransaction(token, transactionHash));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Flap event inspection failed.');
    } finally {
      setBusy(false);
    }
  }

  async function scanHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validHistoryRange) return;
    setHistoryBusy(true);
    setHistoryError(undefined);
    setHistoryResult(undefined);
    try {
      setHistoryResult(await api.flapEventHistory(token, historyFromBlock, historyToBlock));
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : 'Flap history scan failed.');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function loadProjection(afterBlock?: number) {
    if (!validProjectionScanId) return;
    setProjectionBusy(true);
    setProjectionError(undefined);
    if (afterBlock === undefined) setProjectionResult(undefined);
    try {
      setProjectionResult(await api.flapHistoryProjection(token, projectionScanId, afterBlock));
    } catch (cause) {
      setProjectionError(
        cause instanceof Error ? cause.message : 'Flap history projection replay failed.',
      );
    } finally {
      setProjectionBusy(false);
    }
  }

  function replayProjection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadProjection();
  }

  async function replayLifetime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validLifetimeScanId) return;
    setLifetimeBusy(true);
    setLifetimeError(undefined);
    setLifetimeResult(undefined);
    try {
      setLifetimeResult(await api.flapLifetimeMaterialization(token, lifetimeScanId));
    } catch (cause) {
      setLifetimeError(
        cause instanceof Error ? cause.message : 'Flap lifetime materialization replay failed.',
      );
    } finally {
      setLifetimeBusy(false);
    }
  }

  async function loadLatestLifetimeHead() {
    setLatestLifetimeBusy(true);
    setLatestLifetimeError(undefined);
    setLatestLifetimeHead(undefined);
    try {
      setLatestLifetimeHead(await api.flapLatestLifetimeHead(token));
    } catch (cause) {
      setLatestLifetimeError(
        cause instanceof Error ? cause.message : 'Latest Flap lifetime head replay failed.',
      );
    } finally {
      setLatestLifetimeBusy(false);
    }
  }

  const configurationRows: Array<[string, FlapConfigurationField]> =
    result?.configuration === null || result?.configuration === undefined
      ? []
      : [
          ['Curve address', result.configuration.curveAddress],
          ['Curve parameter', result.configuration.curveParameter],
          ['Virtual quote reserve', result.configuration.virtualQuoteReserve],
          ['Virtual base reserve', result.configuration.virtualBaseReserve],
          ['Virtual liquidity squared', result.configuration.virtualLiquiditySquared],
          ['DEX supply threshold', result.configuration.dexSupplyThreshold],
          ['Quote token', result.configuration.quoteTokenAddress],
          ['Migrator', result.configuration.migratorType],
          ['Token version', result.configuration.tokenVersion],
          ['Buy tax bps', result.configuration.buyTaxBps],
          ['Sell tax bps', result.configuration.sellTaxBps],
          ['DEX', result.configuration.dexId],
          ['LP fee profile', result.configuration.lpFeeProfile],
        ];
  const creationRows: Array<[string, string]> =
    result?.creation === null || result?.creation === undefined
      ? []
      : [
          ['Creator', result.creation.creator],
          ['Name', result.creation.name],
          ['Symbol', result.creation.symbol],
          ['Metadata URI', result.creation.metadataUri],
          ['Nonce', result.creation.nonce],
        ];

  return (
    <>
      <section className="panel subject-panel quote-panel event-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Exact receipt and Portal logs</span>
            <h3>Flap creation / migration transaction</h3>
          </div>
          <span className="snapshot-badge">Transaction-local</span>
        </div>
        <form className="quote-form" onSubmit={(event) => void inspectTransaction(event)}>
          <label htmlFor="flap-event-transaction">Creation or migration transaction hash</label>
          <input
            id="flap-event-transaction"
            placeholder="0x…"
            value={transactionHash}
            onChange={(event) => setTransactionHash(event.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={busy || !validTransactionHash}
          >
            {busy ? 'Decoding receipt…' : 'Inspect events'}
          </button>
        </form>
        <p className="quote-note">
          This decodes a supplied transaction at its exact block. It does not claim complete launch
          history until automatic chain-wide discovery has run.
        </p>
        {error === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Event inspection unavailable</strong>
            {error}
          </div>
        )}
        {result === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Classification</b> {titleCase(result.transactionKind)}
              </span>
              <span>
                <b>Platform match</b> <KnowledgeDisplay data={result.platformMatch} />
              </span>
              <span>
                <b>Events</b> {result.decodedEventNames.join(', ') || 'None supported'}
              </span>
              <span>
                <b>Unrecognized Portal logs</b> {result.unrecognizedPortalLogCount}
              </span>
              <span>
                <b>History coverage</b> {Math.round(result.metadata.historyCoverage * 100)}%
              </span>
            </div>
            {creationRows.length === 0 ? null : (
              <div className="fact-grid">
                {creationRows.map(([label, value]) => (
                  <div className="fact-row" key={label}>
                    <span>{label}</span>
                    <code>{shortId(value, 16)}</code>
                  </div>
                ))}
              </div>
            )}
            {configurationRows.length === 0 ? null : (
              <div className="fact-grid">
                {configurationRows.map(([label, field]) => (
                  <div className="fact-row" key={label}>
                    <span>
                      {label} <small>{titleCase(field.source)}</small>
                    </span>
                    <KnowledgeDisplay data={field.value} />
                  </div>
                ))}
              </div>
            )}
            {result.migration === null ? null : (
              <div className="fact-grid">
                <div className="fact-row">
                  <span>Launch pool</span>
                  <KnowledgeDisplay
                    data={
                      result.migration.launchedToDex === null
                        ? { state: 'unknown', reason: 'INSUFFICIENT_DATA' }
                        : { state: 'known', value: result.migration.launchedToDex.pool }
                    }
                  />
                </div>
                <div className="fact-row">
                  <span>Token amount</span>
                  <KnowledgeDisplay
                    data={
                      result.migration.launchedToDex === null
                        ? { state: 'unknown', reason: 'INSUFFICIENT_DATA' }
                        : { state: 'known', value: result.migration.launchedToDex.tokenAmount }
                    }
                  />
                </div>
                <div className="fact-row">
                  <span>Quote amount</span>
                  <KnowledgeDisplay
                    data={
                      result.migration.launchedToDex === null
                        ? { state: 'unknown', reason: 'INSUFFICIENT_DATA' }
                        : { state: 'known', value: result.migration.launchedToDex.quoteAmount }
                    }
                  />
                </div>
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel subject-panel event-history-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Chunked read-only Portal log scan</span>
            <h3>Flap bounded event history</h3>
          </div>
          <span className="snapshot-badge">Maximum 50,000 blocks</span>
        </div>
        <form className="history-range-form" onSubmit={(event) => void scanHistory(event)}>
          <label htmlFor="flap-history-from">
            <span>From block</span>
            <input
              id="flap-history-from"
              inputMode="numeric"
              value={historyFromBlock}
              onChange={(event) => setHistoryFromBlock(event.target.value.trim())}
              placeholder="Start block"
            />
          </label>
          <label htmlFor="flap-history-to">
            <span>To block</span>
            <input
              id="flap-history-to"
              inputMode="numeric"
              value={historyToBlock}
              onChange={(event) => setHistoryToBlock(event.target.value.trim())}
              placeholder="End block"
            />
          </label>
          <button
            className="secondary-button"
            type="submit"
            disabled={historyBusy || !validHistoryRange}
          >
            {historyBusy ? 'Scanning logs…' : 'Scan range'}
          </button>
        </form>
        <p className="quote-note">
          A completed bounded scan proves only the requested range. Token-lifetime coverage stays
          Unknown until deployment-origin indexing is continuous.
        </p>
        {historyError === undefined ? null : (
          <div className="alert alert-warning">
            <strong>History scan unavailable</strong>
            {historyError}
          </div>
        )}
        {historyResult === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Requested range</b> {historyResult.requestedRange.fromBlock}–
                {historyResult.requestedRange.toBlock}
              </span>
              <span>
                <b>Range coverage</b> {Math.round(historyResult.requestedRangeCoverage * 100)}%
              </span>
              <span>
                <b>Lifetime coverage</b> <KnowledgeDisplay data={historyResult.lifetimeCoverage} />
              </span>
              <span>
                <b>Transactions</b> {historyResult.chronology.length}
              </span>
              <span>
                <b>History coverage</b> {Math.round(historyResult.metadata.historyCoverage * 100)}%
              </span>
            </div>
            {historyResult.chronology.length === 0 ? (
              <div className="alert alert-warning">
                <strong>No matching event in this bounded range</strong>
                This is not a token-lifetime absence claim.
              </div>
            ) : (
              <div className="fact-grid">
                {historyResult.chronology.map((item) => (
                  <div className="fact-row" key={item.transactionHash}>
                    <span>
                      Block {item.blockNumber} · {titleCase(item.transactionKind)}
                    </span>
                    <code title={item.transactionHash}>{shortId(item.transactionHash, 10)}</code>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel subject-panel event-history-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Immutable segment replay</span>
            <h3>Flap durable history projection</h3>
          </div>
          <span className="snapshot-badge">Read-only · 10 segments/page</span>
        </div>
        <form className="quote-form" onSubmit={replayProjection}>
          <label htmlFor="flap-history-scan-id">Worker scan ID</label>
          <input
            id="flap-history-scan-id"
            placeholder="00000000-0000-4000-8000-000000000000"
            value={projectionScanId}
            onChange={(event) => setProjectionScanId(event.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={projectionBusy || !validProjectionScanId}
          >
            {projectionBusy ? 'Loading projection…' : 'Replay projection'}
          </button>
        </form>
        <p className="quote-note">
          Paste the scan ID emitted by <code>flap:history</code>. Pages replay immutable stored
          segments; this view does not trigger SQD/RPC scans or imply token-lifetime coverage.
        </p>
        {projectionError === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Projection replay unavailable</strong>
            {projectionError}
          </div>
        )}
        {projectionResult === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Status</b> {titleCase(projectionResult.scan.status)}
              </span>
              <span>
                <b>Requested range</b> {projectionResult.scan.requestedRange.fromBlock}–
                {projectionResult.scan.requestedRange.toBlock}
              </span>
              <span>
                <b>Range coverage</b>{' '}
                {Math.round(projectionResult.scan.requestedRangeCoverage * 100)}%
              </span>
              <span>
                <b>Next block</b> {projectionResult.scan.nextBlock}
              </span>
              <span>
                <b>Lifetime coverage</b>{' '}
                {projectionResult.scan.terminalResult === null ? (
                  <span className="knowledge-unknown">Not completed</span>
                ) : (
                  <KnowledgeDisplay data={projectionResult.scan.terminalResult.lifetimeCoverage} />
                )}
              </span>
            </div>
            {projectionResult.segments.length === 0 ? (
              <div className="alert alert-warning">
                <strong>No segments on this page</strong>
                The scan may not have advanced to this cursor.
              </div>
            ) : (
              <div className="fact-grid">
                {projectionResult.segments.map((segment) => (
                  <div className="fact-row" key={segment.id}>
                    <span>
                      Blocks {segment.fromBlock}–{segment.toBlock} · {segment.transactionCount}{' '}
                      transactions
                    </span>
                    <code title={segment.terminalEvidenceId}>
                      {shortId(segment.terminalEvidenceId, 10)}
                    </code>
                  </div>
                ))}
              </div>
            )}
            {projectionResult.page.hasMore && projectionResult.page.nextAfterBlock !== null ? (
              <div className="panel-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={projectionBusy}
                  onClick={() =>
                    void loadProjection(projectionResult.page.nextAfterBlock ?? undefined)
                  }
                >
                  {projectionBusy ? 'Loading…' : 'Next stored page'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
      <section className="panel subject-panel event-history-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Dataset start → origin → finalized target</span>
            <h3>Flap exact lifetime materialization</h3>
          </div>
          <span className="snapshot-badge">Provider-free replay</span>
        </div>
        <div className="history-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={latestLifetimeBusy}
            onClick={() => void loadLatestLifetimeHead()}
          >
            {latestLifetimeBusy ? 'Loading accepted head…' : 'Load latest accepted head'}
          </button>
        </div>
        <p className="quote-note">
          The accepted head is provider-free replay from the append-only scheduler chain. A missing
          head is Unknown, never zero lifetime coverage.
        </p>
        {latestLifetimeError === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Latest accepted head unavailable</strong>
            {latestLifetimeError}
          </div>
        )}
        {latestLifetimeHead === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Accepted sequence</b> {latestLifetimeHead.head.sequence}
              </span>
              <span>
                <b>Head type</b> {titleCase(latestLifetimeHead.head.headType)}
              </span>
              <span>
                <b>Finalized target</b> {latestLifetimeHead.head.targetBlock}
              </span>
              <span>
                <b>Lifetime coverage</b>{' '}
                <KnowledgeDisplay data={latestLifetimeHead.head.result.lifetimeCoverage} />
              </span>
            </div>
            <div className="fact-grid">
              <div className="fact-row">
                <span>Head / scan</span>
                <code title={`${latestLifetimeHead.head.id} / ${latestLifetimeHead.head.scanId}`}>
                  {shortId(latestLifetimeHead.head.id, 10)} ·{' '}
                  {shortId(latestLifetimeHead.head.scanId, 10)}
                </code>
              </div>
              <div className="fact-row">
                <span>Continuity</span>
                {latestLifetimeHead.head.result.continuity === undefined ? (
                  <code>Initial exact materialization</code>
                ) : (
                  <code>
                    {titleCase(latestLifetimeHead.head.result.continuity.status)} ·{' '}
                    {latestLifetimeHead.head.result.predecessor?.targetBlock} →{' '}
                    {latestLifetimeHead.head.result.targetBlock}
                  </code>
                )}
              </div>
              <div className="fact-row">
                <span>Evidence root</span>
                <code title={latestLifetimeHead.head.terminalEvidenceId}>
                  {shortId(latestLifetimeHead.head.terminalEvidenceId, 10)}
                </code>
              </div>
              <div className="fact-row">
                <span>Freshness</span>
                <code>{formatTime(latestLifetimeHead.head.result.metadata.freshness)}</code>
              </div>
            </div>
          </>
        )}
        <form className="quote-form" onSubmit={(event) => void replayLifetime(event)}>
          <label htmlFor="flap-lifetime-scan-id">Lifetime materialization scan ID</label>
          <input
            id="flap-lifetime-scan-id"
            placeholder="00000000-0000-4000-8000-000000000000"
            value={lifetimeScanId}
            onChange={(event) => setLifetimeScanId(event.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={lifetimeBusy || !validLifetimeScanId}
          >
            {lifetimeBusy ? 'Loading lifetime proof…' : 'Replay lifetime proof'}
          </button>
        </form>
        <p className="quote-note">
          Paste the scan ID emitted by <code>flap:lifetime</code>. Known lifetime coverage requires
          official SQD dataset-start coverage, one unique deployment origin, and complete supported
          Portal event history through the same finalized Snapshot. This view performs no chain
          reads.
        </p>
        {lifetimeError === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Lifetime replay unavailable</strong>
            {lifetimeError}
          </div>
        )}
        {lifetimeResult === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Status</b> {titleCase(lifetimeResult.scan.status)}
              </span>
              <span>
                <b>Dataset coverage</b> {lifetimeResult.scan.datasetStartBlock}–
                {lifetimeResult.scan.targetBlock}
              </span>
              <span>
                <b>Materialization coverage</b>{' '}
                {Math.round(lifetimeResult.scan.requestedRangeCoverage * 100)}%
              </span>
              <span>
                <b>Lifetime coverage</b>{' '}
                {lifetimeResult.scan.terminalResult === null ? (
                  <span className="knowledge-unknown">Not completed</span>
                ) : (
                  <KnowledgeDisplay data={lifetimeResult.scan.terminalResult.lifetimeCoverage} />
                )}
              </span>
            </div>
            {lifetimeResult.scan.terminalResult === null ? (
              <div className="alert alert-warning">
                <strong>Composite checkpoint is still running</strong>
                No terminal lifetime conclusion is available yet; this is not zero coverage.
              </div>
            ) : (
              <div className="fact-grid">
                <div className="fact-row">
                  <span>Deployment origin</span>
                  {lifetimeResult.scan.terminalResult.origin.state === 'known' ? (
                    <code>
                      Block{' '}
                      {lifetimeResult.scan.terminalResult.origin.value?.creationTrace.blockNumber}
                    </code>
                  ) : (
                    <KnowledgeDisplay data={lifetimeResult.scan.terminalResult.origin} />
                  )}
                </div>
                <div className="fact-row">
                  <span>Origin scan</span>
                  <code title={lifetimeResult.scan.terminalResult.originScanId}>
                    {shortId(lifetimeResult.scan.terminalResult.originScanId, 10)}
                  </code>
                </div>
                <div className="fact-row">
                  <span>History projection</span>
                  {lifetimeResult.scan.terminalResult.historyProjection === null ? (
                    <span className="knowledge-unknown">Unknown · no unique origin</span>
                  ) : (
                    <code title={lifetimeResult.scan.terminalResult.historyProjection.scanId}>
                      {lifetimeResult.scan.terminalResult.historyProjection.segmentCount} segments ·{' '}
                      {lifetimeResult.scan.terminalResult.historyProjection.transactionCount}{' '}
                      transactions
                    </code>
                  )}
                </div>
                <div className="fact-row">
                  <span>Evidence confidence</span>
                  <code>
                    {Math.round(lifetimeResult.scan.terminalResult.metadata.confidence * 100)}%
                  </code>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {result === undefined || result.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={result.evidence}
          eyebrow="Receipt → Portal event → normalized fact"
          title="Flap transaction evidence ledger"
        />
      )}
      {historyResult === undefined || historyResult.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={historyResult.evidence}
          eyebrow="Bounded Portal logs → receipt-replayed chronology"
          title="Flap history evidence ledger"
        />
      )}
      {lifetimeResult?.scan.terminalResult === null ||
      lifetimeResult?.scan.terminalResult === undefined ||
      lifetimeResult.scan.terminalResult.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={lifetimeResult.scan.terminalResult.evidence}
          eyebrow="SQD dataset metadata → origin proof → history projection"
          title="Flap lifetime Evidence root"
        />
      )}
      {latestLifetimeHead === undefined ||
      latestLifetimeHead.head.result.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={latestLifetimeHead.head.result.evidence}
          eyebrow="Accepted predecessor → continuity proof → delta projection"
          title="Latest Flap lifetime head Evidence root"
        />
      )}
    </>
  );
}

function FlapPancakeV2ReconciliationPanel({ token }: { token: string }) {
  const [quoteAmounts, setQuoteAmounts] = useState('100, 1000, 10000');
  const [tokenAmounts, setTokenAmounts] = useState('1000000, 5000000, 10000000');
  const [result, setResult] = useState<FlapPancakeV2ReconciliationResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const parseAmounts = (value: string) =>
    value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  const quoteInputs = parseAmounts(quoteAmounts);
  const tokenInputs = parseAmounts(tokenAmounts);
  const validAmountList = (values: readonly string[]) =>
    values.length >= 1 &&
    values.length <= 8 &&
    new Set(values).size === values.length &&
    values.every(
      (value) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value),
    );
  const inputsValid = validAmountList(quoteInputs) && validAmountList(tokenInputs);

  async function runReconciliation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inputsValid) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.flapPancakeV2Reconciliation(token, quoteInputs, tokenInputs));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Multi-source reconciliation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="flap-reconciliation-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">Common finalized block + documented operators</span>
            <h3 id="flap-reconciliation-heading">Independent market and RV reconciliation</h3>
          </div>
          <span className="snapshot-badge">Exact state · quote budget 0.5%</span>
        </div>
        <p className="panel-copy">
          Re-read the complete Pancake V2 market, buy quotes and exit quotes through every
          configured BSC source at one finalized block. Different hostnames count as independent
          only when official endpoint documents identify different operators.
        </p>
        <form
          className="quote-form reconciliation-form"
          onSubmit={(event) => void runReconciliation(event)}
        >
          <div className="claim-burn-field">
            <label htmlFor="flap-reconciliation-quote-amounts">Quote-asset buy amounts</label>
            <input
              id="flap-reconciliation-quote-amounts"
              inputMode="decimal"
              value={quoteAmounts}
              onChange={(event) => setQuoteAmounts(event.target.value)}
            />
          </div>
          <div className="claim-burn-field">
            <label htmlFor="flap-reconciliation-token-amounts">Token exit amounts</label>
            <input
              id="flap-reconciliation-token-amounts"
              inputMode="decimal"
              value={tokenAmounts}
              onChange={(event) => setTokenAmounts(event.target.value)}
            />
          </div>
          <button className="secondary-button" type="submit" disabled={busy || !inputsValid}>
            {busy ? 'Reconciling sources…' : 'Run independent check'}
          </button>
        </form>
        <p className="quote-note">
          This is read-only RPC replay. It never approves, signs, swaps, transfers, or broadcasts.
        </p>
        {error === undefined ? null : (
          <div className="alert alert-warning reconciliation-alert">
            <strong>Reconciliation unavailable</strong>
            {error}
          </div>
        )}
        {result === undefined ? null : (
          <>
            <div className="fact-grid quote-facts">
              <div className="fact-row">
                <span>Terminal status</span>
                <StatusPill status={result.status} />
              </div>
              <div className="fact-row">
                <span>Finalized block</span>
                <strong>{result.blockNumber}</strong>
              </div>
              <div className="fact-row">
                <span>Operator independence</span>
                <StatusPill status={result.sourceIndependence.status} />
              </div>
              <div className="fact-row">
                <span>Independence value</span>
                <KnowledgeDisplay data={result.sourceIndependence.independence} />
              </div>
              <div className="fact-row">
                <span>Operators / required</span>
                <strong>
                  {result.sourceIndependence.operatorCount} /{' '}
                  {result.sourceIndependence.requiredOperators}
                </strong>
              </div>
              <div className="fact-row">
                <span>Checks</span>
                <strong>
                  {result.audit.summary.passed} pass · {result.audit.summary.failed} fail ·{' '}
                  {result.audit.summary.inconclusive} inconclusive
                </strong>
              </div>
            </div>
            {result.status === 'PASS' ? null : (
              <div
                className={`alert ${result.status === 'FAIL' ? 'alert-error' : 'alert-warning'} reconciliation-alert`}
              >
                <strong>{titleCase(result.status)}</strong>
                {result.status === 'FAIL'
                  ? 'At least one exact state or bounded quote comparison exceeded its allowed error.'
                  : 'The result is not a verified agreement. Unknown source ownership or incomplete coverage is not converted to a pass.'}
              </div>
            )}
            <div className="table-scroll reconciliation-table">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Documented operator</th>
                    <th>Buy checks</th>
                    <th>Exit checks</th>
                    <th>Pool</th>
                    <th>Spot price</th>
                  </tr>
                </thead>
                <tbody>
                  {result.sources.map((source) => {
                    const market =
                      source.buy.market.state === 'known' ? source.buy.market.value : undefined;
                    return (
                      <tr key={source.sourceId}>
                        <td>
                          <code>{source.sourceId}</code>
                        </td>
                        <td>
                          <KnowledgeDisplay data={source.operatorId} />
                        </td>
                        <td>
                          <StatusPill status={source.buy.validation.status} />
                        </td>
                        <td>
                          <StatusPill status={source.sell.validation.status} />
                        </td>
                        <td>{market === undefined ? 'Unknown' : shortId(market.pool)}</td>
                        <td>{market === undefined ? 'Unknown' : market.currentSpotPrice}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="raw-details" open={result.status !== 'PASS'}>
              <summary>
                Comparison ledger ({result.audit.summary.total} checks; exact fields require zero
                error)
              </summary>
              <div className="table-scroll reconciliation-table">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Class</th>
                      <th>Result</th>
                      <th>Actual</th>
                      <th>Reference</th>
                      <th>Error</th>
                      <th>Pass budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.audit.checks.map((check) => (
                      <tr key={check.id}>
                        <td>
                          <code>{check.fieldPath}</code>
                        </td>
                        <td>{titleCase(check.comparisonClass)}</td>
                        <td>
                          <StatusPill status={check.disposition} />
                        </td>
                        <td>
                          <KnowledgeDisplay data={check.actual} />
                        </td>
                        <td>
                          <KnowledgeDisplay data={check.reference} />
                        </td>
                        <td>
                          <KnowledgeDisplay data={check.relativeErrorPct} />
                        </td>
                        <td>
                          <KnowledgeDisplay data={check.passThresholdPct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <div className="snapshot-strip">
              <span>
                <b>Block hash</b> {shortId(result.blockHash)}
              </span>
              <span>
                <b>Registry Evidence</b> {shortId(result.sourceIndependence.registryEvidenceId)}
              </span>
              <span>
                <b>Independence Evidence</b> {shortId(result.sourceIndependence.terminalEvidenceId)}
              </span>
              <span>
                <b>Terminal Evidence</b> {shortId(result.terminalEvidenceId)}
              </span>
            </div>
          </>
        )}
      </section>
      {result === undefined ? null : (
        <EvidencePanel
          evidence={result.evidence}
          eyebrow="Finalized anchors → official operator attestations → market and RV comparisons"
          title="Multi-source reconciliation Evidence"
        />
      )}
    </>
  );
}

function FlapPancakeV2BuyScenarioPanel({
  token,
  blockNumber,
}: {
  token: string;
  blockNumber: string;
}) {
  const [amounts, setAmounts] = useState('100, 1000, 10000');
  const [result, setResult] = useState<FlapPancakeV2BuyScenarioResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const parsedInputs = amounts
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const inputsValid =
    parsedInputs.length >= 1 &&
    parsedInputs.length <= 8 &&
    new Set(parsedInputs).size === parsedInputs.length &&
    parsedInputs.every(
      (value) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value),
    );

  async function runScenarios(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inputsValid) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.flapPancakeV2BuyScenarios(token, parsedInputs, blockNumber));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pancake V2 scenario query failed.');
    } finally {
      setBusy(false);
    }
  }

  const market = result?.market.state === 'known' ? result.market.value : undefined;
  return (
    <>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="flap-buy-scenarios-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">Official router quote + deterministic pool check</span>
            <h3 id="flap-buy-scenarios-heading">Pancake V2 buy-size scenarios</h3>
          </div>
          <span className="snapshot-badge">Read-only, same Snapshot</span>
        </div>
        <p className="panel-copy">
          Compare one to eight quote-asset buy sizes. Gross output comes from the official V2
          router; the pool formula must stay inside the 0.1% deterministic error budget.
        </p>
        <form className="quote-form" onSubmit={(event) => void runScenarios(event)}>
          <label htmlFor="flap-buy-scenario-amounts">Quote amounts (comma separated)</label>
          <input
            id="flap-buy-scenario-amounts"
            inputMode="decimal"
            placeholder="100, 1000, 10000"
            value={amounts}
            onChange={(event) => setAmounts(event.target.value)}
          />
          <button className="secondary-button" type="submit" disabled={busy || !inputsValid}>
            {busy ? 'Reading pool…' : 'Run buy scenarios'}
          </button>
        </form>
        <p className="quote-note">
          Actual wallet receipt remains Unknown until a pinned-fork swap reproduces token tax and
          swapback behavior. No approval, signing, transaction, or broadcast is performed.
        </p>
        {error === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Buy scenarios unavailable</strong>
            {error}
          </div>
        )}
        {result === undefined ? null : market === undefined ? (
          <div className="alert alert-warning">
            <strong>DEX market unavailable</strong>
            <KnowledgeDisplay data={result.market} />
          </div>
        ) : (
          <>
            <div className="fact-grid quote-facts">
              <div className="fact-row">
                <span>Venue</span>
                <strong>{market.venue}</strong>
              </div>
              <div className="fact-row">
                <span>Current spot price</span>
                <strong>{market.currentSpotPrice}</strong>
              </div>
              <div className="fact-row">
                <span>Quote reserve</span>
                <strong>{market.quoteReserve.decimal}</strong>
              </div>
              <div className="fact-row">
                <span>Token reserve</span>
                <strong>{market.tokenReserve.decimal}</strong>
              </div>
              <div className="fact-row">
                <span>DEX fee bps</span>
                <strong>{market.dexFeeBps}</strong>
              </div>
              <div className="fact-row">
                <span>Configured buy tax bps</span>
                <KnowledgeDisplay data={market.configuredBuyTaxBps} />
              </div>
              <div className="fact-row">
                <span>Automatic quote check</span>
                <StatusPill
                  status={`${result.validation.status} · ${result.validation.failedScenarioCount} failed`}
                />
              </div>
            </div>
            <div className="table-scroll scenario-table">
              <table>
                <thead>
                  <tr>
                    <th>Quote in</th>
                    <th>Router gross token</th>
                    <th>Configured-tax estimate</th>
                    <th>Execution net</th>
                    <th>Average estimate</th>
                    <th>Post-buy spot</th>
                    <th>Price move</th>
                    <th>Quote check</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scenarios.map((scenario) => (
                    <tr key={scenario.quoteInput.atomic}>
                      <td>{scenario.quoteInput.decimal}</td>
                      <td>{scenario.officialRouterGrossTokenOutput.decimal}</td>
                      <td>
                        <TokenAmountKnowledge data={scenario.configuredTaxNetTokenOutput} />
                      </td>
                      <td>
                        <TokenAmountKnowledge data={scenario.executionNetTokenOutput} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.averageConfiguredTaxBuyPrice} />
                      </td>
                      <td>{scenario.modeledPostBuySpotPrice}</td>
                      <td>{scenario.modeledPriceChangeBps} bps</td>
                      <td>
                        <StatusPill
                          status={
                            scenario.withinDeterministicTolerance
                              ? `PASS ${scenario.deterministicQuoteErrorBps} BPS`
                              : `FAIL ${scenario.deterministicQuoteErrorBps} BPS`
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="alert alert-warning pension-boundary">
              <strong>Pension-wallet boundary</strong>
              {result.pensionSinkTreatment.detail ??
                'A wallet transfer is not treated as a supply burn or irreversible sink.'}
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Pool</b> {shortId(market.pool)}
              </span>
              <span>
                <b>Block</b> {String(result.metadata.snapshot?.blockNumber ?? 'Unknown')}
              </span>
              <span>
                <b>Terminal Evidence</b> {shortId(result.terminalEvidenceId ?? 'Unavailable')}
              </span>
            </div>
          </>
        )}
      </section>
      {result === undefined || result.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={result.evidence}
          eyebrow="Pool identity → reserves → official router → deterministic check"
          title="Pancake V2 scenario Evidence"
        />
      )}
    </>
  );
}

function FlapPancakeV2SellScenarioPanel({
  token,
  blockNumber,
}: {
  token: string;
  blockNumber: string;
}) {
  const [amounts, setAmounts] = useState('1000000, 5000000, 10000000');
  const [result, setResult] = useState<FlapPancakeV2SellScenarioResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const parsedInputs = amounts
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const inputsValid =
    parsedInputs.length >= 1 &&
    parsedInputs.length <= 8 &&
    new Set(parsedInputs).size === parsedInputs.length &&
    parsedInputs.every(
      (value) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value),
    );

  async function runScenarios(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inputsValid) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.flapPancakeV2SellScenarios(token, parsedInputs, blockNumber));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pancake V2 sell scenario query failed.');
    } finally {
      setBusy(false);
    }
  }

  const market = result?.market.state === 'known' ? result.market.value : undefined;
  return (
    <>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="flap-sell-scenarios-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">Nominal value ≠ configured estimate ≠ execution RV</span>
            <h3 id="flap-sell-scenarios-heading">Pancake V2 exit-size scenarios</h3>
          </div>
          <span className="snapshot-badge">Read-only, same Snapshot</span>
        </div>
        <p className="panel-copy">
          Compare token exit sizes against shared quote reserves. The official Router gross quote is
          checked independently; configured sell tax is an estimate until fork execution measures
          the settlement balance delta.
        </p>
        <form className="quote-form" onSubmit={(event) => void runScenarios(event)}>
          <label htmlFor="flap-sell-scenario-amounts">Token amounts (comma separated)</label>
          <input
            id="flap-sell-scenario-amounts"
            inputMode="decimal"
            placeholder="1000000, 5000000, 10000000"
            value={amounts}
            onChange={(event) => setAmounts(event.target.value)}
          />
          <button className="secondary-button" type="submit" disabled={busy || !inputsValid}>
            {busy ? 'Reading exit route…' : 'Run exit scenarios'}
          </button>
        </form>
        <p className="quote-note">
          No approval, token transfer, swap, signing, or broadcast occurs. Max-sell, blacklist,
          dynamic tax, swapback, gas and revert behavior remain Unknown without a pinned fork.
        </p>
        {error === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Exit scenarios unavailable</strong>
            {error}
          </div>
        )}
        {result === undefined ? null : market === undefined ? (
          <div className="alert alert-warning">
            <strong>DEX market unavailable</strong>
            <KnowledgeDisplay data={result.market} />
          </div>
        ) : (
          <>
            <div className="fact-grid quote-facts">
              <div className="fact-row">
                <span>Current spot price</span>
                <strong>{market.currentSpotPrice}</strong>
              </div>
              <div className="fact-row">
                <span>Quote reserve</span>
                <strong>{market.quoteReserve.decimal}</strong>
              </div>
              <div className="fact-row">
                <span>Configured sell tax bps</span>
                <KnowledgeDisplay data={market.configuredSellTaxBps} />
              </div>
              <div className="fact-row">
                <span>Automatic quote check</span>
                <StatusPill
                  status={`${result.validation.status} · ${result.validation.failedScenarioCount} failed`}
                />
              </div>
            </div>
            <div className="table-scroll scenario-table">
              <table>
                <thead>
                  <tr>
                    <th>Token in</th>
                    <th>Nominal at spot</th>
                    <th>Router gross quote</th>
                    <th>Configured-tax quote</th>
                    <th>Execution net</th>
                    <th>Average tax exit</th>
                    <th>Post-sell spot</th>
                    <th>Total exit haircut</th>
                    <th>Quote reserve used</th>
                    <th>Quote check</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scenarios.map((scenario) => (
                    <tr key={scenario.tokenInput.atomic}>
                      <td>{scenario.tokenInput.decimal}</td>
                      <td>{scenario.nominalSpotQuoteValue.decimal}</td>
                      <td>{scenario.officialRouterGrossQuoteOutput.decimal}</td>
                      <td>
                        <TokenAmountKnowledge data={scenario.configuredTaxNetQuoteOutput} />
                      </td>
                      <td>
                        <TokenAmountKnowledge data={scenario.executionNetQuoteOutput} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.averageConfiguredTaxExitPrice} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.modeledConfiguredTaxPostSellSpotPrice} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.configuredTotalExitHaircutBps} /> bps
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.configuredTaxQuoteReserveConsumedBps} />{' '}
                        bps
                      </td>
                      <td>
                        <StatusPill
                          status={
                            scenario.withinDeterministicTolerance
                              ? `PASS ${scenario.deterministicQuoteErrorBps} BPS`
                              : `FAIL ${scenario.deterministicQuoteErrorBps} BPS`
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="alert alert-warning pension-boundary">
              <strong>Execution capacity remains Unknown</strong>
              {result.executionCapacity.detail ??
                'Pool math alone cannot prove that the token can execute this exit.'}
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Pool</b> {shortId(market.pool)}
              </span>
              <span>
                <b>Block</b> {String(result.metadata.snapshot?.blockNumber ?? 'Unknown')}
              </span>
              <span>
                <b>Terminal Evidence</b> {shortId(result.terminalEvidenceId ?? 'Unavailable')}
              </span>
            </div>
          </>
        )}
      </section>
      {result === undefined || result.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={result.evidence}
          eyebrow="Certified market → gross Router quote → tax estimate → execution Unknown"
          title="Pancake V2 exit Evidence"
        />
      )}
    </>
  );
}

function FlapLaunchPanel({ inspection }: { inspection: FlapInspectionResponse }) {
  const launch = inspection.launch;
  const [sellAmount, setSellAmount] = useState('');
  const [sellQuote, setSellQuote] = useState<FlapSellQuoteResponse>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteBusy, setQuoteBusy] = useState(false);
  const quoteOnlyEvidence =
    sellQuote?.evidence.filter(
      (item) => !inspection.evidence.some((inspectionItem) => inspectionItem.id === item.id),
    ) ?? [];

  async function previewSell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (launch === null || !/^(?:0|[1-9]\d*)$/.test(sellAmount)) return;
    setQuoteBusy(true);
    setQuoteError(undefined);
    setSellQuote(undefined);
    try {
      setSellQuote(await api.flapSellQuote(inspection.token, sellAmount, launch.sourceBlockOrSlot));
    } catch (error) {
      setQuoteError(error instanceof Error ? error.message : 'Flap sell preview failed.');
    } finally {
      setQuoteBusy(false);
    }
  }

  return (
    <>
      <section className="panel subject-panel launch-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Versioned BSC Portal inspection</span>
            <h3>Flap launch mechanism</h3>
          </div>
          <StatusPill
            status={
              inspection.platformMatch.state === 'known' && inspection.platformMatch.value
                ? (launch?.lifecycle ?? 'MATCHED')
                : (inspection.platformMatch.reason ?? inspection.platformMatch.state)
            }
          />
        </div>
        {launch === null ? (
          <div className="alert alert-warning">
            <strong>No evidenced Flap launch</strong>
            <KnowledgeDisplay data={inspection.platformMatch} />
          </div>
        ) : (
          <>
            <div className="fact-grid">
              {[
                ['Platform match', inspection.platformMatch],
                ['Platform version', launch.platformVersion],
                ['Portal', launch.factoryOrProgram],
                ['Quote asset', launch.quoteAsset],
                ['Spot price', launch.spotPrice],
                ['Curve type', launch.curveType],
                ['Real quote reserve', launch.realQuoteReserve],
                ['Virtual base reserve', launch.virtualBaseReserve],
                ['Virtual quote reserve', launch.virtualQuoteReserve],
                ['Circulating supply', launch.circulatingSupply],
                ['Remaining supply', launch.remainingSupply],
                ['Progress', launch.progress],
                ['Graduation threshold', launch.graduationThreshold],
                ['Current sell capacity', launch.currentSellCapacity],
                ['Tax model', launch.taxModel],
                ['Buy tax bps', launch.buyTaxBps],
                ['Sell tax bps', launch.sellTaxBps],
                ['Migration pool', launch.migrationPool],
                ['LP locked', launch.lpLocked],
                ['LP burned', launch.lpBurned],
              ].map(([label, value]) => (
                <div className="fact-row" key={label as string}>
                  <span>{label as string}</span>
                  <KnowledgeDisplay data={value as KnowledgeValue<unknown>} />
                </div>
              ))}
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Snapshot block</b> {launch.sourceBlockOrSlot}
              </span>
              <span>
                <b>Decoder</b> {launch.sourceVersion}
              </span>
              <span>
                <b>Confidence</b> {Math.round(inspection.metadata.confidence * 100)}%
              </span>
            </div>
            <details className="raw-details">
              <summary>View Flap replay metadata</summary>
              <pre>{JSON.stringify(inspection.metadata.snapshot, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
      <FlapEventTransactionPanel token={inspection.token} />
      <ClaimDeclarationPanel token={inspection.token} />
      <ClaimReportPanel token={inspection.token} />
      {launch?.lifecycle === 'DEX_TRADING' ? (
        <>
          <FlapPancakeV2ReconciliationPanel token={inspection.token} />
          <FlapPancakeV2BuyScenarioPanel
            token={inspection.token}
            blockNumber={launch.sourceBlockOrSlot}
          />
          <FlapPancakeV2SellScenarioPanel
            token={inspection.token}
            blockNumber={launch.sourceBlockOrSlot}
          />
        </>
      ) : null}
      {launch?.lifecycle !== 'PRIMARY_MARKET' ? null : (
        <section className="panel subject-panel quote-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Read-only eth_call at the same Snapshot</span>
              <h3>Flap realizable sell preview</h3>
            </div>
            <span className="snapshot-badge">No signing or broadcast</span>
          </div>
          <form className="quote-form" onSubmit={(event) => void previewSell(event)}>
            <label htmlFor="flap-sell-amount">Sell amount (atomic units)</label>
            <input
              id="flap-sell-amount"
              inputMode="numeric"
              pattern="(?:0|[1-9][0-9]*)"
              placeholder="Enter a token amount"
              value={sellAmount}
              onChange={(event) => setSellAmount(event.target.value.trim())}
            />
            <button
              className="secondary-button"
              type="submit"
              disabled={quoteBusy || !/^(?:0|[1-9]\d*)$/.test(sellAmount)}
            >
              {quoteBusy ? 'Reading Portal…' : 'Preview sell'}
            </button>
          </form>
          <p className="quote-note">
            The amount and returned proceeds stay in atomic units until token and quote decimals are
            separately evidenced.
          </p>
          {quoteError === undefined ? null : (
            <div className="alert alert-warning">
              <strong>Sell preview unavailable</strong>
              {quoteError}
            </div>
          )}
          {sellQuote === undefined ? null : (
            <>
              <div className="fact-grid quote-facts">
                {[
                  ['Input quantity', { state: 'known', value: sellQuote.quote.inputQuantity }],
                  ['Quote asset', sellQuote.quoteAsset],
                  ['Realizable value', sellQuote.quote.realizableValue],
                  ['Nominal value', sellQuote.quote.nominalValue],
                  ['Average exit price', sellQuote.quote.averageExitPrice],
                  ['Price impact bps', sellQuote.quote.priceImpactBps],
                  ['Total fee bps', sellQuote.quote.totalFeeBps],
                ].map(([label, value]) => (
                  <div className="fact-row" key={label as string}>
                    <span>{label as string}</span>
                    <KnowledgeDisplay data={value as KnowledgeValue<unknown>} />
                  </div>
                ))}
              </div>
              <div className="snapshot-strip">
                <span>
                  <b>Route</b> {sellQuote.quote.route.join(' → ') || 'Unavailable'}
                </span>
                <span>
                  <b>Model</b> {sellQuote.quote.metadata.modelVersion}
                </span>
              </div>
            </>
          )}
        </section>
      )}
      {inspection.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={inspection.evidence}
          eyebrow="Portal state → normalized mechanism"
          title="Flap evidence ledger"
        />
      )}
      {quoteOnlyEvidence.length === 0 ? null : (
        <EvidencePanel
          evidence={quoteOnlyEvidence}
          eyebrow="Requested amount → Portal previewSell"
          title="Sell quote evidence ledger"
        />
      )}
    </>
  );
}

function SearchWorkspace({
  result,
  subject,
  launchInspection,
  launchError,
  busy,
  error,
  onSearch,
  onInspect,
}: {
  result?: SearchResponse | undefined;
  subject?: SubjectResponse | undefined;
  launchInspection?: FlapInspectionResponse | undefined;
  launchError?: string | undefined;
  busy: boolean;
  error?: string | undefined;
  onSearch: (query: string, network: string) => Promise<void>;
  onInspect: (candidate: SubjectCandidate) => Promise<void>;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Global Intelligence Search</span>
          <h1>Trace an on-chain subject</h1>
          <p>
            Checksum and structure classification happens locally; address, transaction, block, and
            Bitcoin outpoint inspection uses configured read-only providers.
          </p>
        </div>
      </div>
      <SearchBox onSearch={onSearch} busy={busy} />
      {error === undefined ? null : (
        <div className="alert alert-error">
          <strong>Query failed</strong>
          {error}
        </div>
      )}
      {result === undefined ? (
        <section className="empty-state">
          <span>⌁</span>
          <h2>No ledger record loaded</h2>
          <p>Choose a network for an EVM identifier so the resulting snapshot is chain-specific.</p>
        </section>
      ) : (
        <section className="search-results">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Classification</span>
              <h2>
                {result.candidates.length} candidate{result.candidates.length === 1 ? '' : 's'}
              </h2>
            </div>
            <span className="freshness">
              Confidence {Math.round(result.metadata.confidence * 100)}%
            </span>
          </div>
          {result.rejectedReason === undefined ? null : (
            <div className="alert alert-warning">{result.rejectedReason}</div>
          )}
          <div className="candidate-grid">
            {result.candidates.map((candidate) => {
              const supportedType = ['ADDRESS', 'TRANSACTION', 'BLOCK', 'OUTPOINT'].includes(
                candidate.type,
              );
              const inspectable =
                supportedType &&
                (candidate.ledger !== 'EVM' || candidate.chainId !== 'eip155:unknown');
              return (
                <article
                  className="candidate-card"
                  key={candidate.ledger + candidate.type + candidate.normalizedId}
                >
                  <div className="candidate-top">
                    <span className={'chain-tag chain-' + candidate.ledger.toLowerCase()}>
                      {candidate.ledger}
                    </span>
                    <StatusPill status={candidate.validation} />
                  </div>
                  <strong>{candidate.type}</strong>
                  <code title={candidate.normalizedId}>{shortId(candidate.normalizedId, 14)}</code>
                  <div className="confidence-bar">
                    <span style={{ width: Math.round(candidate.confidence * 100) + '%' }} />
                  </div>
                  <div className="candidate-foot">
                    <span>{candidate.chainId}</span>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!inspectable || busy}
                      onClick={() => void onInspect(candidate)}
                      title={
                        inspectable
                          ? 'Query a snapshot-bound read-only record'
                          : 'Choose an explicit network before inspection'
                      }
                    >
                      Inspect
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {subject === undefined ? null : (
        <>
          <section className="panel subject-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Snapshot-bound ledger record</span>
                <h3>{shortId(subject.subject.normalizedId, 18)}</h3>
              </div>
              <span className="snapshot-badge">
                Coverage {Math.round(subject.metadata.dataCoverage * 100)}%
              </span>
            </div>
            <div className="fact-grid">
              {Object.entries(subject.facts).map(([label, value]) => (
                <div className="fact-row" key={label}>
                  <span>{titleCase(label)}</span>
                  <KnowledgeDisplay data={value} />
                </div>
              ))}
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Model</b> {subject.metadata.modelVersion}
              </span>
              <span>
                <b>Freshness</b> {formatTime(subject.metadata.freshness)}
              </span>
              <span>
                <b>Sources</b> {subject.metadata.sourceSet.join(', ') || 'None'}
              </span>
            </div>
            <details className="raw-details">
              <summary>View replay metadata</summary>
              <pre>{JSON.stringify(subject.metadata.snapshot, null, 2)}</pre>
            </details>
          </section>
          <EvidencePanel evidence={subject.evidence ?? []} />
        </>
      )}
      {launchError === undefined ? null : (
        <div className="alert alert-warning">
          <strong>Flap inspection unavailable</strong>
          {launchError}
        </div>
      )}
      {launchInspection === undefined ? null : <FlapLaunchPanel inspection={launchInspection} />}
    </>
  );
}

function ScenarioLab() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Deterministic simulation</span>
          <h1>Shared-liquidity Exit Race</h1>
          <p>
            Compare sequential exits against one changing pool state. Independent RV quotes are
            never summed.
          </p>
        </div>
        <StatusPill status="SNAPSHOT_REQUIRED" />
      </div>
      <section className="scenario-layout">
        <article className="panel scenario-gate">
          <div className="gate-icon">⛓</div>
          <h2>Analysis gate is closed</h2>
          <p>
            A scenario may run only after pool reserves, fee state, sell constraints, participant
            inventory, and a replayable block or slot snapshot are backed by evidence.
          </p>
          <ol>
            <li>Inspect an asset and discover its venue or launch curve.</li>
            <li>Resolve controller entities and liquid inventory.</li>
            <li>Bind reserves and constraints to a finalized snapshot.</li>
            <li>Run a fixed-seed sequence and preserve every result.</li>
          </ol>
          <button className="primary-button" type="button" disabled>
            Run scenario
          </button>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Required output</span>
              <h3>Scenario contract</h3>
            </div>
          </div>
          <div className="contract-list">
            {[
              ['P10 / P50 / P90', 'Realizable output per entity'],
              ['First mover advantage', 'Difference caused by execution order'],
              ['Final price', 'Post-sequence state'],
              ['Remaining liquidity', 'Stable reserve after all exits'],
              ['Pool exhaustion', 'Explicit terminal condition'],
              ['Evidence', 'Snapshot, inputs, engine version, seed'],
            ].map(([label, detail]) => (
              <div key={label}>
                <strong>{label}</strong>
                <span>{detail}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}

function DataHealth({
  health,
  refresh,
  busy,
}: {
  health?: HealthResponse | undefined;
  refresh: () => void;
  busy: boolean;
}) {
  return (
    <>
      <div className="page-heading page-heading-row">
        <div>
          <span className="eyebrow">Source coverage and freshness</span>
          <h1>Data Health</h1>
          <p>
            A failed or unconfigured provider becomes an availability state—never a business value
            of zero.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={refresh} disabled={busy}>
          {busy ? 'Checking…' : 'Refresh providers'}
        </button>
      </div>
      <section className="panel">
        <ProviderTable health={health} />
      </section>
      <section className="panel anchor-quality-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Common-position verification</span>
            <h3>Anchor reconciliation and continuity</h3>
          </div>
          <StatusPill status={health?.dataQuality.status ?? 'CHECKING'} />
        </div>
        <p className="panel-copy">
          Provider heads are lowered to a shared block or slot before comparison. Endpoint operator
          independence remains Unknown until explicitly configured and verified.
        </p>
        {(health?.dataQuality.results.length ?? 0) === 0 ? (
          <div className="inline-empty">
            {health?.dataQuality.errorCode === undefined
              ? 'No anchor observations are available.'
              : titleCase(health.dataQuality.errorCode)}
          </div>
        ) : (
          <div className="anchor-quality-grid">
            {health?.dataQuality.results.map((result) => {
              const canonicalHash =
                result.canonicalAnchor.state === 'known'
                  ? result.canonicalAnchor.value?.hash
                  : undefined;
              const continuityKnown = result.sources.filter(
                (source) => source.continuity?.continuous.state === 'known',
              ).length;
              return (
                <article className="anchor-quality-card" key={result.chainId}>
                  <div className="provider-card-top">
                    <div>
                      <span className={'chain-tag chain-' + result.ledger.toLowerCase()}>
                        {result.ledger}
                      </span>
                      <h3>{result.chainId}</h3>
                    </div>
                    <StatusPill status={result.status} />
                  </div>
                  <dl>
                    <div>
                      <dt>Sources</dt>
                      <dd>
                        {result.observedSources}/{result.configuredSources} observed ·{' '}
                        {result.requiredSources} required
                      </dd>
                    </div>
                    <div>
                      <dt>Common position</dt>
                      <dd>
                        <KnowledgeDisplay data={result.comparisonPosition} />
                      </dd>
                    </div>
                    <div>
                      <dt>Canonical hash</dt>
                      <dd>
                        {canonicalHash === undefined ? (
                          <KnowledgeDisplay data={result.canonicalAnchor} />
                        ) : (
                          <code title={canonicalHash}>{shortId(canonicalHash, 8)}</code>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Continuity</dt>
                      <dd>
                        {continuityKnown}/{result.sources.length} source checks known
                      </dd>
                    </div>
                    <div>
                      <dt>Independence</dt>
                      <dd>
                        <KnowledgeDisplay data={result.sourceIndependence} />
                      </dd>
                    </div>
                    <div>
                      <dt>Evidence</dt>
                      <dd>{result.metadata.evidenceIds.length}</dd>
                    </div>
                  </dl>
                  {result.alerts.map((alert) => (
                    <div className="provider-error" key={alert.id}>
                      {titleCase(alert.severity)} · {alert.summary}
                    </div>
                  ))}
                </article>
              );
            })}
          </div>
        )}
        <div className="snapshot-strip anchor-quality-footer">
          <span>
            <b>Storage</b>{' '}
            {health === undefined
              ? 'Not available'
              : `${titleCase(health.dataQuality.storage.backend)} · ${
                  health.dataQuality.durable ? 'durable' : 'process-local'
                }`}
          </span>
          <span>
            <b>Checked</b> {formatTime(health?.dataQuality.checkedAt)}
          </span>
        </div>
      </section>
      <section className="health-grid">
        <article className="panel provider-card storage-card">
          <div className="provider-card-top">
            <div>
              <span className="chain-tag storage-tag">PROVENANCE</span>
              <h3>Evidence storage</h3>
            </div>
            <StatusPill status={health?.storage.status ?? 'CHECKING'} />
          </div>
          <dl>
            <div>
              <dt>Backend</dt>
              <dd>
                {health?.storage.backend === undefined
                  ? 'Not available'
                  : titleCase(health.storage.backend)}
              </dd>
            </div>
            <div>
              <dt>Durability</dt>
              <dd>
                {health === undefined
                  ? 'Not available'
                  : health.storage.durable
                    ? 'Durable'
                    : 'Process-local'}
              </dd>
            </div>
            <div>
              <dt>Checked</dt>
              <dd>{formatTime(health?.storage.checkedAt)}</dd>
            </div>
          </dl>
          {health?.storage.errorCode === undefined ? null : (
            <div className="provider-error">{titleCase(health.storage.errorCode)}</div>
          )}
        </article>
        <article className="panel provider-card storage-card">
          <div className="provider-card-top">
            <div>
              <span className="chain-tag storage-tag">HISTORY</span>
              <h3>Finalized ingestion stores</h3>
            </div>
            <StatusPill status={health?.ingestionStorage.status ?? 'CHECKING'} />
          </div>
          <dl>
            <div>
              <dt>Raw facts</dt>
              <dd>{titleCase(health?.ingestionStorage.rawFacts.status ?? 'checking')}</dd>
            </div>
            <div>
              <dt>Checkpoints</dt>
              <dd>{titleCase(health?.ingestionStorage.checkpoints.status ?? 'checking')}</dd>
            </div>
            <div>
              <dt>Raw artifacts</dt>
              <dd>{titleCase(health?.ingestionStorage.artifacts.status ?? 'checking')}</dd>
            </div>
            <div>
              <dt>Configured</dt>
              <dd>
                {health === undefined
                  ? 'Not available'
                  : `${health.ingestionStorage.configured}/${health.ingestionStorage.required}`}
              </dd>
            </div>
          </dl>
          {[
            health?.ingestionStorage.rawFacts,
            health?.ingestionStorage.checkpoints,
            health?.ingestionStorage.artifacts,
          ].map((component, index) =>
            component?.errorCode === undefined ? null : (
              <div className="provider-error" key={`${component.backend}-${index}`}>
                {titleCase(component.backend)}: {titleCase(component.errorCode)}
              </div>
            ),
          )}
        </article>
        {(health?.providers ?? []).map((provider) => (
          <article className="panel provider-card" key={provider.id}>
            <div className="provider-card-top">
              <div>
                <span className={'chain-tag chain-' + provider.ledger.toLowerCase()}>
                  {provider.ledger}
                </span>
                <h3>{provider.id}</h3>
              </div>
              <StatusPill status={provider.status} />
            </div>
            <dl>
              <div>
                <dt>Checked</dt>
                <dd>{formatTime(provider.checkedAt)}</dd>
              </div>
              <div>
                <dt>Head</dt>
                <dd>
                  {provider.head.state === 'known'
                    ? provider.head.value
                    : titleCase(provider.head.reason ?? 'unknown')}
                </dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>{provider.latencyMs === null ? 'Unavailable' : provider.latencyMs + ' ms'}</dd>
              </div>
              <div>
                <dt>Capabilities</dt>
                <dd>{provider.capabilities.length}</dd>
              </div>
              <div>
                <dt>Active endpoint</dt>
                <dd>
                  {provider.transport?.activeEndpointId ??
                    provider.transport?.endpointId ??
                    'Unavailable'}
                </dd>
              </div>
              <div>
                <dt>Circuit</dt>
                <dd>{provider.transport?.circuitState ?? 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Retries / failovers</dt>
                <dd>
                  {provider.transport === undefined
                    ? 'Unavailable'
                    : `${provider.transport.retries} / ${provider.transport.failovers}`}
                </dd>
              </div>
              <div>
                <dt>Cache hits / bypasses</dt>
                <dd>
                  {provider.transport === undefined
                    ? 'Unavailable'
                    : `${provider.transport.cacheHits} / ${provider.transport.cacheBypasses}`}
                </dd>
              </div>
            </dl>
            {provider.errorDetail === undefined ? null : (
              <div className="provider-error">{provider.errorDetail}</div>
            )}
          </article>
        ))}
      </section>
    </>
  );
}

export function App() {
  const [theme, setTheme] = useState<Theme>(() =>
    window.localStorage.getItem('zerotrace-theme') === 'light' ? 'light' : 'dark',
  );
  const [view, setView] = useState<View>('overview');
  const [health, setHealth] = useState<HealthResponse>();
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [platforms, setPlatforms] = useState<PlatformDescriptor[]>([]);
  const [loadingCore, setLoadingCore] = useState(true);
  const [coreError, setCoreError] = useState<string>();
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [searchResult, setSearchResult] = useState<SearchResponse>();
  const [subject, setSubject] = useState<SubjectResponse>();
  const [launchInspection, setLaunchInspection] = useState<FlapInspectionResponse>();
  const [launchError, setLaunchError] = useState<string>();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('zerotrace-theme', theme);
  }, [theme]);

  const refreshCore = useCallback(async () => {
    setLoadingCore(true);
    try {
      const [nextHealth, nextCapabilities, nextPlatforms] = await Promise.all([
        api.health(),
        api.capabilities(),
        api.platforms(),
      ]);
      setHealth(nextHealth);
      setCapabilities(nextCapabilities.core);
      setPlatforms(nextPlatforms.platforms);
      setCoreError(undefined);
    } catch (error) {
      setCoreError(error instanceof Error ? error.message : 'The API could not be reached.');
    } finally {
      setLoadingCore(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshCore(), 0);
    const timer = window.setInterval(() => void refreshCore(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refreshCore]);

  const search = useCallback(async (query: string, network: string) => {
    const mapping: Record<string, { ledger?: string; chainId?: string }> = {
      auto: {},
      ethereum: { ledger: 'EVM', chainId: 'eip155:1' },
      bsc: { ledger: 'EVM', chainId: 'eip155:56' },
      bitcoin: { ledger: 'BITCOIN', chainId: 'bitcoin-mainnet' },
      solana: { ledger: 'SOLANA', chainId: 'solana-mainnet' },
    };
    const selection = mapping[network] ?? {};
    setSearchBusy(true);
    setSearchError(undefined);
    setSubject(undefined);
    setLaunchInspection(undefined);
    setLaunchError(undefined);
    setView('search');
    try {
      setSearchResult(await api.search(query, selection.ledger, selection.chainId));
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed.');
    } finally {
      setSearchBusy(false);
    }
  }, []);

  const inspect = useCallback(async (candidate: SubjectCandidate) => {
    setSearchBusy(true);
    setSearchError(undefined);
    setLaunchInspection(undefined);
    setLaunchError(undefined);
    try {
      const nextSubject =
        candidate.type === 'ADDRESS'
          ? await api.subject(candidate)
          : await api.ledgerRecord(candidate);
      setSubject(nextSubject);
      if (
        candidate.type === 'ADDRESS' &&
        candidate.ledger === 'EVM' &&
        candidate.chainId === 'eip155:56'
      ) {
        try {
          setLaunchInspection(await api.flapLaunch(candidate));
        } catch (error) {
          setLaunchError(
            error instanceof Error ? error.message : 'The Flap Portal inspection failed.',
          );
        }
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Subject inspection failed.');
    } finally {
      setSearchBusy(false);
    }
  }, []);

  const content = useMemo(() => {
    if (view === 'search') {
      return (
        <SearchWorkspace
          result={searchResult}
          subject={subject}
          launchInspection={launchInspection}
          launchError={launchError}
          busy={searchBusy}
          error={searchError}
          onSearch={search}
          onInspect={inspect}
        />
      );
    }
    if (view === 'control') return <ControlRightsWorkspace />;
    if (view === 'scenario') return <ScenarioLab />;
    if (view === 'claims') return <ClaimAuditWorkspace />;
    if (view === 'health') {
      return <DataHealth health={health} refresh={() => void refreshCore()} busy={loadingCore} />;
    }
    return (
      <Overview
        health={health}
        capabilities={capabilities}
        platforms={platforms}
        onSearch={search}
        searchBusy={searchBusy}
      />
    );
  }, [
    view,
    searchResult,
    subject,
    launchInspection,
    launchError,
    searchBusy,
    searchError,
    search,
    inspect,
    health,
    loadingCore,
    refreshCore,
    capabilities,
    platforms,
  ]);

  return (
    <div className="app-shell">
      <Header theme={theme} setTheme={setTheme} health={health} />
      <Sidebar view={view} setView={setView} />
      <main className="main-content">
        {coreError === undefined ? null : (
          <div className="alert alert-error api-alert">
            <strong>API unavailable</strong>
            <span>{coreError}</span>
            <button className="text-button" type="button" onClick={() => void refreshCore()}>
              Retry
            </button>
          </div>
        )}
        {content}
        <footer>
          <span>ZeroTrace v0.1.0</span>
          <span>Read-only multi-chain intelligence</span>
          <a href="https://github.com/greywolf8888/ZeroTrace" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </footer>
      </main>
    </div>
  );
}
