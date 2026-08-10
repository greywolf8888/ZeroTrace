import { describe, expect, it, vi } from 'vitest';

import type { EvmLogRecord } from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import type { AnalysisSnapshot, ChainAnchorRead, Evidence } from '@zerotrace/schemas';
import { encodeAbiParameters } from 'viem';

import { observeEvmClaimBurnBlock } from './claim-evm-burn.js';
import { ERC20_TRANSFER_TOPIC, type EvmClaimReadAdapter } from './claim-evm.js';

const tokenAddress = `0x${'1'.repeat(40)}`;
const burner = `0x${'2'.repeat(40)}`;
const zeroAddress = `0x${'0'.repeat(40)}`;
const blockHash = `0x${'a'.repeat(64)}`;
const parentBlockHash = `0x${'b'.repeat(64)}`;

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash,
  parentBlockHash,
  finality: 'finalized' as const,
  blockTimestamp: '2026-08-10T00:00:00.000Z',
  capturedAt: '2026-08-10T00:00:01.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'c'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-v1',
};

const parentSnapshot = {
  ...snapshot,
  blockNumber: '99',
  blockHash: parentBlockHash,
  parentBlockHash: `0x${'d'.repeat(64)}`,
  blockTimestamp: '2026-08-09T23:59:57.000Z',
  capturedAt: '2026-08-10T00:00:00.500Z',
};

function indexed(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

function burnLog(overrides: Partial<EvmLogRecord> = {}): EvmLogRecord {
  return {
    address: tokenAddress,
    blockHash,
    blockNumber: '0x64',
    blockTimestamp: '2026-08-10T00:00:00.000Z',
    transactionHash: `0x${'3'.repeat(64)}`,
    transactionIndex: '0x1',
    logIndex: '0x2',
    data: `0x${100n.toString(16).padStart(64, '0')}`,
    topics: [ERC20_TRANSFER_TOPIC, indexed(burner), indexed(zeroAddress)],
    removed: false,
    raw: { provider: 'fixture' },
    ...overrides,
  };
}

function parentAnchor(overrides: Partial<ChainAnchorRead> = {}): ChainAnchorRead {
  return {
    anchor: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      position: '99',
      hash: parentBlockHash,
      parentPosition: '98',
      parentHash: `0x${'d'.repeat(64)}`,
      finality: 'finalized',
      source: 'bsc-parent',
      observedAt: '2026-08-10T00:00:00.500Z',
    },
    snapshot: parentSnapshot,
    payload: {},
    ...overrides,
  };
}

function encodedSupply(value: bigint): string {
  return encodeAbiParameters([{ type: 'uint256' }], [value]);
}

