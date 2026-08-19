import {
  ProviderError,
  type BitcoinTransactionRecord,
  type BitcoinUtxoLedgerAdapter,
} from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import {
  analyzeBitcoinScriptControl,
  analyzeBitcoinTransactionEntity,
} from '@zerotrace/platform-adapters';
import {
  BitcoinAddressUtxoSetSchema,
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type BitcoinAddressUtxoSet,
  type SubjectReference,
} from '@zerotrace/schemas';
import {
  bitcoinObservationSnapshot,
  blockResult,
  metadata,
  position,
  snapshotFinality,
  snapshotSources,
  uniqueSourceIds,
  unixTimestamp,
  type EvidenceWriter,
} from './ledger-query-shared.js';

export async function queryBitcoinBlock(
  adapter: BitcoinUtxoLedgerAdapter,
  subject: SubjectReference,
  writeEvidence: EvidenceWriter,
) {
  const anchor = /^[0-9]+$/.test(subject.normalizedId)
    ? await adapter.readAnchorAt(subject.normalizedId)
    : await adapter.readAnchorByHash(subject.normalizedId);
  return blockResult(subject, anchor, writeEvidence, 'bitcoin-block-query-v0.1.0');
}

function bitcoinTransactionFacts(transaction: BitcoinTransactionRecord) {
  const optInRbfSignal = transaction.inputs.some(
    (input) => !input.coinbase && BigInt(input.sequence) < 0xffff_fffen,
  );
  return {
    status: knownValue(transaction.status.confirmed ? 'CONFIRMED' : 'MEMPOOL'),
    blockHeight:
      transaction.status.blockHeight === undefined
        ? unknownValue('INSUFFICIENT_DATA', 'Unconfirmed transaction has no block height.')
        : knownValue(transaction.status.blockHeight),
    blockHash:
      transaction.status.blockHash === undefined
        ? unknownValue('INSUFFICIENT_DATA', 'Unconfirmed transaction has no block hash.')
        : knownValue(transaction.status.blockHash),
    blockTime: unixTimestamp(transaction.status.blockTime),
    feeSats: knownValue(transaction.feeSats),
    sizeBytes: knownValue(transaction.size),
    weightUnits: knownValue(transaction.weight),
    inputCount: knownValue(String(transaction.inputCount)),
    outputCount: knownValue(String(transaction.outputs.length)),
    locktime: knownValue(transaction.locktime),
    inputSequences: knownValue(transaction.inputs.map((input) => input.sequence)),
    optInRbfSignal: knownValue(optInRbfSignal),
    effectiveMempoolReplaceability: transaction.status.confirmed
      ? unknownValue('NOT_APPLICABLE', 'Confirmed transactions are no longer mempool candidates.')
      : unknownValue(
          'INSUFFICIENT_DATA',
          'Esplora exposes input sequence signaling but not the active Bitcoin Core replacement policy or inherited ancestor state.',
        ),
    cpfpPackageState: transaction.status.confirmed
      ? unknownValue(
          'NOT_APPLICABLE',
          'Confirmed transactions are outside the active mempool graph.',
        )
      : unknownValue(
          'UNSUPPORTED',
          'Esplora does not expose Bitcoin Core ancestor, descendant, depends, or spentby mempool policy fields.',
        ),
  };
}

