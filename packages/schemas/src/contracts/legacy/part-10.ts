import { z } from 'zod';
export * from './part-09.js';
import type {
  AnalysisSnapshot,
  Evidence,
} from './part-09.js';
import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  CanonicalStringArraySchema,
  CoverageRatioSchema,
  EvidenceSchema,
  EvmCanonicalAddressSchema,
  EvmContractKindSchema,
  EvmControlCoverageDomainSchema,
  EvmControlCoverageSchema,
  EvmControlRightSchema,
  EvmControlRightTypeSchema,
  EvmLogicCodeSchema,
  EvmSafeControlSchema,
  EvmVerifiedSourceSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  JsonValueSchema,
  QuantityStringSchema,
  SubjectReferenceSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-09.js';

export type EvmVerifiedSource = z.infer<typeof EvmVerifiedSourceSchema>;

export const EvmDeclaredCapabilitySchema = z.object({
  rightType: EvmControlRightTypeSchema,
  functionSignatures: z.array(z.string().min(1).max(2_048)).min(1).max(64),
  detail: z.string().min(1),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
});
export type EvmDeclaredCapability = z.infer<typeof EvmDeclaredCapabilitySchema>;

export const EvmControlSurfaceReportSchema = z
  .object({
    ledger: z.literal('EVM'),
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    subject: EvmCanonicalAddressSchema,
    contractKind: knowledgeValueSchema(EvmContractKindSchema),
    implementationAddress: knowledgeValueSchema(EvmCanonicalAddressSchema),
    proxyAdminAddress: knowledgeValueSchema(EvmCanonicalAddressSchema),
    beaconAddress: knowledgeValueSchema(EvmCanonicalAddressSchema),
    ownerAddress: knowledgeValueSchema(EvmCanonicalAddressSchema),
    safe: knowledgeValueSchema(EvmSafeControlSchema),
    logicCode: knowledgeValueSchema(EvmLogicCodeSchema).optional(),
    verifiedSource: knowledgeValueSchema(EvmVerifiedSourceSchema).optional(),
    declaredCapabilities: z.array(EvmDeclaredCapabilitySchema).optional(),
    sourceAgreement: knowledgeValueSchema(z.boolean()),
    sourceIndependence: knowledgeValueSchema(z.boolean()),
    rights: z.array(EvmControlRightSchema),
    coverage: z.array(EvmControlCoverageSchema),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot?.ledger === 'EVM', {
      message: 'EVM control surface requires an EVM Snapshot.',
    }),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    if (
      snapshot?.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.chainId !== value.chainId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Control surface identity requires one finalized matching EVM Snapshot.',
      });
    }
    const domains = value.coverage.map((item) => item.domain);
    const expectedDomains = EvmControlCoverageDomainSchema.options
      .filter(
        (domain) =>
          value.metadata.modelVersion !== 'evm-control-surface-v1.0.0' ||
          !['LOGIC_CODE', 'MIGRATION'].includes(domain),
      )
      .sort();
    if (
      domains.length !== expectedDomains.length ||
      [...new Set(domains)].sort().some((domain, index) => domain !== expectedDomains[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['coverage'],
        message: 'Control surface coverage must include every EVM control domain exactly once.',
      });
    }
    const evidenceIds = value.evidence.map((item) => item.id).sort();
    const metadataEvidenceIds = value.metadata.evidenceIds;
    const nestedEvidenceIds = [
      ...value.rights.flatMap((right) => right.evidenceIds),
      ...value.coverage.flatMap((item) => item.evidenceIds),
      ...(value.declaredCapabilities ?? []).flatMap((item) => item.evidenceIds),
    ];
    if (
      metadataEvidenceIds.length !== new Set(metadataEvidenceIds).size ||
      metadataEvidenceIds.some((id, index) => id !== evidenceIds[index]) ||
      evidenceIds.length !== metadataEvidenceIds.length ||
      !metadataEvidenceIds.includes(value.terminalEvidenceId) ||
      nestedEvidenceIds.some((id) => !metadataEvidenceIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'evidenceIds'],
        message: 'Control surface provenance must be canonical and contain all nested Evidence.',
      });
    }
    if (
      value.logicCode?.state === 'known' &&
      value.verifiedSource?.state === 'known' &&
      (value.logicCode.value.address !== value.verifiedSource.value.address ||
        value.logicCode.value.runtimeBytecodeHash !==
          value.verifiedSource.value.runtimeBytecodeHash ||
        value.logicCode.value.runtimeBytecodeBytes !==
          value.verifiedSource.value.runtimeBytecodeBytes)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['verifiedSource'],
        message: 'Verified source must match the exact Snapshot-bound logic bytecode.',
      });
    }
    if (
      value.metadata.modelVersion === 'evm-control-surface-v1.1.0' &&
      (value.logicCode === undefined ||
        value.verifiedSource === undefined ||
        value.declaredCapabilities === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'modelVersion'],
        message: 'Control surface v1.1 requires logic code and verified-source fields.',
      });
    }
  });
