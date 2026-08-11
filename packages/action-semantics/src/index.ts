import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  ActionSemanticCandidateSchema,
  ActionSemanticObservationSchema,
  ActionSemanticsReportSchema,
  AnalysisSnapshotSchema,
  EvidenceSchema,
  knownValue,
  unknownValue,
  type ActionAssetDelta,
  type ActionPrimitiveKind,
  type ActionProofKind,
  type ActionSemanticCandidate,
  type ActionSemanticObservation,
  type ActionSemanticsReport,
  type AnalysisSnapshot,
  type Evidence,
  type JsonValue,
  type KnowledgeValue,
  type Ledger,
} from '@zerotrace/schemas';

export const ACTION_SEMANTICS_LEGACY_MODEL_VERSION = 'action-semantics-v0.1.0';
export const ACTION_SEMANTICS_MODEL_VERSION = 'action-semantics-v0.2.0';
export const ACTION_SEMANTICS_SUPPORTED_MODEL_VERSIONS = [
  ACTION_SEMANTICS_LEGACY_MODEL_VERSION,
  ACTION_SEMANTICS_MODEL_VERSION,
] as const;
export type ActionSemanticsModelVersion =
  (typeof ACTION_SEMANTICS_SUPPORTED_MODEL_VERSIONS)[number];

const ACTION_SEMANTICS_REPORT_ID_SCHEMA = 'zerotrace-action-semantics-report-v1';

export interface CreateActionCandidateInput {
  ledger: Ledger;
  chainId: string;
  transactionId: string;
  blockOrSlot: string;
  observedAt: string;
  proposedKind: ActionPrimitiveKind;
  application: 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';
  actor: KnowledgeValue<string>;
  counterparties?: readonly string[];
  assetDeltas?: readonly ActionAssetDelta[];
  proofKinds: readonly ActionProofKind[];
  evidenceIds: readonly string[];
}

export interface BuildActionSemanticsInput {
  snapshot: AnalysisSnapshot;
  candidates: readonly ActionSemanticCandidate[];
  evidence: readonly Evidence[];
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  simulationCoverage?: number;
  modelVersion?: ActionSemanticsModelVersion;
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function canonicalActionTransactionId(ledger: Ledger, value: string): string {
  const transactionId = value.trim();
  switch (ledger) {
    case 'EVM': {
      const normalized = transactionId.toLowerCase();
      if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
        throw new RangeError('EVM transaction ID must be a 32-byte 0x-prefixed hash.');
      }
      return normalized;
    }
    case 'BITCOIN': {
      const normalized = transactionId.toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) {
        throw new RangeError('Bitcoin transaction ID must be a 32-byte hexadecimal txid.');
      }
      return normalized;
    }
    case 'SOLANA':
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(transactionId)) {
        throw new RangeError('Solana transaction ID must be a canonical base58 signature.');
      }
      return transactionId;
  }
}

export function actionSemanticsReportId(resultHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(resultHash)) {
    throw new RangeError('Action Semantics result hash must be canonical SHA-256 hexadecimal.');
  }
  return `asr_${hashPayload({ schema: ACTION_SEMANTICS_REPORT_ID_SCHEMA, resultHash }).slice(0, 24)}`;
}

function canonicalTime(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`${field} must be an ISO date-time.`);
  return date.toISOString();
}

export function createActionCandidate(input: CreateActionCandidateInput): ActionSemanticCandidate {
  const candidate = {
    ledger: input.ledger,
    chainId: input.chainId.trim(),
    transactionId: canonicalActionTransactionId(input.ledger, input.transactionId),
    blockOrSlot: input.blockOrSlot,
    observedAt: canonicalTime(input.observedAt, 'observedAt'),
    proposedKind: input.proposedKind,
    application: input.application,
    actor: input.actor,
    counterparties: canonical(input.counterparties ?? []),
    assetDeltas: [...(input.assetDeltas ?? [])].map((delta) => ({
      ...delta,
      evidenceIds: canonical(delta.evidenceIds),
    })),
    proofKinds: canonical(input.proofKinds),
    evidenceIds: canonical(input.evidenceIds),
  };
  return ActionSemanticCandidateSchema.parse({
    ...candidate,
    id: `acn_${hashPayload({ schema: 'action-semantic-candidate-v1', ...candidate }).slice(0, 24)}`,
  });
}

