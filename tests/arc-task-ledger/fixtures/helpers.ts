import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type AbiEvent } from 'viem';
import { ABI, DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
import { protocolAtoms } from '../../../packages/arc-task-ledger/src/protocol.js';
import {
  RULE_VERSION,
  ZERO_ADDRESS,
  amount,
  known,
  emptyCoverage,
  type RawMeta,
  type RawLog,
  type Receipt,
  type SnapshotRun,
  type Snapshot,
} from '../../../packages/arc-task-ledger/src/types.js';
export const POSTER = '0x1111111111111111111111111111111111111111';
export const WORKER = '0x2222222222222222222222222222222222222222';
export const FEE = '0x3333333333333333333333333333333333333333';
export const HASH = `0x${'a'.repeat(64)}`;
export const TX = `0x${'b'.repeat(64)}`;
export const snapshot: Snapshot = {
  chainId: '5042',
  blockNumber: '22000000',
  blockHash: HASH,
  observedAt: '2026-10-04T00:00:00Z',
  finality: 'FINALIZED',
  sourceSet: ['test-only'],
};
export const meta = (changes: Partial<RawMeta> = {}): RawMeta => ({
  jobId: '8',
  poster: POSTER,
  reward: '1000000',
  deadline: '1',
  ipfsDescHash: 'cid',
  category: '研发',
  tags: [],
  agentId: '0',
  agentOnly: false,
  humanOnly: false,
  whitelistedProvider: ZERO_ADDRESS,
  assignedProvider: WORKER,
  submittedResultHash: 'result',
  submittedAt: '1',
  isTaken: true,
  rejectedAt: '0',
  rejectionReasonHash: '',
  inDispute: false,
  resolved: true,
  disputeInitiator: ZERO_ADDRESS,
  disputeRaisedAt: '0',
  disputeReasonHash: '',
  disputeResponseHash: '',
  disputeRulingHash: '',
  requireWorkerBond: false,
  workerBond: '0',
  ...changes,
});
export function event(
  name: string,
  args: Record<string, unknown>,
  index: number,
  emitter = DEPLOYMENT.adapter,
): RawLog {
  const item = ABI.find((e) => e.type === 'event' && e.name === name) as AbiEvent;
  const inputs = item.inputs.filter((i) => !i.indexed);
  const topics = encodeEventTopics({ abi: [item], eventName: name, args }) as `0x${string}`[];
  return {
    address: emitter,
    topics,
    data: encodeAbiParameters(
      inputs,
      inputs.map((i) => args[i.name!]),
    ),
    transactionHash: TX,
    blockHash: HASH,
    blockNumber: '0x14fb180',
    logIndex: `0x${index.toString(16)}`,
  };
}
export function transfer(
  from: string,
  to: string,
  atoms: string,
  index: number,
  system = true,
): RawLog {
  const item = parseAbiItem(
    'event Transfer(address indexed from,address indexed to,uint256 value)',
  );
  return {
    address: system ? DEPLOYMENT.usdcSystemEmitter : DEPLOYMENT.usdcErc20,
    topics: encodeEventTopics({
      abi: [item],
      eventName: 'Transfer',
      args: { from: from as `0x${string}`, to: to as `0x${string}` },
    }) as `0x${string}`[],
    data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(atoms)]),
    transactionHash: TX,
    blockHash: HASH,
    blockNumber: '0x14fb180',
    logIndex: `0x${index.toString(16)}`,
  };
}
export const receipt = (logs: RawLog[], changes: Partial<Receipt> = {}): Receipt => ({
  transactionHash: TX,
  transactionIndex: '0x0',
  blockHash: HASH,
  blockNumber: '0x14fb180',
  status: '0x1',
  gasUsed: '0x5208',
  effectiveGasPrice: '0x1',
  logs,
  ...changes,
});
export const completeLogs = () => [
  transfer(DEPLOYMENT.escrow, DEPLOYMENT.adapter, protocolAtoms('1000000'), 0),
  transfer(DEPLOYMENT.adapter, FEE, protocolAtoms('10000'), 1),
  event('ProtocolFeePaid', { jobId: 8n, recipient: FEE, amount: 10000n }, 2),
  transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('990000'), 3),
  event('BountyCompleted', { jobId: 8n, agentId: 0n, reputationScore: 100n }, 4),
];
export function run(id = 'test_run_a', ids = ['8', '19', '104']): SnapshotRun {
  const coverage = {
    ...emptyCoverage(),
    currentState: 'complete' as const,
    jobEnumeration: 'complete' as const,
    deploymentVerification: 'complete' as const,
  };
  return {
    id,
    snapshot,
    coverage,
    expiresAt: '2099-01-01T00:00:00Z',
    totalExpected: String(ids.length),
    errors: [],
    mode: 'stored-replay',
    jobs: ids.map((jobId) => ({
      job: {
        jobKey: `5042:${DEPLOYMENT.adapter}:${jobId}`,
        jobId,
        adapter: DEPLOYMENT.adapter,
        poster: POSTER,
        worker: known(WORKER),
        snapshot,
        reward: amount(known(protocolAtoms('1000000'))),
        lifecycle: 'TERMINAL_UNKNOWN',
        cashState: 'UNKNOWN',
        coverage,
        selfTake: false,
        confidence: { state: 'uncalibrated', reason: '测试' },
        modelVersion: RULE_VERSION,
      },
      rawState: meta({ jobId }),
      settlementLegs: [],
      timeline: [],
      nextTimelineCursor: known(''),
      evidence: [],
      ruleVersion: RULE_VERSION,
      pendingAccounts: [],
      gas: [],
      trace: 'NOT_QUERIED',
    })),
  };
}
