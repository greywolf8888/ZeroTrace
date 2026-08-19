import { z } from 'zod';
export * from './part-14.js';
import type {
  Evidence,
} from './part-14.js';
import {
  AnalysisMetadataSchema,
  ClaimLiquidityControlSchema,
  ClaimObservedActionTypeSchema,
  EvmPensionCandidateMetricsSchema,
  EvmPensionCandidatePolicySchema,
  EvmSnapshotSchema,
  IsoDateTimeSchema,
  QuantityStringSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-14.js';

export type EvmPensionCandidateMetrics = z.infer<typeof EvmPensionCandidateMetricsSchema>;

export const EvmPensionVaultCandidateSchema = EvmPensionCandidateMetricsSchema.extend({
  evidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  roleAttribution: knowledgeValueSchema(z.literal('PENSION_VAULT')),
  participantExitPolicy: knowledgeValueSchema(z.boolean()),
  dividendExecution: knowledgeValueSchema(z.boolean()),
}).superRefine((value, context) => {
  for (const field of ['roleAttribution', 'participantExitPolicy', 'dividendExecution'] as const) {
    if (value[field].state === 'known') {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Behavioral candidate discovery cannot promote social or policy meaning to fact.',
      });
    }
  }
});
export type EvmPensionVaultCandidate = z.infer<typeof EvmPensionVaultCandidateSchema>;

export const EvmPensionCandidateDiscoverySchema = z
  .object({
    tokenAddress: z.string().regex(/^0x[0-9a-f]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    policy: EvmPensionCandidatePolicySchema,
    scannedTransferCount: z.number().int().nonnegative(),
    candidates: z.array(EvmPensionVaultCandidateSchema),
    coverageEvidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('evm-pension-candidate-discovery-v1.0.0'),
    }),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    const addresses = value.candidates.map((candidate) => candidate.address);
    const coverageEvidenceIds = [...value.coverageEvidenceIds];
    const expectedEvidenceIds = [
      ...coverageEvidenceIds,
      ...value.candidates.map((candidate) => candidate.evidenceId),
      value.terminalEvidenceId,
    ].sort();
    const actualEvidenceIds = [...value.metadata.evidenceIds].sort();
    if (
      BigInt(value.toBlock) < BigInt(value.fromBlock) ||
      snapshot?.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockTimestamp === undefined ||
      snapshot.blockNumber !== value.toBlock ||
      value.metadata.freshness !== snapshot.blockTimestamp ||
      value.metadata.dataCoverage !== 1 ||
      value.metadata.historyCoverage !== 1 ||
      value.metadata.sourceSet.length === 0 ||
      value.metadata.sourceSet.length !== new Set(value.metadata.sourceSet).size ||
      value.metadata.sourceSet.some(
        (source, index) => source !== [...value.metadata.sourceSet].sort()[index],
      ) ||
      addresses.length !== new Set(addresses).size ||
      addresses.some((address, index) => address !== [...addresses].sort()[index]) ||
      value.candidates.length > value.policy.maximumCandidates ||
      coverageEvidenceIds.length !== new Set(coverageEvidenceIds).size ||
      coverageEvidenceIds.some(
        (evidenceId, index) => evidenceId !== [...coverageEvidenceIds].sort()[index],
      ) ||
      expectedEvidenceIds.length !== actualEvidenceIds.length ||
      expectedEvidenceIds.some((evidenceId, index) => evidenceId !== actualEvidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Pension candidate report range, coverage, order and Evidence must be canonical.',
      });
    }
    for (const candidate of value.candidates) {
      if (
        candidate.exactUnitDepositCount < value.policy.minimumExactUnitDeposits ||
        candidate.uniqueExactUnitDepositorCount < value.policy.minimumUniqueExactUnitDepositors
      ) {
        context.addIssue({
          code: 'custom',
          path: ['candidates'],
          message: 'Every emitted pension candidate must satisfy the recorded policy.',
        });
      }
    }
  });
export type EvmPensionCandidateDiscovery = z.infer<typeof EvmPensionCandidateDiscoverySchema>;

