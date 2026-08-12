import {
  ClaimActionObservationSchema,
  ClaimAuditPolicySchema,
  ClaimAuditReportSchema,
  ClaimCustodyObservationSchema,
  ClaimRuleSchema,
  ClaimTransferObservationSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type KnowledgeValue,
} from '@zerotrace/schemas';

export const CLAIM_AUDIT_MODEL_VERSION = 'claim-audit-v1.1.0';
const BPS_DENOMINATOR = 10_000n;

export type ClaimStatus = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'CONTRADICTED' | 'INSUFFICIENT_DATA';

export type ClaimExpectedAction =
  'RECEIVE' | 'DISTRIBUTE' | 'BUYBACK' | 'BURN' | 'ADD_LIQUIDITY' | 'LOCK' | 'PAY_DIVIDEND';

export type ClaimWalletRole =
  | 'TAX_RECEIVER'
  | 'COMMUNITY_FUND'
  | 'BUYBACK_BURN'
  | 'BUYBACK_LIQUIDITY'
  | 'PENSION_VAULT'
  | 'DIVIDEND_DISTRIBUTOR'
  | 'OTHER';

export type CustodyKind =
  'IRRECOVERABLE_BURN' | 'SAFE_MULTISIG' | 'TIMELOCK' | 'EOA' | 'CONTRACT' | 'LP_POOL' | 'UNKNOWN';

export type ObservedActionType = 'BUYBACK' | 'BURN' | 'ADD_LIQUIDITY' | 'LP_LOCK' | 'DIVIDEND';
export type LiquidityControl =
  'LP_IRRECOVERABLE' | 'LP_TIMELOCKED' | 'LP_EXTERNAL' | 'LP_CONTROLLER' | 'UNKNOWN';

export interface ClaimWindow {
  from: string;
  to: string;
}

export interface ClaimRule {
  id: string;
  assetId: string;
  sourceAddress: string;
  destinationAddress: string;
  role: ClaimWalletRole;
  expectedAction: ClaimExpectedAction;
  expectedShareBps?: string | undefined;
  window: ClaimWindow;
  shareUnit?: string | undefined;
  noExit?: boolean | undefined;
  cadenceSeconds?: string | undefined;
  claimEvidenceIds: string[];
}

export interface AssetTransferObservation {
  id: string;
  from: string;
  to: string;
  amount: string;
  observedAt: string;
  transactionId: string;
  evidenceIds: string[];
}

export interface ClaimActionObservation {
  id: string;
  type: ObservedActionType;
  actor: string;
  amount: string;
  observedAt: string;
  transferIds: string[];
  path: string[];
  liquidityControl?: LiquidityControl | undefined;
  evidenceIds: string[];
}

export interface CustodyObservation {
  address: string;
  kind: CustodyKind;
  canMoveFunds: KnowledgeValue<boolean>;
  threshold?: number | undefined;
  ownerCount?: number | undefined;
  executedTransactions?: number | undefined;
  implementationAddress?: string | undefined;
  implementationVersion?: string | undefined;
  evidenceIds: string[];
}

export interface ClaimAuditPolicy {
  verifiedAmountToleranceBps: string;
  partialAmountToleranceBps: string;
  maximumAttributionHops: number;
}

export interface ClaimAuditInput {
  baseAmount: KnowledgeValue<string>;
  claims: ClaimRule[];
  transfers: AssetTransferObservation[];
  actions: ClaimActionObservation[];
  custody: CustodyObservation[];
  controllerAddresses?: string[] | undefined;
  policy?: Partial<ClaimAuditPolicy> | undefined;
  metadata: AnalysisMetadata;
}

export interface ClaimAuditFinding {
  code:
    | 'ALLOCATION_WITHIN_TOLERANCE'
    | 'ALLOCATION_DEVIATION'
    | 'ACTION_OBSERVED'
    | 'ACTION_NOT_OBSERVED'
    | 'CLAIMED_BURN_IS_MOVABLE_CUSTODY'
    | 'LP_REMAINS_CONTROLLER_WITHDRAWABLE'
    | 'OUTFLOW_OBSERVED'
    | 'FLOW_RETURNED_TO_CONTROLLER'
    | 'POLICY_LOCK_NOT_TECHNICAL_LOCK'
    | 'SHARE_UNIT_DEVIATION'
    | 'CADENCE_NOT_YET_PROVABLE'
    | 'COVERAGE_INCOMPLETE';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  evidenceIds: string[];
}

