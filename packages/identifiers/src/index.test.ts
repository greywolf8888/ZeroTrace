import { describe, expect, it } from 'vitest';

import { classifyIdentifier } from './index.js';

describe('classifyIdentifier', () => {
  it('normalizes an EVM address with checksum evidence', () => {
    const result = classifyIdentifier('0x52908400098527886e0f7030069857d2e4169ee7');
    expect(result.candidates[0]).toMatchObject({
      ledger: 'EVM',
      type: 'ADDRESS',
      normalizedId: '0x52908400098527886E0F7030069857D2E4169EE7',
      validation: 'CHECKSUM_VALID',
    });
  });

  it('validates native Bitcoin address checksums', () => {
    const result = classifyIdentifier('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    expect(result.candidates).toContainEqual(
      expect.objectContaining({ ledger: 'BITCOIN', type: 'ADDRESS', validation: 'CHECKSUM_VALID' }),
    );
  });

  it('recognizes a Solana public key without guessing its semantic account type', () => {
    const result = classifyIdentifier('11111111111111111111111111111111');
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        ledger: 'SOLANA',
        type: 'ADDRESS',
        validation: 'STRUCTURALLY_VALID',
      }),
    );
  });

  it('does not turn arbitrary text into an address', () => {
    expect(classifyIdentifier('not-an-address').candidates).toHaveLength(0);
  });

  it('returns an explicit empty-input rejection', () => {
    expect(classifyIdentifier('   ')).toEqual({
      query: '',
      candidates: [],
      rejectedReason: 'Identifier is empty.',
    });
  });

  it('keeps an EVM hash ambiguous between transaction and block', () => {
    const result = classifyIdentifier('0x' + 'a'.repeat(64), {
      ledger: 'EVM',
      chainId: 'eip155:56',
    });
    expect(result.candidates.map((candidate) => candidate.type)).toEqual(['TRANSACTION', 'BLOCK']);
    expect(result.candidates.every((candidate) => candidate.chainId === 'eip155:56')).toBe(true);
  });

  it('classifies Bitcoin hashes and outpoints independently', () => {
    const txid = 'ab'.repeat(32);
    expect(
      classifyIdentifier(txid, { ledger: 'BITCOIN' }).candidates.map((candidate) => candidate.type),
    ).toEqual(['TRANSACTION', 'BLOCK']);
    expect(classifyIdentifier(txid + ':2').candidates).toContainEqual(
      expect.objectContaining({
        ledger: 'BITCOIN',
        type: 'OUTPOINT',
        normalizedId: txid + ':2',
      }),
    );
  });

  it('uses ledger and type hints to suppress incompatible candidates', () => {
    const solana = '11111111111111111111111111111111';
    expect(classifyIdentifier(solana, { ledger: 'EVM' }).candidates).toEqual([]);
    expect(
      classifyIdentifier('0x52908400098527886e0f7030069857d2e4169ee7', {
        ledger: 'EVM',
        type: 'TRANSACTION',
      }).candidates,
    ).toEqual([]);
  });

  it('keeps a decimal height ambiguous unless the ledger is supplied', () => {
    const automatic = classifyIdentifier('840000');
    expect(automatic.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ledger: 'BITCOIN', type: 'BLOCK' }),
        expect.objectContaining({ ledger: 'SOLANA', type: 'BLOCK' }),
      ]),
    );
    const bitcoin = classifyIdentifier('840000', { ledger: 'BITCOIN' });
    expect(bitcoin.candidates).toHaveLength(1);
    expect(bitcoin.candidates[0]).toMatchObject({ ledger: 'BITCOIN', confidence: 0.8 });
  });
});
