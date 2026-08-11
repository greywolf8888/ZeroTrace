import {
  ProviderError,
  type BitcoinTransactionRecord,
  type BitcoinUtxoLedgerAdapter,
  type EvmLedgerAdapter,
  type SolanaLedgerAdapter,
} from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  analyzeBitcoinScriptControl,
  analyzeBitcoinTransactionEntity,
  analyzeSolanaTransactionSemantics,
  SOLANA_ASSET_FLOW_MODEL_VERSION,
  SOLANA_TRANSACTION_SEMANTICS_MODEL_VERSION,
} from '@zerotrace/platform-adapters';
import {
  BitcoinAddressUtxoSetSchema,
  BitcoinSnapshotSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type BitcoinAddressUtxoSet,
  type ChainAnchorRead,
  type Evidence,
  type SubjectReference,
} from '@zerotrace/schemas';

export type EvidenceWriter = (
  evidence: Evidence,
  sourceEvidenceIds?: readonly string[],
  snapshot?: AnalysisSnapshot,
) => Promise<Evidence>;

type BitcoinAnalysisSnapshot = Extract<AnalysisSnapshot, { ledger: 'BITCOIN' }>;

function uniqueSourceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function snapshotSources(snapshot: AnalysisSnapshot): string[] {
  return Object.keys(snapshot.providerVersions);
}

function position(snapshot: AnalysisSnapshot): string {
  switch (snapshot.ledger) {
    case 'EVM':
      return snapshot.blockNumber;
    case 'BITCOIN':
      return snapshot.height;
    case 'SOLANA':
      return snapshot.slot;
  }
}

function snapshotFinality(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'SOLANA' ? snapshot.commitment : snapshot.finality;
}

function metadata(
  snapshot: AnalysisSnapshot,
  sourceIds: readonly string[],
  modelVersion: string,
  evidenceIds: readonly string[],
  options: { dataCoverage?: number; historyCoverage?: number; confidence?: number } = {},
): AnalysisMetadata {
  const sourceSet = uniqueSourceIds([...snapshotSources(snapshot), ...sourceIds]);
  return {
    snapshot,
    dataCoverage: options.dataCoverage ?? 1,
    sourceCoverage: Math.min(1, sourceSet.length / 2),
    historyCoverage: options.historyCoverage ?? 0,
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet,
    modelVersion,
    confidence: options.confidence ?? 1,
    evidenceIds: [...evidenceIds],
  };
}

function decimalHexQuantity(value: string, field: string): string {
  if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `EVM ${field} is not a canonical quantity.`);
  }
  return BigInt(value).toString();
}

function unixTimestamp(value: string | undefined) {
  if (value === undefined) return unknownValue('INSUFFICIENT_DATA', 'Block time was not returned.');
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds > Math.floor(Number.MAX_SAFE_INTEGER / 1_000)) {
    return unknownValue('PRECISION_UNSAFE', 'Block time exceeds safe date precision.');
  }
  return knownValue(new Date(seconds * 1_000).toISOString());
}

function bitcoinObservationSnapshot(
  anchor: AnalysisSnapshot,
  payload: unknown,
  observationSourceIds: readonly string[],
): BitcoinAnalysisSnapshot {
  if (anchor.ledger !== 'BITCOIN') {
    throw new TypeError('Bitcoin observation snapshots require a Bitcoin anchor.');
  }
  const sourceIds = uniqueSourceIds([...snapshotSources(anchor), ...observationSourceIds]);
  const capturedAt = new Date().toISOString();
  return BitcoinSnapshotSchema.parse({
    ...anchor,
    capturedAt,
    providerVersions: Object.fromEntries(sourceIds.map((id) => [id, 'esplora-http'])),
    configHash: hashPayload({
      anchorConfigHash: anchor.configHash,
      observationSourceIds: sourceIds,
    }),
    mempoolSnapshot: `sha256:${hashPayload({
      anchorHeight: anchor.height,
      anchorHash: anchor.blockHash,
      payload,
      sourceIds,
    })}`,
  });
}

