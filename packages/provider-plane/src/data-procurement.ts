/** Monetary/quota invariants only. Persist the returned state inside the EXISTING DB transaction.
 * This module is not a second ledger and is not an authorization service by itself. */
export type Decimal = string;
export interface AccountBudget {
  providerIds: readonly string[];
  allowedCostKind: 'FREE_ONLY' | 'PAID_MAXIMUM';
  quotaRemaining: Decimal;
  costEvidence: string;
  enabled: boolean;
  rightsApproved: boolean;
}
export interface SpendPolicy {
  version: string;
  paidAllowed: boolean;
  approvedProviderIds: readonly string[];
}
export interface Quote {
  requestId: string;
  fingerprint: string;
  providerId: string;
  accountId: string;
  costKind: 'VERIFIED_FREE' | 'PAID_MAXIMUM' | 'UNKNOWN';
  maxUnits: Decimal;
  maxMicrousd: Decimal;
  evidence: string;
  expiresAt: number;
}
export interface Ticket extends Quote {
  policyVersion: string;
  state: 'RESERVED' | 'DISPATCHED' | 'UNCERTAIN' | 'SETTLED' | 'CANCELLED';
  actualUnits?: Decimal;
  actualMicrousd?: Decimal;
}
export interface ProcurementState {
  revision: number;
  remainingMicrousd: Decimal;
  accounts: Record<string, AccountBudget>;
  tickets: Record<string, Ticket>;
  blocked: boolean;
}
function n(v: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(v)) throw new Error('INVALID_NONNEGATIVE_INTEGER');
  return BigInt(v);
}
function safeKey(v: string): void {
  if (
    !/^[A-Za-z0-9_:.\-]{1,180}$/.test(v) ||
    ['__proto__', 'constructor', 'prototype'].includes(v)
  ) {
    throw new Error('INVALID_IDENTIFIER');
  }
}
function copy(s: ProcurementState): ProcurementState {
  return structuredClone(s);
}
function bump(s: ProcurementState): void {
  s.revision += 1;
}
export function reserveRequest(
  s: ProcurementState,
  p: SpendPolicy,
  q: Quote,
  now: number,
): ProcurementState {
  safeKey(q.requestId);
  safeKey(q.providerId);
  safeKey(q.accountId);
  if (!Number.isFinite(now) || !Number.isFinite(q.expiresAt) || q.expiresAt <= now)
    throw new Error('EXPIRED_QUOTE');
  if (!q.fingerprint || !q.evidence || !p.version) throw new Error('MISSING_COST_EVIDENCE');
  const old = Object.hasOwn(s.tickets, q.requestId) ? s.tickets[q.requestId] : undefined;
  if (old) {
    if (
      old.fingerprint !== q.fingerprint ||
      old.providerId !== q.providerId ||
      old.accountId !== q.accountId ||
      old.maxUnits !== q.maxUnits ||
      old.maxMicrousd !== q.maxMicrousd ||
      old.policyVersion !== p.version
    )
      throw new Error('REQUEST_ID_CONFLICT');
    return s; // A repeated task does NOT authorize another HTTP attempt.
  }
  if (s.blocked) throw new Error('BUDGET_RECONCILIATION_REQUIRED');
  const a = Object.hasOwn(s.accounts, q.accountId) ? s.accounts[q.accountId] : undefined;
  if (!a || !a.enabled || !a.rightsApproved || !a.costEvidence)
    throw new Error('SOURCE_NOT_AUTHORIZED');
  if (!a.providerIds.includes(q.providerId) || a.costEvidence !== q.evidence)
    throw new Error('COST_ACCOUNT_MAPPING_MISMATCH');
  if (q.costKind === 'VERIFIED_FREE' && a.allowedCostKind !== 'FREE_ONLY')
    throw new Error('CANNOT_RENAME_PAID_AS_FREE');
  const units = n(q.maxUnits),
    cost = n(q.maxMicrousd);
  if (units <= 0n || q.costKind === 'UNKNOWN') throw new Error('UNKNOWN_OR_INVALID_COST');
  if (q.costKind === 'VERIFIED_FREE' && cost !== 0n) throw new Error('FREE_QUOTE_WITH_COST');
  if (
    q.costKind === 'PAID_MAXIMUM' &&
    (!p.paidAllowed || !p.approvedProviderIds.includes(q.providerId))
  )
    throw new Error('PAID_NOT_APPROVED');
  if (units > n(a.quotaRemaining) || cost > n(s.remainingMicrousd))
    throw new Error('INSUFFICIENT_BUDGET');
  const out = copy(s);
  out.accounts[q.accountId]!.quotaRemaining = (n(a.quotaRemaining) - units).toString();
  out.remainingMicrousd = (n(s.remainingMicrousd) - cost).toString();
  out.tickets[q.requestId] = { ...q, policyVersion: p.version, state: 'RESERVED' };
  bump(out);
  return out;
}
export function dispatchRequest(
  s: ProcurementState,
  id: string,
  policyVersion: string,
  now: number,
): ProcurementState {
  safeKey(id);
  const t = Object.hasOwn(s.tickets, id) ? s.tickets[id] : undefined;
  if (!t || t.state !== 'RESERVED') throw new Error('NOT_DISPATCHABLE');
  if (t.policyVersion !== policyVersion || !Number.isFinite(now) || now >= t.expiresAt || s.blocked)
    throw new Error('DISPATCH_POLICY_OR_QUOTE_CHANGED');
  const a = s.accounts[t.accountId];
  if (!a?.enabled || !a.rightsApproved) throw new Error('SOURCE_NOT_AUTHORIZED');
  const out = copy(s);
  out.tickets[id]!.state = 'DISPATCHED';
  bump(out);
  return out;
}
export function finishRequest(
  s: ProcurementState,
  id: string,
  result:
    | { kind: 'NOT_DISPATCHED' }
    | { kind: 'UNKNOWN_CHARGE' }
    | { kind: 'CHARGED'; units: Decimal; microusd: Decimal },
): ProcurementState {
  safeKey(id);
  const t = Object.hasOwn(s.tickets, id) ? s.tickets[id] : undefined;
  if (!t) throw new Error('UNKNOWN_RESERVATION');
  if (result.kind === 'NOT_DISPATCHED') {
    if (t.state === 'CANCELLED') return s;
    if (t.state !== 'RESERVED') throw new Error('CANNOT_REFUND_DISPATCHED_REQUEST');
    const out = copy(s);
    out.accounts[t.accountId]!.quotaRemaining = (
      n(out.accounts[t.accountId]!.quotaRemaining) + n(t.maxUnits)
    ).toString();
    out.remainingMicrousd = (n(out.remainingMicrousd) + n(t.maxMicrousd)).toString();
    out.tickets[id]!.state = 'CANCELLED';
    bump(out);
    return out;
  }
  if (result.kind === 'UNKNOWN_CHARGE') {
    if (t.state === 'UNCERTAIN') return s;
    if (t.state !== 'DISPATCHED') throw new Error('REQUEST_NOT_DISPATCHED');
    const out = copy(s);
    out.tickets[id]!.state = 'UNCERTAIN';
    bump(out);
    return out; // Keep worst-case reservation.
  }
  n(result.units);
  n(result.microusd);
  if (t.state === 'SETTLED') {
    if (t.actualUnits !== result.units || t.actualMicrousd !== result.microusd)
      throw new Error('SETTLEMENT_CONFLICT');
    return s;
  }
  if (!['DISPATCHED', 'UNCERTAIN'].includes(t.state)) throw new Error('REQUEST_NOT_DISPATCHED');
  const out = copy(s);
  const u = n(t.maxUnits) - n(result.units),
    m = n(t.maxMicrousd) - n(result.microusd);
  // Record real consumption even if a supplier exceeded its quote. Never silently erase overruns.
  const remainU = n(out.accounts[t.accountId]!.quotaRemaining) + u,
    remainM = n(out.remainingMicrousd) + m;
  if (u < 0n || m < 0n || remainU < 0n || remainM < 0n) out.blocked = true;
  out.accounts[t.accountId]!.quotaRemaining = (remainU < 0n ? 0n : remainU).toString();
  out.remainingMicrousd = (remainM < 0n ? 0n : remainM).toString();
  out.tickets[id] = {
    ...t,
    state: 'SETTLED',
    actualUnits: result.units,
    actualMicrousd: result.microusd,
  };
  bump(out);
  return out;
}
