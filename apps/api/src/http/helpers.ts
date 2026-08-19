import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProviderError } from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import type { EvidenceNode } from '@zerotrace/evidence';
import { ForensicCaseBundleError, buildForensicCaseBundle } from '@zerotrace/forensic-evidence';
import { StorageError, type StoredSolanaTransactionReport, type StoredControlCampaignReport } from '@zerotrace/storage';
import { knownValue, unavailableValue, unknownValue, type AnalysisMetadata, type AnalysisSnapshot, type Evidence, type ControlCampaignBundle } from '@zerotrace/schemas';
import type { AppRuntime } from '../runtime.js';

export function errorResponse(request: FastifyRequest, code: string, message: string, retryable: boolean) {
  return { error: { code, message, requestId: request.id, retryable } };
}

export function emptyMetadata(modelVersion: string, confidence = 0): AnalysisMetadata {
  return {
    snapshot: null,
    dataCoverage: 0,
    sourceCoverage: 0,
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: null,
    sourceSet: [],
    modelVersion,
    confidence,
    evidenceIds: [],
  };
}

export function solanaTransactionReportResponse(
  record: StoredSolanaTransactionReport,
  replayed: boolean,
  liveRefresh:
    ReturnType<typeof unavailableValue> | ReturnType<typeof knownValue<boolean>> = knownValue(true),
) {
  return {
    ...record.report,
    durableReport: {
      id: record.id,
      resultHash: record.resultHash,
      createdAt: record.createdAt,
      capturedAt: record.capturedAt,
      replayed,
      liveRefresh,
    },
  };
}

export function controlCampaignResponse(record: StoredControlCampaignReport, replayed = false) {
  return {
    ...record.bundle,
    durableReport: {
      id: record.id,
      resultHash: record.resultHash,
      createdAt: record.createdAt,
      capturedAt: record.capturedAt,
      replayed,
      liveRefresh: replayed
        ? unknownValue('NOT_QUERIED', 'Replay is provider-free.')
        : unknownValue('NOT_QUERIED', 'No live monitor refresh was requested.'),
    },
  };
}

export async function getEvidenceNode(runtime: AppRuntime, id: string) {
  return runtime.evidenceLedger.get(id) ?? runtime.evidenceRepository?.get(id);
}

export function forensicCaseRootEvidenceIds(campaign: ControlCampaignBundle): string[] {
  return [
    ...campaign.campaign.metadata.evidenceIds,
    ...campaign.clusterVersion.membershipEvidenceIds,
    ...campaign.memberships.flatMap((membership) => membership.evidenceIds),
    ...campaign.positions.flatMap((position) => [
      ...position.positionEvidenceIds,
      ...position.membershipEvidenceIds,
    ]),
    ...campaign.behaviorEvents.flatMap((event) => [
      ...event.supportingEvidenceIds,
      ...event.contradictingEvidenceIds,
      ...event.featureVector.flatMap((feature) => feature.evidenceIds),
    ]),
    ...campaign.evidenceItems.flatMap((item) => [item.evidenceId, ...item.parentEvidenceIds]),
    ...campaign.evidenceLine.evidenceIds,
  ]
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .sort();
}

export async function forensicCaseEvidenceClosure(
  runtime: AppRuntime,
  campaign: ControlCampaignBundle,
): Promise<EvidenceNode[]> {
  const nodes = new Map<string, EvidenceNode>();
  for (const rootId of forensicCaseRootEvidenceIds(campaign)) {
    const drilled =
      runtime.evidenceRepository === undefined
        ? runtime.evidenceLedger.drilldown(rootId)
        : await runtime.evidenceRepository.drilldown(rootId);
    for (const node of drilled) nodes.set(node.evidence.id, node);
  }
  return [...nodes.values()];
}

export async function forensicCaseBundleForCampaign(
  runtime: AppRuntime,
  record: StoredControlCampaignReport,
) {
  const evidenceNodes = await forensicCaseEvidenceClosure(runtime, record.bundle);
  return buildForensicCaseBundle({
    campaign: record.bundle,
    evidenceNodes,
    gitCommit: process.env.GIT_COMMIT ?? null,
  });
}

export function forensicCaseBundleError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: ForensicCaseBundleError,
) {
  return reply.code(422).send({
    status: unknownValue('INSUFFICIENT_DATA', error.message),
    metadata: emptyMetadata('forensic-case-bundle-v1'),
    forensicCode: error.code,
    error: errorResponse(request, `FORENSIC_${error.code}`, error.message, false).error,
  });
}

