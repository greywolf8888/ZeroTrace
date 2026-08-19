import { z } from 'zod';
export * from './part-10.js';
import type {
  Evidence,
} from './part-10.js';
import {
  AnalysisSnapshotSchema,
  CanonicalStringArraySchema,
  ConfidenceSchema,
  ControlCampaignBundleSchema,
  CoverageRatioSchema,
  DecimalStringSchema,
  EvidenceSchema,
  ForensicCampaignAlertSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  QuantityStringSchema,
  SolanaLaunchpadObservationSchema,
  SolanaPublicKeySchema,
  SolanaTransactionIntelligenceReportSchema,
  TokenFlowEdgeSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-10.js';

export type SolanaTransactionIntelligenceReport = z.infer<
  typeof SolanaTransactionIntelligenceReportSchema
>;

export const SolanaDealerCampaignReportIdSchema = z.string().regex(/^sdc_[0-9a-f]{24}$/);
export const SolanaDealerAssetObservationIdSchema = z.string().regex(/^sdao_[0-9a-f]{24}$/);
export const SolanaDealerFundingEdgeIdSchema = z.string().regex(/^sdf_[0-9a-f]{24}$/);
export const SolanaDealerSettlementEdgeIdSchema = z.string().regex(/^sds_[0-9a-f]{24}$/);

export const SolanaDealerSignatureSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
export const SolanaDealerAssetKindSchema = z.enum(['NATIVE_SOL', 'SPL_TOKEN', 'TOKEN_2022']);

export const SolanaDealerAssetObservationSchema = z
  .object({
    schemaVersion: z.literal('solana-dealer-asset-observation-v1'),
    id: SolanaDealerAssetObservationIdSchema,
    assetKind: SolanaDealerAssetKindSchema,
    asset: z.union([z.literal('SOL'), SolanaPublicKeySchema]),
    source: SolanaPublicKeySchema,
    destination: SolanaPublicKeySchema,
    amountRaw: UnsignedQuantityStringSchema,
    decimals: z.number().int().min(0).max(255),
    signature: SolanaDealerSignatureSchema,
    slot: UnsignedQuantityStringSchema,
    blockhash: SolanaPublicKeySchema,
    transactionIndex: UnsignedQuantityStringSchema,
    instructionPath: z.string().regex(/^outer:\d+(?:\/inner:\d+)?$/),
    execution: z.enum(['SUCCESS', 'FAILED', 'UNKNOWN']),
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.slot ||
      value.snapshot.blockhash !== value.blockhash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana dealer asset observations require an exact finalized slot Snapshot.',
      });
    }
    if (value.assetKind === 'NATIVE_SOL' && value.asset !== 'SOL') {
      context.addIssue({
        code: 'custom',
        path: ['asset'],
        message: 'Native SOL observations must use the SOL asset marker.',
      });
    }
    if (value.assetKind !== 'NATIVE_SOL' && value.asset === 'SOL') {
      context.addIssue({
        code: 'custom',
        path: ['asset'],
        message: 'Token observations must carry their mint address.',
      });
    }
  });
export type SolanaDealerAssetObservation = z.infer<typeof SolanaDealerAssetObservationSchema>;

export const SolanaDealerFundingEdgeSchema = z
  .object({
    schemaVersion: z.literal('solana-dealer-funding-edge-v1'),
    id: SolanaDealerFundingEdgeIdSchema,
    source: SolanaPublicKeySchema,
    destination: SolanaPublicKeySchema,
    amountLamports: UnsignedQuantityStringSchema,
    signature: SolanaDealerSignatureSchema,
    slot: UnsignedQuantityStringSchema,
    blockhash: SolanaPublicKeySchema,
    relation: z.enum(['DIRECT_SOL_FUNDING', 'SAME_TRANSACTION_FUNDING', 'UNKNOWN']),
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    confidence: knowledgeValueSchema(ConfidenceSchema),
    detail: z.string().min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.slot ||
      value.snapshot.blockhash !== value.blockhash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana funding edges require an exact finalized slot Snapshot.',
      });
    }
    if (value.source === value.destination) {
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'Solana funding edges require distinct source and destination accounts.',
      });
    }
  });
