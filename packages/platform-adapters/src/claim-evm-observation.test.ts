import { describe, expect, it, vi } from 'vitest';

import { type EvmLogQuery, type EvmLogRecord } from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';

import { ERC20_TRANSFER_TOPIC, type EvmClaimReadAdapter } from './claim-evm.js';
import { observeEvmClaimAddress, type EvmClaimEvidenceWriter } from './claim-evm-observation.js';

const token = `0x${'1'.repeat(40)}`;
const member = `0x${'4'.repeat(40)}`;
const subject = `0x${'5'.repeat(40)}`;
const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  blockTimestamp: '2026-08-10T00:00:00.000Z',
  capturedAt: '2026-08-10T00:00:01.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { claimEvm: 'claim-evm-transfer-v1.0.0' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-v1',
};

function indexed(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

function transferLog(): EvmLogRecord {
  return {
    address: token,
    blockHash: `0x${'2'.repeat(64)}`,
    blockNumber: '0x5a',
    blockTimestamp: '2026-08-03T00:00:00.000Z',
    transactionHash: `0x${'3'.repeat(64)}`,
    transactionIndex: '0x1',
    logIndex: '0x2',
    data: `0x${1_000_000n.toString(16).padStart(64, '0')}`,
    topics: [ERC20_TRANSFER_TOPIC, indexed(member), indexed(subject)],
    removed: false,
    raw: { provider: 'fixture' },
  };
}

describe('same-Snapshot EVM claim address observation', () => {
  it('captures custody before the long transfer scan and writes one derived Evidence root', async () => {
    const order: string[] = [];
    const custodyAdapter: EvmClaimReadAdapter = {
      sourceId: 'bsc-rpc',
      config: { chainId: 56 },
      getCodeObservation: vi.fn().mockImplementation(async () => {
        order.push('custody');
        return { value: '0x', endpointId: 'bsc-rpc' };
      }),
      callObservation: vi.fn(),
      readSourced: vi.fn(),
    };
    const logReader = {
      getLogsObservation: vi.fn().mockImplementation(async (query: EvmLogQuery) => {
        order.push('logs');
        return {
          value: query.topics?.[1] === null ? [transferLog()] : [],
          endpointId: 'sqd:bsc',
        };
      }),
    };
    const ledger = new EvidenceLedger();
    const writeEvidence: EvmClaimEvidenceWriter = async (
      evidence,
      sourceEvidenceIds = [],
      boundSnapshot,
    ) => ledger.add(evidence, sourceEvidenceIds, boundSnapshot).evidence;

    const result = await observeEvmClaimAddress({
      tokenAddress: token,
      address: `0x${subject.slice(2).toUpperCase()}`,
      fromBlock: '90',
      toBlock: '100',
      window: {
        from: '2026-08-02T00:00:00.000Z',
        to: '2026-08-10T00:00:00.000Z',
      },
      snapshot,
      custodyAdapter,
      logReader,
      writeEvidence,
      shareUnit: '1000000',
      now: () => '2026-08-10T00:00:02.000Z',
    });

    expect(order).toEqual(['custody', 'logs', 'logs']);
    expect(result.report).toMatchObject({
      tokenAddress: token,
      address: subject,
      custody: {
        kind: 'EOA',
        canMoveFunds: { state: 'known', value: true },
      },
      flow: {
        inflow: {
          observedAmount: '1000000',
          actualAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
          transferCount: 1,
        },
        shareUnitAssessment: {
          exactMultipleCoverage: { state: 'known', value: 1 },
        },
      },
      metadata: {
        snapshot,
        dataCoverage: 1,
        sourceCoverage: 0.5,
        historyCoverage: 0,
        sourceSet: ['bsc-rpc', 'sqd:bsc'],
        modelVersion: 'evm-claim-address-observation-v1.0.0',
        confidence: 0.95,
      },
    });
    expect(result.evidence.map((item) => item.kind)).toEqual([
      'CONTRACT_STATE',
      'PROVIDER_OBSERVATION',
      'PROVIDER_OBSERVATION',
      'LOG',
      'DERIVED_FEATURE',
    ]);
    const terminal = ledger.get(result.report.terminalEvidenceId);
    expect(terminal?.snapshot).toEqual(snapshot);
    expect(terminal?.sourceEvidenceIds).toHaveLength(4);
    expect(result.report.metadata.evidenceIds).toEqual(
      [...(terminal?.sourceEvidenceIds ?? []), result.report.terminalEvidenceId].sort(),
    );
  });

  it('does not begin the history scan when same-Snapshot custody capture fails', async () => {
    const getLogsObservation = vi.fn();
    const writeEvidence = vi.fn();

    await expect(
      observeEvmClaimAddress({
        tokenAddress: token,
        address: subject,
        fromBlock: '90',
        toBlock: '100',
        window: {
          from: '2026-08-02T00:00:00.000Z',
          to: '2026-08-10T00:00:00.000Z',
        },
        snapshot,
        custodyAdapter: {
          sourceId: 'bsc-rpc',
          config: { chainId: 56 },
          getCodeObservation: vi.fn().mockRejectedValue(new Error('archive state unavailable')),
          callObservation: vi.fn(),
          readSourced: vi.fn(),
        },
        logReader: { getLogsObservation },
        writeEvidence,
      }),
    ).rejects.toThrow('archive state unavailable');
    expect(getLogsObservation).not.toHaveBeenCalled();
    expect(writeEvidence).not.toHaveBeenCalled();
  });

  it('requires a finalized Snapshot with block time before any provider call', async () => {
    const getCodeObservation = vi.fn();

    await expect(
      observeEvmClaimAddress({
        tokenAddress: token,
        address: subject,
        fromBlock: '90',
        toBlock: '100',
        window: {
          from: '2026-08-02T00:00:00.000Z',
          to: '2026-08-10T00:00:00.000Z',
        },
        snapshot: { ...snapshot, blockTimestamp: undefined },
        custodyAdapter: {
          sourceId: 'bsc-rpc',
          config: { chainId: 56 },
          getCodeObservation,
          callObservation: vi.fn(),
          readSourced: vi.fn(),
        },
        logReader: { getLogsObservation: vi.fn() },
        writeEvidence: vi.fn(),
      }),
    ).rejects.toThrow('finalized timestamped Snapshot');
    expect(getCodeObservation).not.toHaveBeenCalled();
  });

  it('rejects an invalid time or block range before any provider call', async () => {
    const getCodeObservation = vi.fn();
    const options = {
      tokenAddress: token,
      address: subject,
      fromBlock: '90',
      toBlock: '100',
      window: {
        from: '2026-08-02T00:00:00.000Z',
        to: '2026-08-10T00:00:01.000Z',
      },
      snapshot,
      custodyAdapter: {
        sourceId: 'bsc-rpc',
        config: { chainId: 56 },
        getCodeObservation,
        callObservation: vi.fn(),
        readSourced: vi.fn(),
      },
      logReader: { getLogsObservation: vi.fn() },
      writeEvidence: vi.fn(),
    };

    await expect(observeEvmClaimAddress(options)).rejects.toThrow(
      'must not extend beyond the Snapshot',
    );
    await expect(
      observeEvmClaimAddress({
        ...options,
        window: { ...options.window, to: '2026-08-10T00:00:00.000Z' },
        toBlock: '101',
      }),
    ).rejects.toThrow('block range is invalid');
    await expect(
      observeEvmClaimAddress({
        ...options,
        window: { ...options.window, to: '2026-08-10T00:00:00.000Z' },
        fromBlock: '',
      }),
    ).rejects.toThrow('unsigned integer strings');
    expect(getCodeObservation).not.toHaveBeenCalled();
  });
});
