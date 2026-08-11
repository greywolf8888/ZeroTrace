import { describe, expect, it, vi } from 'vitest';

import type { EvmLogQuery, EvmLogRecord } from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import type { AnalysisSnapshot, Evidence } from '@zerotrace/schemas';

import { discoverEvmPensionCandidates } from './claim-evm-pension-discovery.js';
import { ERC20_TRANSFER_TOPIC } from './claim-evm.js';

const tokenAddress = `0x${'1'.repeat(40)}`;
const candidate = `0x${'a'.repeat(40)}`;
const dispatcher = `0x${'b'.repeat(40)}`;
const zeroAddress = `0x${'0'.repeat(40)}`;
const shareUnit = 1_000_000n;

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '120',
  blockHash: `0x${'f'.repeat(64)}`,
  parentBlockHash: `0x${'e'.repeat(64)}`,
  finality: 'finalized' as const,
  blockTimestamp: '2026-08-10T00:01:00.000Z',
  capturedAt: '2026-08-10T00:01:01.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'c'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-v1',
};

function indexed(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

function transferLog(id: number, from: string, to: string, amount: bigint): EvmLogRecord {
  return {
    address: tokenAddress,
    blockHash: `0x${id.toString(16).padStart(64, '1')}`,
    blockNumber: `0x${(100 + id).toString(16)}`,
    blockTimestamp: `2026-08-0${Math.min(id, 9)}T00:00:00.000Z`,
    transactionHash: `0x${id.toString(16).padStart(64, '0')}`,
    transactionIndex: '0x1',
    logIndex: `0x${id.toString(16)}`,
    data: `0x${amount.toString(16).padStart(64, '0')}`,
    topics: [ERC20_TRANSFER_TOPIC, indexed(from), indexed(to)],
    removed: false,
    raw: { fixture: true, id },
  };
}

function writer() {
  const ledger = new EvidenceLedger();
  return {
    ledger,
    writeEvidence: vi.fn(
      async (
        evidence: Evidence,
        sourceEvidenceIds: readonly string[] = [],
        boundSnapshot?: AnalysisSnapshot,
      ) => {
        ledger.add(evidence, sourceEvidenceIds, boundSnapshot);
        return evidence;
      },
    ),
  };
}

function logReader(logs: EvmLogRecord[]) {
  return {
    getLogsObservation: vi.fn(async (query: EvmLogQuery) => {
      expect(query.topics).toEqual([ERC20_TRANSFER_TOPIC]);
      return { endpointId: 'sqd:binance-mainnet', value: logs };
    }),
  };
}

const policy = {
  shareUnitAtomic: shareUnit.toString(),
  minimumExactUnitDeposits: 3,
  minimumUniqueExactUnitDepositors: 3,
  maximumCandidates: 10,
};

describe('EVM pension candidate production composition', () => {
  it('links complete range coverage to behavioral candidates without role attribution', async () => {
    const evidence = writer();
    const logs = [
      transferLog(1, `0x${'2'.repeat(40)}`, candidate, shareUnit),
      transferLog(2, `0x${'3'.repeat(40)}`, candidate, shareUnit),
      transferLog(3, `0x${'4'.repeat(40)}`, candidate, shareUnit),
      transferLog(4, `0x${'5'.repeat(40)}`, candidate, shareUnit * 2n),
      transferLog(5, `0x${'6'.repeat(40)}`, candidate, shareUnit - 1n),
      transferLog(6, candidate, dispatcher, 400_000n),
      transferLog(7, candidate, dispatcher, 600_000n),
      transferLog(8, zeroAddress, candidate, shareUnit),
    ];
    const result = await discoverEvmPensionCandidates({
      tokenAddress,
      fromBlock: '100',
      toBlock: '120',
      snapshot,
      policy,
      logReader: logReader(logs),
      writeEvidence: evidence.writeEvidence,
      now: () => '2026-08-10T00:01:02.000Z',
    });

    expect(result.report).toMatchObject({
      tokenAddress,
      fromBlock: '100',
      toBlock: '120',
      scannedTransferCount: 8,
      policy,
      candidates: [
        {
          address: candidate,
          exactUnitDepositCount: 3,
          uniqueExactUnitDepositorCount: 3,
          roleAttribution: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
          participantExitPolicy: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
          dividendExecution: { state: 'unknown', reason: 'NOT_QUERIED' },
        },
      ],
      metadata: {
        dataCoverage: 1,
        historyCoverage: 1,
        sourceCoverage: 0.5,
        modelVersion: 'evm-pension-candidate-discovery-v1.0.0',
      },
    });
    expect(result.evidence).toHaveLength(11);
    const candidateResult = result.report.candidates[0];
    expect(candidateResult).toBeDefined();
    expect(evidence.ledger.get(candidateResult?.evidenceId ?? '')?.sourceEvidenceIds).toHaveLength(
      7,
    );
    expect(evidence.ledger.get(result.report.terminalEvidenceId)?.sourceEvidenceIds).toEqual(
      expect.arrayContaining([result.report.coverageEvidenceIds[0], candidateResult?.evidenceId]),
    );
  });

  it('returns an evidenced empty candidate set and fails before collection on an invalid range', async () => {
    const evidence = writer();
    const empty = await discoverEvmPensionCandidates({
      tokenAddress,
      fromBlock: '100',
      toBlock: '120',
      snapshot,
      policy,
      logReader: logReader([]),
      writeEvidence: evidence.writeEvidence,
    });
    expect(empty.report).toMatchObject({ scannedTransferCount: 0, candidates: [] });
    expect(empty.report.coverageEvidenceIds).toHaveLength(1);
    expect(empty.evidence).toHaveLength(2);

    const reader = logReader([]);
    await expect(
      discoverEvmPensionCandidates({
        tokenAddress,
        fromBlock: '121',
        toBlock: '120',
        snapshot,
        policy,
        logReader: reader,
        writeEvidence: evidence.writeEvidence,
      }),
    ).rejects.toThrow(/ordered range/);
    expect(reader.getLogsObservation).not.toHaveBeenCalled();
  });
});