export type SolanaDealerFundingEdge = z.infer<typeof SolanaDealerFundingEdgeSchema>;

export const SolanaDealerSettlementEdgeSchema = z
  .object({
    schemaVersion: z.literal('solana-dealer-settlement-edge-v1'),
    id: SolanaDealerSettlementEdgeIdSchema,
    source: SolanaPublicKeySchema,
    destination: SolanaPublicKeySchema,
    tokenAmountRaw: UnsignedQuantityStringSchema,
    solAmountLamports: UnsignedQuantityStringSchema,
    signature: SolanaDealerSignatureSchema,
    slot: UnsignedQuantityStringSchema,
    blockhash: SolanaPublicKeySchema,
    status: z.enum(['POSSIBLE', 'NOT_OBSERVED', 'UNKNOWN']),
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    confidence: knowledgeValueSchema(ConfidenceSchema),
    detail: z.string().min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.slot ||
      value.snapshot.blockhash !== value.blockhash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana settlement edges require an exact finalized slot Snapshot.',
      });
    }
    if (value.source === value.destination) {
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'Solana settlement edges require distinct source and destination accounts.',
      });
    }
  });
export type SolanaDealerSettlementEdge = z.infer<typeof SolanaDealerSettlementEdgeSchema>;

export const SolanaDealerOriginSchema = z
  .object({
    mint: SolanaPublicKeySchema,
    tokenProgram: z.enum(['SPL_TOKEN', 'TOKEN_2022']),
    firstObservedSlot: UnsignedQuantityStringSchema,
    firstObservedSignature: SolanaDealerSignatureSchema,
    mintInstructionObserved: z.boolean(),
    evidenceIds: CanonicalStringArraySchema.min(1),
  })
  .strict();
export type SolanaDealerOrigin = z.infer<typeof SolanaDealerOriginSchema>;

export const SolanaDealerHolderSchema = z
  .object({
    owner: SolanaPublicKeySchema,
    tokenAccounts: z.array(SolanaPublicKeySchema).min(1),
    observedBalanceRaw: UnsignedQuantityStringSchema,
    netDeltaRaw: QuantityStringSchema,
    firstObservedSlot: UnsignedQuantityStringSchema,
    lastObservedSlot: UnsignedQuantityStringSchema,
    openingBalance: knowledgeValueSchema(UnsignedQuantityStringSchema),
    evidenceIds: CanonicalStringArraySchema.min(1),
  })
  .strict();
export type SolanaDealerHolder = z.infer<typeof SolanaDealerHolderSchema>;

