import { describe, expect, it } from 'vitest';

import type {
  BitcoinTransactionInput,
  BitcoinTransactionOutput,
  BitcoinTransactionRecord,
} from '@zerotrace/chain-adapters';
import { buildBitcoinForensicGraph } from './bitcoin-forensic-graph.js';

const evidence = ['ev_' + '1'.repeat(24), 'ev_' + '2'.repeat(24)];

function output(
  valueSats: string,
  address: string,
  scriptType = 'v0_p2wpkh',
): BitcoinTransactionOutput {
  return {
    valueSats,
    scriptPubKey: '0014' + '1'.repeat(40),
    scriptType,
    address,
    raw: {},
  };
}

function input(
  previousTxid: string,
  previousVout: string,
  valueSats: string,
  address: string,
): BitcoinTransactionInput {
  return {
    coinbase: false,
    previousTxid,
    previousVout,
    sequence: '4294967295',
    scriptSig: '',
    scriptSigAsm: '',
    witness: ['00'],
    previousOutput: output(valueSats, address),
    raw: {},
  };
}

function transaction(
  txid: string,
  inputs: BitcoinTransactionInput[],
  outputs: BitcoinTransactionOutput[],
  blockHeight: string,
  feeSats: string,
): BitcoinTransactionRecord {
  return {
    txid,
    version: 2,
    locktime: '0',
    size: '100',
    weight: '400',
    feeSats,
    inputCount: inputs.length,
    inputs,
    outputs,
    status: {
      confirmed: true,
      blockHeight,
      blockHash: blockHeight === '100' ? 'a'.repeat(64) : 'b'.repeat(64),
      blockTime: '1',
    },
    raw: {},
  };
}

function snapshot(height: string, blockHash: string) {
  return {
    ledger: 'BITCOIN' as const,
    chainId: 'bitcoin-mainnet' as const,
    height,
    blockHash,
    finality: 'best-chain' as const,
    capturedAt: '2026-08-14T00:00:00.000Z',
    providerVersions: { 'esplora-test': 'esplora-http' },
    adapterVersions: { bitcoin: 'test' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'test',
    labelSnapshot: 'none',
  };
}

describe('Bitcoin forensic graph', () => {
  it('builds observed UTXO paths and a peeling candidate without ownership merging', () => {
    const first = '1'.repeat(64);
    const second = '2'.repeat(64);
    const transactions = [
      transaction(
        first,
        [input('3'.repeat(64), '0', '11000', 'bc1qsource')],
        [output('7000', 'bc1qrecipient'), output('3000', 'bc1qcontinuation')],
        '100',
        '1000',
      ),
      transaction(
        second,
        [input(first, '1', '3000', 'bc1qcontinuation')],
        [output('2900', 'bc1qnext')],
        '101',
        '100',
      ),
    ];
    const result = buildBitcoinForensicGraph({
      rootTxids: [first],
      transactions,
      snapshotStart: snapshot('100', 'a'.repeat(64)),
      snapshotEnd: snapshot('101', 'b'.repeat(64)),
      evidenceIds: evidence,
      sourceSet: ['esplora-test'],
    });

    expect(result.report.automaticOwnershipMergeAllowed).toBe(false);
    expect(result.report.edges.some((edge) => edge.kind === 'PEELING_PATTERN')).toBe(true);
    expect(result.report.edges.some((edge) => edge.kind === 'UTXO_SPEND')).toBe(true);
    expect(result.report.case.evidenceLine.graphId).toBe(result.report.id);
    expect(result.report.case.evidenceLine.terminalBoundary).toBe('SERVICE_BOUNDARY');
    expect(result.report.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps CoinJoin-like inputs in a negative/suppressed evidence phase', () => {
    const txid = '4'.repeat(64);
    const record = transaction(
      txid,
      [
        input('5'.repeat(64), '0', '10000', 'bc1qone'),
        input('6'.repeat(64), '0', '10000', 'bc1qtwo'),
        input('7'.repeat(64), '0', '10000', 'bc1qthree'),
      ],
      [output('9000', 'bc1qa'), output('9000', 'bc1qb'), output('9000', 'bc1qc')],
      '101',
      '3000',
    );
    const result = buildBitcoinForensicGraph({
      rootTxids: [txid],
      transactions: [record],
      snapshotStart: snapshot('101', 'b'.repeat(64)),
      snapshotEnd: snapshot('101', 'b'.repeat(64)),
      evidenceIds: evidence,
      sourceSet: ['esplora-test'],
    });
    expect(result.report.suppressionReasons).toContain('COINJOIN_EQUAL_OUTPUT_PATTERN');
    expect(result.report.edges.some((edge) => edge.kind === 'COINJOIN_SUPPRESSED')).toBe(true);
    expect(result.report.case.evidenceLine.phases.some((phase) => phase.phase === 'NEGATIVE')).toBe(
      true,
    );
  });
});