function totals(
  deltas: readonly ActionAssetDelta[],
  direction: ActionAssetDelta['direction'],
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const delta of deltas) {
    if (delta.direction !== direction) continue;
    result.set(delta.assetId, (result.get(delta.assetId) ?? 0n) + BigInt(delta.amount));
  }
  return result;
}

function balancedByAsset(deltas: readonly ActionAssetDelta[]): boolean {
  const debits = totals(deltas, 'DEBIT');
  const credits = totals(deltas, 'CREDIT');
  if (debits.size === 0 || debits.size !== credits.size) return false;
  return [...debits].every(([assetId, amount]) => credits.get(assetId) === amount);
}

function hasProof(proofs: ReadonlySet<ActionProofKind>, ...required: ActionProofKind[]): boolean {
  return required.every((proof) => proofs.has(proof));
}

function appliedShape(
  candidate: ActionSemanticCandidate,
  modelVersion: ActionSemanticsModelVersion,
): boolean {
  const proofs = new Set(candidate.proofKinds);
  const debits = candidate.assetDeltas.filter((delta) => delta.direction === 'DEBIT');
  const credits = candidate.assetDeltas.filter((delta) => delta.direction === 'CREDIT');
  const debitAssets = new Set(debits.map((delta) => delta.assetId));
  const creditAssets = new Set(credits.map((delta) => delta.assetId));
  switch (candidate.proposedKind) {
    case 'TRANSFER':
      return (
        (hasProof(proofs, 'TRANSFER_LOG') ||
          (modelVersion === ACTION_SEMANTICS_MODEL_VERSION &&
            (hasProof(proofs, 'VALUE_TRANSFER') ||
              hasProof(proofs, 'UTXO_CONSERVATION') ||
              hasProof(proofs, 'BALANCE_DELTAS')))) &&
        balancedByAsset(candidate.assetDeltas)
      );
    case 'SWAP':
      return (
        hasProof(proofs, 'SWAP_EVENT', 'BALANCE_DELTAS') &&
        debits.length > 0 &&
        credits.length > 0 &&
        [...debitAssets].some((asset) => !creditAssets.has(asset)) &&
        [...creditAssets].some((asset) => !debitAssets.has(asset))
      );
    case 'BURN':
      return hasProof(proofs, 'SUPPLY_CONSERVATION') && debits.length > 0;
    case 'MINT':
      return hasProof(proofs, 'SUPPLY_CONSERVATION') && credits.length > 0;
    case 'ADD_LIQUIDITY':
      return (
        hasProof(proofs, 'LP_MINT_RESERVE_CHANGE') && debitAssets.size >= 2 && credits.length > 0
      );
    case 'REMOVE_LIQUIDITY':
      return (
        hasProof(proofs, 'LP_BURN_RESERVE_CHANGE') && debits.length > 0 && creditAssets.size >= 2
      );
    case 'LP_LOCK':
      return hasProof(proofs, 'LP_CUSTODY') && debits.length > 0 && credits.length > 0;
    case 'DISTRIBUTION': {
      const creditAccounts = new Set(credits.map((delta) => delta.account));
      return (
        hasProof(proofs, 'DISTRIBUTION_FLOWS') &&
        creditAccounts.size >= 2 &&
        balancedByAsset(candidate.assetDeltas)
      );
    }
    case 'CONTRACT_CALL':
      return modelVersion === ACTION_SEMANTICS_LEGACY_MODEL_VERSION
        ? hasProof(proofs, 'CALL_TRACE') || hasProof(proofs, 'EXECUTION_RECEIPT')
        : hasProof(proofs, 'CALL_TRACE') ||
            hasProof(proofs, 'TRANSACTION_INPUT', 'EXECUTION_RECEIPT');
  }
}

