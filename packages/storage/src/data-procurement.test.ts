import { describe, expect, it, vi } from 'vitest';

import type { ProcurementState, Quote, SpendPolicy } from '@zerotrace/provider-plane';

import {
  DataProcurementStorageError,
  PostgresDataProcurementRepository,
  type ProcurementPool,
} from './data-procurement.js';

const policy: SpendPolicy = {
  version: 'data-policy-v11.0',
  paidAllowed: false,
  approvedProviderIds: [],
};

function state(): ProcurementState {
  return {
    revision: 0,
    remainingMicrousd: '0',
    accounts: {
      free: {
        providerIds: ['fxembed'],
        allowedCostKind: 'FREE_ONLY',
        quotaRemaining: '100',
        costEvidence: 'rights-and-quota-v1',
        enabled: true,
        rightsApproved: true,
      },
    },
    tickets: {},
    blocked: false,
  };
}

const quote: Quote = {
  requestId: 'request-1',
  fingerprint: 'search-plan-v1',
  providerId: 'fxembed',
  accountId: 'free',
  costKind: 'VERIFIED_FREE',
  maxUnits: '10',
  maxMicrousd: '0',
  evidence: 'rights-and-quota-v1',
  expiresAt: 200,
};

function row(current: ProcurementState) {
  return {
    scope_id: 'global',
    policy,
    state: current,
    revision: current.revision,
    updated_at: '2026-08-31T00:00:00.000Z',
  };
}

function transactionalPool(current: ProcurementState) {
  const statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  const client = {
    query: vi.fn(async (text: string, values?: readonly unknown[]) => {
      statements.push({ text, ...(values === undefined ? {} : { values }) });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [], rowCount: 0 };
      if (text.includes('FOR UPDATE')) return { rows: [row(current)], rowCount: 1 };
      if (text.includes('UPDATE data_procurement_ledgers')) {
        const next = JSON.parse(String(values?.[1])) as ProcurementState;
        current = next;
        return { rows: [row(next)], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    }),
    release: vi.fn(),
  };
  const pool: ProcurementPool = {
    query: vi.fn(),
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  };
  return { pool, client, statements };
}

describe('PostgreSQL data-procurement ledger', () => {
  it('reserves free quota under one row lock and revision fence', async () => {
    const fixture = transactionalPool(state());
    const repository = PostgresDataProcurementRepository.fromPool(fixture.pool);
    const result = await repository.reserve('global', quote, 100);
    expect(result.state.revision).toBe(1);
    expect(result.state.accounts.free?.quotaRemaining).toBe('90');
    expect(fixture.statements.some((item) => item.text.includes('FOR UPDATE'))).toBe(true);
    expect(
      fixture.statements.some((item) => item.text.includes('scope_id = $1 AND revision = $4')),
    ).toBe(true);
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it('does not consume quota or write a second revision for an idempotent retry', async () => {
    const first = state();
    first.revision = 1;
    first.accounts.free!.quotaRemaining = '90';
    first.tickets[quote.requestId] = {
      ...quote,
      policyVersion: policy.version,
      state: 'RESERVED',
    };
    const fixture = transactionalPool(first);
    const repository = PostgresDataProcurementRepository.fromPool(fixture.pool);
    const result = await repository.reserve('global', quote, 100);
    expect(result.state.revision).toBe(1);
    expect(fixture.statements.some((item) => item.text.includes('UPDATE data_procurement'))).toBe(
      false,
    );
  });

  it('fails closed on a stored revision mismatch', async () => {
    const bad = row(state());
    bad.revision = 2;
    const pool: ProcurementPool = {
      query: vi.fn(async () => ({ rows: [bad], rowCount: 1 })),
      connect: vi.fn(),
      end: vi.fn(async () => undefined),
    };
    const repository = PostgresDataProcurementRepository.fromPool(pool);
    await expect(repository.get('global')).rejects.toBeInstanceOf(DataProcurementStorageError);
    await expect(repository.get('global')).rejects.toMatchObject({
      code: 'DATA_PROCUREMENT_CONFLICT',
    });
  });
});