export type EvmControlSurfaceReport = z.infer<typeof EvmControlSurfaceReportSchema>;

export const SolanaPublicKeySchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const SolanaLaunchpadPlatformSchema = z.enum(['PUMP', 'PUMPSWAP', 'RAYDIUM_LAUNCHLAB']);
export type SolanaLaunchpadPlatform = z.infer<typeof SolanaLaunchpadPlatformSchema>;

export const SolanaLaunchpadInstructionCategorySchema = z.enum([
  'CREATE',
  'TRADE',
  'MIGRATION',
  'POOL_CREATE',
  'LIQUIDITY',
  'SWAP',
  'ADMIN_OR_UTILITY',
]);
export type SolanaLaunchpadInstructionCategory = z.infer<
  typeof SolanaLaunchpadInstructionCategorySchema
>;

export const SolanaLaunchpadExecutionSchema = z.enum(['SUCCESS', 'FAILED', 'UNKNOWN']);

export const SolanaLaunchpadDecodedArgumentSchema = z.object({
  name: z.string().min(1).max(128),
  value: z.string().max(2048),
});
export type SolanaLaunchpadDecodedArgument = z.infer<typeof SolanaLaunchpadDecodedArgumentSchema>;

export const SolanaLaunchpadAccountSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1).max(128),
  address: SolanaPublicKeySchema.optional(),
});
export type SolanaLaunchpadAccount = z.infer<typeof SolanaLaunchpadAccountSchema>;

export const SolanaLaunchpadObservationSchema = z
  .object({
    schemaVersion: z.literal('solana-launchpad-observation-v1'),
    id: z.string().regex(/^slo_[0-9a-f]{24}$/),
    platform: SolanaLaunchpadPlatformSchema,
    programId: SolanaPublicKeySchema,
    deploymentId: z.string().min(1).max(128),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    abiOrIdlHash: Hash256Schema,
    officialSourceUris: z.array(z.string().url()).min(1),
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
    slot: UnsignedQuantityStringSchema,
    instructionPath: z.string().regex(/^outer:\d+(?:\/inner:\d+)?$/),
    instructionName: z.string().min(1).max(128),
    instructionVersion: z.enum(['LEGACY', 'V2', 'CURRENT']),
    category: SolanaLaunchpadInstructionCategorySchema,
    discriminator: z.string().regex(/^[0-9a-f]{16}$/),
    accountIndexes: z.array(z.number().int().nonnegative()).max(256),
    accounts: z.array(SolanaLaunchpadAccountSchema).max(256),
    accountCoverage: CoverageRatioSchema,
    decodedArguments: z.array(SolanaLaunchpadDecodedArgumentSchema).max(64),
    argumentCoverage: CoverageRatioSchema,
    decodeWarnings: z.array(z.string().min(1).max(320)).max(16),
    execution: SolanaLaunchpadExecutionSchema,
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.slot
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana launchpad observations require an exact finalized slot Snapshot.',
      });
    }
    const evidenceIds = [...value.evidenceIds].sort();
    if (
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((id, index) => id !== evidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Launchpad observation Evidence IDs must be sorted and unique.',
      });
    }
  });
export type SolanaLaunchpadObservation = z.infer<typeof SolanaLaunchpadObservationSchema>;

export const RaydiumLaunchlabPoolStateReadIdSchema = z.string().regex(/^rlp_[0-9a-f]{24}$/);