async function blockResult(
  subject: SubjectReference,
  anchorRead: ChainAnchorRead,
  writeEvidence: EvidenceWriter,
  modelVersion: string,
) {
  const snapshot = anchorRead.snapshot;
  const blockPosition = position(snapshot);
  const evidence = await writeEvidence(
    createEvidence({
      ledger: snapshot.ledger,
      chainId: snapshot.chainId,
      kind: 'BLOCK',
      source: anchorRead.anchor.source,
      locator: `block:${anchorRead.anchor.hash}@${blockPosition}`,
      payload: anchorRead.payload,
      observedAt: anchorRead.anchor.observedAt,
      blockOrSlot: blockPosition,
      finality: anchorRead.anchor.finality,
      summary: `${snapshot.ledger} block anchored by position and hash.`,
    }),
    [],
    snapshot,
  );
  const timestamp =
    snapshot.ledger === 'EVM'
      ? snapshot.blockTimestamp === undefined
        ? unknownValue('INSUFFICIENT_DATA')
        : knownValue(snapshot.blockTimestamp)
      : snapshot.ledger === 'SOLANA'
        ? snapshot.blockTimestamp === undefined
          ? unknownValue('INSUFFICIENT_DATA')
          : knownValue(snapshot.blockTimestamp)
        : unknownValue('NOT_QUERIED', 'Bitcoin timestamp remains in the captured block payload.');
  return {
    subject,
    facts: {
      position: knownValue(anchorRead.anchor.position),
      hash: knownValue(anchorRead.anchor.hash),
      parentPosition:
        anchorRead.anchor.parentPosition === undefined
          ? unknownValue('INSUFFICIENT_DATA')
          : knownValue(anchorRead.anchor.parentPosition),
      parentHash:
        anchorRead.anchor.parentHash === undefined
          ? unknownValue('INSUFFICIENT_DATA')
          : knownValue(anchorRead.anchor.parentHash),
      finality: knownValue(anchorRead.anchor.finality),
      timestamp,
    },
    metadata: metadata(snapshot, [anchorRead.anchor.source], modelVersion, [evidence.id]),
    evidence: [evidence],
  };
}

export async function queryEvmBlock(
  adapter: EvmLedgerAdapter,
  subject: SubjectReference,
  writeEvidence: EvidenceWriter,
) {
  const anchor = subject.normalizedId.startsWith('0x')
    ? await adapter.readAnchorByHash(subject.normalizedId)
    : await adapter.readAnchorAt(subject.normalizedId);
  return blockResult(subject, anchor, writeEvidence, 'evm-block-query-v0.1.0');
}

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