function attemptedShape(candidate: ActionSemanticCandidate): boolean {
  const proofs = new Set(candidate.proofKinds);
  return (
    candidate.assetDeltas.length === 0 && hasProof(proofs, 'TRANSACTION_INPUT', 'EXECUTION_RECEIPT')
  );
}

function classify(
  candidate: ActionSemanticCandidate,
  modelVersion: ActionSemanticsModelVersion,
): {
  primitive: KnowledgeValue<ActionPrimitiveKind>;
  confidence: KnowledgeValue<number>;
  findings: ActionSemanticObservation['findings'];
} {
  const findings: ActionSemanticObservation['findings'] = [];
  if (candidate.actor.state !== 'known') findings.push('ACTOR_UNKNOWN');
  if (candidate.application === 'UNKNOWN') {
    findings.push('EXECUTION_UNKNOWN', 'INTENT_NOT_INFERRED');
    return {
      primitive: unknownValue(
        'INSUFFICIENT_DATA',
        'Execution metadata is unavailable; the proposed primitive is not confirmed.',
      ),
      confidence: unknownValue('INSUFFICIENT_DATA'),
      findings,
    };
  }
  if (candidate.application === 'NOT_APPLIED') {
    if (!attemptedShape(candidate)) {
      findings.push('PROOF_INCOMPLETE', 'INTENT_NOT_INFERRED');
      return {
        primitive: unknownValue(
          'INSUFFICIENT_DATA',
          'A failed execution requires both decoded input and receipt Evidence.',
        ),
        confidence: unknownValue('INSUFFICIENT_DATA'),
        findings,
      };
    }
    findings.push('EXECUTION_NOT_APPLIED', 'INTENT_NOT_INFERRED');
    return {
      primitive: knownValue(candidate.proposedKind),
      confidence: knownValue(1),
      findings,
    };
  }
  if (!appliedShape(candidate, modelVersion)) {
    findings.push(
      candidate.assetDeltas.length === 0 ? 'DELTA_SHAPE_INVALID' : 'PROOF_INCOMPLETE',
      'INTENT_NOT_INFERRED',
    );
    return {
      primitive: unknownValue(
        'INSUFFICIENT_DATA',
        'The candidate lacks the proof or asset-delta shape required for this primitive.',
      ),
      confidence: unknownValue('INSUFFICIENT_DATA'),
      findings,
    };
  }
  findings.push('PRIMITIVE_CONFIRMED', 'INTENT_NOT_INFERRED');
  return {
    primitive: knownValue(candidate.proposedKind),
    confidence: knownValue(1),
    findings,
  };
}

function observation(
  candidate: ActionSemanticCandidate,
  modelVersion: ActionSemanticsModelVersion,
): ActionSemanticObservation {
  const classification = classify(candidate, modelVersion);
  const content = {
    candidateId: candidate.id,
    ledger: candidate.ledger,
    chainId: candidate.chainId,
    transactionId: candidate.transactionId,
    blockOrSlot: candidate.blockOrSlot,
    observedAt: candidate.observedAt,
    proposedKind: candidate.proposedKind,
    primitive: classification.primitive,
    application: candidate.application,
    actor: candidate.actor,
    counterparties: candidate.counterparties,
    assetDeltas: candidate.assetDeltas,
    proofKinds: candidate.proofKinds,
    claimedPurpose: unknownValue(
      'NOT_QUERIED',
      'Primitive chain behavior does not establish the off-chain purpose or public claim.',
    ),
    confidence: classification.confidence,
    findings: classification.findings,
    evidenceIds: candidate.evidenceIds,
  };
  return ActionSemanticObservationSchema.parse({
    ...content,
    id: `act_${hashPayload({ schema: 'action-semantic-observation-v1', ...content }).slice(0, 24)}`,
  });
}

function snapshotPosition(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'EVM'
    ? snapshot.blockNumber
    : snapshot.ledger === 'BITCOIN'
      ? snapshot.height
      : snapshot.slot;
}