export const ClaimActionObservationSchema = z.object({
  id: z.string().min(1),
  type: ClaimObservedActionTypeSchema,
  actor: z.string().min(1),
  amount: UnsignedQuantityStringSchema,
  observedAt: IsoDateTimeSchema,
  transferIds: z.array(z.string().min(1)),
  path: z.array(z.string().min(1)).min(1),
  liquidityControl: ClaimLiquidityControlSchema.optional(),
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type ClaimActionObservation = z.infer<typeof ClaimActionObservationSchema>;

export const ClaimBurnConservationStatusSchema = z.enum([
  'VERIFIED',
  'CONTRADICTED',
  'NOT_APPLICABLE',
]);
export const EvmClaimBurnConservationSchema = z
  .object({
    tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    blockNumber: UnsignedQuantityStringSchema,
    blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    parentBlockNumber: UnsignedQuantityStringSchema,
    parentBlockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    totalSupplyBefore: UnsignedQuantityStringSchema,
    totalSupplyAfter: UnsignedQuantityStringSchema,
    mintedAmount: UnsignedQuantityStringSchema,
    burnedAmount: UnsignedQuantityStringSchema,
    supplyDelta: QuantityStringSchema,
    eventNetSupplyDelta: QuantityStringSchema,
    expectedSupplyAfter: QuantityStringSchema,
    status: ClaimBurnConservationStatusSchema,
    candidateBurnTransferIds: z.array(z.string().min(1)),
    actions: z.array(ClaimActionObservationSchema),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('erc20-burn-conservation-v1.0.0'),
    }),
  })
  .superRefine((value, context) => {
    const before = BigInt(value.totalSupplyBefore);
    const after = BigInt(value.totalSupplyAfter);
    const minted = BigInt(value.mintedAmount);
    const burned = BigInt(value.burnedAmount);
    const expectedAfter = before + minted - burned;
    const conserved = expectedAfter === after;
    const snapshot = value.metadata.snapshot;
    if (BigInt(value.parentBlockNumber) + 1n !== BigInt(value.blockNumber)) {
      context.addIssue({
        code: 'custom',
        path: ['parentBlockNumber'],
        message: 'Burn conservation requires adjacent parent and target blocks.',
      });
    }
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockTimestamp === undefined ||
      snapshot.blockNumber !== value.blockNumber ||
      snapshot.blockHash.toLowerCase() !== value.blockHash.toLowerCase() ||
      snapshot.parentBlockHash?.toLowerCase() !== value.parentBlockHash.toLowerCase() ||
      value.metadata.freshness !== snapshot.blockTimestamp
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Burn conservation metadata must bind the exact target and parent block.',
      });
    }
    if (value.metadata.dataCoverage !== 1 || value.metadata.historyCoverage !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Burn conservation requires complete target-block data and history.',
      });
    }
    if (
      value.supplyDelta !== (after - before).toString() ||
      value.eventNetSupplyDelta !== (minted - burned).toString() ||
      value.expectedSupplyAfter !== expectedAfter.toString()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['supplyDelta'],
        message: 'Burn conservation arithmetic is inconsistent.',
      });
    }
    const expectedStatus = !conserved
      ? 'CONTRADICTED'
      : burned === 0n
        ? 'NOT_APPLICABLE'
        : 'VERIFIED';
    if (value.status !== expectedStatus) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Burn conservation status does not match the supply/event result.',
      });
    }
    if (
      new Set(value.candidateBurnTransferIds).size !== value.candidateBurnTransferIds.length ||
      new Set(value.actions.map((action) => action.id)).size !== value.actions.length ||
      new Set(value.metadata.evidenceIds).size !== value.metadata.evidenceIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'Burn conservation action and transfer identities must be unique.',
      });
    }
    if (!value.metadata.evidenceIds.includes(value.terminalEvidenceId)) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceId'],
        message: 'Burn conservation metadata must include terminal Evidence.',
      });
    }
    if ((!conserved || burned === 0n) && value.actions.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'Burn actions require verified non-zero supply/event conservation.',
      });
    }
    const mappedTransferIds = value.actions.flatMap((action) => action.transferIds);
    const metadataEvidenceIds = new Set(value.metadata.evidenceIds);
    const snapshotBlockTimestamp = snapshot?.ledger === 'EVM' ? snapshot.blockTimestamp : undefined;
    if (
      conserved &&
      burned > 0n &&
      (value.actions.length !== value.candidateBurnTransferIds.length ||
        new Set(mappedTransferIds).size !== mappedTransferIds.length ||
        value.candidateBurnTransferIds.some((id) => !mappedTransferIds.includes(id)) ||
        value.actions.reduce((total, action) => total + BigInt(action.amount), 0n) !== burned ||
        value.actions.some(
          (action) =>
            action.type !== 'BURN' ||
            action.liquidityControl !== undefined ||
            action.transferIds.length !== 1 ||
            !value.candidateBurnTransferIds.includes(action.transferIds[0] ?? '') ||
            action.path.length !== 2 ||
            !/^0x[a-fA-F0-9]{40}$/.test(action.actor) ||
            !action.path.every((address) => /^0x[a-fA-F0-9]{40}$/.test(address)) ||
            action.path[0]?.toLowerCase() !== action.actor.toLowerCase() ||
            action.path[1]?.toLowerCase() !== `0x${'0'.repeat(40)}` ||
            action.evidenceIds.includes(value.terminalEvidenceId) ||
            new Set(action.evidenceIds).size !== action.evidenceIds.length ||
            action.evidenceIds.some((id) => !metadataEvidenceIds.has(id)) ||
            action.observedAt !== snapshotBlockTimestamp,
        ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'Verified burn actions must map one-to-one to conserved zero-address transfers.',
      });
    }
  });