function adapter(supplies: string[]): EvmClaimReadAdapter {
  const values = [...supplies];
  return {
    sourceId: 'bsc-rpc',
    config: { chainId: 56 },
    callObservation: vi.fn().mockImplementation(async () => ({
      value: values.shift(),
      endpointId: 'bsc-state',
    })),
    getCodeObservation: vi.fn(),
    readSourced: vi.fn(),
  } as EvmClaimReadAdapter;
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

describe('EVM claim burn observation', () => {
  it('persists parent/target supply, complete block logs, and one conserved burn action', async () => {
    const evidence = writer();
    const readAdapter = adapter([encodedSupply(1_000n), encodedSupply(900n)]);
    const logReader = {
      getLogsObservation: vi.fn().mockResolvedValue({
        value: [burnLog()],
        endpointId: 'bsc-logs',
      }),
    };
    const blockReader = { readAnchorAt: vi.fn().mockResolvedValue(parentAnchor()) };
    const result = await observeEvmClaimBurnBlock({
      tokenAddress,
      snapshot,
      adapter: readAdapter,
      logReader,
      blockReader,
      writeEvidence: evidence.writeEvidence,
      now: () => '2026-08-10T00:00:02.000Z',
    });

    expect(result.report).toMatchObject({
      tokenAddress,
      blockNumber: '100',
      parentBlockNumber: '99',
      totalSupplyBefore: '1000',
      totalSupplyAfter: '900',
      mintedAmount: '0',
      burnedAmount: '100',
      supplyDelta: '-100',
      eventNetSupplyDelta: '-100',
      status: 'VERIFIED',
      actions: [
        {
          type: 'BURN',
          actor: burner,
          amount: '100',
          path: [burner, zeroAddress],
        },
      ],
      metadata: {
        dataCoverage: 1,
        historyCoverage: 1,
        sourceCoverage: 0.5,
        modelVersion: 'erc20-burn-conservation-v1.0.0',
      },
    });
    expect(result.evidence).toHaveLength(5);
    expect(result.evidence.at(-1)).toMatchObject({
      id: result.report.terminalEvidenceId,
      kind: 'DERIVED_FEATURE',
      finality: 'finalized',
    });
    expect(evidence.ledger.get(result.report.terminalEvidenceId)?.sourceEvidenceIds).toHaveLength(
      4,
    );
    expect(readAdapter.callObservation).toHaveBeenNthCalledWith(
      1,
      tokenAddress,
      expect.stringMatching(/^0x[0-9a-f]+$/),
      '0x63',
    );
    expect(readAdapter.callObservation).toHaveBeenNthCalledWith(
      2,
      tokenAddress,
      expect.stringMatching(/^0x[0-9a-f]+$/),
      '0x64',
    );
    expect(logReader.getLogsObservation).toHaveBeenCalledWith({
      address: tokenAddress,
      fromBlock: '100',
      toBlock: '100',
      topics: [ERC20_TRANSFER_TOPIC],
    });
  });

  it('persists a contradiction and emits no action when totalSupply does not fall', async () => {
    const evidence = writer();
    const result = await observeEvmClaimBurnBlock({
      tokenAddress,
      snapshot,
      adapter: adapter([encodedSupply(1_000n), encodedSupply(1_000n)]),
      logReader: {
        getLogsObservation: vi.fn().mockResolvedValue({
          value: [burnLog()],
          endpointId: 'bsc-logs',
        }),
      },
      blockReader: { readAnchorAt: vi.fn().mockResolvedValue(parentAnchor()) },
      writeEvidence: evidence.writeEvidence,
      now: () => '2026-08-10T00:00:02.000Z',
    });

    expect(result.report).toMatchObject({
      status: 'CONTRADICTED',
      expectedSupplyAfter: '900',
      totalSupplyAfter: '1000',
      actions: [],
    });
    expect(result.evidence.at(-1)?.summary).toContain('not credited');
  });

  it('returns not-applicable for an exactly conserved block without a burn', async () => {
    const evidence = writer();
    const result = await observeEvmClaimBurnBlock({
      tokenAddress,
      snapshot,
      adapter: adapter([encodedSupply(1_000n), encodedSupply(1_000n)]),
      logReader: {
        getLogsObservation: vi.fn().mockResolvedValue({ value: [], endpointId: 'bsc-logs' }),
      },
      blockReader: { readAnchorAt: vi.fn().mockResolvedValue(parentAnchor()) },
      writeEvidence: evidence.writeEvidence,
      now: () => '2026-08-10T00:00:02.000Z',
    });

    expect(result.report).toMatchObject({
      status: 'NOT_APPLICABLE',
      burnedAmount: '0',
      actions: [],
    });
    expect(result.evidence).toHaveLength(4);
  });

  it('fails closed on wrong parent lineage and malformed totalSupply', async () => {
    const evidence = writer();
    await expect(
      observeEvmClaimBurnBlock({
        tokenAddress,
        snapshot,
        adapter: adapter([encodedSupply(1_000n), encodedSupply(900n)]),
        logReader: {
          getLogsObservation: vi.fn().mockResolvedValue({ value: [], endpointId: 'bsc-logs' }),
        },
        blockReader: {
          readAnchorAt: vi.fn().mockResolvedValue(
            parentAnchor({
              anchor: { ...parentAnchor().anchor, hash: `0x${'e'.repeat(64)}` },
            }),
          ),
        },
        writeEvidence: evidence.writeEvidence,
      }),
    ).rejects.toThrow('Parent block anchor');

    await expect(
      observeEvmClaimBurnBlock({
        tokenAddress,
        snapshot,
        adapter: adapter(['0x01', encodedSupply(900n)]),
        logReader: {
          getLogsObservation: vi.fn().mockResolvedValue({ value: [], endpointId: 'bsc-logs' }),
        },
        blockReader: { readAnchorAt: vi.fn().mockResolvedValue(parentAnchor()) },
        writeEvidence: evidence.writeEvidence,
      }),
    ).rejects.toThrow('totalSupply response is malformed');
  });
});
