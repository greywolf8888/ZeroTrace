import { useEffect, useMemo, useRef } from 'react';
import type { Core } from 'cytoscape';

import {
  type EntityInvestigationGraphEdge,
  type EntityInvestigationGraphNode,
  type EvidenceDrilldownResponse,
} from './generated-api/client.js';
import { zhLabel, zhReason } from './i18n/zh-CN.js';

export const GRAPH_NODE_CAP = 2000;
export const GRAPH_EDGE_CAP = 2000;

export function shortId(value: string, length = 12): string {
  if (value.length <= length * 2 + 1) return value;
  return `${value.slice(0, length)}…${value.slice(-length)}`;
}

export function titleCase(value: string): string {
  return zhLabel(value);
}

export function knowledgeLabel(value: {
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

export function ControllerGraphCanvas({
  nodes,
  edges,
  onOpenEvidence,
}: {
  nodes: readonly EntityInvestigationGraphNode[];
  edges: readonly EntityInvestigationGraphEdge[];
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cappedNodes = useMemo(() => nodes.slice(0, GRAPH_NODE_CAP), [nodes]);
  const cappedEdges = useMemo(() => edges.slice(0, GRAPH_EDGE_CAP), [edges]);
  const elements = useMemo(
    () => [
      ...cappedNodes.map((node) => ({
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
      ...cappedEdges.map((edge) => ({
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
    [cappedEdges, cappedNodes],
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

export function EvidenceLedgerDrawer({
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
