import { hashPayload } from '@zerotrace/evidence';
import {
  TokenFlowEdgeSchema,
  type Ledger,
  type TokenFlowEdge,
  type TokenFlowKind,
} from '@zerotrace/schemas';

export const TOKEN_FLOW_ENGINE_MODEL_VERSION = 'token-flow-v1.0.0' as const;

export interface CreateTokenFlowEdgeInput extends Omit<
  TokenFlowEdge,
  'schemaVersion' | 'id' | 'counterparties'
> {
  counterparties?: readonly string[];
}

export interface TokenFlowLedger {
  schemaVersion: 'token-flow-ledger-v1';
  ledger: Ledger;
  chainId: string;
  token: string;
  edges: readonly TokenFlowEdge[];
  walletDeltas: Readonly<Record<string, string>>;
  transferCount: number;
  successfulCount: number;
  failedCount: number;
  evidenceIds: readonly string[];
  resultHash: string;
}

export interface ClusterFlowSummary {
  externalTokenInflowRaw: string;
  externalTokenOutflowRaw: string;
  mintRaw: string;
  burnRaw: string;
  internalTransferRaw: string;
  dexBuyRaw: string;
  dexSellRaw: string;
  quoteAssets: Readonly<Record<string, string>>;
  netPositionDeltaRaw: string;
  evidenceIds: readonly string[];
}

export interface ReorgReconciliation {
  accepted: readonly TokenFlowEdge[];
  revokedEdgeIds: readonly string[];
  replacementEdgeIds: readonly string[];
}

export class TokenFlowConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenFlowConflictError';
  }
}

function canonicalSubject(ledger: Ledger, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new TypeError('Token flow subjects must not be empty.');
  return ledger === 'EVM' ? trimmed.toLowerCase() : trimmed;
}

function canonicalTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new TypeError('Token flow observedAt must be an ISO date-time.');
  return date.toISOString();
}

