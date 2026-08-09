import { createHash } from 'node:crypto';

import { EvidenceSchema, type Evidence, type EvidenceKind, type Ledger } from '@zerotrace/schemas';

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

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
}

export function createEvidence(input: CreateEvidenceInput): Evidence {
  const payloadHash = hashPayload(input.payload);
  const evidence: Evidence = {
    id: `ev_${payloadHash.slice(0, 24)}`,
    ledger: input.ledger,
    chainId: input.chainId,
    kind: input.kind,
    source: input.source,
    locator: input.locator,
    payloadHash,
    observedAt: input.observedAt ?? new Date().toISOString(),
    summary: input.summary,
    ...(input.sourceUri === undefined ? {} : { sourceUri: input.sourceUri }),
    ...(input.blockOrSlot === undefined ? {} : { blockOrSlot: input.blockOrSlot }),
    ...(input.finality === undefined ? {} : { finality: input.finality }),
    ...(input.rawArtifactRef === undefined ? {} : { rawArtifactRef: input.rawArtifactRef }),
  };
  return EvidenceSchema.parse(evidence);
}

export interface EvidenceNode {
  evidence: Evidence;
  sourceEvidenceIds: string[];
}

export class EvidenceLedger {
  readonly #nodes = new Map<string, EvidenceNode>();

  add(evidence: Evidence, sourceEvidenceIds: readonly string[] = []): EvidenceNode {
    const parsed = EvidenceSchema.parse(evidence);
    if (this.#nodes.has(parsed.id)) {
      throw new Error(`Evidence ${parsed.id} already exists; observations are immutable.`);
    }
    for (const sourceId of sourceEvidenceIds) {
      if (!this.#nodes.has(sourceId)) {
        throw new Error(`Source evidence ${sourceId} must exist before derived evidence is added.`);
      }
    }
    if (
      (parsed.kind === 'DERIVED_FEATURE' || parsed.kind === 'NEGATIVE_EVIDENCE') &&
      sourceEvidenceIds.length === 0
    ) {
      throw new Error(`${parsed.kind} must link to at least one source observation.`);
    }
    const node = {
      evidence: Object.freeze({ ...parsed }),
      sourceEvidenceIds: [...sourceEvidenceIds],
    };
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
