import { useState, type FormEvent } from 'react';

import { api, type PaperEventView, type PaperReviewResponse } from '../generated-api/client.js';
import { zhUserMessage } from '../i18n/zh-CN.js';
import { formatTime, shortId, StatusPill, titleCase } from './shell/index.js';

export function PaperEmptyState({ children }: { children: string }) {
  return <div className="paper-empty">{children}</div>;
}

export function PaperEventTable({ events }: { events: PaperEventView[] }) {
  if (events.length === 0) {
    return <PaperEmptyState>当前实验没有这一阶段的持久记录。</PaperEmptyState>;
  }
  return (
    <div className="table-scroll">
      <table className="paper-table">
        <thead>
          <tr>
            <th>阶段</th>
            <th>资产</th>
            <th>原因</th>
            <th>记录时间</th>
            <th>依据</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>
                <StatusPill status={event.type} />
              </td>
              <td>
                <code title={event.assetId}>{shortId(event.assetId, 9)}</code>
              </td>
              <td>{event.reasons.join('；') || '未提供'}</td>
              <td>{formatTime(event.eventAt)}</td>
              <td>{event.evidenceIds.length} 条</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaperReviewExplorer() {
  const [id, setId] = useState('');
  const [review, setReview] = useState<PaperReviewResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (id.trim().length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      setReview(await api.paperReview(id.trim()));
    } catch (cause) {
      setReview(undefined);
      setError(zhUserMessage(cause instanceof Error ? cause.message : cause, '复盘读取失败。'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel paper-review-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">历史时点 · 防泄漏 · 可重放</span>
          <h3>按复盘编号查看研究结果</h3>
        </div>
        <StatusPill status={review === undefined ? 'UNAVAILABLE' : 'HISTORICAL_AS_OF'} />
      </div>
      <form className="paper-id-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="paper-review-id">复盘编号</label>
        <input
          id="paper-review-id"
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="prv_…"
          spellCheck={false}
        />
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || id.trim().length === 0}
        >
          {busy ? '读取中…' : '打开复盘'}
        </button>
      </form>
      {error === undefined ? null : <div className="alert alert-warning">{error}</div>}
      {review === undefined ? (
        <PaperEmptyState>尚未选择复盘。没有报告时不会生成示例收益或虚构历史结果。</PaperEmptyState>
      ) : (
        <>
          <div className="paper-review-summary">
            <div>
              <span>对应时点</span>
              <strong>{formatTime(review.report.asOf)}</strong>
            </div>
            <div>
              <span>交易覆盖</span>
              <strong>
                {review.report.coverage.tradeIntents.covered}/
                {review.report.coverage.tradeIntents.eligible}
              </strong>
            </div>
            <div>
              <span>拒绝反事实覆盖</span>
              <strong>
                {review.report.coverage.rejectedCounterfactuals.covered}/
                {review.report.coverage.rejectedCounterfactuals.eligible}
              </strong>
            </div>
            <div>
              <span>来源数</span>
              <strong>{review.report.snapshot.sourceSet.length}</strong>
            </div>
          </div>
          <div className="table-scroll">
            <table className="paper-table">
              <thead>
                <tr>
                  <th>拒绝候选</th>
                  <th>结果</th>
                  <th>净反事实损益</th>
                  <th>证据完整度</th>
                  <th>缺失项</th>
                </tr>
              </thead>
              <tbody>
                {review.report.rejectedCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      本次复盘没有拒绝候选。
                    </td>
                  </tr>
                ) : (
                  review.report.rejectedCandidates.map((candidate) => (
                    <tr key={candidate.candidateId}>
                      <td>
                        <code title={candidate.assetId}>{shortId(candidate.assetId, 9)}</code>
                      </td>
                      <td>
                        <StatusPill status={candidate.outcome} />
                      </td>
                      <td>{candidate.netCounterfactualPnlAtomic ?? '未定'}</td>
                      <td>
                        {candidate.confidence.value === null
                          ? '不适用'
                          : `${Math.round(candidate.confidence.value * 100)}%（非概率）`}
                      </td>
                      <td>{candidate.missingStates.map(titleCase).join('、') || '无'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="paper-boundary-note">
            反事实是按冻结成本和退出容量计算的历史估计，不等于已实现收益；证据完整度也不是成功概率。
          </div>
        </>
      )}
    </section>
  );
}