function reportCore(report: ActionSemanticsReport) {
  return {
    schemaVersion: report.schemaVersion,
    snapshot: report.snapshot,
    actions: report.actions,
    coverage: {
      data: report.metadata.dataCoverage,
      source: report.metadata.sourceCoverage,
      history: report.metadata.historyCoverage,
      simulation: report.metadata.simulationCoverage,
    },
    sourceSet: report.metadata.sourceSet,
    modelVersion: report.metadata.modelVersion,
  };
}

function canonicalReport(input: ActionSemanticsReport): ActionSemanticsReport {
  const report = ActionSemanticsReportSchema.parse(input);
  const modelVersion = ACTION_SEMANTICS_SUPPORTED_MODEL_VERSIONS.find(
    (item) => item === report.metadata.modelVersion,
  );
  if (modelVersion === undefined) {
    throw new Error('Action Semantics report uses an unsupported model version.');
  }
  for (const action of report.actions) {
    const actor: KnowledgeValue<string> =
      action.actor.state === 'known'
        ? action.actor
        : action.actor.detail === undefined
          ? { state: action.actor.state, reason: action.actor.reason }
          : { state: action.actor.state, reason: action.actor.reason, detail: action.actor.detail };
    const candidate = createActionCandidate({
      ledger: action.ledger,
      chainId: action.chainId,
      transactionId: action.transactionId,
      blockOrSlot: action.blockOrSlot,
      observedAt: action.observedAt,
      proposedKind: action.proposedKind,
      application: action.application,
      actor,
      counterparties: action.counterparties,
      assetDeltas: action.assetDeltas,
      proofKinds: action.proofKinds,
      evidenceIds: action.evidenceIds,
    });
    const expected = observation(candidate, modelVersion);
    if (candidate.id !== action.candidateId || hashPayload(expected) !== hashPayload(action)) {
      throw new Error(
        'Action Semantics observation does not match the canonical candidate classification.',
      );
    }
  }
  return report;
}

export function calculateActionSemanticsResultHash(input: ActionSemanticsReport): string {
  return hashPayload(reportCore(canonicalReport(input)));
}

export function expectedActionSemanticsTerminalEvidence(input: ActionSemanticsReport): Evidence {
  const report = canonicalReport(input);
  const position = snapshotPosition(report.snapshot);
  const sourceEvidenceIds = canonical(report.actions.flatMap((item) => item.evidenceIds));
  const knownActions = report.actions.filter((action) => action.primitive.state === 'known').length;
  return createEvidence({
    ledger: report.snapshot.ledger,
    chainId: report.snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${report.metadata.modelVersion}`,
    locator: `action-semantics:${report.snapshot.ledger}:${report.snapshot.chainId}:${position}:${report.resultHash}`,
    payload: {
      resultHash: report.resultHash,
      actionIds: report.actions.map((action) => action.id),
      knownActions,
      totalActions: report.actions.length,
    } satisfies JsonValue,
    summary: 'Action primitives classified without inferring promotional intent.',
    observedAt: report.snapshot.capturedAt,
    blockOrSlot: position,
    finality:
      report.snapshot.ledger === 'EVM'
        ? report.snapshot.finality
        : report.snapshot.ledger === 'BITCOIN'
          ? report.snapshot.finality
          : report.snapshot.commitment,
    sourceEvidenceIds,
  });
}

function ratio(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be between zero and one.`);
  }
  return value;
}

