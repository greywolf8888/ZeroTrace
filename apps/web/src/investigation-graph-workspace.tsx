import { useCallback, useMemo, useState, type FormEvent } from 'react';

import {
  api,
  type EntityInvestigationGraphObservation,
  type EntityInvestigationGraphResponse,
  type EvidenceDrilldownResponse,
} from './generated-api/client.js';
import {
  ControllerGraphCanvas,
  EvidenceLedgerDrawer,
  knowledgeLabel,
  shortId,
  titleCase,
} from './investigation-graph-canvas.js';
import { InvestigationGraphTimelineWorkspace } from './investigation-graph-timeline.js';

type Ledger = 'EVM' | 'BITCOIN' | 'SOLANA';

export function InvestigationGraphWorkspace({
  ledger,
  chainId,
  suggestedTimelineId,
  suggestedSeedSubjectId,
}: {
  ledger: Ledger;
  chainId: string;
  suggestedTimelineId?: string;
  suggestedSeedSubjectId?: string;
}) {
  const [timelineIdsText, setTimelineIdsText] = useState(suggestedTimelineId ?? '');
  const [graphId, setGraphId] = useState('');
  const [seedSubjectId, setSeedSubjectId] = useState(suggestedSeedSubjectId ?? '');
  const [maxDepth, setMaxDepth] = useState('2');
  const [maxNodes, setMaxNodes] = useState('100');
  const [response, setResponse] = useState<EntityInvestigationGraphResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>();
  const [evidenceResult, setEvidenceResult] = useState<EvidenceDrilldownResponse>();
  const [evidenceError, setEvidenceError] = useState<string>();
  const [evidenceBusy, setEvidenceBusy] = useState(false);

  const timelineIds = useMemo(
    () =>
      [
        ...new Set(
          timelineIdsText
            .split(/[\s,]+/)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ].sort(),
    [timelineIdsText],
  );
  const validTimelineIds =
    timelineIds.length > 0 &&
    timelineIds.length <= 250 &&
    timelineIds.every((value) => /^ert_[0-9a-f]{24}$/.test(value));
  const validGraphId = /^eig_[0-9a-f]{24}$/.test(graphId);
  const validTraversal =
    /^(?:0|[1-3])$/.test(maxDepth) && /^(?:[1-9]|[1-9]\d|1\d\d|200)$/.test(maxNodes);

  async function load(mode: 'materialize' | 'latest' | 'exact', event?: FormEvent) {
    event?.preventDefault();
    if (
      chainId.trim().length === 0 ||
      !validTraversal ||
      (mode === 'materialize' && !validTimelineIds) ||
      (mode === 'exact' && !validGraphId)
    ) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setResponse(undefined);
    setSelectedEvidenceId(undefined);
    setEvidenceResult(undefined);
    try {
      const traversal = {
        ...(seedSubjectId.trim().length === 0 ? {} : { seedSubjectId: seedSubjectId.trim() }),
        maxDepth: Number(maxDepth),
        maxNodes: Number(maxNodes),
      };
      setResponse(
        mode === 'materialize'
          ? await api.materializeEntityInvestigationGraph({ ledger, chainId, timelineIds })
          : mode === 'latest'
            ? await api.latestEntityInvestigationGraph(ledger, chainId, {
                ...(seedSubjectId.trim().length === 0 ? {} : { subjectId: seedSubjectId.trim() }),
                ...traversal,
              })
            : await api.entityInvestigationGraph(graphId, ledger, chainId, traversal),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Investigation graph request failed.');
    } finally {
      setBusy(false);
    }
  }

  const openEvidence = useCallback(async (evidenceId: string) => {
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
  }, []);

  const record = response?.record;
  const graph = record?.report.graph;
  const nodes = response?.subgraph?.nodes ?? graph?.nodes ?? [];
  const edges = response?.subgraph?.edges ?? graph?.edges ?? [];
  const observations = response?.subgraph?.observations ?? graph?.observations ?? [];

  return (
    <div className="graph-workspace" data-testid="investigation-graph-workspace">
      <section className="panel subject-panel quote-panel" aria-labelledby="graph-controls-heading">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Exact Snapshot · durable timelines · bounded projection</span>
            <h3 id="graph-controls-heading">控制关系图</h3>
          </div>
          <span className="snapshot-badge">No automatic Entity merge</span>
        </div>
        <p className="panel-copy">
          粘贴一条或多条终止于同一快照的时间线
          ID。同一控制者边与协同边保持区分；独立、服务、基础设施与未知观测会显示出来，但不会因此画出关系边。
        </p>
        <form
          className="quote-form graph-control-form"
          onSubmit={(event) => void load('latest', event)}
        >
          <label htmlFor="graph-timeline-ids">时间线 ID（逗号或空白分隔）</label>
          <textarea
            id="graph-timeline-ids"
            spellCheck={false}
            value={timelineIdsText}
            onChange={(event) => setTimelineIdsText(event.target.value)}
            placeholder="ert_…"
          />
          <label htmlFor="graph-id">精确图 ID（可选）</label>
          <input
            id="graph-id"
            spellCheck={false}
            value={graphId}
            onChange={(event) => setGraphId(event.target.value.trim())}
            placeholder="eig_…"
          />
          <label htmlFor="graph-seed-subject">种子主体（可选）</label>
          <input
            id="graph-seed-subject"
            spellCheck={false}
            value={seedSubjectId}
            onChange={(event) => setSeedSubjectId(event.target.value.trim())}
            placeholder="将最新查找与遍历限制到一个主体"
          />
          <div className="graph-bounds">
            <label htmlFor="graph-max-depth">
              最大深度
              <input
                id="graph-max-depth"
                inputMode="numeric"
                value={maxDepth}
                onChange={(event) => setMaxDepth(event.target.value.trim())}
              />
            </label>
            <label htmlFor="graph-max-nodes">
              最大节点数
              <input
                id="graph-max-nodes"
                inputMode="numeric"
                value={maxNodes}
                onChange={(event) => setMaxNodes(event.target.value.trim())}
              />
            </label>
          </div>
          <div className="control-actions graph-actions">
            <button
              className="primary-button"
              type="button"
              disabled={!validTimelineIds || busy}
              onClick={() => void load('materialize')}
            >
              {busy ? '处理中…' : '物化图'}
            </button>
            <button className="secondary-button" type="submit" disabled={!validTraversal || busy}>
              加载最新
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!validGraphId || !validTraversal || busy}
              onClick={() => void load('exact')}
            >
              精确回放
            </button>
          </div>
        </form>
        {error === undefined ? null : <div className="provider-error">{error}</div>}
      </section>

      {graph === undefined || record === undefined ? null : (
        <>
          <section className="panel" data-testid="investigation-graph-result">
            <div className="panel-header">
              <div>
                <span className="eyebrow">{record.id}</span>
                <h3>有证据支撑的调查投影</h3>
              </div>
              <span className="status-pill status-replayed">
                {response?.replayed === true ? '已回放' : 'Materialized'}
              </span>
            </div>
            <div className="metric-grid">
              <article className="metric-tile metric-known">
                <div className="metric-label">主体</div>
                <div className="metric-value">{graph.summary.nodeCount}</div>
                <div className="metric-detail">Typed only when Evidence supports it</div>
              </article>
              <article className="metric-tile metric-known">
                <div className="metric-label">同一控制者</div>
                <div className="metric-value">{graph.summary.sameControllerEdgeCount}</div>
                <div className="metric-detail">Candidate edges, never automatic merges</div>
              </article>
              <article className="metric-tile metric-known">
                <div className="metric-label">Coordination</div>
                <div className="metric-value">{graph.summary.coordinationEdgeCount}</div>
                <div className="metric-detail">Explicitly independent from ownership</div>
              </article>
              <article className="metric-tile metric-unknown">
                <div className="metric-label">Retained without edge</div>
                <div className="metric-value">{graph.summary.suppressedObservationCount}</div>
                <div className="metric-detail">Negative, service, infrastructure, or Unknown</div>
              </article>
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Snapshot</b> {record.asOfPosition} ·{' '}
                <code title={record.asOfHash}>{shortId(record.asOfHash, 8)}</code>
              </span>
              <span>
                <b>Requested timelines</b> {record.timelineIds.length}
              </span>
              <span>
                <b>AGE</b>{' '}
                {response?.ageProjection === undefined
                  ? 'Replay path does not re-index'
                  : response.ageProjection.state === 'known'
                    ? `${titleCase(response.ageProjection.value?.status ?? 'projected')} · Apache AGE`
                    : titleCase(response.ageProjection.reason ?? response.ageProjection.state)}
              </span>
              <span>
                <b>原始转账副本</b> 禁止
              </span>
            </div>
          </section>

          <section
            className="panel controller-graph-panel"
            aria-labelledby="controller-graph-heading"
          >
            <div className="panel-header">
              <div>
                <span className="eyebrow">Click an edge to open its Evidence lineage</span>
                <h3 id="controller-graph-heading">控制与协同拓扑</h3>
              </div>
              <span className="snapshot-badge">
                {nodes.length} nodes · {edges.length} edges
              </span>
            </div>
            {response?.subgraph?.truncated === true ? (
              <div className="provider-error">
                Traversal reached the configured node limit; this view is intentionally truncated.
              </div>
            ) : null}
            <div className="graph-legend" aria-label="图例">
              <span>
                <i className="graph-legend-line graph-control-line" /> 同一控制者
              </span>
              <span>
                <i className="graph-legend-line graph-coordination-line" /> 协同
              </span>
              <span>
                <i className="graph-legend-node" /> 主体
              </span>
            </div>
            {edges.length === 0 ? (
              <div className="inline-empty">
                此快照下没有足够证据画出关系边。下方保留的观测记录原因与证据，而不是画出虚假连接。
              </div>
            ) : (
              <ControllerGraphCanvas nodes={nodes} edges={edges} onOpenEvidence={openEvidence} />
            )}
            <div className="graph-edge-list" aria-label="可访问的关系边列表">
              {edges.map((edge) => (
                <button
                  type="button"
                  className="graph-edge-button"
                  key={edge.id}
                  onClick={() => void openEvidence(edge.terminalEvidenceId)}
                >
                  <span>{titleCase(edge.relation)}</span>
                  <code>
                    {shortId(edge.subjectA, 7)} ↔ {shortId(edge.subjectB, 7)}
                  </code>
                  <small>
                    {titleCase(edge.classification)} · Evidence{' '}
                    {shortId(edge.terminalEvidenceId, 6)}
                  </small>
                </button>
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="graph-observations-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Every requested timeline remains auditable</span>
                <h3 id="graph-observations-heading">投影判定</h3>
              </div>
              <span className="snapshot-badge">{observations.length} observations</span>
            </div>
            <div className="contract-list graph-observation-list">
              {observations.map((observation: EntityInvestigationGraphObservation) => (
                <div key={observation.timelineId}>
                  <strong>{titleCase(observation.projectionState)}</strong>
                  <span>
                    {shortId(observation.subjectA, 7)} ↔ {shortId(observation.subjectB, 7)} ·{' '}
                    {titleCase(observation.classification)} · controller{' '}
                    {knowledgeLabel(observation.sameControllerProbability)} · coordination{' '}
                    {knowledgeLabel(observation.coordinationProbability)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <EvidenceLedgerDrawer
            busy={evidenceBusy}
            {...(selectedEvidenceId === undefined ? {} : { evidenceId: selectedEvidenceId })}
            {...(evidenceResult === undefined ? {} : { result: evidenceResult })}
            {...(evidenceError === undefined ? {} : { error: evidenceError })}
          />
        </>
      )}
      <InvestigationGraphTimelineWorkspace
        key={record?.id ?? `${ledger}:${chainId}:no-graph`}
        ledger={ledger}
        chainId={chainId}
        {...(record === undefined ? {} : { suggestedGraphId: record.id })}
        {...(seedSubjectId.trim().length === 0 ? {} : { suggestedSubjectId: seedSubjectId.trim() })}
      />
    </div>
  );
}