export const RaydiumLaunchlabPoolStateReadSchema = z
  .object({
    schemaVersion: z.literal('raydium-launchlab-pool-state-read-v1'),
    id: RaydiumLaunchlabPoolStateReadIdSchema,
    account: SolanaPublicKeySchema,
    programId: SolanaPublicKeySchema,
    exists: z.boolean(),
    ownerVerified: z.boolean(),
    discriminatorMatched: z.boolean(),
    accountDataLength: z.number().int().nonnegative(),
    expectedAccountDataLength: z.number().int().positive(),
    requestedSlot: UnsignedQuantityStringSchema.optional(),
    observedContextSlot: UnsignedQuantityStringSchema,
    stateAtRequestedSlot: z.enum(['EXACT', 'MIN_CONTEXT_ONLY', 'UNKNOWN']),
    decodedFields: z.array(SolanaLaunchpadDecodedArgumentSchema).max(64),
    fieldCoverage: CoverageRatioSchema,
    decodeWarnings: z.array(z.string().min(1).max(320)).max(16),
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('solana-raydium-launchlab-v1.0.0'),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.observedContextSlot ||
      value.snapshot.commitment !== 'finalized'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Raydium PoolState reads require a finalized Snapshot at the RPC context slot.',
      });
    }
    if (!value.exists && (value.ownerVerified || value.discriminatorMatched)) {
      context.addIssue({
        code: 'custom',
        path: ['exists'],
        message: 'An absent PoolState account cannot be owner- or discriminator-verified.',
      });
    }
    if (value.ownerVerified && !value.discriminatorMatched && value.fieldCoverage > 0) {
      context.addIssue({
        code: 'custom',
        path: ['fieldCoverage'],
        message: 'A non-PoolState discriminator cannot carry decoded PoolState fields.',
      });
    }
    const evidenceIds = [...value.evidenceIds].sort();
    if (
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((id, index) => id !== evidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Raydium PoolState read Evidence IDs must be sorted and unique.',
      });
    }
    if (value.stateAtRequestedSlot === 'EXACT' && value.requestedSlot !== undefined) {
      if (value.requestedSlot !== value.observedContextSlot) {
        context.addIssue({
          code: 'custom',
          path: ['stateAtRequestedSlot'],
          message:
            'EXACT PoolState state must have the requested slot as its observed context slot.',
        });
      }
    }
  });
export type RaydiumLaunchlabPoolStateRead = z.infer<typeof RaydiumLaunchlabPoolStateReadSchema>;

export const SolanaTransactionAccountSourceSchema = z.enum([
  'STATIC',
  'LOOKUP_WRITABLE',
  'LOOKUP_READONLY',
]);
export type SolanaTransactionAccountSource = z.infer<typeof SolanaTransactionAccountSourceSchema>;

export const SolanaTransactionAccountSchema = z.object({
  index: z.number().int().nonnegative(),
  address: SolanaPublicKeySchema,
  source: SolanaTransactionAccountSourceSchema,
  signer: z.boolean(),
  writable: z.boolean(),
  feePayer: z.boolean(),
  preBalanceLamports: knowledgeValueSchema(UnsignedQuantityStringSchema),
  postBalanceLamports: knowledgeValueSchema(UnsignedQuantityStringSchema),
  balanceDeltaLamports: knowledgeValueSchema(QuantityStringSchema),
});
export type SolanaTransactionAccount = z.infer<typeof SolanaTransactionAccountSchema>;

export const SolanaAddressTableLookupObservationSchema = z.object({
  accountKey: SolanaPublicKeySchema,
  writableIndexes: z.array(z.number().int().min(0).max(255)),
  readonlyIndexes: z.array(z.number().int().min(0).max(255)),
});
export type SolanaAddressTableLookupObservation = z.infer<
  typeof SolanaAddressTableLookupObservationSchema
>;

