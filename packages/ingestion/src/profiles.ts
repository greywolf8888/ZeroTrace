import type { SqdDataset, SqdFinalizedRangeRequest } from '@zerotrace/chain-adapters';

export const SQD_INGESTION_PROFILES = ['block-headers', 'transactions'] as const;
export type SqdIngestionProfile = (typeof SQD_INGESTION_PROFILES)[number];

const EVM_TRANSACTION_FIELDS = {
  hash: true,
  from: true,
  to: true,
  gas: true,
  gasPrice: true,
  maxFeePerGas: true,
  maxPriorityFeePerGas: true,
  input: true,
  nonce: true,
  value: true,
  v: true,
  r: true,
  s: true,
  yParity: true,
  chainId: true,
  authorizationList: true,
  gasUsed: true,
  cumulativeGasUsed: true,
  effectiveGasPrice: true,
  contractAddress: true,
  type: true,
  status: true,
  sighash: true,
} as const;

const BITCOIN_TRANSACTION_FIELDS = {
  txid: true,
  hash: true,
  size: true,
  vsize: true,
  weight: true,
  version: true,
  locktime: true,
} as const;

const SOLANA_TRANSACTION_FIELDS = {
  signatures: true,
  feePayer: true,
  err: true,
  version: true,
  accountKeys: true,
  recentBlockhash: true,
  fee: true,
  computeUnitsConsumed: true,
} as const;

function assertRange(fromBlock: number, toBlock: number): void {
  if (
    !Number.isSafeInteger(fromBlock) ||
    !Number.isSafeInteger(toBlock) ||
    fromBlock < 0 ||
    toBlock < fromBlock
  ) {
    throw new RangeError('SQD profile range must contain safe non-negative positions.');
  }
}

export function createSqdProfileRequest(input: {
  dataset: SqdDataset;
  profile: SqdIngestionProfile;
  fromBlock: number;
  toBlock: number;
}): SqdFinalizedRangeRequest {
  assertRange(input.fromBlock, input.toBlock);
  const range = { fromBlock: input.fromBlock, toBlock: input.toBlock };
  if (input.profile === 'block-headers') return range;
  if (input.profile !== 'transactions') {
    throw new RangeError('Unsupported SQD ingestion profile.');
  }

  const fields =
    input.dataset === 'bitcoin-mainnet'
      ? BITCOIN_TRANSACTION_FIELDS
      : input.dataset === 'solana-mainnet'
        ? SOLANA_TRANSACTION_FIELDS
        : EVM_TRANSACTION_FIELDS;
  return {
    ...range,
    fields: { transaction: fields },
    requests: { transactions: [{}] },
  };
}
