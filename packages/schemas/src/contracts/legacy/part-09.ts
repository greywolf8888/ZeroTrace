import { z } from 'zod';
export * from './part-08.js';
import {
  BitcoinHashSchema,
  BitcoinScriptClassSchema,
  BitcoinSnapshotSchema,
  BitcoinSpendConditionVisibilitySchema,
  CanonicalStringArraySchema,
  ConfidenceSchema,
  CoverageRatioSchema,
  DecimalStringSchema,
  EvmCanonicalAddressSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  QuantityStringSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-08.js';

export type BitcoinSpendConditionVisibility = z.infer<typeof BitcoinSpendConditionVisibilitySchema>;

export const BitcoinSignatureRequirementSchema = z.enum([
  'SINGLE_KEY',
  'MULTISIG',
  'KEY_OR_SCRIPT',
  'ARBITRARY_SCRIPT',
  'PROVABLY_UNSPENDABLE',
]);
export type BitcoinSignatureRequirement = z.infer<typeof BitcoinSignatureRequirementSchema>;

export const BitcoinTaprootSpendPathSchema = z.enum(['KEY_PATH', 'SCRIPT_PATH', 'UNDETERMINED']);
export type BitcoinTaprootSpendPath = z.infer<typeof BitcoinTaprootSpendPathSchema>;

export const BitcoinTimelockSchema = z.object({
  kind: z.enum(['ABSOLUTE_HEIGHT', 'ABSOLUTE_TIME', 'RELATIVE_BLOCKS', 'RELATIVE_TIME']),
  value: UnsignedQuantityStringSchema,
  encodedValue: UnsignedQuantityStringSchema,
  detail: z.string().min(1),
});
export type BitcoinTimelock = z.infer<typeof BitcoinTimelockSchema>;

export const BitcoinMultisigObservationSchema = z.object({
  threshold: z.number().int().min(1).max(20),
  signerCount: z.number().int().min(1).max(20),
  publicKeyFingerprints: z.array(Hash256Schema).min(1).max(20),
});
export type BitcoinMultisigObservation = z.infer<typeof BitcoinMultisigObservationSchema>;

export const BitcoinScriptControlAnalysisSchema = z.object({
  scriptClass: BitcoinScriptClassSchema,
  scriptPubKey: z.string().regex(/^(?:[0-9a-f]{2})*$/),
  addressMatch: knowledgeValueSchema(z.boolean()),
  spendConditionVisibility: BitcoinSpendConditionVisibilitySchema,
  signatureRequirement: knowledgeValueSchema(BitcoinSignatureRequirementSchema),
  multisig: knowledgeValueSchema(BitcoinMultisigObservationSchema),
  absoluteTimelocks: z.array(BitcoinTimelockSchema),
  relativeTimelocks: z.array(BitcoinTimelockSchema),
  hashPredicatePresent: knowledgeValueSchema(z.boolean()),
  taprootSpendPath: knowledgeValueSchema(BitcoinTaprootSpendPathSchema),
  revealedScript: knowledgeValueSchema(z.string().regex(/^(?:[0-9a-f]{2})*$/)),
  controllerIdentity: knowledgeValueSchema(z.string().min(1)),
  scriptConditionsComplete: knowledgeValueSchema(z.boolean()),
  modelVersion: z.literal('bitcoin-script-control-v1.0.0'),
});
export type BitcoinScriptControlAnalysis = z.infer<typeof BitcoinScriptControlAnalysisSchema>;

export const BitcoinAddressUtxoSchema = z.object({
  outpoint: z.string().regex(/^[0-9a-f]{64}:(?:0|[1-9]\d*)$/),
  txid: BitcoinHashSchema,
  vout: UnsignedQuantityStringSchema,
  valueSats: UnsignedQuantityStringSchema,
  confirmed: z.boolean(),
  blockHeight: knowledgeValueSchema(UnsignedQuantityStringSchema),
  blockHash: knowledgeValueSchema(BitcoinHashSchema),
});
export type BitcoinAddressUtxo = z.infer<typeof BitcoinAddressUtxoSchema>;

export const BitcoinAddressUtxoSetSchema = z.object({
  address: z.string().min(1),
  utxos: z.array(BitcoinAddressUtxoSchema).max(100_000),
  confirmedUtxoCount: z.number().int().nonnegative(),
  mempoolUtxoCount: z.number().int().nonnegative(),
  totalValueSats: UnsignedQuantityStringSchema,
  statsNetValueSats: QuantityStringSchema,
  balanceAgreement: knowledgeValueSchema(z.boolean()),
  modelVersion: z.literal('bitcoin-address-utxo-v1.0.0'),
});
export type BitcoinAddressUtxoSet = z.infer<typeof BitcoinAddressUtxoSetSchema>;

export const BitcoinTransactionPatternSchema = z.enum([
  'NOT_APPLICABLE',
  'EQUAL_OUTPUT_COINJOIN_LIKE',
  'FANOUT_OR_BATCHING_RISK',
  'NO_STRONG_PATTERN_OBSERVED',
  'INCOMPLETE_INPUT_CONTEXT',
]);
export type BitcoinTransactionPattern = z.infer<typeof BitcoinTransactionPatternSchema>;

export const BitcoinClusteringSuppressionReasonSchema = z.enum([
  'COINJOIN_EQUAL_OUTPUT_PATTERN',
  'PAYJOIN_NOT_EXCLUDABLE',
  'FANOUT_OR_BATCHING_PATTERN',
  'SERVICE_ATTRIBUTION_UNQUERIED',
  'INCOMPLETE_PREVOUT_ADDRESS_COVERAGE',
]);
export type BitcoinClusteringSuppressionReason = z.infer<
  typeof BitcoinClusteringSuppressionReasonSchema
>;

export const BitcoinEqualOutputGroupSchema = z.object({
  valueSats: UnsignedQuantityStringSchema,
  outputCount: z.number().int().min(2),
  vouts: z.array(z.number().int().nonnegative()).min(2),
});
export type BitcoinEqualOutputGroup = z.infer<typeof BitcoinEqualOutputGroupSchema>;

export const BitcoinChangeCandidateSchema = z.object({
  vout: z.number().int().nonnegative(),
  valueSats: UnsignedQuantityStringSchema,
  scriptType: z.string().min(1),
  address: knowledgeValueSchema(z.string().min(1)),
  signals: z
    .array(z.enum(['INPUT_SCRIPT_TYPE_MATCH', 'UNIQUE_OUTPUT_VALUE', 'INPUT_ADDRESS_NOT_REUSED']))
    .min(1),
});
export type BitcoinChangeCandidate = z.infer<typeof BitcoinChangeCandidateSchema>;

export const BitcoinTransactionEntityAnalysisSchema = z.object({
  txid: BitcoinHashSchema,
  coinbase: z.boolean(),
  inputCount: z.number().int().nonnegative(),
  outputCount: z.number().int().nonnegative(),
  inputAddressCoverage: CoverageRatioSchema,
  inputAddresses: z.array(z.string().min(1)),
  outputAddresses: z.array(z.string().min(1)),
  inputValueSats: knowledgeValueSchema(UnsignedQuantityStringSchema),
  outputValueSats: UnsignedQuantityStringSchema,
  feeSats: UnsignedQuantityStringSchema,
  feeReconciles: knowledgeValueSchema(z.boolean()),
  virtualSizeBytes: UnsignedQuantityStringSchema,
  feeRateSatPerVbyte: knowledgeValueSchema(DecimalStringSchema),
  equalOutputGroups: z.array(BitcoinEqualOutputGroupSchema),
  structuralPattern: BitcoinTransactionPatternSchema,
  payjoinContaminationRisk: knowledgeValueSchema(z.boolean()),
  serviceClusterRisk: knowledgeValueSchema(z.boolean()),
  addressReuseOutputVouts: z.array(z.number().int().nonnegative()),
  commonInputHeuristic: knowledgeValueSchema(z.boolean()),
  commonInputOwnershipCandidate: knowledgeValueSchema(z.array(z.string().min(1)).min(2)),
  automaticOwnershipMergeAllowed: z.literal(false),
  suppressionReasons: z.array(BitcoinClusteringSuppressionReasonSchema),
  changeCandidates: z.array(BitcoinChangeCandidateSchema),
  selectedChangeOutput: knowledgeValueSchema(z.number().int().nonnegative()),
  ownershipConclusion: knowledgeValueSchema(z.string().min(1)),
  externalAttribution: knowledgeValueSchema(z.string().min(1)),
  modelVersion: z.literal('bitcoin-transaction-entity-v1.0.0'),
});
export type BitcoinTransactionEntityAnalysis = z.infer<
  typeof BitcoinTransactionEntityAnalysisSchema
>;

export const BitcoinForensicGraphNodeKindSchema = z.enum([
  'ADDRESS',
  'OUTPOINT',
  'TRANSACTION',
  'SERVICE',
  'UNKNOWN',
]);
export type BitcoinForensicGraphNodeKind = z.infer<typeof BitcoinForensicGraphNodeKindSchema>;

export const BitcoinForensicGraphNodeSchema = z
  .object({
    id: z.string().min(1).max(256),
    kind: BitcoinForensicGraphNodeKindSchema,
    reference: z.string().min(1).max(256),
    label: knowledgeValueSchema(z.string().min(1).max(160)),
    valueSats: knowledgeValueSchema(UnsignedQuantityStringSchema),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
  })
  .strict();
export type BitcoinForensicGraphNode = z.infer<typeof BitcoinForensicGraphNodeSchema>;

export const BitcoinForensicGraphEdgeKindSchema = z.enum([
  'UTXO_FUNDING',
  'UTXO_SPEND',
  'COMMON_INPUT_CANDIDATE',
  'CHANGE_CANDIDATE',
  'PEELING_PATTERN',
  'FANOUT_PATTERN',
  'CONSOLIDATION_PATTERN',
  'FUNDING_PATH',
  'SETTLEMENT_PATH',
  'SERVICE_SUPPRESSED',
  'COINJOIN_SUPPRESSED',
  'PAYJOIN_UNKNOWN',
]);
export type BitcoinForensicGraphEdgeKind = z.infer<typeof BitcoinForensicGraphEdgeKindSchema>;

export const BitcoinForensicGraphEdgeClassificationSchema = z.enum([
  'OBSERVED',
  'HEURISTIC_CANDIDATE',
  'SUPPRESSED',
  'UNKNOWN',
]);
export type BitcoinForensicGraphEdgeClassification = z.infer<
  typeof BitcoinForensicGraphEdgeClassificationSchema
>;

export const BitcoinForensicGraphEdgeSchema = z
  .object({
    id: z.string().regex(/^bge_[0-9a-f]{24}$/),
    from: z.string().min(1).max(256),
    to: z.string().min(1).max(256),
    kind: BitcoinForensicGraphEdgeKindSchema,
    classification: BitcoinForensicGraphEdgeClassificationSchema,
    amountSats: knowledgeValueSchema(UnsignedQuantityStringSchema),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    reason: z.string().min(1).max(320),
    automaticOwnershipMergeAllowed: z.literal(false),
  })
  .strict();
export type BitcoinForensicGraphEdge = z.infer<typeof BitcoinForensicGraphEdgeSchema>;

export const BitcoinForensicEvidenceLinePhaseSchema = z
  .object({
    phase: z.enum(['FUNDING', 'FLOW', 'SETTLEMENT', 'NEGATIVE']),
    edgeIds: z.array(z.string().regex(/^bge_[0-9a-f]{24}$/)),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
    coverage: CoverageRatioSchema,
    attributionStopped: z.boolean(),
  })
  .strict();
export type BitcoinForensicEvidenceLinePhase = z.infer<
  typeof BitcoinForensicEvidenceLinePhaseSchema
>;

export const BitcoinForensicEvidenceLineSchema = z
  .object({
    schemaVersion: z.literal('bitcoin-forensic-evidence-line-v1'),
    graphId: z.string().regex(/^bfg_[0-9a-f]{24}$/),
    phases: z.array(BitcoinForensicEvidenceLinePhaseSchema),
    terminalBoundary: z.enum(['NONE_OBSERVED', 'SERVICE_BOUNDARY', 'UNKNOWN']),
    edgeIds: z.array(z.string().regex(/^bge_[0-9a-f]{24}$/)),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
    snapshotStart: BitcoinSnapshotSchema,
    snapshotEnd: BitcoinSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('bitcoin-forensic-graph-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    resultHash: Hash256Schema,
  })
  .strict();
export type BitcoinForensicEvidenceLine = z.infer<typeof BitcoinForensicEvidenceLineSchema>;

export const BitcoinForensicCaseBundleSchema = z
  .object({
    schemaVersion: z.literal('bitcoin-forensic-case-v1'),
    id: z.string().regex(/^bfc_[0-9a-f]{24}$/),
    graphId: z.string().regex(/^bfg_[0-9a-f]{24}$/),
    ledger: z.literal('BITCOIN'),
    chainId: z.literal('bitcoin-mainnet'),
    evidenceLine: BitcoinForensicEvidenceLineSchema,
    automaticOwnershipMergeAllowed: z.literal(false),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    snapshot: BitcoinSnapshotSchema,
    modelVersion: z.literal('bitcoin-forensic-graph-v1.0.0'),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.evidenceLine.graphId !== value.graphId ||
      value.evidenceLine.snapshotEnd.blockHash !== value.snapshot.blockHash ||
      JSON.stringify(value.evidenceIds) !==
        JSON.stringify([...value.evidenceLine.evidenceIds].sort())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceLine'],
        message: 'Bitcoin forensic case references must be canonical and identity-consistent.',
      });
    }
  });