export async function queryBitcoinAddress(
  adapter: BitcoinUtxoLedgerAdapter,
  subject: SubjectReference,
  writeEvidence: EvidenceWriter,
) {
  const before = await adapter.readHeadAnchor();
  const [statsObservation, utxoObservation] = await Promise.all([
    adapter.getAddressObservation(subject.normalizedId),
    adapter.getAddressUtxosObservation(subject.normalizedId),
  ]);
  const after = await adapter.readHeadAnchor();
  if (
    before.anchor.position !== after.anchor.position ||
    before.anchor.hash !== after.anchor.hash
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Bitcoin best-chain tip changed while the address UTXO observation was being captured; retry required.',
    );
  }
  const stats = statsObservation.value;
  const confirmedBalance =
    BigInt(stats.chain_stats.funded_txo_sum) - BigInt(stats.chain_stats.spent_txo_sum);
  const mempoolDelta =
    BigInt(stats.mempool_stats.funded_txo_sum) - BigInt(stats.mempool_stats.spent_txo_sum);
  const statsNet = confirmedBalance + mempoolDelta;
  const totalValue = utxoObservation.value.reduce((sum, utxo) => sum + BigInt(utxo.valueSats), 0n);
  const sourceIds = uniqueSourceIds([
    ...snapshotSources(before.snapshot),
    ...snapshotSources(after.snapshot),
    statsObservation.endpointId,
    utxoObservation.endpointId,
  ]);
  const snapshot = bitcoinObservationSnapshot(
    after.snapshot,
    { stats, utxos: utxoObservation.value },
    sourceIds,
  );
  const utxoSet: BitcoinAddressUtxoSet = BitcoinAddressUtxoSetSchema.parse({
    address: subject.normalizedId,
    utxos: utxoObservation.value.map((utxo) => ({
      outpoint: `${utxo.txid}:${utxo.vout}`,
      txid: utxo.txid,
      vout: utxo.vout,
      valueSats: utxo.valueSats,
      confirmed: utxo.status.confirmed,
      blockHeight:
        utxo.status.blockHeight === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'Mempool UTXO has no block height.')
          : knownValue(utxo.status.blockHeight),
      blockHash:
        utxo.status.blockHash === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'Mempool UTXO has no block hash.')
          : knownValue(utxo.status.blockHash),
    })),
    confirmedUtxoCount: utxoObservation.value.filter((utxo) => utxo.status.confirmed).length,
    mempoolUtxoCount: utxoObservation.value.filter((utxo) => !utxo.status.confirmed).length,
    totalValueSats: totalValue.toString(),
    statsNetValueSats: statsNet.toString(),
    balanceAgreement:
      totalValue === statsNet
        ? knownValue(true)
        : unknownValue(
            'CONFLICTING_SOURCES',
            'Esplora address statistics and the observed UTXO set do not reconcile at the bracketed tip.',
          ),
    modelVersion: 'bitcoin-address-utxo-v1.0.0',
  });
  const statsEvidence = await writeEvidence(
    createEvidence({
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      kind: 'ACCOUNT_STATE',
      source: statsObservation.endpointId,
      locator: `address-stats:${subject.normalizedId}@${snapshot.height}`,
      payload: stats,
      blockOrSlot: snapshot.height,
      finality: 'best-chain-plus-mempool-observation',
      summary:
        'Bitcoin address chain and mempool statistics bracketed by one stable best-chain tip.',
    }),
    [],
    snapshot,
  );
  const utxoEvidence = await writeEvidence(
    createEvidence({
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      kind: 'UTXO',
      source: utxoObservation.endpointId,
      locator: `address-utxos:${subject.normalizedId}@${snapshot.height}`,
      payload: utxoObservation.value.map((utxo) => utxo.raw),
      blockOrSlot: snapshot.height,
      finality: 'best-chain-plus-mempool-observation',
      summary: 'Bitcoin address UTXO set bracketed by one stable best-chain tip.',
    }),
    [],
    snapshot,
  );
  const reconciliationEvidence = await writeEvidence(
    createEvidence({
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:bitcoin-address-utxo-v1.0.0',
      locator: `address-utxo-reconciliation:${subject.normalizedId}@${snapshot.height}`,
      payload: utxoSet,
      blockOrSlot: snapshot.height,
      finality: 'best-chain-plus-mempool-observation',
      summary:
        utxoSet.balanceAgreement.state === 'known'
          ? 'Bitcoin address statistics and UTXO value reconcile at the bracketed tip.'
          : 'Bitcoin address statistics and UTXO value conflict at the bracketed tip.',
      sourceEvidenceIds: [statsEvidence.id, utxoEvidence.id],
    }),
    [statsEvidence.id, utxoEvidence.id],
    snapshot,
  );
  const evidence = [statsEvidence, utxoEvidence, reconciliationEvidence];
  return {
    subject,
    facts: {
      confirmedBalanceSats: knownValue(confirmedBalance.toString()),
      mempoolDeltaSats: knownValue(mempoolDelta.toString()),
      chainTransactionCount: knownValue(String(stats.chain_stats.tx_count)),
      transactionCount: knownValue(String(stats.chain_stats.tx_count)),
      mempoolTransactionCount: knownValue(String(stats.mempool_stats.tx_count)),
      totalUtxoValueSats: knownValue(utxoSet.totalValueSats),
      confirmedUtxoCount: knownValue(String(utxoSet.confirmedUtxoCount)),
      mempoolUtxoCount: knownValue(String(utxoSet.mempoolUtxoCount)),
      balanceAgreement: utxoSet.balanceAgreement,
      utxoSet: knownValue(utxoSet),
      effectiveRbfPolicy: unknownValue(
        'UNSUPPORTED',
        'Address-level Esplora observations do not expose Bitcoin Core replacement policy state.',
      ),
      cpfpPackageState: unknownValue(
        'UNSUPPORTED',
        'Address-level Esplora observations do not expose Bitcoin Core ancestor/descendant package state.',
      ),
    },
    metadata: metadata(
      snapshot,
      sourceIds,
      'bitcoin-address-utxo-v1.0.0',
      evidence.map((item) => item.id),
      {
        historyCoverage: 0,
        confidence: utxoSet.balanceAgreement.state === 'known' ? 0.95 : 0.5,
      },
    ),
    evidence,
    consistency: 'BRACKETED_BEST_CHAIN_TIP_WITH_MEMPOOL_DIGEST',
  };
}

