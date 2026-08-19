import { ProviderError, type EvmLedgerAdapter } from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import { knownValue, unknownValue, type SubjectReference } from '@zerotrace/schemas';
import {
  blockResult,
  decimalHexQuantity,
  metadata,
  type EvidenceWriter,
} from './ledger-query-shared.js';

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
