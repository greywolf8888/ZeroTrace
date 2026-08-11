import { describe, expect, it } from 'vitest';

import type {
  BitcoinTransactionInput,
  BitcoinTransactionOutput,
  BitcoinTransactionRecord,
} from '@zerotrace/chain-adapters';

import { analyzeBitcoinTransactionEntity } from './bitcoin-transaction-entity.js';

function output(
  valueSats: string,
  address: string | undefined,
  scriptType = 'v0_p2wpkh',
): BitcoinTransactionOutput {
  return {
    valueSats,
    scriptPubKey: scriptType === 'op_return' ? '6a00' : `0014${'1'.repeat(40)}`,
    scriptType,
    ...(address === undefined ? {} : { address }),
    raw: {},
  };
}

function input(
  index: number,
  valueSats: string,
  address: string | undefined,
  scriptType = 'v0_p2wpkh',
): BitcoinTransactionInput {
  return {
    coinbase: false,
    previousTxid: String(index + 1).padStart(64, '0'),
    previousVout: '0',
    sequence: '4294967295',
    scriptSig: '',
    scriptSigAsm: '',
    witness: [],
    previousOutput: output(valueSats, address, scriptType),
    raw: {},
  };
}

function transaction(options: {
  inputs: BitcoinTransactionInput[];
  outputs: BitcoinTransactionOutput[];
  feeSats: string;
  weight?: string;
}): BitcoinTransactionRecord {
  return {
    txid: 'a'.repeat(64),
    version: 2,
    locktime: '0',
    size: '100',
    weight: options.weight ?? '400',
    feeSats: options.feeSats,
    inputCount: options.inputs.length,
    inputs: options.inputs,
    outputs: options.outputs,
    status: { confirmed: true, blockHeight: '1', blockHash: 'b'.repeat(64), blockTime: '1' },
    raw: {},
  };
}

