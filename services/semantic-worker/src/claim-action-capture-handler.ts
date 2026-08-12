import {
  auditClaims,
  CLAIM_AUDIT_MODEL_VERSION,
  type CustodyObservation,
} from '@zerotrace/claim-audit';
import { CaptureExecutionError, type CaptureHandler } from '@zerotrace/capture-scheduler';
import type { EvmLogReader } from '@zerotrace/chain-adapters';
import { evidenceIdFor, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  ChainAnchorReadSchema,
  EvmClaimActionsCaptureParametersSchema,
  EvmSnapshotSchema,
  EvidenceSchema,
  unknownValue,
  type AnalysisSnapshot,
  type CaptureRun,
  type CaptureRunSuccess,
  type ClaimCustodyObservation,
  type EvmClaimAddressObservation,
  type EvmClaimTransferObservation,
  type Evidence as SchemaEvidence,
  type ClaimRuleReviewReport,
} from '@zerotrace/schemas';
import { buildClaimVerificationObservation } from '@zerotrace/claim-audit';
import {
  observeEvmClaimAddress,
  type EvmBlockAnchorReader,
  type EvmClaimReadAdapter,
} from '@zerotrace/platform-adapters';
import type {
  PostgresClaimReportRepository,
  PostgresClaimRuleReviewReportRepository,
  PostgresClaimVerificationReportRepository,
  PostgresEvidenceRepository,
} from '@zerotrace/storage';
import type { z } from 'zod';

export const CLAIM_ACTIONS_CAPTURE_HANDLER_VERSION = 'claim-actions-capture-handler-v0.1.0';

export interface ClaimActionsChainResources {
  adapter: EvmClaimReadAdapter & EvmBlockAnchorReader;
  logReader: EvmLogReader;
}

export interface ClaimActionsCaptureResources {
  reviews: Pick<PostgresClaimRuleReviewReportRepository, 'get'>;
  addressReports: Pick<PostgresClaimReportRepository, 'put'>;
  verifications: Pick<PostgresClaimVerificationReportRepository, 'put'>;
  evidence: Pick<PostgresEvidenceRepository, 'put'>;
  chains: ReadonlyMap<string, ClaimActionsChainResources>;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function safeFailure(error: unknown): CaptureExecutionError {
  if (error instanceof CaptureExecutionError) return error;
  const shaped = record(error);
  const code =
    typeof shaped?.code === 'string' && /^[A-Z0-9_:-]{1,160}$/.test(shaped.code)
      ? shaped.code
      : 'CLAIM_ACTIONS_CAPTURE_FAILED';
  const retryable = shaped?.sourceRetryable === true || shaped?.retryable === true;
  const message = error instanceof Error ? error.message : 'Claim Actions capture failed.';
  return new CaptureExecutionError(code, message, retryable, error);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function numericChainId(chainId: string): number {
  const match = /^eip155:([1-9]\d*)$/.exec(chainId);
  if (match === null) throw new Error('Claim Actions target must use a canonical EVM chain id.');
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value)) throw new Error('Claim Actions EVM chain id is unsafe.');
  return value;
}

function exactSnapshot(
  read: ReturnType<typeof ChainAnchorReadSchema.parse>,
  expectedChainId: string,
  expectedPosition: string,
): z.infer<typeof EvmSnapshotSchema> {
  const parsed = ChainAnchorReadSchema.parse(read);
  const snapshot = EvmSnapshotSchema.parse(parsed.snapshot);
  if (
    snapshot.chainId !== expectedChainId ||
    snapshot.blockNumber !== expectedPosition ||
    snapshot.finality !== 'finalized' ||
    snapshot.blockTimestamp === undefined ||
    parsed.anchor.chainId !== expectedChainId ||
    parsed.anchor.position !== expectedPosition
  ) {
    throw new CaptureExecutionError(
      'CLAIM_ACTIONS_SNAPSHOT_MISMATCH',
      'EVM anchor does not match the scheduled finalized range.',
      false,
    );
  }
  return snapshot;
}