export async function queryBitcoinTransaction(
  adapter: BitcoinUtxoLedgerAdapter,
  subject: SubjectReference,
  writeEvidence: EvidenceWriter,
) {
  const observation = await adapter.getTransactionObservation(subject.normalizedId);
  const transaction = observation.value;
  let snapshot: AnalysisSnapshot;
  let finality: string;
  let consistency: string | undefined;
  if (transaction.status.confirmed) {
    const blockHeight = transaction.status.blockHeight;
    const blockHash = transaction.status.blockHash;
    if (blockHeight === undefined || blockHash === undefined) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Confirmed Bitcoin transaction is missing block placement.',
      );
    }
    const anchor = await adapter.readAnchorAt(blockHeight);
    if (anchor.snapshot.ledger !== 'BITCOIN' || anchor.snapshot.blockHash !== blockHash) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Bitcoin transaction block hash conflicts with the best-chain Snapshot.',
      );
    }
    snapshot = anchor.snapshot;
    finality = snapshot.finality;
  } else {
    const anchor = await adapter.createSnapshot();
    snapshot = bitcoinObservationSnapshot(anchor, transaction.raw, [observation.endpointId]);
    finality = 'mempool-observation';
    consistency = 'MEMPOOL_OBSERVATION_AT_BEST_CHAIN_TIP';
  }
  const transactionEvidence = await writeEvidence(
    createEvidence({
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      kind: 'TRANSACTION',
      source: observation.endpointId,
      locator: `transaction:${transaction.txid}@${position(snapshot)}`,
      payload: transaction.raw,
      blockOrSlot: position(snapshot),
      finality,
      summary: transaction.status.confirmed
        ? 'Confirmed Bitcoin transaction bound to its best-chain block Snapshot.'
        : 'Bitcoin mempool transaction bound to a tip and mempool digest Snapshot.',
    }),
    [],
    snapshot,
  );
  const sourceEvidence = await writeEvidence(
    createEvidence({
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      kind: 'OFFICIAL_DOCUMENT',
      source: 'bitcoin-bips',
      locator: 'bip-0078@c38071c8c45a1fc50cecaac0d82d99e3bbd56911',
      sourceUri:
        'https://github.com/bitcoin/bips/blob/c38071c8c45a1fc50cecaac0d82d99e3bbd56911/bip-0078.mediawiki',
      payload: {
        revision: 'c38071c8c45a1fc50cecaac0d82d99e3bbd56911',
        specification: 'BIP78',
        status: 'Deployed',
        impactedHeuristics: ['common-input', 'change-scriptpubkey', 'change-round-amount'],
        interpretation:
          'Final transaction structure cannot prove whether Payjoin negotiation occurred.',
      },
      blockOrSlot: position(snapshot),
      finality: 'versioned-document',
      summary:
        'BIP78 documents that Payjoin can invalidate common-input and change-identification heuristics.',
    }),
    [],
    snapshot,
  );
  const entityAnalysis = analyzeBitcoinTransactionEntity(transaction);
  const entityEvidence = await writeEvidence(
    createEvidence({
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:bitcoin-transaction-entity-v1.0.0',
      locator: `transaction-entity:${transaction.txid}@${position(snapshot)}`,
      payload: entityAnalysis,
      blockOrSlot: position(snapshot),
      finality,
      summary:
        entityAnalysis.structuralPattern === 'EQUAL_OUTPUT_COINJOIN_LIKE'
          ? 'Equal-output CoinJoin-like structure suppresses automatic common-input ownership merging.'
          : 'Bitcoin clustering candidates were derived without converting transaction heuristics into an entity merge.',
      sourceEvidenceIds: [transactionEvidence.id, sourceEvidence.id],
    }),
    [transactionEvidence.id, sourceEvidence.id],
    snapshot,
  );
  const evidence = [transactionEvidence, sourceEvidence, entityEvidence];
  return {
    subject,
    facts: {
      ...bitcoinTransactionFacts(transaction),
      transactionEntityAnalysis: knownValue(entityAnalysis),
      feeReconciles: entityAnalysis.feeReconciles,
      structuralPattern: knownValue(entityAnalysis.structuralPattern),
      commonInputHeuristic: entityAnalysis.commonInputHeuristic,
      automaticOwnershipMergeAllowed: knownValue(false),
      selectedChangeOutput: entityAnalysis.selectedChangeOutput,
      ownershipConclusion: entityAnalysis.ownershipConclusion,
    },
    metadata: metadata(
      snapshot,
      [observation.endpointId],
      'bitcoin-transaction-query-v1.0.0',
      evidence.map((item) => item.id),
      {
        historyCoverage: transaction.status.confirmed ? 1 : 0,
        confidence:
          entityAnalysis.feeReconciles.state === 'known' &&
          entityAnalysis.feeReconciles.value === false
            ? 0.5
            : 0.95,
      },
    ),
    evidence,
    ...(consistency === undefined ? {} : { consistency }),
  };
}