export const SolanaInstructionObservationSchema = z.object({
  path: z.string().regex(/^outer:\d+(?:\/inner:\d+)?$/),
  outerIndex: z.number().int().nonnegative(),
  innerIndex: knowledgeValueSchema(z.number().int().nonnegative()),
  stackHeight: knowledgeValueSchema(z.number().int().nonnegative()),
  programIdIndex: z.number().int().nonnegative(),
  programId: knowledgeValueSchema(SolanaPublicKeySchema),
  accountIndexes: z.array(z.number().int().nonnegative()),
  accounts: knowledgeValueSchema(z.array(SolanaPublicKeySchema)),
  dataBase58: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]*$/),
  programSemantic: knowledgeValueSchema(
    z.object({
      programFamily: z.enum(['SYSTEM', 'SPL_TOKEN', 'TOKEN_2022']),
      instructionName: z.string().min(1).max(128),
      category: z.enum([
        'ASSET_TRANSFER',
        'SUPPLY_INCREASE',
        'SUPPLY_DECREASE',
        'ACCOUNT_LIFECYCLE',
        'CONTROL_CHANGE',
        'OTHER',
      ]),
      application: z.enum(['APPLIED', 'NOT_APPLIED', 'UNKNOWN']),
    }),
  ),
});
export type SolanaInstructionObservation = z.infer<typeof SolanaInstructionObservationSchema>;

export const SolanaAssetFlowSchema = z.object({
  id: z.string().regex(/^outer:\d+(?:\/inner:\d+)?:flow:\d+$/),
  instructionPath: z.string().regex(/^outer:\d+(?:\/inner:\d+)?$/),
  programFamily: z.enum(['SYSTEM', 'SPL_TOKEN', 'TOKEN_2022']),
  instructionName: z.string().min(1).max(128),
  application: z.enum(['APPLIED', 'NOT_APPLIED', 'UNKNOWN']),
  flowKind: z.enum(['TRANSFER', 'MINT', 'BURN']),
  assetKind: z.enum(['NATIVE_SOL', 'WRAPPED_SOL', 'SPL_TOKEN', 'TOKEN_2022']),
  sourceAccount: knowledgeValueSchema(SolanaPublicKeySchema),
  destinationAccount: knowledgeValueSchema(SolanaPublicKeySchema),
  sourceOwner: knowledgeValueSchema(SolanaPublicKeySchema),
  destinationOwner: knowledgeValueSchema(SolanaPublicKeySchema),
  mint: knowledgeValueSchema(SolanaPublicKeySchema),
  authority: knowledgeValueSchema(SolanaPublicKeySchema),
  amount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  decimals: knowledgeValueSchema(z.number().int().min(0).max(255)),
  expectedFeeAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  expectedRecipientAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
});
export type SolanaAssetFlow = z.infer<typeof SolanaAssetFlowSchema>;

export const SolanaTokenFlowReconciliationSchema = z.object({
  status: z.enum(['MATCHED', 'PARTIAL', 'CONFLICT', 'NOT_APPLICABLE', 'UNKNOWN']),
  expectedIdentityCount: z.number().int().nonnegative(),
  observedIdentityCount: z.number().int().nonnegative(),
  matchedIdentityCount: z.number().int().nonnegative(),
  conflictingIdentityCount: z.number().int().nonnegative(),
  unknownIdentityCount: z.number().int().nonnegative(),
  unmodeledTokenInstructionCount: z.number().int().nonnegative(),
  coverage: CoverageRatioSchema,
  recommendedMaxRelativeError: z.literal(0),
  observedRelativeError: knowledgeValueSchema(z.number().nonnegative()),
  detail: z.string().min(1),
});
export type SolanaTokenFlowReconciliation = z.infer<typeof SolanaTokenFlowReconciliationSchema>;

export const SolanaTokenBalanceChangeSchema = z.object({
  accountIndex: z.number().int().nonnegative(),
  account: knowledgeValueSchema(SolanaPublicKeySchema),
  mint: SolanaPublicKeySchema,
  ownerBefore: knowledgeValueSchema(SolanaPublicKeySchema),
  ownerAfter: knowledgeValueSchema(SolanaPublicKeySchema),
  programId: knowledgeValueSchema(SolanaPublicKeySchema),
  decimals: knowledgeValueSchema(z.number().int().min(0).max(255)),
  preAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  postAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  deltaAmount: knowledgeValueSchema(QuantityStringSchema),
});
export type SolanaTokenBalanceChange = z.infer<typeof SolanaTokenBalanceChangeSchema>;

