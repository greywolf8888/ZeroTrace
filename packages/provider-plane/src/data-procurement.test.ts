import { describe, expect, it } from 'vitest';

import { parseProcurementState, parseSpendPolicy } from './data-procurement.js';

describe('durable data-procurement parsing', () => {
  it('normalizes persisted state without coercing unknown cost to zero', () => {
    const state = parseProcurementState({
      revision: 0,
      remainingMicrousd: '0',
      accounts: {
        free: {
          providerIds: ['fxembed', 'fxembed'],
          allowedCostKind: 'FREE_ONLY',
          quotaRemaining: '100',
          costEvidence: 'rights-and-quota-v1',
          enabled: true,
          rightsApproved: true,
        },
      },
      tickets: {},
      blocked: false,
    });
    expect(state.accounts.free?.providerIds).toEqual(['fxembed']);
    expect(state.remainingMicrousd).toBe('0');
  });

  it('rejects paid providers without explicit paid consent', () => {
    expect(() =>
      parseSpendPolicy({
        version: 'v1',
        paidAllowed: false,
        approvedProviderIds: ['x_official'],
      }),
    ).toThrow('PAID_PROVIDER_WITHOUT_CONSENT');
  });

  it('rejects unsafe persisted keys and malformed integer amounts', () => {
    expect(() =>
      parseProcurementState({
        revision: 0,
        remainingMicrousd: 'unknown',
        accounts: {},
        tickets: {},
        blocked: false,
      }),
    ).toThrow('INVALID_NONNEGATIVE_INTEGER');
    expect(() =>
      parseProcurementState({
        revision: 0,
        remainingMicrousd: '0',
        accounts: JSON.parse('{"__proto__":{}}') as unknown,
        tickets: {},
        blocked: false,
      }),
    ).toThrow();
  });
});
