import type { SqdDataset, SqdFinalizedRangeRequest } from '@zerotrace/chain-adapters';

export const SQD_INGESTION_PROFILES = ['block-headers', 'transactions', 'ledger-records'] as const;
export type SqdIngestionProfile = (typeof SQD_INGESTION_PROFILES)[number];

const EVM_TRANSACTION_FIELDS = {
  transactionIndex: true,
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
  transactionIndex: true,
  txid: true,
  hash: true,
  size: true,
  vsize: true,
  weight: true,
  version: true,
  locktime: true,
} as const;

const EVM_LOG_FIELDS = {
  logIndex: true,
  transactionIndex: true,
  transactionHash: true,
  address: true,
  topics: true,
  data: true,
} as const;

const EVM_TRACE_FIELDS = {
  transactionIndex: true,
  traceAddress: true,
  type: true,
  error: true,
  revertReason: true,
  subtraces: true,
  callCallType: true,
  callFrom: true,
  callTo: true,
  callValue: true,
  callGas: true,
  callSighash: true,
  callInput: true,
  callResultGasUsed: true,
  callResultOutput: true,
  createFrom: true,
  createValue: true,
  createGas: true,
  createInit: true,
  createResultGasUsed: true,
  createResultCode: true,
  createResultAddress: true,
  suicideAddress: true,
  suicideRefundAddress: true,
  suicideBalance: true,
  rewardAuthor: true,
  rewardValue: true,
  rewardType: true,
} as const;

const EVM_STATE_DIFF_FIELDS = {
  transactionIndex: true,
  address: true,
  key: true,
  kind: true,
  prev: true,
  next: true,
} as const;

const BITCOIN_INPUT_FIELDS = {
  transactionIndex: true,
  inputIndex: true,
  txid: true,
  vout: true,
  scriptSigHex: true,
  prevoutValue: true,
  prevoutScriptPubKeyType: true,
  prevoutScriptPubKeyAddress: true,
} as const;

const BITCOIN_OUTPUT_FIELDS = {
  transactionIndex: true,
  outputIndex: true,
  value: true,
  scriptPubKeyHex: true,
  scriptPubKeyType: true,
  scriptPubKeyAddress: true,
} as const;

const SOLANA_INSTRUCTION_FIELDS = {
  programId: true,
  accounts: true,
  data: true,
  transactionIndex: true,
  instructionAddress: true,
  isCommitted: true,
  error: true,
} as const;

const SOLANA_LOG_FIELDS = {
  transactionIndex: true,
  logIndex: true,
  instructionAddress: true,
  programId: true,
  kind: true,
  message: true,
} as const;

const SOLANA_BALANCE_FIELDS = {
  transactionIndex: true,
  account: true,
  pre: true,
  post: true,
} as const;

const SOLANA_TOKEN_BALANCE_FIELDS = {
  transactionIndex: true,
  account: true,
  preProgramId: true,
  preMint: true,
  preDecimals: true,
  preOwner: true,
  preAmount: true,
  postProgramId: true,
  postMint: true,
  postDecimals: true,
  postOwner: true,
  postAmount: true,
} as const;

const SOLANA_REWARD_FIELDS = {
  pubkey: true,
  lamports: true,
  postBalance: true,
  rewardType: true,
  commission: true,
} as const;

const SOLANA_TRANSACTION_FIELDS = {
  transactionIndex: true,
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
  if (input.profile !== 'transactions' && input.profile !== 'ledger-records') {
    throw new RangeError('Unsupported SQD ingestion profile.');
  }

  const fields =
    input.dataset === 'bitcoin-mainnet'
      ? BITCOIN_TRANSACTION_FIELDS
      : input.dataset === 'solana-mainnet'
        ? SOLANA_TRANSACTION_FIELDS
        : EVM_TRANSACTION_FIELDS;
  const transactionRequest: SqdFinalizedRangeRequest = {
    ...range,
    fields: { transaction: fields },
    requests: { transactions: [{}] },
  };
  if (input.profile === 'transactions') return transactionRequest;

  if (input.dataset === 'bitcoin-mainnet') {
    return {
      ...range,
      fields: {
        transaction: fields,
        input: BITCOIN_INPUT_FIELDS,
        output: BITCOIN_OUTPUT_FIELDS,
      },
      requests: { transactions: [{}], inputs: [{}], outputs: [{}] },
    };
  }
  if (input.dataset === 'solana-mainnet') {
    return {
      ...range,
      fields: {
        transaction: fields,
        instruction: SOLANA_INSTRUCTION_FIELDS,
        log: SOLANA_LOG_FIELDS,
        balance: SOLANA_BALANCE_FIELDS,
        tokenBalance: SOLANA_TOKEN_BALANCE_FIELDS,
        reward: SOLANA_REWARD_FIELDS,
      },
      requests: {
        transactions: [{}],
        instructions: [{}],
        logs: [{}],
        balances: [{}],
        tokenBalances: [{}],
        rewards: [{}],
      },
    };
  }
  return {
    ...range,
    fields: {
      transaction: fields,
      log: EVM_LOG_FIELDS,
      trace: EVM_TRACE_FIELDS,
      stateDiff: EVM_STATE_DIFF_FIELDS,
    },
    requests: { transactions: [{}], logs: [{}], traces: [{}], stateDiffs: [{}] },
  };
}