function quantity(value: string, field: string): string {
  if (!/^\d+$/.test(value)) throw new TypeError(`${field} must be an unsigned integer string.`);
  return BigInt(value).toString();
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function edgeIdentity(
  edge: Pick<TokenFlowEdge, 'chainId' | 'token' | 'transactionHash' | 'logIndex' | 'blockHash'>,
): string {
  return [edge.chainId, edge.token, edge.transactionHash, edge.logIndex, edge.blockHash].join(':');
}

function reorgIdentity(
  edge: Pick<TokenFlowEdge, 'chainId' | 'token' | 'transactionHash' | 'logIndex'>,
): string {
  return [edge.chainId, edge.token, edge.transactionHash, edge.logIndex].join(':');
}

function isZeroSubject(value: string): boolean {
  return /^0x0{40}$/.test(value);
}

export function tokenFlowEdgeIdFor(edge: Omit<TokenFlowEdge, 'id'>): string {
  return `tfe_${hashPayload({ schema: 'token-flow-edge-v1', edge }).slice(0, 24)}`;
}

export function createTokenFlowEdge(input: CreateTokenFlowEdgeInput): TokenFlowEdge {
  const ledger = input.ledger;
  const normalized: Omit<TokenFlowEdge, 'id'> = {
    schemaVersion: 'token-flow-edge-v1',
    ledger,
    chainId: input.chainId.trim(),
    token: canonicalSubject(ledger, input.token),
    blockNumber: quantity(input.blockNumber, 'blockNumber'),
    blockHash: input.blockHash.trim(),
    transactionHash: canonicalSubject(ledger, input.transactionHash),
    transactionIndex: quantity(input.transactionIndex, 'transactionIndex'),
    logIndex: quantity(input.logIndex, 'logIndex'),
    from: canonicalSubject(ledger, input.from),
    to: canonicalSubject(ledger, input.to),
    amountRaw: quantity(input.amountRaw, 'amountRaw'),
    kind: input.kind,
    execution: input.execution,
    finality: input.finality,
    evidenceId: input.evidenceId,
    observedAt: canonicalTime(input.observedAt),
    ...(input.quoteAsset === undefined
      ? {}
      : { quoteAsset: canonicalSubject(ledger, input.quoteAsset) }),
    ...(input.quoteAmountRaw === undefined
      ? {}
      : { quoteAmountRaw: quantity(input.quoteAmountRaw, 'quoteAmountRaw') }),
    ...(input.rawArtifactRef === undefined ? {} : { rawArtifactRef: input.rawArtifactRef }),
    counterparties: sortedUnique(input.counterparties ?? []),
  };
  const edge = { id: tokenFlowEdgeIdFor(normalized), ...normalized };
  return TokenFlowEdgeSchema.parse(edge);
}

function compareEdges(left: TokenFlowEdge, right: TokenFlowEdge): number {
  for (const [a, b] of [
    [left.blockNumber, right.blockNumber],
    [left.transactionIndex, right.transactionIndex],
    [left.logIndex, right.logIndex],
    [left.id, right.id],
  ] as const) {
    const comparison = a.localeCompare(b, 'en', { numeric: true });
    if (comparison !== 0) return comparison;
  }
  return 0;
}

/**
 * Deduplicates one exact log identity. A reorg is intentionally not hidden: a changed block hash
 * has a different identity and must be reconciled by the caller or by reconcileTokenFlowReorg.
 */
export function deduplicateTokenFlowEdges(edges: readonly TokenFlowEdge[]): TokenFlowEdge[] {
  const byIdentity = new Map<string, TokenFlowEdge>();
  for (const raw of edges) {
    const edge = TokenFlowEdgeSchema.parse(raw);
    const identity = edgeIdentity(edge);
    const existing = byIdentity.get(identity);
    if (existing !== undefined && existing.id !== edge.id) {
      throw new TokenFlowConflictError(`Conflicting payloads for token flow identity ${identity}.`);
    }
    byIdentity.set(identity, edge);
  }
  return [...byIdentity.values()].sort(compareEdges);
}

export function reconcileTokenFlowReorg(
  previous: readonly TokenFlowEdge[],
  observed: readonly TokenFlowEdge[],
): ReorgReconciliation {
  const oldEdges = deduplicateTokenFlowEdges(previous);
  const newEdges = deduplicateTokenFlowEdges(observed);
  const byReorgIdentity = new Map<string, TokenFlowEdge>();
  for (const edge of newEdges) byReorgIdentity.set(reorgIdentity(edge), edge);
  const revoked: string[] = [];
  const replacements: string[] = [];
  for (const oldEdge of oldEdges) {
    const replacement = byReorgIdentity.get(reorgIdentity(oldEdge));
    if (replacement !== undefined && replacement.blockHash !== oldEdge.blockHash) {
      revoked.push(oldEdge.id);
      replacements.push(replacement.id);
    }
  }
  return {
    accepted: newEdges,
    revokedEdgeIds: revoked.sort(),
    replacementEdgeIds: replacements.sort(),
  };
}

function addDelta(deltas: Map<string, bigint>, subject: string, amount: bigint): void {
  if (amount === 0n) return;
  deltas.set(subject, (deltas.get(subject) ?? 0n) + amount);
}

function applyWalletDelta(edge: TokenFlowEdge, deltas: Map<string, bigint>): void {
  const amount = BigInt(edge.amountRaw);
  if (edge.kind !== 'MINT' && !isZeroSubject(edge.from)) addDelta(deltas, edge.from, -amount);
  if (edge.kind !== 'BURN' && !isZeroSubject(edge.to)) addDelta(deltas, edge.to, amount);
}

export function materializeTokenFlow(edges: readonly TokenFlowEdge[]): TokenFlowLedger {
  const normalized = deduplicateTokenFlowEdges(edges);
  const first = normalized[0];
  if (first === undefined) {
    throw new TypeError('At least one token flow edge is required.');
  }
  const deltas = new Map<string, bigint>();
  const evidenceIds = new Set<string>();
  let failedCount = 0;
  let successfulCount = 0;
  for (const edge of normalized) {
    if (
      edge.ledger !== first.ledger ||
      edge.chainId !== first.chainId ||
      edge.token !== first.token
    ) {
      throw new TokenFlowConflictError(
        'All token flow edges must use one ledger, chain and token.',
      );
    }
    evidenceIds.add(edge.evidenceId);
    if (edge.execution !== 'SUCCESS') {
      failedCount += 1;
      continue;
    }
    successfulCount += 1;
    applyWalletDelta(edge, deltas);
  }
  const walletDeltas = Object.fromEntries(
    [...deltas.entries()]
      .filter(([, value]) => value !== 0n)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([subject, value]) => [subject, value.toString()]),
  );
  const result = {
    schemaVersion: 'token-flow-ledger-v1' as const,
    ledger: first.ledger,
    chainId: first.chainId,
    token: first.token,
    edges: normalized,
    walletDeltas,
    transferCount: normalized.length,
    successfulCount,
    failedCount,
    evidenceIds: [...evidenceIds].sort(),
  };
  return { ...result, resultHash: hashPayload(result) };
}

