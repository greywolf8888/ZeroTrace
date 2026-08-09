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
      sourceEvidenceIds: [raw.id],
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

  it('content-addresses the complete observation rather than only its payload', () => {
    const base = {
      ledger: 'EVM' as const,
      chainId: 'eip155:1',
      kind: 'ACCOUNT_STATE' as const,
      source: 'ethereum-rpc@one.example',
      locator: 'address:0xabc@100',
      payload: { balance: '0' },
      observedAt: '2026-08-09T00:00:00.000Z',
      blockOrSlot: '100',
      summary: 'Account state.',
    };
    const original = createEvidence(base);
    const replay = createEvidence(base);
    const otherSource = createEvidence({ ...base, source: 'ethereum-rpc@two.example' });
    const otherBlock = createEvidence({
      ...base,
      locator: 'address:0xabc@101',
      blockOrSlot: '101',
    });

    expect(replay.id).toBe(original.id);
    expect(otherSource.payloadHash).toBe(original.payloadHash);
    expect(otherBlock.payloadHash).toBe(original.payloadHash);
    expect(new Set([original.id, otherSource.id, otherBlock.id]).size).toBe(3);

    const ledger = new EvidenceLedger();
    ledger.add(original);
    ledger.add(otherSource);
    ledger.add(otherBlock);
    expect(ledger.values()).toHaveLength(3);
  });

  it('canonicalizes equivalent observation timestamps before deriving an ID', () => {
    const input = {
      ledger: 'EVM' as const,
      chainId: 'eip155:1',
      kind: 'BLOCK' as const,
      source: 'fixture',
      locator: 'block:1',
      payload: { number: '1' },
      blockOrSlot: '1',
      summary: 'Timestamp canonicalization fixture.',
    };
    const utc = createEvidence({ ...input, observedAt: '2026-08-09T00:00:00.000Z' });
    const offset = createEvidence({ ...input, observedAt: '2026-08-09T08:00:00.000+08:00' });
    expect(offset.observedAt).toBe('2026-08-09T00:00:00.000Z');
    expect(offset.id).toBe(utc.id);
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
      sourceEvidenceIds: ['ev_missing'],
    });
    expect(() => ledger.add(negative, ['ev_missing'])).toThrow('must exist');
  });

  it('rejects derivation edges on raw facts and deeply freezes stored provenance', () => {
    const ledger = new EvidenceLedger();
    const raw = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'LOG',
      source: 'fixture',
      locator: 'log:source',
      payload: { value: 1 },
      summary: 'Source log.',
    });
    ledger.add(raw);
    const invalidRaw = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'LOG',
      source: 'fixture',
      locator: 'log:invalid-derived',
      payload: { value: 2 },
      summary: 'Invalid derived raw log.',
      sourceEvidenceIds: [raw.id],
    });
    expect(() => ledger.add(invalidRaw, [raw.id])).toThrow('may not derive');

    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:1',
      blockNumber: '1',
      blockHash: '0x' + 'a'.repeat(64),
      capturedAt: '2026-08-09T00:00:00.000Z',
      providerVersions: { fixture: '1' },
      adapterVersions: { evm: '0.1.0' },
      configHash: 'b'.repeat(64),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'none',
    };
    const bound = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'ACCOUNT_STATE',
      source: 'fixture',
      locator: 'account:one@1',
      payload: { balance: '1' },
      blockOrSlot: '1',
      summary: 'Snapshot-bound account.',
    });
    const node = ledger.add(bound, [], snapshot);
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.sourceEvidenceIds)).toBe(true);
    expect(Object.isFrozen(node.snapshot?.providerVersions)).toBe(true);
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
      sourceEvidenceIds: [raw.id],
    });
    const right = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'DERIVED_FEATURE',
      source: 'model',
      locator: 'feature:right',
      payload: { value: 'right' },
      summary: 'Right feature.',
      sourceEvidenceIds: [raw.id],
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
      sourceEvidenceIds: [left.id, right.id],
    });
    ledger.add(root, [left.id, right.id]);
    expect(ledger.drilldown(root.id)).toHaveLength(4);
    expect(ledger.drilldown('ev_missing')).toEqual([]);
    expect(ledger.get(raw.id)?.evidence).toEqual(raw);
    expect(ledger.values()).toHaveLength(4);
  });
});