describe('Bitcoin transaction entity analysis', () => {
  it('emits common-input and change candidates without permitting an ownership merge', () => {
    const result = analyzeBitcoinTransactionEntity(
      transaction({
        inputs: [input(0, '6000', 'bc1qinputa'), input(1, '5000', 'bc1qinputb')],
        outputs: [output('7000', 'bc1qrecipient'), output('3000', 'bc1qcandidate')],
        feeSats: '1000',
      }),
    );

    expect(result).toMatchObject({
      inputAddressCoverage: 1,
      inputValueSats: { state: 'known', value: '11000' },
      outputValueSats: '10000',
      feeReconciles: { state: 'known', value: true },
      feeRateSatPerVbyte: { state: 'known', value: '10' },
      structuralPattern: 'NO_STRONG_PATTERN_OBSERVED',
      commonInputHeuristic: { state: 'known', value: true },
      commonInputOwnershipCandidate: {
        state: 'known',
        value: ['bc1qinputa', 'bc1qinputb'],
      },
      automaticOwnershipMergeAllowed: false,
      selectedChangeOutput: { state: 'unknown', reason: 'PRECISION_UNSAFE' },
      ownershipConclusion: { state: 'unknown', reason: 'PRECISION_UNSAFE' },
    });
    expect(result.suppressionReasons).toEqual([
      'PAYJOIN_NOT_EXCLUDABLE',
      'SERVICE_ATTRIBUTION_UNQUERIED',
    ]);
    expect(result.changeCandidates.map((candidate) => candidate.vout)).toEqual([0, 1]);
  });

  it('detects an equal-output CoinJoin-like pattern and suppresses common-input ownership', () => {
    const result = analyzeBitcoinTransactionEntity(
      transaction({
        inputs: [
          input(0, '10000', 'bc1qparticipant1'),
          input(1, '10000', 'bc1qparticipant2'),
          input(2, '10000', 'bc1qparticipant3'),
        ],
        outputs: [
          output('9000', 'bc1qoutput1'),
          output('9000', 'bc1qoutput2'),
          output('9000', 'bc1qoutput3'),
        ],
        feeSats: '3000',
      }),
    );

    expect(result.structuralPattern).toBe('EQUAL_OUTPUT_COINJOIN_LIKE');
    expect(result.equalOutputGroups).toEqual([
      { valueSats: '9000', outputCount: 3, vouts: [0, 1, 2] },
    ]);
    expect(result.automaticOwnershipMergeAllowed).toBe(false);
    expect(result.suppressionReasons).toContain('COINJOIN_EQUAL_OUTPUT_PATTERN');
    expect(result.changeCandidates).toEqual([]);
  });

  it('separates high-output fanout or batching risk from CoinJoin classification', () => {
    const outputs = Array.from({ length: 10 }, (_, index) =>
      output(String(1000 + index), `bc1qfanout${index}`),
    );
    const result = analyzeBitcoinTransactionEntity(
      transaction({
        inputs: [input(0, '6000', 'bc1qsource1'), input(1, '5000', 'bc1qsource2')],
        outputs,
        feeSats: '955',
      }),
    );

    expect(result.structuralPattern).toBe('FANOUT_OR_BATCHING_RISK');
    expect(result.suppressionReasons).toContain('FANOUT_OR_BATCHING_PATTERN');
    expect(result.changeCandidates).toEqual([]);
    expect(result.selectedChangeOutput).toMatchObject({
      state: 'unknown',
      reason: 'PRECISION_UNSAFE',
    });
    expect(result.serviceClusterRisk).toMatchObject({ state: 'unknown', reason: 'NOT_QUERIED' });
  });

  it('keeps common-input evidence Unknown when a prevout has no address representation', () => {
    const result = analyzeBitcoinTransactionEntity(
      transaction({
        inputs: [input(0, '6000', 'bc1qsource1'), input(1, '5000', undefined, 'v0_p2wsh')],
        outputs: [output('10000', 'bc1qrecipient')],
        feeSats: '1000',
      }),
    );

    expect(result).toMatchObject({
      inputAddressCoverage: 0.5,
      structuralPattern: 'INCOMPLETE_INPUT_CONTEXT',
      commonInputHeuristic: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      commonInputOwnershipCandidate: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(result.suppressionReasons).toContain('INCOMPLETE_PREVOUT_ADDRESS_COVERAGE');
    expect(result.changeCandidates).toEqual([]);
  });

  it('treats coinbase clustering, change, and fee reconciliation as not applicable', () => {
    const coinbaseInput: BitcoinTransactionInput = {
      coinbase: true,
      sequence: '4294967295',
      scriptSig: '00',
      scriptSigAsm: 'OP_0',
      witness: [],
      raw: {},
    };
    const result = analyzeBitcoinTransactionEntity(
      transaction({
        inputs: [coinbaseInput],
        outputs: [output('5000000000', 'bc1qminer')],
        feeSats: '0',
      }),
    );

    expect(result).toMatchObject({
      coinbase: true,
      structuralPattern: 'NOT_APPLICABLE',
      inputValueSats: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      feeReconciles: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      selectedChangeOutput: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      ownershipConclusion: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    });
  });

  it('reports provider fee arithmetic conflicts and rejects impossible transaction structure', () => {
    const conflicting = analyzeBitcoinTransactionEntity(
      transaction({
        inputs: [input(0, '10000', 'bc1qsource')],
        outputs: [output('9000', 'bc1qrecipient')],
        feeSats: '999',
      }),
    );
    expect(conflicting.feeReconciles).toEqual({ state: 'known', value: false });

    expect(() =>
      analyzeBitcoinTransactionEntity(
        transaction({
          inputs: [input(0, '10000', 'bc1qsource')],
          outputs: [output('9000', 'bc1qrecipient')],
          feeSats: '1000',
          weight: '0',
        }),
      ),
    ).toThrow('weight must be positive');
  });
});
