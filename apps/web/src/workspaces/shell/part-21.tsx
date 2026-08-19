import { type HealthResponse } from '../../generated-api/client.js';
import { ProviderTable } from './part-03.js';
import { StatusPill, titleCase, KnowledgeDisplay, shortId, formatTime } from './part-01.js';

export function DataHealth({
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
          <h1>数据健康</h1>
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
            <h3>锚点对账与连续性</h3>
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
              ? '不可用'
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
              <h3>证据存储</h3>
            </div>
            <StatusPill status={health?.storage.status ?? 'CHECKING'} />
          </div>
          <dl>
            <div>
              <dt>Backend</dt>
              <dd>
                {health?.storage.backend === undefined
                  ? '不可用'
                  : titleCase(health.storage.backend)}
              </dd>
            </div>
            <div>
              <dt>Durability</dt>
              <dd>
                {health === undefined
                  ? '不可用'
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
              <h3>终局摄入存储</h3>
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
                  ? '不可用'
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
        <article className="panel provider-card storage-card">
          <div className="provider-card-top">
            <div>
              <span className="chain-tag storage-tag">GRAPH</span>
              <h3>调查投影</h3>
            </div>
            <StatusPill status={health?.graphProjection?.status ?? 'UNCONFIGURED'} />
          </div>
          <dl>
            <div>
              <dt>Backend</dt>
              <dd>{titleCase(health?.graphProjection?.backend ?? 'APACHE_AGE')}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>PostgreSQL report</dd>
            </div>
            <div>
              <dt>Graph</dt>
              <dd>{health?.graphProjection?.graphName ?? 'Not configured'}</dd>
            </div>
            <div>
              <dt>Checked</dt>
              <dd>{formatTime(health?.graphProjection?.checkedAt)}</dd>
            </div>
          </dl>
          {health?.graphProjection?.errorCode === undefined ? null : (
            <div className="provider-error">{titleCase(health.graphProjection.errorCode)}</div>
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