export async function addEvidence(
  runtime: AppRuntime,
  evidence: Evidence,
  sourceEvidenceIds: readonly string[] = [],
  snapshot?: AnalysisSnapshot,
): Promise<Evidence> {
  const existing = await getEvidenceNode(runtime, evidence.id);
  if (existing !== undefined) {
    const normalizedSources = uniqueEvidenceIds(sourceEvidenceIds).sort();
    if (
      hashPayload(existing.evidence) !== hashPayload(evidence) ||
      hashPayload(existing.sourceEvidenceIds) !== hashPayload(normalizedSources)
    ) {
      throw new StorageError(
        'EVIDENCE_CONFLICT',
        'Existing Evidence conflicts with the canonical observation.',
      );
    }
    if (hashPayload(existing.snapshot ?? null) !== hashPayload(snapshot ?? null)) {
      throw new StorageError('SNAPSHOT_CONFLICT', 'Existing Evidence uses a different Snapshot.');
    }
    return existing.evidence;
  }
  const stored = await runtime.evidenceRepository?.put(evidence, sourceEvidenceIds, snapshot);
  if (sourceEvidenceIds.every((id) => runtime.evidenceLedger.get(id) !== undefined)) {
    runtime.evidenceLedger.add(evidence, sourceEvidenceIds, snapshot);
  }
  return stored?.evidence ?? evidence;
}

export function uniqueEvidenceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function uniqueSourceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

export function canonicalSubjectPair(subjectA: string, subjectB: string): [string, string] {
  return subjectA < subjectB ? [subjectA, subjectB] : [subjectB, subjectA];
}

export function evidenceSourceId(ids: readonly string[]): string {
  return uniqueSourceIds(ids).join('|');
}

export function snapshotSourceIds(snapshot: AnalysisSnapshot): string[] {
  return Object.keys(snapshot.providerVersions);
}

export async function missingEvidenceIds(runtime: AppRuntime, ids: readonly string[]): Promise<string[]> {
  const unique = uniqueEvidenceIds(ids);
  const nodes = await Promise.all(unique.map((id) => getEvidenceNode(runtime, id)));
  return unique.filter((_id, index) => nodes[index] === undefined);
}

export function snapshotPosition(snapshot: AnalysisSnapshot): {
  blockOrSlot: string;
  finality: string;
} {
  switch (snapshot.ledger) {
    case 'EVM':
      return { blockOrSlot: snapshot.blockNumber, finality: snapshot.finality };
    case 'BITCOIN':
      return { blockOrSlot: snapshot.height, finality: snapshot.finality };
    case 'SOLANA':
      return { blockOrSlot: snapshot.slot, finality: snapshot.commitment };
  }
}

export async function incompatibleEvidenceIds(
  runtime: AppRuntime,
  ids: readonly string[],
  snapshot: AnalysisSnapshot,
): Promise<string[]> {
  const position = snapshotPosition(snapshot);
  const unique = uniqueEvidenceIds(ids);
  const nodes = await Promise.all(unique.map((id) => getEvidenceNode(runtime, id)));
  return unique.filter((_id, index) => {
    const node = nodes[index];
    if (node === undefined) return false;
    if (
      node.evidence.ledger !== snapshot.ledger ||
      node.evidence.chainId !== snapshot.chainId ||
      node.evidence.blockOrSlot !== position.blockOrSlot
    ) {
      return true;
    }
    return node.snapshot === undefined || hashPayload(node.snapshot) !== hashPayload(snapshot);
  });
}

export async function addDerivedAnalysisEvidence(
  runtime: AppRuntime,
  snapshot: AnalysisSnapshot,
  sourceEvidenceIds: readonly string[],
  source: string,
  locator: string,
  payload: unknown,
  summary: string,
): Promise<Evidence> {
  const position = snapshotPosition(snapshot);
  return addEvidence(
    runtime,
    createEvidence({
      ledger: snapshot.ledger,
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source,
      locator,
      payload,
      blockOrSlot: position.blockOrSlot,
      finality: position.finality,
      summary,
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    snapshot,
  );
}

export function rejectUngroundedAnalysis(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
  evidenceIds: readonly string[] = [],
  evidenceIssue: 'MISSING' | 'SNAPSHOT_INCOMPATIBLE' = 'MISSING',
) {
  return reply.code(422).send({
    ...errorResponse(request, 'UNGROUNDED_ANALYSIS', message, false),
    evidenceIssue: { kind: evidenceIssue, evidenceIds: [...evidenceIds] },
  });
}

export function bindRequestAbort(
  request: FastifyRequest,
  reply: FastifyReply,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const socket = request.raw.socket;
  const disconnectPoll = setInterval(() => {
    if (request.raw.aborted || socket?.destroyed || reply.raw.destroyed) abort();
  }, 250);
  disconnectPoll.unref?.();
  request.raw.once('aborted', abort);
  socket?.once('close', abort);
  reply.raw.once('close', abort);
  return {
    signal: controller.signal,
    cleanup: () => {
      request.raw.removeListener('aborted', abort);
      socket?.removeListener('close', abort);
      reply.raw.removeListener('close', abort);
      clearInterval(disconnectPoll);
    },
  };
}

export function capabilityNotImplemented(
  request: FastifyRequest,
  reply: FastifyReply,
  capability: string,
) {
  return reply.code(501).send({
    capability,
    status: unknownValue(
      'NOT_IMPLEMENTED',
      'The production adapter is not implemented in this release.',
    ),
    metadata: emptyMetadata(`${capability}-v0`),
    error: errorResponse(
      request,
      'CAPABILITY_NOT_IMPLEMENTED',
      `${capability} is not implemented.`,
      false,
    ).error,
  });
}

export function parseHexQuantity(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value))
    throw new ProviderError('INVALID_RESPONSE', `Invalid ${field}.`);
  return BigInt(value).toString();
}