export type EvmClaimBurnConservation = z.infer<typeof EvmClaimBurnConservationSchema>;

export const EvmClaimBurnCandidateBlockSchema = z.object({
  blockNumber: UnsignedQuantityStringSchema,
  blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  burnTransferIds: z.array(z.string().min(1)).min(1),
  mintedEventAmount: UnsignedQuantityStringSchema,
  burnedEventAmount: UnsignedQuantityStringSchema,
});
export type EvmClaimBurnCandidateBlock = z.infer<typeof EvmClaimBurnCandidateBlockSchema>;

export const EvmClaimBurnCandidateDiscoverySchema = z
  .object({
    tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    coverageScope: z.literal('ERC20_ZERO_ADDRESS_TRANSFER_EVENTS'),
    status: z.enum(['CANDIDATES_DISCOVERED', 'NO_EVENT_CANDIDATES']),
    zeroAddressEventCount: z.number().int().nonnegative(),
    burnCandidateCount: z.number().int().nonnegative(),
    candidates: z.array(EvmClaimBurnCandidateBlockSchema),
    silentSupplyChangeDetection: knowledgeValueSchema(z.boolean()),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('erc20-burn-candidate-discovery-v1.0.0'),
    }),
  })
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const snapshot = value.metadata.snapshot;
    const expectedStatus =
      value.candidates.length === 0 ? 'NO_EVENT_CANDIDATES' : 'CANDIDATES_DISCOVERED';
    if (toBlock < fromBlock) {
      context.addIssue({
        code: 'custom',
        path: ['toBlock'],
        message: 'Burn candidate discovery range must be ordered.',
      });
    }
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockTimestamp === undefined ||
      snapshot.blockNumber !== value.toBlock ||
      value.metadata.freshness !== snapshot.blockTimestamp
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Burn candidate discovery must bind the finalized range-end Snapshot.',
      });
    }
    if (value.metadata.dataCoverage !== 1 || value.metadata.historyCoverage !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Burn candidate discovery requires complete event-query coverage.',
      });
    }
    if (
      value.status !== expectedStatus ||
      value.burnCandidateCount !== value.candidates.length ||
      value.zeroAddressEventCount <
        value.candidates.reduce((total, candidate) => total + candidate.burnTransferIds.length, 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Burn candidate discovery counts and status are inconsistent.',
      });
    }
    if (value.silentSupplyChangeDetection.state !== 'unknown') {
      context.addIssue({
        code: 'custom',
        path: ['silentSupplyChangeDetection'],
        message: 'Event-only discovery cannot claim silent supply-change coverage.',
      });
    }
    const candidateBlocks = new Set<string>();
    const transferIds = new Set<string>();
    let previousBlock: bigint | undefined;
    for (const candidate of value.candidates) {
      const block = BigInt(candidate.blockNumber);
      const invalidTransferIdentity = candidate.burnTransferIds.some((id) => {
        if (transferIds.has(id)) return true;
        transferIds.add(id);
        return false;
      });
      if (
        block < fromBlock ||
        block > toBlock ||
        (previousBlock !== undefined && block <= previousBlock) ||
        candidateBlocks.has(candidate.blockNumber) ||
        invalidTransferIdentity ||
        BigInt(candidate.burnedEventAmount) <= 0n ||
        (snapshot?.ledger === 'EVM' &&
          candidate.blockNumber === snapshot.blockNumber &&
          candidate.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase())
      ) {
        context.addIssue({
          code: 'custom',
          path: ['candidates'],
          message: 'Burn candidates must be unique, ordered, in-range, and Snapshot-consistent.',
        });
        break;
      }
      candidateBlocks.add(candidate.blockNumber);
      previousBlock = block;
    }
    if (
      !value.metadata.evidenceIds.includes(value.terminalEvidenceId) ||
      new Set(value.metadata.evidenceIds).size !== value.metadata.evidenceIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceId'],
        message: 'Burn candidate discovery requires unique metadata and terminal Evidence.',
      });
    }
  });