export const SolanaDealerCampaignReportSchema = z
  .object({
    schemaVersion: z.literal('solana-dealer-campaign-report-v1'),
    id: SolanaDealerCampaignReportIdSchema,
    ledger: z.literal('SOLANA'),
    chainId: z.literal('solana-mainnet'),
    mint: SolanaPublicKeySchema,
    fromSlot: UnsignedQuantityStringSchema,
    toSlot: UnsignedQuantityStringSchema,
    status: z.enum(['COMPLETE', 'PARTIAL', 'UNKNOWN']),
    origin: knowledgeValueSchema(SolanaDealerOriginSchema),
    holders: z.array(SolanaDealerHolderSchema),
    tokenFlowEdges: z.array(TokenFlowEdgeSchema),
    solTransfers: z.array(SolanaDealerAssetObservationSchema),
    fundingEdges: z.array(SolanaDealerFundingEdgeSchema),
    settlementEdges: z.array(SolanaDealerSettlementEdgeSchema),
    openingBalanceUnknownWalletIds: CanonicalStringArraySchema,
    pdaSuppressedOwnerIds: CanonicalStringArraySchema,
    launchpadObservations: z.array(SolanaLaunchpadObservationSchema).max(500).optional(),
    campaign: ControlCampaignBundleSchema.nullable(),
    alerts: z.array(ForensicCampaignAlertSchema),
    evidence: z.array(EvidenceSchema).min(1),
    snapshot: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('solana-dealer-campaign-v1.0.0'),
    policyVersion: z.literal('solana-dealer-policy-v1.0.0'),
    evidenceIds: CanonicalStringArraySchema.min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.toSlot ||
      BigInt(value.toSlot) < BigInt(value.fromSlot)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana dealer reports require one finalized Snapshot at the range end.',
      });
    }
    const nestedEvidenceIds = [
      ...(value.origin.state === 'known' ? value.origin.value.evidenceIds : []),
      ...value.holders.flatMap((holder) => holder.evidenceIds),
      ...value.tokenFlowEdges.flatMap((edge) => [edge.evidenceId]),
      ...value.solTransfers.flatMap((edge) => edge.evidenceIds),
      ...value.fundingEdges.flatMap((edge) => edge.evidenceIds),
      ...value.settlementEdges.flatMap((edge) => edge.evidenceIds),
      ...(value.launchpadObservations ?? []).flatMap((observation) => observation.evidenceIds),
      ...(value.campaign === null
        ? []
        : [
            ...value.campaign.campaign.metadata.evidenceIds,
            ...value.campaign.clusterVersion.membershipEvidenceIds,
            ...value.campaign.positions.flatMap((position) => position.positionEvidenceIds),
            ...value.campaign.behaviorEvents.flatMap((event) => [
              ...event.supportingEvidenceIds,
              ...event.contradictingEvidenceIds,
            ]),
            ...value.campaign.evidenceLine.evidenceIds,
          ]),
      ...value.alerts.flatMap((alert) => alert.evidenceIds),
    ];
    const evidenceIds = [...new Set(value.evidence.map((item) => item.id))].sort();
    const declared = [...value.evidenceIds].sort();
    const expected = [...new Set(nestedEvidenceIds)].sort();
    const launchpadIds = (value.launchpadObservations ?? []).map((observation) => observation.id);
    if (
      evidenceIds.length !== value.evidence.length ||
      JSON.stringify(evidenceIds) !== JSON.stringify(declared) ||
      expected.some((id) => !declared.includes(id)) ||
      launchpadIds.length !== new Set(launchpadIds).size ||
      launchpadIds.some((id, index) => id !== [...launchpadIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Solana dealer report Evidence must contain every nested observation reference.',
      });
    }
    if (
      value.tokenFlowEdges.some(
        (edge) =>
          edge.ledger !== 'SOLANA' ||
          edge.chainId !== 'solana-mainnet' ||
          edge.token !== value.mint ||
          BigInt(edge.blockNumber) < BigInt(value.fromSlot) ||
          BigInt(edge.blockNumber) > BigInt(value.toSlot),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tokenFlowEdges'],
        message: 'Solana dealer token-flow edges must match the report mint and range.',
      });
    }
    if (
      (value.launchpadObservations ?? []).some(
        (observation) =>
          BigInt(observation.slot) < BigInt(value.fromSlot) ||
          BigInt(observation.slot) > BigInt(value.toSlot),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['launchpadObservations'],
        message: 'Solana launchpad observations must remain inside the dealer report slot range.',
      });
    }
    if (
      value.campaign !== null &&
      (value.campaign.campaign.token !== value.mint ||
        value.campaign.campaign.chainId !== 'solana-mainnet')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['campaign'],
        message: 'Solana dealer campaign identity must match the report mint and chain.',
      });
    }
    if (value.status === 'COMPLETE' && value.campaign === null) {
      context.addIssue({
        code: 'custom',
        path: ['campaign'],
        message: 'A complete Solana dealer report requires a materialized Campaign bundle.',
      });
    }
  });
export type SolanaDealerCampaignReport = z.infer<typeof SolanaDealerCampaignReportSchema>;

