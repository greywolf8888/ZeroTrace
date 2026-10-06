import { canonicalJson } from '../../evidence/src/canonical.js';
import { USDC_NETWORK } from './usdc-log.js';
import { VERIFIER_RULE, PARSER_VERSION } from './verifier-core.js';
import {
  assertReportJson,
  observationAcquisition,
  settlementReportBase,
  type ReportBundle,
} from './verifier-report-core.js';
import { LedgerError } from './types.js';

export async function browserReplayReportBundle(input: unknown) {
  assertReportJson(input);
  const b = input as ReportBundle;
  if (
    !b ||
    b.schemaVersion !== 'zasv-bundle-v1' ||
    Object.keys(b).sort().join(',') !== 'bundleHash,observation,report,schemaVersion' ||
    !b.report ||
    !b.observation
  )
    throw new LedgerError('INVALID_BUNDLE', '原件包结构无效。', 400);
  if (
    b.report.ruleVersion !== VERIFIER_RULE ||
    b.report.parserVersion !== PARSER_VERSION ||
    b.report.networkVersion !== USDC_NETWORK.version
  )
    throw new LedgerError('UNSUPPORTED_REPLAY_RULE', '当前版本不能复算该规则。', 422);
  const hash = async (value: unknown) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value))),
      ),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
  const { bundleHash, ...bundleBase } = b;
  if ((await hash(bundleBase)) !== bundleHash)
    throw new LedgerError('BUNDLE_HASH_MISMATCH', '原件包完整性摘要不符。', 409);
  const acquisition = observationAcquisition(b.observation);
  const factsHash = await hash({
    schemaVersion: 'zasv-facts-hash-v1',
    networkVersion: USDC_NETWORK.version,
    transactionHash: b.observation.transactionHash,
    facts: acquisition.facts,
  });
  const expectationHash = b.report.expectation === null ? null : await hash(b.report.expectation);
  const base = settlementReportBase(
    b.observation,
    b.report.expectation,
    factsHash,
    expectationHash,
  );
  const report = { reportId: 'zasv_' + (await hash(base)), ...base };
  if (canonicalJson(report) !== canonicalJson(b.report))
    throw new LedgerError('RECOMPUTATION_MISMATCH', '原始回执复算与报告不一致。', 409);
  if (canonicalJson(acquisition) !== canonicalJson(b.observation.acquisition))
    throw new LedgerError('OBSERVATION_MISMATCH', '原件观察事实不一致。', 409);
  return {
    integrity: 'PASS',
    recomputation: 'PASS',
    reportId: report.reportId,
    factsHash,
    expectationHash,
    mainnetAuthenticity: 'NOT_VERIFIED_OFFLINE',
  };
}
