import { useLanguage } from './i18n.js';
import type { SettlementResult } from '../../../packages/arc-task-ledger/src/result.js';
import { money } from './model.js';
/** 主应用、报告、独立消费者复用同一服务器结果；这里仅格式化。 */
export function SettlementCard({
  result,
  onEvidence,
  role = 'all',
  compact = false,
}: {
  result: SettlementResult;
  onEvidence?: (ids: string[], metricKey?: string) => void;
  role?: 'all' | 'WORKER' | 'POSTER';
  compact?: boolean;
}) {
  const { localize } = useLanguage();
  const visible = result.metrics.filter(
    (metric) =>
      role === 'all' || metric.role === role || ['TASK', 'PROTOCOL'].includes(metric.role),
  );
  const primary = visible.filter(
    (metric) =>
      metric.key === 'outstanding' ||
      metric.key === 'fee' ||
      metric.phase === 'CLAIMED' ||
      (['WORKER', 'POSTER'].includes(metric.role) && metric.amount.atomic.state === 'known') ||
      (metric.key === 'worker' &&
        !visible.some(
          (m) => ['WORKER', 'POSTER'].includes(m.role) && m.amount.atomic.state === 'known',
        )),
  );
  const secondary = visible.filter((metric) => !primary.includes(metric));
  const renderMetric = (metric: SettlementResult['metrics'][number]) => (
    <article key={metric.key} data-metric={metric.key}>
      <span>{localize(metric.label)}</span>
      <strong className={metric.amount.atomic.state === 'known' ? '' : 'unknown-amount'}>
        {localize(money(metric.amount))}
      </strong>
      <small>
        {localize(
          metric.qualifier === 'AT_LEAST'
            ? '已识别下限；其他历史仍未覆盖'
            : metric.scope === 'FACE_VALUE'
              ? '合约面值，不是到账金额'
              : metric.scope === 'OBSERVED'
                ? '已观察转移；缺失不是零'
                : metric.phase === 'CLAIMED'
                  ? '具体义务后续领取；不是账户整笔提现'
                  : '具体义务；不含账户总余额',
        )}
      </small>
      {localize(
        metric.evidenceIds.length > 0 && onEvidence && (
          <button className="subtle" onClick={() => onEvidence(metric.evidenceIds, metric.key)}>
            {localize('核对')}
            {localize(metric.label)}
            {localize('证据')}
          </button>
        ),
      )}
    </article>
  );
  return (
    <section
      className={'settlement-card ' + result.state + (compact ? ' compact' : '')}
      aria-label={localize('结算结果')}
    >
      <div className="result-lead">
        <span className={'badge ' + result.state}>
          {localize(
            result.state === 'confirmed'
              ? '分配已核验'
              : result.state === 'pending'
                ? '有待领取记录'
                : result.state === 'conflict'
                  ? '证据冲突'
                  : '证据不足',
          )}
        </span>
        <h3>{localize(result.conclusion)}</h3>
      </div>
      <div className="money-grid">{localize((compact ? primary : visible).map(renderMetric))}</div>
      {localize(
        compact && secondary.length > 0 && (
          <details className="secondary-metrics">
            <summary>{localize('面值与其他分配范围')}</summary>
            <div className="money-grid">{localize(secondary.map(renderMetric))}</div>
          </details>
        ),
      )}
      <div className="result-context">
        {localize(
          (compact ? result.reasons.slice(0, 1) : result.reasons).map((reason) => (
            <p key={reason}>{localize(reason)}</p>
          )),
        )}
        {localize(
          !compact && (
            <p>
              <strong>{localize('下一步：')}</strong>
              {localize(result.nextAction)}
            </p>
          ),
        )}
      </div>
    </section>
  );
}
