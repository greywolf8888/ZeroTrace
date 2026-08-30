import { hashPayload } from '@zerotrace/evidence';

export const PAPER_SIMULATION_MODEL_VERSION = 'paper-simulation-v1.0.0';

export type PaperChain = 'BSC' | 'SOLANA';
export type PaperEventType =
  | 'CANDIDATE_ENTERED'
  | 'PREPARE_BUY'
  | 'PAPER_BUY_STARTED'
  | 'PAPER_BUY_PARTIAL'
  | 'PAPER_BUY_PARTIAL_CLOSED'
  | 'PAPER_BUY_FILLED'
  | 'PAPER_BUY_FAILED'
  | 'PREPARE_SELL'
  | 'PAPER_SELL_STARTED'
  | 'PAPER_SELL_PARTIAL'
  | 'PAPER_SELL_PARTIAL_CLOSED'
  | 'PAPER_SELL_FILLED'
  | 'PAPER_SELL_FAILED'
  | 'SIGNAL_INVALIDATED'
  | 'RISK_EXIT_REQUIRED'
  | 'DATA_DEGRADED';

export interface PaperPositionPolicy {
  version: string;
  targetPositionBps: number;
  maxSinglePositionBps: number;
  maxControllerGroupBps: number;
  maxNarrativeGroupBps: number;
  maxTotalInvestedBps: number;
  minimumUncommittedCashBps: number;
  minimumFeeReserveBps: number;
  opaqueTokenStressLossBps: number;
}

export interface PaperPosition {
  assetId: string;
  controllerGroupId: string;
  narrativeGroupId: string;
  quantityAtomic: string;
  reservedQuantityAtomic: string;
  costBasisAtomic: string;
}

