import { describe, expect, it } from 'vitest';

import {
  EvmClaimBurnConservationSchema,
  knownValue,
  type AnalysisMetadata,
  type EvmClaimTransferObservation,
} from '@zerotrace/schemas';

import { deriveErc20BurnActions, EVM_ZERO_ADDRESS } from './burn.js';
import { auditClaims } from './index.js';

const blockHash = `0x${'a'.repeat(64)}`;
const parentBlockHash = `0x${'b'.repeat(64)}`;
const tokenAddress = `0x${'1'.repeat(40)}`;
const burner = `0x${'2'.repeat(40)}`;

function metadata(overrides: Partial<AnalysisMetadata> = {}): AnalysisMetadata {
  return {
    snapshot: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      blockNumber: '100',
      blockHash,
      parentBlockHash,
      finality: 'finalized',
      blockTimestamp: '2026-08-10T00:00:00.000Z',
      capturedAt: '2026-08-10T00:00:01.000Z',
      providerVersions: { fixture: '1' },
      adapterVersions: { evm: '1' },
      configHash: 'c'.repeat(64),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-v1',
    },
    dataCoverage: 1,
    sourceCoverage: 0.5,
    historyCoverage: 1,
    simulationCoverage: 0,
    freshness: '2026-08-10T00:00:00.000Z',
    sourceSet: ['fixture'],
    modelVersion: 'erc20-burn-conservation-v1.0.0',
    confidence: 0.98,
    evidenceIds: [
      'supply-before',
      'supply-after',
      'block-query',
      'mint-log',
      'burn-log-a',
      'burn-log-b',
    ],
    ...overrides,
  };
}

function transfer(
  id: string,
  from: string,
  to: string,
  amount: string,
  logIndex: string,
): EvmClaimTransferObservation {
  return {
    id,
    from,
    to,
    amount,
    observedAt: '2026-08-10T00:00:00.000Z',
    transactionId: `0x${logIndex.padStart(64, '0')}`,
    evidenceIds: [`${id}-log`],
    blockNumber: '100',
    blockHash,
    transactionIndex: logIndex,
    logIndex,
  };
}

function input(transfers: EvmClaimTransferObservation[], totalSupplyAfter: string) {
  const evidenceIds = [
    'supply-before',
    'supply-after',
    'block-query',
    ...transfers.flatMap((item) => item.evidenceIds),
  ];
  return {
    tokenAddress,
    blockNumber: '100',
    blockHash,
    parentBlockNumber: '99',
    parentBlockHash,
    totalSupplyBefore: '1000',
    totalSupplyAfter,
    transfers,
    supplyEvidenceIds: ['supply-before', 'supply-after'],
    coverageEvidenceIds: ['block-query'],
    metadata: metadata({ evidenceIds }),
  };
}

