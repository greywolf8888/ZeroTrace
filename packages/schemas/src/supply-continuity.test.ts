import { describe, expect, it } from 'vitest';

import {
  EvmSupplyContinuitySchema,
  type EvmSupplyContinuity,
  type SourceIndependenceAssessment,
} from './index.js';

const evidenceId = (digit: string) => `ev_${digit.repeat(24)}`;
const blockHash = (digit: string) => `0x${digit.repeat(64)}`;

function independence(verified = true): SourceIndependenceAssessment {
  const registryEvidenceId = evidenceId('1');
  const firstEvidenceId = evidenceId('2');
  const secondEvidenceId = evidenceId('3');
  const terminalEvidenceId = evidenceId('4');
  return {
    status: verified ? 'VERIFIED_INDEPENDENT' : 'SAME_OPERATOR',
    independence: { state: 'known', value: verified },
    requiredOperators: 2,
    observedSources: 2,
    operatorCount: verified ? 2 : 1,
    unresolvedSources: [],
    attestations: [
      {
        sourceId: 'bsc-rpc@bnb-mainnet.g.alchemy.com#1',
        hostname: 'bnb-mainnet.g.alchemy.com',
        operatorId: 'alchemy',
        operatorName: 'Alchemy',
        officialSource: 'https://www.alchemy.com/docs/reference/node-supported-chains',
        registryObservedAt: '2026-08-11T00:00:00.000Z',
        registryRevision: 'alchemy-bnb-chain-api@2026-08-11',
        evidenceId: firstEvidenceId,
      },
      {
        sourceId: 'bsc-rpc@bsc-dataseed.bnbchain.org#2',
        hostname: 'bsc-dataseed.bnbchain.org',
        operatorId: verified ? 'bnb-chain' : 'alchemy',
        operatorName: verified ? 'BNB Chain' : 'Alchemy',
        officialSource: verified
          ? 'https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/'
          : 'https://www.alchemy.com/docs/reference/node-supported-chains',
        registryObservedAt: '2026-08-11T00:00:00.000Z',
        registryRevision: verified
          ? 'bnb-chain-bsc-json-rpc-endpoints@2026-08-11'
          : 'alchemy-bnb-chain-api@2026-08-11',
        evidenceId: secondEvidenceId,
      },
    ],
    registryEvidenceId,
    terminalEvidenceId,
    evidenceIds: [registryEvidenceId, firstEvidenceId, secondEvidenceId, terminalEvidenceId],
    modelVersion: 'source-operator-registry-v1',
  };
}

function report(verified = true): EvmSupplyContinuity {
  const sourceIndependence = independence(verified);
  const segmentEvidenceId = evidenceId('5');
  const terminalEvidenceId = evidenceId('6');
  const sourceSet = ['bsc-rpc@bnb-mainnet.g.alchemy.com#1', 'bsc-rpc@bsc-dataseed.bnbchain.org#2'];
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '102',
    blockHash: blockHash('b'),
    parentBlockHash: blockHash('a'),
    finality: 'finalized' as const,
    blockTimestamp: '2026-08-11T00:00:00.000Z',
    capturedAt: '2026-08-11T00:00:01.000Z',
    providerVersions: Object.fromEntries(sourceSet.map((source) => [source, 'json-rpc'])),
    adapterVersions: { evm: '0.1.0' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'entity-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
  return {
    tokenAddress: `0x${'a'.repeat(40)}`,
    fromBlock: '101',
    toBlock: '102',
    coverageScope: 'ERC20_TOTAL_SUPPLY_EVERY_FINALIZED_BLOCK_WITH_EVENT_RECONCILIATION',
    status: verified ? 'VERIFIED_NO_CHANGE' : 'INCONCLUSIVE_SOURCE_INDEPENDENCE',
    segmentCount: 1,
    scannedBlockCount: 2,
    supplySampleCount: 3,
    initialTotalSupply: '1000',
    finalTotalSupply: '1000',
    netSupplyDelta: '0',
    supplyChangeCount: 0,
    eventConservedChangeCount: 0,
    unexplainedChangeCount: 0,
    segments: [
      {
        fromBlock: '101',
        toBlock: '102',
        sampleCount: 3,
        startTotalSupply: '1000',
        endTotalSupply: '1000',
        supplyChangeCount: 0,
        eventConservedChangeCount: 0,
        unexplainedChangeCount: 0,
        changes: [],
        terminalEvidenceId: segmentEvidenceId,
        snapshot,
        sourceSet,
      },
    ],
    sourceIndependence,
    terminalEvidenceId,
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: verified ? 1 : 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet,
      modelVersion: 'erc20-supply-continuity-v1.0.0',
      confidence: verified ? 1 : 0.5,
      evidenceIds: [segmentEvidenceId, ...sourceIndependence.evidenceIds, terminalEvidenceId],
    },
  };
}

describe('ERC-20 supply continuity schema', () => {
  it('accepts complete independently reconciled all-block coverage', () => {
    expect(EvmSupplyContinuitySchema.parse(report()).status).toBe('VERIFIED_NO_CHANGE');
  });

  it('keeps complete same-operator observations inconclusive', () => {
    expect(EvmSupplyContinuitySchema.parse(report(false)).status).toBe(
      'INCONCLUSIVE_SOURCE_INDEPENDENCE',
    );
  });

  it('rejects a verified status without independent operators', () => {
    expect(() =>
      EvmSupplyContinuitySchema.parse({ ...report(false), status: 'VERIFIED_NO_CHANGE' }),
    ).toThrow();
  });
});
