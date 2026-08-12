import { hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type CaptureRun,
  type ChainAnchorRead,
  type EvmClaimAddressObservation,
} from '@zerotrace/schemas';
import { EvmSnapshotSchema } from '@zerotrace/schemas';
import { parseEvmClaimDeclaration, reviewClaimDeclarationDraft } from '@zerotrace/claim-audit';
import { describe, expect, it, vi } from 'vitest';

import {
  createClaimActionsCaptureHandler,
  type ClaimActionsCaptureResources,
} from './claim-action-capture-handler.js';
import { buildClaimActionsSchedule } from './claim-action-schedule.js';

const capturedAt = '2026-08-12T00:00:00.000Z';
const assetId = `eip155:56:erc20:0x${'11'.repeat(20)}`;
const sourceAddress = `0x${'22'.repeat(20)}`;
const destinationAddress = `0x${'33'.repeat(20)}`;

function review() {
  const declaration = parseEvmClaimDeclaration({
    source: 'operator:claim-actions-handler-test',
    text: `Tax receiver (100%)\n${sourceAddress}\nCommunity fund (20%)\n${destinationAddress}`,
    chainId: 'eip155:56',
    observedAt: capturedAt,
    assetId,
    auditWindow: { from: '2026-08-01T00:00:00.000Z', to: capturedAt },
  });
  const draft = declaration.drafts.find(
    (item) => item.sourceAddress.state === 'known' && item.destinationAddress.state === 'known',
  );
  if (draft === undefined) throw new Error('Expected a schedulable declaration draft.');
  return reviewClaimDeclarationDraft({
    declarationReport: declaration,
    draftId: draft.id,
    reviewerLabel: 'test reviewer',
    reviewedAt: capturedAt,
    rule: {
      sourceAddress,
      destinationAddress,
      role: 'COMMUNITY_FUND',
      expectedAction: 'DISTRIBUTE',
      expectedShareBps: '2000',
      window: { from: '2026-08-01T00:00:00.000Z', to: capturedAt },
    },
  });
}

