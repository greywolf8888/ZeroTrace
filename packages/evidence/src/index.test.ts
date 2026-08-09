import { describe, expect, it } from 'vitest';

import { EvidenceLedger, createEvidence, hashPayload } from './index.js';

describe('evidence ledger', () => {
  it('hashes JSON independently of object key order', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it('requires every derived feature to drill down to a raw fact', () => {
    const ledger = new EvidenceLedger();
    const raw = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'TRANSACTION',
      source: 'test-fixture',
      locator: 'tx:0xabc',
      payload: { from: 'a', to: 'b' },
      summary: 'Raw transaction fixture',
    });
    ledger.add(raw);
    const derived = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'DERIVED_FEATURE',
      source: 'entity-v0.1.0',
      locator: 'feature:settlement-convergence',
      payload: { score: 0.8 },
      summary: 'Settlement convergence feature',
    });
    ledger.add(derived, [raw.id]);

    expect(ledger.drilldown(derived.id).map((item) => item.evidence.id)).toEqual([
      derived.id,
      raw.id,
    ]);
  });

  it('rejects an ungrounded inference', () => {
    const ledger = new EvidenceLedger();
    const derived = createEvidence({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      kind: 'DERIVED_FEATURE',
      source: 'entity-v0.1.0',
      locator: 'feature:timing',
      payload: { score: 1 },
      summary: 'Timing feature',
    });
    expect(() => ledger.add(derived)).toThrow('must link to at least one source');
  });

  it('canonicalizes nested arrays, primitives, and optional evidence metadata', () => {
    expect(hashPayload([null, true, 'x', { b: 2, a: 1 }])).toBe(
      hashPayload([null, true, 'x', { a: 1, b: 2 }]),
    );
    const evidence = createEvidence({
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      kind: 'UTXO',
      source: 'fixture',
      locator: 'outpoint:abc:0',
      sourceUri: 'https://example.test/evidence',
      payload: ['abc', 0],
      observedAt: '2026-08-09T00:00:00.000Z',
      blockOrSlot: '840000',
      finality: 'six-confirmations',
      rawArtifactRef: 'sha256:abc',
      summary: 'Fixture UTXO.',
    });
    expect(evidence).toMatchObject({
      sourceUri: 'https://example.test/evidence',
      observedAt: '2026-08-09T00:00:00.000Z',
      blockOrSlot: '840000',
      finality: 'six-confirmations',
      rawArtifactRef: 'sha256:abc',
    });
  });

  it('rejects duplicates and missing derivation sources', () => {
    const ledger = new EvidenceLedger();
    const raw = createEvidence({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      kind: 'ACCOUNT_STATE',
      source: 'fixture',
      locator: 'account:one',
      payload: { lamports: '1' },
      summary: 'Account fixture.',
    });
    ledger.add(raw);
    expect(() => ledger.add(raw)).toThrow('already exists');

    const negative = createEvidence({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      kind: 'NEGATIVE_EVIDENCE',
      source: 'fixture-model',
      locator: 'feature:no-common-funder',
      payload: { present: false },
      summary: 'No common funder observed.',
    });
    expect(() => ledger.add(negative, ['ev_missing'])).toThrow('must exist');
  });

  it('deduplicates a diamond drilldown and lists immutable nodes', () => {
    const ledger = new EvidenceLedger();
    const raw = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'LOG',
      source: 'fixture',
      locator: 'log:1',
      payload: { value: 1 },
      summary: 'Raw log.',
    });
    ledger.add(raw);
    const left = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'DERIVED_FEATURE',
      source: 'model',
      locator: 'feature:left',
      payload: { value: 'left' },
      summary: 'Left feature.',
    });
    const right = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'DERIVED_FEATURE',
      source: 'model',
      locator: 'feature:right',
      payload: { value: 'right' },
      summary: 'Right feature.',
    });
    ledger.add(left, [raw.id]);
    ledger.add(right, [raw.id]);
    const root = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'DERIVED_FEATURE',
      source: 'model',
      locator: 'feature:root',
      payload: { value: 'root' },
      summary: 'Root feature.',
    });
    ledger.add(root, [left.id, right.id]);
    expect(ledger.drilldown(root.id)).toHaveLength(4);
    expect(ledger.drilldown('ev_missing')).toEqual([]);
    expect(ledger.get(raw.id)?.evidence).toEqual(raw);
    expect(ledger.values()).toHaveLength(4);
  });
});
