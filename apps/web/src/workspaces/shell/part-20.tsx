import {
  type FlapInspectionResponse,
  type SearchResponse,
  type SubjectCandidate,
  type SubjectResponse,
} from '../../generated-api/client.js';
import { SearchBox, EvidencePanel } from './part-03.js';
import {
  KnowledgeDisplay,
  StatusPill,
  shortId,
  titleCase,
  formatTime,
  BitcoinIntelligencePanel,
} from './part-01.js';
import { LabelIntelligencePanel } from './part-19.js';
import { SolanaTransactionIntelligencePanel } from './part-02.js';
import { FlapLaunchPanel } from './part-18.js';

export function SearchWorkspace({
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
  const durableProjection =
    result?.durableResults.state === 'known' ? result.durableResults.value : undefined;
  const durableEvidence = [
    ...new Map(
      (durableProjection?.matches ?? []).map((match) => [
        match.terminalEvidence.id,
        match.terminalEvidence,
      ]),
    ).values(),
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Global 案件与调查</span>
          <h1>追踪链上调查对象</h1>
          <p>
            Exact identifiers and registered labels are searched against durable Evidence-bound
            reports; checksum and structure classification remains local. Provider reads only begin
            when you choose 检查.
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
          <h2>尚未加载账本记录</h2>
          <p>Choose a network for an EVM identifier so the resulting snapshot is chain-specific.</p>
        </section>
      ) : (
        <section className="search-results">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Classification</span>
              <h2>{result.candidates.length} 个候选</h2>
            </div>
            <span className="freshness search-confidence">
              Result confidence <KnowledgeDisplay data={result.resultConfidence} />
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
                      检查
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {result === undefined ? null : (
        <section className="panel durable-search-panel" data-testid="durable-search-results">
          <div className="panel-header">
            <div>
              <span className="eyebrow">PostgreSQL exact projection</span>
              <h3>持久化情报</h3>
            </div>
            <StatusPill
              status={result.durableResults.state === 'known' ? 'INDEXED' : 'UNAVAILABLE'}
            />
          </div>
          {result.durableResults.state !== 'known' ? (
            <div className="alert alert-warning durable-search-alert">
              <strong>{titleCase(result.durableResults.reason ?? 'unavailable')}</strong>
              {result.durableResults.detail ??
                'The durable projection could not be queried; local classification is still valid.'}
            </div>
          ) : durableProjection === undefined || durableProjection.matches.length === 0 ? (
            <div className="durable-search-empty">
              <strong>No match in the declared durable projection</strong>
              <p>
                This is not evidence that the identifier, token, account, or entity does not exist
                on-chain.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="durable-search-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Chain / type</th>
                    <th>Record</th>
                    <th>Entity</th>
                    <th>Label</th>
                    <th>Confidence</th>
                    <th>Freshness</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {durableProjection.matches.map((match) => (
                    <tr key={match.documentId}>
                      <td>
                        <code title={match.normalizedIdentifier}>
                          {shortId(match.normalizedIdentifier, 9)}
                        </code>
                        <small>{titleCase(match.matchedBy)}</small>
                      </td>
                      <td>
                        <span className={'chain-tag chain-' + match.ledger.toLowerCase()}>
                          {match.ledger}
                        </span>
                        <small>{match.chainId}</small>
                        <KnowledgeDisplay data={match.subjectType} />
                      </td>
                      <td>
                        <strong>{titleCase(match.recordType)}</strong>
                        <small>{titleCase(match.role)}</small>
                        <code title={match.recordId}>{shortId(match.recordId, 7)}</code>
                      </td>
                      <td>
                        {match.entities.state === 'known' ? (
                          match.entities.value?.length === 0 ? (
                            <span>None registered</span>
                          ) : (
                            match.entities.value?.map((entity) => (
                              <span key={entity.entityId}>
                                {titleCase(entity.classification)} · {shortId(entity.entityId, 6)}
                              </span>
                            ))
                          )
                        ) : (
                          <KnowledgeDisplay data={match.entities} />
                        )}
                      </td>
                      <td>
                        {match.labels.state === 'known' ? (
                          match.labels.value?.length === 0 ? (
                            <span>None registered</span>
                          ) : (
                            match.labels.value?.map((label) => (
                              <span
                                key={label.id}
                                title={`${label.source} · ${label.licensePolicy}`}
                              >
                                {label.label} · {titleCase(label.category)}
                              </span>
                            ))
                          )
                        ) : (
                          <KnowledgeDisplay data={match.labels} />
                        )}
                      </td>
                      <td>
                        <KnowledgeDisplay data={match.analysisConfidence} />
                      </td>
                      <td>
                        {match.freshness.state === 'known'
                          ? formatTime(match.freshness.value)
                          : titleCase(match.freshness.reason ?? match.freshness.state)}
                      </td>
                      <td>
                        <code title={match.terminalEvidence.id}>
                          {shortId(match.terminalEvidence.id, 7)}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="snapshot-strip">
            <span>
              <b>Scope</b>{' '}
              {durableProjection?.coverageScope ?? titleCase(result.durableResults.reason ?? '')}
            </span>
            <span>
              <b>Matches</b> {durableProjection?.matchCount ?? 'Unavailable'}
            </span>
            <span>
              <b>Truncated</b>{' '}
              {durableProjection === undefined
                ? 'Unavailable'
                : String(durableProjection.truncated)}
            </span>
            <span>
              <b>Known gaps</b> symbol/ticker · platform/project · complete registry · checkpoints
            </span>
          </div>
        </section>
      )}
      {durableProjection === undefined ? null : (
        <LabelIntelligencePanel matches={durableProjection.matches} />
      )}
      {durableEvidence.length === 0 ? null : (
        <EvidencePanel
          evidence={durableEvidence}
          eyebrow="Durable match → terminal Evidence"
          title="检索证据账本"
        />
      )}
      {subject === undefined ? null : (
        <>
          <BitcoinIntelligencePanel response={subject} />
          <SolanaTransactionIntelligencePanel response={subject} />
          <section className="panel subject-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">绑定快照的账本记录</span>
                <h3>{shortId(subject.subject.normalizedId, 18)}</h3>
              </div>
              <span className="snapshot-badge">
                Coverage {Math.round(subject.metadata.dataCoverage * 100)}%
              </span>
            </div>
            <div className="fact-grid">
              {Object.entries(subject.facts)
                .filter(
                  ([label]) =>
                    ![
                      'utxoSet',
                      'scriptControl',
                      'transactionEntityAnalysis',
                      'transactionSemantics',
                    ].includes(label),
                )
                .map(([label, value]) => (
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

export function ScenarioLab() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Deterministic simulation</span>
          <h1>共享流动性退出竞赛</h1>
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
          <h2>分析门已关闭</h2>
          <p>
            A scenario may run only after pool reserves, fee state, sell constraints, participant
            inventory, and a replayable block or slot snapshot are backed by evidence.
          </p>
          <ol>
            <li>检查 an asset and discover its venue or launch curve.</li>
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
              <h3>情景契约</h3>
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
