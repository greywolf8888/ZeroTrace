import { describe, expect, it } from 'vitest';

import { knownValue, type AnalysisMetadata } from '@zerotrace/schemas';

import {
  auditClaims,
  type AssetTransferObservation,
  type ClaimAuditInput,
  type ClaimRule,
} from './index.js';

const metadata: AnalysisMetadata = {
  snapshot: {
    ledger: 'EVM',
    chainId: 'eip155:56',
    blockNumber: '100',
    blockHash: `0x${'a'.repeat(64)}`,
    finality: 'finalized',
    capturedAt: '2026-08-10T00:00:00.000Z',
    providerVersions: { fixture: '1' },
    adapterVersions: { fixture: '1' },
    configHash: 'b'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-fixture-v1',
  },
  dataCoverage: 1,
  sourceCoverage: 1,
  historyCoverage: 1,
  simulationCoverage: 0,
  freshness: '2026-08-10T00:00:00.000Z',
  sourceSet: ['fixture-chain'],
  modelVersion: 'fixture-model',
  confidence: 1,
  evidenceIds: ['ev_snapshot'],
};

const window = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z' };

function claim(overrides: Partial<ClaimRule> & Pick<ClaimRule, 'id'>): ClaimRule {
  return {
    assetId: 'eip155:56:token',
    sourceAddress: 'tax',
    destinationAddress: overrides.id,
    role: 'OTHER',
    expectedAction: 'DISTRIBUTE',
    expectedShareBps: '10000',
    window,
    claimEvidenceIds: ['ev_claim'],
    ...overrides,
  };
}

function transfer(
  id: string,
  from: string,
  to: string,
  amount: string,
  observedAt = '2026-08-03T00:00:00.000Z',
): AssetTransferObservation {
  return {
    id,
    from,
    to,
    amount,
    observedAt,
    transactionId: `tx-${id}`,
    evidenceIds: [`ev_${id}`],
  };
}

function run(overrides: Partial<ClaimAuditInput>): ReturnType<typeof auditClaims> {
  return auditClaims({
    baseAmount: knownValue('1000'),
    claims: [],
    transfers: [],
    actions: [],
    custody: [],
    metadata,
    ...overrides,
  });
}

