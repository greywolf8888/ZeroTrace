import { describe, expect, it } from 'vitest';

import { ProviderError, type TransportObservation } from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import type { AnalysisSnapshot, ChainAnchorRead, Evidence } from '@zerotrace/schemas';
import { encodeAbiParameters, encodeFunctionData, type Address } from 'viem';

import { OFFICIAL_SAFE_IMPLEMENTATIONS } from './claim-evm.js';
import {
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  ERC1167_RUNTIME_PREFIX,
  ERC1167_RUNTIME_SUFFIX,
  detectErc1167Implementation,
  inspectEvmControlSurface,
  type EvmControlReadAdapter,
} from './evm-control-rights.js';

const blockHash = `0x${'a'.repeat(64)}`;
const parentHash = `0x${'b'.repeat(64)}`;
const subject = `0x${'d'.repeat(40)}`;
const implementation = `0x${'1'.repeat(40)}`;
const admin = `0x${'2'.repeat(40)}`;
const owner = `0x${'3'.repeat(40)}`;
const zeroWord = `0x${'0'.repeat(64)}`;

const readAbi = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'VERSION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nonce',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const selectors = Object.fromEntries(
  ['owner', 'VERSION', 'getOwners', 'getThreshold', 'nonce'].map((functionName) => [
    functionName,
    encodeFunctionData({
      abi: readAbi,
      functionName: functionName as 'owner' | 'VERSION' | 'getOwners' | 'getThreshold' | 'nonce',
    }),
  ]),
) as Record<'owner' | 'VERSION' | 'getOwners' | 'getThreshold' | 'nonce', string>;

interface FixtureState {
  code: string;
  slots?: Record<string, string>;
  calls?: Record<string, string | ProviderError>;
}

