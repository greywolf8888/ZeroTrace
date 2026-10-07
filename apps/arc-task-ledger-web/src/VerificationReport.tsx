import { useState, type ReactNode } from 'react';
import { useLanguage } from './i18n.js';
import {
  displayUsdc,
  type SettlementCheck,
} from '../../../packages/arc-task-ledger/src/verifier-core.js';
import type { SettlementReport } from '../../../packages/arc-task-ledger/src/verifier-report-core.js';
import type { TransactionObservation } from '../../../packages/arc-task-ledger/src/transaction-reader.js';
export interface Verification {
  report: SettlementReport;
  observation: TransactionObservation;
  canManage?: boolean;
  visibility?: string;
  requestId?: string;
}
export function checkValue(check: SettlementCheck, value: unknown): string {
  if (value === null || value === undefined) return 'Not specified';
  if (check.code === 'AMOUNT') {
    if (typeof value === 'string' && /^\d+$/.test(value)) return displayUsdc(value) + ' USDC';
    if (typeof value === 'object' && value && 'min' in value && 'max' in value) {
      const v = value as { min: string; max: string };
      return v.min === v.max
        ? displayUsdc(v.min) + ' USDC'
        : displayUsdc(v.min) + ' – ' + displayUsdc(v.max) + ' USDC';
    }
  }
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function VerificationReport({
  data,
  dirty = false,
  onEvidence,
  preview = false,
  actions,
}: {
  data: Verification;
  dirty?: boolean;
  onEvidence?: (check: SettlementCheck) => void;
  preview?: boolean;
  actions?: ReactNode;
}) {
  const { t, localize, date } = useLanguage();
  const [showChecks, setShowChecks] = useState(preview);
  const { report, observation } = data;
  const outcome = report.evaluation?.outcome ?? 'INCONCLUSIVE';
  const outcomeText =
    outcome === 'MATCHED'
      ? t('匹配', 'Matched')
      : outcome === 'MISMATCHED'
        ? t('不匹配', 'Mismatched')
        : outcome === 'UNSUPPORTED'
          ? t('暂不支持', 'Unsupported')
          : t('未知', 'Inconclusive');
  const expectation = report.expectation;
  const account = report.evaluation?.account;
  const amountCheck = report.evaluation?.checks.find((c) => c.code === 'AMOUNT');
  const sourceTask = report.taskBinding;
  const money = (v: string | null | undefined) =>
    v == null ? t('未知', 'Unknown') : displayUsdc(v) + ' USDC';
  const names: Record<string, string> = {
    CHAIN: t('网络', 'Network'),
    ACQUISITION: t('链读取', 'Acquisition'),
    TRANSACTION_SUCCESS: t('交易执行', 'Transaction execution'),
    SELECTION: t('选定范围', 'Selected movements'),
    PAYMENT_MOVEMENT: t('付款转移类型', 'Payment movement type'),
    PAYEE: t('收款人', 'Payee'),
    MOVEMENT_PAYER: t('资金付款人', 'Movement payer'),
    AMOUNT: t('金额', 'Amount'),
    NOT_BEFORE: t('最早时间', 'Not before'),
    DEADLINE: t('截止时间', 'Deadline'),
  };
  const state = (v: string) =>
    ({
      PASS: t('通过', 'Pass'),
      FAIL: t('不符合', 'Fail'),
      UNKNOWN: t('未知', 'Unknown'),
      NOT_APPLICABLE: t('不适用', 'Not applicable'),
    })[v] ?? v;
  const value = (c: SettlementCheck, v: unknown) =>
    v == null ? t('未指定', 'Not specified') : localize(checkValue(c, v));
  return (
    <section
      className={'verification-report outcome-' + outcome.toLowerCase()}
      aria-label={t('固定核验报告', 'Immutable verification report')}
    >
      <div className="report-heading">
        <div>
          <p className="eyebrow">
            {preview
              ? t('公开版本预览', 'Public version preview')
              : t('固定报告 · 单笔交易', 'Immutable report · Single transaction')}
          </p>
          <h2>
            {t('条件核对结果', 'Condition outcome')}: {outcomeText}
          </h2>
        </div>
        <span className="badge">
          {data.visibility === 'PUBLIC' || preview
            ? t('公开', 'Public')
            : data.visibility === 'PRIVATE'
              ? t('私有 · 本浏览器会话', 'Private · This browser session')
              : t('访问范围待确认', 'Access scope unconfirmed')}
        </span>
      </div>
      {dirty && (
        <p className="draft-warning" role="status">
          {t(
            '草稿已修改，尚未重新核对。以下结论仅适用于原冻结条件。',
            'Draft changed — not compared yet. The outcome below applies only to the frozen conditions.',
          )}
        </p>
      )}
      {report.acquisition.state !== 'READY' && (
        <p className="scope-note">
          {t('链读取状态', 'Acquisition status')}:{' '}
          {
            {
              PENDING: t('待确认', 'Pending'),
              UNAVAILABLE: t('不可用', 'Unavailable'),
              CONFLICT: t('来源冲突', 'Source conflict'),
              LIMIT_REACHED: t('达到限额', 'Limit reached'),
            }[report.acquisition.state]
          }{' '}
          · <code>{report.acquisition.code}</code>
        </p>
      )}
      <div className="report-money">
        <div>
          <span>{t('选定收款总额', 'Selected amount')}</span>
          <strong>
            {onEvidence && amountCheck ? (
              <a
                href="#amount-evidence"
                aria-label={t('查看选定金额依据', 'Inspect selected amount evidence')}
                onClick={(e) => {
                  e.preventDefault();
                  onEvidence(amountCheck);
                }}
              >
                {money(report.evaluation?.selectedAmountAtomic18)}
              </a>
            ) : (
              money(report.evaluation?.selectedAmountAtomic18)
            )}
          </strong>
        </div>
        {account && (
          <div>
            <span>
              {t(
                '收款人在本交易净变化（未扣Gas）',
                'Payee net movement in this transaction (before Gas)',
              )}
            </span>
            <strong>{money(account.netMovementAtomic18)}</strong>
          </div>
        )}
      </div>
      {actions}
      {account &&
        account.incomingAtomic18 !== null &&
        account.outgoingAtomic18 !== null &&
        account.netMovementAtomic18 === '0' &&
        account.incomingAtomic18 !== '0' && (
          <p className="scope-note">
            {t(
              '本交易观察到收款及等额转出，净增加为0。条件匹配不表示资金最终保留。',
              'Receipt and equal outgoing movement were observed in this transaction: net increase is 0. Matching does not mean the funds were retained.',
            )}
          </p>
        )}
      <dl className="report-facts">
        <div>
          <dt>{t('交易', 'Transaction')}</dt>
          <dd>
            <code>{report.transactionHash}</code>
          </dd>
        </div>
        <div>
          <dt>{t('条件来源', 'Condition source')}</dt>
          <dd>
            {expectation?.provenance === 'REGISTERED_TASK'
              ? t('登记任务协议条件', 'Registered task conditions')
              : expectation
                ? t('用户填写', 'User supplied')
                : t('未填写条件', 'No conditions supplied')}
            {sourceTask && (
              <>
                {' '}
                · {t('任务', 'Task')} #{sourceTask.jobId} · <code>{sourceTask.snapshotRunId}</code>
              </>
            )}
          </dd>
        </div>
        {expectation && (
          <>
            <div>
              <dt>{t('冻结收款人', 'Frozen payee')}</dt>
              <dd>
                <code>{expectation.expectedPayee}</code>
              </dd>
            </div>
            <div>
              <dt>{t('冻结金额规则', 'Frozen amount rule')}</dt>
              <dd>
                {expectation.amountMode === 'EXACT'
                  ? money(expectation.minAmountAtomic18)
                  : money(expectation.minAmountAtomic18) +
                    ' – ' +
                    money(expectation.maxAmountAtomic18)}
              </dd>
            </div>
            <div>
              <dt>{t('冻结资金段', 'Frozen movements')}</dt>
              <dd>
                {expectation.selection.length} {t('条', 'movements')}
              </dd>
            </div>
            {expectation.deadline && (
              <div>
                <dt>{t('截止时间', 'Deadline')}</dt>
                <dd>{date(expectation.deadline)}</dd>
              </div>
            )}
          </>
        )}
        <div>
          <dt>{t('固定区块与时间', 'Fixed block and time')}</dt>
          <dd>
            {report.facts ? (
              <>
                {report.facts.blockNumber} · {date(report.facts.blockTimestamp)}
              </>
            ) : (
              t('未知；链原件未完整取得', 'Unknown; chain originals incomplete')
            )}
          </dd>
        </div>
        <div>
          <dt>{t('观察来源与时间', 'Observed source and time')}</dt>
          <dd>
            {observation.source.alias} · {date(observation.source.observedAt)} ·{' '}
            {t('单来源；真实性由RPC来源声明', 'Single source; authenticity reported by RPC')}
          </dd>
        </div>
        <div>
          <dt>{t('核验规则 / 解析版本', 'Rules / Parser version')}</dt>
          <dd>
            {report.ruleVersion} / {report.parserVersion}
          </dd>
        </div>
      </dl>
      <p className="scope-note">
        {t(
          '核验只覆盖本交易与所选资金段。用途、订单归属、事前约定、履约、跨交易余额及独立来源真实性未验证；证据分数不是概率。',
          'Verification covers this transaction and selected movements only. Purpose, order attribution, prior agreement, fulfillment, cross-transaction balances and independent-source authenticity are unverified. Evidence scores are not probabilities.',
        )}
      </p>
      <details className="report-account">
        <summary>
          {t('查看收入、支出与Gas范围', 'Inspect incoming, outgoing and Gas scope')}
        </summary>
        {account && (
          <dl className="report-facts">
            <div>
              <dt>{t('观察收入', 'Observed incoming')}</dt>
              <dd>{money(account.incomingAtomic18)}</dd>
            </div>
            <div>
              <dt>{t('观察支出', 'Observed outgoing')}</dt>
              <dd>{money(account.outgoingAtomic18)}</dd>
            </div>
            <div>
              <dt>{t('收款人承担Gas', 'Gas borne by payee')}</dt>
              <dd>
                {account.gasAtomic18 === null &&
                report.facts &&
                report.facts.transactionSender !== account.payee
                  ? t(
                      '不适用：本交易由另一地址承担Gas',
                      'Not applicable: another address pays this transaction’s Gas',
                    )
                  : money(account.gasAtomic18)}
              </dd>
            </div>
            <div>
              <dt>{t('Gas付费方', 'Gas payer')}</dt>
              <dd>
                <code>{report.facts?.transactionSender ?? t('未知', 'Unknown')}</code>
              </dd>
            </div>
            <div>
              <dt>{t('交易级Gas（单列）', 'Transaction Gas (separate)')}</dt>
              <dd>{money(report.facts?.gasAtomic18)}</dd>
            </div>
            <div>
              <dt>{t('扣Gas后本交易净变化', 'Net transaction movement after Gas')}</dt>
              <dd>{money(account.netAfterGasAtomic18)}</dd>
            </div>
          </dl>
        )}
      </details>
      {report.evaluation && (
        <section aria-label={t('逐项核验结果', 'Individual checks')}>
          <h3>
            <button
              className="checks-toggle no-print"
              aria-expanded={showChecks}
              onClick={() => setShowChecks(!showChecks)}
            >
              {t('逐项核对与依据', 'Checks and evidence')} ({report.evaluation.checks.length})
            </button>
            <span className="print-only">{t('逐项核对与依据', 'Checks and evidence')}</span>
          </h3>
          <div className={'checks-table checks-content' + (showChecks ? ' expanded' : '')}>
            {report.evaluation.checks.map((c) => (
              <article key={c.code} className={'verification-check ' + c.state.toLowerCase()}>
                <div className="check-heading">
                  <strong>{names[c.code] ?? c.code}</strong>
                  <span>{state(c.state)}</span>
                </div>
                <dl>
                  <div>
                    <dt>{t('期望', 'Expected')}</dt>
                    <dd>{value(c, c.expected)}</dd>
                  </div>
                  <div>
                    <dt>{t('实际', 'Actual')}</dt>
                    <dd>{value(c, c.actual)}</dd>
                  </div>
                </dl>
                {onEvidence && (
                  <button className="no-print" onClick={() => onEvidence(c)}>
                    {t('查看依据', 'Inspect evidence')}
                    {c.movementIds.length > 1 ? ` (${c.movementIds.length})` : ''}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
