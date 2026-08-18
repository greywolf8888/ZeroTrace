import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Core } from 'cytoscape';

import {
  api,
  type EntityInvestigationGraphEdge,
  type EntityInvestigationGraphNode,
  type EntityInvestigationGraphObservation,
  type EntityInvestigationGraphResponse,
  type EntityInvestigationGraphTimelineResponse,
  type EvidenceDrilldownResponse,
} from './generated-api/client.js';
import { zhLabel, zhReason } from './i18n/zh-CN.js';

type Ledger = 'EVM' | 'BITCOIN' | 'SOLANA';

function shortId(value: string, length = 12): string {
  if (value.length <= length * 2 + 1) return value;
  return `${value.slice(0, length)}…${value.slice(-length)}`;
}

function titleCase(value: string): string {
  return zhLabel(value);
}

function knowledgeLabel(value: {
  state: string;
  value?: string | number | boolean | null;
  reason?: string;
}): string {
  if (value.state !== 'known') return zhReason(value.reason ?? value.state);
  if (value.value === null) return '无';
  if (value.value === true) return '是';
  if (value.value === false) return '否';
  if (typeof value.value === 'number') return value.value.toFixed(3);
  return String(value.value);
}

function ControllerGraphCanvas({
  nodes,
  edges,
  onOpenEvidence,
}: {
  nodes: readonly EntityInvestigationGraphNode[];
  edges: readonly EntityInvestigationGraphEdge[];
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const elements = useMemo(
    () => [
      ...nodes.map((node) => ({
        group: 'nodes' as const,
        data: {
          id: node.id,
          label: shortId(node.subjectId, 7),
          subjectId: node.subjectId,
          service:
            node.serviceInfrastructure.state === 'known' &&
            node.serviceInfrastructure.value === true,
        },
      })),
      ...edges.map((edge) => ({
        group: 'edges' as const,
        data: {
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          label: edge.relation === 'SAME_CONTROLLER' ? '同一控制者' : '协同',
          relation: edge.relation,
          terminalEvidenceId: edge.terminalEvidenceId,
        },
      })),
    ],
    [edges, nodes],
  );

  useEffect(() => {
    if (container.current === null) return;
    const target = container.current;
    let disposed = false;
    let graph: Core | undefined;
    void import('cytoscape').then(({ default: cytoscape }) => {
      if (disposed) return;
      graph = cytoscape({
        container: target,
        elements,
        minZoom: 0.35,
        maxZoom: 2.4,
        style: [
          {
            selector: 'node',
            style: {
              width: 48,
              height: 48,
              'background-color': '#10201d',
              'border-color': '#7df8c8',
              'border-width': 2,
              label: 'data(label)',
              color: '#e5f2ee',
              'font-size': 10,
              'text-valign': 'bottom',
              'text-margin-y': 8,
              'text-background-color': '#07100f',
              'text-background-opacity': 0.84,
              'text-background-padding': '3px',
            },
          },
          {
            selector: 'node[?service]',
            style: {
              'background-color': '#3e4a47',
              'border-color': '#8fa9a2',
              shape: 'round-rectangle',
            },
          },
          {
            selector: 'edge',
            style: {
              width: 2.5,
              'curve-style': 'bezier',
              'line-color': '#55b8ff',
              'target-arrow-color': '#55b8ff',
              'target-arrow-shape': 'triangle',
              label: 'data(label)',
              color: '#8fa9a2',
              'font-size': 8,
              'text-rotation': 'autorotate',
              'text-background-color': '#07100f',
              'text-background-opacity': 0.86,
              'text-background-padding': '2px',
            },
          },
          {
            selector: 'edge[relation = "COORDINATED_WITH"]',
            style: {
              'line-color': '#d990ff',
              'target-arrow-color': '#d990ff',
              'line-style': 'dashed',
            },
          },
          {
            selector: 'edge:selected',
            style: {
              width: 5,
              'line-color': '#f5be63',
              'target-arrow-color': '#f5be63',
            },
          },
        ],
        layout: {
          name: nodes.length <= 2 ? 'grid' : 'cose',
          animate: false,
          fit: true,
          padding: 44,
          nodeDimensionsIncludeLabels: true,
        },
      });
      graph.on('tap', 'edge', (event) => {
        const evidenceId = event.target.data('terminalEvidenceId') as unknown;
        if (typeof evidenceId === 'string') onOpenEvidence(evidenceId);
      });
    });
    return () => {
      disposed = true;
      graph?.destroy();
    };
  }, [elements, nodes.length, onOpenEvidence]);

  return (
    <div
      ref={container}
      className="controller-graph-canvas"
      data-testid="controller-graph-canvas"
      role="application"
      aria-label="交互式控制与协同调查图"
    />
  );
}

function EvidenceLedgerDrawer({
  evidenceId,
  result,
  busy,
  error,
  eyebrow = '选中边 → 派生父证据',
  title = '证据账本',
  testId = 'controller-graph-evidence-ledger',
}: {
  evidenceId?: string;
  result?: EvidenceDrilldownResponse;
  busy: boolean;
  error?: string;
  eyebrow?: string;
  title?: string;
  testId?: string;
}) {
  if (evidenceId === undefined) return null;
  const headingId = `${testId}-heading`;
  return (
    <section
      className="panel graph-evidence-drawer"
      id={testId}
      data-testid={testId}
      aria-labelledby={headingId}
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3 id={headingId}>{title}</h3>
        </div>
        <code title={evidenceId}>{shortId(evidenceId, 8)}</code>
      </div>
      {busy ? <div className="inline-empty">正在加载证据谱系…</div> : null}
      {error === undefined ? null : <div className="provider-error">{error}</div>}
      {result === undefined ? null : (
        <div className="contract-list">
          {result.nodes.map((node) => (
            <div key={node.evidence.id}>
              <strong>{titleCase(node.evidence.kind)}</strong>
              <span>
                {node.evidence.summary} · {node.evidence.source} · position{' '}
                {node.evidence.blockOrSlot ?? 'Unavailable'} ·{' '}
                <code title={node.evidence.id}>{shortId(node.evidence.id, 8)}</code>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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
