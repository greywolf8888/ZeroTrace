import { describe, expect, it, vi } from 'vitest';

import { ProviderError, type EvmLogRecord } from '@zerotrace/chain-adapters';
import type { ChainAnchorRead } from '@zerotrace/schemas';
import { encodeAbiParameters, type Address } from 'viem';

import {
  ERC20_TRANSFER_TOPIC,
  OFFICIAL_SAFE_IMPLEMENTATIONS,
  collectErc20ClaimTransfers,
  inspectEvmCustody,
  type EvmClaimReadAdapter,
} from './claim-evm.js';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  blockTimestamp: '2026-08-10T00:00:00.000Z',
  capturedAt: '2026-08-10T00:00:01.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-v1',
};

function indexed(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

function transferLog(overrides: Partial<EvmLogRecord> = {}): EvmLogRecord {
  return {
    address: `0x${'1'.repeat(40)}`,
    blockHash: `0x${'2'.repeat(64)}`,
    blockNumber: '0x5a',
    blockTimestamp: '2026-08-03T00:00:00.000Z',
    transactionHash: `0x${'3'.repeat(64)}`,
    transactionIndex: '0x1',
    logIndex: '0x2',
    data: `0x${400n.toString(16).padStart(64, '0')}`,
    topics: [ERC20_TRANSFER_TOPIC, indexed(`0x${'4'.repeat(40)}`), indexed(`0x${'5'.repeat(40)}`)],
    removed: false,
    raw: { provider: 'fixture' },
    ...overrides,
  };
}

function encodedString(value: string): string {
  return encodeAbiParameters([{ type: 'string' }], [value]);
}

function encodedAddresses(values: Address[]): string {
  return encodeAbiParameters([{ type: 'address[]' }], [values]);
}

function encodedUint(value: bigint): string {
  return encodeAbiParameters([{ type: 'uint256' }], [value]);
}

function safeAdapter(
  options: {
    code?: string;
    singleton?: string;
    calls?: string[];
    callError?: ProviderError;
  } = {},
): EvmClaimReadAdapter {
  const calls = [...(options.calls ?? [])];
  return {
    sourceId: 'bsc-rpc',
    config: { chainId: 56 },
    getCodeObservation: vi
      .fn()
      .mockResolvedValue({ value: options.code ?? '0x6000', endpointId: 'bsc-rpc' }),
    readSourced: vi.fn().mockResolvedValue({
      value: options.singleton ?? `0x${'0'.repeat(24)}${'9'.repeat(40)}`,
      endpointId: 'bsc-rpc',
    }),
    callObservation: vi.fn().mockImplementation(async () => {
      if (options.callError !== undefined) throw options.callError;
      const value = calls.shift();
      if (value === undefined) throw new Error('missing fixture call result');
      return { value, endpointId: 'bsc-rpc' };
    }),
  } as EvmClaimReadAdapter;
}

describe('EVM claim observations', () => {
  it('decodes finalized ERC-20 Transfer logs with per-log Evidence and complete range coverage', async () => {
    const log = transferLog();
    const logReader = {
      getLogsObservation: vi.fn().mockResolvedValue({ value: [log], endpointId: 'sqd:bsc' }),
    };
    const result = await collectErc20ClaimTransfers({
      tokenAddress: log.address,
      fromBlock: '90',
      toBlock: '100',
      snapshot,
      logReader,
      now: () => '2026-08-10T00:00:02.000Z',
    });

    expect(result).toMatchObject({
      fromBlock: '90',
      toBlock: '100',
      metadata: {
        dataCoverage: 1,
        historyCoverage: 1,
        sourceCoverage: 0.5,
        sourceSet: ['sqd:bsc'],
        modelVersion: 'erc20-claim-transfer-v1.0.0',
        confidence: 0.95,
        evidenceIds: [expect.stringMatching(/^ev_[0-9a-f]{24}$/)],
      },
      transfers: [
        {
          from: `0x${'4'.repeat(40)}`,
          to: `0x${'5'.repeat(40)}`,
          amount: '400',
          observedAt: '2026-08-03T00:00:00.000Z',
          evidenceIds: [expect.stringMatching(/^ev_[0-9a-f]{24}$/)],
        },
      ],
    });
    expect(result.evidence[0]).toMatchObject({
      kind: 'LOG',
      blockOrSlot: '90',
      finality: 'finalized',
    });
    expect(logReader.getLogsObservation).toHaveBeenCalledWith({
      address: log.address,
      fromBlock: '90',
      toBlock: '100',
      topics: [ERC20_TRANSFER_TOPIC],
    });
  });

  it('uses an exact finalized block anchor when the log source omits time', async () => {
    const log = transferLog({ blockTimestamp: undefined });
    const logReader = {
      getLogsObservation: vi.fn().mockResolvedValue({ value: [log], endpointId: 'rpc:bsc' }),
    };
    const blockReader = {
      readAnchorAt: vi.fn().mockResolvedValue({
        anchor: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          position: '90',
          hash: log.blockHash,
          parentPosition: '89',
          parentHash: `0x${'6'.repeat(64)}`,
          finality: 'finalized',
          source: 'rpc:bsc',
          observedAt: '2026-08-10T00:00:02.000Z',
        },
        snapshot: {
          ...snapshot,
          blockNumber: '90',
          blockHash: log.blockHash,
          parentBlockHash: `0x${'6'.repeat(64)}`,
          blockTimestamp: '2026-08-03T00:00:00.000Z',
        },
        payload: {},
      } satisfies ChainAnchorRead),
    };
    const result = await collectErc20ClaimTransfers({
      tokenAddress: log.address,
      fromBlock: '90',
      toBlock: '90',
      snapshot,
      logReader,
      blockReader,
    });
    expect(result.transfers[0]?.observedAt).toBe('2026-08-03T00:00:00.000Z');
    expect(result.metadata).toMatchObject({
      sourceCoverage: 0.5,
      sourceSet: ['rpc:bsc'],
    });
    expect(blockReader.readAnchorAt).toHaveBeenCalledWith('90');
  });

  it('rejects malformed transfer padding, duplicate logs, and over-budget ranges', async () => {
    const malformed = transferLog({
      topics: [ERC20_TRANSFER_TOPIC, `0x${'f'.repeat(64)}`, indexed(`0x${'5'.repeat(40)}`)],
    });
    await expect(
      collectErc20ClaimTransfers({
        tokenAddress: malformed.address,
        fromBlock: '90',
        toBlock: '90',
        snapshot,
        logReader: {
          getLogsObservation: vi
            .fn()
            .mockResolvedValue({ value: [malformed], endpointId: 'sqd:bsc' }),
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const log = transferLog();
    await expect(
      collectErc20ClaimTransfers({
        tokenAddress: log.address,
        fromBlock: '90',
        toBlock: '90',
        snapshot,
        logReader: {
          getLogsObservation: vi
            .fn()
            .mockResolvedValue({ value: [log, log], endpointId: 'sqd:bsc' }),
        },
      }),
    ).rejects.toThrow('duplicates');

    await expect(
      collectErc20ClaimTransfers({
        tokenAddress: log.address,
        fromBlock: '1',
        toBlock: '100',
        snapshot,
        logReader: { getLogsObservation: vi.fn() },
        maxBlocksPerRequest: 10,
        maxRequests: 2,
      }),
    ).rejects.toThrow('request budget');

    await expect(
      collectErc20ClaimTransfers({
        tokenAddress: log.address,
        fromBlock: '90',
        toBlock: '90',
        snapshot,
        logReader: {
          getLogsObservation: vi.fn().mockResolvedValue({
            value: [transferLog({ blockNumber: '0x59' })],
            endpointId: 'sqd:bsc',
          }),
        },
      }),
    ).rejects.toThrow('outside the requested range');
  });

  it('rejects removed logs and target-height lineage disagreement', async () => {
    const removed = transferLog({ removed: true as never });
    await expect(
      collectErc20ClaimTransfers({
        tokenAddress: removed.address,
        fromBlock: '90',
        toBlock: '90',
        snapshot,
        logReader: {
          getLogsObservation: vi
            .fn()
            .mockResolvedValue({ value: [removed], endpointId: 'sqd:bsc' }),
        },
      }),
    ).rejects.toThrow('canonical status');

    const target = transferLog({ blockNumber: '0x64' });
    await expect(
      collectErc20ClaimTransfers({
        tokenAddress: target.address,
        fromBlock: '100',
        toBlock: '100',
        snapshot,
        logReader: {
          getLogsObservation: vi.fn().mockResolvedValue({ value: [target], endpointId: 'sqd:bsc' }),
        },
      }),
    ).rejects.toThrow('disagrees with the analysis Snapshot');
  });

  it('classifies EOA custody without pretending it is an irreversible burn', async () => {
    const result = await inspectEvmCustody({
      address: `0x${'7'.repeat(40)}`,
      snapshot,
      adapter: safeAdapter({ code: '0x' }),
      now: () => '2026-08-10T00:00:02.000Z',
    });
    expect(result.custody).toMatchObject({
      kind: 'EOA',
      canMoveFunds: { state: 'known', value: true },
    });
    expect(result.metadata).toMatchObject({
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      modelVersion: 'safe-compatible-read-v1.1.0',
      confidence: 0.95,
      evidenceIds: result.custody.evidenceIds,
    });
  });

  it('reads strict Safe-compatible proxy custody at one finalized Snapshot', async () => {
    const owners = Array.from({ length: 6 }, (_, index) =>
      `0x${(index + 1).toString(16).repeat(40)}`.slice(0, 42),
    ) as Address[];
    const result = await inspectEvmCustody({
      address: `0x${'8'.repeat(40)}`,
      snapshot,
      adapter: safeAdapter({
        singleton: `0x${'0'.repeat(24)}${OFFICIAL_SAFE_IMPLEMENTATIONS[0].address.slice(2)}`,
        calls: [
          encodedString('1.3.0'),
          encodedAddresses(owners),
          encodedUint(4n),
          encodedUint(10n),
        ],
      }),
      now: () => '2026-08-10T00:00:02.000Z',
    });
    expect(result.custody).toMatchObject({
      kind: 'SAFE_MULTISIG',
      canMoveFunds: { state: 'known', value: true },
      threshold: 4,
      ownerCount: 6,
      executedTransactions: 10,
      implementationAddress: OFFICIAL_SAFE_IMPLEMENTATIONS[0].address,
      implementationVersion: '1.3.0',
    });
    expect(result.evidence[0]?.summary).toContain('4-of-6');
  });

  it('keeps an unsupported generic contract Unknown and rejects an impossible Safe threshold', async () => {
    const generic = await inspectEvmCustody({
      address: `0x${'8'.repeat(40)}`,
      snapshot,
      adapter: safeAdapter({
        callError: new ProviderError('RPC_ERROR', 'execution reverted', { retryable: false }),
      }),
    });
    expect(generic.custody).toMatchObject({
      kind: 'CONTRACT',
      canMoveFunds: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });

    const unregistered = await inspectEvmCustody({
      address: `0x${'8'.repeat(40)}`,
      snapshot,
      adapter: safeAdapter({ calls: [encodedString('1.3.0')] }),
    });
    expect(unregistered.custody).toMatchObject({
      kind: 'CONTRACT',
      canMoveFunds: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      implementationAddress: `0x${'9'.repeat(40)}`,
      implementationVersion: '1.3.0',
    });

    const owners = [`0x${'1'.repeat(40)}`, `0x${'2'.repeat(40)}`] as Address[];
    await expect(
      inspectEvmCustody({
        address: `0x${'8'.repeat(40)}`,
        snapshot,
        adapter: safeAdapter({
          singleton: `0x${'0'.repeat(24)}${OFFICIAL_SAFE_IMPLEMENTATIONS[0].address.slice(2)}`,
          calls: [
            encodedString('1.3.0'),
            encodedAddresses(owners),
            encodedUint(3n),
            encodedUint(0n),
          ],
        }),
      }),
    ).rejects.toThrow('threshold');
  });
});
