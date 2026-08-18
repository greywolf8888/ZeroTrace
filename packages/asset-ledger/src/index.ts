import { contentAddressedId } from '@zerotrace/evidence';
import { type AssetId, type ChainPosition, type Ledger } from '@zerotrace/schemas';

export const ASSET_LEDGER_MODEL_VERSION = 'asset-ledger-v1.0.0';

export type AssetEventKind =
  | 'TRANSFER'
  | 'SWAP_IN'
  | 'SWAP_OUT'
  | 'MINT'
  | 'BURN'
  | 'LP_ADD'
  | 'LP_REMOVE'
  | 'FEE'
  | 'BRIDGE_DEPOSIT'
  | 'BRIDGE_RELEASE'
  | 'CEX_DEPOSIT'
  | 'GAS'
  | 'FAILED';

export interface AssetLedgerEvent {
  id: string;
  kind: AssetEventKind;
  ledger: Ledger;
  chainId: string;
  txId: string;
  position: ChainPosition;
  asset: AssetId;
  from: string;
  to: string;
  amountAtomic: string;
  swapGroupId?: string;
  matchedBridgeEventId?: string;
  internal: boolean;
  failed: boolean;
  evidenceIds: readonly string[];
}

export interface SwapLinkInput {
  txId: string;
  input: AssetLedgerEvent;
  output: AssetLedgerEvent;
  evidenceIds: readonly string[];
}

export function parseAtomic(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer string.`);
  }
  return BigInt(value);
}

export function linkSwapLegs(input: SwapLinkInput): {
  input: AssetLedgerEvent;
  output: AssetLedgerEvent;
  groupId: string;
} {
  if (input.input.txId !== input.output.txId || input.input.txId !== input.txId) {
    throw new Error('Swap legs must share one transaction identity.');
  }
  if (input.input.kind !== 'SWAP_IN' || input.output.kind !== 'SWAP_OUT') {
    throw new Error('Swap legs must be SWAP_IN then SWAP_OUT.');
  }
  if (input.input.failed || input.output.failed) {
    throw new Error('Failed execution cannot create a completed swap.');
  }
  const groupId = contentAddressedId('swp', {
    txId: input.txId,
    in: input.input.id,
    out: input.output.id,
  });
  return {
    groupId,
    input: { ...input.input, swapGroupId: groupId },
    output: { ...input.output, swapGroupId: groupId },
  };
}

export function assertNoUnlinkedSwapIncome(events: readonly AssetLedgerEvent[]): void {
  const groups = new Map<string, AssetLedgerEvent[]>();
  for (const event of events) {
    if (event.kind !== 'SWAP_IN' && event.kind !== 'SWAP_OUT') continue;
    if (event.swapGroupId === undefined) {
      throw new Error(`Swap event ${event.id} is missing an explicit swap group.`);
    }
    const list = groups.get(event.swapGroupId) ?? [];
    list.push(event);
    groups.set(event.swapGroupId, list);
  }
  for (const [groupId, legs] of groups) {
    const hasIn = legs.some((item) => item.kind === 'SWAP_IN');
    const hasOut = legs.some((item) => item.kind === 'SWAP_OUT');
    if (!hasIn || !hasOut) {
      throw new Error(`Swap group ${groupId} is incomplete and cannot be treated as income.`);
    }
  }
}

export function matchBridgePair(
  deposit: AssetLedgerEvent,
  release: AssetLedgerEvent,
): { deposit: AssetLedgerEvent; release: AssetLedgerEvent } {
  if (deposit.kind !== 'BRIDGE_DEPOSIT' || release.kind !== 'BRIDGE_RELEASE') {
    throw new Error('Bridge match requires deposit and release events.');
  }
  return {
    deposit: { ...deposit, matchedBridgeEventId: release.id },
    release: { ...release, matchedBridgeEventId: deposit.id },
  };
}

export function netAtomicFlow(
  events: readonly AssetLedgerEvent[],
  owner: string,
  token: string,
): bigint {
  let net = 0n;
  for (const event of events) {
    if (event.failed || event.asset.token !== token) continue;
    const amount = parseAtomic(event.amountAtomic, 'amountAtomic');
    if (event.to === owner) net += amount;
    if (event.from === owner) net -= amount;
  }
  return net;
}
