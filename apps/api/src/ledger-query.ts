import {
  ProviderError,
  type BitcoinTransactionRecord,
  type BitcoinUtxoLedgerAdapter,
  type EvmLedgerAdapter,
  type SolanaLedgerAdapter,
} from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  BitcoinSnapshotSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
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
  const evidence = await writeEvidence(
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
  return {
    subject,
    facts: bitcoinTransactionFacts(transaction),
    metadata: metadata(
      snapshot,
      [observation.endpointId],
      'bitcoin-transaction-query-v0.1.0',
      [evidence.id],
      { historyCoverage: transaction.status.confirmed ? 1 : 0, confidence: 0.95 },
    ),
    evidence: [evidence],
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
  const anchor = await adapter.createSnapshot();
  const sourceIds = [transactionObservation.endpointId, outspendObservation.endpointId];
  const snapshot = bitcoinObservationSnapshot(
    anchor,
    { transaction: transaction.raw, outspend: outspend.raw, vout },
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
    },
    metadata: metadata(
      snapshot,
      sourceIds,
      'bitcoin-outpoint-query-v0.1.0',
      [transactionEvidence.id, utxoEvidence.id],
      { historyCoverage: transaction.status.confirmed ? 1 : 0, confidence: 0.95 },
    ),
    evidence: [transactionEvidence, utxoEvidence],
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
  const evidence = await writeEvidence(
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
    },
    metadata: metadata(
      snapshot,
      [observation.endpointId],
      'solana-transaction-query-v0.1.0',
      [evidence.id],
      { historyCoverage: 1 },
    ),
    evidence: [evidence],
  };
}
