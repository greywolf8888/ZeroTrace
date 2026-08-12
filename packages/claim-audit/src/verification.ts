import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  ClaimAuditReportSchema,
  ClaimRuleReviewReportSchema,
  ClaimVerificationObservationReportSchema,
  EvmClaimAddressObservationSchema,
  EvmSnapshotSchema,
  unknownValue,
  type ClaimActionObservation,
  type ClaimAuditReport,
  type ClaimRuleReviewReport,
  type ClaimVerificationObservationReport,
  type Evidence,
  type EvmClaimAddressObservation,
  type KnowledgeValue,
} from '@zerotrace/schemas';

export const CLAIM_VERIFICATION_OBSERVATION_MODEL_VERSION =
  'claim-verification-observation-v0.1.0';

export interface ClaimVerificationActionReportReference {
  id: string;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
}

export interface BuildClaimVerificationObservationInput {
  reviewReport: ClaimRuleReviewReport;
  sourceObservationReportId: string;
  sourceObservation: EvmClaimAddressObservation;
  destinationObservationReportId: string;
  destinationObservation: EvmClaimAddressObservation;
  actions: readonly ClaimActionObservation[];
  actionReports?: readonly ClaimVerificationActionReportReference[] | undefined;
  actionSemanticsCoverage?: KnowledgeValue<number> | undefined;
  audit: ClaimAuditReport;
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function reportCore(report: ClaimVerificationObservationReport) {
  return {
    schemaVersion: report.schemaVersion,
    reviewReportId: report.reviewReportId,
    reviewResultHash: report.reviewResultHash,
    reviewTerminalEvidenceId: report.reviewTerminalEvidenceId,
    ruleId: report.ruleId,
    assetId: report.assetId,
    fromBlock: report.fromBlock,
    toBlock: report.toBlock,
    sourceObservationReportId: report.sourceObservationReportId,
    destinationObservationReportId: report.destinationObservationReportId,
    sourceObservation: report.sourceObservation,
    destinationObservation: report.destinationObservation,
    observedBaseAmountLowerBound: report.observedBaseAmountLowerBound,
    baseAmount: report.baseAmount,
    actions: report.actions,
    actionSemanticsReportIds: report.actionSemanticsReportIds,
    actionSemanticsTerminalEvidenceIds: report.actionSemanticsTerminalEvidenceIds,
    audit: report.audit,
    status: report.status,
    claimTruth: report.claimTruth,
    coverage: report.coverage,
    metadata: {
      ...report.metadata,
      evidenceIds: report.metadata.evidenceIds.filter((id) => id !== report.terminalEvidenceId),
    },
  };
}

export function calculateClaimVerificationObservationResultHash(
  report: ClaimVerificationObservationReport,
): string {
  return hashPayload(reportCore(ClaimVerificationObservationReportSchema.parse(report)));
}

export function expectedClaimVerificationObservationTerminalEvidence(
  reportInput: ClaimVerificationObservationReport,
): Evidence {
  const report = ClaimVerificationObservationReportSchema.parse(reportInput);
  const snapshot = EvmSnapshotSchema.parse(report.metadata.snapshot);
  const parents = canonical([
    report.reviewTerminalEvidenceId,
    report.sourceObservation.terminalEvidenceId,
    report.destinationObservation.terminalEvidenceId,
    ...report.actionSemanticsTerminalEvidenceIds,
  ]);
  return createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${CLAIM_VERIFICATION_OBSERVATION_MODEL_VERSION}`,
    locator: `claim-verification-observation:${report.id}:${report.resultHash}`,
    payload: {
      reportId: report.id,
      resultHash: report.resultHash,
      reviewReportId: report.reviewReportId,
      reviewResultHash: report.reviewResultHash,
      ruleId: report.ruleId,
      status: report.status,
      claimTruth: 'UNKNOWN',
      actionSemanticsCoverage: report.coverage.actionSemantics,
    },
    observedAt: snapshot.capturedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    summary:
      'Reviewed Claim expectations were compared with replayable address observations; missing action, history, or source coverage remains explicit.',
    sourceEvidenceIds: parents,
  });
}

function exactObservationPair(
  sourceInput: EvmClaimAddressObservation,
  destinationInput: EvmClaimAddressObservation,
): [EvmClaimAddressObservation, EvmClaimAddressObservation] {
  const source = EvmClaimAddressObservationSchema.parse(sourceInput);
  const destination = EvmClaimAddressObservationSchema.parse(destinationInput);
  const sourceSnapshot = source.metadata.snapshot;
  const destinationSnapshot = destination.metadata.snapshot;
  if (
    source.transfers === undefined ||
    destination.transfers === undefined ||
    sourceSnapshot === null ||
    destinationSnapshot === null ||
    hashPayload(sourceSnapshot) !== hashPayload(destinationSnapshot) ||
    source.tokenAddress.toLowerCase() !== destination.tokenAddress.toLowerCase() ||
    source.fromBlock !== destination.fromBlock ||
    source.toBlock !== destination.toBlock
  ) {
    throw new Error(
      'Claim verification requires replayable source/destination observations from one exact range and Snapshot.',
    );
  }
  return [source, destination];
}

export function buildClaimVerificationObservation(
  input: BuildClaimVerificationObservationInput,
): { report: ClaimVerificationObservationReport; terminalEvidence: Evidence; parentEvidenceIds: string[] } {
  const review = ClaimRuleReviewReportSchema.parse(input.reviewReport);
  const [source, destination] = exactObservationPair(
    input.sourceObservation,
    input.destinationObservation,
  );
  const audit = ClaimAuditReportSchema.parse(input.audit);
  const snapshot = EvmSnapshotSchema.parse(destination.metadata.snapshot);
  if (
    review.rule.sourceAddress.toLowerCase() !== source.address.toLowerCase() ||
    review.rule.destinationAddress.toLowerCase() !== destination.address.toLowerCase() ||
    audit.items.length !== 1 ||
    audit.items[0]?.claim.id !== review.rule.id ||
    audit.metadata.snapshot === null ||
    hashPayload(audit.metadata.snapshot) !== hashPayload(snapshot)
  ) {
    throw new Error('Claim verification observations do not match the reviewed rule or audit.');
  }
  const actionReports = [...(input.actionReports ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (new Set(actionReports.map((item) => item.id)).size !== actionReports.length) {
    throw new Error('Claim verification Action Semantics report references must be unique.');
  }
  const evidenceBeforeTerminal = canonical([
    ...review.evidenceIds,
    ...source.metadata.evidenceIds,
    ...destination.metadata.evidenceIds,
    ...actionReports.flatMap((item) => item.evidenceIds),
    ...audit.metadata.evidenceIds,
  ]);
  const sourceSet = canonical([
    ...review.sourceSet,
    ...source.metadata.sourceSet,
    ...destination.metadata.sourceSet,
    ...actionReports.flatMap((item) => item.sourceSet),
  ]);
  const actionCoverage = input.actionSemanticsCoverage ??
    unknownValue(
      'NOT_QUERIED',
      'No window-complete Action Semantics discovery has been executed for this reviewed rule.',
    );
  const metadata = AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage: Math.min(source.metadata.dataCoverage, destination.metadata.dataCoverage),
    sourceCoverage: Math.min(source.metadata.sourceCoverage, destination.metadata.sourceCoverage),
    historyCoverage: Math.min(
      source.metadata.historyCoverage,
      destination.metadata.historyCoverage,
    ),
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet,
    modelVersion: CLAIM_VERIFICATION_OBSERVATION_MODEL_VERSION,
    confidence: Math.min(source.metadata.confidence, destination.metadata.confidence),
    evidenceIds: evidenceBeforeTerminal,
  });
  const partial = {
    schemaVersion: 'claim-verification-observation-report-v1' as const,
    reviewReportId: review.id,
    reviewResultHash: review.resultHash,
    reviewTerminalEvidenceId: review.terminalEvidenceId,
    ruleId: review.rule.id,
    assetId: review.assetId,
    fromBlock: source.fromBlock,
    toBlock: source.toBlock,
    sourceObservationReportId: input.sourceObservationReportId,
    destinationObservationReportId: input.destinationObservationReportId,
    sourceObservation: source,
    destinationObservation: destination,
    observedBaseAmountLowerBound: source.flow.inflow.observedAmount,
    baseAmount: unknownValue(
      'INSUFFICIENT_DATA',
      'Source-wallet inflow is an observed lower bound, not a proven complete allocation denominator.',
    ),
    actions: [...input.actions].sort((left, right) => left.id.localeCompare(right.id)),
    actionSemanticsReportIds: actionReports.map((item) => item.id),
    actionSemanticsTerminalEvidenceIds: canonical(
      actionReports.map((item) => item.terminalEvidenceId),
    ),
    audit,
    status: audit.status,
    claimTruth: unknownValue(
      'INSUFFICIENT_DATA',
      'Chain behavior does not authenticate the declaration source or reviewer authority.',
    ),
    coverage: {
      reviewedRule: 1 as const,
      addressFlow: 1 as const,
      custodyAtSnapshot: 1 as const,
      custodyHistory: unknownValue(
        'INSUFFICIENT_DATA',
        'Custody was inspected at the terminal Snapshot, not continuously across the window.',
      ),
      actionSemantics: actionCoverage,
      sourceIndependence: unknownValue(
        'INSUFFICIENT_DATA',
        'One logical chain observation has not been independently reconciled.',
      ),
    },
    metadata,
  };
  const resultHash = hashPayload(partial);
  const id = `cvr_${hashPayload({ schema: 'zerotrace-claim-verification-observation-report-v1', resultHash }).slice(0, 24)}`;
  const parentEvidenceIds = canonical([
    review.terminalEvidenceId,
    source.terminalEvidenceId,
    destination.terminalEvidenceId,
    ...actionReports.map((item) => item.terminalEvidenceId),
  ]);
  const terminalEvidence = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${CLAIM_VERIFICATION_OBSERVATION_MODEL_VERSION}`,
    locator: `claim-verification-observation:${id}:${resultHash}`,
    payload: {
      reportId: id,
      resultHash,
      reviewReportId: review.id,
      reviewResultHash: review.resultHash,
      ruleId: review.rule.id,
      status: audit.status,
      claimTruth: 'UNKNOWN',
      actionSemanticsCoverage: actionCoverage,
    },
    observedAt: snapshot.capturedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    summary:
      'Reviewed Claim expectations were compared with replayable address observations; missing action, history, or source coverage remains explicit.',
    sourceEvidenceIds: parentEvidenceIds,
  });
  const report = ClaimVerificationObservationReportSchema.parse({
    ...partial,
    id,
    resultHash,
    terminalEvidenceId: terminalEvidence.id,
    evidenceIds: canonical([...evidenceBeforeTerminal, terminalEvidence.id]),
    metadata: {
      ...metadata,
      evidenceIds: canonical([...evidenceBeforeTerminal, terminalEvidence.id]),
    },
  });
  return { report, terminalEvidence, parentEvidenceIds };
}