function snapshot(sourceId: string) {
  return {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '100',
    blockHash,
    parentBlockHash: parentHash,
    finality: 'finalized' as const,
    blockTimestamp: '2026-08-11T00:00:00.000Z',
    capturedAt: '2026-08-11T00:00:01.000Z',
    providerVersions: { [sourceId]: 'json-rpc' },
    adapterVersions: { evm: 'fixture' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
}

function adapter(sourceId: string, fixture: FixtureState): EvmControlReadAdapter {
  const sourced = <T>(value: T): Promise<TransportObservation<T>> =>
    Promise.resolve({ value, endpointId: sourceId });
  return {
    sourceId,
    config: { chainId: 56 },
    createSnapshot: () => Promise.resolve(snapshot(sourceId)),
    readAnchorAt: (position: string): Promise<ChainAnchorRead> =>
      Promise.resolve({
        anchor: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          position,
          hash: blockHash,
          parentPosition: '99',
          parentHash,
          finality: 'finalized',
          source: sourceId,
          observedAt: '2026-08-11T00:00:01.000Z',
        },
        snapshot: snapshot(sourceId),
        payload: { fixture: true },
      }),
    getCodeObservationAtBlockHash: () => sourced(fixture.code),
    getStorageObservationAtBlockHash: (_address, slot) =>
      sourced(fixture.slots?.[slot] ?? zeroWord),
    callObservationAtBlockHash: (_address, data) => {
      const value = fixture.calls?.[data];
      if (value instanceof ProviderError) return Promise.reject(value);
      if (value === undefined) {
        return Promise.reject(
          new ProviderError('RPC_ERROR', 'execution reverted', { retryable: false }),
        );
      }
      return sourced(value);
    },
  };
}

function evidenceWriter() {
  const ledger = new EvidenceLedger();
  return {
    ledger,
    write: async (
      evidence: Evidence,
      sourceEvidenceIds: readonly string[] = [],
      analysisSnapshot?: AnalysisSnapshot,
    ) => {
      const existing = ledger.get(evidence.id);
      if (existing !== undefined) return existing.evidence;
      return ledger.add(evidence, sourceEvidenceIds, analysisSnapshot).evidence;
    },
  };
}

function addressWord(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

describe('EVM control surface', () => {
  it('detects exact ERC-1167 runtime and keeps unqueried rights Unknown', async () => {
    const code = `0x${ERC1167_RUNTIME_PREFIX}${implementation.slice(2)}${ERC1167_RUNTIME_SUFFIX}`;
    expect(detectErc1167Implementation(code)).toBe(implementation);
    expect(detectErc1167Implementation(`${code}00`)).toBeNull();
    const writer = evidenceWriter();
    const fixture = {
      code,
      calls: {
        [selectors.owner]: encodeAbiParameters(
          [{ type: 'address' }],
          ['0x0000000000000000000000000000000000000000'],
        ),
      },
    };
    const result = await inspectEvmControlSurface({
      subject,
      adapters: [
        adapter('bsc-rpc@bnb-mainnet.g.alchemy.com', fixture),
        adapter('bsc-rpc@bsc-dataseed.bnbchain.org', fixture),
      ],
      writeEvidence: writer.write,
    });

    expect(result).toMatchObject({
      subject,
      contractKind: { state: 'known', value: 'ERC1167_MINIMAL_PROXY' },
      implementationAddress: { state: 'known', value: implementation },
      ownerAddress: {
        state: 'known',
        value: '0x0000000000000000000000000000000000000000',
      },
      sourceAgreement: { state: 'known', value: true },
      sourceIndependence: { state: 'known', value: true },
      rights: [],
      metadata: {
        sourceCoverage: 1,
        historyCoverage: 0,
        simulationCoverage: 0,
        confidence: 0.99,
      },
    });
    expect(result.coverage.find((item) => item.domain === 'UPGRADE_AUTHORIZATION')).toMatchObject({
      observed: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(result.coverage.find((item) => item.domain === 'TAX_CHANGE')).toMatchObject({
      observed: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(writer.ledger.drilldown(result.terminalEvidenceId).length).toBeGreaterThanOrEqual(7);
  });

  it('emits point-in-time owner and EIP-1967 admin rights without inventing history', async () => {
    const writer = evidenceWriter();
    const fixture = {
      code: '0x6000',
      slots: {
        [EIP1967_IMPLEMENTATION_SLOT]: addressWord(implementation),
        [EIP1967_ADMIN_SLOT]: addressWord(admin),
        [EIP1967_BEACON_SLOT]: zeroWord,
      },
      calls: {
        [selectors.owner]: encodeAbiParameters([{ type: 'address' }], [owner as Address]),
      },
    };
    const result = await inspectEvmControlSurface({
      subject,
      adapters: [adapter('bsc-rpc@bsc-dataseed.bnbchain.org', fixture)],
      writeEvidence: writer.write,
      blockNumber: '100',
    });

    expect(result.contractKind).toEqual({ state: 'known', value: 'EIP1967_PROXY' });
    expect(result.rights.map((item) => item.rightType).sort()).toEqual([
      'OWNER',
      'PROXY_ADMIN',
      'UPGRADE',
    ]);
    expect(result.rights.every((item) => item.activeFrom.state === 'unknown')).toBe(true);
    expect(result.sourceIndependence).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
  });

  it('decodes registered Safe owners as conditional threshold rights', async () => {
    const writer = evidenceWriter();
    const owners = [`0x${'4'.repeat(40)}`, `0x${'5'.repeat(40)}`] as Address[];
    const fixture = {
      code: '0x6000',
      slots: {
        ['0x' + '0'.repeat(64)]: addressWord(OFFICIAL_SAFE_IMPLEMENTATIONS[0].address),
      },
      calls: {
        [selectors.VERSION]: encodeAbiParameters([{ type: 'string' }], ['1.3.0']),
        [selectors.getOwners]: encodeAbiParameters([{ type: 'address[]' }], [owners]),
        [selectors.getThreshold]: encodeAbiParameters([{ type: 'uint256' }], [2n]),
        [selectors.nonce]: encodeAbiParameters([{ type: 'uint256' }], [9n]),
      },
    };
    const result = await inspectEvmControlSurface({
      subject,
      adapters: [adapter('bsc-rpc@bsc-dataseed.bnbchain.org', fixture)],
      writeEvidence: writer.write,
    });

    expect(result.contractKind).toEqual({ state: 'known', value: 'SAFE_PROXY' });
    expect(result.safe).toMatchObject({
      state: 'known',
      value: { owners, threshold: '2', nonce: '9' },
    });
    expect(result.rights).toHaveLength(2);
    expect(result.rights.every((item) => item.rightType === 'SAFE_OWNER')).toBe(true);
    expect(result.rights.every((item) => item.threshold.state === 'known')).toBe(true);
  });

  it('rejects exact-state disagreement between providers', async () => {
    const writer = evidenceWriter();
    await expect(
      inspectEvmControlSurface({
        subject,
        adapters: [
          adapter('bsc-rpc@bnb-mainnet.g.alchemy.com', { code: '0x6000' }),
          adapter('bsc-rpc@bsc-dataseed.bnbchain.org', { code: '0x6001' }),
        ],
        writeEvidence: writer.write,
      }),
    ).rejects.toThrow('disagree on code');
  });
});
