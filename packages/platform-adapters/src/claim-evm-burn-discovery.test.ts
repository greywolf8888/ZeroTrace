import { describe, expect, it, vi } from 'vitest';

import type { EvmLogQuery, EvmLogRecord } from '@zerotrace/chain-adapters';
import { EVM_ZERO_ADDRESS } from '@zerotrace/claim-audit';
import { EvidenceLedger } from '@zerotrace/evidence';
import {
  EvmClaimBurnCandidateDiscoverySchema,
  knownValue,
  type AnalysisSnapshot,
  type Evidence,
} from '@zerotrace/schemas';

import { discoverErc20BurnCandidates } from './claim-evm-burn-discovery.js';
import { ERC20_TRANSFER_TOPIC } from './claim-evm.js';

const tokenAddress = `0x${'1'.repeat(40)}`;
const burnerA = `0x${'2'.repeat(40)}`;
const burnerB = `0x${'3'.repeat(40)}`;
const recipient = `0x${'4'.repeat(40)}`;
const zeroTopic = `0x${'0'.repeat(64)}`;

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '110',
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

function transferLog(
  blockNumber: number,
  logIndex: number,
  from: string,
  to: string,
  amount: bigint,
): EvmLogRecord {
  return {
    address: tokenAddress,
    blockHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
    blockNumber: `0x${blockNumber.toString(16)}`,
    blockTimestamp: `2026-08-10T00:00:${String(blockNumber - 90).padStart(2, '0')}.000Z`,
    transactionHash: `0x${(blockNumber * 100 + logIndex).toString(16).padStart(64, '0')}`,
    transactionIndex: '0x1',
    logIndex: `0x${logIndex.toString(16)}`,
    data: `0x${amount.toString(16).padStart(64, '0')}`,
    topics: [ERC20_TRANSFER_TOPIC, indexed(from), indexed(to)],
    removed: false,
    raw: { fixture: true },
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

function logReader(mints: EvmLogRecord[], burns: EvmLogRecord[]) {
  return {
    getLogsObservation: vi.fn().mockImplementation((query: EvmLogQuery) => {
      const fromZero = query.topics?.[1] === zeroTopic;
      const toZero = query.topics?.[2] === zeroTopic;
      if (fromZero === toZero) throw new Error('Expected one indexed zero-address direction.');
      return Promise.resolve({
        endpointId: 'sqd:binance-mainnet',
        value: fromZero ? mints : burns,
      });
    }),
  };
}

describe('ERC-20 burn candidate discovery', () => {
  it('groups only non-zero burn-event blocks while retaining same-block mint context', async () => {
    const evidence = writer();
    const result = await discoverErc20BurnCandidates({
      tokenAddress,
      fromBlock: '100',
      toBlock: '110',
      snapshot,
      logReader: logReader(
        [transferLog(101, 1, EVM_ZERO_ADDRESS, recipient, 25n)],
        [
          transferLog(101, 2, burnerA, EVM_ZERO_ADDRESS, 10n),
          transferLog(101, 3, burnerB, EVM_ZERO_ADDRESS, 15n),
          transferLog(105, 1, burnerA, EVM_ZERO_ADDRESS, 30n),
          transferLog(106, 1, burnerA, EVM_ZERO_ADDRESS, 0n),
        ],
      ),
      writeEvidence: evidence.writeEvidence,
      now: () => '2026-08-10T00:01:02.000Z',
    });

    expect(result.report).toMatchObject({
      tokenAddress,
      fromBlock: '100',
      toBlock: '110',
      coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS',
      status: 'CANDIDATES_DISCOVERED',
      zeroAddressEventCount: 4,
      burnCandidateCount: 2,
      silentSupplyChangeDetection: { state: 'unknown', reason: 'NOT_QUERIED' },
      candidates: [
        {
          blockNumber: '101',
          mintedEventAmount: '25',
          burnedEventAmount: '25',
          burnTransferIds: expect.arrayContaining([
            expect.stringContaining('erc20:'),
            expect.stringContaining('erc20:'),
          ]),
        },
        {
          blockNumber: '105',
          mintedEventAmount: '0',
          burnedEventAmount: '30',
        },
      ],
      metadata: {
        dataCoverage: 1,
        historyCoverage: 1,
        sourceCoverage: 0.5,
        modelVersion: 'erc20-burn-candidate-discovery-v1.0.0',
      },
    });
    expect(result.evidence).toHaveLength(8);
    expect(result.evidence.at(-1)?.id).toBe(result.report.terminalEvidenceId);
    expect(evidence.ledger.get(result.report.terminalEvidenceId)?.sourceEvidenceIds).toHaveLength(
      7,
    );
  });

  it('reports no event candidates without converting silent supply coverage to false or zero', async () => {
    const evidence = writer();
    const result = await discoverErc20BurnCandidates({
      tokenAddress,
      fromBlock: '100',
      toBlock: '110',
      snapshot,
      logReader: logReader([], []),
      writeEvidence: evidence.writeEvidence,
    });

    expect(result.report).toMatchObject({
      status: 'NO_EVENT_CANDIDATES',
      zeroAddressEventCount: 0,
      burnCandidateCount: 0,
      candidates: [],
      silentSupplyChangeDetection: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(result.evidence).toHaveLength(3);
  });

  it('fails closed on ambiguous zero-to-zero events, range overflow, and replay overclaiming', async () => {
    const ambiguous = transferLog(101, 1, EVM_ZERO_ADDRESS, EVM_ZERO_ADDRESS, 1n);
    await expect(
      discoverErc20BurnCandidates({
        tokenAddress,
        fromBlock: '100',
        toBlock: '110',
        snapshot,
        logReader: logReader([ambiguous], [ambiguous]),
        writeEvidence: writer().writeEvidence,
      }),
    ).rejects.toThrow('zero-to-zero');
    await expect(
      discoverErc20BurnCandidates({
        tokenAddress,
        fromBlock: '0',
        toBlock: '5000000',
        snapshot: { ...snapshot, blockNumber: '5000000' },
        logReader: logReader([], []),
        writeEvidence: writer().writeEvidence,
      }),
    ).rejects.toThrow('limited to 5000000 blocks');

    const evidence = writer();
    const valid = await discoverErc20BurnCandidates({
      tokenAddress,
      fromBlock: '100',
      toBlock: '110',
      snapshot,
      logReader: logReader([], []),
      writeEvidence: evidence.writeEvidence,
    });
    expect(() =>
      EvmClaimBurnCandidateDiscoverySchema.parse({
        ...valid.report,
        silentSupplyChangeDetection: knownValue(false),
      }),
    ).toThrow('cannot claim silent supply-change coverage');
  });
});