export interface ShareUnitAssessment {
  unit: string;
  observedDeposits: number;
  exactUnitDeposits: number;
  exactMultipleDeposits: number;
  nonMultipleDeposits: number;
  observedWholeShares: string;
  nonMultipleObservedAmount: string;
  exactMultipleCoverage: KnowledgeValue<number>;
}

export interface CadenceAssessment {
  expectedSeconds: string;
  observedActions: number;
  observedIntervalsSeconds: string[];
  status: ClaimStatus;
}

export interface ClaimRuleAudit {
  claim: ClaimRule;
  status: ClaimStatus;
  expectedAmount: KnowledgeValue<string>;
  observedReceivedAmount: string;
  actualReceivedAmount: KnowledgeValue<string>;
  observedActionAmount: string;
  actualActionAmount: KnowledgeValue<string>;
  observedOutflowAmount: string;
  deviationBps: KnowledgeValue<string>;
  verifiedPercent: KnowledgeValue<string>;
  custody: KnowledgeValue<CustodyKind>;
  shareUnitAssessment: ShareUnitAssessment | null;
  cadenceAssessment: CadenceAssessment | null;
  findings: ClaimAuditFinding[];
  evidenceIds: string[];
}

export interface ClaimAuditReport {
  status: ClaimStatus;
  policy: ClaimAuditPolicy;
  items: ClaimRuleAudit[];
  metadata: AnalysisMetadata;
}

const defaultPolicy: ClaimAuditPolicy = {
  verifiedAmountToleranceBps: '50',
  partialAmountToleranceBps: '500',
  maximumAttributionHops: 4,
};

function parseAtomic(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer string in atomic units.`);
  }
  return BigInt(value);
}

function parseBps(value: string, field: string): bigint {
  const parsed = parseAtomic(value, field);
  if (parsed > BPS_DENOMINATOR) throw new Error(`${field} may not exceed 10000.`);
  return parsed;
}

function normalizeAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) throw new Error('Claim addresses may not be empty.');
  return normalized;
}

function parseTime(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO-compatible timestamp.`);
  return parsed;
}

