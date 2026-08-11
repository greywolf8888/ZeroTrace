import {
  createDataQualityAlert,
  persistChainAnchorObservation,
  type ChainAnchorReader,
  type DataQualityEvidenceWriter,
  type DataQualityRepository,
} from '@zerotrace/data-quality';
import { createEvidence } from '@zerotrace/evidence';
import {
  AnchorReconciliationResultSchema,
  ChainAnchorReadSchema,
  FlapLifetimeRollbackSchema,
  type AnchorReconciliationResult,
  type ChainAnchorRead,
  type FlapLifetimeRollback,
} from '@zerotrace/schemas';
import type {
  FlapLifetimeHead,
  FlapLifetimeHeadInvalidation,
  PutFlapLifetimeHeadInvalidationInput,
} from '@zerotrace/storage';

export type FlapLifetimeRollbackErrorCode =
  | 'LIFETIME_ROLLBACK_RECONCILIATION_REQUIRED'
  | 'LIFETIME_ROLLBACK_LINEAGE_INVALID'
  | 'LIFETIME_ROLLBACK_SOURCE_UNAVAILABLE'
  | 'LIFETIME_ROLLBACK_SOURCE_DISAGREEMENT'
  | 'LIFETIME_ROLLBACK_NOT_REQUIRED';

export class FlapLifetimeRollbackError extends Error {
  readonly code: FlapLifetimeRollbackErrorCode;
  readonly retryable: boolean;

  constructor(code: FlapLifetimeRollbackErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'FlapLifetimeRollbackError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface FlapLifetimeRollbackStore {
  putInvalidation(
    input: PutFlapLifetimeHeadInvalidationInput,
  ): Promise<FlapLifetimeHeadInvalidation>;
}

export interface ResolveFlapLifetimeRollbackOptions {
  token: string;
  target: ChainAnchorRead;
  reconciliation: AnchorReconciliationResult;
  activeLineage: readonly FlapLifetimeHead[];
  readers: readonly ChainAnchorReader[];
  evidence: DataQualityEvidenceWriter;
  repository: DataQualityRepository;
  heads: FlapLifetimeRollbackStore;
  nowImplementation?: () => Date;
}

interface Participant {
  reader: ChainAnchorReader;
  targetEvidenceId: string;
}

interface HistoricalCheck {
  source: string;
  hash: string;
  evidenceId: string;
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function reference(head: FlapLifetimeHead) {
  return {
    headId: head.id,
    scanId: head.scanId,
    targetBlock: String(head.targetBlock),
    targetHash: head.targetHash,
    terminalEvidenceId: head.terminalEvidenceId,
  };
}

function validateLineage(token: string, lineage: readonly FlapLifetimeHead[]): void {
  if (lineage.length === 0) {
    throw new FlapLifetimeRollbackError(
      'LIFETIME_ROLLBACK_LINEAGE_INVALID',
      'Flap lifetime rollback requires a non-empty active lineage.',
    );
  }
  for (let index = 0; index < lineage.length; index += 1) {
    const current = lineage[index];
    const parent = lineage[index + 1];
    if (
      current === undefined ||
      current.chainId !== 'eip155:56' ||
      current.token !== token ||
      current.predecessorId !== (parent?.id ?? null) ||
      (parent !== undefined && current.targetBlock <= parent.targetBlock)
    ) {
      throw new FlapLifetimeRollbackError(
        'LIFETIME_ROLLBACK_LINEAGE_INVALID',
        'Flap lifetime rollback lineage is disconnected or inconsistent.',
      );
    }
  }
}

function participants(
  reconciliation: AnchorReconciliationResult,
  target: ChainAnchorRead,
  readers: readonly ChainAnchorReader[],
): Participant[] {
  const bySource = new Map(readers.map((reader) => [reader.sourceId, reader]));
  return reconciliation.sources.flatMap((assessment) => {
    const reader = bySource.get(assessment.source);
    return reader !== undefined &&
      assessment.comparison.state === 'known' &&
      assessment.comparison.value.position === target.anchor.position &&
      assessment.comparison.value.hash === target.anchor.hash
      ? [{ reader, targetEvidenceId: assessment.comparison.value.evidenceId }]
      : [];
  });
}

async function persistHistoricalCheck(
  reader: ChainAnchorReader,
  head: FlapLifetimeHead,
  evidence: DataQualityEvidenceWriter,
  repository: DataQualityRepository,
): Promise<HistoricalCheck> {
  const position = String(head.targetBlock);
  const read = ChainAnchorReadSchema.parse(await reader.readAt(position));
  if (
    read.anchor.source !== reader.sourceId ||
    read.anchor.ledger !== 'EVM' ||
    read.anchor.chainId !== 'eip155:56' ||
    read.anchor.position !== position ||
    read.anchor.finality !== 'finalized'
  ) {
    throw new FlapLifetimeRollbackError(
      'LIFETIME_ROLLBACK_SOURCE_UNAVAILABLE',
      'A rollback source returned an invalid historical BSC anchor.',
      true,
    );
  }
  const observation = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'BLOCK',
    source: reader.sourceId,
    locator: `flap-lifetime-rollback-check:${head.token}:${position}:${read.anchor.hash}`,
    payload: read.payload,
    observedAt: read.anchor.observedAt,
    blockOrSlot: position,
    finality: 'finalized',
    summary: `BSC rollback anchor ${position} from ${reader.sourceId}.`,
  });
  const stored = await evidence.put(observation, [], read.snapshot);
  await repository.putAnchor(
    persistChainAnchorObservation(read, 'CONTINUITY_CHECK', stored.evidence.id),
  );
  return { source: reader.sourceId, hash: read.anchor.hash, evidenceId: stored.evidence.id };
}

