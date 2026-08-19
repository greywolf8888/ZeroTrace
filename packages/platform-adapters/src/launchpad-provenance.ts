import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  SolanaLaunchpadObservationSchema,
  SolanaSnapshotSchema,
  ProtocolDeploymentVersionSchema,
  type AnalysisSnapshot,
} from '@zerotrace/schemas';

import {
  PUMP_IDL_SHA256,
  PUMP_PROGRAM_ID,
  PUMP_SOURCE_COMMIT,
  PUMPSWAP_IDL_SHA256,
  PUMPSWAP_PROGRAM_ID,
} from './solana-launchpad.js';

/**
 * These are pinned real-provider provenance records, not test fixtures and
 * never production query input. The live decoder uses chain observations and
 * the version constants below; the records only close the activation gate.
 */

const SOURCE_ENDPOINT = 'pump-launchpad-live-smoke@api.mainnet.solana.com';
const OBSERVED_AT = '2026-08-14T03:02:04.761Z';
const SLOT = '439138804';
const SIGNATURE =
  '3QTGbxYPzDg4WDS57MCivWpEJMsyRZmkMR6EsfTm9PjRFt3KpMrXuDfsarc2Z38uSPJH73DHRCDnxXrU9nNjrEec';
const PUMP_IDL_URI = `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/idl/pump.json`;
const PUMP_DOCS_URI = 'https://pump.fun/docs/';

export const PUMP_LAUNCHPAD_PROVENANCE_SNAPSHOT = SolanaSnapshotSchema.parse({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  slot: SLOT,
  blockhash: '99Rnw3UYVpZC8eJERd65RQBVoPCcUX6ELAThb89iqgBU',
  parentSlot: '439138803',
  previousBlockhash: 'ELqfmwGSmT9Y6nvzCYyDQXnzLpuDD5e3E9kvGCDy7kUg',
  commitment: 'finalized',
  capturedAt: OBSERVED_AT,
  blockTimestamp: '2026-08-14T02:26:20.000Z',
  providerVersions: { [SOURCE_ENDPOINT]: 'solana-json-rpc' },
  adapterVersions: { solana: '0.1.0' },
  configHash: '0989cb652af52a4c9b404016e492bbf0fcf5a4736325a2fb334a5a5315f5a36a',
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-empty-v1',
});

const snapshot = PUMP_LAUNCHPAD_PROVENANCE_SNAPSHOT;
const sourceSnapshot = snapshot as AnalysisSnapshot;

const officialEvidence = createEvidence({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  kind: 'OFFICIAL_DOCUMENT',
  source: `pump-public-docs@${PUMP_SOURCE_COMMIT}`,
  locator: `idl:pump.json@${PUMP_SOURCE_COMMIT}`,
  sourceUri: PUMP_IDL_URI,
  payload: {
    sourceCommit: PUMP_SOURCE_COMMIT,
    abiOrIdlHash: PUMP_IDL_SHA256,
    programId: PUMP_PROGRAM_ID,
    documentationUri: PUMP_DOCS_URI,
  },
  observedAt: OBSERVED_AT,
  summary: 'Official Pump IDL and documentation provenance pinned for a read-only decoder.',
});

const programEvidence = createEvidence({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  kind: 'PROGRAM_STATE',
  source: SOURCE_ENDPOINT,
  locator: `program:${PUMP_PROGRAM_ID}@${SLOT}`,
  payload: {
    programId: PUMP_PROGRAM_ID,
    executable: true,
    owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
    contextSlot: 439143921,
    requestedMinimumContextSlot: SLOT,
  },
  observedAt: OBSERVED_AT,
  blockOrSlot: SLOT,
  finality: 'finalized',
  summary: 'Pump program identity was executable at or after the captured finalized slot.',
});

