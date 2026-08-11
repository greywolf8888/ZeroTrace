import { describe, expect, it } from 'vitest';

import type { AnalysisMetadata, EvmClaimTransferObservation } from '@zerotrace/schemas';

import { discoverPensionCandidateMetrics } from './pension-candidate.js';

const candidate = `0x${'a'.repeat(40)}`;
const dispatcher = `0x${'b'.repeat(40)}`;
const shareUnit = 1_000_000n;
const coverageEvidenceId = `ev_${'f'.repeat(24)}`;

function transfer(
  id: number,
  from: string,
  to: string,
  amount: bigint,
  observedAt = `2026-08-0${id}T00:00:00.000Z`,
): EvmClaimTransferObservation {
  return {
    id: `transfer-${id}`,
    from,
    to,
    amount: amount.toString(),
    observedAt,
    transactionId: `0x${id.toString(16).padStart(64, '0')}`,
    evidenceIds: [`ev_${id.toString(16).padStart(24, '0')}`],
    blockNumber: String(100 + id),
    blockHash: `0x${id.toString(16).padStart(64, '1')}`,
    transactionIndex: '0',
    logIndex: String(id),
  };
}

function metadata(transfers: readonly EvmClaimTransferObservation[]): AnalysisMetadata {
  return {
    snapshot: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      blockNumber: '120',
      blockHash: `0x${'c'.repeat(64)}`,
      parentBlockHash: `0x${'d'.repeat(64)}`,
      finality: 'finalized',
      blockTimestamp: '2026-08-10T00:00:00.000Z',
      capturedAt: '2026-08-10T00:00:01.000Z',
      providerVersions: { fixture: '1' },
      adapterVersions: { fixture: '1' },
      configHash: 'e'.repeat(64),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-v1',
    },
    dataCoverage: 1,
    sourceCoverage: 0.5,
    historyCoverage: 1,
    simulationCoverage: 0,
    freshness: '2026-08-10T00:00:00.000Z',
    sourceSet: ['fixture'],
    modelVersion: 'erc20-claim-transfer-v1.1.0',
    confidence: 0.95,
    evidenceIds: [coverageEvidenceId, ...transfers.flatMap((item) => item.evidenceIds)].sort(),
  };
}

const policy = {
  shareUnitAtomic: shareUnit.toString(),
  minimumExactUnitDeposits: 3,
  minimumUniqueExactUnitDepositors: 3,
  maximumCandidates: 10,
};

describe('EVM pension behavioral candidate discovery', () => {
  it('finds exact-unit multi-depositor behavior without attributing a pension role', () => {
    const transfers = [
      transfer(1, `0x${'1'.repeat(40)}`, candidate, shareUnit),
      transfer(2, `0x${'2'.repeat(40)}`, candidate, shareUnit),
      transfer(3, `0x${'3'.repeat(40)}`, candidate, shareUnit),
      transfer(4, `0x${'4'.repeat(40)}`, candidate, shareUnit * 2n),
      transfer(5, `0x${'5'.repeat(40)}`, candidate, shareUnit - 1n),
      transfer(6, candidate, dispatcher, 400_000n),
      transfer(7, candidate, dispatcher, 600_000n),
      transfer(8, `0x${'0'.repeat(40)}`, candidate, shareUnit),
    ];
    const result = discoverPensionCandidateMetrics({
      fromBlock: '100',
      toBlock: '120',
      transfers,
      metadata: metadata(transfers),
      coverageEvidenceIds: [coverageEvidenceId],
      policy,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      address: candidate,
      inflowTransferCount: 5,
      outflowTransferCount: 2,
      exactUnitDepositCount: 3,
      exactMultipleDepositCount: 4,
      nonMultipleDepositCount: 1,
      uniqueExactUnitDepositorCount: 3,
      uniqueOutflowDestinationCount: 1,
      observedInflowAmount: '5999999',
      observedOutflowAmount: '1000000',
      observedNetAmount: '4999999',
      observedWholeShares: '5',
      firstOutflowAt: { state: 'known' },
      lastOutflowAt: { state: 'known' },
    });
    expect(result[0]?.transferEvidenceIds).toHaveLength(7);
  });

  it('returns a known empty candidate set only for a complete requested range', () => {
    const transfers = [transfer(1, `0x${'1'.repeat(40)}`, candidate, shareUnit)];
    expect(
      discoverPensionCandidateMetrics({
        fromBlock: '100',
        toBlock: '120',
        transfers,
        metadata: metadata(transfers),
        coverageEvidenceIds: [coverageEvidenceId],
        policy,
      }),
    ).toEqual([]);

    expect(() =>
      discoverPensionCandidateMetrics({
        fromBlock: '100',
        toBlock: '120',
        transfers,
        metadata: { ...metadata(transfers), historyCoverage: 0.5 },
        coverageEvidenceIds: [coverageEvidenceId],
        policy,
      }),
    ).toThrow(/complete finalized EVM range/);
  });

  it('rejects duplicate observations, missing Evidence, and explicit candidate overflow', () => {
    const qualifying = [
      transfer(1, `0x${'1'.repeat(40)}`, candidate, shareUnit),
      transfer(2, `0x${'2'.repeat(40)}`, candidate, shareUnit),
      transfer(3, `0x${'3'.repeat(40)}`, candidate, shareUnit),
    ];
    expect(() =>
      discoverPensionCandidateMetrics({
        fromBlock: '100',
        toBlock: '120',
        transfers: [...qualifying, qualifying[0] as EvmClaimTransferObservation],
        metadata: metadata(qualifying),
        coverageEvidenceIds: [coverageEvidenceId],
        policy,
      }),
    ).toThrow(/duplicate/);

    const missingEvidence = qualifying.map((item) => ({ ...item }));
    missingEvidence[0] = {
      ...(missingEvidence[0] as EvmClaimTransferObservation),
      evidenceIds: [`ev_${'9'.repeat(24)}`],
    };
    expect(() =>
      discoverPensionCandidateMetrics({
        fromBlock: '100',
        toBlock: '120',
        transfers: missingEvidence,
        metadata: metadata(qualifying),
        coverageEvidenceIds: [coverageEvidenceId],
        policy,
      }),
    ).toThrow(/Evidence/);

    const second = `0x${'c'.repeat(40)}`;
    const overflow = [
      ...qualifying,
      transfer(4, `0x${'4'.repeat(40)}`, second, shareUnit),
      transfer(5, `0x${'5'.repeat(40)}`, second, shareUnit),
      transfer(6, `0x${'6'.repeat(40)}`, second, shareUnit),
    ];
    expect(() =>
      discoverPensionCandidateMetrics({
        fromBlock: '100',
        toBlock: '120',
        transfers: overflow,
        metadata: metadata(overflow),
        coverageEvidenceIds: [coverageEvidenceId],
        policy: { ...policy, maximumCandidates: 1 },
      }),
    ).toThrow(/candidate limit/);
  });
});