export async function queryEvmTransaction(
  adapter: EvmLedgerAdapter,
  subject: SubjectReference,
  writeEvidence: EvidenceWriter,
) {
  const transactionObservation = await adapter.getTransactionObservation(subject.normalizedId);
  const transaction = transactionObservation.value;
  if (transaction === null) {
    const snapshot = await adapter.createSnapshot();
    const providerObservation = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: snapshot.chainId,
        kind: 'PROVIDER_OBSERVATION',
        source: transactionObservation.endpointId,
        locator: `rpc-result:transaction:${subject.normalizedId}@${snapshot.blockNumber}`,
        payload: { transaction: null, observedAtHead: snapshot.blockHash },
        blockOrSlot: snapshot.blockNumber,
        finality: 'not-observed-at-finalized-head',
        summary: 'EVM provider returned a null transaction result at the captured head.',
      }),
      [],
      snapshot,
    );
    const negativeEvidence = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: snapshot.chainId,
        kind: 'NEGATIVE_EVIDENCE',
        source: 'zerotrace:transaction-observation-interpreter',
        locator: `transaction:${subject.normalizedId}@${snapshot.blockNumber}`,
        payload: {
          conclusion: 'NOT_OBSERVED',
          ambiguity: ['ABSENT', 'PRUNED', 'PROPAGATION_DELAY'],
        },
        blockOrSlot: snapshot.blockNumber,
        finality: 'not-observed-at-finalized-head',
        summary: 'EVM transaction was not observed; the cause remains explicitly unknown.',
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
          'The provider returned null; absence, pruning, and propagation delay are not conflated.',
        ),
      },
      metadata: metadata(
        snapshot,
        [transactionObservation.endpointId],
        'evm-transaction-query-v0.1.0',
        evidence.map((item) => item.id),
        { dataCoverage: 0.5, confidence: 0 },
      ),
      evidence,
    };
  }

  if (
    transaction.blockNumber === null ||
    transaction.blockHash === null ||
    transaction.transactionIndex === null
  ) {
    const snapshot = await adapter.createSnapshot();
    const evidence = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: snapshot.chainId,
        kind: 'TRANSACTION',
        source: transactionObservation.endpointId,
        locator: `transaction:${transaction.hash}@pending-head-${snapshot.blockNumber}`,
        payload: transaction.raw,
        blockOrSlot: snapshot.blockNumber,
        finality: 'pending-observation',
        summary: 'Pending EVM transaction observed near the captured finalized head.',
      }),
      [],
      snapshot,
    );
    return {
      subject,
      facts: {
        status: knownValue('PENDING'),
        blockNumber: unknownValue('INSUFFICIENT_DATA', 'Pending transaction has no block.'),
        blockHash: unknownValue('INSUFFICIENT_DATA', 'Pending transaction has no block.'),
        from: knownValue(transaction.from),
        to: knownValue(transaction.to),
        valueAtomic: knownValue(decimalHexQuantity(transaction.value, 'transaction value')),
        nonce: knownValue(decimalHexQuantity(transaction.nonce, 'transaction nonce')),
        gasLimit: knownValue(decimalHexQuantity(transaction.gas, 'transaction gas limit')),
        execution: unknownValue('NOT_QUERIED', 'Receipts do not exist for pending transactions.'),
      },
      metadata: metadata(
        snapshot,
        [transactionObservation.endpointId],
        'evm-transaction-query-v0.1.0',
        [evidence.id],
        { confidence: 0.9 },
      ),
      evidence: [evidence],
      consistency: 'PENDING_OBSERVATION_AT_FINALIZED_HEAD',
    };
  }

  const blockNumber = decimalHexQuantity(transaction.blockNumber, 'transaction block number');
  const [anchorRead, receiptObservation] = await Promise.all([
    adapter.readAnchorAt(blockNumber),
    adapter.getTransactionReceiptObservation(transaction.hash),
  ]);
  const snapshot = anchorRead.snapshot;
  if (snapshot.ledger !== 'EVM' || snapshot.blockHash.toLowerCase() !== transaction.blockHash) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'EVM transaction block hash conflicts with the position-pinned Snapshot.',
    );
  }
  const receipt = receiptObservation.value;
  if (
    receipt !== null &&
    (receipt.blockHash !== transaction.blockHash || receipt.blockNumber !== transaction.blockNumber)
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'EVM receipt placement conflicts with the transaction record.',
    );
  }
  const transactionEvidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'TRANSACTION',
      source: transactionObservation.endpointId,
      locator: `transaction:${transaction.hash}@${blockNumber}`,
      payload: transaction.raw,
      blockOrSlot: blockNumber,
      finality: snapshot.finality,
      summary: 'Confirmed EVM transaction bound to a position-pinned Snapshot.',
    }),
    [],
    snapshot,
  );
  const receiptEvidence =
    receipt === null
      ? undefined
      : await writeEvidence(
          createEvidence({
            ledger: 'EVM',
            chainId: snapshot.chainId,
            kind: 'RECEIPT',
            source: receiptObservation.endpointId,
            locator: `receipt:${receipt.transactionHash}@${blockNumber}`,
            payload: receipt.raw,
            blockOrSlot: blockNumber,
            finality: snapshot.finality,
            summary: 'EVM transaction receipt bound to the same block Snapshot.',
          }),
          [],
          snapshot,
        );
  const evidence = [
    transactionEvidence,
    ...(receiptEvidence === undefined ? [] : [receiptEvidence]),
  ];
  return {
    subject,
    facts: {
      status: knownValue('CONFIRMED'),
      blockNumber: knownValue(blockNumber),
      blockHash: knownValue(transaction.blockHash),
      transactionIndex: knownValue(
        decimalHexQuantity(transaction.transactionIndex, 'transaction index'),
      ),
      from: knownValue(transaction.from),
      to: knownValue(transaction.to),
      valueAtomic: knownValue(decimalHexQuantity(transaction.value, 'transaction value')),
      nonce: knownValue(decimalHexQuantity(transaction.nonce, 'transaction nonce')),
      gasLimit: knownValue(decimalHexQuantity(transaction.gas, 'transaction gas limit')),
      execution:
        receipt?.status === '0x1'
          ? knownValue('SUCCESS')
          : receipt?.status === '0x0'
            ? knownValue('REVERTED')
            : unknownValue('INSUFFICIENT_DATA', 'Receipt or receipt status is unavailable.'),
      gasUsed:
        receipt === null
          ? unknownValue('INSUFFICIENT_DATA', 'Receipt is unavailable.')
          : knownValue(decimalHexQuantity(receipt.gasUsed, 'receipt gas used')),
      logCount:
        receipt === null
          ? unknownValue('INSUFFICIENT_DATA', 'Receipt is unavailable.')
          : knownValue(String(receipt.logCount)),
    },
    metadata: metadata(
      snapshot,
      [transactionObservation.endpointId, receiptObservation.endpointId],
      'evm-transaction-query-v0.1.0',
      evidence.map((item) => item.id),
      { historyCoverage: 1 },
    ),
    evidence,
  };
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