async function persistDisagreementAlert(
  options: ResolveFlapLifetimeRollbackOptions,
  head: FlapLifetimeHead,
  checks: readonly HistoricalCheck[],
): Promise<void> {
  await options.repository.putAlert(
    createDataQualityAlert({
      kind: 'CROSS_SOURCE_DISAGREEMENT',
      severity: 'CRITICAL',
      ledger: 'EVM',
      chainId: 'eip155:56',
      position: String(head.targetBlock),
      summary: 'Rollback sources disagree at an accepted Flap lifetime position.',
      details: {
        token: options.token,
        headId: head.id,
        expectedHash: head.targetHash,
        observations: checks
          .map((check) => ({ source: check.source, hash: check.hash }))
          .sort((left, right) => left.source.localeCompare(right.source)),
      },
      evidenceIds: canonical([head.terminalEvidenceId, ...checks.map((check) => check.evidenceId)]),
      observedAt: (options.nowImplementation ?? (() => new Date()))().toISOString(),
      modelVersion: 'flap-lifetime-rollback-v1',
    }),
  );
}

export async function resolveFlapLifetimeRollback(
  options: ResolveFlapLifetimeRollbackOptions,
): Promise<FlapLifetimeHeadInvalidation> {
  const reconciliation = AnchorReconciliationResultSchema.parse(options.reconciliation);
  const target = ChainAnchorReadSchema.parse(options.target);
  if (
    reconciliation.status !== 'AGREEMENT' ||
    reconciliation.canonicalAnchor.state !== 'known' ||
    reconciliation.ledger !== 'EVM' ||
    reconciliation.chainId !== 'eip155:56' ||
    target.anchor.position !== reconciliation.canonicalAnchor.value.position ||
    target.anchor.hash !== reconciliation.canonicalAnchor.value.hash ||
    target.snapshot.ledger !== 'EVM' ||
    target.snapshot.finality !== 'finalized'
  ) {
    throw new FlapLifetimeRollbackError(
      'LIFETIME_ROLLBACK_RECONCILIATION_REQUIRED',
      'Flap lifetime rollback requires one exact agreed finalized BSC target.',
      true,
    );
  }
  validateLineage(options.token, options.activeLineage);
  const activeHead = options.activeLineage[0] as FlapLifetimeHead;
  if (BigInt(target.anchor.position) < BigInt(activeHead.targetBlock)) {
    throw new FlapLifetimeRollbackError(
      'LIFETIME_ROLLBACK_RECONCILIATION_REQUIRED',
      'A regressed provider head cannot authorize automatic rollback.',
      true,
    );
  }
  const participating = participants(reconciliation, target, options.readers);
  if (
    participating.length < reconciliation.requiredSources ||
    participating.length !== reconciliation.observedSources
  ) {
    throw new FlapLifetimeRollbackError(
      'LIFETIME_ROLLBACK_SOURCE_UNAVAILABLE',
      'Every agreed rollback source must be available for historical verification.',
      true,
    );
  }

  const allCheckEvidenceIds = canonical(
    participating.map((participant) => participant.targetEvidenceId),
  );
  let survivorIndex = -1;
  for (let index = 0; index < options.activeLineage.length; index += 1) {
    const head = options.activeLineage[index] as FlapLifetimeHead;
    let checks: HistoricalCheck[];
    if (String(head.targetBlock) === target.anchor.position) {
      checks = participating.map((participant) => ({
        source: participant.reader.sourceId,
        hash: target.anchor.hash,
        evidenceId: participant.targetEvidenceId,
      }));
    } else {
      const settled = await Promise.allSettled(
        participating.map((participant) =>
          persistHistoricalCheck(participant.reader, head, options.evidence, options.repository),
        ),
      );
      if (settled.some((item) => item.status === 'rejected')) {
        throw new FlapLifetimeRollbackError(
          'LIFETIME_ROLLBACK_SOURCE_UNAVAILABLE',
          'A rollback source could not verify the active lifetime lineage.',
          true,
        );
      }
      checks = settled.map((item) => (item as PromiseFulfilledResult<HistoricalCheck>).value);
      allCheckEvidenceIds.push(...checks.map((check) => check.evidenceId));
    }
    const hashes = canonical(checks.map((check) => check.hash));
    if (hashes.length !== 1) {
      await persistDisagreementAlert(options, head, checks);
      throw new FlapLifetimeRollbackError(
        'LIFETIME_ROLLBACK_SOURCE_DISAGREEMENT',
        'Rollback sources disagree; no canonical lifetime branch was selected.',
        true,
      );
    }
    if (hashes[0] === head.targetHash) {
      survivorIndex = index;
      break;
    }
  }

  if (survivorIndex === 0) {
    throw new FlapLifetimeRollbackError(
      'LIFETIME_ROLLBACK_NOT_REQUIRED',
      'The active Flap lifetime head still matches the agreed finalized chain.',
    );
  }
  const invalidatedNewestFirst =
    survivorIndex < 0 ? [...options.activeLineage] : options.activeLineage.slice(0, survivorIndex);
  const rollbackTo = survivorIndex < 0 ? undefined : options.activeLineage[survivorIndex];
  const invalidatedHeads = [...invalidatedNewestFirst].reverse();
  const sourceEvidenceIds = canonical([
    ...allCheckEvidenceIds,
    ...invalidatedHeads.map((head) => head.terminalEvidenceId),
    ...(rollbackTo === undefined ? [] : [rollbackTo.terminalEvidenceId]),
  ]);
  const invalidatedFrom = invalidatedHeads[0] as FlapLifetimeHead;
  const invalidatedThrough = invalidatedHeads[invalidatedHeads.length - 1] as FlapLifetimeHead;
  const alert = await options.repository.putAlert(
    createDataQualityAlert({
      kind: 'REORG_DETECTED',
      severity: 'CRITICAL',
      ledger: 'EVM',
      chainId: 'eip155:56',
      position: String(invalidatedFrom.targetBlock),
      summary: 'Accepted Flap lifetime suffix conflicts with agreed finalized BSC history.',
      details: {
        token: options.token,
        invalidatedFromHeadId: invalidatedFrom.id,
        invalidatedThroughHeadId: invalidatedThrough.id,
        rollbackToHeadId: rollbackTo?.id ?? null,
        observedTarget: { position: target.anchor.position, hash: target.anchor.hash },
        sources: participating.map((participant) => participant.reader.sourceId).sort(),
      },
      evidenceIds: sourceEvidenceIds,
      observedAt: (options.nowImplementation ?? (() => new Date()))().toISOString(),
      modelVersion: 'flap-lifetime-rollback-v1',
    }),
  );
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:flap-lifetime-rollback-v1',
    locator:
      `flap-lifetime-rollback:${options.token}:` +
      `${invalidatedFrom.targetBlock}-${target.anchor.position}`,
    payload: {
      modelVersion: 'flap-lifetime-rollback-v1',
      token: options.token,
      invalidatedHeads: invalidatedHeads.map(reference),
      rollbackTo: rollbackTo === undefined ? null : reference(rollbackTo),
      observedTarget: { blockNumber: target.anchor.position, blockHash: target.anchor.hash },
      sources: participating.map((participant) => participant.reader.sourceId).sort(),
      alertId: alert.id,
    },
    observedAt: target.snapshot.capturedAt,
    blockOrSlot: target.anchor.position,
    finality: 'finalized',
    summary: 'Flap lifetime canonical head rolled back to the newest verified ancestor.',
    sourceEvidenceIds,
  });
  const storedTerminal = await options.evidence.put(terminal, sourceEvidenceIds, target.snapshot);
  const evidenceIds = canonical([...sourceEvidenceIds, storedTerminal.evidence.id]);
  const result: FlapLifetimeRollback = FlapLifetimeRollbackSchema.parse({
    chainId: 'eip155:56',
    token: options.token,
    reason: 'FINALIZED_REORG',
    invalidatedHeads: invalidatedHeads.map(reference),
    rollbackTo: rollbackTo === undefined ? null : reference(rollbackTo),
    observedTarget: { blockNumber: target.anchor.position, blockHash: target.anchor.hash },
    lineageCoverage: 1,
    alertId: alert.id,
    terminalEvidenceId: storedTerminal.evidence.id,
    metadata: {
      snapshot: target.snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: target.snapshot.capturedAt,
      sourceSet: participating.map((participant) => participant.reader.sourceId).sort(),
      modelVersion: 'flap-lifetime-rollback-v1',
      confidence: reconciliation.metadata.confidence,
      evidenceIds,
    },
    evidence: [storedTerminal.evidence],
  });
  return options.heads.putInvalidation({ result });
}
