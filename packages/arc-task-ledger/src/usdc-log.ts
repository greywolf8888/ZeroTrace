import { decodeEventLog, parseAbiItem, toEventSelector } from 'viem';
import network from './usdc-network.json' with { type: 'json' };
import { address, decimal, type RawLog, type Receipt, type Movement } from './types.js';

export const USDC_NETWORK = network;
const transferAbi = [
  parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)'),
];
export const USDC_TRANSFER_TOPIC = toEventSelector(transferAbi[0]!);
export function usdcAtoms(value: string, decimals: 6 | 18): string {
  return (BigInt(decimal(value)) * (decimals === 6 ? 10n ** 12n : 1n)).toString();
}
export function decodeUsdcLog(
  log: RawLog,
  receipt: Receipt,
  evidenceIds: string[] = [],
):
  | { movement: Movement; interface: 'SYSTEM' | 'ERC20'; rawAtomic: string; decimals: 6 | 18 }
  | undefined {
  const emitter = address(log.address);
  if (
    ![network.systemEmitter, network.erc20Emitter].includes(emitter) ||
    log.topics[0] !== USDC_TRANSFER_TOPIC
  )
    return;
  const { args } = decodeEventLog({
    abi: transferAbi,
    data: log.data,
    topics: log.topics as [typeof log.data, ...(typeof log.data)[]],
    strict: true,
  });
  const decimals = emitter === network.systemEmitter ? 18 : 6;
  return {
    interface: decimals === 18 ? 'SYSTEM' : 'ERC20',
    rawAtomic: args.value.toString(),
    decimals,
    movement: {
      id: `${network.chainId}:${receipt.transactionHash}:${BigInt(log.logIndex)}`,
      transactionHash: receipt.transactionHash,
      blockHash: receipt.blockHash,
      logIndex: BigInt(log.logIndex).toString(),
      from: address(args.from),
      to: address(args.to),
      atomic: usdcAtoms(args.value.toString(), decimals),
      evidenceIds,
      crossCheck: 'absent',
    },
  };
}