export async function querySolanaTransaction(
  adapter: SolanaLedgerAdapter,
  subject: SubjectReference,
  writeEvidence: EvidenceWriter,
) {
  const observation = await adapter.getTransactionObservation(subject.normalizedId);
  const transaction = observation.value;
  if (transaction === null) {
    const snapshot = await adapter.createSnapshot();
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
  const anchor = await adapter.readAnchorAt(transaction.slot);
  const snapshot = anchor.snapshot;
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
      ],
    }),
    [
      transactionEvidence.id,
      ...instructionEvidence.map((item) => item.id),
      ...assetFlowEvidence.map((item) => item.id),
    ],
    snapshot,
  );
  const evidence = [
    transactionEvidence,
    ...instructionEvidence,
    ...assetFlowEvidence,
    semanticEvidence,
  ];
  const semanticDataCoverage = Math.min(
    semantics.accountCoverage,
    semantics.recordingCoverage,
    semantics.assetFlowCoverage.state === 'known' ? semantics.assetFlowCoverage.value : 1,
  );
  return {
    subject,
    facts: {
      status: knownValue('CONFIRMED'),
      slot: knownValue(transaction.slot),
      blockTime:
        transaction.blockTime === undefined
          ? unknownValue('INSUFFICIENT_DATA')
          : knownValue(transaction.blockTime),
      version: knownValue(transaction.version),
      feeLamports:
        transaction.feeLamports === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'Transaction metadata is unavailable.')
          : knownValue(transaction.feeLamports),
      execution:
        transaction.success === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'Transaction metadata is unavailable.')
          : knownValue(transaction.success ? 'SUCCESS' : 'FAILED'),
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
              'INSUFFICIENT_DATA',
              'Token-balance change count is Unknown without pre/post recording.',
            ),
      coreAssetFlowCount:
        semantics.accountResolutionComplete.state === 'known' &&
        semantics.innerInstructionRecording.state === 'known' &&
        (semantics.assetFlowDecodeCoverage.state !== 'known' ||
          semantics.assetFlowDecodeCoverage.value === 1)
          ? knownValue(semantics.assetFlows.length)
          : unknownValue(
              'INSUFFICIENT_DATA',
              'Core asset-flow count requires resolved accounts, inner-instruction recording and successful official decoding.',
            ),
      tokenFlowReconciliation: knownValue(semantics.tokenFlowReconciliation),
    },
    metadata: metadata(
      snapshot,
      [observation.endpointId],
      'solana-transaction-query-v1.1.0',
      evidence.map((item) => item.id),
      {
        dataCoverage: semanticDataCoverage,
        historyCoverage: 1,
        confidence: Math.round(semanticDataCoverage * 0.95 * 1_000_000) / 1_000_000,
      },
    ),
    evidence,
  };
}
