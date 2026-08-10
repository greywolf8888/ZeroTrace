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
  FlapLifetimeContinuityProofSchema,
  knownValue,
  type AnchorReconciliationResult,
  type ChainAnchorRead,
  type FlapLifetimeContinuityProof,
} from '@zerotrace/schemas';
import type { FlapLifetimeHead } from '@zerotrace/storage';

export interface ProveFlapLifetimeContinuityOptions {
  predecessor: FlapLifetimeHead;
  target: ChainAnchorRead;
  reconciliation: AnchorReconciliationResult;
  readers: readonly ChainAnchorReader[];
  evidence: DataQualityEvidenceWriter;
  repository: DataQualityRepository;
  nowImplementation?: () => Date;
}

interface VerifiedSource {
  source: string;
  targetEvidenceId: string;
  checkEvidenceId?: string;
}

function fail(
  code: 'LIFETIME_CONTINUITY_UNAVAILABLE' | 'LIFETIME_FINALIZED_REORG',
  message: string,
  retryable: boolean,
): Error {
  return Object.assign(new Error(message), { code, retryable });
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function predecessorIdentity(head: FlapLifetimeHead) {
  const snapshot = head.result.metadata.snapshot;
  if (
    snapshot?.ledger !== 'EVM' ||
    snapshot.chainId !== 'eip155:56' ||
    snapshot.blockNumber !== String(head.targetBlock) ||
    snapshot.blockHash !== head.targetHash ||
    snapshot.finality !== 'finalized'
  ) {
    throw fail(
      'LIFETIME_FINALIZED_REORG',
      'Stored Flap lifetime predecessor Snapshot is inconsistent.',
      false,
    );
  }
  return snapshot;
}

async function persistCheck(
  reader: ChainAnchorReader,
  position: string,
  evidence: DataQualityEvidenceWriter,
  repository: DataQualityRepository,
) {
  const read = ChainAnchorReadSchema.parse(await reader.readAt(position));
  if (
    read.anchor.source !== reader.sourceId ||
    read.anchor.ledger !== 'EVM' ||
    read.anchor.chainId !== 'eip155:56' ||
    read.anchor.position !== position ||
    read.anchor.finality !== 'finalized'
  ) {
    throw fail(
      'LIFETIME_CONTINUITY_UNAVAILABLE',
      'A continuity provider returned an invalid predecessor anchor.',
      true,
    );
  }
  const observation = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'BLOCK',
    source: reader.sourceId,
    locator: `flap-lifetime-continuity:${position}:${read.anchor.hash}`,
    payload: read.payload,
    observedAt: read.anchor.observedAt,
    blockOrSlot: position,
    finality: 'finalized',
    summary: `BSC predecessor anchor ${position} from ${reader.sourceId}.`,
  });
  const stored = await evidence.put(observation, [], read.snapshot);
  await repository.putAnchor(
    persistChainAnchorObservation(read, 'CONTINUITY_CHECK', stored.evidence.id),
  );
  return { read, evidenceId: stored.evidence.id };
}