export const SolanaDealerCampaignRequestSchema = z
  .object({
    mint: SolanaPublicKeySchema,
    fromSlot: UnsignedQuantityStringSchema,
    toSlot: UnsignedQuantityStringSchema,
    maxTransactions: z.number().int().min(1).max(500).default(500),
  })
  .strict()
  .superRefine((value, context) => {
    const from = BigInt(value.fromSlot);
    const to = BigInt(value.toSlot);
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    if (to < from) {
      context.addIssue({
        code: 'custom',
        path: ['toSlot'],
        message: 'toSlot must be greater than or equal to fromSlot.',
      });
    }
    if (to >= from && to - from + 1n > 50_000n) {
      context.addIssue({
        code: 'custom',
        path: ['toSlot'],
        message: 'Solana dealer ranges may contain at most 50,000 slots.',
      });
    }
    if (from > maxSafe || to > maxSafe) {
      context.addIssue({
        code: 'custom',
        path: ['toSlot'],
        message: 'Solana slots must fit the JSON-RPC safe integer range.',
      });
    }
  });
export type SolanaDealerCampaignRequest = z.infer<typeof SolanaDealerCampaignRequestSchema>;

export const SolanaControlRightTypeSchema = z.enum([
  'MINT_AUTHORITY',
  'FREEZE_AUTHORITY',
  'ACCOUNT_OWNER',
  'ACCOUNT_CLOSE_AUTHORITY',
  'MINT_CLOSE_AUTHORITY',
  'ACCOUNT_DELEGATE',
  'PERMANENT_DELEGATE',
  'TRANSFER_FEE_CONFIG_AUTHORITY',
  'WITHHELD_FEE_AUTHORITY',
  'CONFIDENTIAL_TRANSFER_AUTHORITY',
  'INTEREST_RATE_AUTHORITY',
  'TRANSFER_HOOK_AUTHORITY',
  'TRANSFER_HOOK_PROGRAM',
  'METADATA_POINTER_AUTHORITY',
  'METADATA_UPDATE_AUTHORITY',
  'GROUP_POINTER_AUTHORITY',
  'GROUP_UPDATE_AUTHORITY',
  'GROUP_MEMBER_POINTER_AUTHORITY',
  'SCALED_UI_AMOUNT_AUTHORITY',
  'PAUSE_AUTHORITY',
  'PERMISSIONED_BURN_AUTHORITY',
  'PROGRAM_UPGRADE_AUTHORITY',
  'MULTISIG_SIGNER',
]);
export type SolanaControlRightType = z.infer<typeof SolanaControlRightTypeSchema>;

export const SolanaAccountKindSchema = z.enum([
  'SYSTEM_ACCOUNT',
  'SPL_TOKEN_MINT',
  'SPL_TOKEN_ACCOUNT',
  'SPL_TOKEN_MULTISIG',
  'TOKEN_2022_MINT',
  'TOKEN_2022_ACCOUNT',
  'TOKEN_2022_MULTISIG',
  'UPGRADEABLE_PROGRAM',
  'UPGRADEABLE_PROGRAM_DATA',
  'IMMUTABLE_PROGRAM',
  'OTHER_ACCOUNT',
]);
export type SolanaAccountKind = z.infer<typeof SolanaAccountKindSchema>;

export const SolanaTokenProgramSchema = z.enum(['SPL_TOKEN', 'TOKEN_2022']);
export type SolanaTokenProgram = z.infer<typeof SolanaTokenProgramSchema>;

export const SolanaMintControlSchema = z.object({
  tokenProgram: SolanaTokenProgramSchema,
  supply: UnsignedQuantityStringSchema,
  decimals: z.number().int().min(0).max(255),
  initialized: z.boolean(),
  mintAuthority: knowledgeValueSchema(SolanaPublicKeySchema),
  freezeAuthority: knowledgeValueSchema(SolanaPublicKeySchema),
});
export type SolanaMintControl = z.infer<typeof SolanaMintControlSchema>;

export const SolanaTokenAccountControlSchema = z.object({
  tokenProgram: SolanaTokenProgramSchema,
  mint: SolanaPublicKeySchema,
  owner: SolanaPublicKeySchema,
  amount: UnsignedQuantityStringSchema,
  state: z.string().min(1),
  delegate: knowledgeValueSchema(SolanaPublicKeySchema),
  delegatedAmount: UnsignedQuantityStringSchema,
  closeAuthority: knowledgeValueSchema(SolanaPublicKeySchema),
});
export type SolanaTokenAccountControl = z.infer<typeof SolanaTokenAccountControlSchema>;

