import { describe, expect, it } from 'vitest';

import { buildActionTransactionSchedule, loadActionScheduleConfig } from './action-schedule.js';

const now = '2026-08-12T00:00:00.000Z';
const env = { POSTGRES_URL: 'postgresql://zerotrace:secret@database.example/zerotrace' };

describe('Action Semantics transaction schedules', () => {
  it.each([
    ['ethereum-mainnet', `0x${'AB'.repeat(32)}`, `0x${'ab'.repeat(32)}`, 'EVM', 'eip155:1'],
    ['bitcoin-mainnet', 'CD'.repeat(32), 'cd'.repeat(32), 'BITCOIN', 'bitcoin-mainnet'],
    [
      'solana-mainnet',
      '4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9',
      '4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9',
      'SOLANA',
      'solana-mainnet',
    ],
  ])(
    'builds an immutable read-only %s schedule',
    (dataset, transaction, expected, ledger, chainId) => {
      const config = loadActionScheduleConfig(
        env,
        ['--dataset', dataset, '--transaction', transaction, '--block-or-slot', '42'],
        now,
      );
      const schedule = buildActionTransactionSchedule(config);
      expect(schedule).toMatchObject({
        definition: {
          captureKind: 'TRANSACTION',
          operation: 'READ_ONLY_CAPTURE',
          target: { ledger, chainId, subjectType: 'TRANSACTION', normalizedIdentifier: expected },
          parameters: { profile: 'ledger-records', blockOrSlot: '42' },
        },
        status: 'ACTIVE',
      });
    },
  );

  it('rejects unsupported datasets, old schedules, and write-like arguments', () => {
    expect(() =>
      loadActionScheduleConfig(
        env,
        ['--dataset', 'unknown', '--transaction', 'x', '--block-or-slot', '1'],
        now,
      ),
    ).toThrow('supported SQD mainnet');
    expect(() =>
      loadActionScheduleConfig(
        env,
        [
          '--dataset',
          'ethereum-mainnet',
          '--transaction',
          `0x${'11'.repeat(32)}`,
          '--block-or-slot',
          '1',
          '--at',
          '2026-08-11T00:00:00Z',
        ],
        now,
      ),
    ).toThrow('may not be earlier');
    expect(() => loadActionScheduleConfig(env, ['--private-key', 'secret'], now)).toThrow(
      'Unknown action schedule argument',
    );
  });
});