export interface PaperIntent {
  id: string;
  candidateEpoch: string;
  strategyVersion: string;
  side: 'BUY' | 'SELL';
  assetId: string;
  controllerGroupId: string;
  narrativeGroupId: string;
  status: 'STARTED' | 'PARTIAL' | 'FILLED' | 'FAILED' | 'CANCELLED';
  requestedAtomic: string;
  remainingAtomic: string;
  reservedCashAtomic: string;
  maximumFeeAtomic: string;
  fillIds: string[];
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PaperEvent {
  id: string;
  type: PaperEventType;
  experimentId: string;
  chain: PaperChain;
  assetId: string;
  strategyVersion: string;
  candidateEpoch: string;
  intentId: string | null;
  fillId: string | null;
  eventAt: string;
  reasons: string[];
  evidenceIds: string[];
}

export interface PaperOutboxRecord {
  id: string;
  businessKey: string;
  eventId: string;
  eventType: PaperEventType;
  title: string;
  urgency: 'NORMAL' | 'URGENT';
  deliveryState: 'PENDING';
  createdAt: string;
  payloadHash: string;
}

export interface PaperExperiment {
  schemaVersion: 'paper-experiment-v1';
  id: string;
  name: string;
  chain: PaperChain;
  baseAsset: 'BNB' | 'SOL';
  baseDecimals: 18 | 9;
  initialPrincipalAtomic: string;
  realizedPnlAtomic: string;
  availableCashAtomic: string;
  reservedCashAtomic: string;
  positions: PaperPosition[];
  intents: PaperIntent[];
  events: PaperEvent[];
  outbox: PaperOutboxRecord[];
  processedCommands: Array<{ id: string; hash: string }>;
  policy: PaperPositionPolicy;
  revision: number;
  createdAt: string;
  updatedAt: string;
  modelVersion: typeof PAPER_SIMULATION_MODEL_VERSION;
}

interface CommandBase {
  commandId: string;
  assetId: string;
  strategyVersion: string;
  candidateEpoch: string;
  eventAt: string;
  reasons: readonly string[];
  evidenceIds: readonly string[];
}

export type PaperCommand =
  | (CommandBase & { type: 'ENTER_CANDIDATE' })
  | (CommandBase & {
      type: 'PREPARE_BUY';
      currentValues: Readonly<Record<string, string>>;
      unmetConditions: readonly string[];
    })
  | (CommandBase & {
      type: 'START_BUY';
      controllerGroupId: string;
      narrativeGroupId: string;
      requestedQuoteAtomic: string;
      maximumFeeAtomic: string;
      maximumWorstLossAtomic: string;
      exitCapacityQuoteAtomic: string;
      quoteAvailableAt: string;
      quoteValidUntil: string;
      hardConditions: ReadonlyArray<{ id: string; state: 'PASS' | 'FAIL' | 'UNKNOWN' | 'STALE' }>;
    })
  | (CommandBase & {
      type: 'RECORD_BUY_FILL';
      intentId: string;
      fillId: string;
      quoteSpentAtomic: string;
      feeAtomic: string;
      tokenReceivedAtomic: string;
      final: boolean;
    })
  | (CommandBase & {
      type: 'FAIL_BUY';
      intentId: string;
      failureFeeAtomic: string;
    })
  | (CommandBase & { type: 'PREPARE_SELL'; quantityAtomic: string })
  | (CommandBase & {
      type: 'START_SELL';
      controllerGroupId: string;
      narrativeGroupId: string;
      requestedTokenAtomic: string;
      sellableTokenAtomic:
        | { state: 'known'; value: string }
        | { state: 'unknown' | 'unavailable' | 'stale'; reason: string };
      maximumFeeAtomic: string;
      quoteAvailableAt: string;
      quoteValidUntil: string;
      urgent: boolean;
    })
  | (CommandBase & {
      type: 'RECORD_SELL_FILL';
      intentId: string;
      fillId: string;
      tokenSoldAtomic: string;
      quoteReceivedAtomic: string;
      feeAtomic: string;
      final: boolean;
    })
  | (CommandBase & {
      type: 'FAIL_SELL';
      intentId: string;
      failureFeeAtomic: string;
    })
  | (CommandBase & { type: 'INVALIDATE_SIGNAL'; intentId?: string })
  | (CommandBase & { type: 'DATA_DEGRADED' });

function atomic(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${field} must be an unsigned atomic value.`);
  return BigInt(value);
}

function signedAtomic(value: string, field: string): bigint {
  if (!/^-?(0|[1-9]\d*)$/.test(value)) throw new Error(`${field} must be an integer atomic value.`);
  return BigInt(value);
}

function iso(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date-time.`);
  return parsed.toISOString();
}