function custodyForAudit(observation: ClaimCustodyObservation): CustodyObservation {
  const canMoveFunds: CustodyObservation['canMoveFunds'] =
    observation.canMoveFunds.state === 'known'
      ? { state: 'known', value: observation.canMoveFunds.value }
      : observation.canMoveFunds.detail === undefined
        ? { state: observation.canMoveFunds.state, reason: observation.canMoveFunds.reason }
        : {
            state: observation.canMoveFunds.state,
            reason: observation.canMoveFunds.reason,
            detail: observation.canMoveFunds.detail,
          };
  const base = {
    address: observation.address,
    kind: observation.kind,
    canMoveFunds,
    evidenceIds: [...observation.evidenceIds],
  };
  return {
    ...base,
    ...(observation.threshold === undefined ? {} : { threshold: observation.threshold }),
    ...(observation.ownerCount === undefined ? {} : { ownerCount: observation.ownerCount }),
    ...(observation.executedTransactions === undefined
      ? {}
      : { executedTransactions: observation.executedTransactions }),
    ...(observation.implementationAddress === undefined
      ? {}
      : { implementationAddress: observation.implementationAddress }),
    ...(observation.implementationVersion === undefined
      ? {}
      : { implementationVersion: observation.implementationVersion }),
  };
}

function dedupeTransfers(
  source: readonly EvmClaimTransferObservation[],
  destination: readonly EvmClaimTransferObservation[],
): EvmClaimTransferObservation[] {
  const byId = new Map<string, EvmClaimTransferObservation>();
  for (const transfer of [...source, ...destination]) {
    const existing = byId.get(transfer.id);
    if (existing !== undefined && hashPayload(existing) !== hashPayload(transfer)) {
      throw new CaptureExecutionError(
        'CLAIM_ACTIONS_TRANSFER_CONFLICT',
        `Transfer ${transfer.id} was observed with conflicting payloads.`,
        false,
      );
    }
    byId.set(transfer.id, transfer);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function auditMetadata(
  review: ClaimRuleReviewReport,
  source: EvmClaimAddressObservation,
  destination: EvmClaimAddressObservation,
  snapshot: z.infer<typeof EvmSnapshotSchema>,
) {
  return AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage: Math.min(source.metadata.dataCoverage, destination.metadata.dataCoverage),
    sourceCoverage: Math.min(source.metadata.sourceCoverage, destination.metadata.sourceCoverage),
    historyCoverage: Math.min(
      source.metadata.historyCoverage,
      destination.metadata.historyCoverage,
    ),
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet: sortedUnique([
      ...review.sourceSet,
      ...source.metadata.sourceSet,
      ...destination.metadata.sourceSet,
    ]),
    modelVersion: CLAIM_AUDIT_MODEL_VERSION,
    confidence: Math.min(source.metadata.confidence, destination.metadata.confidence),
    evidenceIds: sortedUnique([
      ...review.evidenceIds,
      ...source.metadata.evidenceIds,
      ...destination.metadata.evidenceIds,
    ]),
  });
}

async function persistEvidence(
  resources: ClaimActionsCaptureResources,
  evidence: SchemaEvidence,
  parents: readonly string[] = [],
  snapshot?: AnalysisSnapshot,
): Promise<SchemaEvidence> {
  const stored = EvidenceSchema.parse(
    (await resources.evidence.put(evidence, parents, snapshot)).evidence,
  );
  if (
    stored.id !== evidence.id ||
    stored.id !== evidenceIdFor(stored, parents) ||
    hashPayload(stored) !== hashPayload(evidence)
  ) {
    throw new CaptureExecutionError(
      'CLAIM_ACTIONS_EVIDENCE_CONFLICT',
      'Durable Evidence storage changed an immutable claim observation.',
      false,
    );
  }
  return stored;
}