export async function queryBitcoinOutpoint(
  adapter: BitcoinUtxoLedgerAdapter,
  subject: SubjectReference,
  writeEvidence: EvidenceWriter,
) {
  const [txid, rawVout] = subject.normalizedId.split(':');
  const vout = Number(rawVout);
  if (txid === undefined || !Number.isSafeInteger(vout) || vout < 0) {
    throw new ProviderError('INVALID_RESPONSE', 'Bitcoin outpoint is invalid.');
  }
  const before = await adapter.readHeadAnchor();
  const [transactionObservation, outspendObservation] = await Promise.all([
    adapter.getTransactionObservation(txid),
    adapter.getOutspendObservation(txid, vout),
  ]);
  const transaction = transactionObservation.value;
  const output = transaction.outputs[vout];
  if (output === undefined) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Bitcoin outpoint does not exist in the transaction.',
    );
  }
  const outspend = outspendObservation.value;
  const spendingTransactionObservation =
    outspend.spendingTxid === undefined
      ? undefined
      : await adapter.getTransactionObservation(outspend.spendingTxid);
  const spendingTransaction = spendingTransactionObservation?.value;
  const spendingInput =
    spendingTransaction === undefined || outspend.spendingVin === undefined
      ? undefined
      : spendingTransaction.inputs[Number(outspend.spendingVin)];
  if (outspend.spent) {
    if (
      spendingTransaction === undefined ||
      spendingInput === undefined ||
      spendingInput.coinbase ||
      spendingInput.previousTxid !== txid ||
      spendingInput.previousVout !== String(vout)
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Bitcoin spending transaction does not reference the requested outpoint at the reported input.',
      );
    }
    if (
      spendingInput.previousOutput === undefined ||
      spendingInput.previousOutput.valueSats !== output.valueSats ||
      spendingInput.previousOutput.scriptPubKey !== output.scriptPubKey ||
      spendingInput.previousOutput.scriptType !== output.scriptType ||
      spendingInput.previousOutput.address !== output.address
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Bitcoin spending input prevout conflicts with the funding transaction output.',
      );
    }
    if (
      outspend.status !== undefined &&
      (outspend.status.confirmed !== spendingTransaction.status.confirmed ||
        outspend.status.blockHeight !== spendingTransaction.status.blockHeight ||
        outspend.status.blockHash !== spendingTransaction.status.blockHash)
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Bitcoin outspend status conflicts with the spending transaction status.',
      );
    }
  }
  const scriptControl = analyzeBitcoinScriptControl(output, spendingInput);
  const after = await adapter.readHeadAnchor();
  if (
    before.anchor.position !== after.anchor.position ||
    before.anchor.hash !== after.anchor.hash
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Bitcoin best-chain tip changed while the outpoint observation was being captured; retry required.',
    );
  }
  const sourceIds = uniqueSourceIds([
    ...snapshotSources(before.snapshot),
    ...snapshotSources(after.snapshot),
    transactionObservation.endpointId,
    outspendObservation.endpointId,
    ...(spendingTransactionObservation === undefined
      ? []
      : [spendingTransactionObservation.endpointId]),
  ]);
  const snapshot = bitcoinObservationSnapshot(
    after.snapshot,
    {
      transaction: transaction.raw,
      outspend: outspend.raw,
      ...(spendingTransaction === undefined
        ? {}
        : { spendingTransaction: spendingTransaction.raw }),
      vout,
    },
    sourceIds,
  );
  const transactionEvidence = await writeEvidence(
    createEvidence({
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      kind: 'TRANSACTION',
      source: transactionObservation.endpointId,
      locator: `transaction:${txid}@outpoint-observation-${snapshot.height}`,
      payload: transaction.raw,
      blockOrSlot: snapshot.height,
      finality: snapshotFinality(snapshot),
      summary: 'Bitcoin funding transaction captured for an outpoint query.',
    }),
    [],
    snapshot,
  );
  const spendingTransactionEvidence =
    spendingTransactionObservation === undefined || spendingTransaction === undefined
      ? undefined
      : await writeEvidence(
          createEvidence({
            ledger: 'BITCOIN',
            chainId: snapshot.chainId,
            kind: 'TRANSACTION',
            source: spendingTransactionObservation.endpointId,
            locator: `spending-transaction:${spendingTransaction.txid}@outpoint-observation-${snapshot.height}`,
            payload: spendingTransaction.raw,
            blockOrSlot: snapshot.height,
            finality: spendingTransaction.status.confirmed
              ? snapshotFinality(snapshot)
              : 'mempool-observation',
            summary: 'Bitcoin spending transaction linked to the reported outpoint input.',
          }),
          [],
          snapshot,
        );
  const utxoSourceEvidenceIds = [
    transactionEvidence.id,
    ...(spendingTransactionEvidence === undefined ? [] : [spendingTransactionEvidence.id]),
  ];
  const utxoEvidence = await writeEvidence(
    createEvidence({
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      kind: 'UTXO',
      source: uniqueSourceIds(sourceIds).join('|'),
      locator: `outpoint:${subject.normalizedId}@${snapshot.height}`,
      payload: { output: output.raw, outspend: outspend.raw },
      blockOrSlot: snapshot.height,
      finality: 'best-chain-plus-mempool-observation',
      summary: 'Bitcoin output and spend state bound to a tip and mempool digest Snapshot.',
    }),
    [],
    snapshot,
  );
  const scriptControlEvidence = await writeEvidence(
    createEvidence({
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:bitcoin-script-control-v1.0.0',
      locator: `script-control:${subject.normalizedId}@${snapshot.height}`,
      payload: scriptControl,
      blockOrSlot: snapshot.height,
      finality: 'best-chain-plus-mempool-observation',
      summary:
        'Observable Bitcoin spend conditions decoded without treating script keys or hashes as entity identity.',
      sourceEvidenceIds: [...utxoSourceEvidenceIds, utxoEvidence.id],
    }),
    [...utxoSourceEvidenceIds, utxoEvidence.id],
    snapshot,
  );
  const evidence = [
    transactionEvidence,
    ...(spendingTransactionEvidence === undefined ? [] : [spendingTransactionEvidence]),
    utxoEvidence,
    scriptControlEvidence,
  ];
  return {
    subject,
    facts: {
      valueSats: knownValue(output.valueSats),
      scriptPubKey: knownValue(output.scriptPubKey),
      scriptType: knownValue(output.scriptType),
      address:
        output.address === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'Output has no standard address representation.')
          : knownValue(output.address),
      spent: knownValue(outspend.spent),
      spendingTxid:
        outspend.spendingTxid === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'No spending transaction is observed.')
          : knownValue(outspend.spendingTxid),
      spendingVin:
        outspend.spendingVin === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'No spending input is observed.')
          : knownValue(outspend.spendingVin),
      fundingStatus: knownValue(transaction.status.confirmed ? 'CONFIRMED' : 'MEMPOOL'),
      spendingStatus:
        outspend.status === undefined
          ? outspend.spent
            ? unknownValue('INSUFFICIENT_DATA', 'Spending transaction status is unavailable.')
            : unknownValue('NOT_QUERIED', 'Output is currently unspent.')
          : knownValue(outspend.status.confirmed ? 'CONFIRMED' : 'MEMPOOL'),
      scriptControl: knownValue(scriptControl),
      controllerIdentity: scriptControl.controllerIdentity,
      effectiveSpendingTransactionRbf:
        spendingTransaction === undefined
          ? unknownValue('NOT_APPLICABLE', 'Output is currently unspent.')
          : bitcoinTransactionFacts(spendingTransaction).effectiveMempoolReplaceability,
      spendingTransactionCpfpPackage:
        spendingTransaction === undefined
          ? unknownValue('NOT_APPLICABLE', 'Output is currently unspent.')
          : bitcoinTransactionFacts(spendingTransaction).cpfpPackageState,
    },
    metadata: metadata(
      snapshot,
      sourceIds,
      'bitcoin-outpoint-query-v1.0.0',
      evidence.map((item) => item.id),
      { historyCoverage: transaction.status.confirmed ? 1 : 0, confidence: 0.95 },
    ),
    evidence,
    consistency: 'BEST_CHAIN_TIP_WITH_MEMPOOL_DIGEST',
  };
}