function withinWindow(observedAt: string, window: ClaimWindow): boolean {
  const observed = parseTime(observedAt, 'observedAt');
  return (
    observed >= parseTime(window.from, 'window.from') &&
    observed <= parseTime(window.to, 'window.to')
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function snapshotTimeBound(metadata: AnalysisMetadata): number {
  const snapshot = metadata.snapshot;
  if (snapshot === null) throw new Error('Claim audit requires a replayable chain Snapshot.');
  const capturedAt = parseTime(snapshot.capturedAt, 'snapshot.capturedAt');
  if (!('blockTimestamp' in snapshot) || snapshot.blockTimestamp === undefined) {
    return capturedAt;
  }
  return Math.min(capturedAt, parseTime(snapshot.blockTimestamp, 'snapshot.blockTimestamp'));
}

function assertAtOrBeforeSnapshot(value: string, field: string, snapshotBound: number): void {
  if (parseTime(value, field) > snapshotBound) {
    throw new Error(`${field} must not occur after the Snapshot time bound.`);
  }
}

function formatRatio(numerator: bigint, denominator: bigint, decimalPlaces = 4): string {
  if (denominator === 0n) throw new Error('Cannot format a ratio with a zero denominator.');
  const integer = numerator / denominator;
  let remainder = numerator % denominator;
  let fraction = '';
  for (let index = 0; index < decimalPlaces && remainder !== 0n; index += 1) {
    remainder *= 10n;
    fraction += (remainder / denominator).toString();
    remainder %= denominator;
  }
  fraction = fraction.replace(/0+$/, '');
  return fraction.length === 0 ? integer.toString() : `${integer}.${fraction}`;
}

function completeCoverage(metadata: AnalysisMetadata): boolean {
  return (
    metadata.dataCoverage === 1 && metadata.sourceCoverage === 1 && metadata.historyCoverage === 1
  );
}

function coveredAmount(value: bigint, metadata: AnalysisMetadata): KnowledgeValue<string> {
  return completeCoverage(metadata)
    ? knownValue(value.toString())
    : unknownValue(
        'INSUFFICIENT_DATA',
        'Observed amount is a lower bound because data, source, or history coverage is incomplete.',
      );
}

function expectedAmount(
  baseAmount: KnowledgeValue<string>,
  expectedShareBps: string | undefined,
): KnowledgeValue<string> {
  if (expectedShareBps === undefined) {
    return unknownValue(
      'NOT_APPLICABLE',
      'The claim does not declare a fixed allocation percentage.',
    );
  }
  const share = parseBps(expectedShareBps, 'expectedShareBps');
  if (baseAmount.state === 'unknown') return unknownValue(baseAmount.reason, baseAmount.detail);
  if (baseAmount.state === 'unavailable')
    return unavailableValue(baseAmount.reason, baseAmount.detail);
  return knownValue(
    ((parseAtomic(baseAmount.value, 'baseAmount') * share) / BPS_DENOMINATOR).toString(),
  );
}

function deviationBps(expected: bigint, actual: bigint): bigint | null {
  if (expected === 0n) return actual === 0n ? 0n : null;
  const difference = expected > actual ? expected - actual : actual - expected;
  return (difference * BPS_DENOMINATOR) / expected;
}

function allocationStatus(
  expected: KnowledgeValue<string>,
  actual: KnowledgeValue<string>,
  policy: ClaimAuditPolicy,
): ClaimStatus {
  if (expected.state !== 'known' || actual.state !== 'known') return 'INSUFFICIENT_DATA';
  const deviation = deviationBps(
    parseAtomic(expected.value, 'expectedAmount'),
    parseAtomic(actual.value, 'actualAmount'),
  );
  if (deviation === null) return 'CONTRADICTED';
  if (deviation <= parseBps(policy.verifiedAmountToleranceBps, 'verifiedAmountToleranceBps')) {
    return 'VERIFIED';
  }
  return deviation <= parseBps(policy.partialAmountToleranceBps, 'partialAmountToleranceBps')
    ? 'PARTIALLY_VERIFIED'
    : 'CONTRADICTED';
}

function aggregateStatus(statuses: readonly ClaimStatus[]): ClaimStatus {
  if (statuses.length === 0 || statuses.every((status) => status === 'INSUFFICIENT_DATA')) {
    return 'INSUFFICIENT_DATA';
  }
  if (statuses.some((status) => status === 'CONTRADICTED')) return 'CONTRADICTED';
  if (statuses.every((status) => status === 'VERIFIED')) return 'VERIFIED';
  return 'PARTIALLY_VERIFIED';
}

function matchesExpectedAction(
  expected: ClaimExpectedAction,
  observed: ObservedActionType,
): boolean {
  if (expected === 'BUYBACK') return observed === 'BUYBACK';
  if (expected === 'BURN') return observed === 'BURN';
  if (expected === 'ADD_LIQUIDITY') return observed === 'ADD_LIQUIDITY';
  if (expected === 'LOCK') return observed === 'LP_LOCK';
  if (expected === 'PAY_DIVIDEND') return observed === 'DIVIDEND';
  return false;
}

function validateActionPath(
  claim: ClaimRule,
  action: ClaimActionObservation,
  transfersById: ReadonlyMap<string, AssetTransferObservation>,
  maximumHops: number,
): boolean {
  if (action.transferIds.length === 0) {
    return (
      normalizeAddress(action.actor) === normalizeAddress(claim.destinationAddress) &&
      action.path.length === 1 &&
      normalizeAddress(action.path[0] ?? '') === normalizeAddress(claim.destinationAddress)
    );
  }
  if (
    action.transferIds.length > maximumHops ||
    new Set(action.transferIds).size !== action.transferIds.length ||
    action.path.length !== action.transferIds.length + 1 ||
    normalizeAddress(action.path[0] ?? '') !== normalizeAddress(claim.destinationAddress) ||
    normalizeAddress(action.actor) !== normalizeAddress(action.path[0] ?? '') ||
    new Set(action.path.map(normalizeAddress)).size !== action.path.length
  ) {
    return false;
  }
  const actionAmount = parseAtomic(action.amount, 'action.amount');
  const actionTime = parseTime(action.observedAt, 'action.observedAt');
  let previousTransferTime = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < action.transferIds.length; index += 1) {
    const transfer = transfersById.get(action.transferIds[index] ?? '');
    const transferTime =
      transfer === undefined
        ? Number.POSITIVE_INFINITY
        : parseTime(transfer.observedAt, 'transfer.observedAt');
    if (
      transfer === undefined ||
      !withinWindow(transfer.observedAt, claim.window) ||
      transferTime < previousTransferTime ||
      transferTime > actionTime ||
      normalizeAddress(transfer.from) !== normalizeAddress(action.path[index] ?? '') ||
      normalizeAddress(transfer.to) !== normalizeAddress(action.path[index + 1] ?? '') ||
      parseAtomic(transfer.amount, 'transfer.amount') < actionAmount
    ) {
      return false;
    }
    previousTransferTime = transferTime;
  }
  return true;
}

function actionStatus(
  claim: ClaimRule,
  received: KnowledgeValue<string>,
  actionAmount: KnowledgeValue<string>,
  custody: CustodyObservation | undefined,
  outflow: bigint,
  matchingActions: readonly ClaimActionObservation[],
  controllerReturn: boolean,
  policy: ClaimAuditPolicy,
): ClaimStatus {
  if (claim.expectedAction === 'RECEIVE' || claim.expectedAction === 'DISTRIBUTE') {
    return received.state === 'known' ? 'VERIFIED' : 'INSUFFICIENT_DATA';
  }
  if (claim.expectedAction === 'LOCK') {
    if (claim.noExit === true && outflow > 0n) return 'CONTRADICTED';
    if (custody?.canMoveFunds.state === 'known') {
      return custody.canMoveFunds.value ? 'INSUFFICIENT_DATA' : 'VERIFIED';
    }
    return 'INSUFFICIENT_DATA';
  }
  if (
    claim.expectedAction === 'BURN' &&
    custody?.kind === 'IRRECOVERABLE_BURN' &&
    custody.canMoveFunds.state === 'known' &&
    custody.canMoveFunds.value === false
  ) {
    return received.state === 'known' ? 'VERIFIED' : 'INSUFFICIENT_DATA';
  }
  if (controllerReturn) return 'CONTRADICTED';
  if (actionAmount.state !== 'known' || received.state !== 'known') return 'INSUFFICIENT_DATA';
  if (matchingActions.length === 0 || parseAtomic(actionAmount.value, 'actionAmount') === 0n) {
    return 'CONTRADICTED';
  }
  const amountStatus = allocationStatus(received, actionAmount, policy);
  if (
    claim.expectedAction === 'ADD_LIQUIDITY' &&
    matchingActions.some((action) => action.liquidityControl === 'LP_CONTROLLER')
  ) {
    return amountStatus === 'CONTRADICTED' ? 'CONTRADICTED' : 'PARTIALLY_VERIFIED';
  }
  return amountStatus;
}

function shareUnitAssessment(
  claim: ClaimRule,
  deposits: readonly AssetTransferObservation[],
): ShareUnitAssessment | null {
  if (claim.shareUnit === undefined) return null;
  const unit = parseAtomic(claim.shareUnit, 'shareUnit');
  if (unit === 0n) throw new Error('shareUnit must be positive.');
  const exactMultipleDeposits = deposits.filter(
    (deposit) => parseAtomic(deposit.amount, 'transfer.amount') % unit === 0n,
  ).length;
  const exactUnitDeposits = deposits.filter(
    (deposit) => parseAtomic(deposit.amount, 'transfer.amount') === unit,
  ).length;
  const observedWholeShares = deposits.reduce((total, deposit) => {
    const amount = parseAtomic(deposit.amount, 'transfer.amount');
    return amount % unit === 0n ? total + amount / unit : total;
  }, 0n);
  const nonMultipleObservedAmount = deposits.reduce((total, deposit) => {
    const amount = parseAtomic(deposit.amount, 'transfer.amount');
    return amount % unit === 0n ? total : total + amount;
  }, 0n);
  return {
    unit: claim.shareUnit,
    observedDeposits: deposits.length,
    exactUnitDeposits,
    exactMultipleDeposits,
    nonMultipleDeposits: deposits.length - exactMultipleDeposits,
    observedWholeShares: observedWholeShares.toString(),
    nonMultipleObservedAmount: nonMultipleObservedAmount.toString(),
    exactMultipleCoverage:
      deposits.length === 0
        ? unknownValue('NOT_APPLICABLE', 'No observed deposits are available for this ratio.')
        : knownValue(exactMultipleDeposits / deposits.length),
  };
}

function cadenceAssessment(
  claim: ClaimRule,
  actions: readonly ClaimActionObservation[],
): CadenceAssessment | null {
  if (claim.cadenceSeconds === undefined) return null;
  const expectedSeconds = parseAtomic(claim.cadenceSeconds, 'cadenceSeconds');
  if (expectedSeconds === 0n) throw new Error('cadenceSeconds must be positive.');
  const times = actions
    .map((action) => parseTime(action.observedAt, 'action.observedAt'))
    .sort((a, b) => a - b);
  const intervals = times
    .slice(1)
    .map((time, index) => Math.round((time - (times[index] ?? time)) / 1_000));
  const windowSeconds = Math.round(
    (parseTime(claim.window.to, 'window.to') - parseTime(claim.window.from, 'window.from')) / 1_000,
  );
  const enoughHistory = BigInt(Math.max(0, windowSeconds)) >= expectedSeconds * 2n;
  const tolerance = expectedSeconds / 7n;
  const matchingIntervals = intervals.filter(
    (interval) =>
      BigInt(interval) >= expectedSeconds - tolerance &&
      BigInt(interval) <= expectedSeconds + tolerance,
  );
  const status: ClaimStatus = !enoughHistory
    ? 'INSUFFICIENT_DATA'
    : intervals.length === 0
      ? 'CONTRADICTED'
      : matchingIntervals.length === intervals.length
        ? 'VERIFIED'
        : matchingIntervals.length > 0
          ? 'PARTIALLY_VERIFIED'
          : 'CONTRADICTED';
  return {
    expectedSeconds: claim.cadenceSeconds,
    observedActions: actions.length,
    observedIntervalsSeconds: intervals.map(String),
    status,
  };
}

function assertPolicy(policy: ClaimAuditPolicy): void {
  const verified = parseBps(policy.verifiedAmountToleranceBps, 'verifiedAmountToleranceBps');
  const partial = parseBps(policy.partialAmountToleranceBps, 'partialAmountToleranceBps');
  if (verified > partial) {
    throw new Error('verifiedAmountToleranceBps may not exceed partialAmountToleranceBps.');
  }
  if (
    !Number.isSafeInteger(policy.maximumAttributionHops) ||
    policy.maximumAttributionHops < 0 ||
    policy.maximumAttributionHops > 8
  ) {
    throw new Error('maximumAttributionHops must be between 0 and 8.');
  }
}

export function auditClaims(input: ClaimAuditInput): ClaimAuditReport {
  if (input.metadata.snapshot === null) {
    throw new Error('Claim audit requires a replayable chain Snapshot.');
  }
  ClaimRuleSchema.array().min(1).parse(input.claims);
  ClaimTransferObservationSchema.array().parse(input.transfers);
  ClaimActionObservationSchema.array().parse(input.actions);
  ClaimCustodyObservationSchema.array().parse(input.custody);
  const claims = input.claims;
  const transfers = input.transfers;
  const actions = input.actions;
  const custodyObservations = input.custody;
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) {
    throw new Error('Claim ids must be unique.');
  }
  if (new Set(claims.map((claim) => claim.assetId)).size !== 1) {
    throw new Error('A Claim audit may contain exactly one assetId.');
  }
  if (new Set(actions.map((action) => action.id)).size !== actions.length) {
    throw new Error('Action ids must be unique.');
  }
  const custodyAddresses = custodyObservations.map((observation) =>
    normalizeAddress(observation.address),
  );
  if (new Set(custodyAddresses).size !== custodyAddresses.length) {
    throw new Error('Custody addresses must be unique after normalization.');
  }
  const snapshotBound = snapshotTimeBound(input.metadata);
  for (const transfer of transfers) {
    assertAtOrBeforeSnapshot(transfer.observedAt, 'transfer.observedAt', snapshotBound);
  }
  for (const action of actions) {
    assertAtOrBeforeSnapshot(action.observedAt, 'action.observedAt', snapshotBound);
  }
  const policy = { ...defaultPolicy, ...input.policy };
  assertPolicy(policy);
  ClaimAuditPolicySchema.parse(policy);
  const transfersById = new Map(transfers.map((transfer) => [transfer.id, transfer]));
  if (transfersById.size !== transfers.length) throw new Error('Transfer ids must be unique.');
  const controllers = new Set((input.controllerAddresses ?? []).map(normalizeAddress));

  const items = claims.map((claim): ClaimRuleAudit => {
    if (parseTime(claim.window.from, 'window.from') > parseTime(claim.window.to, 'window.to')) {
      throw new Error('Claim window must not end before it begins.');
    }
    assertAtOrBeforeSnapshot(claim.window.to, 'claim.window.to', snapshotBound);
    const source = normalizeAddress(claim.sourceAddress);
    const destination = normalizeAddress(claim.destinationAddress);
    const deposits = transfers.filter(
      (transfer) =>
        withinWindow(transfer.observedAt, claim.window) &&
        normalizeAddress(transfer.from) === source &&
        normalizeAddress(transfer.to) === destination,
    );
    const outflows = transfers.filter(
      (transfer) =>
        withinWindow(transfer.observedAt, claim.window) &&
        normalizeAddress(transfer.from) === destination,
    );
    const observedReceived = deposits.reduce(
      (total, transfer) => total + parseAtomic(transfer.amount, 'transfer.amount'),
      0n,
    );
    const observedOutflow = outflows.reduce(
      (total, transfer) => total + parseAtomic(transfer.amount, 'transfer.amount'),
      0n,
    );
    const matchingActions = actions.filter(
      (action) =>
        withinWindow(action.observedAt, claim.window) &&
        matchesExpectedAction(claim.expectedAction, action.type) &&
        validateActionPath(claim, action, transfersById, policy.maximumAttributionHops),
    );
    const observedAction = matchingActions.reduce(
      (total, action) => total + parseAtomic(action.amount, 'action.amount'),
      0n,
    );
    const custody = custodyObservations.find(
      (observation) => normalizeAddress(observation.address) === destination,
    );
    const directIrrecoverableBurn =
      claim.expectedAction === 'BURN' &&
      custody?.kind === 'IRRECOVERABLE_BURN' &&
      custody.canMoveFunds.state === 'known' &&
      custody.canMoveFunds.value === false;
    const expected = expectedAmount(input.baseAmount, claim.expectedShareBps);
    const actualReceived = coveredAmount(observedReceived, input.metadata);
    let actualAction = coveredAmount(observedAction, input.metadata);
    if (directIrrecoverableBurn) {
      actualAction = actualReceived;
    }
    if (claim.expectedAction === 'RECEIVE' || claim.expectedAction === 'DISTRIBUTE') {
      actualAction = actualReceived;
    }
    const allocation = allocationStatus(expected, actualReceived, policy);
    const controllerReturn =
      outflows.some((transfer) => controllers.has(normalizeAddress(transfer.to))) ||
      matchingActions.some((action) =>
        controllers.has(normalizeAddress(action.path.at(-1) ?? action.actor)),
      );
    const semantic = actionStatus(
      claim,
      actualReceived,
      actualAction,
      custody,
      observedOutflow,
      matchingActions,
      controllerReturn,
      policy,
    );
    const cadence = cadenceAssessment(claim, matchingActions);
    const status = aggregateStatus([
      allocation,
      semantic,
      ...(cadence === null ? [] : [cadence.status]),
    ]);
    const evidenceIds = unique([
      ...input.metadata.evidenceIds,
      ...claim.claimEvidenceIds,
      ...deposits.flatMap((transfer) => transfer.evidenceIds),
      ...outflows.flatMap((transfer) => transfer.evidenceIds),
      ...matchingActions.flatMap((action) => action.evidenceIds),
      ...(custody?.evidenceIds ?? []),
    ]);
    const findings: ClaimAuditFinding[] = [];

    if (!completeCoverage(input.metadata)) {
      findings.push({
        code: 'COVERAGE_INCOMPLETE',
        severity: 'WARNING',
        message: 'Observed amounts are lower bounds; complete actual amounts remain Unknown.',
        evidenceIds,
      });
    }
    if (allocation === 'VERIFIED') {
      findings.push({
        code: 'ALLOCATION_WITHIN_TOLERANCE',
        severity: 'INFO',
        message: 'Observed allocation is within the versioned amount-tolerance policy.',
        evidenceIds,
      });
    } else if (allocation !== 'INSUFFICIENT_DATA') {
      findings.push({
        code: 'ALLOCATION_DEVIATION',
        severity: allocation === 'CONTRADICTED' ? 'CRITICAL' : 'WARNING',
        message: 'Observed allocation deviates from the declared percentage.',
        evidenceIds,
      });
    }
    if (matchingActions.length > 0) {
      findings.push({
        code: 'ACTION_OBSERVED',
        severity: 'INFO',
        message: 'A bounded Evidence-linked action path matches the declared action.',
        evidenceIds,
      });
    } else if (
      !directIrrecoverableBurn &&
      !['RECEIVE', 'DISTRIBUTE', 'LOCK'].includes(claim.expectedAction)
    ) {
      findings.push({
        code: 'ACTION_NOT_OBSERVED',
        severity: completeCoverage(input.metadata) ? 'CRITICAL' : 'WARNING',
        message: 'No Evidence-linked action path matches the declared action in the audit window.',
        evidenceIds,
      });
    }
    if (
      claim.expectedAction === 'BURN' &&
      custody?.canMoveFunds.state === 'known' &&
      custody.canMoveFunds.value &&
      matchingActions.length === 0
    ) {
      findings.push({
        code: 'CLAIMED_BURN_IS_MOVABLE_CUSTODY',
        severity: 'CRITICAL',
        message:
          'The claimed burn destination is controlled custody and is not itself an irreversible burn.',
        evidenceIds,
      });
    }
    if (
      claim.expectedAction === 'ADD_LIQUIDITY' &&
      matchingActions.some((action) => action.liquidityControl === 'LP_CONTROLLER')
    ) {
      findings.push({
        code: 'LP_REMAINS_CONTROLLER_WITHDRAWABLE',
        severity: 'WARNING',
        message:
          'Liquidity was added, but observed LP control remains withdrawable by a controller.',
        evidenceIds,
      });
    }
    if (observedOutflow > 0n) {
      findings.push({
        code: 'OUTFLOW_OBSERVED',
        severity: claim.noExit === true ? 'CRITICAL' : 'INFO',
        message: 'The destination moved assets during the audit window.',
        evidenceIds,
      });
    }
    if (controllerReturn) {
      findings.push({
        code: 'FLOW_RETURNED_TO_CONTROLLER',
        severity: 'CRITICAL',
        message: 'Observed flow returned to a declared controller address.',
        evidenceIds,
      });
    }
    if (
      claim.expectedAction === 'LOCK' &&
      custody?.canMoveFunds.state === 'known' &&
      custody.canMoveFunds.value
    ) {
      findings.push({
        code: 'POLICY_LOCK_NOT_TECHNICAL_LOCK',
        severity: claim.noExit === true ? 'CRITICAL' : 'WARNING',
        message:
          'Custodians can move the funds; any no-exit property is policy-based rather than technical.',
        evidenceIds,
      });
    }
    const shareUnit = shareUnitAssessment(claim, deposits);
    if (shareUnit !== null && shareUnit.nonMultipleDeposits > 0) {
      findings.push({
        code: 'SHARE_UNIT_DEVIATION',
        severity: 'WARNING',
        message: 'Some observed deposits are not exact multiples of the declared share unit.',
        evidenceIds,
      });
    }
    if (cadence?.status === 'INSUFFICIENT_DATA') {
      findings.push({
        code: 'CADENCE_NOT_YET_PROVABLE',
        severity: 'WARNING',
        message: 'The observed window does not yet cover two declared cadence periods.',
        evidenceIds,
      });
    }

    let deviation: KnowledgeValue<string> = unknownValue('INSUFFICIENT_DATA');
    let verifiedPercent: KnowledgeValue<string> = unknownValue('INSUFFICIENT_DATA');
    if (expected.state === 'known' && actualReceived.state === 'known') {
      const expectedAtomic = parseAtomic(expected.value, 'expectedAmount');
      const actualAtomic = parseAtomic(actualReceived.value, 'actualReceivedAmount');
      const difference = deviationBps(expectedAtomic, actualAtomic);
      deviation =
        difference === null
          ? unknownValue(
              'PRECISION_UNSAFE',
              'Deviation is undefined for a zero expected amount with a non-zero actual amount.',
            )
          : knownValue(difference.toString());
      if (expectedAtomic === 0n) {
        verifiedPercent = knownValue(actualAtomic === 0n ? '100' : '0');
      } else {
        const allocationBps = (actualAtomic * BPS_DENOMINATOR) / expectedAtomic;
        const cappedAllocation = allocationBps > BPS_DENOMINATOR ? BPS_DENOMINATOR : allocationBps;
        let actionBps = BPS_DENOMINATOR;
        let verificationUnavailable = false;
        if (claim.expectedAction === 'LOCK') {
          if (semantic === 'INSUFFICIENT_DATA') {
            verifiedPercent = unknownValue(
              'INSUFFICIENT_DATA',
              'The allocation is measurable, but the claimed lock property is not technically provable.',
            );
            verificationUnavailable = true;
            actionBps = 0n;
          } else {
            actionBps = semantic === 'VERIFIED' ? BPS_DENOMINATOR : 0n;
          }
        } else if (!['RECEIVE', 'DISTRIBUTE'].includes(claim.expectedAction)) {
          actionBps =
            actualAction.state === 'known' && actualAtomic > 0n
              ? (parseAtomic(actualAction.value, 'actualActionAmount') * BPS_DENOMINATOR) /
                actualAtomic
              : 0n;
          if (actionBps > BPS_DENOMINATOR) actionBps = BPS_DENOMINATOR;
        }
        if (!verificationUnavailable) {
          verifiedPercent = knownValue(
            formatRatio(cappedAllocation < actionBps ? cappedAllocation : actionBps, 100n),
          );
        }
      }
    }

    return {
      claim,
      status,
      expectedAmount: expected,
      observedReceivedAmount: observedReceived.toString(),
      actualReceivedAmount: actualReceived,
      observedActionAmount: observedAction.toString(),
      actualActionAmount: actualAction,
      observedOutflowAmount: observedOutflow.toString(),
      deviationBps: deviation,
      verifiedPercent,
      custody:
        custody === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'Destination custody was not classified.')
          : knownValue(custody.kind),
      shareUnitAssessment: shareUnit,
      cadenceAssessment: cadence,
      findings,
      evidenceIds,
    };
  });

  const evidenceIds = unique(items.flatMap((item) => item.evidenceIds));
  const report: ClaimAuditReport = {
    status: aggregateStatus(items.map((item) => item.status)),
    policy,
    items,
    metadata: {
      ...input.metadata,
      modelVersion: CLAIM_AUDIT_MODEL_VERSION,
      evidenceIds,
    },
  };
  ClaimAuditReportSchema.parse(report);
  return report;
}

export * from './flow.js';
export * from './declaration.js';
export * from './review.js';
export * from './burn.js';
export * from './pension-candidate.js';
