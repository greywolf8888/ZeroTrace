import { ProviderError, type EvmLedgerAdapter } from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import { EvmSnapshotSchema, type Evidence } from '@zerotrace/schemas';
import { decodeFunctionResult, encodeFunctionData } from 'viem';

const decimalsAbi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

export interface Erc20DecimalsObservation {
  assetId: string;
  decimals: number;
  snapshot: ReturnType<typeof EvmSnapshotSchema.parse>;
  evidence: Evidence;
}

export async function observeErc20Decimals(
  adapter: EvmLedgerAdapter,
  tokenAddress: string,
): Promise<Erc20DecimalsObservation> {
  const token = tokenAddress.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) throw new Error('ERC-20 token address is invalid.');
  const snapshot = EvmSnapshotSchema.parse(await adapter.createSnapshot());
  if (snapshot.finality !== 'finalized') {
    throw new Error('ERC-20 decimals require a finalized EVM Snapshot.');
  }
  const data = encodeFunctionData({ abi: decimalsAbi, functionName: 'decimals' });
  const observation = await adapter.callObservationAtBlockHash(token, data, snapshot.blockHash);
  let decimals: number;
  try {
    decimals = Number(
      decodeFunctionResult({
        abi: decimalsAbi,
        functionName: 'decimals',
        data: observation.value as `0x${string}`,
      }),
    );
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', 'ERC-20 decimals response is malformed.', {
      cause: error,
    });
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new ProviderError('INVALID_RESPONSE', 'ERC-20 decimals response is out of range.');
  }
  const assetId = `${snapshot.chainId}:erc20:${token}`;
  const evidence = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'CONTRACT_STATE',
    source: observation.endpointId,
    locator: `token-decimals:${assetId}`,
    payload: { schema: 'zerotrace-token-decimals-v1', assetId, decimals },
    observedAt: snapshot.capturedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    summary: 'ERC-20 decimals observed at one finalized block hash.',
  });
  return { assetId, decimals, snapshot, evidence };
}
