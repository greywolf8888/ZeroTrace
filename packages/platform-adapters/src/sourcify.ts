import {
  ProviderError,
  type RestTransport,
  type TransportObservation,
} from '@zerotrace/chain-adapters';
import type { EvmVerifiedSource, EvmVerifiedSourceDeployment } from '@zerotrace/schemas';
import { keccak256 } from 'viem';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_BYTECODE = /^0x(?:[0-9a-fA-F]{2})+$/;
const EVM_TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_ABI_ITEMS = 2_048;
const MAX_BYTECODE_BYTES = 1_000_000;

type JsonRecord = Record<string, unknown>;

export interface SourcifyExactMatch extends EvmVerifiedSource {
  status: 'EXACT_MATCH';
  runtimeBytecode: string;
}

export interface SourcifyNoExactMatch {
  status: 'NO_EXACT_MATCH';
  sourceId: string;
  sourceUri: string;
  detail: string;
}

export type SourcifyVerification = SourcifyExactMatch | SourcifyNoExactMatch;

export interface EvmSourceVerificationAdapter {
  readonly sourceId: string;
  verify(chainId: number, address: string): Promise<TransportObservation<SourcifyVerification>>;
}

function record(value: unknown, field: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', `${field} must be an object.`);
  }
  return value as JsonRecord;
}

function text(value: unknown, field: string, maxLength = 2_048): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ProviderError('INVALID_RESPONSE', `${field} must be a bounded non-empty string.`);
  }
  return value;
}

function address(value: unknown, field: string): string {
  const parsed = text(value, field, 42);
  if (!EVM_ADDRESS.test(parsed)) {
    throw new ProviderError('INVALID_RESPONSE', `${field} must be an EVM address.`);
  }
  return parsed.toLowerCase();
}

function unsigned(value: unknown, field: string): string {
  const parsed = typeof value === 'number' ? String(value) : text(value, field, 128);
  if (!/^(?:0|[1-9]\d*)$/.test(parsed)) {
    throw new ProviderError('INVALID_RESPONSE', `${field} must be an unsigned integer.`);
  }
  return parsed;
}

function isoDateTime(value: unknown, field: string): string {
  const parsed = new Date(text(value, field, 128));
  if (Number.isNaN(parsed.getTime())) {
    throw new ProviderError('INVALID_RESPONSE', `${field} must be an ISO date-time.`);
  }
  return parsed.toISOString();
}

function abiType(value: unknown, depth = 0): string {
  if (depth > 8) throw new ProviderError('INVALID_RESPONSE', 'Sourcify ABI tuple depth is unsafe.');
  const input = record(value, 'Sourcify ABI input');
  const type = text(input.type, 'Sourcify ABI input type', 256);
  if (!type.startsWith('tuple')) return type;
  const components = input.components;
  if (!Array.isArray(components) || components.length > 256) {
    throw new ProviderError('INVALID_RESPONSE', 'Sourcify tuple components are invalid.');
  }
  const suffix = type.slice('tuple'.length);
  return `(${components.map((component) => abiType(component, depth + 1)).join(',')})${suffix}`;
}

function functionSignatures(abiValue: unknown): {
  count: number;
  mutating: string[];
} {
  if (!Array.isArray(abiValue) || abiValue.length > MAX_ABI_ITEMS) {
    throw new ProviderError('INVALID_RESPONSE', 'Sourcify ABI is missing or exceeds its bound.');
  }
  const functions = abiValue.filter(
    (item) => record(item, 'Sourcify ABI item').type === 'function',
  );
  const mutating = functions.flatMap((item) => {
    const entry = record(item, 'Sourcify ABI function');
    const name = text(entry.name, 'Sourcify ABI function name', 256);
    const stateMutability = text(entry.stateMutability, 'Sourcify state mutability', 32);
    const inputs = entry.inputs;
    if (!Array.isArray(inputs) || inputs.length > 256) {
      throw new ProviderError('INVALID_RESPONSE', 'Sourcify ABI function inputs are invalid.');
    }
    const signature = `${name}(${inputs.map((input) => abiType(input)).join(',')})`;
    return stateMutability === 'payable' || stateMutability === 'nonpayable' ? [signature] : [];
  });
  return { count: functions.length, mutating: [...new Set(mutating)].sort() };
}

