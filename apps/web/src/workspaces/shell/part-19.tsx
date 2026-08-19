import {
  api,
  type GlobalIntelligenceSearchMatch,
  type LabelIntelligenceIdentity,
  type LabelIntelligenceReportResponse,
} from '../../generated-api/client.js';
import { useMemo, useState } from 'react';
import { StatusPill, shortId, titleCase, KnowledgeDisplay, formatTime } from './part-01.js';
import { EvidencePanel } from './part-03.js';

export function LabelIntelligencePanel({ matches }: { matches: GlobalIntelligenceSearchMatch[] }) {
  const targets = useMemo(() => {
    const unique = new Map<
      string,
      LabelIntelligenceIdentity & { key: string; matchedBy: string }
    >();
    for (const match of matches) {
      if (match.subjectType.state !== 'known' || match.subjectType.value === undefined) continue;
      const key = [
        match.ledger,
        match.chainId,
        match.subjectType.value,
        match.normalizedIdentifier,
      ].join(':');
      if (!unique.has(key)) {
        unique.set(key, {
          key,
          ledger: match.ledger,
          chainId: match.chainId,
          subjectType: match.subjectType.value,
          normalizedIdentifier: match.normalizedIdentifier,
          matchedBy: match.matchedBy,
        });
      }
    }
    return [...unique.values()];
  }, [matches]);
  const [selectedKey, setSelectedKey] = useState('');
  const [staleAfterDays, setStaleAfterDays] = useState(30);
  const [responseState, setResponseState] = useState<{
    targetKey: string;
    response: LabelIntelligenceReportResponse;
  }>();
  const [busy, setBusy] = useState(false);
  const [errorState, setErrorState] = useState<{ targetKey: string; message: string }>();

  if (targets.length === 0) return null;
  const target = targets.find((item) => item.key === selectedKey) ?? targets[0];
  const response =
    responseState !== undefined && responseState.targetKey === target?.key
      ? responseState.response
      : undefined;
  const error =
    errorState !== undefined && errorState.targetKey === target?.key
      ? errorState.message
      : undefined;

  const replayLatest = async () => {
    if (target === undefined) return;
    setBusy(true);
    setErrorState(undefined);
    try {
      setResponseState({
        targetKey: target.key,
        response: await api.labelIntelligenceLatest(target),
      });
    } catch (nextError) {
      setResponseState(undefined);
      setErrorState({
        targetKey: target.key,
        message:
          nextError instanceof Error ? nextError.message : 'Latest label audit is unavailable.',
      });
    } finally {
      setBusy(false);
    }
  };

  const captureCurrent = async () => {
    if (target === undefined) return;
    setBusy(true);
    setErrorState(undefined);
    try {
      setResponseState({
        targetKey: target.key,
        response: await api.labelIntelligenceMaterialize(
          target,
          new Date().toISOString(),
          staleAfterDays * 86_400,
        ),
      });
    } catch (nextError) {
      setResponseState(undefined);
      setErrorState({
        targetKey: target.key,
        message:
          nextError instanceof Error ? nextError.message : 'Label audit could not be captured.',
      });
    } finally {
      setBusy(false);
    }
  };

  const record = response?.record;
  const intelligence = record?.report.result;
  const rankedObservations =
    intelligence === undefined
      ? []
      : intelligence.rankedObservationIds
          .map((id) => intelligence.observations.find((item) => item.observation.id === id))
          .filter((item) => item !== undefined);

  return (
    <>
      <section className="panel label-intelligence-panel" data-testid="label-intelligence">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Ledger-scoped observation audit</span>
            <h3>标签情报</h3>
          </div>
          <StatusPill
            status={
              response === undefined
                ? 'NOT_CAPTURED'
                : response.replayed
                  ? 'DURABLE_REPLAY'
                  : 'IMMUTABLE_CAPTURE'
            }
          />
        </div>
        <p className="label-intelligence-intro">
          Review every registered label for one exact Subject. Capturing creates an immutable,
          Evidence-linked analysis report; it does not add labels, merge entities, or make a chain
          transaction.
        </p>
        <div className="label-audit-controls">
          <label>
            Subject
            <select
              value={target?.key ?? ''}
              onChange={(event) => {
                setSelectedKey(event.target.value);
                setResponseState(undefined);
                setErrorState(undefined);
              }}
            >
              {targets.map((item) => (
                <option value={item.key} key={item.key}>
                  {item.ledger} · {item.chainId} · {item.subjectType} ·{' '}
                  {shortId(item.normalizedIdentifier, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stale after
            <select
              value={staleAfterDays}
              onChange={(event) => setStaleAfterDays(Number(event.target.value))}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
          <div className="label-audit-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void replayLatest()}
            >
              Replay latest
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void captureCurrent()}
            >
              {busy ? '正在读取持久化观测…' : '捕获标签审计'}
            </button>
          </div>
        </div>
        <div className="snapshot-strip">
          <span>
            <b>Match</b> {titleCase(target?.matchedBy ?? 'unknown')}
          </span>
          <span>
            <b>Scope</b> one ledger · one chain · one Subject
          </span>
          <span>
            <b>Policy</b> {staleAfterDays}-day freshness window
          </span>
        </div>
        {error === undefined ? null : (
          <div className="alert alert-warning label-audit-error">
            <strong>Label audit unavailable</strong>
            {error} Unknown is retained; no empty result is treated as a clean label history.
          </div>
        )}
        {record === undefined || intelligence === undefined ? (
          <div className="durable-search-empty label-audit-empty">
            <strong>尚未加载标签快照</strong>
            <p>回放已有报告，或捕获当前已登记的观测集。</p>
          </div>
        ) : (
          <>
            <div className="label-safety-grid" aria-label="标签推断安全边界">
              <div>
                <strong>实体合并已阻断</strong>
                <span>标签是观测，不是成员证明。</span>
              </div>
              <div>
                <strong>风险 ≠ 控制</strong>
                <span>风险标签不能证明共同控制。</span>
              </div>
              <div>
                <strong>Cross-chain merge blocked</strong>
                <span>Matching text on another ledger remains a different Subject.</span>
              </div>
            </div>
            <div className="label-summary-grid">
              {[
                ['Observations', intelligence.summary.observationCount],
                ['Active', intelligence.summary.activeCount],
                ['Stale', intelligence.summary.staleCount],
                ['Expired', intelligence.summary.expiredCount],
                ['Future', intelligence.summary.futureCount],
                ['Conflicts', intelligence.summary.conflictCount],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="fact-grid label-coverage-grid">
              <div className="fact-row">
                <span>Service Hub suppression</span>
                {intelligence.serviceHubSuppression.applied ? (
                  <span className="known-value">Applied · ownership propagation suppressed</span>
                ) : (
                  <KnowledgeDisplay data={intelligence.serviceHubSuppression.reason} />
                )}
              </div>
              <div className="fact-row">
                <span>Requested observation-set coverage</span>
                <KnowledgeDisplay data={intelligence.metadata.requestedObservationSetCoverage} />
              </div>
              <div className="fact-row">
                <span>Global source coverage</span>
                <KnowledgeDisplay data={intelligence.metadata.globalSourceCoverage} />
              </div>
              <div className="fact-row">
                <span>History coverage</span>
                <KnowledgeDisplay data={intelligence.metadata.historyCoverage} />
              </div>
              <div className="fact-row">
                <span>Review confidence</span>
                <KnowledgeDisplay data={intelligence.metadata.conclusionConfidence} />
              </div>
              <div className="fact-row">
                <span>Freshness</span>
                {intelligence.metadata.freshness.state === 'known' ? (
                  <span className="known-value">
                    {formatTime(intelligence.metadata.freshness.value)}
                  </span>
                ) : (
                  <KnowledgeDisplay data={intelligence.metadata.freshness} />
                )}
              </div>
            </div>
            {intelligence.conflicts.length === 0 ? (
              <div className="alert alert-info label-conflict-note">
                No conflict exists inside this exact registered observation set. This does not prove
                global agreement because global source coverage remains separately typed.
              </div>
            ) : (
              <div className="label-conflicts">
                <div className="section-heading compact">
                  <div>
                    <span className="eyebrow">No winner is silently selected</span>
                    <h4>保留的冲突</h4>
                  </div>
                </div>
                {intelligence.conflicts.map((conflict) => (
                  <article key={conflict.id}>
                    <StatusPill status={conflict.disposition} />
                    <strong>{titleCase(conflict.dimension)}</strong>
                    <span>{conflict.key}</span>
                    <code>{conflict.values.join(' ↔ ')}</code>
                    <small>
                      Highest review priority:{' '}
                      {conflict.highestPriorityObservationIds
                        .map((id) => shortId(id, 5))
                        .join(', ')}
                    </small>
                  </article>
                ))}
              </div>
            )}
            <div className="table-scroll label-observation-table-wrap">
              <table className="durable-search-table label-observation-table">
                <thead>
                  <tr>
                    <th>Label / category</th>
                    <th>Source</th>
                    <th>Temporal state</th>
                    <th>Actor candidate</th>
                    <th>Confidence</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedObservations.map((projection) => (
                    <tr key={projection.observation.id}>
                      <td>
                        <strong>{projection.observation.label}</strong>
                        <small>{titleCase(projection.observation.category)}</small>
                        {projection.riskLabel ? <span>Risk observation</span> : null}
                      </td>
                      <td>
                        <strong>{titleCase(projection.observation.sourceClass)}</strong>
                        <small>
                          Priority {projection.sourcePriority} · {projection.observation.source}
                        </small>
                        <small title={projection.observation.licensePolicy}>
                          {projection.observation.licensePolicy}
                        </small>
                      </td>
                      <td>
                        <StatusPill status={projection.temporalStatus} />
                        <small>{formatTime(projection.observation.observedAt)}</small>
                      </td>
                      <td>
                        <KnowledgeDisplay data={projection.observation.actorCandidate} />
                      </td>
                      <td>{Math.round(projection.observation.sourceConfidence * 100)}%</td>
                      <td>
                        {projection.observation.evidenceIds.map((id) => (
                          <code title={id} key={id}>
                            {shortId(id, 6)}
                          </code>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Report</b> {shortId(record.id, 7)}
              </span>
              <span>
                <b>Label Snapshot</b> {shortId(record.labelSnapshotId, 7)}
              </span>
              <span>
                <b>As of</b> {formatTime(record.asOf)}
              </span>
              <span>
                <b>Model</b> {record.modelVersion}
              </span>
            </div>
          </>
        )}
      </section>
      {record === undefined ? null : (
        <EvidencePanel
          evidence={record.report.evidence}
          eyebrow="Registered observations → immutable Label Snapshot"
          title="标签情报证据账本"
        />
      )}
    </>
  );
}
