import { describe, expect, it } from 'vitest';

import { type AnalysisMetadata, type ClaimTransferObservation } from '@zerotrace/schemas';

import { summarizeClaimAddressFlows } from './flow.js';

const metadata: AnalysisMetadata = {
  snapshot: {
    ledger: 'EVM',
    chainId: 'eip155:56',
    blockNumber: '115107095',
    blockHash: `0x${'a'.repeat(64)}`,
    finality: 'finalized',
    blockTimestamp: '2026-08-10T10:45:29.000Z',
    capturedAt: '2026-08-10T10:45:31.000Z',
    providerVersions: { sqd: 'portal-v1' },
    adapterVersions: { claimEvm: 'claim-evm-transfer-v1.0.0' },
    configHash: 'b'.repeat(64),
    entityModelVersion: 'entity-resolution-v0.1.0',
    labelSnapshot: 'labels-empty-v1',
  },
  dataCoverage: 1,
  sourceCoverage: 1,
  historyCoverage: 1,
  simulationCoverage: 0,
  freshness: '2026-08-10T10:45:29.000Z',
  sourceSet: ['sqd-bnb-mainnet'],
  modelVersion: 'claim-evm-transfer-v1.0.0',
  confidence: 0.95,
  evidenceIds: ['ev_snapshot'],
};

const window = {
  from: '2026-08-02T00:00:00.000Z',
  to: '2026-08-10T10:45:29.000Z',
};

function transfer(
  id: string,
  from: string,
  to: string,
  amount: string,
  observedAt: string,
): ClaimTransferObservation {
  return {
    id,
    from,
    to,
    amount,
    observedAt,
    transactionId: `0x${id.padEnd(64, '0')}`,
    evidenceIds: [`ev_${id}`],
  };
}

describe('claim address flow summary', () => {
  it('derives deterministic observed flow without inventing terminal-action semantics', () => {
    const result = summarizeClaimAddressFlows({
      address: '0xPension',
      window,
      shareUnit: '1000000',
      metadata,
      transfers: [
        transfer('one', '0xMemberA', '0xpension', '1000000', '2026-08-02T01:00:00.000Z'),
        transfer('two', '0xMemberB', '0xPENSION', '1500000', '2026-08-03T01:00:00.000Z'),
        transfer('three', '0xPENSION', '0xDispatcher', '100000', '2026-08-04T01:00:00.000Z'),
        transfer('self', '0xpension', '0xPENSION', '7', '2026-08-05T01:00:00.000Z'),
        transfer('other', '0xMemberC', '0xElsewhere', '999', '2026-08-06T01:00:00.000Z'),
      ],
    });

    expect(result.inflow).toMatchObject({
      observedAmount: '2500000',
      actualAmount: { state: 'known', value: '2500000' },
      transferCount: 2,
      uniqueCounterparties: 2,
      firstObservedAt: { state: 'known', value: '2026-08-02T01:00:00.000Z' },
      lastObservedAt: { state: 'known', value: '2026-08-03T01:00:00.000Z' },
    });
    expect(result.outflow).toMatchObject({
      observedAmount: '100000',
      actualAmount: { state: 'known', value: '100000' },
      transferCount: 1,
      uniqueCounterparties: 1,
    });
    expect(result.shareUnitAssessment).toEqual({
      unit: '1000000',
      observedDeposits: 2,
      exactMultipleDeposits: 1,
      nonMultipleDeposits: 1,
      exactMultipleCoverage: { state: 'known', value: 0.5 },
    });
    expect(result).toMatchObject({
      selfTransferCount: 1,
      selfTransferObservedAmount: '7',
    });
    expect(
      result.topCounterparties.map(({ direction, address, observedAmount }) => ({
        direction,
        address,
        observedAmount,
      })),
    ).toEqual([
      { direction: 'INFLOW', address: '0xmemberb', observedAmount: '1500000' },
      { direction: 'INFLOW', address: '0xmembera', observedAmount: '1000000' },
      { direction: 'OUTFLOW', address: '0xdispatcher', observedAmount: '100000' },
    ]);
    expect(result.metadata.modelVersion).toBe('claim-flow-summary-v1.0.0');
    expect(result.metadata.evidenceIds).toEqual(
      ['ev_one', 'ev_self', 'ev_snapshot', 'ev_three', 'ev_two'].sort(),
    );
  });

  it('keeps absence and actual totals Unknown when independent source coverage is incomplete', () => {
    const result = summarizeClaimAddressFlows({
      address: '0xpension',
      window,
      shareUnit: '1000000',
      metadata: { ...metadata, sourceCoverage: 0.5 },
      transfers: [],
    });

    expect(result.inflow).toMatchObject({
      observedAmount: '0',
      actualAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      transferCount: 0,
      firstObservedAt: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      lastObservedAt: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(result.inflow.actualAmount).not.toEqual({ state: 'known', value: '0' });
    expect(result.shareUnitAssessment?.exactMultipleCoverage).toEqual({
      state: 'unknown',
      reason: 'NOT_APPLICABLE',
      detail: 'No observed deposits are available for this ratio.',
    });
    expect(result.topCounterparties).toEqual([]);
  });

  it('filters the requested window and preserves case-sensitive address identity', () => {
    const result = summarizeClaimAddressFlows({
      address: 'Vault',
      comparison: 'CASE_SENSITIVE',
      window,
      metadata,
      transfers: [
        transfer('before', 'member', 'Vault', '1', '2026-08-01T23:59:59.000Z'),
        transfer('case', 'member', 'vault', '2', '2026-08-03T00:00:00.000Z'),
        transfer('match', 'member', 'Vault', '3', '2026-08-04T00:00:00.000Z'),
      ],
    });

    expect(result.inflow).toMatchObject({ observedAmount: '3', transferCount: 1 });
    expect(result.metadata.evidenceIds).toEqual(['ev_match', 'ev_snapshot'].sort());
  });

  it('rejects duplicate observations and data beyond the replay Snapshot', () => {
    const duplicate = transfer('same', 'member', 'vault', '1', '2026-08-03T00:00:00.000Z');
    expect(() =>
      summarizeClaimAddressFlows({
        address: 'vault',
        window,
        metadata,
        transfers: [duplicate, duplicate],
      }),
    ).toThrow('ids must be unique');
    expect(() =>
      summarizeClaimAddressFlows({
        address: 'vault',
        window,
        metadata,
        transfers: [transfer('future', 'member', 'vault', '1', '2026-08-10T10:45:30.000Z')],
      }),
    ).toThrow('must not occur after the Snapshot');
    expect(() =>
      summarizeClaimAddressFlows({
        address: 'vault',
        window: { ...window, to: '2026-08-10T10:45:30.000Z' },
        metadata,
        transfers: [],
      }),
    ).toThrow('must not extend beyond the Snapshot');
  });
});