export type EvmClaimBurnCandidateDiscovery = z.infer<typeof EvmClaimBurnCandidateDiscoverySchema>;

export const EvmClaimBurnPromotionCertificateSchema = z.object({
  blockNumber: UnsignedQuantityStringSchema,
  blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  burnTransferIds: z.array(z.string().min(1)).min(1),
  mintedEventAmount: UnsignedQuantityStringSchema,
  burnedEventAmount: UnsignedQuantityStringSchema,
  status: z.enum(['VERIFIED', 'CONTRADICTED']),
  actionCount: z.number().int().nonnegative(),
  terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
});
export type EvmClaimBurnPromotionCertificate = z.infer<
  typeof EvmClaimBurnPromotionCertificateSchema
>;

export const EvmClaimBurnPromotionSegmentSchema = z
  .object({
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    zeroAddressEventCount: z.number().int().nonnegative(),
    burnCandidateCount: z.number().int().nonnegative(),
    discoveryTerminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    certificates: z.array(EvmClaimBurnPromotionCertificateSchema),
    snapshot: EvmSnapshotSchema,
    sourceSet: z.array(z.string().min(1)).min(1),
  })
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const transferIds = new Set<string>();
    let previousBlock: bigint | undefined;
    if (
      toBlock < fromBlock ||
      value.burnCandidateCount !== value.certificates.length ||
      value.snapshot.blockNumber !== value.toBlock ||
      value.snapshot.finality !== 'finalized' ||
      value.snapshot.blockTimestamp === undefined ||
      new Set(value.sourceSet).size !== value.sourceSet.length ||
      [...value.sourceSet].sort().some((source, index) => source !== value.sourceSet[index]) ||
      Object.keys(value.snapshot.providerVersions).some(
        (source) => !value.sourceSet.includes(source),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['burnCandidateCount'],
        message: 'Burn promotion segment range and candidate count must be consistent.',
      });
    }
    for (const certificate of value.certificates) {
      const block = BigInt(certificate.blockNumber);
      const duplicateTransfer = certificate.burnTransferIds.some((id) => {
        if (transferIds.has(id)) return true;
        transferIds.add(id);
        return false;
      });
      if (
        block < fromBlock ||
        block > toBlock ||
        (previousBlock !== undefined && block <= previousBlock) ||
        duplicateTransfer ||
        BigInt(certificate.burnedEventAmount) <= 0n ||
        (certificate.status === 'VERIFIED'
          ? certificate.actionCount !== certificate.burnTransferIds.length
          : certificate.actionCount !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['certificates'],
          message:
            'Burn promotion certificates must be ordered, unique, in-range, and action-consistent.',
        });
        break;
      }
      previousBlock = block;
    }
  });
