import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import { LedgerError } from './types.js';
import {
  VERIFIER_RULE,
  PARSER_VERSION,
  parseExpectation,
  type SettlementExpectation,
} from './verifier-core.js';
import { USDC_NETWORK } from './usdc-log.js';
import type { TransactionObservation } from './transaction-reader.js';
import {
  assertReportJson,
  observationAcquisition,
  settlementReportBase,
  type SettlementReport,
  type ReportBundle,
} from './verifier-report-core.js';
export { assertReportJson, observationAcquisition };
export type { SettlementReport, ReportBundle };
export function buildSettlementReport(
  observation: TransactionObservation,
  input: SettlementExpectation | null,
): SettlementReport {
  assertReportJson(observation.raw);
  const acquisition = observationAcquisition(observation);
  const expectation = input === null ? null : parseExpectation(input);
  const factsHash = hashPayload({
    schemaVersion: 'zasv-facts-hash-v1',
    networkVersion: USDC_NETWORK.version,
    transactionHash: observation.transactionHash,
    facts: acquisition.facts,
  });
  const expectationHash = expectation === null ? null : hashPayload(expectation);
  const base = settlementReportBase(observation, expectation, factsHash, expectationHash);
  assertReportJson(base);
  return { reportId: 'zasv_' + hashPayload(base), ...base };
}
export function buildReportBundle(
  observation: TransactionObservation,
  expectation: SettlementExpectation | null,
): ReportBundle {
  const report = buildSettlementReport(observation, expectation);
  const base = {
    schemaVersion: 'zasv-bundle-v1' as const,
    report,
    observation: structuredClone(observation),
  };
  assertReportJson(base);
  return { ...base, bundleHash: hashPayload(base) };
}
export function replayReportBundle(input: unknown) {
  assertReportJson(input);
  const value = input as ReportBundle;
  if (
    !value ||
    value.schemaVersion !== 'zasv-bundle-v1' ||
    Object.keys(value).sort().join(',') !== 'bundleHash,observation,report,schemaVersion' ||
    !value.report ||
    !value.observation
  )
    throw new LedgerError('INVALID_BUNDLE', '原件包版本或结构不合法。', 400);
  if (
    value.report.ruleVersion !== VERIFIER_RULE ||
    value.report.parserVersion !== PARSER_VERSION ||
    value.report.networkVersion !== USDC_NETWORK.version
  )
    throw new LedgerError('UNSUPPORTED_REPLAY_RULE', '当前复算器不支持该规则版本，不能验证。', 422);
  const { bundleHash, ...base } = value;
  if (hashPayload(base) !== bundleHash)
    throw new LedgerError('BUNDLE_HASH_MISMATCH', '原件包完整性摘要不符。', 409);
  const computed = buildSettlementReport(value.observation, value.report.expectation);
  if (canonicalJson(computed) !== canonicalJson(value.report))
    throw new LedgerError('RECOMPUTATION_MISMATCH', '从原始回执重新解析的结果与报告不符。', 409);
  if (
    canonicalJson(observationAcquisition(value.observation)) !==
    canonicalJson(value.observation.acquisition)
  )
    throw new LedgerError('OBSERVATION_MISMATCH', '原件观察与其保存的规范事实不一致。', 409);
  return {
    integrity: 'PASS' as const,
    recomputation: 'PASS' as const,
    reportId: computed.reportId,
    factsHash: computed.factsHash,
    mainnetAuthenticity: 'NOT_VERIFIED_OFFLINE' as const,
    sourceTrust: 'DECLARED_SOURCE_NOT_AUTHENTICATED' as const,
  };
}
