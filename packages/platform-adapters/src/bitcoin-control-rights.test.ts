import { fromOutputScript, toBech32 } from 'bitcoinjs-lib/src/address';
import { hash160, sha256 } from 'bitcoinjs-lib/src/crypto';
import { bitcoin } from 'bitcoinjs-lib/src/networks';
import { OPS, compile, number as scriptNumber } from 'bitcoinjs-lib/src/script';
import { describe, expect, it } from 'vitest';

import type { BitcoinTransactionInput, BitcoinTransactionOutput } from '@zerotrace/chain-adapters';

import { analyzeBitcoinScriptControl } from './bitcoin-control-rights.js';

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex');
}

function output(
  script: Uint8Array,
  scriptType: string,
  withAddress = true,
): BitcoinTransactionOutput {
  const address =
    scriptType === 'v1_p2tr'
      ? toBech32(script.slice(2), 1, bitcoin.bech32)
      : fromOutputScript(script, bitcoin);
  return {
    valueSats: '100000',
    scriptPubKey: hex(script),
    scriptType,
    ...(withAddress ? { address } : {}),
    raw: {},
  };
}

function input(overrides: Partial<BitcoinTransactionInput> = {}): BitcoinTransactionInput {
  return {
    coinbase: false,
    previousTxid: 'a'.repeat(64),
    previousVout: '0',
    sequence: '4294967293',
    scriptSig: '',
    scriptSigAsm: '',
    witness: [],
    raw: {},
    ...overrides,
  };
}

describe('Bitcoin observable script control', () => {
  it('validates a P2PKH address while keeping controller identity unknown', () => {
    const script = Buffer.from(`76a914${'11'.repeat(20)}88ac`, 'hex');
    const result = analyzeBitcoinScriptControl(output(script, 'p2pkh'));

    expect(result).toMatchObject({
      scriptClass: 'P2PKH',
      addressMatch: { state: 'known', value: true },
      spendConditionVisibility: 'FULLY_VISIBLE',
      signatureRequirement: { state: 'known', value: 'SINGLE_KEY' },
      hashPredicatePresent: { state: 'known', value: true },
      controllerIdentity: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      scriptConditionsComplete: { state: 'known', value: true },
    });
  });

  it('preserves hidden P2WSH conditions as Unknown until spend-time reveal', () => {
    const script = Buffer.from(`0020${'22'.repeat(32)}`, 'hex');
    const result = analyzeBitcoinScriptControl(output(script, 'v0_p2wsh'));

    expect(result).toMatchObject({
      scriptClass: 'P2WSH',
      spendConditionVisibility: 'HASH_COMMITTED_HIDDEN',
      signatureRequirement: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      multisig: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      scriptConditionsComplete: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
  });

  it('verifies a revealed P2WSH 2-of-3 multisig and absolute timelock', () => {
    const publicKeys = [2, 3, 4].map((fill) => Uint8Array.from([0x02, ...Buffer.alloc(32, fill)]));
    const witnessScript = compile([
      scriptNumber.encode(840_000),
      OPS.OP_CHECKLOCKTIMEVERIFY,
      OPS.OP_DROP,
      OPS.OP_2,
      ...publicKeys,
      OPS.OP_3,
      OPS.OP_CHECKMULTISIG,
    ]);
    const script = compile([OPS.OP_0, sha256(witnessScript)]);
    const result = analyzeBitcoinScriptControl(
      output(script, 'v0_p2wsh'),
      input({ witness: ['', '30', '31', hex(witnessScript)] }),
    );

    expect(result).toMatchObject({
      spendConditionVisibility: 'REVEALED_AND_COMMITMENT_VERIFIED',
      signatureRequirement: { state: 'known', value: 'MULTISIG' },
      multisig: { state: 'known', value: { threshold: 2, signerCount: 3 } },
      absoluteTimelocks: [{ kind: 'ABSOLUTE_HEIGHT', value: '840000', encodedValue: '840000' }],
      revealedScript: { state: 'known', value: hex(witnessScript) },
    });
  });

  it('verifies a nested P2SH-P2WPKH reveal without inventing an entity', () => {
    const redeemScript = Buffer.from(`0014${'33'.repeat(20)}`, 'hex');
    const script = compile([OPS.OP_HASH160, hash160(redeemScript), OPS.OP_EQUAL]);
    const scriptSig = compile([redeemScript]);
    const result = analyzeBitcoinScriptControl(
      output(script, 'p2sh'),
      input({ scriptSig: hex(scriptSig), witness: ['30', `02${'44'.repeat(32)}`] }),
    );

    expect(result).toMatchObject({
      scriptClass: 'P2SH',
      spendConditionVisibility: 'REVEALED_AND_COMMITMENT_VERIFIED',
      signatureRequirement: { state: 'known', value: 'SINGLE_KEY' },
      hashPredicatePresent: { state: 'known', value: true },
      controllerIdentity: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
  });

  it('distinguishes hidden, key-path, and script-path Taproot observations', () => {
    const script = Buffer.from(`5120${'55'.repeat(32)}`, 'hex');
    const locked = analyzeBitcoinScriptControl(output(script, 'v1_p2tr'));
    const keyPath = analyzeBitcoinScriptControl(
      output(script, 'v1_p2tr'),
      input({ witness: ['66'.repeat(64)] }),
    );
    const tapscript = compile([OPS.OP_10, OPS.OP_CHECKSEQUENCEVERIFY, OPS.OP_DROP, OPS.OP_TRUE]);
    const controlBlock = `c0${'77'.repeat(32)}`;
    const scriptPath = analyzeBitcoinScriptControl(
      output(script, 'v1_p2tr'),
      input({ witness: ['30', hex(tapscript), controlBlock] }),
    );

    expect(locked).toMatchObject({
      spendConditionVisibility: 'TAPROOT_OUTPUT_KEY_ONLY',
      taprootSpendPath: { state: 'unknown' },
    });
    expect(keyPath).toMatchObject({
      spendConditionVisibility: 'TAPROOT_SPEND_OBSERVED',
      taprootSpendPath: { state: 'known', value: 'KEY_PATH' },
    });
    expect(scriptPath).toMatchObject({
      taprootSpendPath: { state: 'known', value: 'SCRIPT_PATH' },
      relativeTimelocks: [{ kind: 'RELATIVE_BLOCKS', value: '10' }],
      scriptConditionsComplete: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
  });

  it('rejects provider script-type and address commitment mismatches', () => {
    const p2pkh = Buffer.from(`76a914${'88'.repeat(20)}88ac`, 'hex');
    expect(() => analyzeBitcoinScriptControl(output(p2pkh, 'p2sh'))).toThrow(
      /conflicts with decoded class/,
    );

    const mismatched = output(p2pkh, 'p2pkh');
    const other = Buffer.from(`76a914${'99'.repeat(20)}88ac`, 'hex');
    expect(() =>
      analyzeBitcoinScriptControl({ ...mismatched, address: fromOutputScript(other, bitcoin) }),
    ).toThrow(/does not commit/);
  });
});
