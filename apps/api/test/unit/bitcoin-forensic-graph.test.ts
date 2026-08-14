import { describe, expect, it } from 'vitest';

import type {
  BitcoinTransactionInput,
  BitcoinTransactionOutput,
  BitcoinTransactionRecord,
  BitcoinUtxoLedgerAdapter,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import { BitcoinSnapshotSchema, type Evidence } from '@zerotrace/schemas';

import { captureBitcoinForensicGraph } from '../../src/bitcoin-forensic-graph.js';

function snapshot(height: string, blockHash: string) {
  return BitcoinSnapshotSchema.parse({
    ledger: 'BITCOIN',
    chainId: 'bitcoin-mainnet',
    height,
    blockHash,
    finality: 'best-chain',
    capturedAt: '2026-08-14T00:00:00.000Z',
    providerVersions: { 'esplora-test': 'esplora-http' },
    adapterVersions: { bitcoin: 'test' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-empty-v1',
  });
}

function output(valueSats: string, address: string): BitcoinTransactionOutput {
  return {
    valueSats,
    scriptPubKey: '0014' + '1'.repeat(40),
    scriptType: 'v0_p2wpkh',
    address,
    raw: {},
  };
}

function record(txid: string): BitcoinTransactionRecord {
  const previousTxid = 'f'.repeat(64);
  const inputs: BitcoinTransactionInput[] = [
    {
      coinbase: false,
      previousTxid,
      previousVout: '0',
      sequence: '4294967295',
      scriptSig: '',
      scriptSigAsm: '',
      witness: ['00'],
      previousOutput: output('1000', 'bc1qsource'),
      raw: {},
    },
  ];
  return {
    txid,
    version: 2,
    locktime: '0',
    size: '100',
    weight: '400',
    feeSats: '100',
    inputCount: 1,
    inputs,
    outputs: [output('900', 'bc1qrecipient')],
    status: { confirmed: true, blockHeight: '100', blockHash: 'a'.repeat(64), blockTime: '1' },
    raw: {},
  };
}

function anchor(height: string, blockHash: string) {
  const value = snapshot(height, blockHash);
  return {
    anchor: {
      ledger: 'BITCOIN' as const,
      chainId: 'bitcoin-mainnet' as const,
      position: height,
      hash: blockHash,
      finality: 'best-chain' as const,
      source: 'esplora-test',
      observedAt: value.capturedAt,
    },
    snapshot: value,
    payload: { height, blockHash },
  };
}

describe('Bitcoin forensic graph capture', () => {
  it('captures confirmed transactions against a stable best-chain tip', async () => {
    const txid = '1'.repeat(64);
    const head = anchor('101', 'b'.repeat(64));
    const block = anchor('100', 'a'.repeat(64));
    const adapter = {
      async readHeadAnchor() {
        return head;
      },
      async getTransactionObservation() {
        return { value: record(txid), endpointId: 'esplora-test' };
      },
      async readAnchorAt() {
        return block;
      },
    } as unknown as BitcoinUtxoLedgerAdapter;
    const captured: Evidence[] = [];
    const evidenceLedger = new EvidenceLedger();
    const result = await captureBitcoinForensicGraph({
      adapter,
      request: { transactionIds: [txid] },
      writeEvidence: async (item, sourceEvidenceIds = [], evidenceSnapshot) => {
        captured.push(item);
        return evidenceLedger.add(item, sourceEvidenceIds, evidenceSnapshot).evidence;
      },
    });
    expect(result.report.rootTxids).toEqual([txid]);
    expect(result.report.snapshotEnd.height).toBe('101');
    expect(result.report.evidenceIds.length).toBeGreaterThan(0);
    expect(captured.some((item) => item.kind === 'TRANSACTION')).toBe(true);
    expect(captured.some((item) => item.kind === 'DERIVED_FEATURE')).toBe(true);
    expect(result.report.evidenceIds).toEqual(
      expect.arrayContaining(
        captured.filter((item) => item.kind === 'DERIVED_FEATURE').map((item) => item.id),
      ),
    );
  });

  it('replays the same captured observations to the same result hash', async () => {
    const txid = '3'.repeat(64);
    const head = anchor('101', 'b'.repeat(64));
    const block = anchor('100', 'a'.repeat(64));
    const adapter = {
      async readHeadAnchor() {
        return head;
      },
      async getTransactionObservation() {
        return { value: record(txid), endpointId: 'esplora-test' };
      },
      async readAnchorAt() {
        return block;
      },
    } as unknown as BitcoinUtxoLedgerAdapter;
    const capture = () =>
      captureBitcoinForensicGraph({
        adapter,
        request: { transactionIds: [txid] },
        writeEvidence: async (item) => item,
      });

    const first = await capture();
    const second = await capture();
    expect(second.report.resultHash).toBe(first.report.resultHash);
    expect(second.report.evidenceIds).toEqual(first.report.evidenceIds);
    expect(second.evidence.map((item) => item.id)).toEqual(first.evidence.map((item) => item.id));
  });

  it('keeps unconfirmed transactions distinct from provider failure', async () => {
    const txid = '2'.repeat(64);
    const head = anchor('101', 'b'.repeat(64));
    const unconfirmed = record(txid);
    unconfirmed.status = { confirmed: false };
    const adapter = {
      async readHeadAnchor() {
        return head;
      },
      async getTransactionObservation() {
        return { value: unconfirmed, endpointId: 'esplora-test' };
      },
    } as unknown as BitcoinUtxoLedgerAdapter;
    await expect(
      captureBitcoinForensicGraph({
        adapter,
        request: { transactionIds: [txid] },
        writeEvidence: async (item) => item,
      }),
    ).rejects.toMatchObject({
      code: 'BITCOIN_FORENSIC_GRAPH_UNCONFIRMED',
      retryable: false,
    });
  });
});