export type BitcoinForensicCaseBundle = z.infer<typeof BitcoinForensicCaseBundleSchema>;

export const BitcoinForensicGraphReportSchema = z
  .object({
    schemaVersion: z.literal('bitcoin-forensic-graph-v1'),
    id: z.string().regex(/^bfg_[0-9a-f]{24}$/),
    ledger: z.literal('BITCOIN'),
    chainId: z.literal('bitcoin-mainnet'),
    rootTxids: z.array(BitcoinHashSchema).min(1).max(100),
    transactionIds: z.array(BitcoinHashSchema).min(1).max(100),
    nodes: z.array(BitcoinForensicGraphNodeSchema).max(2_000),
    edges: z.array(BitcoinForensicGraphEdgeSchema).max(10_000),
    transactionAnalyses: z.array(BitcoinTransactionEntityAnalysisSchema).max(100),
    suppressionReasons: z.array(BitcoinClusteringSuppressionReasonSchema),
    case: BitcoinForensicCaseBundleSchema,
    snapshotStart: BitcoinSnapshotSchema,
    snapshotEnd: BitcoinSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('bitcoin-forensic-graph-v1.0.0'),
    policyVersion: z.literal('bitcoin-forensic-policy-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    automaticOwnershipMergeAllowed: z.literal(false),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const nodeIds = new Set(value.nodes.map((node) => node.id));
    const edgeIds = new Set<string>();
    for (const edge of value.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        context.addIssue({
          code: 'custom',
          path: ['edges'],
          message: 'Bitcoin forensic graph edges must reference graph nodes.',
        });
      }
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: 'custom',
          path: ['edges'],
          message: 'Bitcoin forensic graph edge IDs must be unique.',
        });
      }
      edgeIds.add(edge.id);
    }
    if (
      value.snapshotStart.blockHash === value.snapshotEnd.blockHash &&
      value.snapshotStart.height !== value.snapshotEnd.height
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshotEnd'],
        message: 'Bitcoin Snapshot heights cannot differ while sharing a block hash.',
      });
    }
    if (
      value.case.graphId !== value.id ||
      value.case.snapshot.blockHash !== value.snapshotEnd.blockHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['case'],
        message: 'Bitcoin forensic case must reference the enclosing graph and final Snapshot.',
      });
    }
  });
