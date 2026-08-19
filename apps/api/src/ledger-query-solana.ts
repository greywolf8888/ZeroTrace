import {
  type SolanaLedgerAdapter,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import {
  analyzeSolanaTransactionSemantics,
  decodePumpLaunchpadInstructions,
  decodeRaydiumLaunchlabInstructions,
  SOLANA_ASSET_FLOW_MODEL_VERSION,
  SOLANA_PUMP_LAUNCHPAD_MODEL_VERSION,
  SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION,
  SOLANA_TRANSACTION_SEMANTICS_MODEL_VERSION,
} from '@zerotrace/platform-adapters';
import {
  SolanaTransactionIntelligenceReportSchema,
  knownValue,
  unknownValue,
  type Evidence,
  type SubjectReference,
} from '@zerotrace/schemas';
import { blockResult, metadata, snapshotFinality, type EvidenceWriter } from './ledger-query-shared.js';

export async function querySolanaBlock(
  adapter: SolanaLedgerAdapter,
  subject: SubjectReference,
  writeEvidence: EvidenceWriter,
) {
  return blockResult(
    subject,
    await adapter.readAnchorAt(subject.normalizedId),
    writeEvidence,
    'solana-block-query-v0.1.0',
  );
}

export async function querySolanaTransaction(
  adapter: SolanaLedgerAdapter,
  subject: SubjectReference,
  writeEvidence: EvidenceWriter,
  options: TransportReadOptions = {},
) {
  const observation = await adapter.getTransactionObservation(subject.normalizedId, options);
  const transaction = observation.value;
  if (transaction === null) {
    const snapshot = await adapter.createSnapshot(options);
    const providerObservation = await writeEvidence(
      createEvidence({
        ledger: 'SOLANA',
        chainId: snapshot.chainId,
        kind: 'PROVIDER_OBSERVATION',
        source: observation.endpointId,
        locator: `rpc-result:transaction:${subject.normalizedId}@${snapshot.slot}`,
        payload: { transaction: null, commitment: snapshot.commitment },
        blockOrSlot: snapshot.slot,
        finality: snapshot.commitment,
        summary: 'Solana provider returned a null transaction result at the requested commitment.',
      }),
      [],
      snapshot,
    );
    const negativeEvidence = await writeEvidence(
      createEvidence({
        ledger: 'SOLANA',
        chainId: snapshot.chainId,
        kind: 'NEGATIVE_EVIDENCE',
        source: 'zerotrace:transaction-observation-interpreter',
        locator: `transaction:${subject.normalizedId}@${snapshot.slot}`,
        payload: {
          conclusion: 'NOT_OBSERVED',
          ambiguity: ['NOT_FOUND', 'NOT_CONFIRMED_AT_COMMITMENT'],
        },
        blockOrSlot: snapshot.slot,
        finality: snapshot.commitment,
        summary:
          'Solana transaction was not observed; absence and commitment delay remain distinct.',
        sourceEvidenceIds: [providerObservation.id],
      }),
      [providerObservation.id],
      snapshot,
    );
    const evidence = [providerObservation, negativeEvidence];
    return {
      subject,
      facts: {
        status: unknownValue(
          'INSUFFICIENT_DATA',
          'Null may mean not found or not yet available at the requested commitment.',
        ),
      },
      metadata: metadata(
        snapshot,
        [observation.endpointId],
        'solana-transaction-query-v0.1.0',
        evidence.map((item) => item.id),
        { dataCoverage: 0.5, confidence: 0 },
      ),
      evidence,
    };
  }
  const anchor = await adapter.readAnchorAt(transaction.slot, options);
  const snapshot = anchor.snapshot;
  if (snapshot.ledger !== 'SOLANA') {
    throw new Error('Solana adapter returned a non-Solana Snapshot.');
  }
  const transactionEvidence = await writeEvidence(
    createEvidence({
      ledger: 'SOLANA',
      chainId: snapshot.chainId,
      kind: 'TRANSACTION',
      source: observation.endpointId,
      locator: `transaction:${transaction.signature}@${transaction.slot}`,
      payload: transaction.raw,
      blockOrSlot: transaction.slot,
      finality: snapshotFinality(snapshot),
      summary: 'Solana transaction bound to its committed slot Snapshot.',
    }),
    [],
    snapshot,
  );
  const semantics = analyzeSolanaTransactionSemantics(transaction);
  const instructionEvidence: Evidence[] = [];
  const instructionEvidenceByPath = new Map<string, Evidence>();
  for (const instruction of [...semantics.outerInstructions, ...semantics.innerInstructions]) {
    const evidence = await writeEvidence(
      createEvidence({
        ledger: 'SOLANA',
        chainId: snapshot.chainId,
        kind: 'DERIVED_FEATURE',
        source: `zerotrace:${SOLANA_TRANSACTION_SEMANTICS_MODEL_VERSION}`,
        locator: `instruction:${transaction.signature}:${instruction.path}@${transaction.slot}`,
        payload: instruction,
        blockOrSlot: transaction.slot,
        finality: snapshotFinality(snapshot),
        summary:
          instruction.innerIndex.state === 'known'
            ? `Normalized Solana CPI instruction ${instruction.path}.`
            : `Normalized Solana outer instruction ${instruction.path}.`,
        sourceEvidenceIds: [transactionEvidence.id],
      }),
      [transactionEvidence.id],
      snapshot,
    );
    instructionEvidence.push(evidence);
    instructionEvidenceByPath.set(instruction.path, evidence);
  }
  const assetFlowEvidence: Evidence[] = [];
  for (const flow of semantics.assetFlows) {
    const instruction = instructionEvidenceByPath.get(flow.instructionPath);
    const sourceEvidenceIds = [
      transactionEvidence.id,
      ...(instruction === undefined ? [] : [instruction.id]),
    ];
    assetFlowEvidence.push(
      await writeEvidence(
        createEvidence({
          ledger: 'SOLANA',
          chainId: snapshot.chainId,
          kind: 'DERIVED_FEATURE',
          source: `zerotrace:${SOLANA_ASSET_FLOW_MODEL_VERSION}`,
          locator: `asset-flow:${transaction.signature}:${flow.id}@${transaction.slot}`,
          payload: flow,
          blockOrSlot: transaction.slot,
          finality: snapshotFinality(snapshot),
          summary: `${flow.application} ${flow.programFamily} ${flow.instructionName} ${flow.flowKind.toLowerCase()} flow.`,
          sourceEvidenceIds,
        }),
        sourceEvidenceIds,
        snapshot,
      ),
    );
  }
  const decodeLaunchpadObservations = (
    evidenceIdsForInstruction: (path: string) => readonly string[],
  ) =>
    [
      ...decodePumpLaunchpadInstructions({
        transaction,
        semantics,
        snapshot,
        evidenceIdsForInstruction,
      }),
      ...decodeRaydiumLaunchlabInstructions({
        transaction,
        semantics,
        snapshot,
        evidenceIdsForInstruction,
      }),
    ].sort((left, right) => left.instructionPath.localeCompare(right.instructionPath));
  const draftLaunchpadObservations = decodeLaunchpadObservations((path) => {
    const instruction = instructionEvidenceByPath.get(path);
    return [transactionEvidence.id, ...(instruction === undefined ? [] : [instruction.id])];
  });
  const launchpadEvidence: Evidence[] = [];
  const launchpadEvidenceByPath = new Map<string, Evidence>();
  for (const observation of draftLaunchpadObservations) {
    const instruction = instructionEvidenceByPath.get(observation.instructionPath);
    const sourceEvidenceIds = [
      transactionEvidence.id,
      ...(instruction === undefined ? [] : [instruction.id]),
    ];
    const evidence = await writeEvidence(
      createEvidence({
        ledger: 'SOLANA',
        chainId: snapshot.chainId,
        kind: 'DERIVED_FEATURE',
        source: `zerotrace:${
          observation.platform === 'RAYDIUM_LAUNCHLAB'
            ? SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION
            : SOLANA_PUMP_LAUNCHPAD_MODEL_VERSION
        }`,
        locator: `launchpad:${observation.platform}:${transaction.signature}:${observation.instructionPath}@${transaction.slot}`,
        payload: observation,
        blockOrSlot: transaction.slot,
        finality: snapshotFinality(snapshot),
        summary: `Official ${observation.platform} ${observation.instructionName} instruction decoded from raw Solana data.`,
        sourceEvidenceIds,
      }),
      sourceEvidenceIds,
      snapshot,
    );
    launchpadEvidence.push(evidence);
    launchpadEvidenceByPath.set(observation.instructionPath, evidence);
  }
  const launchpadObservations = decodeLaunchpadObservations((path) => {
    const instruction = instructionEvidenceByPath.get(path);
    const derived = launchpadEvidenceByPath.get(path);
    return [
      transactionEvidence.id,
      ...(instruction === undefined ? [] : [instruction.id]),
      ...(derived === undefined ? [] : [derived.id]),
    ];
  });
  const semanticEvidence = await writeEvidence(
    createEvidence({
      ledger: 'SOLANA',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${SOLANA_TRANSACTION_SEMANTICS_MODEL_VERSION}`,
      locator: `transaction-semantics:${transaction.signature}@${transaction.slot}`,
      payload: semantics,
      blockOrSlot: transaction.slot,
      finality: snapshotFinality(snapshot),
      summary:
        semantics.accountResolutionComplete.state === 'known'
          ? 'Solana transaction accounts, instructions and recorded balance effects were normalized.'
          : 'Solana transaction semantics retain unresolved loaded-address and effect coverage.',
      sourceEvidenceIds: [
        transactionEvidence.id,
        ...instructionEvidence.map((item) => item.id),
        ...assetFlowEvidence.map((item) => item.id),
        ...launchpadEvidence.map((item) => item.id),
      ],
    }),
    [
      transactionEvidence.id,
      ...instructionEvidence.map((item) => item.id),
      ...assetFlowEvidence.map((item) => item.id),
      ...launchpadEvidence.map((item) => item.id),
    ],
    snapshot,
  );
  const evidence = [
    transactionEvidence,
    ...instructionEvidence,
    ...assetFlowEvidence,
    ...launchpadEvidence,
    semanticEvidence,
  ];
  const semanticDataCoverage = Math.min(
    semantics.accountCoverage,
    semantics.recordingCoverage,
    semantics.assetFlowCoverage.state === 'known' ? semantics.assetFlowCoverage.value : 1,
  );
  const facts = {
    status: knownValue('CONFIRMED' as const),
    slot: knownValue(transaction.slot),
    blockTime:
      transaction.blockTime === undefined
        ? unknownValue('INSUFFICIENT_DATA' as const)
        : knownValue(transaction.blockTime),
    version: knownValue(transaction.version),
    feeLamports:
      transaction.feeLamports === undefined
        ? unknownValue('INSUFFICIENT_DATA' as const, 'Transaction metadata is unavailable.')
        : knownValue(transaction.feeLamports),
    execution:
      transaction.success === undefined
        ? unknownValue('INSUFFICIENT_DATA' as const, 'Transaction metadata is unavailable.')
        : knownValue(transaction.success ? ('SUCCESS' as const) : ('FAILED' as const)),
    transactionSemantics: knownValue(semantics),
    feePayer: semantics.feePayer,
    signerCount: knownValue(semantics.signers.length),
    outerInstructionCount: knownValue(semantics.outerInstructions.length),
    cpiCount: semantics.cpiCount,
    accountResolutionComplete: semantics.accountResolutionComplete,
    tokenBalanceChangeCount:
      semantics.tokenBalanceRecording.state === 'known'
        ? knownValue(semantics.tokenBalanceChanges.length)
        : unknownValue(
            'INSUFFICIENT_DATA' as const,
            'Token-balance change count is Unknown without pre/post recording.',
          ),
    coreAssetFlowCount:
      semantics.accountResolutionComplete.state === 'known' &&
      semantics.innerInstructionRecording.state === 'known' &&
      (semantics.assetFlowDecodeCoverage.state !== 'known' ||
        semantics.assetFlowDecodeCoverage.value === 1)
        ? knownValue(semantics.assetFlows.length)
        : unknownValue(
            'INSUFFICIENT_DATA' as const,
            'Core asset-flow count requires resolved accounts, inner-instruction recording and successful official decoding.',
          ),
    tokenFlowReconciliation: knownValue(semantics.tokenFlowReconciliation),
  };
  const analysisMetadata = metadata(
    snapshot,
    [observation.endpointId],
    'solana-transaction-query-v1.1.0',
    evidence.map((item) => item.id),
    {
      dataCoverage: semanticDataCoverage,
      historyCoverage: 1,
      confidence: Math.round(semanticDataCoverage * 0.95 * 1_000_000) / 1_000_000,
    },
  );
  return SolanaTransactionIntelligenceReportSchema.parse({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    signature: transaction.signature,
    subject,
    facts,
    ...(launchpadObservations.length === 0 ? {} : { launchpadObservations }),
    terminalEvidenceId: semanticEvidence.id,
    metadata: analysisMetadata,
    evidence,
  });
}
