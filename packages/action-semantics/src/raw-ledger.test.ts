import { createEvidence, hashPayload } from '@zerotrace/evidence';
import type {
  AnalysisSnapshot,
  Evidence,
  EvidenceKind,
  JsonValue,
  RawChainFact,
} from '@zerotrace/schemas';
import { describe, expect, it } from 'vitest';

import { ACTION_SEMANTICS_MODEL_VERSION, buildActionSemanticsFromRawFacts } from './index.js';

const capturedAt = '2026-08-12T00:00:00.000Z';
const source = 'sqd:test-dataset';
const artifactHash = 'f'.repeat(64);

function snapshot(ledger: 'EVM'): Extract<AnalysisSnapshot, { ledger: 'EVM' }>;
function snapshot(ledger: 'BITCOIN'): Extract<AnalysisSnapshot, { ledger: 'BITCOIN' }>;
function snapshot(ledger: 'SOLANA'): Extract<AnalysisSnapshot, { ledger: 'SOLANA' }>;
function snapshot(ledger: AnalysisSnapshot['ledger']): AnalysisSnapshot {
  const common = {
    capturedAt,
    providerVersions: { [source]: 'sqd-portal-finalized-http-v1' },
    adapterVersions: { 'sqd-finalized-ingestion-v4': '0.1.0' },
    configHash: 'a'.repeat(64),
    entityModelVersion: 'entity-model-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
  if (ledger === 'EVM') {
    return {
      ...common,
      ledger,
      chainId: '56',
      blockNumber: '10',
      blockHash: `0x${'b'.repeat(64)}`,
      parentBlockHash: `0x${'c'.repeat(64)}`,
      finality: 'finalized',
      blockTimestamp: capturedAt,
    };
  }
  if (ledger === 'BITCOIN') {
    return {
      ...common,
      ledger,
      chainId: 'bitcoin-mainnet',
      height: '10',
      blockHash: 'b'.repeat(64),
      previousBlockHash: 'c'.repeat(64),
      finality: 'best-chain',
    };
  }
  return {
    ...common,
    ledger,
    chainId: 'solana-mainnet',
    slot: '10',
    blockhash: '4'.repeat(44),
    commitment: 'finalized',
    blockTimestamp: capturedAt,
  };
}

function fact(input: {
  snapshot: AnalysisSnapshot;
  factType: string;
  subject: string;
  payload: Readonly<Record<string, JsonValue>>;
  kind: EvidenceKind;
  index: number;
}): { fact: RawChainFact; evidence: Evidence } {
  const position =
    input.snapshot.ledger === 'EVM'
      ? input.snapshot.blockNumber
      : input.snapshot.ledger === 'BITCOIN'
        ? input.snapshot.height
        : input.snapshot.slot;
  const blockHash =
    input.snapshot.ledger === 'SOLANA' ? input.snapshot.blockhash : input.snapshot.blockHash;
  const rawArtifactRef = `s3://zerotrace-raw/test-${input.snapshot.ledger.toLowerCase()}.json#sha256=${artifactHash}`;
  const evidence = createEvidence({
    ledger: input.snapshot.ledger,
    chainId: input.snapshot.chainId,
    kind: input.kind,
    source,
    locator: `test:${input.factType}:${input.index}`,
    payload: input.payload,
    observedAt: capturedAt,
    blockOrSlot: position,
    finality: 'finalized',
    rawArtifactRef,
    summary: `Test ${input.factType}.`,
  });
  const payloadHash = hashPayload(input.payload);
  return {
    evidence,
    fact: {
      id: hashPayload({ schema: 'test-raw-fact', index: input.index, payloadHash }),
      schemaVersion: 'zerotrace-raw-fact-v1',
      ledger: input.snapshot.ledger,
      chainId: input.snapshot.chainId,
      blockOrSlot: position,
      blockHash,
      factType: input.factType,
      subject: input.subject,
      provider: source,
      finality: 'finalized',
      payload: input.payload,
      payloadHash,
      evidenceId: evidence.id,
      rawArtifactRef,
      observedAt: capturedAt,
    },
  };
}

function build(items: Array<{ fact: RawChainFact; evidence: Evidence }>, snap: AnalysisSnapshot) {
  return buildActionSemanticsFromRawFacts({
    snapshot: snap,
    facts: items.map((item) => item.fact),
    evidence: items.map((item) => item.evidence),
    dataCoverage: 1,
    sourceCoverage: 0.5,
  });
}

describe('raw ledger Action Semantics adapter', () => {
  it('compiles finalized EVM call, native value and ERC-20 Transfer Evidence', () => {
    const snap = snapshot('EVM');
    const transactionId = `0x${'1'.repeat(64)}`;
    const from = `0x${'2'.repeat(40)}`;
    const to = `0x${'3'.repeat(40)}`;
    const token = `0x${'4'.repeat(40)}`;
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const transaction = fact({
      snapshot: snap,
      factType: 'TRANSACTION',
      subject: transactionId,
      kind: 'TRANSACTION',
      index: 0,
      payload: {
        hash: transactionId,
        transactionIndex: 0,
        status: 1,
        from,
        to,
        input: '0x1234',
        value: '5',
      },
    });
    const log = fact({
      snapshot: snap,
      factType: 'LOG',
      subject: `${transactionId}:0`,
      kind: 'LOG',
      index: 1,
      payload: {
        transactionHash: transactionId,
        transactionIndex: 0,
        logIndex: 0,
        address: token,
        topics: [
          transferTopic,
          `0x${'0'.repeat(24)}${from.slice(2)}`,
          `0x${'0'.repeat(24)}${to.slice(2)}`,
        ],
        data: `0x${'0'.repeat(63)}a`,
      },
    });

    const report = build([transaction, log], snap);

    expect(report.metadata.modelVersion).toBe(ACTION_SEMANTICS_MODEL_VERSION);
    expect(report.actions).toHaveLength(3);
    expect(
      report.actions
        .map((item) => (item.primitive.state === 'known' ? item.primitive.value : 'UNKNOWN'))
        .sort(),
    ).toEqual(['CONTRACT_CALL', 'TRANSFER', 'TRANSFER']);
    expect(report.actions.every((item) => item.claimedPurpose.state === 'unknown')).toBe(true);
    expect(report.metadata.sourceSet).toEqual([source]);
    expect(report.evidence.some((item) => item.id === report.terminalEvidenceId)).toBe(true);
  });

  it('compiles a complete Bitcoin UTXO transfer and explicit miner fee', () => {
    const snap = snapshot('BITCOIN');
    const transactionId = '1'.repeat(64);
    const items = [
      fact({
        snapshot: snap,
        factType: 'TRANSACTION',
        subject: transactionId,
        kind: 'TRANSACTION',
        index: 0,
        payload: { txid: transactionId, transactionIndex: 2 },
      }),
      fact({
        snapshot: snap,
        factType: 'UTXO_INPUT',
        subject: `${snap.blockHash}:2:0`,
        kind: 'UTXO',
        index: 1,
        payload: {
          transactionIndex: 2,
          inputIndex: 0,
          txid: '2'.repeat(64),
          vout: 1,
          prevoutValue: 1000,
          prevoutScriptPubKeyAddress: 'bc1qsource',
        },
      }),
      fact({
        snapshot: snap,
        factType: 'UTXO_OUTPUT',
        subject: `${snap.blockHash}:2:0`,
        kind: 'UTXO',
        index: 2,
        payload: {
          transactionIndex: 2,
          outputIndex: 0,
          value: 700,
          scriptPubKeyAddress: 'bc1qdestination',
          scriptPubKeyHex: '0014aa',
        },
      }),
      fact({
        snapshot: snap,
        factType: 'UTXO_OUTPUT',
        subject: `${snap.blockHash}:2:1`,
        kind: 'UTXO',
        index: 3,
        payload: {
          transactionIndex: 2,
          outputIndex: 1,
          value: 200,
          scriptPubKeyAddress: 'bc1qchange',
          scriptPubKeyHex: '0014bb',
        },
      }),
    ];

    const report = build(items, snap);
    const action = report.actions[0];

    expect(action?.primitive).toEqual({ state: 'known', value: 'TRANSFER' });
    expect(action?.proofKinds).toEqual(['UTXO_CONSERVATION']);
    expect(action?.actor).toEqual({ state: 'known', value: 'bc1qsource' });
    expect(action?.assetDeltas).toContainEqual(
      expect.objectContaining({
        account: 'bitcoin:bitcoin-mainnet:miner-fee',
        direction: 'CREDIT',
        amount: '100',
      }),
    );
  });

  it('compiles Solana program execution and balanced SPL owner deltas', () => {
    const snap = snapshot('SOLANA');
    const transactionId = '1'.repeat(88);
    const mint = '5'.repeat(44);
    const sender = '6'.repeat(44);
    const recipient = '7'.repeat(44);
    const items = [
      fact({
        snapshot: snap,
        factType: 'TRANSACTION',
        subject: transactionId,
        kind: 'TRANSACTION',
        index: 0,
        payload: {
          signatures: [transactionId],
          transactionIndex: 3,
          feePayer: sender,
          err: null,
          fee: 50,
        },
      }),
      fact({
        snapshot: snap,
        factType: 'BALANCE',
        subject: `${snap.blockhash}:3:${sender}`,
        kind: 'ACCOUNT_STATE',
        index: 2,
        payload: {
          transactionIndex: 3,
          account: sender,
          pre: 1000,
          post: 850,
        },
      }),
      fact({
        snapshot: snap,
        factType: 'BALANCE',
        subject: `${snap.blockhash}:3:${recipient}`,
        kind: 'ACCOUNT_STATE',
        index: 3,
        payload: {
          transactionIndex: 3,
          account: recipient,
          pre: 0,
          post: 100,
        },
      }),
      fact({
        snapshot: snap,
        factType: 'INSTRUCTION',
        subject: `${snap.blockhash}:3:0`,
        kind: 'INSTRUCTION',
        index: 1,
        payload: {
          transactionIndex: 3,
          instructionAddress: [0],
          programId: '8'.repeat(44),
          accounts: [],
          data: '',
          isCommitted: true,
          error: null,
        },
      }),
      fact({
        snapshot: snap,
        factType: 'TOKEN_BALANCE',
        subject: `${snap.blockhash}:3:${'9'.repeat(44)}`,
        kind: 'ACCOUNT_STATE',
        index: 4,
        payload: {
          transactionIndex: 3,
          account: '9'.repeat(44),
          preMint: mint,
          postMint: mint,
          preOwner: sender,
          postOwner: sender,
          preAmount: '100',
          postAmount: '20',
        },
      }),
      fact({
        snapshot: snap,
        factType: 'TOKEN_BALANCE',
        subject: `${snap.blockhash}:3:${'A'.repeat(44)}`,
        kind: 'ACCOUNT_STATE',
        index: 5,
        payload: {
          transactionIndex: 3,
          account: 'A'.repeat(44),
          preMint: mint,
          postMint: mint,
          preOwner: recipient,
          postOwner: recipient,
          preAmount: '0',
          postAmount: '80',
        },
      }),
    ];

    const report = build(items, snap);

    expect(report.actions).toHaveLength(2);
    expect(
      report.actions
        .map((item) => (item.primitive.state === 'known' ? item.primitive.value : 'UNKNOWN'))
        .sort(),
    ).toEqual(['CONTRACT_CALL', 'TRANSFER']);
    expect(report.actions.find((item) => item.proposedKind === 'TRANSFER')?.proofKinds).toEqual([
      'BALANCE_DELTAS',
    ]);
    expect(
      report.actions.find((item) => item.proposedKind === 'TRANSFER')?.assetDeltas,
    ).toContainEqual(
      expect.objectContaining({
        account: 'solana:solana-mainnet:validator-fee',
        direction: 'CREDIT',
        amount: '50',
      }),
    );
  });

  it('fails closed on cross-transaction facts and Evidence payload mismatch', () => {
    const snap = snapshot('EVM');
    const transactionId = `0x${'1'.repeat(64)}`;
    const transaction = fact({
      snapshot: snap,
      factType: 'TRANSACTION',
      subject: transactionId,
      kind: 'TRANSACTION',
      index: 0,
      payload: {
        hash: transactionId,
        transactionIndex: 0,
        status: 1,
        from: `0x${'2'.repeat(40)}`,
        to: `0x${'3'.repeat(40)}`,
        input: '0x1234',
        value: '0',
      },
    });
    const wrongTrace = fact({
      snapshot: snap,
      factType: 'TRACE',
      subject: `${snap.blockHash}:1:root`,
      kind: 'TRACE',
      index: 1,
      payload: { transactionIndex: 1, traceAddress: [], type: 'call' },
    });
    expect(() => build([transaction, wrongTrace], snap)).toThrow(/another or unresolved/);

    const detachedTrace = {
      ...wrongTrace,
      fact: {
        ...wrongTrace.fact,
        rawArtifactRef: `s3://zerotrace-raw/other.json#sha256=${artifactHash}`,
      },
    };
    expect(() => build([transaction, detachedTrace], snap)).toThrow(/one provider artifact/);

    const tampered = {
      ...transaction,
      evidence: { ...transaction.evidence, payloadHash: '0'.repeat(64) },
    };
    expect(() => build([tampered], snap)).toThrow(/identity must match/);
  });
});
