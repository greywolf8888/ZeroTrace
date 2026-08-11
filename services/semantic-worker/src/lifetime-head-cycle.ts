import type {
  FlapLifetimeExtensionRun,
  FlapLifetimeMaterializationRun,
} from '@zerotrace/platform-adapters';
import {
  AnchorReconciliationResultSchema,
  ChainAnchorReadSchema,
  FlapLifetimeContinuityProofSchema,
  FlapLifetimeStateSchema,
  type AnchorReconciliationResult,
  type ChainAnchorRead,
  type FlapLifetimeContinuityProof,
} from '@zerotrace/schemas';
import type { FlapLifetimeHead, FlapLifetimeHeadInvalidation } from '@zerotrace/storage';

export type FlapLifetimeHeadCycleErrorCode =
  | 'LIFETIME_RECONCILIATION_REQUIRED'
  | 'LIFETIME_RECONCILIATION_INVALID'
  | 'LIFETIME_HEAD_REGRESSION'
  | 'LIFETIME_FINALIZED_REORG'
  | 'LIFETIME_MATERIALIZATION_INCOMPLETE'
  | 'LIFETIME_EXTENSION_INCOMPLETE';

export class FlapLifetimeHeadCycleError extends Error {
  readonly code: FlapLifetimeHeadCycleErrorCode;
  readonly retryable: boolean;

  constructor(code: FlapLifetimeHeadCycleErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'FlapLifetimeHeadCycleError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface FlapLifetimeHeadStore {
  latestHead(chainId: string, token: string): Promise<FlapLifetimeHead | undefined>;
  listActiveLineage(chainId: string, token: string): Promise<FlapLifetimeHead[]>;
  putHead(input: { scanId: string; result: FlapLifetimeHead['result'] }): Promise<FlapLifetimeHead>;
}

export interface RunFlapLifetimeHeadCycleOptions {
  token: string;
  reconciliation: AnchorReconciliationResult;
  heads: FlapLifetimeHeadStore;
  materialize(target: ChainAnchorRead): Promise<FlapLifetimeMaterializationRun>;
  proveContinuity(
    predecessor: FlapLifetimeHead,
    target: ChainAnchorRead,
    reconciliation: AnchorReconciliationResult,
  ): Promise<FlapLifetimeContinuityProof>;
  extend(
    predecessor: FlapLifetimeHead,
    continuity: FlapLifetimeContinuityProof,
    target: ChainAnchorRead,
  ): Promise<FlapLifetimeExtensionRun>;
  resolveReorg(
    predecessor: FlapLifetimeHead,
    target: ChainAnchorRead,
    reconciliation: AnchorReconciliationResult,
    activeLineage: readonly FlapLifetimeHead[],
  ): Promise<FlapLifetimeHeadInvalidation>;
}

export type FlapLifetimeHeadCycleResult =
  | {
      action: 'INITIALIZED' | 'EXTENDED' | 'UNCHANGED';
      targetBlock: string;
      targetHash: string;
      head: FlapLifetimeHead;
    }
  | {
      action: 'ROLLED_BACK';
      targetBlock: string;
      targetHash: string;
      head: FlapLifetimeHead | undefined;
      invalidation: FlapLifetimeHeadInvalidation;
    };

export function reconciledFlapTarget(input: AnchorReconciliationResult): ChainAnchorRead {
  const reconciliation = AnchorReconciliationResultSchema.parse(input);
  if (
    reconciliation.ledger !== 'EVM' ||
    reconciliation.chainId !== 'eip155:56' ||
    reconciliation.status !== 'AGREEMENT' ||
    reconciliation.canonicalAnchor.state !== 'known' ||
    reconciliation.comparisonPosition.state !== 'known'
  ) {
    throw new FlapLifetimeHeadCycleError(
      'LIFETIME_RECONCILIATION_REQUIRED',
      'Flap lifetime scheduling requires multi-source BSC anchor agreement.',
      true,
    );
  }
  const anchor = reconciliation.canonicalAnchor.value;
  const snapshot = reconciliation.metadata.snapshot;
  const observedAt = reconciliation.metadata.freshness;
  if (
    snapshot === null ||
    snapshot.ledger !== 'EVM' ||
    snapshot.chainId !== 'eip155:56' ||
    snapshot.blockNumber !== anchor.position ||
    snapshot.blockHash !== anchor.hash ||
    snapshot.finality !== 'finalized' ||
    anchor.finality !== 'finalized' ||
    observedAt === null ||
    reconciliation.metadata.sourceSet.length < reconciliation.requiredSources
  ) {
    throw new FlapLifetimeHeadCycleError(
      'LIFETIME_RECONCILIATION_INVALID',
      'Agreed BSC anchor lacks an exact finalized replay Snapshot.',
    );
  }
  const sources = [...new Set(reconciliation.metadata.sourceSet)].sort();
  return ChainAnchorReadSchema.parse({
    anchor: {
      ...anchor,
      source: sources.join('|'),
      observedAt,
    },
    snapshot,
    payload: {
      modelVersion: reconciliation.metadata.modelVersion,
      status: reconciliation.status,
      requiredSources: reconciliation.requiredSources,
      comparisonPosition: anchor.position,
      evidenceIds: reconciliation.metadata.evidenceIds,
    },
  });
}

function requireKnownLifetime(
  run: FlapLifetimeMaterializationRun | FlapLifetimeExtensionRun,
  code: 'LIFETIME_MATERIALIZATION_INCOMPLETE' | 'LIFETIME_EXTENSION_INCOMPLETE',
) {
  const result = FlapLifetimeStateSchema.parse(run.result);
  if (
    result.lifetimeCoverage.state !== 'known' ||
    result.lifetimeCoverage.value !== true ||
    result.metadata.dataCoverage !== 1 ||
    result.metadata.historyCoverage !== 1
  ) {
    throw new FlapLifetimeHeadCycleError(
      code,
      'A lifetime head may be accepted only after exact Known history coverage.',
    );
  }
  return result;
}

export async function runFlapLifetimeHeadCycle(
  options: RunFlapLifetimeHeadCycleOptions,
): Promise<FlapLifetimeHeadCycleResult> {
  const target = reconciledFlapTarget(options.reconciliation);
  const predecessor = await options.heads.latestHead('eip155:56', options.token);
  if (predecessor === undefined) {
    const run = await options.materialize(target);
    const result = requireKnownLifetime(run, 'LIFETIME_MATERIALIZATION_INCOMPLETE');
    const head = await options.heads.putHead({ scanId: run.scanId, result });
    return {
      action: 'INITIALIZED',
      targetBlock: target.anchor.position,
      targetHash: target.anchor.hash,
      head,
    };
  }

  const positionOrder =
    BigInt(target.anchor.position) < BigInt(predecessor.targetBlock)
      ? -1
      : BigInt(target.anchor.position) > BigInt(predecessor.targetBlock)
        ? 1
        : 0;
  if (positionOrder < 0) {
    throw new FlapLifetimeHeadCycleError(
      'LIFETIME_HEAD_REGRESSION',
      'Reconciled finalized BSC head is behind the accepted lifetime head.',
    );
  }
  if (positionOrder === 0) {
    if (target.anchor.hash !== predecessor.targetHash) {
      return rollback(options, predecessor, target);
    }
    return {
      action: 'UNCHANGED',
      targetBlock: target.anchor.position,
      targetHash: target.anchor.hash,
      head: predecessor,
    };
  }

  let continuity: FlapLifetimeContinuityProof;
  try {
    continuity = FlapLifetimeContinuityProofSchema.parse(
      await options.proveContinuity(predecessor, target, options.reconciliation),
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'LIFETIME_FINALIZED_REORG'
    ) {
      return rollback(options, predecessor, target);
    }
    throw error;
  }
  if (continuity.continuous.state !== 'known' || continuity.continuous.value !== true) {
    throw new FlapLifetimeHeadCycleError(
      'LIFETIME_EXTENSION_INCOMPLETE',
      'Finalized predecessor-to-target continuity is not Known.',
    );
  }
  const run = await options.extend(predecessor, continuity, target);
  const result = requireKnownLifetime(run, 'LIFETIME_EXTENSION_INCOMPLETE');
  const head = await options.heads.putHead({ scanId: run.scanId, result });
  return {
    action: 'EXTENDED',
    targetBlock: target.anchor.position,
    targetHash: target.anchor.hash,
    head,
  };
}

async function rollback(
  options: RunFlapLifetimeHeadCycleOptions,
  predecessor: FlapLifetimeHead,
  target: ChainAnchorRead,
): Promise<FlapLifetimeHeadCycleResult> {
  const activeLineage = await options.heads.listActiveLineage('eip155:56', options.token);
  if (activeLineage[0]?.id !== predecessor.id) {
    throw new FlapLifetimeHeadCycleError(
      'LIFETIME_FINALIZED_REORG',
      'Active Flap lifetime lineage changed during rollback resolution.',
      true,
    );
  }
  const invalidation = await options.resolveReorg(
    predecessor,
    target,
    options.reconciliation,
    activeLineage,
  );
  const head = await options.heads.latestHead('eip155:56', options.token);
  return {
    action: 'ROLLED_BACK',
    targetBlock: target.anchor.position,
    targetHash: target.anchor.hash,
    head,
    invalidation,
  };
}
