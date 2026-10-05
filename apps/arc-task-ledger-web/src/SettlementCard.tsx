import type { SettlementResult } from '../../../packages/arc-task-ledger/src/result.js';
import { money } from './model.js';
/** 主应用、报告、独立消费者复用同一服务器结果；这里仅格式化。 */
export function SettlementCard({
  result,
  onEvidence,
}: {
  result: SettlementResult;
  onEvidence?: (ids: string[]) => void;
}) {
  return (
    <section className={'settlement-card ' + result.state} aria-label="结算结果">
      <div className="result-lead">
        <span className={'badge ' + result.state}>
          {result.state === 'confirmed'
            ? '分配已核验'
            : result.state === 'pending'
              ? '有待领取记录'
              : result.state === 'conflict'
                ? '证据冲突'
                : '证据不足'}
        </span>
        <h3>{result.conclusion}</h3>
      </div>
      <div className="money-grid">
        {result.metrics.map((metric) => (
          <article key={metric.key} data-metric={metric.key}>
            <span>{metric.label}</span>
            <strong>{money(metric.amount)}</strong>
            <small>
              {metric.scope === 'FACE_VALUE'
                ? '合约面值，不是到账金额'
                : metric.scope === 'OBSERVED'
                  ? '已观察转移；缺失不是零'
                  : '具体义务；不含账户总余额'}
            </small>
            {metric.evidenceIds.length > 0 && onEvidence && (
              <button className="subtle" onClick={() => onEvidence(metric.evidenceIds)}>
                核对{metric.label}证据
              </button>
            )}
          </article>
        ))}
      </div>
      <div className="result-context">
        {result.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        <p>
          <strong>下一步：</strong>
          {result.nextAction}
        </p>
      </div>
    </section>
  );
}
