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

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

export function parseSpendPolicy(value: unknown): SpendPolicy {
  const input = record(value, 'INVALID_SPEND_POLICY');
  if (
    typeof input.version !== 'string' ||
    input.version.length === 0 ||
    typeof input.paidAllowed !== 'boolean' ||
    !Array.isArray(input.approvedProviderIds) ||
    input.approvedProviderIds.some((item) => typeof item !== 'string')
  ) {
    throw new Error('INVALID_SPEND_POLICY');
  }
  const approvedProviderIds = [...new Set(input.approvedProviderIds as string[])];
  approvedProviderIds.forEach(safeKey);
  if (!input.paidAllowed && approvedProviderIds.length > 0) {
    throw new Error('PAID_PROVIDER_WITHOUT_CONSENT');
  }
  return { version: input.version, paidAllowed: input.paidAllowed, approvedProviderIds };
}

export function parseProcurementState(value: unknown): ProcurementState {
  const input = record(value, 'INVALID_PROCUREMENT_STATE');
  if (
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0 ||
    typeof input.remainingMicrousd !== 'string' ||
    typeof input.blocked !== 'boolean'
  ) {
    throw new Error('INVALID_PROCUREMENT_STATE');
  }
  n(input.remainingMicrousd);
  const rawAccounts = record(input.accounts, 'INVALID_PROCUREMENT_ACCOUNTS');
  const accounts: Record<string, AccountBudget> = Object.create(null) as Record<
    string,
    AccountBudget
  >;
  for (const [accountId, raw] of Object.entries(rawAccounts)) {
    safeKey(accountId);
    const account = record(raw, 'INVALID_PROCUREMENT_ACCOUNT');
    if (
      !Array.isArray(account.providerIds) ||
      account.providerIds.some((item) => typeof item !== 'string') ||
      !['FREE_ONLY', 'PAID_MAXIMUM'].includes(String(account.allowedCostKind)) ||
      typeof account.quotaRemaining !== 'string' ||
      typeof account.costEvidence !== 'string' ||
      account.costEvidence.length === 0 ||
      typeof account.enabled !== 'boolean' ||
      typeof account.rightsApproved !== 'boolean'
    ) {
      throw new Error('INVALID_PROCUREMENT_ACCOUNT');
    }
    n(account.quotaRemaining);
    const providerIds = [...new Set(account.providerIds as string[])];
    providerIds.forEach(safeKey);
    accounts[accountId] = {
      providerIds,
      allowedCostKind: account.allowedCostKind as AccountBudget['allowedCostKind'],
      quotaRemaining: account.quotaRemaining,
      costEvidence: account.costEvidence,
      enabled: account.enabled,
      rightsApproved: account.rightsApproved,
    };
  }
  const rawTickets = record(input.tickets, 'INVALID_PROCUREMENT_TICKETS');
  const tickets: Record<string, Ticket> = Object.create(null) as Record<string, Ticket>;
  for (const [requestId, raw] of Object.entries(rawTickets)) {
    safeKey(requestId);
    const ticket = record(raw, 'INVALID_PROCUREMENT_TICKET');
    if (
      ticket.requestId !== requestId ||
      typeof ticket.fingerprint !== 'string' ||
      typeof ticket.providerId !== 'string' ||
      typeof ticket.accountId !== 'string' ||
      !['VERIFIED_FREE', 'PAID_MAXIMUM', 'UNKNOWN'].includes(String(ticket.costKind)) ||
      typeof ticket.maxUnits !== 'string' ||
      typeof ticket.maxMicrousd !== 'string' ||
      typeof ticket.evidence !== 'string' ||
      !Number.isFinite(ticket.expiresAt) ||
      typeof ticket.policyVersion !== 'string' ||
      !['RESERVED', 'DISPATCHED', 'UNCERTAIN', 'SETTLED', 'CANCELLED'].includes(
        String(ticket.state),
      )
    ) {
      throw new Error('INVALID_PROCUREMENT_TICKET');
    }
    safeKey(ticket.providerId);
    safeKey(ticket.accountId);
    n(ticket.maxUnits);
    n(ticket.maxMicrousd);
    if (ticket.actualUnits !== undefined) {
      if (typeof ticket.actualUnits !== 'string') throw new Error('INVALID_PROCUREMENT_TICKET');
      n(ticket.actualUnits);
    }
    if (ticket.actualMicrousd !== undefined) {
      if (typeof ticket.actualMicrousd !== 'string') throw new Error('INVALID_PROCUREMENT_TICKET');
      n(ticket.actualMicrousd);
    }
    tickets[requestId] = ticket as unknown as Ticket;
  }
  return {
    revision: input.revision as number,
    remainingMicrousd: input.remainingMicrousd,
    accounts,
    tickets,
    blocked: input.blocked,
  };
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