function bps(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field} must be integer basis points.`);
  }
  return value;
}

function canonicalStrings(values: readonly string[], field: string): string[] {
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error(`${field} contains an empty value.`);
  }
  return [...new Set(values)].sort();
}

function minimum(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new Error('MINIMUM_REQUIRES_VALUES');
  return values.reduce((current, value) => (value < current ? value : current));
}

function exposure(
  positions: readonly PaperPosition[],
  predicate: (item: PaperPosition) => boolean,
): bigint {
  return positions
    .filter(predicate)
    .reduce((sum, position) => sum + atomic(position.costBasisAtomic, 'costBasisAtomic'), 0n);
}

function headroom(limit: bigint, used: bigint): bigint {
  return limit > used ? limit - used : 0n;
}

function policyAmount(base: bigint, valueBps: number): bigint {
  return (base * BigInt(valueBps)) / 10_000n;
}

function validatePolicy(policy: PaperPositionPolicy): PaperPositionPolicy {
  if (!policy.version) throw new Error('PAPER_POLICY_VERSION_REQUIRED');
  for (const [field, value] of Object.entries(policy).filter(([field]) => field !== 'version')) {
    bps(value as number, field);
  }
  if (
    policy.targetPositionBps > policy.maxSinglePositionBps ||
    policy.maxSinglePositionBps > policy.maxControllerGroupBps ||
    policy.maxControllerGroupBps > policy.maxNarrativeGroupBps ||
    policy.maxTotalInvestedBps + policy.minimumUncommittedCashBps + policy.minimumFeeReserveBps >
      10_000 ||
    policy.opaqueTokenStressLossBps !== 10_000
  ) {
    throw new Error('PAPER_POLICY_CONSTRAINT_INVALID');
  }
  return { ...policy };
}

export function createPaperExperiment(input: {
  name: string;
  chain: PaperChain;
  initialPrincipalAtomic: string;
  policy: PaperPositionPolicy;
  createdAt?: string;
}): PaperExperiment {
  if (!input.name.trim()) throw new Error('PAPER_EXPERIMENT_NAME_REQUIRED');
  const initial = atomic(input.initialPrincipalAtomic, 'initialPrincipalAtomic');
  if (initial <= 0n) throw new Error('PAPER_INITIAL_PRINCIPAL_REQUIRED');
  const createdAt = iso(input.createdAt ?? new Date().toISOString(), 'createdAt');
  const policy = validatePolicy(input.policy);
  const identity = {
    schemaVersion: 'paper-experiment-v1',
    name: input.name.trim(),
    chain: input.chain,
    initialPrincipalAtomic: initial.toString(),
    policyVersion: policy.version,
    createdAt,
  };
  return {
    schemaVersion: 'paper-experiment-v1',
    id: `pex_${hashPayload(identity).slice(0, 24)}`,
    name: input.name.trim(),
    chain: input.chain,
    baseAsset: input.chain === 'BSC' ? 'BNB' : 'SOL',
    baseDecimals: input.chain === 'BSC' ? 18 : 9,
    initialPrincipalAtomic: initial.toString(),
    realizedPnlAtomic: '0',
    availableCashAtomic: initial.toString(),
    reservedCashAtomic: '0',
    positions: [],
    intents: [],
    events: [],
    outbox: [],
    processedCommands: [],
    policy,
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    modelVersion: PAPER_SIMULATION_MODEL_VERSION,
  };
}

function commandEventType(command: PaperCommand): PaperEventType {
  switch (command.type) {
    case 'ENTER_CANDIDATE':
      return 'CANDIDATE_ENTERED';
    case 'PREPARE_BUY':
      return 'PREPARE_BUY';
    case 'START_BUY':
      return 'PAPER_BUY_STARTED';
    case 'FAIL_BUY':
      return 'PAPER_BUY_FAILED';
    case 'PREPARE_SELL':
      return 'PREPARE_SELL';
    case 'START_SELL':
      return 'PAPER_SELL_STARTED';
    case 'FAIL_SELL':
      return 'PAPER_SELL_FAILED';
    case 'INVALIDATE_SIGNAL':
      return 'SIGNAL_INVALIDATED';
    case 'DATA_DEGRADED':
      return 'DATA_DEGRADED';
    case 'RECORD_BUY_FILL':
    case 'RECORD_SELL_FILL':
      throw new Error('Fill event type depends on its final and remaining state.');
  }
}

const EVENT_TITLE: Record<PaperEventType, string> = {
  CANDIDATE_ENTERED: '候选已进入跟踪',
  PREPARE_BUY: '准备模拟买入',
  PAPER_BUY_STARTED: '开始模拟买入',
  PAPER_BUY_PARTIAL: '模拟买入部分成交',
  PAPER_BUY_PARTIAL_CLOSED: '模拟买入部分成交后关闭余量',
  PAPER_BUY_FILLED: '模拟买入已成交',
  PAPER_BUY_FAILED: '模拟买入失败',
  PREPARE_SELL: '准备模拟卖出',
  PAPER_SELL_STARTED: '开始模拟卖出',
  PAPER_SELL_PARTIAL: '模拟卖出部分成交',
  PAPER_SELL_PARTIAL_CLOSED: '模拟卖出部分成交后关闭余量',
  PAPER_SELL_FILLED: '模拟卖出已成交',
  PAPER_SELL_FAILED: '模拟卖出失败',
  SIGNAL_INVALIDATED: '条件已失效',
  RISK_EXIT_REQUIRED: '关键风险要求模拟退出',
  DATA_DEGRADED: '数据源已降级',
};

function appendEvent(
  state: PaperExperiment,
  command: PaperCommand,
  type: PaperEventType,
  intentId: string | null,
  fillId: string | null,
  urgency: 'NORMAL' | 'URGENT' = 'NORMAL',
): void {
  const evidenceIds = canonicalStrings(command.evidenceIds, 'evidenceIds');
  if (evidenceIds.length === 0) throw new Error('PAPER_EVENT_EVIDENCE_REQUIRED');
  const eventAt = iso(command.eventAt, 'eventAt');
  const value = {
    type,
    experimentId: state.id,
    chain: state.chain,
    assetId: command.assetId,
    strategyVersion: command.strategyVersion,
    candidateEpoch: command.candidateEpoch,
    intentId,
    fillId,
    eventAt,
    reasons: canonicalStrings(command.reasons, 'reasons'),
    evidenceIds,
  };
  const eventHash = hashPayload(value);
  const event: PaperEvent = { id: `pev_${eventHash.slice(0, 24)}`, ...value };
  const businessKey = [
    state.id,
    state.chain,
    command.assetId,
    command.strategyVersion,
    intentId ?? command.candidateEpoch,
    type,
    fillId ?? 'NO_FILL',
  ].join(':');
  const outboxValue = {
    businessKey,
    eventId: event.id,
    eventType: type,
    title: EVENT_TITLE[type],
    urgency,
    deliveryState: 'PENDING' as const,
    createdAt: eventAt,
  };
  const payloadHash = hashPayload(outboxValue);
  const existing = state.outbox.find((record) => record.businessKey === businessKey);
  if (existing !== undefined && existing.payloadHash !== payloadHash) {
    throw new Error('PAPER_OUTBOX_BUSINESS_KEY_CONFLICT');
  }
  if (existing === undefined) {
    state.events.push(event);
    state.outbox.push({
      id: `pob_${hashPayload({ businessKey, payloadHash }).slice(0, 24)}`,
      ...outboxValue,
      payloadHash,
    });
  }
}

function positionFor(state: PaperExperiment, assetId: string): PaperPosition | undefined {
  return state.positions.find((position) => position.assetId === assetId);
}

function intentFor(state: PaperExperiment, id: string, side: 'BUY' | 'SELL'): PaperIntent {
  const intent = state.intents.find((value) => value.id === id);
  if (intent === undefined || intent.side !== side) throw new Error('PAPER_INTENT_NOT_FOUND');
  if (!['STARTED', 'PARTIAL'].includes(intent.status)) throw new Error('PAPER_INTENT_NOT_ACTIVE');
  return intent;
}

function validateFreshQuote(command: {
  quoteAvailableAt: string;
  quoteValidUntil: string;
  eventAt: string;
}): void {
  const eventAt = iso(command.eventAt, 'eventAt');
  const availableAt = iso(command.quoteAvailableAt, 'quoteAvailableAt');
  const validUntil = iso(command.quoteValidUntil, 'quoteValidUntil');
  if (availableAt > eventAt || validUntil < eventAt)
    throw new Error('PAPER_QUOTE_NOT_DECISION_AVAILABLE');
}

function cloneExperiment(state: PaperExperiment): PaperExperiment {
  return structuredClone(state);
}

export function applyPaperCommand(
  current: PaperExperiment,
  command: PaperCommand,
): PaperExperiment {
  if (
    !command.commandId ||
    !command.assetId ||
    !command.strategyVersion ||
    !command.candidateEpoch
  ) {
    throw new Error('PAPER_COMMAND_SCOPE_REQUIRED');
  }
  iso(command.eventAt, 'eventAt');
  const commandHash = hashPayload(command);
  const processed = current.processedCommands.find((value) => value.id === command.commandId);
  if (processed !== undefined) {
    if (processed.hash !== commandHash) throw new Error('PAPER_COMMAND_ID_CONFLICT');
    return current;
  }
  const state = cloneExperiment(current);
  const available = () => atomic(state.availableCashAtomic, 'availableCashAtomic');
  const reserved = () => atomic(state.reservedCashAtomic, 'reservedCashAtomic');

  if (command.type === 'START_BUY') {
    validateFreshQuote(command);
    if (
      command.hardConditions.length === 0 ||
      command.hardConditions.some((item) => item.state !== 'PASS')
    ) {
      throw new Error('PAPER_BUY_HARD_CONDITION_NOT_MET');
    }
    const principal = atomic(state.initialPrincipalAtomic, 'initialPrincipalAtomic');
    const riskBaseSigned = principal + signedAtomic(state.realizedPnlAtomic, 'realizedPnlAtomic');
    if (riskBaseSigned <= 0n) throw new Error('PAPER_RISK_BASE_EXHAUSTED');
    const policy = state.policy;
    const totalExposure = exposure(state.positions, () => true);
    const assetExposure = exposure(state.positions, (item) => item.assetId === command.assetId);
    const controllerExposure = exposure(
      state.positions,
      (item) => item.controllerGroupId === command.controllerGroupId,
    );
    const narrativeExposure = exposure(
      state.positions,
      (item) => item.narrativeGroupId === command.narrativeGroupId,
    );
    const maximumFee = atomic(command.maximumFeeAtomic, 'maximumFeeAtomic');
    const protectedCash =
      policyAmount(principal, policy.minimumUncommittedCashBps) +
      policyAmount(principal, policy.minimumFeeReserveBps);
    const spendableCash =
      available() > maximumFee + protectedCash ? available() - maximumFee - protectedCash : 0n;
    const size = minimum([
      atomic(command.requestedQuoteAtomic, 'requestedQuoteAtomic'),
      policyAmount(riskBaseSigned, policy.targetPositionBps),
      headroom(policyAmount(riskBaseSigned, policy.maxSinglePositionBps), assetExposure),
      headroom(policyAmount(riskBaseSigned, policy.maxControllerGroupBps), controllerExposure),
      headroom(policyAmount(riskBaseSigned, policy.maxNarrativeGroupBps), narrativeExposure),
      headroom(policyAmount(riskBaseSigned, policy.maxTotalInvestedBps), totalExposure),
      atomic(command.maximumWorstLossAtomic, 'maximumWorstLossAtomic'),
      atomic(command.exitCapacityQuoteAtomic, 'exitCapacityQuoteAtomic'),
      spendableCash,
    ]);
    if (size <= 0n) throw new Error('PAPER_BUY_NO_CAPACITY');
    const reservedForIntent = size + maximumFee;
    state.availableCashAtomic = (available() - reservedForIntent).toString();
    state.reservedCashAtomic = (reserved() + reservedForIntent).toString();
    const intentHash = hashPayload({
      experimentId: state.id,
      commandId: command.commandId,
      side: 'BUY',
    });
    const intent: PaperIntent = {
      id: `pit_${intentHash.slice(0, 24)}`,
      candidateEpoch: command.candidateEpoch,
      strategyVersion: command.strategyVersion,
      side: 'BUY',
      assetId: command.assetId,
      controllerGroupId: command.controllerGroupId,
      narrativeGroupId: command.narrativeGroupId,
      status: 'STARTED',
      requestedAtomic: size.toString(),
      remainingAtomic: size.toString(),
      reservedCashAtomic: reservedForIntent.toString(),
      maximumFeeAtomic: maximumFee.toString(),
      fillIds: [],
      evidenceIds: canonicalStrings(command.evidenceIds, 'evidenceIds'),
      createdAt: iso(command.eventAt, 'eventAt'),
      updatedAt: iso(command.eventAt, 'eventAt'),
    };
    state.intents.push(intent);
    appendEvent(state, command, 'PAPER_BUY_STARTED', intent.id, null);
  } else if (command.type === 'RECORD_BUY_FILL') {
    const intent = intentFor(state, command.intentId, 'BUY');
    if (intent.fillIds.includes(command.fillId)) throw new Error('PAPER_FILL_ID_CONFLICT');
    const spent = atomic(command.quoteSpentAtomic, 'quoteSpentAtomic');
    const fee = atomic(command.feeAtomic, 'feeAtomic');
    const received = atomic(command.tokenReceivedAtomic, 'tokenReceivedAtomic');
    const remaining = atomic(intent.remainingAtomic, 'remainingAtomic');
    const intentReserve = atomic(intent.reservedCashAtomic, 'intent.reservedCashAtomic');
    if (spent <= 0n || received <= 0n || spent > remaining || spent + fee > intentReserve) {
      throw new Error('PAPER_BUY_FILL_EXCEEDS_RESERVATION');
    }
    state.reservedCashAtomic = (reserved() - spent - fee).toString();
    intent.reservedCashAtomic = (intentReserve - spent - fee).toString();
    intent.remainingAtomic = (remaining - spent).toString();
    intent.fillIds.push(command.fillId);
    intent.updatedAt = iso(command.eventAt, 'eventAt');
    let position = positionFor(state, command.assetId);
    if (position === undefined) {
      position = {
        assetId: command.assetId,
        controllerGroupId: intent.controllerGroupId,
        narrativeGroupId: intent.narrativeGroupId,
        quantityAtomic: '0',
        reservedQuantityAtomic: '0',
        costBasisAtomic: '0',
      };
      state.positions.push(position);
    }
    position.quantityAtomic = (
      atomic(position.quantityAtomic, 'position.quantityAtomic') + received
    ).toString();
    position.costBasisAtomic = (
      atomic(position.costBasisAtomic, 'position.costBasisAtomic') +
      spent +
      fee
    ).toString();
    const noRemaining = atomic(intent.remainingAtomic, 'remainingAtomic') === 0n;
    if (command.final || noRemaining) {
      const release = atomic(intent.reservedCashAtomic, 'intent.reservedCashAtomic');
      state.reservedCashAtomic = (reserved() - release).toString();
      state.availableCashAtomic = (available() + release).toString();
      intent.reservedCashAtomic = '0';
      intent.status = noRemaining ? 'FILLED' : 'CANCELLED';
      appendEvent(
        state,
        command,
        noRemaining ? 'PAPER_BUY_FILLED' : 'PAPER_BUY_PARTIAL_CLOSED',
        intent.id,
        command.fillId,
      );
    } else {
      intent.status = 'PARTIAL';
      appendEvent(state, command, 'PAPER_BUY_PARTIAL', intent.id, command.fillId);
    }
  } else if (command.type === 'FAIL_BUY') {
    const intent = intentFor(state, command.intentId, 'BUY');
    const fee = atomic(command.failureFeeAtomic, 'failureFeeAtomic');
    const intentReserve = atomic(intent.reservedCashAtomic, 'intent.reservedCashAtomic');
    if (fee > intentReserve) throw new Error('PAPER_FAILURE_FEE_EXCEEDS_RESERVATION');
    state.reservedCashAtomic = (reserved() - intentReserve).toString();
    state.availableCashAtomic = (available() + intentReserve - fee).toString();
    intent.reservedCashAtomic = '0';
    intent.status = 'FAILED';
    intent.updatedAt = iso(command.eventAt, 'eventAt');
    appendEvent(state, command, 'PAPER_BUY_FAILED', intent.id, null, 'URGENT');
  } else if (command.type === 'START_SELL') {
    validateFreshQuote(command);
    if (command.sellableTokenAtomic.state !== 'known') {
      throw new Error(`PAPER_SELLABLE_${command.sellableTokenAtomic.state.toUpperCase()}`);
    }
    const position = positionFor(state, command.assetId);
    if (position === undefined) throw new Error('PAPER_POSITION_NOT_FOUND');
    const requested = atomic(command.requestedTokenAtomic, 'requestedTokenAtomic');
    const sellable = atomic(command.sellableTokenAtomic.value, 'sellableTokenAtomic');
    const unreserved =
      atomic(position.quantityAtomic, 'quantityAtomic') -
      atomic(position.reservedQuantityAtomic, 'reservedQuantityAtomic');
    const quantity = minimum([requested, sellable, unreserved]);
    if (quantity <= 0n) throw new Error('PAPER_SELL_NO_CAPACITY');
    const maximumFee = atomic(command.maximumFeeAtomic, 'maximumFeeAtomic');
    if (maximumFee > available()) throw new Error('PAPER_SELL_FEE_BALANCE_INSUFFICIENT');
    state.availableCashAtomic = (available() - maximumFee).toString();
    state.reservedCashAtomic = (reserved() + maximumFee).toString();
    position.reservedQuantityAtomic = (
      atomic(position.reservedQuantityAtomic, 'reservedQuantityAtomic') + quantity
    ).toString();
    const intentHash = hashPayload({
      experimentId: state.id,
      commandId: command.commandId,
      side: 'SELL',
    });
    const intent: PaperIntent = {
      id: `pit_${intentHash.slice(0, 24)}`,
      candidateEpoch: command.candidateEpoch,
      strategyVersion: command.strategyVersion,
      side: 'SELL',
      assetId: command.assetId,
      controllerGroupId: command.controllerGroupId,
      narrativeGroupId: command.narrativeGroupId,
      status: 'STARTED',
      requestedAtomic: quantity.toString(),
      remainingAtomic: quantity.toString(),
      reservedCashAtomic: maximumFee.toString(),
      maximumFeeAtomic: maximumFee.toString(),
      fillIds: [],
      evidenceIds: canonicalStrings(command.evidenceIds, 'evidenceIds'),
      createdAt: iso(command.eventAt, 'eventAt'),
      updatedAt: iso(command.eventAt, 'eventAt'),
    };
    state.intents.push(intent);
    if (command.urgent) {
      appendEvent(state, command, 'RISK_EXIT_REQUIRED', intent.id, null, 'URGENT');
    }
    appendEvent(
      state,
      command,
      'PAPER_SELL_STARTED',
      intent.id,
      null,
      command.urgent ? 'URGENT' : 'NORMAL',
    );
  } else if (command.type === 'RECORD_SELL_FILL') {
    const intent = intentFor(state, command.intentId, 'SELL');
    if (intent.fillIds.includes(command.fillId)) throw new Error('PAPER_FILL_ID_CONFLICT');
    const position = positionFor(state, command.assetId);
    if (position === undefined) throw new Error('PAPER_POSITION_NOT_FOUND');
    const sold = atomic(command.tokenSoldAtomic, 'tokenSoldAtomic');
    const received = atomic(command.quoteReceivedAtomic, 'quoteReceivedAtomic');
    const fee = atomic(command.feeAtomic, 'feeAtomic');
    const remaining = atomic(intent.remainingAtomic, 'remainingAtomic');
    const feeReserve = atomic(intent.reservedCashAtomic, 'intent.reservedCashAtomic');
    const quantityBefore = atomic(position.quantityAtomic, 'position.quantityAtomic');
    if (sold <= 0n || sold > remaining || sold > quantityBefore || fee > feeReserve) {
      throw new Error('PAPER_SELL_FILL_EXCEEDS_RESERVATION');
    }
    const costBefore = atomic(position.costBasisAtomic, 'position.costBasisAtomic');
    const allocatedCost = (costBefore * sold) / quantityBefore;
    position.quantityAtomic = (quantityBefore - sold).toString();
    position.reservedQuantityAtomic = (
      atomic(position.reservedQuantityAtomic, 'position.reservedQuantityAtomic') - sold
    ).toString();
    position.costBasisAtomic = (costBefore - allocatedCost).toString();
    state.reservedCashAtomic = (reserved() - fee).toString();
    state.availableCashAtomic = (available() + received).toString();
    intent.reservedCashAtomic = (feeReserve - fee).toString();
    intent.remainingAtomic = (remaining - sold).toString();
    intent.fillIds.push(command.fillId);
    intent.updatedAt = iso(command.eventAt, 'eventAt');
    state.realizedPnlAtomic = (
      signedAtomic(state.realizedPnlAtomic, 'realizedPnlAtomic') +
      received -
      fee -
      allocatedCost
    ).toString();
    const noRemaining = atomic(intent.remainingAtomic, 'remainingAtomic') === 0n;
    if (command.final || noRemaining) {
      const releaseFee = atomic(intent.reservedCashAtomic, 'intent.reservedCashAtomic');
      const releaseToken = atomic(intent.remainingAtomic, 'intent.remainingAtomic');
      state.reservedCashAtomic = (reserved() - releaseFee).toString();
      state.availableCashAtomic = (available() + releaseFee).toString();
      position.reservedQuantityAtomic = (
        atomic(position.reservedQuantityAtomic, 'position.reservedQuantityAtomic') - releaseToken
      ).toString();
      intent.reservedCashAtomic = '0';
      intent.status = noRemaining ? 'FILLED' : 'CANCELLED';
      appendEvent(
        state,
        command,
        noRemaining ? 'PAPER_SELL_FILLED' : 'PAPER_SELL_PARTIAL_CLOSED',
        intent.id,
        command.fillId,
      );
    } else {
      intent.status = 'PARTIAL';
      appendEvent(state, command, 'PAPER_SELL_PARTIAL', intent.id, command.fillId);
    }
  } else if (command.type === 'FAIL_SELL') {
    const intent = intentFor(state, command.intentId, 'SELL');
    const position = positionFor(state, command.assetId);
    if (position === undefined) throw new Error('PAPER_POSITION_NOT_FOUND');
    const fee = atomic(command.failureFeeAtomic, 'failureFeeAtomic');
    const feeReserve = atomic(intent.reservedCashAtomic, 'intent.reservedCashAtomic');
    if (fee > feeReserve) throw new Error('PAPER_FAILURE_FEE_EXCEEDS_RESERVATION');
    state.reservedCashAtomic = (reserved() - feeReserve).toString();
    state.availableCashAtomic = (available() + feeReserve - fee).toString();
    position.reservedQuantityAtomic = (
      atomic(position.reservedQuantityAtomic, 'reservedQuantityAtomic') -
      atomic(intent.remainingAtomic, 'remainingAtomic')
    ).toString();
    intent.reservedCashAtomic = '0';
    intent.status = 'FAILED';
    intent.updatedAt = iso(command.eventAt, 'eventAt');
    appendEvent(state, command, 'PAPER_SELL_FAILED', intent.id, null, 'URGENT');
  } else {
    const type = commandEventType(command);
    const intentId = 'intentId' in command ? (command.intentId ?? null) : null;
    appendEvent(
      state,
      command,
      type,
      intentId,
      null,
      type === 'DATA_DEGRADED' ? 'URGENT' : 'NORMAL',
    );
  }

  state.processedCommands.push({ id: command.commandId, hash: commandHash });
  state.revision += 1;
  state.updatedAt = iso(command.eventAt, 'eventAt');
  return state;
}

export function pagePaperOutbox(
  experiment: PaperExperiment,
  input: { after?: string; limit?: number } = {},
): { records: PaperOutboxRecord[]; nextCursor: string | null } {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error('PAPER_PAGE_LIMIT_INVALID');
  let start = 0;
  if (input.after !== undefined) {
    const index = experiment.outbox.findIndex((record) => record.id === input.after);
    if (index < 0) throw new Error('PAPER_PAGE_CURSOR_INVALID');
    start = index + 1;
  }
  const records = experiment.outbox.slice(start, start + limit);
  const nextCursor =
    start + records.length < experiment.outbox.length ? (records.at(-1)?.id ?? null) : null;
  return { records, nextCursor };
}