export type BitcoinForensicGraphReport = z.infer<typeof BitcoinForensicGraphReportSchema>;

export const EvmControlRightTypeSchema = z.enum([
  'OWNER',
  'PROXY_ADMIN',
  'UPGRADE',
  'MINT',
  'BURN',
  'TAX_CHANGE',
  'BLACKLIST',
  'WHITELIST',
  'TRADING_SWITCH',
  'MAX_TX',
  'MAX_WALLET',
  'FEE_EXEMPTION',
  'ROUTER_CHANGE',
  'TREASURY',
  'SAFE_OWNER',
  'SAFE_MODULE',
  'SAFE_GUARD',
  'SAFE_FALLBACK_HANDLER',
  'LP_POSITION',
  'MIGRATION',
]);
export type EvmControlRightType = z.infer<typeof EvmControlRightTypeSchema>;

export const ControlRightSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  controller: z.string().min(1),
  rightType: z.string().min(1),
  scope: z.string().min(1),
  threshold: knowledgeValueSchema(DecimalStringSchema),
  constraints: z.array(z.string()),
  evidenceIds: z.array(z.string()).min(1),
  activeFrom: IsoDateTimeSchema.optional(),
  activeTo: IsoDateTimeSchema.optional(),
});
export type ControlRight = z.infer<typeof ControlRightSchema>;