describe('deterministic claim audit', () => {
  it('verifies an FFT-style 20/40/40 allocation only when the terminal actions are evidenced', () => {
    const result = run({
      claims: [
        claim({
          id: 'community',
          role: 'COMMUNITY_FUND',
          expectedShareBps: '2000',
        }),
        claim({
          id: 'burn',
          role: 'BUYBACK_BURN',
          expectedAction: 'BURN',
          expectedShareBps: '4000',
        }),
        claim({
          id: 'liquidity',
          role: 'BUYBACK_LIQUIDITY',
          expectedAction: 'ADD_LIQUIDITY',
          expectedShareBps: '4000',
        }),
      ],
      transfers: [
        transfer('community', 'tax', 'community', '200'),
        transfer('burn', 'tax', 'burn', '400'),
        transfer('liquidity', 'tax', 'liquidity', '400'),
      ],
      actions: [
        {
          id: 'add-lp',
          type: 'ADD_LIQUIDITY',
          actor: 'liquidity',
          amount: '400',
          observedAt: '2026-08-03T01:00:00.000Z',
          transferIds: [],
          path: ['liquidity'],
          liquidityControl: 'LP_EXTERNAL',
          evidenceIds: ['ev_add_lp'],
        },
      ],
      custody: [
        {
          address: 'burn',
          kind: 'IRRECOVERABLE_BURN',
          canMoveFunds: knownValue(false),
          evidenceIds: ['ev_dead'],
        },
      ],
    });

    expect(result.status).toBe('VERIFIED');
    expect(result.items.map((item) => item.status)).toEqual(['VERIFIED', 'VERIFIED', 'VERIFIED']);
    expect(result.items[1]?.verifiedPercent).toEqual({ state: 'known', value: '100' });
  });

  it('distinguishes a material shortfall from the versioned 0.5%/5% tolerances', () => {
    const result = run({
      claims: [claim({ id: 'community', expectedShareBps: '4000' })],
      transfers: [transfer('short', 'tax', 'community', '300')],
    });
    expect(result.items[0]).toMatchObject({
      status: 'CONTRADICTED',
      expectedAmount: { state: 'known', value: '400' },
      actualReceivedAmount: { state: 'known', value: '300' },
      deviationBps: { state: 'known', value: '2500' },
    });
  });

  it('does not reinterpret a movable Safe or EOA wallet as an irreversible burn', () => {
    const result = run({
      claims: [
        claim({
          id: 'burn-safe',
          expectedAction: 'BURN',
          role: 'BUYBACK_BURN',
          expectedShareBps: '4000',
        }),
      ],
      transfers: [transfer('deposit', 'tax', 'burn-safe', '400')],
      custody: [
        {
          address: 'burn-safe',
          kind: 'SAFE_MULTISIG',
          canMoveFunds: knownValue(true),
          threshold: 4,
          ownerCount: 6,
          evidenceIds: ['ev_safe'],
        },
      ],
    });
    expect(result.items[0]?.status).toBe('CONTRADICTED');
    expect(result.items[0]?.findings.map((finding) => finding.code)).toContain(
      'CLAIMED_BURN_IS_MOVABLE_CUSTODY',
    );
  });

  it('verifies a bounded multi-hop burn only when every transfer edge is supplied', () => {
    const result = run({
      claims: [
        claim({
          id: 'burn-processor',
          expectedAction: 'BURN',
          expectedShareBps: '4000',
        }),
      ],
      transfers: [
        transfer('deposit', 'tax', 'burn-processor', '400'),
        transfer('hop-1', 'burn-processor', 'relay', '400', '2026-08-03T01:00:00.000Z'),
        transfer('hop-2', 'relay', 'dead', '400', '2026-08-03T02:00:00.000Z'),
      ],
      actions: [
        {
          id: 'burn-action',
          type: 'BURN',
          actor: 'burn-processor',
          amount: '400',
          observedAt: '2026-08-03T02:00:00.000Z',
          transferIds: ['hop-1', 'hop-2'],
          path: ['burn-processor', 'relay', 'dead'],
          evidenceIds: ['ev_burn_action'],
        },
      ],
      custody: [
        {
          address: 'burn-processor',
          kind: 'EOA',
          canMoveFunds: knownValue(true),
          evidenceIds: ['ev_processor'],
        },
      ],
    });
    expect(result.items[0]?.status).toBe('VERIFIED');
    expect(result.items[0]?.actualActionAmount).toEqual({ state: 'known', value: '400' });
  });

  it('flags controller-withdrawable LP and controller-return paths', () => {
    const result = run({
      claims: [
        claim({
          id: 'lp-wallet',
          expectedAction: 'ADD_LIQUIDITY',
          expectedShareBps: '4000',
        }),
      ],
      transfers: [
        transfer('deposit', 'tax', 'lp-wallet', '400'),
        transfer('return', 'lp-wallet', 'controller', '10', '2026-08-04T00:00:00.000Z'),
      ],
      actions: [
        {
          id: 'lp-action',
          type: 'ADD_LIQUIDITY',
          actor: 'lp-wallet',
          amount: '390',
          observedAt: '2026-08-04T00:00:00.000Z',
          transferIds: [],
          path: ['lp-wallet'],
          liquidityControl: 'LP_CONTROLLER',
          evidenceIds: ['ev_lp'],
        },
      ],
      controllerAddresses: ['controller'],
    });
    expect(result.items[0]?.status).toBe('CONTRADICTED');
    expect(result.items[0]?.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['LP_REMAINS_CONTROLLER_WITHDRAWABLE', 'FLOW_RETURNED_TO_CONTROLLER']),
    );
  });

  it('classifies a pension Safe as policy custody, measures share units, and refutes no-exit after outflow', () => {
    const result = run({
      baseAmount: knownValue('2000000'),
      claims: [
        claim({
          id: 'pension-safe',
          sourceAddress: 'members',
          destinationAddress: 'pension-safe',
          role: 'PENSION_VAULT',
          expectedAction: 'LOCK',
          expectedShareBps: '10000',
          shareUnit: '1000000',
          noExit: true,
        }),
      ],
      transfers: [
        transfer('share', 'members', 'pension-safe', '1000000'),
        transfer('off-unit', 'members', 'pension-safe', '900000'),
        transfer('payout', 'pension-safe', 'dispatcher', '100000', '2026-08-04T00:00:00.000Z'),
      ],
      custody: [
        {
          address: 'pension-safe',
          kind: 'SAFE_MULTISIG',
          canMoveFunds: knownValue(true),
          threshold: 4,
          ownerCount: 6,
          executedTransactions: 10,
          evidenceIds: ['ev_safe'],
        },
      ],
    });
    const item = result.items[0];
    expect(item?.status).toBe('CONTRADICTED');
    expect(item?.verifiedPercent).toEqual({ state: 'known', value: '0' });
    expect(item?.shareUnitAssessment).toMatchObject({
      observedDeposits: 2,
      exactMultipleDeposits: 1,
      nonMultipleDeposits: 1,
      exactMultipleCoverage: 0.5,
    });
    expect(item?.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['OUTFLOW_OBSERVED', 'POLICY_LOCK_NOT_TECHNICAL_LOCK']),
    );
  });

  it('keeps complete actual amounts Unknown while retaining observed lower bounds', () => {
    const result = run({
      claims: [claim({ id: 'community', expectedShareBps: '2000' })],
      transfers: [transfer('partial', 'tax', 'community', '200')],
      metadata: { ...metadata, historyCoverage: 0.5 },
    });
    expect(result.items[0]).toMatchObject({
      status: 'INSUFFICIENT_DATA',
      observedReceivedAmount: '200',
      actualReceivedAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(result.items[0]?.actualReceivedAmount).not.toEqual({ state: 'known', value: '0' });
  });

  it('rejects unanchored inference, duplicate ids, and unsafe tolerance policies', () => {
    expect(() =>
      run({
        claims: [claim({ id: 'one' })],
        metadata: { ...metadata, snapshot: null },
      }),
    ).toThrow('Snapshot');
    expect(() => run({ claims: [claim({ id: 'same' }), claim({ id: 'same' })] })).toThrow('unique');
    expect(() =>
      run({
        claims: [claim({ id: 'one' })],
        policy: { verifiedAmountToleranceBps: '501', partialAmountToleranceBps: '500' },
      }),
    ).toThrow('may not exceed');
  });
});
