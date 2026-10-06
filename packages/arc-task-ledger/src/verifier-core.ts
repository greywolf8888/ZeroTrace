import {
  LedgerError,
  address,
  ZERO_ADDRESS,
  type Movement,
  type RawLog,
  type Receipt,
} from './types.js';
import { decodeUsdcLog, USDC_NETWORK } from './usdc-log.js';

export const VERIFIER_RULE = 'zasv-rules-v1.0.0';
export const PARSER_VERSION = 'zasv-usdc-parser-v1.0.0';
export const REPORT_SCHEMA = 'zasv-report-v1';
export type AcquisitionState = 'READY' | 'PENDING' | 'UNAVAILABLE' | 'CONFLICT' | 'LIMIT_REACHED';
export type CheckState = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type Outcome = 'MATCHED' | 'MISMATCHED' | 'INCONCLUSIVE' | 'UNSUPPORTED';
export interface TransactionRaw {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  blockHash: string | null;
  blockNumber: string | null;
  transactionIndex: string | null;
}
export interface BlockRaw {
  hash: string;
  number: string;
  timestamp: string;
  transactions?: string[];
}
export interface RawAcquisition {
  chainId: string;
  transaction: TransactionRaw | null;
  receipt: Receipt | null;
  finalized: BlockRaw | null;
  blockBefore: BlockRaw | null;
  blockAfter: BlockRaw | null;
}
export interface UsdcMovement extends Omit<Movement, 'evidenceIds'> {
  kind: 'TRANSFER' | 'MINT' | 'BURN' | 'ZERO' | 'SELF';
  interface: 'NATIVE' | 'ERC20_MIRRORED' | 'AMBIGUOUS';
  mirrorLogIds: string[];
  rawAtomic: string;
  decimals: 18;
}
export interface TransactionFacts {
  schemaVersion: 'zasv-facts-v1';
  chainId: string;
  transactionHash: string;
  transactionSender: string;
  transactionTo: string | null;
  nativeValueAtomic18: string;
  blockHash: string;
  blockNumber: string;
  blockTimestamp: string;
  transactionIndex: string;
  receiptStatus: 'SUCCESS' | 'REVERTED';
  gasUsed: string;
  effectiveGasPrice: string;
  gasAtomic18: string;
  gasPayer: string;
  finalityBasis: 'SOURCE_REPORTED_FINALIZED';
  movements: UsdcMovement[];
  normalization: 'COMPLETE' | 'CONFLICT';
  normalizationIssues: string[];
}
export interface Acquisition {
  state: AcquisitionState;
  code: string;
  facts: TransactionFacts | null;
  completeness: 'COMPLETE_TRANSACTION' | 'INCOMPLETE';
}
export interface SettlementExpectation {
  schemaVersion: 'zasv-expectation-v1';
  chainId: string;
  asset: 'USDC';
  expectedPayee: string;
  expectedMovementPayer?: string;
  amountMode: 'EXACT' | 'RANGE';
  minAmountAtomic18: string;
  maxAmountAtomic18: string;
  notBefore?: string;
  deadline?: string;
  selection: string[];
  contextRef?: string;
  provenance: 'USER_INPUT' | 'REPORT_IMPORT' | 'REGISTERED_TASK';
}
export interface SettlementCheck {
  code: string;
  state: CheckState;
  expected: unknown;
  actual: unknown;
  movementIds: string[];
}
export interface SettlementEvaluation {
  outcome: Outcome;
  checks: SettlementCheck[];
  selectedMovementIds: string[];
  selectedAmountAtomic18: string | null;
  account: {
    payee: string;
    incomingAtomic18: string | null;
    outgoingAtomic18: string | null;
    netMovementAtomic18: string | null;
    gasAtomic18: string | null;
    netAfterGasAtomic18: string | null;
  };
  business: {
    purpose: 'NOT_VERIFIED';
    priorAgreement: 'NOT_VERIFIED';
    fulfillment: 'NOT_VERIFIED';
  };
}
export function parseTransactionInput(input: string): string {
  if (typeof input !== 'string' || input.length > 200)
    throw new LedgerError('INVALID_TRANSACTION', '请输入 Arc 主网交易哈希或官方交易链接。', 400);
  if (/^0x[0-9a-f]{64}$/i.test(input)) return input.toLowerCase();
  try {
    const u = new URL(input);
    if (
      u.origin === USDC_NETWORK.explorerOrigin &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      /^\/tx\/0x[0-9a-f]{64}\/?$/i.test(u.pathname)
    )
      return u.pathname.split('/')[2]!.toLowerCase();
  } catch {
    /* 按规范拒绝，链接仅解析，不抓取。 */
  }
  throw new LedgerError(
    'INVALID_TRANSACTION',
    '只接受规范哈希或登记的 Arc 主网 explorer 交易链接。',
    400,
  );
}
function quantity(value: unknown): string {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) || value.length > 66)
    throw new LedgerError('INVALID_CHAIN_DATA', '链原件整数不合法。', 409);
  return BigInt(value).toString();
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
    throw new LedgerError('INVALID_CHAIN_DATA', '链原件摘要缺失。', 409);
  return value.toLowerCase();
}
function identity(log: RawLog): string {
  return `${USDC_NETWORK.chainId}:${hash(log.transactionHash)}:${quantity(log.logIndex)}`;
}
function logSignature(log: RawLog): string {
  return JSON.stringify([
    address(log.address),
    log.topics.map(hash),
    log.data.toLowerCase(),
    hash(log.blockHash),
    quantity(log.blockNumber),
    quantity(log.logIndex),
    quantity((log as RawLog & { transactionIndex: string }).transactionIndex),
    log.removed === true,
  ]);
}
export function normalizeTransaction(transactionHash: string, raw: RawAcquisition): Acquisition {
  const incomplete = (state: AcquisitionState, code: string): Acquisition => ({
    state,
    code,
    facts: null,
    completeness: 'INCOMPLETE',
  });
  try {
    if (quantity(raw.chainId) !== USDC_NETWORK.chainId)
      return incomplete('CONFLICT', 'WRONG_CHAIN');
    if (!raw.transaction) return incomplete('UNAVAILABLE', 'TRANSACTION_NOT_FOUND');
    const tx = raw.transaction;
    if (hash(tx.hash) !== transactionHash)
      return incomplete('CONFLICT', 'TRANSACTION_HASH_CONFLICT');
    if (!raw.receipt && tx.blockHash === null && tx.blockNumber === null)
      return incomplete('PENDING', 'TRANSACTION_PENDING');
    if (!raw.receipt) return incomplete('UNAVAILABLE', 'RECEIPT_UNAVAILABLE');
    const receipt = raw.receipt;
    const block = raw.blockBefore;
    const after = raw.blockAfter;
    const final = raw.finalized;
    if (!block || !after || !final) return incomplete('UNAVAILABLE', 'ANCHOR_UNAVAILABLE');
    const height = quantity(receipt.blockNumber);
    const index = quantity(receipt.transactionIndex);
    if (
      hash(receipt.transactionHash) !== transactionHash ||
      hash(tx.blockHash) !== hash(receipt.blockHash) ||
      quantity(tx.blockNumber) !== height ||
      quantity(tx.transactionIndex) !== index ||
      quantity(block.number) !== height ||
      quantity(after.number) !== height ||
      hash(block.hash) !== hash(receipt.blockHash) ||
      hash(after.hash) !== hash(block.hash)
    )
      return incomplete('CONFLICT', 'SOURCE_CONFLICT');
    if (BigInt(height) > BigInt(quantity(final.number)))
      return incomplete('PENDING', 'NOT_FINALIZED');
    if (
      !Array.isArray(block.transactions) ||
      block.transactions[Number(BigInt(index))]?.toLowerCase() !== transactionHash
    )
      return incomplete('CONFLICT', 'BLOCK_TRANSACTION_CONFLICT');
    const timestamp = BigInt(quantity(block.timestamp));
    if (timestamp > 8640000000000n) return incomplete('CONFLICT', 'BLOCK_TIME_INVALID');
    const blockTimestamp = new Date(Number(timestamp) * 1000).toISOString();
    if (
      !Array.isArray(receipt.logs) ||
      receipt.logs.length > 20000 ||
      !['0x0', '0x1'].includes(receipt.status)
    )
      return incomplete('UNAVAILABLE', 'RECEIPT_INVALID');
    const seen = new Map<string, string>();
    const system: UsdcMovement[] = [];
    const erc: Movement[] = [];
    const issues: string[] = [];
    for (const log of receipt.logs) {
      if (
        log.removed === true ||
        hash(log.transactionHash) !== transactionHash ||
        hash(log.blockHash) !== hash(block.hash) ||
        quantity(log.blockNumber) !== height ||
        quantity((log as RawLog & { transactionIndex: string }).transactionIndex) !== index ||
        !Array.isArray(log.topics) ||
        log.topics.length > 4 ||
        !/^0x(?:[0-9a-f]{2})*$/i.test(log.data)
      )
        return incomplete('CONFLICT', 'LOG_IDENTITY_CONFLICT');
      const id = identity(log);
      const signature = logSignature(log);
      const old = seen.get(id);
      if (old !== undefined) {
        if (old !== signature) return incomplete('CONFLICT', 'DUPLICATE_IDENTITY_CONFLICT');
        continue;
      }
      seen.set(id, signature);
      const decoded = decodeUsdcLog(
        { ...log, transactionHash },
        { ...receipt, transactionHash, blockHash: hash(block.hash) },
      );
      if (!decoded) continue;
      const m = decoded.movement;
      if (decoded.interface === 'ERC20') {
        erc.push(m);
        continue;
      }
      const kind =
        m.from === ZERO_ADDRESS
          ? 'MINT'
          : m.to === ZERO_ADDRESS
            ? 'BURN'
            : m.atomic === '0'
              ? 'ZERO'
              : m.from === m.to
                ? 'SELF'
                : 'TRANSFER';
      system.push({
        ...m,
        kind,
        interface: 'NATIVE',
        mirrorLogIds: [],
        rawAtomic: decoded.rawAtomic,
        decimals: 18,
      });
      if (kind === 'ZERO' || kind === 'SELF') issues.push('SYSTEM_EVENT_SEMANTICS_CONFLICT');
    }
    const key = (m: Pick<Movement, 'from' | 'to' | 'atomic'>) => `${m.from}:${m.to}:${m.atomic}`;
    for (const m of system) {
      const peers = erc.filter((e) => key(e) === key(m));
      const same = system.filter((e) => key(e) === key(m));
      m.mirrorLogIds = peers
        .sort((a, b) => (BigInt(a.logIndex) < BigInt(b.logIndex) ? -1 : 1))
        .map((e) => e.id);
      m.crossCheck =
        peers.length === 0
          ? 'absent'
          : peers.length === 1 && same.length === 1
            ? 'matched'
            : 'ambiguous';
      m.interface =
        peers.length === 0 ? 'NATIVE' : m.crossCheck === 'matched' ? 'ERC20_MIRRORED' : 'AMBIGUOUS';
    }
    for (const e of erc) {
      if (e.atomic === '0' || e.from === e.to) continue; // ERC20零值/自转不产生规范系统movement。
      if (
        erc.filter((p) => key(p) === key(e)).length > system.filter((m) => key(m) === key(e)).length
      )
        issues.push('ERC20_MULTIPLICITY_CONFLICT');
    }
    if (receipt.status === '0x0' && receipt.logs.length) issues.push('REVERTED_RECEIPT_WITH_LOGS');
    const gasUsed = quantity(receipt.gasUsed);
    const price = quantity(receipt.effectiveGasPrice);
    const sender = address(tx.from);
    const facts: TransactionFacts = {
      schemaVersion: 'zasv-facts-v1',
      chainId: USDC_NETWORK.chainId,
      transactionHash,
      transactionSender: sender,
      transactionTo: tx.to === null ? null : address(tx.to),
      nativeValueAtomic18: quantity(tx.value),
      blockHash: hash(block.hash),
      blockNumber: height,
      blockTimestamp,
      transactionIndex: index,
      receiptStatus: receipt.status === '0x1' ? 'SUCCESS' : 'REVERTED',
      gasUsed,
      effectiveGasPrice: price,
      gasAtomic18: (BigInt(gasUsed) * BigInt(price)).toString(),
      gasPayer: sender,
      finalityBasis: 'SOURCE_REPORTED_FINALIZED',
      movements: system.sort((a, b) => (BigInt(a.logIndex) < BigInt(b.logIndex) ? -1 : 1)),
      normalization: issues.length ? 'CONFLICT' : 'COMPLETE',
      normalizationIssues: [...new Set(issues)].sort(),
    };
    return {
      state: issues.length ? 'CONFLICT' : 'READY',
      code: issues.length ? 'NORMALIZATION_CONFLICT' : 'TRANSACTION_OBSERVED',
      facts,
      completeness: issues.length ? 'INCOMPLETE' : 'COMPLETE_TRANSACTION',
    };
  } catch {
    return incomplete('CONFLICT', 'INVALID_CHAIN_DATA');
  }
}
export function parseExpectation(value: unknown): SettlementExpectation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LedgerError('INVALID_EXPECTATION', '核对条件结构不合法。', 400);
  const v = value as Record<string, unknown>;
  const allowed = [
    'schemaVersion',
    'chainId',
    'asset',
    'expectedPayee',
    'expectedMovementPayer',
    'amountMode',
    'minAmountAtomic18',
    'maxAmountAtomic18',
    'notBefore',
    'deadline',
    'selection',
    'contextRef',
    'provenance',
  ];
  if (
    Object.keys(v).some((k) => !allowed.includes(k)) ||
    v.schemaVersion !== 'zasv-expectation-v1' ||
    v.asset !== 'USDC' ||
    typeof v.chainId !== 'string' ||
    !/^[1-9][0-9]{0,20}$/.test(v.chainId) ||
    !['EXACT', 'RANGE'].includes(String(v.amountMode)) ||
    !['USER_INPUT', 'REPORT_IMPORT', 'REGISTERED_TASK'].includes(String(v.provenance))
  )
    throw new LedgerError('INVALID_EXPECTATION', '核对条件版本或字段不合法。', 400);
  for (const name of ['minAmountAtomic18', 'maxAmountAtomic18'])
    if (typeof v[name] !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v[name] as string))
      throw new LedgerError('INVALID_AMOUNT', '金额必须是精确18位原子整数。', 400);
  if (
    BigInt(v.minAmountAtomic18 as string) > BigInt(v.maxAmountAtomic18 as string) ||
    (v.amountMode === 'EXACT' && v.minAmountAtomic18 !== v.maxAmountAtomic18)
  )
    throw new LedgerError('INVALID_AMOUNT', '金额范围不合法。', 400);
  if (
    !Array.isArray(v.selection) ||
    v.selection.length < 1 ||
    v.selection.length > 100 ||
    v.selection.some(
      (s) => typeof s !== 'string' || !/^5042:0x[0-9a-f]{64}:(0|[1-9][0-9]{0,20})$/.test(s),
    ) ||
    new Set(v.selection).size !== v.selection.length
  )
    throw new LedgerError('INVALID_SELECTION', '请明确选择本交易的规范系统movement。', 400);
  const e = {
    ...v,
    expectedPayee: address(String(v.expectedPayee)),
    selection: [...v.selection].sort(),
  } as unknown as SettlementExpectation;
  if (v.expectedMovementPayer !== undefined)
    e.expectedMovementPayer = address(String(v.expectedMovementPayer));
  for (const field of ['notBefore', 'deadline'] as const)
    if (v[field] !== undefined) {
      const t = v[field];
      if (
        typeof t !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(t) ||
        !Number.isFinite(Date.parse(t)) ||
        new Date(t).toISOString() !== (t.includes('.') ? t : t.replace('Z', '.000Z'))
      )
        throw new LedgerError('INVALID_TIME', '时间须为UTC ISO格式。', 400);
      e[field] = new Date(t).toISOString();
    }
  if (e.notBefore && e.deadline && e.notBefore > e.deadline)
    throw new LedgerError('INVALID_TIME', '时间窗口不合法。', 400);
  if (v.contextRef !== undefined && (typeof v.contextRef !== 'string' || v.contextRef.length > 120))
    throw new LedgerError('INVALID_CONTEXT', '业务参考超过长度限制。', 400);
  return e;
}
export function decimalUsdcToAtomic18(input: string): string {
  if (!/^(0|[1-9][0-9]{0,59})(?:\.[0-9]{1,18})?$/.test(input))
    throw new LedgerError('INVALID_AMOUNT', '请输入最多18位小数的精确USDC金额。', 400);
  const [whole, fraction = ''] = input.split('.');
  return (BigInt(whole!) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))).toString();
}
export function displayUsdc(atomic: string): string {
  const n = BigInt(atomic);
  const sign = n < 0n ? '-' : '';
  const a = n < 0n ? -n : n;
  return `${sign}${a / 10n ** 18n}.${(a % 10n ** 18n).toString().padStart(18, '0')}`
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}
export function evaluateSettlement(
  acquisition: Acquisition,
  expectation: SettlementExpectation,
): SettlementEvaluation {
  const e = parseExpectation(expectation);
  const f = acquisition.facts;
  const checks: SettlementCheck[] = [];
  const add = (
    code: string,
    state: CheckState,
    expected: unknown,
    actual: unknown,
    ids: string[] = [],
  ) => checks.push({ code, state, expected, actual, movementIds: ids });
  add('CHAIN', e.chainId === USDC_NETWORK.chainId ? 'PASS' : 'FAIL', e.chainId, f?.chainId ?? null);
  add(
    'ACQUISITION',
    acquisition.state === 'READY' ? 'PASS' : 'UNKNOWN',
    'READY',
    acquisition.state,
  );
  add(
    'TRANSACTION_SUCCESS',
    f ? (f.receiptStatus === 'SUCCESS' ? 'PASS' : 'FAIL') : 'UNKNOWN',
    'SUCCESS',
    f?.receiptStatus ?? null,
  );
  const selected = f?.movements.filter((m) => e.selection.includes(m.id)) ?? [];
  const selectable = acquisition.state === 'READY' && selected.length === e.selection.length;
  add(
    'SELECTION',
    acquisition.state !== 'READY' ? 'UNKNOWN' : selectable ? 'PASS' : 'FAIL',
    e.selection,
    selected.map((m) => m.id),
    e.selection,
  );
  add(
    'PAYMENT_MOVEMENT',
    !selectable ? 'UNKNOWN' : selected.every((m) => m.kind === 'TRANSFER') ? 'PASS' : 'FAIL',
    'TRANSFER',
    selected.map((m) => m.kind),
    e.selection,
  );
  add(
    'PAYEE',
    !selectable ? 'UNKNOWN' : selected.every((m) => m.to === e.expectedPayee) ? 'PASS' : 'FAIL',
    e.expectedPayee,
    selected.map((m) => m.to),
    e.selection,
  );
  add(
    'MOVEMENT_PAYER',
    !e.expectedMovementPayer
      ? 'NOT_APPLICABLE'
      : !selectable
        ? 'UNKNOWN'
        : selected.every((m) => m.from === e.expectedMovementPayer)
          ? 'PASS'
          : 'FAIL',
    e.expectedMovementPayer ?? null,
    selected.map((m) => m.from),
    e.selection,
  );
  const amount = selectable ? selected.reduce((n, m) => n + BigInt(m.atomic), 0n).toString() : null;
  add(
    'AMOUNT',
    amount === null
      ? 'UNKNOWN'
      : BigInt(amount) >= BigInt(e.minAmountAtomic18) &&
          BigInt(amount) <= BigInt(e.maxAmountAtomic18)
        ? 'PASS'
        : 'FAIL',
    { mode: e.amountMode, min: e.minAmountAtomic18, max: e.maxAmountAtomic18 },
    amount,
    e.selection,
  );
  for (const [field, code] of [
    ['notBefore', 'NOT_BEFORE'],
    ['deadline', 'DEADLINE'],
  ] as const)
    add(
      code,
      !e[field]
        ? 'NOT_APPLICABLE'
        : !f || acquisition.state !== 'READY'
          ? 'UNKNOWN'
          : (field === 'notBefore' ? f.blockTimestamp >= e[field]! : f.blockTimestamp <= e[field]!)
            ? 'PASS'
            : 'FAIL',
      e[field] ?? null,
      f?.blockTimestamp ?? null,
    );
  const known = acquisition.state === 'READY' && !!f;
  const sum = (side: 'from' | 'to') =>
    known
      ? f!.movements
          .filter((m) => m[side] === e.expectedPayee)
          .reduce((n, m) => n + BigInt(m.atomic), 0n)
      : null;
  const incoming = sum('to'),
    outgoing = sum('from');
  const net = incoming === null || outgoing === null ? null : incoming - outgoing;
  const gas = known && f!.gasPayer === e.expectedPayee ? f!.gasAtomic18 : null;
  const outcome = checks.some((c) => c.state === 'FAIL')
    ? 'MISMATCHED'
    : checks.some((c) => c.state === 'UNKNOWN')
      ? 'INCONCLUSIVE'
      : 'MATCHED';
  return {
    outcome,
    checks,
    selectedMovementIds: e.selection,
    selectedAmountAtomic18: amount,
    account: {
      payee: e.expectedPayee,
      incomingAtomic18: incoming?.toString() ?? null,
      outgoingAtomic18: outgoing?.toString() ?? null,
      netMovementAtomic18: net?.toString() ?? null,
      gasAtomic18: gas,
      netAfterGasAtomic18:
        net === null ? null : gas === null ? net.toString() : (net - BigInt(gas)).toString(),
    },
    business: {
      purpose: 'NOT_VERIFIED',
      priorAgreement: 'NOT_VERIFIED',
      fulfillment: 'NOT_VERIFIED',
    },
  };
}
