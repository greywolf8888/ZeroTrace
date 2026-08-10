import { describe, expect, it } from 'vitest';

import {
  ProviderError,
  type RestTransport,
  type TransportObservation,
} from '@zerotrace/chain-adapters';
import { keccak256 } from 'viem';

import { SourcifyV2Adapter } from './sourcify.js';

const contract = `0x${'a'.repeat(40)}`;
const runtimeBytecode = '0x60006000';

function transport(value: unknown | ProviderError): RestTransport {
  const read = <T>(): Promise<TransportObservation<T>> =>
    value instanceof ProviderError
      ? Promise.reject(value)
      : Promise.resolve({ value: value as T, endpointId: 'sourcify-v2@sourcify.dev' });
  return {
    endpointId: 'sourcify-v2@sourcify.dev',
    getText: () => Promise.resolve(''),
    getTextSourced: () => Promise.resolve({ value: '', endpointId: 'sourcify-v2@sourcify.dev' }),
    getJson: async <T>() => (await read<T>()).value,
    getJsonSourced: read,
  };
}

function response() {
  return {
    chainId: '56',
    address: contract,
    runtimeMatch: 'exact_match',
    runtimeBytecode: { onchainBytecode: runtimeBytecode },
    compilation: {
      name: 'FlapTaxTokenV3',
      fullyQualifiedName: 'src/Tax/FlapTaxTokenV3.sol:FlapTaxTokenV3',
      language: 'Solidity',
      compilerVersion: '0.8.24+commit.e11b9ed9',
    },
    verifiedAt: '2026-06-03T00:24:59.393Z',
    deployment: {
      blockNumber: 90,
      transactionHash: `0x${'b'.repeat(64)}`,
      deployer: `0x${'c'.repeat(40)}`,
    },
    abi: [
      {
        type: 'function',
        name: 'owner',
        stateMutability: 'view',
        inputs: [],
      },
      {
        type: 'function',
        name: 'initialize',
        stateMutability: 'nonpayable',
        inputs: [
          {
            type: 'tuple',
            components: [{ type: 'address' }, { type: 'uint256' }],
          },
        ],
      },
      {
        type: 'function',
        name: 'startMigration',
        stateMutability: 'nonpayable',
        inputs: [],
      },
    ],
  };
}

describe('Sourcify V2 source verification adapter', () => {
  it('returns bounded exact-match metadata and canonical mutation signatures', async () => {
    const adapter = new SourcifyV2Adapter({
      transport: transport(response()),
      publicBaseUrl: 'https://sourcify.dev/server',
    });
    const result = await adapter.verify(56, contract.toUpperCase().replace('0X', '0x'));

    expect(result.value).toMatchObject({
      status: 'EXACT_MATCH',
      address: contract,
      runtimeBytecode,
      runtimeBytecodeHash: keccak256(runtimeBytecode),
      runtimeBytecodeBytes: 4,
      abiFunctionCount: 3,
      mutatingFunctionSignatures: ['initialize((address,uint256))', 'startMigration()'],
      deployment: { state: 'known', value: { blockNumber: '90' } },
    });
  });

  it('preserves a 404 as an explicit no-match state', async () => {
    const adapter = new SourcifyV2Adapter({
      transport: transport(
        new ProviderError('HTTP_ERROR', 'not found', { statusCode: 404, retryable: false }),
      ),
      publicBaseUrl: 'https://sourcify.dev/server',
    });

    await expect(adapter.verify(56, contract)).resolves.toMatchObject({
      value: { status: 'NO_EXACT_MATCH', sourceId: 'sourcify-v2@sourcify.dev' },
    });
  });

  it('rejects a provider response for a different contract identity', async () => {
    const adapter = new SourcifyV2Adapter({
      transport: transport({ ...response(), address: `0x${'d'.repeat(40)}` }),
      publicBaseUrl: 'https://sourcify.dev/server',
    });

    await expect(adapter.verify(56, contract)).rejects.toThrow('different address');
  });
});