const transactionEvidence = createEvidence({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  kind: 'TRANSACTION',
  source: SOURCE_ENDPOINT,
  locator: `transaction:${SIGNATURE}@${SLOT}`,
  payload: {
    signature: SIGNATURE,
    slot: SLOT,
    blockhash: snapshot.blockhash,
    programId: PUMP_PROGRAM_ID,
    instructionPath: 'outer:1/inner:3',
    instructionName: 'buy',
    instructionVersion: 'LEGACY',
    discriminator: '66063d1201daebea',
    decodedArguments: [
      { name: 'amount', value: '155125755469' },
      { name: 'max_sol_cost', value: '9093555' },
    ],
    accountCoverage: 1,
    argumentCoverage: 1,
    decodeWarnings: ['Instruction carries 2 trailing account(s) outside the pinned layout.'],
  },
  observedAt: OBSERVED_AT,
  blockOrSlot: SLOT,
  finality: 'finalized',
  summary: 'A finalized Pump transaction was captured from the public Solana RPC.',
});

const sourceEvidenceIds = [officialEvidence.id, programEvidence.id, transactionEvidence.id].sort();

const draftObservationBase = {
  schemaVersion: 'solana-launchpad-observation-v1' as const,
  platform: 'PUMP' as const,
  programId: PUMP_PROGRAM_ID,
  deploymentId: 'pump-solana-mainnet-9c82f61cb711',
  sourceCommit: PUMP_SOURCE_COMMIT,
  abiOrIdlHash: PUMP_IDL_SHA256,
  officialSourceUris: [PUMP_DOCS_URI, 'https://github.com/pump-fun/pump-public-docs', PUMP_IDL_URI],
  signature: SIGNATURE,
  slot: SLOT,
  instructionPath: 'outer:1/inner:3',
  instructionName: 'buy',
  instructionVersion: 'LEGACY' as const,
  category: 'TRADE' as const,
  discriminator: '66063d1201daebea',
  accountIndexes: [21, 15, 9, 4, 5, 1, 0, 10, 19, 6, 22, 20, 12, 7, 23, 24, 13, 16],
  accounts: [
    { index: 21, name: 'global', address: '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf' },
    { index: 15, name: 'fee_recipient', address: '8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR' },
    { index: 9, name: 'mint', address: 'EbudBPrWzLXLkkc3NrteDBvYDnyb9Pw7zCua36rnpump' },
    { index: 4, name: 'bonding_curve', address: 'FB1gTiPiDDXscsz6w6FSuGzX9ZCraiti77iRH581CPRg' },
    {
      index: 5,
      name: 'associated_bonding_curve',
      address: 'G1WRNM3DBBcYT2y8WgHbtWyFjy2EHgfCxbNNpkdHF8Zh',
    },
    { index: 1, name: 'associated_user', address: 'H1E9bgMVoJ4FADjtrxL17wz9jwqxAcdmFY23XMmKLW9S' },
    { index: 0, name: 'user', address: 'Bc3LeBKbss4pr3DybHubFtxPBmCBNCA2Re7X8v6sUbgr' },
    { index: 10, name: 'system_program', address: '11111111111111111111111111111111' },
    { index: 19, name: 'token_program', address: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
    { index: 6, name: 'creator_vault', address: '9JyeP6Nx45VKasdNZX55vtWmxaZzSDc5ssCbipikLgKX' },
    { index: 22, name: 'event_authority', address: 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1' },
    { index: 20, name: 'program', address: PUMP_PROGRAM_ID },
    {
      index: 12,
      name: 'global_volume_accumulator',
      address: 'Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y',
    },
    {
      index: 7,
      name: 'user_volume_accumulator',
      address: 'DPTHJ8qKPGhT6SApDoSEriUViPL8Qo2tmYSyfL8CpnyE',
    },
    { index: 23, name: 'fee_config', address: '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt' },
    { index: 24, name: 'fee_program', address: 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ' },
    { index: 13, name: 'account_16', address: 'AgpzvG3dWpjVDbcDpy8Q2U5Mi9D8SkvereQbU8Cm38H3' },
    { index: 16, name: 'account_17', address: 'EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL' },
  ],
  accountCoverage: 1,
  decodedArguments: [
    { name: 'amount', value: '155125755469' },
    { name: 'max_sol_cost', value: '9093555' },
  ],
  argumentCoverage: 1,
  decodeWarnings: ['Instruction carries 2 trailing account(s) outside the pinned layout.'],
  execution: 'SUCCESS' as const,
  evidenceIds: sourceEvidenceIds,
  snapshot,
};

const draftObservation = SolanaLaunchpadObservationSchema.parse({
  ...draftObservationBase,
  id: `slo_${hashPayload({ schema: draftObservationBase.schemaVersion, value: draftObservationBase }).slice(0, 24)}`,
  resultHash: hashPayload({
    ...draftObservationBase,
    id: `slo_${hashPayload({ schema: draftObservationBase.schemaVersion, value: draftObservationBase }).slice(0, 24)}`,
  }),
});

const decoderEvidence = createEvidence({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  kind: 'DERIVED_FEATURE',
  source: 'zerotrace:solana-pump-launchpad-v1.0.0',
  locator: `launchpad:PUMP:${SIGNATURE}:outer:1/inner:3@${SLOT}`,
  payload: draftObservation,
  observedAt: OBSERVED_AT,
  blockOrSlot: SLOT,
  finality: 'finalized',
  summary: 'Pinned Pump instruction decoded from a real finalized transaction.',
  sourceEvidenceIds,
});

const finalObservationBase = {
  ...draftObservationBase,
  evidenceIds: [...sourceEvidenceIds, decoderEvidence.id].sort(),
};
const finalObservation = SolanaLaunchpadObservationSchema.parse({
  ...finalObservationBase,
  id: `slo_${hashPayload({ schema: finalObservationBase.schemaVersion, value: finalObservationBase }).slice(0, 24)}`,
  resultHash: hashPayload({
    ...finalObservationBase,
    id: `slo_${hashPayload({ schema: finalObservationBase.schemaVersion, value: finalObservationBase }).slice(0, 24)}`,
  }),
});

export const PUMP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES = Object.freeze([
  { evidence: officialEvidence, sourceEvidenceIds: [], snapshot: sourceSnapshot },
  { evidence: programEvidence, sourceEvidenceIds: [], snapshot: sourceSnapshot },
  { evidence: transactionEvidence, sourceEvidenceIds: [], snapshot: sourceSnapshot },
  { evidence: decoderEvidence, sourceEvidenceIds, snapshot: sourceSnapshot },
] as const);

export const PUMP_LAUNCHPAD_PROVENANCE_RECORD = Object.freeze({
  schemaVersion: 'launchpad-real-provenance-v1',
  recordId: 'pump-solana-mainnet-buy-3qtgbx-439138804',
  captureKind: 'REAL_FINALIZED_PROVIDER_CAPTURE',
  sourceEndpoint: SOURCE_ENDPOINT,
  signature: SIGNATURE,
  slot: SLOT,
  snapshot,
  programIdentity: {
    programId: PUMP_PROGRAM_ID,
    executable: true,
    owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
    contextSlot: 439143921,
    requestedMinimumContextSlot: SLOT,
  },
  observation: finalObservation,
  evidenceIds: PUMP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES.map((node) => node.evidence.id).sort(),
  resultHash: hashPayload({
    schema: 'launchpad-real-provenance-v1',
    signature: SIGNATURE,
    slot: SLOT,
    snapshot,
    observation: finalObservation,
    evidenceIds: PUMP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES.map((node) => node.evidence.id).sort(),
  }),
});

export const PUMP_LAUNCHPAD_PROTOCOL_VERSION = ProtocolDeploymentVersionSchema.parse({
  platform: 'pump',
  ledger: 'SOLANA',
  chain: 'solana-mainnet',
  deploymentId: 'pump-solana-mainnet-9c82f61cb711',
  validFrom: { state: 'known', value: '0' },
  validTo: { state: 'unknown', reason: 'NOT_APPLICABLE' },
  programOrContract: PUMP_PROGRAM_ID,
  factories: [],
  abiOrIdlHash: PUMP_IDL_SHA256,
  sourceCommit: `pump-fun/pump-public-docs@${PUMP_SOURCE_COMMIT}`,
  officialSourceUris: [PUMP_DOCS_URI, 'https://github.com/pump-fun/pump-public-docs', PUMP_IDL_URI],
  evidenceIds: [...PUMP_LAUNCHPAD_PROVENANCE_RECORD.evidenceIds],
});

const PUMPSWAP_SNAPSHOT = SolanaSnapshotSchema.parse({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  slot: '439145015',
  blockhash: '7EW58wBqpuqeBWjuwZRFg8cmaAi1fLh3x9mecdkP1RcN',
  parentSlot: '439145014',
  previousBlockhash: 'DXhaucWvVpFQgZco2t5edEWusVXyvjjpusqCyYapPepZ',
  commitment: 'finalized',
  capturedAt: '2026-08-14T03:09:38.024Z',
  blockTimestamp: '2026-08-14T03:09:26.000Z',
  providerVersions: { [SOURCE_ENDPOINT]: 'solana-json-rpc' },
  adapterVersions: { solana: '0.1.0' },
  configHash: '0989cb652af52a4c9b404016e492bbf0fcf5a4736325a2fb334a5a5315f5a36a',
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-empty-v1',
});

const pumpswapOfficialEvidence = createEvidence({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  kind: 'OFFICIAL_DOCUMENT',
  source: `pump-public-docs@${PUMP_SOURCE_COMMIT}`,
  locator: `idl:pump_amm.json@${PUMP_SOURCE_COMMIT}`,
  sourceUri: `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/idl/pump_amm.json`,
  payload: {
    sourceCommit: PUMP_SOURCE_COMMIT,
    abiOrIdlHash: PUMPSWAP_IDL_SHA256,
    programId: PUMPSWAP_PROGRAM_ID,
    readmeUri: `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/docs/PUMP_SWAP_README.md`,
  },
  observedAt: PUMPSWAP_SNAPSHOT.capturedAt,
  summary: 'Official PumpSwap IDL and documentation provenance pinned for a read-only decoder.',
});

const pumpswapProgramEvidence = createEvidence({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  kind: 'PROGRAM_STATE',
  source: SOURCE_ENDPOINT,
  locator: `program:${PUMPSWAP_PROGRAM_ID}@${PUMPSWAP_SNAPSHOT.slot}`,
  payload: {
    programId: PUMPSWAP_PROGRAM_ID,
    executable: true,
    owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
    contextSlot: 439145017,
    requestedMinimumContextSlot: PUMPSWAP_SNAPSHOT.slot,
  },
  observedAt: PUMPSWAP_SNAPSHOT.capturedAt,
  blockOrSlot: PUMPSWAP_SNAPSHOT.slot,
  finality: 'finalized',
  summary: 'PumpSwap program identity was executable at or after the captured finalized slot.',
});

const PUMPSWAP_SIGNATURE =
  '3RiueuE9mxZXn8euZ2f88HN5h6CF61KbLiPo9HGXWvgCbg7cTn2wxNdXeDbgzFUfjq6cVjt9CzJjXsLoMtBBDX2K';
const pumpswapTransactionEvidence = createEvidence({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  kind: 'TRANSACTION',
  source: SOURCE_ENDPOINT,
  locator: `transaction:${PUMPSWAP_SIGNATURE}@${PUMPSWAP_SNAPSHOT.slot}`,
  payload: {
    signature: PUMPSWAP_SIGNATURE,
    slot: PUMPSWAP_SNAPSHOT.slot,
    blockhash: PUMPSWAP_SNAPSHOT.blockhash,
    programId: PUMPSWAP_PROGRAM_ID,
    instructionPath: 'outer:7',
    instructionName: 'buy',
    instructionVersion: 'CURRENT',
    discriminator: '66063d1201daebea',
    decodedArguments: [
      { name: 'base_amount_out', value: '558870' },
      { name: 'max_quote_amount_in', value: '151001' },
      { name: 'track_volume', value: 'true' },
    ],
    accountCoverage: 1,
    argumentCoverage: 1,
    decodeWarnings: ['Instruction carries 3 trailing account(s) outside the pinned layout.'],
  },
  observedAt: PUMPSWAP_SNAPSHOT.capturedAt,
  blockOrSlot: PUMPSWAP_SNAPSHOT.slot,
  finality: 'finalized',
  summary: 'A finalized PumpSwap transaction was captured from the public Solana RPC.',
});

const pumpswapSourceEvidenceIds = [
  pumpswapOfficialEvidence.id,
  pumpswapProgramEvidence.id,
  pumpswapTransactionEvidence.id,
].sort();

const pumpswapObservationBase = {
  schemaVersion: 'solana-launchpad-observation-v1' as const,
  platform: 'PUMPSWAP' as const,
  programId: PUMPSWAP_PROGRAM_ID,
  deploymentId: 'pumpswap-solana-mainnet-9c82f61cb711',
  sourceCommit: PUMP_SOURCE_COMMIT,
  abiOrIdlHash: PUMPSWAP_IDL_SHA256,
  officialSourceUris: [
    'https://github.com/pump-fun/pump-public-docs',
    `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/idl/pump_amm.json`,
    `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/docs/PUMP_SWAP_README.md`,
  ],
  signature: PUMPSWAP_SIGNATURE,
  slot: PUMPSWAP_SNAPSHOT.slot,
  instructionPath: 'outer:7',
  instructionName: 'buy',
  instructionVersion: 'CURRENT' as const,
  category: 'SWAP' as const,
  discriminator: '66063d1201daebea',
  accountIndexes: [
    5, 0, 14, 22, 24, 3, 8, 4, 9, 20, 6, 26, 25, 10, 15, 19, 21, 2, 13, 16, 1, 11, 23, 18, 12, 7,
  ],
  accounts: [
    { index: 5, name: 'pool', address: 'D1Tt9S3LLPTdrqFjPFAh48qsNfrfjodJ86reNgStAer4' },
    { index: 0, name: 'user', address: 'HJgQsZXMMsZBcWe6XRdt2niiCXfAhZtPNxZwjUfoZT5M' },
    { index: 14, name: 'global_config', address: 'ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw' },
    { index: 22, name: 'base_mint', address: 'PDpaDDygjRmaPWLzTEypmidZ6oouQPVqVFF66C8pump' },
    { index: 24, name: 'quote_mint', address: 'So11111111111111111111111111111111111111112' },
    {
      index: 3,
      name: 'user_base_token_account',
      address: 'BYbNuC9Fxeo1UeqDwEXYxjWbkEEz7cPTWP17CDm895Nt',
    },
    {
      index: 8,
      name: 'user_quote_token_account',
      address: 'HjxyXvFvdV5yYCVhAuCPwkd6Xkq7FdYmdUwGifMEc8HP',
    },
    {
      index: 4,
      name: 'pool_base_token_account',
      address: 'CqAByVoFRoiufvtgyxHUxgdoex2sPfKaf8PM8HbFoQ58',
    },
    {
      index: 9,
      name: 'pool_quote_token_account',
      address: 'RyzCKVrRnxMF4YMX58v5TpAfDP2jdiW1Ky3omyNBSCH',
    },
    {
      index: 20,
      name: 'protocol_fee_recipient',
      address: 'JCRGumoE9Qi5BBgULTgdgTLjSgkCMSbF62ZZfGs84JeU',
    },
    {
      index: 6,
      name: 'protocol_fee_recipient_token_account',
      address: 'DWpvfqzGWuVy9jVSKSShdM2733nrEsnnhsUStYbkj6Nn',
    },
    {
      index: 26,
      name: 'base_token_program',
      address: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    },
    {
      index: 25,
      name: 'quote_token_program',
      address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    },
    { index: 10, name: 'system_program', address: '11111111111111111111111111111111' },
    {
      index: 15,
      name: 'associated_token_program',
      address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    },
    { index: 19, name: 'event_authority', address: 'GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR' },
    { index: 21, name: 'program', address: PUMPSWAP_PROGRAM_ID },
    {
      index: 2,
      name: 'coin_creator_vault_ata',
      address: 'AQpc4M5LtWkfyYBmy7NnRyFhzXfEqDw1jhZ26zzn3nA2',
    },
    {
      index: 13,
      name: 'coin_creator_vault_authority',
      address: '77KYoCszGQRcNWaTdgQ4SRJGevyauMobnKVnv2BPJ1sd',
    },
    {
      index: 16,
      name: 'global_volume_accumulator',
      address: 'C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw',
    },
    {
      index: 1,
      name: 'user_volume_accumulator',
      address: '4rx5Z3DtHSy9QxeT3DUh7YAjbkXPhUjpc4KvqZfnohk1',
    },
    { index: 11, name: 'fee_config', address: '5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx' },
    { index: 23, name: 'fee_program', address: 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ' },
    { index: 18, name: 'account_23', address: 'CwH7PqMP4GugZmDPgMERQGzGtmgAEpg9CRTSFbzSJwap' },
    { index: 12, name: 'account_24', address: '5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD' },
    { index: 7, name: 'account_25', address: 'HjQjngTDqoHE6aaGhUqfz9aQ7WZcBRjy5xB8PScLSr8i' },
  ],
  accountCoverage: 1,
  decodedArguments: [
    { name: 'base_amount_out', value: '558870' },
    { name: 'max_quote_amount_in', value: '151001' },
    { name: 'track_volume', value: 'true' },
  ],
  argumentCoverage: 1,
  decodeWarnings: ['Instruction carries 3 trailing account(s) outside the pinned layout.'],
  execution: 'SUCCESS' as const,
  evidenceIds: pumpswapSourceEvidenceIds,
  snapshot: PUMPSWAP_SNAPSHOT,
};
const pumpswapDraftId = `slo_${hashPayload({ schema: pumpswapObservationBase.schemaVersion, value: pumpswapObservationBase }).slice(0, 24)}`;
const pumpswapDraftObservation = SolanaLaunchpadObservationSchema.parse({
  ...pumpswapObservationBase,
  id: pumpswapDraftId,
  resultHash: hashPayload({ ...pumpswapObservationBase, id: pumpswapDraftId }),
});
const pumpswapDecoderEvidence = createEvidence({
  ledger: 'SOLANA',
  chainId: 'solana-mainnet',
  kind: 'DERIVED_FEATURE',
  source: 'zerotrace:solana-pump-launchpad-v1.0.0',
  locator: `launchpad:PUMPSWAP:${PUMPSWAP_SIGNATURE}:outer:7@${PUMPSWAP_SNAPSHOT.slot}`,
  payload: pumpswapDraftObservation,
  observedAt: PUMPSWAP_SNAPSHOT.capturedAt,
  blockOrSlot: PUMPSWAP_SNAPSHOT.slot,
  finality: 'finalized',
  summary: 'Pinned PumpSwap instruction decoded from a real finalized transaction.',
  sourceEvidenceIds: pumpswapSourceEvidenceIds,
});
const pumpswapFinalObservationBase = {
  ...pumpswapObservationBase,
  evidenceIds: [...pumpswapSourceEvidenceIds, pumpswapDecoderEvidence.id].sort(),
};
const pumpswapFinalId = `slo_${hashPayload({ schema: pumpswapFinalObservationBase.schemaVersion, value: pumpswapFinalObservationBase }).slice(0, 24)}`;
const pumpswapFinalObservation = SolanaLaunchpadObservationSchema.parse({
  ...pumpswapFinalObservationBase,
  id: pumpswapFinalId,
  resultHash: hashPayload({ ...pumpswapFinalObservationBase, id: pumpswapFinalId }),
});

export const PUMPSWAP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES = Object.freeze([
  {
    evidence: pumpswapOfficialEvidence,
    sourceEvidenceIds: [],
    snapshot: PUMPSWAP_SNAPSHOT as AnalysisSnapshot,
  },
  {
    evidence: pumpswapProgramEvidence,
    sourceEvidenceIds: [],
    snapshot: PUMPSWAP_SNAPSHOT as AnalysisSnapshot,
  },
  {
    evidence: pumpswapTransactionEvidence,
    sourceEvidenceIds: [],
    snapshot: PUMPSWAP_SNAPSHOT as AnalysisSnapshot,
  },
  {
    evidence: pumpswapDecoderEvidence,
    sourceEvidenceIds: pumpswapSourceEvidenceIds,
    snapshot: PUMPSWAP_SNAPSHOT as AnalysisSnapshot,
  },
] as const);

export const PUMPSWAP_LAUNCHPAD_PROVENANCE_RECORD = Object.freeze({
  schemaVersion: 'launchpad-real-provenance-v1',
  recordId: 'pumpswap-solana-mainnet-buy-3riueu-439145015',
  captureKind: 'REAL_FINALIZED_PROVIDER_CAPTURE',
  sourceEndpoint: SOURCE_ENDPOINT,
  signature: PUMPSWAP_SIGNATURE,
  slot: PUMPSWAP_SNAPSHOT.slot,
  snapshot: PUMPSWAP_SNAPSHOT,
  programIdentity: {
    programId: PUMPSWAP_PROGRAM_ID,
    executable: true,
    owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
    contextSlot: 439145017,
    requestedMinimumContextSlot: PUMPSWAP_SNAPSHOT.slot,
  },
  observation: pumpswapFinalObservation,
  evidenceIds: PUMPSWAP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES.map((node) => node.evidence.id).sort(),
  resultHash: hashPayload({
    schema: 'launchpad-real-provenance-v1',
    signature: PUMPSWAP_SIGNATURE,
    slot: PUMPSWAP_SNAPSHOT.slot,
    snapshot: PUMPSWAP_SNAPSHOT,
    observation: pumpswapFinalObservation,
    evidenceIds: PUMPSWAP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES.map(
      (node) => node.evidence.id,
    ).sort(),
  }),
});

export const PUMPSWAP_LAUNCHPAD_PROTOCOL_VERSION = ProtocolDeploymentVersionSchema.parse({
  platform: 'pump',
  ledger: 'SOLANA',
  chain: 'solana-mainnet',
  deploymentId: 'pumpswap-solana-mainnet-9c82f61cb711',
  validFrom: { state: 'known', value: '0' },
  validTo: { state: 'unknown', reason: 'NOT_APPLICABLE' },
  programOrContract: PUMPSWAP_PROGRAM_ID,
  factories: [],
  abiOrIdlHash: PUMPSWAP_IDL_SHA256,
  sourceCommit: `pump-fun/pump-public-docs@${PUMP_SOURCE_COMMIT}`,
  officialSourceUris: [
    'https://github.com/pump-fun/pump-public-docs',
    `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/idl/pump_amm.json`,
    `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/docs/PUMP_SWAP_README.md`,
  ],
  evidenceIds: [...PUMPSWAP_LAUNCHPAD_PROVENANCE_RECORD.evidenceIds],
});

export type PumpLaunchpadProvenanceEvidenceNode =
  (typeof PUMP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES)[number];
export type PumpLaunchpadProvenanceRecord = typeof PUMP_LAUNCHPAD_PROVENANCE_RECORD;
export type PumpLaunchpadProtocolVersion = typeof PUMP_LAUNCHPAD_PROTOCOL_VERSION;
export type PumpSwapLaunchpadProvenanceEvidenceNode =
  (typeof PUMPSWAP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES)[number];
export type PumpSwapLaunchpadProvenanceRecord = typeof PUMPSWAP_LAUNCHPAD_PROVENANCE_RECORD;
export type PumpSwapLaunchpadProtocolVersion = typeof PUMPSWAP_LAUNCHPAD_PROTOCOL_VERSION;