export const EvmControlRightSchema = z.object({
  id: z.string().regex(/^cr_[0-9a-f]{24}$/),
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  subject: EvmCanonicalAddressSchema,
  controller: EvmCanonicalAddressSchema,
  rightType: EvmControlRightTypeSchema,
  scope: z.string().min(1),
  threshold: knowledgeValueSchema(DecimalStringSchema),
  constraints: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  activeFrom: knowledgeValueSchema(IsoDateTimeSchema),
  activeTo: knowledgeValueSchema(IsoDateTimeSchema),
});
export type EvmControlRight = z.infer<typeof EvmControlRightSchema>;

export const EvmControlCoverageDomainSchema = z.enum([
  'CONTRACT_CODE',
  'LOGIC_CODE',
  'ERC1167_IMPLEMENTATION',
  'EIP1967_IMPLEMENTATION',
  'EIP1967_ADMIN',
  'EIP1967_BEACON',
  'ERC173_OWNER',
  'SAFE_OWNERS_THRESHOLD',
  'SAFE_MODULES',
  'SAFE_GUARD',
  'SAFE_FALLBACK_HANDLER',
  'UPGRADE_AUTHORIZATION',
  'MINT',
  'BURN',
  'TAX_CHANGE',
  'BLACKLIST',
  'WHITELIST',
  'TRADING_SWITCH',
  'MAX_TX',
  'MAX_WALLET',
  'FEE_EXEMPTION',
  'ROUTER_CHANGE',
  'TREASURY',
  'LP_POSITION',
  'MIGRATION',
]);
export type EvmControlCoverageDomain = z.infer<typeof EvmControlCoverageDomainSchema>;