export type EvmClaimBurnPromotionSegment = z.infer<typeof EvmClaimBurnPromotionSegmentSchema>;

export const EvmClaimBurnPromotionSchema = z
  .object({
    tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    coverageScope: z.literal(
      'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION',
    ),
    status: z.literal('REQUESTED_RANGE_COMPLETE'),
    segmentCount: z.number().int().positive(),
    zeroAddressEventCount: z.number().int().nonnegative(),
    burnCandidateCount: z.number().int().nonnegative(),
    verifiedCandidateCount: z.number().int().nonnegative(),
    contradictedCandidateCount: z.number().int().nonnegative(),
    verifiedActionCount: z.number().int().nonnegative(),
    segments: z.array(EvmClaimBurnPromotionSegmentSchema).min(1),
    silentSupplyChangeDetection: knowledgeValueSchema(z.boolean()),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('erc20-burn-candidate-promotion-v1.0.0'),
    }),
  })
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const snapshot = value.metadata.snapshot;
    let nextBlock = fromBlock;
    const terminalEvidenceIds: string[] = [];
    const sourceSet = new Set<string>();
    const certificates = value.segments.flatMap((segment) => {
      if (BigInt(segment.fromBlock) !== nextBlock) {
        context.addIssue({
          code: 'custom',
          path: ['segments'],
          message: 'Burn promotion segments must be contiguous.',
        });
      }
      nextBlock = BigInt(segment.toBlock) + 1n;
      terminalEvidenceIds.push(
        segment.discoveryTerminalEvidenceId,
        ...segment.certificates.map((certificate) => certificate.terminalEvidenceId),
      );
      segment.sourceSet.forEach((source) => sourceSet.add(source));
      return segment.certificates;
    });
    terminalEvidenceIds.push(value.terminalEvidenceId);
    const verified = certificates.filter((item) => item.status === 'VERIFIED');
    const contradicted = certificates.filter((item) => item.status === 'CONTRADICTED');
    if (
      toBlock < fromBlock ||
      nextBlock !== toBlock + 1n ||
      value.segmentCount !== value.segments.length ||
      value.zeroAddressEventCount !==
        value.segments.reduce((total, segment) => total + segment.zeroAddressEventCount, 0) ||
      value.burnCandidateCount !== certificates.length ||
      value.verifiedCandidateCount !== verified.length ||
      value.contradictedCandidateCount !== contradicted.length ||
      value.verifiedActionCount !==
        verified.reduce((total, certificate) => total + certificate.actionCount, 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['segments'],
        message: 'Burn promotion range and aggregate counts are inconsistent.',
      });
    }
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockTimestamp === undefined ||
      snapshot.blockNumber !== value.toBlock ||
      snapshot.blockHash.toLowerCase() !==
        value.segments.at(-1)?.snapshot.blockHash.toLowerCase() ||
      value.metadata.freshness !== snapshot.blockTimestamp ||
      value.metadata.dataCoverage !== 1 ||
      value.metadata.historyCoverage !== 1 ||
      [...sourceSet].sort().some((source, index) => source !== value.metadata.sourceSet[index]) ||
      sourceSet.size !== value.metadata.sourceSet.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Burn promotion must bind complete scoped coverage to its final Snapshot.',
      });
    }
    if (value.silentSupplyChangeDetection.state !== 'unknown') {
      context.addIssue({
        code: 'custom',
        path: ['silentSupplyChangeDetection'],
        message: 'Event promotion cannot claim silent supply-change coverage.',
      });
    }
    const expectedEvidenceIds = [...new Set(terminalEvidenceIds)].sort();
    const actualEvidenceIds = [...value.metadata.evidenceIds].sort();
    if (
      expectedEvidenceIds.length !== terminalEvidenceIds.length ||
      expectedEvidenceIds.length !== actualEvidenceIds.length ||
      expectedEvidenceIds.some((id, index) => id !== actualEvidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'evidenceIds'],
        message:
          'Burn promotion metadata must contain each terminal Evidence identity exactly once.',
      });
    }
  });