function snapshot(blockNumber: string, blockTimestamp: string): AnalysisSnapshot {
  const suffix = blockNumber === '100' ? 'a' : 'b';
  return {
    ledger: 'EVM',
    chainId: 'eip155:56',
    blockNumber,
    blockHash: `0x${suffix.repeat(64)}`,
    ...(blockNumber === '0' ? {} : { parentBlockHash: `0x${'c'.repeat(64)}` }),
    finality: 'finalized',
    blockTimestamp,
    capturedAt,
    providerVersions: { 'bsc-rpc': 'json-rpc' },
    adapterVersions: { evm: '0.1.0' },
    configHash: '1'.repeat(64),
    entityModelVersion: 'entity-model-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
}

function anchor(blockNumber: string, blockTimestamp: string): ChainAnchorRead {
  const current = EvmSnapshotSchema.parse(snapshot(blockNumber, blockTimestamp));
  return {
    anchor: {
      ledger: 'EVM',
      chainId: current.chainId,
      position: blockNumber,
      hash: current.blockHash,
      ...(blockNumber === '0'
        ? {}
        : {
            parentPosition: (BigInt(blockNumber) - 1n).toString(),
            parentHash: current.parentBlockHash,
          }),
      finality: 'finalized',
      source: 'bsc-rpc',
      observedAt: capturedAt,
    },
    snapshot: current,
    payload: { blockNumber },
  };
}

function run(parameters: CaptureRun['parameters'], target: CaptureRun['target']): CaptureRun {
  return {
    schemaVersion: 'capture-run-v1',
    id: `cpr_${'1'.repeat(24)}`,
    scheduleId: `cps_${'2'.repeat(24)}`,
    captureKind: 'CLAIM_ACTIONS',
    operation: 'READ_ONLY_CAPTURE',
    target,
    parameters,
    scheduledFor: capturedAt,
    status: 'LEASED',
    attempt: 1,
    maxAttempts: 3,
    availableAt: capturedAt,
    lease: knownValue({ owner: 'test-worker', token: 'a'.repeat(32), expiresAt: capturedAt }),
    result: unknownValue('NOT_QUERIED'),
    failure: unknownValue('NOT_APPLICABLE'),
    createdAt: capturedAt,
    updatedAt: capturedAt,
    completedAt: unknownValue('NOT_APPLICABLE'),
  };
}

function resources(reviewReport: ReturnType<typeof review>) {
  const schedule = buildClaimActionsSchedule({
    reviewReport,
    fromBlock: '80',
    toBlock: '100',
    createdAt: capturedAt,
    at: capturedAt,
  });
  const observations: EvmClaimAddressObservation[] = [];
  const addressReports = {
    put: vi.fn(async (report: EvmClaimAddressObservation) => {
      observations.push(report);
      const resultHash = hashPayload(report);
      return {
        id: `ecr_${hashPayload({ schema: 'zerotrace-evm-claim-report-v1', resultHash }).slice(0, 24)}`,
        chainId: 'eip155:56',
        tokenAddress: report.tokenAddress,
        address: report.address,
        fromBlock: report.fromBlock,
        toBlock: report.toBlock,
        snapshotBlock:
          report.metadata.snapshot?.ledger === 'EVM' ? report.metadata.snapshot.blockNumber : '100',
        snapshotHash:
          report.metadata.snapshot?.ledger === 'EVM'
            ? report.metadata.snapshot.blockHash
            : `0x${'a'.repeat(64)}`,
        resultHash,
        report,
        terminalEvidenceId: report.terminalEvidenceId,
        evidenceIds: report.metadata.evidenceIds,
        sourceSet: report.metadata.sourceSet,
        modelVersion: report.metadata.modelVersion,
        capturedAt,
        createdAt: capturedAt,
      };
    }),
  };
  const verification = {
    put: vi.fn(
      async (report: Parameters<ClaimActionsCaptureResources['verifications']['put']>[0]) => ({
        id: report.id,
        reviewReportId: report.reviewReportId,
        reviewResultHash: report.reviewResultHash,
        ruleId: report.ruleId,
        assetId: report.assetId,
        fromBlock: report.fromBlock,
        toBlock: report.toBlock,
        sourceObservationReportId: report.sourceObservationReportId,
        destinationObservationReportId: report.destinationObservationReportId,
        actionSemanticsReportIds: report.actionSemanticsReportIds,
        resultHash: report.resultHash,
        report,
        status: report.status,
        terminalEvidenceId: report.terminalEvidenceId,
        evidenceIds: report.evidenceIds,
        sourceSet: report.metadata.sourceSet,
        modelVersion: report.metadata.modelVersion,
        capturedAt,
        createdAt: capturedAt,
      }),
    ),
  };
  const storedReview = {
    id: reviewReport.id,
    declarationReportId: reviewReport.declarationReportId,
    declarationResultHash: reviewReport.declarationResultHash,
    documentHash: reviewReport.documentHash,
    draftId: reviewReport.draftId,
    ruleId: reviewReport.rule.id,
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    assetId: reviewReport.assetId,
    resultHash: reviewReport.resultHash,
    report: reviewReport,
    reviewEvidenceId: reviewReport.reviewEvidenceId,
    terminalEvidenceId: reviewReport.terminalEvidenceId,
    tokenDecimalsEvidenceId: reviewReport.tokenDecimalsEvidenceId ?? null,
    evidenceIds: reviewReport.evidenceIds,
    sourceSet: reviewReport.sourceSet,
    modelVersion: reviewReport.modelVersion,
    reviewedAt: reviewReport.reviewedAt,
    createdAt: capturedAt,
  };
  const evidence = {
    put: vi.fn(
      async (
        item: Parameters<ClaimActionsCaptureResources['evidence']['put']>[0],
        sourceEvidenceIds: readonly string[] = [],
        storedSnapshot?: AnalysisSnapshot,
      ) => ({
        evidence: item,
        sourceEvidenceIds: [...sourceEvidenceIds],
        ...(storedSnapshot === undefined ? {} : { snapshot: storedSnapshot }),
      }),
    ),
  };
  const adapter = {
    sourceId: 'bsc-rpc',
    config: { chainId: 56 },
    getCodeObservation: vi.fn(async () => ({ value: '0x', endpointId: 'bsc-rpc' })),
    callObservation: vi.fn(),
    readSourced: vi.fn(),
    readAnchorAt: vi.fn(async (position: string) =>
      position === '80' ? anchor('80', '2026-08-01T00:00:00.000Z') : anchor('100', capturedAt),
    ),
  };
  const logReader = {
    getLogsObservation: vi.fn(async () => ({ value: [], endpointId: 'sqd:binance-mainnet' })),
  };
  const resources = {
    reviews: { get: vi.fn(async () => storedReview) },
    addressReports,
    verifications: verification,
    evidence,
    chains: new Map([['eip155:56', { adapter, logReader }]]),
  } satisfies ClaimActionsCaptureResources;
  return {
    resources,
    run: run(schedule.definition.parameters, schedule.definition.target),
    observations,
  };
}

describe('Claim Actions capture handler', () => {
  it('captures two bounded address observations and persists a terminal Unknown-safe audit', async () => {
    const report = review();
    const fixture = resources(report);
    const result = await createClaimActionsCaptureHandler(fixture.resources)(fixture.run);

    expect(result).toMatchObject({
      resultRef: expect.stringMatching(/^cvr_[0-9a-f]{24}$/),
      snapshot: expect.objectContaining({ chainId: 'eip155:56', blockNumber: '100' }),
      modelVersion: 'claim-verification-observation-v0.1.0',
      coverage: 0,
    });
    expect(fixture.observations).toHaveLength(2);
    expect(fixture.resources.verifications.put).toHaveBeenCalledOnce();
    expect(fixture.resources.evidence.put).toHaveBeenCalled();
  });

  it('rejects a changed reviewed revision before touching chain providers', async () => {
    const report = review();
    const fixture = resources(report);
    const changed: CaptureRun = {
      ...fixture.run,
      parameters: {
        ...(fixture.run.parameters as Record<string, unknown>),
        reviewResultHash: 'f'.repeat(64),
      } as CaptureRun['parameters'],
    };
    await expect(
      createClaimActionsCaptureHandler(fixture.resources)(changed),
    ).rejects.toMatchObject({
      code: 'CLAIM_ACTIONS_REVIEW_BINDING_MISMATCH',
      sourceRetryable: false,
    });
    expect(fixture.resources.verifications.put).not.toHaveBeenCalled();
  });
});
