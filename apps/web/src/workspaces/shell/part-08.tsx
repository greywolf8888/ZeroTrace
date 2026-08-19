import {
  api,
  type EntityRelationshipReportReplayResponse,
  type EntityRelationshipTimelineReplayResponse,
} from '../../generated-api/client.js';
import { InvestigationGraphWorkspace } from '../../InvestigationGraph.js';
import { useState } from 'react';
import {
  StatusPill,
  titleCase,
  KnowledgeDisplay,
  MetricTile,
  shortId,
  formatTime,
} from './part-01.js';
import { EvidencePanel } from './part-03.js';

export function EntityIntelligenceWorkspace() {
  const [ledger, setLedger] = useState<'EVM' | 'BITCOIN' | 'SOLANA'>('EVM');
  const [chainId, setChainId] = useState('eip155:56');
  const [subjectA, setSubjectA] = useState('');
  const [subjectB, setSubjectB] = useState('');
  const [reportId, setReportId] = useState('');
  const [response, setResponse] = useState<EntityRelationshipReportReplayResponse>();
  const [timelineId, setTimelineId] = useState('');
  const [fromPosition, setFromPosition] = useState('');
  const [toPosition, setToPosition] = useState('');
  const [timelineResponse, setTimelineResponse] =
    useState<EntityRelationshipTimelineReplayResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validPair =
    chainId.trim().length > 0 &&
    subjectA.trim().length > 0 &&
    subjectB.trim().length > 0 &&
    subjectA.trim() !== subjectB.trim();
  const validReportId = /^erh_[0-9a-f]{24}$/.test(reportId);
  const validTimelineId = /^ert_[0-9a-f]{24}$/.test(timelineId);
  const validTimelineRange =
    (fromPosition.length === 0 || /^(?:0|[1-9]\d*)$/.test(fromPosition)) &&
    (toPosition.length === 0 || /^(?:0|[1-9]\d*)$/.test(toPosition)) &&
    (fromPosition.length === 0 ||
      toPosition.length === 0 ||
      BigInt(fromPosition) <= BigInt(toPosition));

  function changeLedger(next: 'EVM' | 'BITCOIN' | 'SOLANA') {
    setLedger(next);
    setChainId(
      next === 'EVM' ? 'eip155:56' : next === 'BITCOIN' ? 'bitcoin-mainnet' : 'solana-mainnet',
    );
    setResponse(undefined);
    setTimelineResponse(undefined);
    setError(undefined);
  }

  async function loadTimeline(mode: 'materialize' | 'latest' | 'exact') {
    if (!validPair || !validTimelineRange || (mode === 'exact' && !validTimelineId)) return;
    setBusy(true);
    setError(undefined);
    setTimelineResponse(undefined);
    try {
      if (mode === 'materialize') {
        setTimelineResponse(
          await api.materializeEntityRelationshipTimeline({
            ledger,
            chainId,
            subjectA,
            subjectB,
            ...(fromPosition.length === 0 ? {} : { fromPosition }),
            ...(toPosition.length === 0 ? {} : { toPosition }),
          }),
        );
      } else if (mode === 'latest') {
        setTimelineResponse(
          await api.latestEntityRelationshipTimeline(ledger, chainId, subjectA, subjectB),
        );
      } else {
        setTimelineResponse(
          await api.entityRelationshipTimeline(timelineId, ledger, chainId, subjectA, subjectB),
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '实体关系时间线失败。');
    } finally {
      setBusy(false);
    }
  }

  async function load(mode: 'latest' | 'exact') {
    if (!validPair || (mode === 'exact' && !validReportId)) return;
    setBusy(true);
    setError(undefined);
    setResponse(undefined);
    try {
      setResponse(
        mode === 'latest'
          ? await api.latestEntityRelationshipReport(ledger, chainId, subjectA, subjectB)
          : await api.entityRelationshipReport(reportId, ledger, chainId, subjectA, subjectB),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '实体关系报告回放失败。');
    } finally {
      setBusy(false);
    }
  }

  const record = response?.record;
  const report = record?.report;
  const result = report?.result;
  const timelineRecord = timelineResponse?.record;
  const timeline = timelineRecord?.report.timeline;

  return (
    <>
      <div className="page-heading page-heading-row">
        <div>
          <span className="eyebrow">Pairwise hypothesis · Evidence · no automatic merge</span>
          <h1>实体与角色</h1>
          <p>
            Replay immutable relationship hypotheses without contacting a chain provider. Similar
            behavior, a risk label, or shared service infrastructure is never ownership proof.
          </p>
        </div>
        <StatusPill status="READ_ONLY" />
      </div>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="entity-report-replay-heading"
        data-testid="entity-report-replay"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">Provider-free latest / exact replay</span>
            <h3 id="entity-report-replay-heading">关系假设报告</h3>
          </div>
          <span className="snapshot-badge">不存在标签直接合并路径</span>
        </div>
        <form
          className="quote-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load('latest');
          }}
        >
          <label htmlFor="entity-ledger">Ledger</label>
          <select
            id="entity-ledger"
            value={ledger}
            onChange={(event) => changeLedger(event.target.value as 'EVM' | 'BITCOIN' | 'SOLANA')}
          >
            <option value="EVM">EVM</option>
            <option value="BITCOIN">Bitcoin</option>
            <option value="SOLANA">Solana</option>
          </select>
          <label htmlFor="entity-chain">链 ID</label>
          <input
            id="entity-chain"
            spellCheck={false}
            value={chainId}
            onChange={(event) => setChainId(event.target.value.trim())}
          />
          <label htmlFor="entity-subject-a">主体 A</label>
          <input
            id="entity-subject-a"
            spellCheck={false}
            value={subjectA}
            onChange={(event) => setSubjectA(event.target.value.trim())}
            placeholder="规范地址、账户或主体 ID"
          />
          <label htmlFor="entity-subject-b">主体 B</label>
          <input
            id="entity-subject-b"
            spellCheck={false}
            value={subjectB}
            onChange={(event) => setSubjectB(event.target.value.trim())}
            placeholder="另一个不同的规范主体 ID"
          />
          <label htmlFor="entity-report-id">精确报告 ID（可选）</label>
          <input
            id="entity-report-id"
            spellCheck={false}
            value={reportId}
            onChange={(event) => setReportId(event.target.value.trim())}
            placeholder="erh_…"
          />
          <div className="control-actions">
            <button className="primary-button" type="submit" disabled={!validPair || busy}>
              {busy ? '加载中…' : '加载最新'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!validPair || !validReportId || busy}
              onClick={() => void load('exact')}
            >
              精确回放
            </button>
          </div>
        </form>
        {error === undefined ? null : <div className="provider-error">{error}</div>}
      </section>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="entity-timeline-heading"
        data-testid="entity-timeline-controls"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">持久化报告 → 时间证据投影</span>
            <h3 id="entity-timeline-heading">关系时间线</h3>
          </div>
          <span className="snapshot-badge">2–1,000 份报告</span>
        </div>
        <p className="panel-copy">
          物化只使用已入库的不可变报告。缺失的链上高度保持未观测；同一高度的重算显示为修订。
        </p>
        <div className="quote-form">
          <label htmlFor="entity-timeline-from">起始高度（可选）</label>
          <input
            id="entity-timeline-from"
            inputMode="numeric"
            value={fromPosition}
            onChange={(event) => setFromPosition(event.target.value.trim())}
            placeholder="含端点"
          />
          <label htmlFor="entity-timeline-to">结束高度（可选）</label>
          <input
            id="entity-timeline-to"
            inputMode="numeric"
            value={toPosition}
            onChange={(event) => setToPosition(event.target.value.trim())}
            placeholder="含端点"
          />
          <label htmlFor="entity-timeline-id">精确时间线 ID（可选）</label>
          <input
            id="entity-timeline-id"
            spellCheck={false}
            value={timelineId}
            onChange={(event) => setTimelineId(event.target.value.trim())}
            placeholder="ert_…"
          />
          <div className="control-actions">
            <button
              className="primary-button"
              type="button"
              disabled={!validPair || !validTimelineRange || busy}
              onClick={() => void loadTimeline('materialize')}
            >
              {busy ? '处理中…' : '物化时间线'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!validPair || busy}
              onClick={() => void loadTimeline('latest')}
            >
              加载最新
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!validPair || !validTimelineId || busy}
              onClick={() => void loadTimeline('exact')}
            >
              精确回放
            </button>
          </div>
        </div>
      </section>
      {record === undefined || report === undefined || result === undefined ? null : (
        <>
          <section className="panel" data-testid="entity-report-result">
            <div className="panel-header">
              <div>
                <span className="eyebrow">{record.id}</span>
                <h3>{titleCase(result.classification)}</h3>
              </div>
              <StatusPill status="REPLAYED" />
            </div>
            <div className="metric-grid">
              <article className="metric-tile metric-known">
                <div className="metric-label">同一控制者</div>
                <div className="metric-value">
                  <KnowledgeDisplay data={result.sameControllerProbability} />
                </div>
                <div className="metric-detail">证据加权假设</div>
              </article>
              <article className="metric-tile metric-known">
                <div className="metric-label">协同</div>
                <div className="metric-value">
                  <KnowledgeDisplay data={result.coordinationProbability} />
                </div>
                <div className="metric-detail">与共同控制区分</div>
              </article>
              <article className="metric-tile metric-known">
                <div className="metric-label">独立性</div>
                <div className="metric-value">
                  <KnowledgeDisplay data={result.independenceProbability} />
                </div>
                <div className="metric-detail">保留否定证据</div>
              </article>
              <MetricTile
                label="自动所有权合并"
                value="已阻止"
                detail="硬性报告不变量"
                state="unknown"
              />
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Pair</b> <code>{shortId(record.subjectA)}</code> ↔{' '}
                <code>{shortId(record.subjectB)}</code>
              </span>
              <span>
                <b>Snapshot</b> {record.snapshotPosition} ·{' '}
                <code title={record.snapshotHash}>{shortId(record.snapshotHash, 8)}</code>
              </span>
              <span>
                <b>结果哈希</b>{' '}
                <code title={record.resultHash}>{shortId(record.resultHash, 8)}</code>
              </span>
              <span>
                <b>Captured</b> {formatTime(record.capturedAt)}
              </span>
            </div>
            <div className="contract-list">
              <div>
                <strong>Service suppression</strong>
                <span>{result.serviceSuppressionApplied ? 'Applied' : 'Not triggered'}</span>
              </div>
              <div>
                <strong>Positive Evidence</strong>
                <span>{result.positiveEvidenceIds.length}</span>
              </div>
              <div>
                <strong>Negative Evidence</strong>
                <span>{result.negativeEvidenceIds.length}</span>
              </div>
              <div>
                <strong>Model</strong>
                <span>{record.modelVersion}</span>
              </div>
            </div>
          </section>
          <section className="panel" aria-labelledby="entity-features-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Canonical direct inputs</span>
                <h3 id="entity-features-heading">关系特征</h3>
              </div>
              <span className="snapshot-badge">{report.input.features.length} features</span>
            </div>
            <div className="contract-list">
              {report.input.features.map((feature) => (
                <div key={`${feature.kind}:${feature.evidenceId}`}>
                  <strong>{titleCase(feature.kind)}</strong>
                  <span>
                    strength {feature.strength.toFixed(3)} · reliability{' '}
                    {feature.reliability.toFixed(3)} · {shortId(feature.evidenceId, 8)}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <EvidencePanel
            evidence={report.evidence}
            eyebrow="Source observations → terminal hypothesis"
            title="实体关系证据"
          />
        </>
      )}
      {timelineRecord === undefined || timeline === undefined ? null : (
        <>
          <section className="panel" data-testid="entity-timeline-result">
            <div className="panel-header">
              <div>
                <span className="eyebrow">{timelineRecord.id}</span>
                <h3>{titleCase(timeline.summary.currentClassification)}</h3>
              </div>
              <StatusPill
                status={timelineResponse?.replayed === true ? 'REPLAYED' : 'MATERIALIZED'}
              />
            </div>
            <div className="metric-grid">
              <article className="metric-tile metric-known">
                <div className="metric-label">Observations</div>
                <div className="metric-value">{timeline.summary.observationCount}</div>
                <div className="metric-detail">Complete persisted report set in range</div>
              </article>
              <article className="metric-tile metric-known">
                <div className="metric-label">Classification changes</div>
                <div className="metric-value">{timeline.summary.classificationChangeCount}</div>
                <div className="metric-detail">Including same-position revisions</div>
              </article>
              <article className="metric-tile metric-known">
                <div className="metric-label">Current same controller</div>
                <div className="metric-value">
                  <KnowledgeDisplay data={timeline.summary.currentSameControllerProbability} />
                </div>
                <div className="metric-detail">Latest persisted hypothesis</div>
              </article>
              <article className="metric-tile metric-unknown">
                <div className="metric-label">链连续性</div>
                <div className="metric-value">
                  <KnowledgeDisplay data={timeline.summary.chainObservationContinuity} />
                </div>
                <div className="metric-detail">从不由报告密度推断</div>
              </article>
            </div>
            <div className="snapshot-strip">
              <span>
                <b>区间</b> {timelineRecord.fromPosition} → {timelineRecord.toPosition}
              </span>
              <span>
                <b>修订次数</b>{' '}
                {timeline.transitions.filter((item) => item.kind === 'REVISION').length}
              </span>
              <span>
                <b>结果哈希</b>{' '}
                <code title={timelineRecord.resultHash}>
                  {shortId(timelineRecord.resultHash, 8)}
                </code>
              </span>
              <span>
                <b>自动合并</b> 已阻断
              </span>
            </div>
          </section>
          <section className="panel" aria-labelledby="entity-timeline-transitions-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Ordered revisions and position advances</span>
                <h3 id="entity-timeline-transitions-heading">关系演化</h3>
              </div>
              <span className="snapshot-badge">{timeline.transitions.length} transitions</span>
            </div>
            <div className="contract-list">
              {timeline.transitions.map((transition) => (
                <div key={`${transition.fromReportId}:${transition.toReportId}`}>
                  <strong>
                    {transition.fromPosition} → {transition.toPosition} ·{' '}
                    {titleCase(transition.kind)}
                  </strong>
                  <span>
                    {titleCase(transition.classificationBefore)} →{' '}
                    {titleCase(transition.classificationAfter)} · controller Δ{' '}
                    <KnowledgeDisplay data={transition.sameControllerDelta} /> · coordination Δ{' '}
                    <KnowledgeDisplay data={transition.coordinationDelta} /> · unobserved positions{' '}
                    {transition.unobservedPositionCount}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="panel" aria-labelledby="entity-timeline-observations-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Immutable hypothesis checkpoints</span>
                <h3 id="entity-timeline-observations-heading">时间线观测</h3>
              </div>
              <span className="snapshot-badge">{timeline.observations.length} reports</span>
            </div>
            <div className="contract-list">
              {timeline.observations.map((observation) => (
                <div key={observation.reportId}>
                  <strong>{titleCase(observation.classification)}</strong>
                  <span>
                    {shortId(observation.reportId, 8)} · {formatTime(observation.capturedAt)} ·{' '}
                    terminal {shortId(observation.terminalEvidenceId, 8)}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <EvidencePanel
            evidence={timelineRecord.report.evidence}
            eyebrow="Relationship report terminals → timeline terminal"
            title="时间线证据"
          />
        </>
      )}
      <InvestigationGraphWorkspace
        key={`${ledger}:${chainId}:${timelineRecord?.id ?? 'no-timeline'}`}
        ledger={ledger}
        chainId={chainId}
        {...(timelineRecord === undefined ? {} : { suggestedTimelineId: timelineRecord.id })}
        {...(subjectA.trim().length === 0 ? {} : { suggestedSeedSubjectId: subjectA.trim() })}
      />
    </>
  );
}