export async function proveFlapLifetimeContinuity(
  options: ProveFlapLifetimeContinuityOptions,
): Promise<FlapLifetimeContinuityProof> {
  const reconciliation = AnchorReconciliationResultSchema.parse(options.reconciliation);
  const target = ChainAnchorReadSchema.parse(options.target);
  const predecessorSnapshot = predecessorIdentity(options.predecessor);
  if (
    reconciliation.status !== 'AGREEMENT' ||
    reconciliation.canonicalAnchor.state !== 'known' ||
    reconciliation.ledger !== 'EVM' ||
    reconciliation.chainId !== 'eip155:56' ||
    target.anchor.position !== reconciliation.canonicalAnchor.value.position ||
    target.anchor.hash !== reconciliation.canonicalAnchor.value.hash ||
    BigInt(target.anchor.position) <= BigInt(options.predecessor.targetBlock)
  ) {
    throw fail(
      'LIFETIME_CONTINUITY_UNAVAILABLE',
      'Continuity proof requires an advancing agreed finalized BSC target.',
      true,
    );
  }
  const readers = new Map(options.readers.map((reader) => [reader.sourceId, reader]));
  const participants = reconciliation.sources.flatMap((assessment) => {
    const reader = readers.get(assessment.source);
    return reader !== undefined &&
      assessment.comparison.state === 'known' &&
      assessment.comparison.value.position === target.anchor.position &&
      assessment.comparison.value.hash === target.anchor.hash
      ? [{ reader, targetEvidenceId: assessment.comparison.value.evidenceId }]
      : [];
  });
  if (participants.length < reconciliation.requiredSources) {
    throw fail(
      'LIFETIME_CONTINUITY_UNAVAILABLE',
      'Fewer than the required agreed sources can prove lifetime continuity.',
      true,
    );
  }

  const direct =
    target.anchor.parentPosition === String(options.predecessor.targetBlock) &&
    target.anchor.parentHash === options.predecessor.targetHash;
  const verified: VerifiedSource[] = [];
  const mismatches: VerifiedSource[] = [];
  if (direct) {
    verified.push(
      ...participants.map((participant) => ({
        source: participant.reader.sourceId,
        targetEvidenceId: participant.targetEvidenceId,
      })),
    );
  } else {
    const checks = await Promise.allSettled(
      participants.map(async (participant) => ({
        participant,
        check: await persistCheck(
          participant.reader,
          String(options.predecessor.targetBlock),
          options.evidence,
          options.repository,
        ),
      })),
    );
    for (const check of checks) {
      if (check.status !== 'fulfilled') continue;
      const item = {
        source: check.value.participant.reader.sourceId,
        targetEvidenceId: check.value.participant.targetEvidenceId,
        checkEvidenceId: check.value.check.evidenceId,
      };
      if (check.value.check.read.anchor.hash === options.predecessor.targetHash)
        verified.push(item);
      else mismatches.push(item);
    }
  }

  if (mismatches.length > 0) {
    const evidenceIds = canonical([
      options.predecessor.terminalEvidenceId,
      ...mismatches.flatMap((item) => [item.targetEvidenceId, item.checkEvidenceId ?? '']),
    ]).filter((id) => id !== '');
    await options.repository.putAlert(
      createDataQualityAlert({
        kind: 'REORG_DETECTED',
        severity: 'CRITICAL',
        ledger: 'EVM',
        chainId: 'eip155:56',
        position: String(options.predecessor.targetBlock),
        summary: 'Accepted Flap lifetime predecessor hash changed at a finalized BSC position.',
        details: {
          token: options.predecessor.token,
          predecessorHeadId: options.predecessor.id,
          expectedHash: options.predecessor.targetHash,
          mismatchingSources: mismatches.map((item) => item.source).sort(),
        },
        evidenceIds,
        observedAt: (options.nowImplementation ?? (() => new Date()))().toISOString(),
        modelVersion: 'flap-lifetime-continuity-v1',
      }),
    );
    throw fail(
      'LIFETIME_FINALIZED_REORG',
      'A finalized BSC source conflicts with the accepted lifetime predecessor.',
      false,
    );
  }
  if (verified.length < reconciliation.requiredSources) {
    throw fail(
      'LIFETIME_CONTINUITY_UNAVAILABLE',
      'Fewer than the required sources verified the accepted predecessor hash.',
      true,
    );
  }

  const sourceEvidenceIds = canonical([
    options.predecessor.terminalEvidenceId,
    ...verified.flatMap((item) => [item.targetEvidenceId, item.checkEvidenceId ?? '']),
  ]).filter((id) => id !== '');
  const status = direct ? 'DIRECT_EXTENSION' : 'HISTORICAL_MATCH';
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace-data-quality',
    locator:
      `flap-lifetime-continuity:${options.predecessor.token}:` +
      `${options.predecessor.targetBlock}:${target.anchor.position}`,
    payload: {
      modelVersion: 'flap-lifetime-continuity-v1',
      status,
      predecessor: {
        headId: options.predecessor.id,
        position: String(options.predecessor.targetBlock),
        hash: predecessorSnapshot.blockHash,
      },
      target: {
        position: target.anchor.position,
        hash: target.anchor.hash,
      },
      sources: verified.map((item) => item.source).sort(),
    },
    observedAt: target.snapshot.capturedAt,
    blockOrSlot: target.anchor.position,
    finality: 'finalized',
    summary: `Flap lifetime predecessor-to-target continuity is ${status.toLowerCase()}.`,
    sourceEvidenceIds,
  });
  const stored = await options.evidence.put(terminal, sourceEvidenceIds, target.snapshot);
  return FlapLifetimeContinuityProofSchema.parse({
    status,
    continuous: knownValue(true),
    evidenceIds: canonical([...sourceEvidenceIds, stored.evidence.id]),
    terminalEvidenceId: stored.evidence.id,
  });
}
