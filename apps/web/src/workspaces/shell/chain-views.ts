import type { KnowledgeValue } from '../../generated-api/client.js';

export interface BitcoinUtxoView {
  outpoint: string;
  valueSats: string;
  confirmed: boolean;
  blockHeight: KnowledgeValue<string>;
}

export interface BitcoinUtxoSetView {
  utxos: BitcoinUtxoView[];
  confirmedUtxoCount: number;
  mempoolUtxoCount: number;
  totalValueSats: string;
  statsNetValueSats: string;
  balanceAgreement: KnowledgeValue<boolean>;
}

export interface BitcoinScriptControlView {
  scriptClass: string;
  spendConditionVisibility: string;
  signatureRequirement: KnowledgeValue<string>;
  multisig: KnowledgeValue<{
    threshold: number;
    signerCount: number;
    publicKeyFingerprints: string[];
  }>;
  absoluteTimelocks: Array<{ kind: string; value: string; detail: string }>;
  relativeTimelocks: Array<{ kind: string; value: string; detail: string }>;
  hashPredicatePresent: KnowledgeValue<boolean>;
  taprootSpendPath: KnowledgeValue<string>;
  controllerIdentity: KnowledgeValue<string>;
  scriptConditionsComplete: KnowledgeValue<boolean>;
}

export interface BitcoinTransactionEntityView {
  coinbase: boolean;
  inputCount: number;
  outputCount: number;
  inputAddressCoverage: number;
  inputAddresses: string[];
  outputAddresses: string[];
  inputValueSats: KnowledgeValue<string>;
  outputValueSats: string;
  feeSats: string;
  feeReconciles: KnowledgeValue<boolean>;
  virtualSizeBytes: string;
  feeRateSatPerVbyte: KnowledgeValue<string>;
  equalOutputGroups: Array<{ valueSats: string; outputCount: number; vouts: number[] }>;
  structuralPattern: string;
  payjoinContaminationRisk: KnowledgeValue<boolean>;
  serviceClusterRisk: KnowledgeValue<boolean>;
  addressReuseOutputVouts: number[];
  commonInputHeuristic: KnowledgeValue<boolean>;
  commonInputOwnershipCandidate: KnowledgeValue<string[]>;
  automaticOwnershipMergeAllowed: false;
  suppressionReasons: string[];
  changeCandidates: Array<{
    vout: number;
    valueSats: string;
    scriptType: string;
    address: KnowledgeValue<string>;
    signals: string[];
  }>;
  selectedChangeOutput: KnowledgeValue<number>;
  ownershipConclusion: KnowledgeValue<string>;
  externalAttribution: KnowledgeValue<string>;
}

export interface SolanaTransactionSemanticsView {
  version: string;
  recentBlockhash: string;
  execution: 'SUCCESS' | 'FAILED' | 'METADATA_UNAVAILABLE';
  executionError: KnowledgeValue<unknown>;
  feePayer: KnowledgeValue<string>;
  signers: string[];
  requiredSignatureCount: number;
  staticAccountCount: number;
  loadedWritableAccountCount: number;
  loadedReadonlyAccountCount: number;
  accountResolutionComplete: KnowledgeValue<boolean>;
  accountCoverage: number;
  recordingCoverage: number;
  accounts: Array<{
    index: number;
    address: string;
    source: string;
    signer: boolean;
    writable: boolean;
    feePayer: boolean;
    balanceDeltaLamports: KnowledgeValue<string>;
  }>;
  addressTableLookups: Array<{
    accountKey: string;
    writableIndexes: number[];
    readonlyIndexes: number[];
  }>;
  outerInstructions: SolanaInstructionView[];
  innerInstructionRecording: KnowledgeValue<boolean>;
  innerInstructions: SolanaInstructionView[];
  cpiCount: KnowledgeValue<number>;
  programIds: string[];
  officialProgramInstructionCount: number;
  identifiedOfficialProgramInstructionCount: number;
  officialProgramIdentificationCoverage: KnowledgeValue<number>;
  assetFlowCandidateCount: number;
  assetFlowDecodeCoverage: KnowledgeValue<number>;
  assetFlowCoverage: KnowledgeValue<number>;
  assetFlows: SolanaAssetFlowView[];
  tokenFlowReconciliation: {
    status: 'MATCHED' | 'PARTIAL' | 'CONFLICT' | 'NOT_APPLICABLE' | 'UNKNOWN';
    expectedIdentityCount: number;
    observedIdentityCount: number;
    matchedIdentityCount: number;
    conflictingIdentityCount: number;
    unknownIdentityCount: number;
    unmodeledTokenInstructionCount: number;
    coverage: number;
    recommendedMaxRelativeError: 0;
    observedRelativeError: KnowledgeValue<number>;
    detail: string;
  };
  tokenBalanceRecording: KnowledgeValue<boolean>;
  tokenBalanceChanges: Array<{
    accountIndex: number;
    account: KnowledgeValue<string>;
    mint: string;
    preAmount: KnowledgeValue<string>;
    postAmount: KnowledgeValue<string>;
    deltaAmount: KnowledgeValue<string>;
  }>;
  computeUnitsConsumed: KnowledgeValue<string>;
  logRecording: KnowledgeValue<boolean>;
  logCount: KnowledgeValue<number>;
}

export interface SolanaInstructionView {
  path: string;
  stackHeight: KnowledgeValue<number>;
  programId: KnowledgeValue<string>;
  accountIndexes: number[];
  accounts: KnowledgeValue<string[]>;
  programSemantic: KnowledgeValue<{
    programFamily: string;
    instructionName: string;
    category: string;
    application: string;
  }>;
}

export interface SolanaAssetFlowView {
  id: string;
  instructionPath: string;
  programFamily: string;
  instructionName: string;
  application: 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';
  flowKind: 'TRANSFER' | 'MINT' | 'BURN';
  assetKind: string;
  sourceAccount: KnowledgeValue<string>;
  destinationAccount: KnowledgeValue<string>;
  sourceOwner: KnowledgeValue<string>;
  destinationOwner: KnowledgeValue<string>;
  mint: KnowledgeValue<string>;
  authority: KnowledgeValue<string>;
  amount: KnowledgeValue<string>;
  decimals: KnowledgeValue<number>;
  expectedFeeAmount: KnowledgeValue<string>;
  expectedRecipientAmount: KnowledgeValue<string>;
}