function expectedReview(
  parameters: ReturnType<typeof EvmClaimActionsCaptureParametersSchema.parse>,
  run: CaptureRun,
  stored: Awaited<ReturnType<PostgresClaimRuleReviewReportRepository['get']>>,
) {
  if (stored === undefined) {
    throw new CaptureExecutionError(
      'CLAIM_ACTIONS_REVIEW_MISSING',
      'The scheduled Claim rule review revision is not durably available.',
      false,
    );
  }
  const review = stored.report;
  if (
    run.target.normalizedIdentifier !== parameters.assetId ||
    review.id !== parameters.reviewReportId ||
    review.resultHash !== parameters.reviewResultHash ||
    review.rule.id !== parameters.ruleId ||
    review.assetId !== parameters.assetId ||
    run.target.ledger !== 'EVM' ||
    run.target.chainId !== stored.chainId ||
    run.target.subjectType !== 'TOKEN'
  ) {
    throw new CaptureExecutionError(
      'CLAIM_ACTIONS_REVIEW_BINDING_MISMATCH',
      'Capture parameters, target, and reviewed Claim rule revision do not match exactly.',
      false,
    );
  }
  return stored;
}

export function createClaimActionsCaptureHandler(
  resources: ClaimActionsCaptureResources,
): CaptureHandler {
  return async (run: CaptureRun): Promise<CaptureRunSuccess> => {
    try {
      if (
        run.captureKind !== 'CLAIM_ACTIONS' ||
        run.operation !== 'READ_ONLY_CAPTURE' ||
        run.target.ledger !== 'EVM' ||
        run.target.subjectType !== 'TOKEN'
      ) {
        throw new CaptureExecutionError(
          'CLAIM_ACTIONS_TARGET_INVALID',
          'Claim Actions handler accepts read-only EVM token captures only.',
          false,
        );
      }
      const parameters = EvmClaimActionsCaptureParametersSchema.parse(run.parameters);
      const reviewed = expectedReview(
        parameters,
        run,
        await resources.reviews.get(parameters.reviewReportId),
      );
      const review = reviewed.report;
      const chain = resources.chains.get(run.target.chainId);
      if (chain === undefined) {
        throw new CaptureExecutionError(
          'CLAIM_ACTIONS_CHAIN_UNCONFIGURED',
          `No read-only EVM adapter is configured for ${run.target.chainId}.`,
          false,
        );
      }
      const chainId = numericChainId(run.target.chainId);
      if (
        chain.adapter.config.chainId !== chainId ||
        reviewed.chainId !== run.target.chainId ||
        review.rule.assetId !== parameters.assetId
      ) {
        throw new CaptureExecutionError(
          'CLAIM_ACTIONS_CHAIN_MISMATCH',
          'Configured EVM adapter and reviewed rule chain do not match the capture target.',
          false,
        );
      }

      const fromAnchor = exactSnapshot(
        await chain.adapter.readAnchorAt(parameters.fromBlock),
        run.target.chainId,
        parameters.fromBlock,
      );
      const terminalSnapshot = exactSnapshot(
        await chain.adapter.readAnchorAt(parameters.toBlock),
        run.target.chainId,
        parameters.toBlock,
      );
      if (
        Date.parse(fromAnchor.blockTimestamp as string) > Date.parse(review.rule.window.from) ||
        Date.parse(terminalSnapshot.blockTimestamp as string) < Date.parse(review.rule.window.to)
      ) {
        throw new CaptureExecutionError(
          'CLAIM_ACTIONS_RANGE_INCOMPLETE',
          'The scheduled block range does not bound the reviewed Claim window.',
          false,
        );
      }
      const reviewEvidenceAfterTerminal = review.evidence.some(
        (item) =>
          item.blockOrSlot !== undefined && BigInt(item.blockOrSlot) > BigInt(parameters.toBlock),
      );
      if (reviewEvidenceAfterTerminal) {
        throw new CaptureExecutionError(
          'CLAIM_ACTIONS_REVIEW_EVIDENCE_FUTURE',
          'Reviewed Claim Evidence is positioned after the terminal capture block.',
          false,
        );
      }
      const tokenAddress = parameters.assetId.split(':').at(-1);
      if (tokenAddress === undefined) throw new Error('Claim asset token address is missing.');
      const writeObservationEvidence = async (
        item: SchemaEvidence,
        parents: readonly string[] = [],
        snapshot?: AnalysisSnapshot,
      ) => persistEvidence(resources, item, parents, snapshot);
      const observe = (address: string) =>
        observeEvmClaimAddress({
          tokenAddress,
          address,
          fromBlock: parameters.fromBlock,
          toBlock: parameters.toBlock,
          window: review.rule.window,
          snapshot: terminalSnapshot,
          custodyAdapter: chain.adapter,
          blockReader: chain.adapter,
          logReader: chain.logReader,
          writeEvidence: writeObservationEvidence,
          ...(review.rule.shareUnit === undefined ? {} : { shareUnit: review.rule.shareUnit }),
          topCounterpartyLimit: parameters.limits.topCounterpartyLimit,
          maxBlocksPerRequest: parameters.limits.maxBlocksPerRequest,
          maxRequests: parameters.limits.maxRequests,
          maxTransfers: parameters.limits.maxTransfers,
        });
      const [sourceRun, destinationRun] = await Promise.all([
        observe(review.rule.sourceAddress),
        observe(review.rule.destinationAddress),
      ]);
      const sourceStored = await resources.addressReports.put(sourceRun.report);
      const destinationStored = await resources.addressReports.put(destinationRun.report);
      const transfers = dedupeTransfers(sourceRun.transfers, destinationRun.transfers);
      const audit = auditClaims({
        baseAmount: unknownValue(
          'INSUFFICIENT_DATA',
          'A source-wallet inflow is only a lower bound until the complete tax denominator is independently established.',
        ),
        claims: [review.rule],
        transfers,
        actions: [],
        custody: [
          custodyForAudit(sourceRun.report.custody),
          custodyForAudit(destinationRun.report.custody),
        ],
        metadata: auditMetadata(review, sourceRun.report, destinationRun.report, terminalSnapshot),
      });
      const built = buildClaimVerificationObservation({
        reviewReport: review,
        sourceObservationReportId: sourceStored.id,
        sourceObservation: sourceRun.report,
        destinationObservationReportId: destinationStored.id,
        destinationObservation: destinationRun.report,
        actions: [],
        audit,
      });
      const terminal = await persistEvidence(
        resources,
        built.terminalEvidence,
        built.parentEvidenceIds,
        terminalSnapshot,
      );
      const verification = await resources.verifications.put({
        ...built.report,
        terminalEvidenceId: terminal.id,
        evidenceIds: sortedUnique([...built.report.evidenceIds]),
        metadata: {
          ...built.report.metadata,
          evidenceIds: sortedUnique([...built.report.metadata.evidenceIds]),
        },
      });
      const storedReport = verification.report;
      if (storedReport.terminalEvidenceId !== terminal.id) {
        throw new CaptureExecutionError(
          'CLAIM_ACTIONS_TERMINAL_MISMATCH',
          'Durable Claim verification report returned a different terminal Evidence id.',
          false,
        );
      }
      return {
        resultRef: verification.id,
        snapshot: terminalSnapshot,
        terminalEvidenceId: verification.terminalEvidenceId,
        evidenceIds: [...verification.evidenceIds],
        sourceSet: [...verification.sourceSet],
        modelVersion: verification.modelVersion,
        coverage: Math.min(
          storedReport.metadata.dataCoverage,
          storedReport.metadata.sourceCoverage,
          storedReport.metadata.historyCoverage,
        ),
        freshness: verification.capturedAt,
        confidence: storedReport.metadata.confidence,
      };
    } catch (error) {
      throw safeFailure(error);
    }
  };
}
