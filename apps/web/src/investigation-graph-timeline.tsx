import { useMemo, useState, type FormEvent } from 'react';

import {
  api,
  type EntityInvestigationGraphTimelineResponse,
  type EvidenceDrilldownResponse,
} from './generated-api/client.js';
import {
  EvidenceLedgerDrawer,
  knowledgeLabel,
  shortId,
  titleCase,
} from './investigation-graph-canvas.js';

type Ledger = 'EVM' | 'BITCOIN' | 'SOLANA';

export function InvestigationGraphTimelineWorkspace({
  ledger,
  chainId,
  suggestedGraphId,
  suggestedSubjectId,
}: {
  ledger: Ledger;
  chainId: string;
  suggestedGraphId?: string;
  suggestedSubjectId?: string;
}) {
  const [graphIdsText, setGraphIdsText] = useState(suggestedGraphId ?? '');
  const [timelineId, setTimelineId] = useState('');
  const [subjectId, setSubjectId] = useState(suggestedSubjectId ?? '');
  const [response, setResponse] = useState<EntityInvestigationGraphTimelineResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>();
  const [evidenceResult, setEvidenceResult] = useState<EvidenceDrilldownResponse>();
  const [evidenceError, setEvidenceError] = useState<string>();
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const graphIds = useMemo(
    () => [
      ...new Set(
        graphIdsText
          .split(/[\s,]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ],
    [graphIdsText],
  );
  const validGraphIds =
    graphIds.length >= 2 &&
    graphIds.length <= 100 &&
    graphIds.every((value) => /^eig_[0-9a-f]{24}$/.test(value));
  const validTimelineId = /^eit_[0-9a-f]{24}$/.test(timelineId);

  async function load(mode: 'materialize' | 'latest' | 'exact', event?: FormEvent) {
    event?.preventDefault();
    if (
      chainId.trim().length === 0 ||
      (mode === 'materialize' && !validGraphIds) ||
      (mode === 'exact' && !validTimelineId)
    )
      return;
    setBusy(true);
    setError(undefined);
    setResponse(undefined);
    setSelectedEvidenceId(undefined);
    setEvidenceResult(undefined);
    try {
      setResponse(
        mode === 'materialize'
          ? await api.materializeEntityInvestigationGraphTimeline({
              ledger,
              chainId,
              graphIds,
            })
          : mode === 'latest'
            ? await api.latestEntityInvestigationGraphTimeline(
                ledger,
                chainId,
                subjectId.trim() || undefined,
              )
            : await api.entityInvestigationGraphTimeline(
                timelineId,
                ledger,
                chainId,
                subjectId.trim() || undefined,
              ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Graph timeline request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openEvidence(evidenceId: string) {
    setSelectedEvidenceId(evidenceId);
    setEvidenceResult(undefined);
    setEvidenceError(undefined);
    setEvidenceBusy(true);
    try {
      setEvidenceResult(await api.evidenceDrilldown(evidenceId));
    } catch (cause) {
      setEvidenceError(cause instanceof Error ? cause.message : 'Evidence drilldown failed.');
    } finally {
      setEvidenceBusy(false);
    }
  }

  const record = response?.record;
  const timeline = record?.report.timeline;

  return (
    <div className="graph-timeline-workspace" data-testid="investigation-graph-timeline-workspace">
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="graph-timeline-controls-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">
              Cross-Snapshot · immutable graph reports · no membership mutation
            </span>
            <h3 id="graph-timeline-controls-heading">调查演化</h3>
          </div>
          <span className="snapshot-badge">缺失 ≠ 关系结束</span>
        </div>
        <p className="panel-copy">
          比较 2 到 100
          份持久化图报告。新增或缺失的配对只描述所请求的图范围；它们从不构成控制成员、退出、关系开始或关系结束。
        </p>
        <form
          className="quote-form graph-control-form"
          onSubmit={(event) => void load('latest', event)}
        >
          <label htmlFor="graph-timeline-graph-ids">图 ID（两个及以上，逗号或空白分隔）</label>
          <textarea
            id="graph-timeline-graph-ids"
            spellCheck={false}
            value={graphIdsText}
            onChange={(event) => setGraphIdsText(event.target.value)}
            placeholder="eig_… eig_…"
          />
          <label htmlFor="graph-timeline-id">精确时间线 ID（可选）</label>
          <input
            id="graph-timeline-id"
            spellCheck={false}
            value={timelineId}
            onChange={(event) => setTimelineId(event.target.value.trim())}
            placeholder="eit_…"
          />
          <label htmlFor="graph-timeline-subject">主体过滤（可选）</label>
          <input
            id="graph-timeline-subject"
            spellCheck={false}
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value.trim())}
            placeholder="过滤最新或精确回放"
          />
          <div className="control-actions graph-actions">
            <button
              className="primary-button"
              type="button"
              disabled={!validGraphIds || busy}
              onClick={() => void load('materialize')}
            >
              {busy ? '处理中…' : '物化演化'}
            </button>
            <button className="secondary-button" type="submit" disabled={busy}>
              加载最新
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!validTimelineId || busy}
              onClick={() => void load('exact')}
            >
              精确回放
            </button>
          </div>
        </form>
        {error === undefined ? null : <div className="provider-error">{error}</div>}
      </section>

      {timeline === undefined || record === undefined ? null : (
        <>
          <section className="panel" data-testid="investigation-graph-timeline-result">
            <div className="panel-header">
              <div>
                <span className="eyebrow">{record.id}</span>
                <h3>有证据支撑的图演化</h3>
              </div>
              <span className="status-pill status-replayed">
                {response?.replayed === true ? '已回放' : 'Materialized'}
              </span>
            </div>
            <div className="metric-grid">
              <article className="metric-tile metric-known">
                <div className="metric-label">Graph observations</div>
                <div className="metric-value">{timeline.summary.observationCount}</div>
                <div className="metric-detail">Exact durable graph reports</div>
              </article>
              <article className="metric-tile metric-known">
                <div className="metric-label">Pair changes</div>
                <div className="metric-value">{timeline.summary.pairChangeCount}</div>
                <div className="metric-detail">Typed deltas, not membership mutations</div>
              </article>
              <article className="metric-tile metric-unknown">
                <div className="metric-label">Subject additions</div>
                <div className="metric-value">{timeline.summary.subjectAdditionCount}</div>
                <div className="metric-detail">Added to requested graph scope only</div>
              </article>
              <article className="metric-tile metric-unknown">
                <div className="metric-label">Subject omissions</div>
                <div className="metric-value">{timeline.summary.subjectOmissionCount}</div>
                <div className="metric-detail">Never interpreted as an exit</div>
              </article>
            </div>
            <div className="snapshot-strip">
              <span>
                <b>区间</b> {record.fromPosition} → {record.toPosition}
              </span>
              <span>
                <b>Continuity</b> {knowledgeLabel(timeline.summary.chainObservationContinuity)}
              </span>
              <span>
                <b>Graph set</b> {record.graphIds.length} exact reports
              </span>
              <span>
                <b>关系终止</b> 不由缺失推断
              </span>
            </div>
          </section>

          <section className="panel" aria-labelledby="graph-timeline-transitions-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Ordered revisions and position advances</span>
                <h3 id="graph-timeline-transitions-heading">跨快照转换</h3>
              </div>
              <button
                type="button"
                className="evidence-button"
                onClick={() => void openEvidence(record.terminalEvidenceId)}
              >
                打开终端证据
              </button>
            </div>
            <div className="graph-timeline-list">
              {timeline.transitions.map((transition) => (
                <article
                  className="graph-timeline-card"
                  key={`${transition.fromGraphId}:${transition.toGraphId}`}
                >
                  <div className="graph-timeline-card-heading">
                    <strong>
                      {transition.fromPosition} → {transition.toPosition} ·{' '}
                      {titleCase(transition.kind)}
                    </strong>
                    <span>
                      {transition.snapshotContinuity.state === 'known' &&
                      transition.snapshotContinuity.value === true
                        ? '真实连续性'
                        : `${knowledgeLabel(transition.snapshotContinuity)} 连续性`}
                    </span>
                  </div>
                  <p>
                    {transition.pairChanges.length} pair changes · {transition.unchangedPairCount}{' '}
                    unchanged · {transition.unobservedPositionCount} unobserved positions
                  </p>
                  {transition.pairChanges.length === 0 ? (
                    <div className="inline-empty">此图修订中无配对状态变化。</div>
                  ) : (
                    <div className="contract-list graph-timeline-change-list">
                      {transition.pairChanges.map((change) => (
                        <div key={`${change.subjectA}:${change.subjectB}`}>
                          <strong>{titleCase(change.kind)}</strong>
                          <span>
                            {shortId(change.subjectA, 7)} ↔ {shortId(change.subjectB, 7)} · before{' '}
                            {change.before.state === 'known' && change.before.value !== undefined
                              ? knowledgeLabel(change.before.value.relation)
                              : titleCase(change.before.reason ?? 'unknown')}{' '}
                            → after{' '}
                            {change.after.state === 'known' && change.after.value !== undefined
                              ? knowledgeLabel(change.after.value.relation)
                              : titleCase(change.after.reason ?? 'unknown')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          <EvidenceLedgerDrawer
            busy={evidenceBusy}
            eyebrow="Graph terminals → cross-Snapshot derivation"
            title="演化证据账本"
            testId="investigation-graph-timeline-evidence-ledger"
            {...(selectedEvidenceId === undefined ? {} : { evidenceId: selectedEvidenceId })}
            {...(evidenceResult === undefined ? {} : { result: evidenceResult })}
            {...(evidenceError === undefined ? {} : { error: evidenceError })}
          />
        </>
      )}
    </div>
  );
}