function addQuoteAsset(quotes: Map<string, bigint>, edge: TokenFlowEdge, amount: bigint): void {
  if (edge.quoteAsset === undefined || edge.quoteAmountRaw === undefined) return;
  const direction = edge.kind === 'DEX_BUY' ? -1n : edge.kind === 'DEX_SELL' ? 1n : 1n;
  quotes.set(edge.quoteAsset, (quotes.get(edge.quoteAsset) ?? 0n) + amount * direction);
}

/**
 * Classifies token edges relative to a frozen cluster version. Internal transfers are reported as
 * gross movement for explainability, but never enter net position accounting.
 */
export function summarizeClusterFlows(
  edges: readonly TokenFlowEdge[],
  memberWalletIds: readonly string[],
  options: { atBlock?: string } = {},
): ClusterFlowSummary {
  const members = new Set(memberWalletIds);
  const cutoff =
    options.atBlock === undefined ? undefined : BigInt(quantity(options.atBlock, 'atBlock'));
  let externalIn = 0n;
  let externalOut = 0n;
  let mint = 0n;
  let burn = 0n;
  let internal = 0n;
  let dexBuy = 0n;
  let dexSell = 0n;
  const quotes = new Map<string, bigint>();
  const evidenceIds = new Set<string>();
  for (const edge of deduplicateTokenFlowEdges(edges)) {
    if (edge.execution !== 'SUCCESS') continue;
    if (cutoff !== undefined && BigInt(edge.blockNumber) > cutoff) continue;
    const fromIn = members.has(edge.from);
    const toIn = members.has(edge.to);
    if (!fromIn && !toIn) continue;
    const amount = BigInt(edge.amountRaw);
    evidenceIds.add(edge.evidenceId);
    if (fromIn && toIn) {
      internal += amount;
      continue;
    }
    if (edge.kind === 'MINT') {
      if (toIn) mint += amount;
    } else if (edge.kind === 'BURN') {
      if (fromIn) burn += amount;
    } else if (toIn) {
      externalIn += amount;
      if (edge.kind === 'DEX_BUY') dexBuy += amount;
      addQuoteAsset(quotes, edge, amount);
    } else if (fromIn) {
      externalOut += amount;
      if (edge.kind === 'DEX_SELL') dexSell += amount;
      addQuoteAsset(quotes, edge, amount);
    }
  }
  const quoteAssets = Object.fromEntries(
    [...quotes.entries()]
      .filter(([, value]) => value !== 0n)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([asset, value]) => [asset, value.toString()]),
  );
  return {
    externalTokenInflowRaw: externalIn.toString(),
    externalTokenOutflowRaw: externalOut.toString(),
    mintRaw: mint.toString(),
    burnRaw: burn.toString(),
    internalTransferRaw: internal.toString(),
    dexBuyRaw: dexBuy.toString(),
    dexSellRaw: dexSell.toString(),
    quoteAssets,
    netPositionDeltaRaw: (externalIn - externalOut + mint - burn).toString(),
    evidenceIds: [...evidenceIds].sort(),
  };
}

export function flowKindIsTrading(kind: TokenFlowKind): boolean {
  return kind === 'DEX_BUY' || kind === 'DEX_SELL';
}
