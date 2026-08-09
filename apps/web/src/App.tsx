import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import {
  api,
  type Capability,
  type EvidenceRecord,
  type FlapInspectionResponse,
  type FlapSellQuoteResponse,
  type HealthResponse,
  type KnowledgeValue,
  type PlatformDescriptor,
  type SearchResponse,
  type SubjectCandidate,
  type SubjectResponse,
} from './api.js';

type View = 'overview' | 'search' | 'scenario' | 'health';
type Theme = 'dark' | 'light';

const NAVIGATION: Array<{ id: View; label: string; marker: string }> = [
  { id: 'overview', label: 'Market Reality', marker: 'MR' },
  { id: 'search', label: 'Intelligence Search', marker: 'IS' },
  { id: 'scenario', label: 'Scenario Lab', marker: 'SL' },
  { id: 'health', label: 'Data Health', marker: 'DH' },
];

const FUTURE_DOMAINS = [
  'Entity Intelligence',
  'Controller Graph',
  'Evidence Ledger',
  'Claim Audit',
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
      {launch === null ? null : (
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
    if (view === 'scenario') return <ScenarioLab />;
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