export const SolanaTransactionSemanticsSchema = z.object({
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
  version: z.union([z.literal('legacy'), UnsignedQuantityStringSchema]),
  recentBlockhash: SolanaPublicKeySchema,
  execution: z.enum(['SUCCESS', 'FAILED', 'METADATA_UNAVAILABLE']),
  executionError: knowledgeValueSchema(JsonValueSchema),
  feePayer: knowledgeValueSchema(SolanaPublicKeySchema),
  signers: z.array(SolanaPublicKeySchema).min(1),
  requiredSignatureCount: z.number().int().positive(),
  staticAccountCount: z.number().int().positive(),
  loadedWritableAccountCount: z.number().int().nonnegative(),
  loadedReadonlyAccountCount: z.number().int().nonnegative(),
  accountResolutionComplete: knowledgeValueSchema(z.boolean()),
  accountCoverage: CoverageRatioSchema,
  recordingCoverage: CoverageRatioSchema,
  accounts: z.array(SolanaTransactionAccountSchema).min(1),
  addressTableLookups: z.array(SolanaAddressTableLookupObservationSchema),
  outerInstructions: z.array(SolanaInstructionObservationSchema),
  innerInstructionRecording: knowledgeValueSchema(z.boolean()),
  innerInstructions: z.array(SolanaInstructionObservationSchema),
  cpiCount: knowledgeValueSchema(z.number().int().nonnegative()),
  programIds: z.array(SolanaPublicKeySchema),
  officialProgramInstructionCount: z.number().int().nonnegative(),
  identifiedOfficialProgramInstructionCount: z.number().int().nonnegative(),
  officialProgramIdentificationCoverage: knowledgeValueSchema(CoverageRatioSchema),
  assetFlowCandidateCount: z.number().int().nonnegative(),
  assetFlowDecodeCoverage: knowledgeValueSchema(CoverageRatioSchema),
  assetFlowCoverage: knowledgeValueSchema(CoverageRatioSchema),
  assetFlows: z.array(SolanaAssetFlowSchema),
  tokenFlowReconciliation: SolanaTokenFlowReconciliationSchema,
  tokenBalanceRecording: knowledgeValueSchema(z.boolean()),
  tokenBalanceChanges: z.array(SolanaTokenBalanceChangeSchema),
  computeUnitsConsumed: knowledgeValueSchema(UnsignedQuantityStringSchema),
  logRecording: knowledgeValueSchema(z.boolean()),
  logCount: knowledgeValueSchema(z.number().int().nonnegative()),
  modelVersion: z.literal('solana-transaction-semantics-v1.1.0'),
});
export type SolanaTransactionSemantics = z.infer<typeof SolanaTransactionSemanticsSchema>;

export const SolanaTransactionFactsSchema = z.object({
  status: knowledgeValueSchema(z.literal('CONFIRMED')),
  slot: knowledgeValueSchema(UnsignedQuantityStringSchema),
  blockTime: knowledgeValueSchema(IsoDateTimeSchema),
  version: knowledgeValueSchema(z.union([z.literal('legacy'), UnsignedQuantityStringSchema])),
  feeLamports: knowledgeValueSchema(UnsignedQuantityStringSchema),
  execution: knowledgeValueSchema(z.enum(['SUCCESS', 'FAILED'])),
  transactionSemantics: knowledgeValueSchema(SolanaTransactionSemanticsSchema),
  feePayer: knowledgeValueSchema(SolanaPublicKeySchema),
  signerCount: knowledgeValueSchema(z.number().int().nonnegative()),
  outerInstructionCount: knowledgeValueSchema(z.number().int().nonnegative()),
  cpiCount: knowledgeValueSchema(z.number().int().nonnegative()),
  accountResolutionComplete: knowledgeValueSchema(z.boolean()),
  tokenBalanceChangeCount: knowledgeValueSchema(z.number().int().nonnegative()),
  coreAssetFlowCount: knowledgeValueSchema(z.number().int().nonnegative()),
  tokenFlowReconciliation: knowledgeValueSchema(SolanaTokenFlowReconciliationSchema),
});
export type SolanaTransactionFacts = z.infer<typeof SolanaTransactionFactsSchema>;