export const SolanaMultisigControlSchema = z.object({
  tokenProgram: SolanaTokenProgramSchema,
  initialized: z.boolean(),
  minimumSigners: z.number().int().min(1).max(11),
  signerCount: z.number().int().min(1).max(11),
  signers: z.array(SolanaPublicKeySchema).min(1).max(11),
});
export type SolanaMultisigControl = z.infer<typeof SolanaMultisigControlSchema>;

export const SolanaTokenExtensionAuthoritySchema = z.object({
  role: z.string().min(1).max(128),
  address: SolanaPublicKeySchema,
});
export const SolanaTokenExtensionRelatedAddressSchema = z.object({
  role: z.string().min(1).max(128),
  address: SolanaPublicKeySchema,
});
export const SolanaTokenExtensionControlSchema = z.object({
  extensionType: z.string().min(1).max(128),
  authorities: z.array(SolanaTokenExtensionAuthoritySchema),
  relatedAddresses: z.array(SolanaTokenExtensionRelatedAddressSchema),
  settings: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
});
export type SolanaTokenExtensionControl = z.infer<typeof SolanaTokenExtensionControlSchema>;

export const SolanaProgramControlSchema = z.object({
  loader: SolanaPublicKeySchema,
  programDataAddress: knowledgeValueSchema(SolanaPublicKeySchema),
  upgradeAuthority: knowledgeValueSchema(SolanaPublicKeySchema),
  immutable: knowledgeValueSchema(z.boolean()),
  deploymentSlot: knowledgeValueSchema(UnsignedQuantityStringSchema),
  programDataBytes: knowledgeValueSchema(z.number().int().nonnegative()),
});
export type SolanaProgramControl = z.infer<typeof SolanaProgramControlSchema>;

export const SolanaControlRightSchema = z.object({
  id: z.string().regex(/^cr_[0-9a-f]{24}$/),
  chainId: z.literal('solana-mainnet'),
  subject: SolanaPublicKeySchema,
  controller: SolanaPublicKeySchema,
  rightType: SolanaControlRightTypeSchema,
  scope: z.string().min(1),
  threshold: knowledgeValueSchema(DecimalStringSchema),
  constraints: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  activeFrom: knowledgeValueSchema(IsoDateTimeSchema),
  activeTo: knowledgeValueSchema(IsoDateTimeSchema),
});
export type SolanaControlRight = z.infer<typeof SolanaControlRightSchema>;

export const SolanaControlCoverageDomainSchema = z.enum([
  'ACCOUNT_STATE',
  'ACCOUNT_CLASSIFICATION',
  'TOKEN_BASE_STATE',
  'MINT_AUTHORITY',
  'FREEZE_AUTHORITY',
  'ACCOUNT_OWNER',
  'ACCOUNT_CLOSE_AUTHORITY',
  'ACCOUNT_DELEGATE',
  'MULTISIG_CONFIGURATION',
  'MINT_CLOSE_AUTHORITY',
  'PERMANENT_DELEGATE',
  'TRANSFER_FEE_CONFIG',
  'WITHHELD_FEE_AUTHORITY',
  'CONFIDENTIAL_TRANSFER',
  'DEFAULT_ACCOUNT_STATE',
  'NON_TRANSFERABLE',
  'INTEREST_BEARING',
  'TRANSFER_HOOK',
  'METADATA_POINTER',
  'TOKEN_METADATA',
  'GROUP_POINTER',
  'TOKEN_GROUP',
  'GROUP_MEMBER_POINTER',
  'TOKEN_GROUP_MEMBER',
  'SCALED_UI_AMOUNT',
  'PAUSABLE',
  'PERMISSIONED_BURN',
  'CPI_GUARD',
  'MEMO_TRANSFER',
  'IMMUTABLE_OWNER',
  'PROGRAM_EXECUTABLE',
  'PROGRAM_DATA',
  'PROGRAM_UPGRADE_AUTHORITY',
  'ANCHOR_IDL',
  'VERIFIABLE_BUILD',
  'SQUADS_CONFIGURATION',
  'AUTHORITY_HISTORY',
  'CONTROLLER_RECURSION',
]);