export const EvmControlCoverageSchema = z.object({
  domain: EvmControlCoverageDomainSchema,
  observed: knowledgeValueSchema(z.boolean()),
  detail: z.string().min(1),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
});
export type EvmControlCoverage = z.infer<typeof EvmControlCoverageSchema>;

export const EvmContractKindSchema = z.enum([
  'EOA',
  'DIRECT_CONTRACT',
  'ERC1167_MINIMAL_PROXY',
  'EIP1967_PROXY',
  'EIP1967_BEACON_PROXY',
  'SAFE_PROXY',
]);
export type EvmContractKind = z.infer<typeof EvmContractKindSchema>;

export const EvmSafeControlSchema = z.object({
  owners: z.array(EvmCanonicalAddressSchema).min(1).max(100),
  threshold: UnsignedQuantityStringSchema.refine((value) => BigInt(value) > 0n),
  nonce: UnsignedQuantityStringSchema,
  implementationAddress: EvmCanonicalAddressSchema,
  implementationVersion: z.string().min(1).max(64),
});
export type EvmSafeControl = z.infer<typeof EvmSafeControlSchema>;

export const EvmLogicCodeRelationSchema = z.enum([
  'SUBJECT',
  'ERC1167_IMPLEMENTATION',
  'EIP1967_IMPLEMENTATION',
  'BEACON_IMPLEMENTATION',
  'SAFE_SINGLETON',
]);
export type EvmLogicCodeRelation = z.infer<typeof EvmLogicCodeRelationSchema>;

export const EvmLogicCodeSchema = z.object({
  address: EvmCanonicalAddressSchema,
  relation: EvmLogicCodeRelationSchema,
  runtimeBytecodeHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  runtimeBytecodeBytes: z.number().int().positive().max(1_000_000),
});
export type EvmLogicCode = z.infer<typeof EvmLogicCodeSchema>;

export const EvmVerifiedSourceDeploymentSchema = z.object({
  blockNumber: UnsignedQuantityStringSchema,
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  deployer: EvmCanonicalAddressSchema,
});
export type EvmVerifiedSourceDeployment = z.infer<typeof EvmVerifiedSourceDeploymentSchema>;

export const EvmVerifiedSourceSchema = z.object({
  sourceId: z.string().min(1),
  sourceUri: z.url(),
  address: EvmCanonicalAddressSchema,
  matchType: z.literal('exact_match'),
  runtimeBytecodeHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  runtimeBytecodeBytes: z.number().int().positive().max(1_000_000),
  contractName: z.string().min(1).max(256),
  fullyQualifiedName: z.string().min(1).max(1_024),
  language: z.string().min(1).max(64),
  compilerVersion: z.string().min(1).max(256),
  verifiedAt: IsoDateTimeSchema,
  deployment: knowledgeValueSchema(EvmVerifiedSourceDeploymentSchema),
  abiFunctionCount: z.number().int().nonnegative().max(2_048),
  mutatingFunctionSignatures: z.array(z.string().min(1).max(2_048)).max(2_048),
});