function deployment(value: unknown): EvmVerifiedSource['deployment'] {
  if (value === undefined || value === null) {
    return {
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
      detail: 'Sourcify did not return deployment provenance.',
    };
  }
  const input = record(value, 'Sourcify deployment');
  const transactionHash = text(input.transactionHash, 'Sourcify deployment transaction', 66);
  if (!EVM_TRANSACTION_HASH.test(transactionHash)) {
    throw new ProviderError('INVALID_RESPONSE', 'Sourcify deployment transaction hash is invalid.');
  }
  const parsed: EvmVerifiedSourceDeployment = {
    blockNumber: unsigned(input.blockNumber, 'Sourcify deployment block'),
    transactionHash: transactionHash.toLowerCase(),
    deployer: address(input.deployer, 'Sourcify deployer'),
  };
  return { state: 'known', value: parsed };
}

export class SourcifyV2Adapter implements EvmSourceVerificationAdapter {
  readonly sourceId: string;
  readonly #transport: RestTransport;
  readonly #publicBaseUrl: string;

  constructor(options: { transport: RestTransport; publicBaseUrl: string }) {
    this.sourceId = options.transport.endpointId;
    this.#transport = options.transport;
    this.#publicBaseUrl = options.publicBaseUrl.replace(/\/$/, '');
  }

  async verify(
    chainId: number,
    contractAddress: string,
  ): Promise<TransportObservation<SourcifyVerification>> {
    if (!Number.isSafeInteger(chainId) || chainId < 1) {
      throw new Error('Sourcify chain ID must be a positive safe integer.');
    }
    const normalizedAddress = address(contractAddress, 'Sourcify contract address');
    const path = `/v2/contract/${chainId}/${normalizedAddress}?fields=abi,compilation,runtimeBytecode,verifiedAt,deployment,runtimeMatch`;
    const sourceUri = `${this.#publicBaseUrl}${path}`;
    let observation: TransportObservation<unknown>;
    try {
      observation = await this.#transport.getJsonSourced<unknown>(path, { cacheMode: 'bypass' });
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.code === 'HTTP_ERROR' &&
        error.statusCode === 404
      ) {
        return {
          endpointId: this.sourceId,
          value: {
            status: 'NO_EXACT_MATCH',
            sourceId: this.sourceId,
            sourceUri,
            detail: 'Sourcify V2 has no verified contract record for this address.',
          },
        };
      }
      throw error;
    }

    const input = record(observation.value, 'Sourcify response');
    if (unsigned(input.chainId, 'Sourcify chain ID') !== String(chainId)) {
      throw new ProviderError('CHAIN_MISMATCH', 'Sourcify returned a different chain ID.');
    }
    if (address(input.address, 'Sourcify response address') !== normalizedAddress) {
      throw new ProviderError('INVALID_RESPONSE', 'Sourcify returned a different address.');
    }
    if (input.runtimeMatch !== 'exact_match') {
      return {
        endpointId: observation.endpointId,
        value: {
          status: 'NO_EXACT_MATCH',
          sourceId: observation.endpointId,
          sourceUri,
          detail: 'Sourcify did not report an exact runtime-bytecode match.',
        },
      };
    }
    const runtime = record(input.runtimeBytecode, 'Sourcify runtime bytecode');
    const runtimeBytecode = text(
      runtime.onchainBytecode,
      'Sourcify on-chain runtime bytecode',
      MAX_BYTECODE_BYTES * 2 + 2,
    ).toLowerCase();
    if (!EVM_BYTECODE.test(runtimeBytecode)) {
      throw new ProviderError('INVALID_RESPONSE', 'Sourcify runtime bytecode is malformed.');
    }
    const runtimeBytecodeBytes = (runtimeBytecode.length - 2) / 2;
    if (runtimeBytecodeBytes > MAX_BYTECODE_BYTES) {
      throw new ProviderError('INVALID_RESPONSE', 'Sourcify runtime bytecode exceeds its bound.');
    }
    const compilation = record(input.compilation, 'Sourcify compilation');
    const signatures = functionSignatures(input.abi);
    return {
      endpointId: observation.endpointId,
      value: {
        status: 'EXACT_MATCH',
        sourceId: observation.endpointId,
        sourceUri,
        address: normalizedAddress,
        matchType: 'exact_match',
        runtimeBytecode,
        runtimeBytecodeHash: keccak256(runtimeBytecode as `0x${string}`),
        runtimeBytecodeBytes,
        contractName: text(compilation.name, 'Sourcify contract name', 256),
        fullyQualifiedName: text(
          compilation.fullyQualifiedName,
          'Sourcify fully qualified name',
          1_024,
        ),
        language: text(compilation.language, 'Sourcify language', 64),
        compilerVersion: text(compilation.compilerVersion, 'Sourcify compiler version', 256),
        verifiedAt: isoDateTime(input.verifiedAt, 'Sourcify verification time'),
        deployment: deployment(input.deployment),
        abiFunctionCount: signatures.count,
        mutatingFunctionSignatures: signatures.mutating,
      },
    };
  }
}
