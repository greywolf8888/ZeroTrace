import {
  AnalysisSnapshotSchema,
  EvidenceSchema,
  type AnalysisSnapshot,
  type Evidence,
  type EvidenceKind,
  type Ledger,
} from '@zerotrace/schemas';

export { canonicalJson, hashPayload } from './hash.js';
export {
  buildForensicFinding,
  buildReportEnvelope,
  contentAddressedId,
  coverageFromRatios,
  FORENSIC_POLICY_VERSION,
  fuseEvidenceScore,
  inconclusiveSourceIndependence,
  snapshotPosition,
  subjectKey,
  unknownCoverageVector,
} from './forensic.js';

import { hashPayload } from './hash.js';

export interface CreateEvidenceInput {
  ledger: Ledger;
  chainId: string;
  kind: EvidenceKind;
  source: string;
  locator: string;
  payload: unknown;
  summary: string;
  observedAt?: string;
  sourceUri?: string;
  blockOrSlot?: string;
  finality?: string;
  rawArtifactRef?: string;
  sourceEvidenceIds?: readonly string[];
}

function normalizedSourceIds(sourceEvidenceIds: readonly string[]): string[] {
  return [...new Set(sourceEvidenceIds)].sort();
}

export function evidenceIdFor(
  evidence: Omit<Evidence, 'id'> | Evidence,
  sourceEvidenceIds: readonly string[] = [],
): string {
  const content = { ...evidence } as Partial<Evidence>;
  delete content.id;
  return `ev_${hashPayload({
    schema: 'zerotrace-evidence-v1',
    evidence: content,
    sourceEvidenceIds: normalizedSourceIds(sourceEvidenceIds),
  }).slice(0, 24)}`;
}

export function createEvidence(input: CreateEvidenceInput): Evidence {
  const payloadHash = hashPayload(input.payload);
  const rawObservedAt = input.observedAt ?? new Date().toISOString();
  const parsedObservedAt = new Date(rawObservedAt);
  const observedAt = Number.isNaN(parsedObservedAt.getTime())
    ? rawObservedAt
    : parsedObservedAt.toISOString();
  const content = {
    ledger: input.ledger,
    chainId: input.chainId,
    kind: input.kind,
    source: input.source,
    locator: input.locator,
    payloadHash,
    observedAt,
    summary: input.summary,
    ...(input.sourceUri === undefined ? {} : { sourceUri: input.sourceUri }),
    ...(input.blockOrSlot === undefined ? {} : { blockOrSlot: input.blockOrSlot }),
    ...(input.finality === undefined ? {} : { finality: input.finality }),
    ...(input.rawArtifactRef === undefined ? {} : { rawArtifactRef: input.rawArtifactRef }),
  };
  const evidence: Evidence = {
    id: evidenceIdFor(content, input.sourceEvidenceIds),
    ...content,
  };
  return EvidenceSchema.parse(evidence);
}

export interface EvidenceNode {
  evidence: Evidence;
  sourceEvidenceIds: readonly string[];
  snapshot?: AnalysisSnapshot;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

export class EvidenceLedger {
  readonly #nodes = new Map<string, EvidenceNode>();

  add(
    evidence: Evidence,
    sourceEvidenceIds: readonly string[] = [],
    snapshot?: AnalysisSnapshot,
  ): EvidenceNode {
    const parsed = EvidenceSchema.parse(evidence);
    const parsedSnapshot =
      snapshot === undefined ? undefined : AnalysisSnapshotSchema.parse(snapshot);
    const sources = normalizedSourceIds(sourceEvidenceIds);
    if (this.#nodes.has(parsed.id)) {
      throw new Error(`Evidence ${parsed.id} already exists; observations are immutable.`);
    }
    if (
      (parsed.kind === 'DERIVED_FEATURE' || parsed.kind === 'NEGATIVE_EVIDENCE') &&
      sources.length === 0
    ) {
      throw new Error(`${parsed.kind} must link to at least one source observation.`);
    }
    if (
      sources.length > 0 &&
      !['DERIVED_FEATURE', 'NEGATIVE_EVIDENCE', 'ANALYST_OBSERVATION'].includes(parsed.kind)
    ) {
      throw new Error(`${parsed.kind} may not derive from another observation.`);
    }
    if (parsed.id !== evidenceIdFor(parsed, sources)) {
      throw new Error(
        'Evidence ID does not match its canonical observation and derivation sources.',
      );
    }
    for (const sourceId of sources) {
      if (!this.#nodes.has(sourceId)) {
        throw new Error(`Source evidence ${sourceId} must exist before derived evidence is added.`);
      }
    }
    if (parsedSnapshot !== undefined) {
      if (parsedSnapshot.ledger !== parsed.ledger || parsedSnapshot.chainId !== parsed.chainId) {
        throw new Error('Evidence snapshot must use the same ledger and chain.');
      }
      const position =
        parsedSnapshot.ledger === 'EVM'
          ? parsedSnapshot.blockNumber
          : parsedSnapshot.ledger === 'BITCOIN'
            ? parsedSnapshot.height
            : parsedSnapshot.slot;
      if (parsed.blockOrSlot !== undefined && parsed.blockOrSlot !== position) {
        throw new Error('Evidence snapshot position does not match the observation.');
      }
    }
    const node = deepFreeze({
      evidence: parsed,
      sourceEvidenceIds: sources,
      ...(parsedSnapshot === undefined ? {} : { snapshot: parsedSnapshot }),
    });
    this.#nodes.set(parsed.id, node);
    return node;
  }

  get(id: string): EvidenceNode | undefined {
    return this.#nodes.get(id);
  }

  drilldown(id: string): EvidenceNode[] {
    const root = this.#nodes.get(id);
    if (root === undefined) return [];
    const result: EvidenceNode[] = [];
    const visited = new Set<string>();
    const visit = (node: EvidenceNode) => {
      if (visited.has(node.evidence.id)) return;
      visited.add(node.evidence.id);
      result.push(node);
      for (const sourceId of node.sourceEvidenceIds) {
        const source = this.#nodes.get(sourceId);
        if (source !== undefined) visit(source);
      }
    };
    visit(root);
    return result;
  }

  values(): EvidenceNode[] {
    return [...this.#nodes.values()];
  }
}
