import { detectChangePoints } from '@zerotrace/campaign-intelligence';
import type { IndexedTransfer } from '@zerotrace/local-index';

export function campaignWindowsFromTransfers(
  transfers: readonly IndexedTransfer[],
): Array<{ start: number; end: number }> {
  if (transfers.length < 4) return [];
  const byBlock = new Map<string, bigint>();
  for (const item of transfers) {
    const key = item.blockNumber.toString(10);
    byBlock.set(key, (byBlock.get(key) ?? 0n) + BigInt(item.valueAtomic));
  }
  const series = [...byBlock.entries()]
    .sort((left, right) => (BigInt(left[0]) < BigInt(right[0]) ? -1 : 1))
    .map(([block, value]) => ({
      position: {
        ledger: 'EVM' as const,
        chainId: transfers[0]!.chainId,
        blockOrSlot: block,
      },
      value: value.toString(10),
    }));
  const points = detectChangePoints(series, 3).map((point) => Number(point.position.blockOrSlot));
  const bounds = [Number(series[0]!.position.blockOrSlot), ...points];
  const last = Number(series[series.length - 1]!.position.blockOrSlot);
  if (bounds[bounds.length - 1] !== last) bounds.push(last);
  const windows: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    windows.push({ start: bounds[index]!, end: bounds[index + 1]! });
  }
  return windows;
}
