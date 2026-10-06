import { LedgerError } from './types.js';
import {
  normalizeTransaction,
  evaluateSettlement,
  parseExpectation,
  VERIFIER_RULE,
  PARSER_VERSION,
  REPORT_SCHEMA,
  type SettlementExpectation,
  type Acquisition,
  type TransactionFacts,
  type SettlementEvaluation,
} from './verifier-core.js';
import { USDC_NETWORK } from './usdc-log.js';
import type { TransactionObservation } from './transaction-reader.js';

export interface SettlementReport {
  taskBinding?: {
    jobId: string;
    legId: string;
    snapshotRunId: string;
    ruleVersion: string;
    evidenceIds: string[];
  };
  schemaVersion: typeof REPORT_SCHEMA;
  reportId: string;
  factsHash: string;
  expectationHash: string | null;
  ruleVersion: string;
  parserVersion: string;
  networkVersion: string;
  transactionHash: string;
  acquisition: Omit<Acquisition, 'facts'>;
  facts: TransactionFacts | null;
  expectation: SettlementExpectation | null;
  evaluation: SettlementEvaluation | null;
  confidence: { state: 'UNCALIBRATED'; basis: 'DETERMINISTIC_RULES_WITH_DECLARED_COVERAGE' };
}
export interface ReportBundle {
  schemaVersion: 'zasv-bundle-v1';
  report: SettlementReport;
  observation: TransactionObservation;
  bundleHash: string;
}
export function assertReportJson(value: unknown, depth = 0): void {
  if (depth > 48) throw new LedgerError('BUNDLE_DEPTH_LIMIT', '原件包嵌套过深。', 400);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new LedgerError('NON_CANONICAL_JSON', '拒绝非有限数值。', 400);
    return;
  }
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const n = value.charCodeAt(++i);
        if (!(n >= 0xdc00 && n <= 0xdfff))
          throw new LedgerError('NON_CANONICAL_JSON', '拒绝不完整Unicode。', 400);
      } else if (c >= 0xdc00 && c <= 0xdfff)
        throw new LedgerError('NON_CANONICAL_JSON', '拒绝不完整Unicode。', 400);
    }
    return;
  }
  if (typeof value !== 'object' || value === undefined)
    throw new LedgerError('NON_CANONICAL_JSON', '原件包仅接受规范JSON类型。', 400);
  if (Array.isArray(value)) {
    if (value.length > 20000)
      throw new LedgerError('BUNDLE_ARRAY_LIMIT', '原件数组超过上限。', 400);
    for (const x of value) assertReportJson(x, depth + 1);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new LedgerError('NON_CANONICAL_JSON', '拒绝非JSON对象。', 400);
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw new LedgerError('UNSAFE_BUNDLE_FIELD', '拒绝不安全对象字段。', 400);
    assertReportJson(key, depth + 1);
    assertReportJson(item, depth + 1);
  }
}
export function observationAcquisition(observation: TransactionObservation): Acquisition {
  if (observation.collectionError) {
    const code = observation.collectionError;
    const limited = /LIMIT|DEADLINE|ABORT|TIMEOUT/.test(code);
    return {
      state: limited ? 'LIMIT_REACHED' : code === 'WRONG_CHAIN' ? 'CONFLICT' : 'UNAVAILABLE',
      code,
      facts: null,
      completeness: 'INCOMPLETE',
    };
  }
  return normalizeTransaction(observation.transactionHash, observation.raw);
}
export function settlementReportBase(
  observation: TransactionObservation,
  input: SettlementExpectation | null,
  factsHash: string,
  expectationHash: string | null,
): Omit<SettlementReport, 'reportId'> {
  const acquisition = observationAcquisition(observation);
  const expectation = input === null ? null : parseExpectation(input);
  const task = observation.taskContext;
  if (
    expectation?.provenance === 'REGISTERED_TASK' &&
    (!task ||
      task.schemaVersion !== 'zasv-task-context-v1' ||
      task.expectedPayee !== expectation.expectedPayee ||
      task.expectedMovementPayer !== expectation.expectedMovementPayer ||
      task.expectedAmountAtomic18 !== expectation.minAmountAtomic18 ||
      expectation.amountMode !== 'EXACT' ||
      expectation.minAmountAtomic18 !== expectation.maxAmountAtomic18 ||
      !task.evidenceIds.length)
  )
    throw new LedgerError('TASK_BINDING_CONFLICT', '登记任务条件与固定协议投影不一致。', 409);
  return {
    ...(expectation?.provenance === 'REGISTERED_TASK' && task
      ? {
          taskBinding: {
            jobId: task.jobId,
            legId: task.legId,
            snapshotRunId: task.snapshotRunId,
            ruleVersion: task.ruleVersion,
            evidenceIds: task.evidenceIds,
          },
        }
      : {}),
    schemaVersion: REPORT_SCHEMA,
    factsHash,
    expectationHash,
    ruleVersion: VERIFIER_RULE,
    parserVersion: PARSER_VERSION,
    networkVersion: USDC_NETWORK.version,
    transactionHash: observation.transactionHash,
    acquisition: {
      state: acquisition.state,
      code: acquisition.code,
      completeness: acquisition.completeness,
    },
    facts: acquisition.facts,
    expectation,
    evaluation: expectation === null ? null : evaluateSettlement(acquisition, expectation),
    confidence: {
      state: 'UNCALIBRATED' as const,
      basis: 'DETERMINISTIC_RULES_WITH_DECLARED_COVERAGE' as const,
    },
  };
}