export function buildActionSemanticsReport(
  input: BuildActionSemanticsInput,
): ActionSemanticsReport {
  const snapshot = AnalysisSnapshotSchema.parse(input.snapshot);
  const modelVersion = input.modelVersion ?? ACTION_SEMANTICS_MODEL_VERSION;
  if (input.candidates.length === 0) throw new Error('Action Semantics requires a candidate.');
  const candidates = input.candidates.map((item) => ActionSemanticCandidateSchema.parse(item));
  const evidence = input.evidence.map((item) => EvidenceSchema.parse(item));
  const sourceEvidenceIds = canonical(candidates.flatMap((item) => item.evidenceIds));
  const providedEvidenceIds = evidence.map((item) => item.id);
  const position = snapshotPosition(snapshot);
  if (
    new Set(candidates.map((item) => item.id)).size !== candidates.length ||
    new Set(providedEvidenceIds).size !== evidence.length ||
    sourceEvidenceIds.length !== evidence.length ||
    sourceEvidenceIds.some((id, index) => id !== [...providedEvidenceIds].sort()[index]) ||
    candidates.some(
      (candidate) =>
        candidate.ledger !== snapshot.ledger ||
        candidate.chainId !== snapshot.chainId ||
        candidate.blockOrSlot !== position ||
        Date.parse(candidate.observedAt) > Date.parse(snapshot.capturedAt),
    ) ||
    evidence.some(
      (item) =>
        item.ledger !== snapshot.ledger ||
        item.chainId !== snapshot.chainId ||
        (item.blockOrSlot !== undefined && item.blockOrSlot !== position),
    )
  ) {
    throw new Error(
      'Action candidates, Evidence and Snapshot must have one exact ledger identity.',
    );
  }
  const actions = candidates
    .map((candidate) => observation(candidate, modelVersion))
    .sort((left, right) => left.id.localeCompare(right.id));
  const knownActions = actions.filter((action) => action.primitive.state === 'known').length;
  const sourceSet = canonical(
    evidence
      .filter(
        (item) =>
          item.kind !== 'DERIVED_FEATURE' &&
          item.kind !== 'NEGATIVE_EVIDENCE' &&
          item.kind !== 'ANALYST_OBSERVATION',
      )
      .map((item) => item.source),
  );
  if (sourceSet.length === 0) {
    throw new Error('Action Semantics requires at least one non-derived source Evidence node.');
  }
  const core = {
    schemaVersion: 'action-semantics-report-v1',
    snapshot,
    actions,
    coverage: {
      data: ratio(input.dataCoverage, 'dataCoverage'),
      source: ratio(input.sourceCoverage, 'sourceCoverage'),
      history: ratio(input.historyCoverage, 'historyCoverage'),
      simulation: ratio(input.simulationCoverage ?? 0, 'simulationCoverage'),
    },
    sourceSet,
    modelVersion,
  };
  const resultHash = hashPayload(core);
  const terminal = createEvidence({
    ledger: snapshot.ledger,
    chainId: snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${modelVersion}`,
    locator: `action-semantics:${snapshot.ledger}:${snapshot.chainId}:${position}:${resultHash}`,
    payload: {
      resultHash,
      actionIds: actions.map((action) => action.id),
      knownActions,
      totalActions: actions.length,
    } satisfies JsonValue,
    summary: 'Action primitives classified without inferring promotional intent.',
    observedAt: snapshot.capturedAt,
    blockOrSlot: position,
    finality:
      snapshot.ledger === 'EVM'
        ? snapshot.finality
        : snapshot.ledger === 'BITCOIN'
          ? snapshot.finality
          : snapshot.commitment,
    sourceEvidenceIds,
  });
  const allEvidence = [...evidence, terminal].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return ActionSemanticsReportSchema.parse({
    schemaVersion: 'action-semantics-report-v1',
    resultHash,
    snapshot,
    actions,
    classificationCoverage: knownActions / actions.length,
    terminalEvidenceId: terminal.id,
    metadata: {
      snapshot,
      dataCoverage: core.coverage.data,
      sourceCoverage: core.coverage.source,
      historyCoverage: core.coverage.history,
      simulationCoverage: core.coverage.simulation,
      freshness: snapshot.capturedAt,
      sourceSet,
      modelVersion,
      confidence: 1,
      evidenceIds: allEvidence.map((item) => item.id),
    },
    evidence: allEvidence,
  });
}

export type { ActionSemanticCandidate, ActionSemanticObservation, ActionSemanticsReport };
export * from './raw-ledger.js';
