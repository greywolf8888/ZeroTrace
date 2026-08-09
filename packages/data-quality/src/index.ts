import { createEvidence, hashPayload, type EvidenceNode } from '@zerotrace/evidence';
import {
  AnalysisSnapshotSchema,
  AnchorContinuityAssessmentSchema,
  AnchorReconciliationResultSchema,
  ChainAnchorReadSchema,
  DataQualityAlertSchema,
  PersistedChainAnchorObservationSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type AnchorContinuityAssessment,
  type AnchorReconciliationResult,
  type AnchorSourceAssessment,
  type ChainAnchor,
  type ChainAnchorObservationRole,
  type ChainAnchorRead,
  type DataQualityAlert,
  type KnowledgeReason,
  type Ledger,
  type PersistedChainAnchorObservation,
  type ReconciledChainAnchor,
} from '@zerotrace/schemas';

export * from './discrepancy.js';

export const DATA_QUALITY_MODEL_VERSION = 'anchor-reconciliation-v1';

export interface ChainAnchorReader {
  readonly sourceId: string;
  readonly ledger: Ledger;
  readonly chainId: string;
  readHead(): Promise<ChainAnchorRead>;
  readAt(position: string): Promise<ChainAnchorRead>;
}

export interface AnchorReconciliationTarget {
  ledger: Ledger;
  chainId: string;
  readers: readonly ChainAnchorReader[];
}

export interface DataQualityEvidenceWriter {
  put(
    evidence: EvidenceNode['evidence'],
    sourceEvidenceIds?: readonly string[],
    snapshot?: AnalysisSnapshot,
  ): Promise<EvidenceNode>;
}

export interface DataQualityRepository {
  readonly durable: boolean;
  putAnchor(observation: PersistedChainAnchorObservation): Promise<PersistedChainAnchorObservation>;
  latestHead(
    ledger: Ledger,
    chainId: string,
    source: string,
  ): Promise<PersistedChainAnchorObservation | undefined>;
  putAlert(alert: DataQualityAlert): Promise<DataQualityAlert>;
}

function normalizedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function comparePositions(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function anchorIdentity(anchor: ChainAnchor): ReconciledChainAnchor {
  const common = {
    ledger: anchor.ledger,
    chainId: anchor.chainId,
    position: anchor.position,
    hash: anchor.hash,
    finality: anchor.finality,
    ...(anchor.parentPosition === undefined ? {} : { parentPosition: anchor.parentPosition }),
    ...(anchor.parentHash === undefined ? {} : { parentHash: anchor.parentHash }),
  };
  return common as ReconciledChainAnchor;
}

export function chainAnchorObservationId(
  anchor: ChainAnchor,
  role: ChainAnchorObservationRole,
  evidenceId: string,
): string {
  return `anchor_${hashPayload({ anchor, role, evidenceId }).slice(0, 24)}`;
}

export function persistChainAnchorObservation(
  read: ChainAnchorRead,
  role: ChainAnchorObservationRole,
  evidenceId: string,
): PersistedChainAnchorObservation {
  const parsed = ChainAnchorReadSchema.parse(read);
  return PersistedChainAnchorObservationSchema.parse({
    ...parsed.anchor,
    id: chainAnchorObservationId(parsed.anchor, role, evidenceId),
    role,
    evidenceId,
  });
}

export function createDataQualityAlert(input: Omit<DataQualityAlert, 'id'>): DataQualityAlert {
  const content = {
    ...input,
    evidenceIds: normalizedIds(input.evidenceIds),
  };
  return DataQualityAlertSchema.parse({
    ...content,
    id: `dqa_${hashPayload(content).slice(0, 24)}`,
  });
}

export class MemoryDataQualityRepository implements DataQualityRepository {
  readonly durable = false;
  readonly #anchors = new Map<string, PersistedChainAnchorObservation>();
  readonly #alerts = new Map<string, DataQualityAlert>();

  async putAnchor(
    observation: PersistedChainAnchorObservation,
  ): Promise<PersistedChainAnchorObservation> {
    const parsed = PersistedChainAnchorObservationSchema.parse(observation);
    const existing = this.#anchors.get(parsed.id);
    if (existing !== undefined && hashPayload(existing) !== hashPayload(parsed)) {
      throw new Error('Chain anchor identity conflicts with an existing observation.');
    }
    this.#anchors.set(parsed.id, parsed);
    return parsed;
  }

  async latestHead(
    ledger: Ledger,
    chainId: string,
    source: string,
  ): Promise<PersistedChainAnchorObservation | undefined> {
    return [...this.#anchors.values()]
      .filter(
        (item) =>
          item.role === 'HEAD' &&
          item.ledger === ledger &&
          item.chainId === chainId &&
          item.source === source,
      )
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
  }

  async putAlert(alert: DataQualityAlert): Promise<DataQualityAlert> {
    const parsed = DataQualityAlertSchema.parse(alert);
    const existing = this.#alerts.get(parsed.id);
    if (existing !== undefined && hashPayload(existing) !== hashPayload(parsed)) {
      throw new Error('Data Quality Alert identity conflicts with an existing alert.');
    }
    this.#alerts.set(parsed.id, parsed);
    return parsed;
  }

  anchors(): PersistedChainAnchorObservation[] {
    return [...this.#anchors.values()];
  }

  alerts(): DataQualityAlert[] {
    return [...this.#alerts.values()];
  }
}

interface SuccessfulHead {
  reader: ChainAnchorReader;
  read: ChainAnchorRead;
  observation: PersistedChainAnchorObservation;
  continuity: AnchorContinuityAssessment;
  alerts: DataQualityAlert[];
}

interface SuccessfulComparison extends SuccessfulHead {
  comparisonRead: ChainAnchorRead;
  comparison: PersistedChainAnchorObservation;
}

interface FailedSource {
  reader: ChainAnchorReader;
  reason: KnowledgeReason;
  detail: string;
}

function errorReason(error: unknown): KnowledgeReason {
  if (typeof error !== 'object' || error === null) return 'PROVIDER_DOWN';
  const code = (error as Record<string, unknown>).code;
  if (code === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (code === 'PROVIDER_UNCONFIGURED') return 'PROVIDER_UNCONFIGURED';
  if (code === 'INVALID_RESPONSE') return 'CONFLICTING_SOURCES';
  return 'PROVIDER_DOWN';
}

function safeErrorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'The provider observation is unavailable.';
}

function requireReaderResult(reader: ChainAnchorReader, read: ChainAnchorRead): ChainAnchorRead {
  const parsed = ChainAnchorReadSchema.parse(read);
  if (
    parsed.anchor.source !== reader.sourceId ||
    parsed.anchor.ledger !== reader.ledger ||
    parsed.anchor.chainId !== reader.chainId
  ) {
    throw new Error('Anchor reader returned an observation for a different source or chain.');
  }
  return parsed;
}

function sourceAssessmentFailure(failure: FailedSource): AnchorSourceAssessment {
  return {
    source: failure.reader.sourceId,
    head: unavailableValue(failure.reason, failure.detail),
    comparison: unavailableValue(failure.reason, failure.detail),
  };
}

function sourceAssessmentSuccess(
  item: SuccessfulHead,
  comparison:
    | { read: ChainAnchorRead; observation: PersistedChainAnchorObservation }
    | { reason: KnowledgeReason; detail: string },
): AnchorSourceAssessment {
  return {
    source: item.reader.sourceId,
    head: knownValue(item.observation),
    comparison:
      'observation' in comparison
        ? knownValue(comparison.observation)
        : unavailableValue(comparison.reason, comparison.detail),
    continuity: item.continuity,
  };
}

function reconciledSnapshot(
  comparisons: readonly SuccessfulComparison[],
  capturedAt: string,
): AnalysisSnapshot {
  const ordered = [...comparisons].sort((left, right) =>
    left.reader.sourceId.localeCompare(right.reader.sourceId),
  );
  const first = ordered[0];
  if (first === undefined) throw new Error('A reconciled Snapshot requires observations.');
  const base = first.comparisonRead.snapshot;
  const providerVersions = Object.assign(
    {},
    ...ordered.map((item) => item.comparisonRead.snapshot.providerVersions),
  ) as Record<string, string>;
  const adapterVersions = Object.assign(
    {},
    ...ordered.map((item) => item.comparisonRead.snapshot.adapterVersions),
  ) as Record<string, string>;
  const common = {
    ...base,
    capturedAt,
    providerVersions,
    adapterVersions,
    configHash: hashPayload({
      modelVersion: DATA_QUALITY_MODEL_VERSION,
      sourceSnapshots: ordered.map((item) => ({
        source: item.reader.sourceId,
        configHash: item.comparisonRead.snapshot.configHash,
      })),
    }),
    entityModelVersion: 'entity-model-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
  return AnalysisSnapshotSchema.parse(common);
}

export interface AnchorDataQualityServiceOptions {
  targets: readonly AnchorReconciliationTarget[];
  repository: DataQualityRepository;
  evidence: DataQualityEvidenceWriter;
  requiredSources?: number;
  nowImplementation?: () => Date;
}

export class AnchorDataQualityService {
  readonly #targets: readonly AnchorReconciliationTarget[];
  readonly #repository: DataQualityRepository;
  readonly #evidence: DataQualityEvidenceWriter;
  readonly #requiredSources: number;
  readonly #now: () => Date;
  #inflight: Promise<AnchorReconciliationResult[]> | undefined;

  constructor(options: AnchorDataQualityServiceOptions) {
    if (!Number.isSafeInteger(options.requiredSources ?? 2) || (options.requiredSources ?? 2) < 2) {
      throw new Error('Anchor reconciliation requires at least two sources.');
    }
    const targetIds = options.targets.map((target) => `${target.ledger}:${target.chainId}`);
    if (new Set(targetIds).size !== targetIds.length) {
      throw new Error('Anchor reconciliation targets must be unique by ledger and chain.');
    }
    for (const target of options.targets) {
      const sourceIds = target.readers.map((reader) => reader.sourceId);
      if (new Set(sourceIds).size !== sourceIds.length) {
        throw new Error(`Anchor readers for ${target.chainId} must use unique source IDs.`);
      }
      if (
        target.readers.some(
          (reader) => reader.ledger !== target.ledger || reader.chainId !== target.chainId,
        )
      ) {
        throw new Error(`Anchor reader does not match target ${target.chainId}.`);
      }
    }
    this.#targets = options.targets;
    this.#repository = options.repository;
    this.#evidence = options.evidence;
    this.#requiredSources = options.requiredSources ?? 2;
    this.#now = options.nowImplementation ?? (() => new Date());
  }

  get durable(): boolean {
    return this.#repository.durable;
  }

  configuredSources(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      this.#targets.map((target) => [target.chainId, target.readers.length]),
    );
  }

  inspectAll(): Promise<AnchorReconciliationResult[]> {
    if (this.#inflight !== undefined) return this.#inflight;
    const operation = Promise.all(
      this.#targets.map((target) => this.#inspectTarget(target)),
    ).finally(() => {
      if (this.#inflight === operation) this.#inflight = undefined;
    });
    this.#inflight = operation;
    return operation;
  }

  async #persistRead(
    read: ChainAnchorRead,
    role: ChainAnchorObservationRole,
  ): Promise<PersistedChainAnchorObservation> {
    const parsed = ChainAnchorReadSchema.parse(read);
    const evidence = createEvidence({
      ledger: parsed.anchor.ledger,
      chainId: parsed.anchor.chainId,
      kind: 'BLOCK',
      source: parsed.anchor.source,
      locator: `anchor:${parsed.anchor.position}:${parsed.anchor.hash}`,
      payload: parsed.payload,
      observedAt: parsed.anchor.observedAt,
      blockOrSlot: parsed.anchor.position,
      finality: parsed.anchor.finality,
      summary: `${parsed.anchor.ledger} ${role.toLowerCase()} anchor ${parsed.anchor.position} from ${parsed.anchor.source}.`,
    });
    const storedEvidence = await this.#evidence.put(evidence, [], parsed.snapshot);
    return this.#repository.putAnchor(
      persistChainAnchorObservation(parsed, role, storedEvidence.evidence.id),
    );
  }

  async #derivedEvidence(input: {
    ledger: Ledger;
    chainId: string;
    position: string;
    finality: string;
    locator: string;
    payload: unknown;
    summary: string;
    sourceEvidenceIds: readonly string[];
    observedAt: string;
    snapshot?: AnalysisSnapshot;
  }): Promise<string> {
    const sourceEvidenceIds = normalizedIds(input.sourceEvidenceIds);
    const evidence = createEvidence({
      ledger: input.ledger,
      chainId: input.chainId,
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace-data-quality',
      locator: input.locator,
      payload: input.payload,
      observedAt: input.observedAt,
      blockOrSlot: input.position,
      finality: input.finality,
      summary: input.summary,
      sourceEvidenceIds,
    });
    return (await this.#evidence.put(evidence, sourceEvidenceIds, input.snapshot)).evidence.id;
  }

  async #alert(input: Omit<DataQualityAlert, 'id'>): Promise<DataQualityAlert> {
    return this.#repository.putAlert(createDataQualityAlert(input));
  }

  async #continuity(
    reader: ChainAnchorReader,
    previous: PersistedChainAnchorObservation | undefined,
    current: PersistedChainAnchorObservation,
    checkedAt: string,
  ): Promise<{ assessment: AnchorContinuityAssessment; alerts: DataQualityAlert[] }> {
    if (previous === undefined) {
      return {
        assessment: AnchorContinuityAssessmentSchema.parse({
          source: reader.sourceId,
          status: 'FIRST_OBSERVATION',
          continuous: unknownValue('INSUFFICIENT_DATA', 'No prior anchor exists for this source.'),
          currentAnchorId: current.id,
          evidenceIds: [current.evidenceId],
          alertIds: [],
        }),
        alerts: [],
      };
    }

    let status: AnchorContinuityAssessment['status'] = 'CHECK_UNAVAILABLE';
    let continuous: AnchorContinuityAssessment['continuous'] = unavailableValue(
      'PROVIDER_DOWN',
      'Continuity check did not complete.',
    );
    let check: PersistedChainAnchorObservation | undefined;
    const positionOrder = comparePositions(current.position, previous.position);
    if (positionOrder === 0) {
      if (current.hash === previous.hash) {
        status = 'UNCHANGED';
        continuous = knownValue(true);
      } else {
        status = 'REORG_DETECTED';
        continuous = knownValue(false);
      }
    } else if (positionOrder < 0) {
      status = 'SOURCE_REGRESSION';
      continuous = unknownValue('STALE', 'Provider head moved behind the last observed head.');
    } else if (
      current.parentPosition === previous.position &&
      current.parentHash === previous.hash
    ) {
      status = 'DIRECT_EXTENSION';
      continuous = knownValue(true);
    } else if (current.parentPosition === previous.position) {
      status = 'REORG_DETECTED';
      continuous = knownValue(false);
    } else {
      let candidate: ChainAnchorRead | undefined;
      try {
        candidate = requireReaderResult(reader, await reader.readAt(previous.position));
        if (candidate.anchor.position !== previous.position) {
          throw new Error('Continuity check returned a different position.');
        }
      } catch (error) {
        status = 'CHECK_UNAVAILABLE';
        continuous = unavailableValue(errorReason(error), safeErrorDetail(error));
      }
      if (candidate !== undefined) {
        check = await this.#persistRead(candidate, 'CONTINUITY_CHECK');
        if (check.hash === previous.hash) {
          status = 'HISTORICAL_MATCH';
          continuous = knownValue(true);
        } else {
          status = 'REORG_DETECTED';
          continuous = knownValue(false);
        }
      }
    }

    const sourceEvidenceIds = normalizedIds([
      previous.evidenceId,
      current.evidenceId,
      ...(check === undefined ? [] : [check.evidenceId]),
    ]);
    const derivedEvidenceId =
      status === 'CHECK_UNAVAILABLE'
        ? undefined
        : await this.#derivedEvidence({
            ledger: current.ledger,
            chainId: current.chainId,
            position: current.position,
            finality: current.finality,
            locator: `anchor-continuity:${reader.sourceId}:${previous.position}:${current.position}`,
            payload: {
              modelVersion: DATA_QUALITY_MODEL_VERSION,
              status,
              previous: anchorIdentity(previous),
              current: anchorIdentity(current),
              ...(check === undefined ? {} : { check: anchorIdentity(check) }),
            },
            summary: `${current.ledger} anchor continuity is ${status.toLowerCase()} for ${reader.sourceId}.`,
            sourceEvidenceIds,
            observedAt: checkedAt,
          });
    const evidenceIds = normalizedIds([
      ...sourceEvidenceIds,
      ...(derivedEvidenceId === undefined ? [] : [derivedEvidenceId]),
    ]);
    const alerts: DataQualityAlert[] = [];
    if (status === 'REORG_DETECTED' || status === 'SOURCE_REGRESSION') {
      alerts.push(
        await this.#alert({
          kind: status,
          severity:
            status === 'REORG_DETECTED' && current.finality === 'finalized'
              ? 'CRITICAL'
              : 'WARNING',
          ledger: current.ledger,
          chainId: current.chainId,
          position: current.position,
          summary:
            status === 'REORG_DETECTED'
              ? `Previously observed ${current.ledger} anchor changed for ${reader.sourceId}.`
              : `${reader.sourceId} reported a head behind its previous observation.`,
          details: {
            previousAnchorId: previous.id,
            currentAnchorId: current.id,
            ...(check === undefined ? {} : { checkAnchorId: check.id }),
          },
          evidenceIds,
          observedAt: checkedAt,
          modelVersion: DATA_QUALITY_MODEL_VERSION,
        }),
      );
    }
    return {
      assessment: AnchorContinuityAssessmentSchema.parse({
        source: reader.sourceId,
        status,
        continuous,
        previousAnchorId: previous.id,
        currentAnchorId: current.id,
        ...(check === undefined ? {} : { checkAnchorId: check.id }),
        evidenceIds,
        alertIds: alerts.map((alert) => alert.id),
      }),
      alerts,
    };
  }

  async #readHead(
    reader: ChainAnchorReader,
    checkedAt: string,
  ): Promise<SuccessfulHead | FailedSource> {
    const previous = await this.#repository.latestHead(
      reader.ledger,
      reader.chainId,
      reader.sourceId,
    );
    let read: ChainAnchorRead;
    try {
      read = requireReaderResult(reader, await reader.readHead());
    } catch (error) {
      return {
        reader,
        reason: errorReason(error),
        detail: safeErrorDetail(error),
      };
    }
    const observation = await this.#persistRead(read, 'HEAD');
    const continuity = await this.#continuity(reader, previous, observation, checkedAt);
    return {
      reader,
      read,
      observation,
      continuity: continuity.assessment,
      alerts: continuity.alerts,
    };
  }

  async #inspectTarget(target: AnchorReconciliationTarget): Promise<AnchorReconciliationResult> {
    const checkedAt = this.#now().toISOString();
    const headResults = await Promise.all(
      target.readers.map((reader) => this.#readHead(reader, checkedAt)),
    );
    const successfulHeads = headResults.filter(
      (result): result is SuccessfulHead => 'observation' in result,
    );
    const failedHeads = headResults.filter(
      (result): result is FailedSource => !('observation' in result),
    );
    const comparisonPosition = successfulHeads
      .map((result) => result.observation.position)
      .sort(comparePositions)[0];
    const comparisons = new Map<
      string,
      | { read: ChainAnchorRead; observation: PersistedChainAnchorObservation }
      | { reason: KnowledgeReason; detail: string }
    >();
    if (comparisonPosition !== undefined) {
      await Promise.all(
        successfulHeads.map(async (item) => {
          if (item.observation.position === comparisonPosition) {
            comparisons.set(item.reader.sourceId, {
              read: item.read,
              observation: item.observation,
            });
            return;
          }
          try {
            const read = requireReaderResult(
              item.reader,
              await item.reader.readAt(comparisonPosition),
            );
            if (read.anchor.position !== comparisonPosition) {
              throw new Error('Comparison read returned a different position.');
            }
            comparisons.set(item.reader.sourceId, {
              read,
              observation: await this.#persistRead(read, 'COMPARISON'),
            });
          } catch (error) {
            comparisons.set(item.reader.sourceId, {
              reason: errorReason(error),
              detail: safeErrorDetail(error),
            });
          }
        }),
      );
    }
    const successfulComparisons: SuccessfulComparison[] = successfulHeads.flatMap((item) => {
      const comparison = comparisons.get(item.reader.sourceId);
      return comparison !== undefined && 'observation' in comparison
        ? [{ ...item, comparisonRead: comparison.read, comparison: comparison.observation }]
        : [];
    });
    const groups = new Map<string, SuccessfulComparison[]>();
    for (const item of successfulComparisons) {
      const identityHash = hashPayload(anchorIdentity(item.comparison));
      groups.set(identityHash, [...(groups.get(identityHash) ?? []), item]);
    }
    const observedSources = successfulComparisons.length;
    const status =
      observedSources === 0
        ? 'UNAVAILABLE'
        : observedSources < this.#requiredSources
          ? 'INSUFFICIENT_SOURCES'
          : groups.size === 1
            ? 'AGREEMENT'
            : 'DISAGREEMENT';
    const agreedSnapshot =
      status === 'AGREEMENT' ? reconciledSnapshot(successfulComparisons, checkedAt) : undefined;
    const reconciliationSourceEvidenceIds = normalizedIds(
      successfulComparisons.map((item) => item.comparison.evidenceId),
    );
    let derivedEvidenceId: string | undefined;
    if (comparisonPosition !== undefined && reconciliationSourceEvidenceIds.length > 0) {
      const first = successfulComparisons[0];
      if (first !== undefined) {
        derivedEvidenceId = await this.#derivedEvidence({
          ledger: target.ledger,
          chainId: target.chainId,
          position: comparisonPosition,
          finality: first.comparison.finality,
          locator: `anchor-reconciliation:${target.chainId}:${comparisonPosition}`,
          payload: {
            modelVersion: DATA_QUALITY_MODEL_VERSION,
            status,
            requiredSources: this.#requiredSources,
            configuredSources: target.readers.length,
            observations: successfulComparisons.map((item) => ({
              source: item.reader.sourceId,
              anchor: anchorIdentity(item.comparison),
            })),
          },
          summary: `${target.ledger} anchor reconciliation is ${status.toLowerCase()} at ${comparisonPosition}.`,
          sourceEvidenceIds: reconciliationSourceEvidenceIds,
          observedAt: checkedAt,
          ...(agreedSnapshot === undefined ? {} : { snapshot: agreedSnapshot }),
        });
      }
    }
    const alerts = successfulHeads.flatMap((item) => item.alerts);
    if (status === 'DISAGREEMENT' && comparisonPosition !== undefined) {
      alerts.push(
        await this.#alert({
          kind: 'CROSS_SOURCE_DISAGREEMENT',
          severity: 'CRITICAL',
          ledger: target.ledger,
          chainId: target.chainId,
          position: comparisonPosition,
          summary: `${target.ledger} providers disagree at ${comparisonPosition}.`,
          details: {
            groups: [...groups.values()].map((items) => ({
              sources: items.map((item) => item.reader.sourceId).sort(),
              ledger: items[0]?.comparison.ledger ?? target.ledger,
              chainId: items[0]?.comparison.chainId ?? target.chainId,
              position: items[0]?.comparison.position ?? comparisonPosition,
              hash: items[0]?.comparison.hash ?? 'unavailable',
              parentPosition: items[0]?.comparison.parentPosition ?? null,
              parentHash: items[0]?.comparison.parentHash ?? null,
              finality: items[0]?.comparison.finality ?? 'unavailable',
            })),
          },
          evidenceIds: normalizedIds([
            ...reconciliationSourceEvidenceIds,
            ...(derivedEvidenceId === undefined ? [] : [derivedEvidenceId]),
          ]),
          observedAt: checkedAt,
          modelVersion: DATA_QUALITY_MODEL_VERSION,
        }),
      );
    }
    const sourceAssessments = [
      ...successfulHeads.map((item) =>
        sourceAssessmentSuccess(
          item,
          comparisons.get(item.reader.sourceId) ?? {
            reason: 'PROVIDER_DOWN',
            detail: 'Comparison observation is unavailable.',
          },
        ),
      ),
      ...failedHeads.map(sourceAssessmentFailure),
    ].sort((left, right) => left.source.localeCompare(right.source));
    const evidenceIds = normalizedIds([
      ...reconciliationSourceEvidenceIds,
      ...(derivedEvidenceId === undefined ? [] : [derivedEvidenceId]),
      ...successfulHeads.flatMap((item) => item.continuity.evidenceIds),
    ]);
    const configuredSources = target.readers.length;
    const coverage = configuredSources === 0 ? 0 : observedSources / configuredSources;
    const knownContinuity = successfulHeads.filter(
      (item) => item.continuity.continuous.state === 'known',
    ).length;
    const historyCoverage = configuredSources === 0 ? 0 : knownContinuity / configuredSources;
    const metadata: AnalysisMetadata = {
      snapshot: agreedSnapshot ?? null,
      dataCoverage: coverage,
      sourceCoverage: coverage,
      historyCoverage,
      simulationCoverage: 0,
      freshness: observedSources === 0 ? null : checkedAt,
      sourceSet: successfulComparisons.map((item) => item.reader.sourceId).sort(),
      modelVersion: DATA_QUALITY_MODEL_VERSION,
      confidence: status === 'AGREEMENT' || status === 'DISAGREEMENT' ? 1 : 0,
      evidenceIds,
    };
    const firstAgreed = successfulComparisons[0];
    return AnchorReconciliationResultSchema.parse({
      ledger: target.ledger,
      chainId: target.chainId,
      status,
      requiredSources: this.#requiredSources,
      configuredSources,
      observedSources,
      comparisonPosition:
        comparisonPosition === undefined
          ? unavailableValue(configuredSources === 0 ? 'PROVIDER_UNCONFIGURED' : 'PROVIDER_DOWN')
          : knownValue(comparisonPosition),
      canonicalAnchor:
        status === 'AGREEMENT' && firstAgreed !== undefined
          ? knownValue(anchorIdentity(firstAgreed.comparison))
          : status === 'DISAGREEMENT'
            ? unknownValue('CONFLICTING_SOURCES', 'Provider anchors differ at the same position.')
            : status === 'INSUFFICIENT_SOURCES'
              ? unknownValue('INSUFFICIENT_DATA', 'Fewer than the required sources were observed.')
              : unavailableValue(
                  configuredSources === 0 ? 'PROVIDER_UNCONFIGURED' : 'PROVIDER_DOWN',
                ),
      sourceIndependence: unknownValue(
        'NOT_QUERIED',
        'Endpoint operator independence is not configured and is not inferred from hostnames.',
      ),
      snapshotSet: successfulComparisons.map((item) => item.comparisonRead.snapshot),
      sources: sourceAssessments,
      alerts,
      metadata,
    });
  }
}