describe('ERC-20 burn conservation', () => {
  it('derives burn actions only when supply change matches every non-zero mint/burn event', () => {
    const mint = transfer('mint', EVM_ZERO_ADDRESS, `0x${'3'.repeat(40)}`, '100', '1');
    const burnA = transfer('burn-a', burner, EVM_ZERO_ADDRESS, '40', '2');
    const burnB = transfer('burn-b', `0x${'4'.repeat(40)}`, EVM_ZERO_ADDRESS, '60', '3');
    const ordinary = transfer('ordinary', `0x${'5'.repeat(40)}`, `0x${'6'.repeat(40)}`, '7', '4');
    const result = deriveErc20BurnActions(input([mint, burnA, burnB, ordinary], '1000'));

    expect(result).toMatchObject({
      status: 'VERIFIED',
      mintedAmount: '100',
      burnedAmount: '100',
      supplyDelta: '0',
      eventNetSupplyDelta: '0',
      expectedSupplyAfter: '1000',
      candidateBurnTransferIds: ['burn-a', 'burn-b'],
    });
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      id: expect.stringMatching(/^cba_[0-9a-f]{24}$/),
      type: 'BURN',
      actor: burner,
      amount: '40',
      transferIds: ['burn-a'],
      path: [burner, EVM_ZERO_ADDRESS],
    });
    expect(result.actions[0]?.evidenceIds).toEqual(
      expect.arrayContaining([
        'supply-before',
        'supply-after',
        'block-query',
        'mint-log',
        'burn-a-log',
        'burn-b-log',
      ]),
    );
    expect(result.actions[0]?.evidenceIds).not.toContain('ordinary-log');
  });

  it('withholds every action when a zero-address Transfer is not conserved by totalSupply', () => {
    const burn = transfer('burn-a', burner, EVM_ZERO_ADDRESS, '100', '1');
    const result = deriveErc20BurnActions(input([burn], '1000'));

    expect(result).toMatchObject({
      status: 'CONTRADICTED',
      burnedAmount: '100',
      supplyDelta: '0',
      eventNetSupplyDelta: '-100',
      expectedSupplyAfter: '900',
      actions: [],
    });
  });

  it('returns not-applicable rather than a fake burn when supply is stable and no burn event exists', () => {
    const result = deriveErc20BurnActions(
      input([transfer('ordinary', `0x${'5'.repeat(40)}`, `0x${'6'.repeat(40)}`, '7', '1')], '1000'),
    );
    expect(result).toMatchObject({
      status: 'NOT_APPLICABLE',
      burnedAmount: '0',
      actions: [],
    });
  });

  it('feeds a conserved wallet-to-zero path into Claim Audit without calling movable custody a burn', () => {
    const burn = transfer('burn-a', burner, EVM_ZERO_ADDRESS, '100', '1');
    const derivation = deriveErc20BurnActions(input([burn], '900'));
    const deposit = {
      id: 'deposit',
      from: `0x${'7'.repeat(40)}`,
      to: burner,
      amount: '100',
      observedAt: '2026-08-09T00:00:00.000Z',
      transactionId: `0x${'8'.repeat(64)}`,
      evidenceIds: ['deposit-log'],
    };
    const report = auditClaims({
      baseAmount: knownValue('100'),
      claims: [
        {
          id: 'burn-claim',
          assetId: `eip155:56:erc20:${tokenAddress}`,
          sourceAddress: deposit.from,
          destinationAddress: burner,
          role: 'BUYBACK_BURN',
          expectedAction: 'BURN',
          expectedShareBps: '10000',
          window: { from: '2026-08-09T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z' },
          claimEvidenceIds: ['claim-evidence'],
        },
      ],
      transfers: [deposit, burn],
      actions: derivation.actions,
      custody: [
        {
          address: burner,
          kind: 'EOA',
          canMoveFunds: knownValue(true),
          evidenceIds: ['custody-evidence'],
        },
      ],
      metadata: metadata({
        sourceCoverage: 1,
        evidenceIds: [
          ...derivation.metadata.evidenceIds,
          'deposit-log',
          'claim-evidence',
          'custody-evidence',
        ],
      }),
    });

    expect(report.items[0]).toMatchObject({
      status: 'VERIFIED',
      actualReceivedAmount: { state: 'known', value: '100' },
      actualActionAmount: { state: 'known', value: '100' },
    });
    expect(report.items[0]?.findings.map((finding) => finding.code)).not.toContain(
      'CLAIMED_BURN_IS_MOVABLE_CUSTODY',
    );
  });

  it('rejects incomplete coverage, cross-block transfers, and non-zero zero-to-zero events', () => {
    const burn = transfer('burn-a', burner, EVM_ZERO_ADDRESS, '100', '1');
    expect(() =>
      deriveErc20BurnActions({
        ...input([burn], '900'),
        metadata: metadata({ historyCoverage: 0 }),
      }),
    ).toThrow('complete target-block data and history');
    expect(() => deriveErc20BurnActions(input([{ ...burn, blockNumber: '99' }], '900'))).toThrow(
      'outside the target block',
    );
    expect(() =>
      deriveErc20BurnActions(
        input([transfer('invalid', EVM_ZERO_ADDRESS, EVM_ZERO_ADDRESS, '1', '2')], '1000'),
      ),
    ).toThrow('zero-to-zero');
  });

  it('rejects corrupted replay lineage, Evidence, and duplicate transfer mappings', () => {
    const burnA = transfer('burn-a', burner, EVM_ZERO_ADDRESS, '40', '1');
    const burnB = transfer('burn-b', `0x${'4'.repeat(40)}`, EVM_ZERO_ADDRESS, '60', '2');
    const derivation = deriveErc20BurnActions(input([burnA, burnB], '900'));
    const terminalEvidenceId = `ev_${'1'.repeat(24)}`;
    const report = {
      ...derivation,
      terminalEvidenceId,
      metadata: {
        ...derivation.metadata,
        evidenceIds: [...derivation.metadata.evidenceIds, terminalEvidenceId],
      },
    };

    expect(() =>
      EvmClaimBurnConservationSchema.parse({
        ...report,
        actions: derivation.actions.map((action) => ({
          ...action,
          transferIds: [burnA.id],
        })),
      }),
    ).toThrow('one-to-one');
    expect(() =>
      EvmClaimBurnConservationSchema.parse({
        ...report,
        metadata: {
          ...report.metadata,
          snapshot: { ...report.metadata.snapshot, finality: 'latest' },
        },
      }),
    ).toThrow('exact target and parent block');
    expect(() =>
      EvmClaimBurnConservationSchema.parse({
        ...report,
        actions: derivation.actions.map((action) => ({
          ...action,
          evidenceIds: [...action.evidenceIds, terminalEvidenceId],
        })),
      }),
    ).toThrow('one-to-one');
  });
});