export const SolanaTransactionIntelligenceReportSchema = z
  .object({
    ledger: z.literal('SOLANA'),
    chainId: z.literal('solana-mainnet'),
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
    subject: SubjectReferenceSchema,
    facts: SolanaTransactionFactsSchema,
    launchpadObservations: z.array(SolanaLaunchpadObservationSchema).optional(),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine(
      (metadata) =>
        metadata.snapshot?.ledger === 'SOLANA' &&
        metadata.snapshot.chainId === 'solana-mainnet' &&
        metadata.snapshot.commitment === 'finalized' &&
        metadata.modelVersion === 'solana-transaction-query-v1.1.0',
      { message: 'Solana transaction reports require one finalized v1.1 Solana Snapshot.' },
    ),
    evidence: z.array(EvidenceSchema).min(2),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    const solanaSnapshot = snapshot?.ledger === 'SOLANA' ? snapshot : undefined;
    const semantics =
      value.facts.transactionSemantics.state === 'known'
        ? value.facts.transactionSemantics.value
        : undefined;
    const slot = value.facts.slot.state === 'known' ? value.facts.slot.value : undefined;
    const status = value.facts.status.state === 'known' ? value.facts.status.value : undefined;
    const launchpadObservations = value.launchpadObservations ?? [];
    if (
      solanaSnapshot === undefined ||
      value.subject.ledger !== 'SOLANA' ||
      value.subject.chainId !== value.chainId ||
      value.subject.type !== 'TRANSACTION' ||
      value.subject.id !== value.signature ||
      value.subject.normalizedId !== value.signature ||
      semantics?.signature !== value.signature ||
      slot !== solanaSnapshot.slot ||
      status !== 'CONFIRMED'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['signature'],
        message: 'Solana transaction report identity, facts, semantics, and Snapshot must agree.',
      });
    }

    const evidenceIds = value.evidence.map((item) => item.id).sort();
    const metadataEvidenceIds = [...value.metadata.evidenceIds].sort();
    const terminalEvidence = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    if (
      evidenceIds.length !== new Set(evidenceIds).size ||
      metadataEvidenceIds.length !== new Set(metadataEvidenceIds).size ||
      evidenceIds.length !== metadataEvidenceIds.length ||
      evidenceIds.some((id, index) => id !== metadataEvidenceIds[index]) ||
      terminalEvidence?.ledger !== 'SOLANA' ||
      terminalEvidence.chainId !== value.chainId ||
      terminalEvidence.kind !== 'DERIVED_FEATURE' ||
      terminalEvidence.source !== `zerotrace:${semantics?.modelVersion ?? ''}` ||
      terminalEvidence.locator !==
        `transaction-semantics:${value.signature}@${solanaSnapshot?.slot ?? ''}` ||
      terminalEvidence.blockOrSlot !== solanaSnapshot?.slot ||
      terminalEvidence.finality !== 'finalized'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceId'],
        message: 'Solana transaction report Evidence provenance is incomplete or inconsistent.',
      });
    }

    const sourceSet = value.metadata.sourceSet;
    if (
      sourceSet.length === 0 ||
      sourceSet.length !== new Set(sourceSet).size ||
      sourceSet.some((source, index) => source !== [...sourceSet].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'sourceSet'],
        message: 'Solana transaction report sourceSet must be non-empty, sorted, and unique.',
      });
    }
    const reportEvidenceIds = new Set(value.evidence.map((item) => item.id));
    const solanaBlockhash = (
      solanaSnapshot as Extract<AnalysisSnapshot, { ledger: 'SOLANA' }> | undefined
    )?.blockhash;
    for (const observation of launchpadObservations) {
      const observationBlockhash = (
        observation.snapshot as Extract<AnalysisSnapshot, { ledger: 'SOLANA' }>
      ).blockhash;
      if (
        observation.signature !== value.signature ||
        observation.slot !== solanaSnapshot?.slot ||
        observationBlockhash !== solanaBlockhash ||
        observation.evidenceIds.some((evidenceId) => !reportEvidenceIds.has(evidenceId))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['launchpadObservations'],
          message:
            'Solana launchpad observations must reference this transaction, exact Snapshot, and report Evidence.',
        });
      }
    }
  });
