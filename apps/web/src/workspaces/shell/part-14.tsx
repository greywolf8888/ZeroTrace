import { api, type ClaimReportResponse } from '../../generated-api/client.js';
import { useState, type FormEvent } from 'react';
import { MetricTile, titleCase, KnowledgeDisplay, formatTime, shortId } from './part-01.js';

export function ClaimReportPanel({ token }: { token: string }) {
  const [address, setAddress] = useState('');
  const [reportId, setReportId] = useState('');
  const [result, setResult] = useState<ClaimReportResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validAddress = /^0x[0-9a-fA-F]{40}$/.test(address);
  const validReportId = reportId === '' || /^ecr_[0-9a-f]{24}$/.test(reportId);

  async function replay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAddress || !validReportId) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(
        reportId === ''
          ? await api.latestClaimReport(token, address)
          : await api.claimReport(token, address, reportId),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '声明报告 replay failed.');
    } finally {
      setBusy(false);
    }
  }

  const record = result?.record;
  const report = record?.report;
  return (
    <section className="panel subject-panel quote-panel" aria-labelledby="claim-report-heading">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Provider-free, immutable replay</span>
          <h3 id="claim-report-heading">声明报告</h3>
        </div>
        <span className="snapshot-badge">已观测 is not Actual</span>
      </div>
      <p className="panel-copy">
        Replay the latest or an exact persisted custody and token-flow observation. This view does
        not infer a dividend, burn, owner, or withdrawal right from a transfer alone.
      </p>
      <form className="quote-form" onSubmit={(event) => void replay(event)}>
        <label htmlFor="claim-subject-address">Claim wallet address</label>
        <input
          id="claim-subject-address"
          spellCheck={false}
          placeholder="0x…"
          value={address}
          onChange={(event) => setAddress(event.target.value.trim())}
        />
        <label htmlFor="claim-report-id">精确报告 ID（可选）</label>
        <input
          id="claim-report-id"
          spellCheck={false}
          placeholder="留空则使用最新"
          value={reportId}
          onChange={(event) => setReportId(event.target.value.trim().toLowerCase())}
        />
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !validAddress || !validReportId}
        >
          {busy ? '加载中…' : reportId === '' ? '加载最新报告' : '精确回放报告'}
        </button>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {record === undefined || report === undefined ? null : (
        <>
          <div className="metric-grid compact-grid">
            <MetricTile
              label="Custody"
              value={titleCase(report.custody.kind)}
              detail={
                report.custody.threshold === undefined
                  ? 'Authority shape at Snapshot'
                  : `${report.custody.threshold}-of-${report.custody.ownerCount ?? '?'} threshold`
              }
              state="known"
            />
            <MetricTile
              label="已观测 inflow"
              value={report.flow.inflow.observedAmount}
              detail={`${report.flow.inflow.transferCount} transfers · atomic units`}
              state="known"
            />
            <MetricTile
              label="已观测 outflow"
              value={report.flow.outflow.observedAmount}
              detail={`${report.flow.outflow.transferCount} transfers · atomic units`}
              state="known"
            />
            <MetricTile
              label="History coverage"
              value={`${Math.round(report.metadata.historyCoverage * 100)}%`}
              detail="Current custody is not historical authority"
              state={report.metadata.historyCoverage === 1 ? 'known' : 'unknown'}
            />
          </div>
          <div className="fact-grid">
            <div className="fact-row">
              <span>Funds movable</span>
              <KnowledgeDisplay data={report.custody.canMoveFunds} />
            </div>
            <div className="fact-row">
              <span>Actual inflow</span>
              <KnowledgeDisplay data={report.flow.inflow.actualAmount} />
            </div>
            <div className="fact-row">
              <span>Actual outflow</span>
              <KnowledgeDisplay data={report.flow.outflow.actualAmount} />
            </div>
            <div className="fact-row">
              <span>Source coverage</span>
              <span>{Math.round(report.metadata.sourceCoverage * 100)}%</span>
            </div>
            <div className="fact-row">
              <span>Share-unit adherence</span>
              {report.flow.shareUnitAssessment === null ? (
                <span className="knowledge-unknown">Not configured</span>
              ) : (
                <KnowledgeDisplay data={report.flow.shareUnitAssessment.exactMultipleCoverage} />
              )}
            </div>
            <div className="fact-row">
              <span>Exact one-unit deposits</span>
              <span>{report.flow.shareUnitAssessment?.exactUnitDeposits ?? 'Not configured'}</span>
            </div>
            <div className="fact-row">
              <span>已观测 whole shares</span>
              <span>
                {report.flow.shareUnitAssessment?.observedWholeShares ?? 'Not configured'}
              </span>
            </div>
            <div className="fact-row">
              <span>Non-multiple deposits</span>
              <span>
                {report.flow.shareUnitAssessment?.nonMultipleDeposits ?? 'Not configured'}
              </span>
            </div>
          </div>
          <div className="snapshot-strip">
            <span>
              <b>Report</b> <code>{record.id}</code>
            </span>
            <span>
              <b>Snapshot</b> {record.snapshotBlock}
            </span>
            <span>
              <b>Window</b> {formatTime(report.window.from)} – {formatTime(report.window.to)}
            </span>
            <span>
              <b>Sources</b> {record.sourceSet.join(', ')}
            </span>
          </div>
          <details className="raw-details">
            <summary>Evidence root and replay identity</summary>
            <dl className="detail-grid">
              <div>
                <dt>Terminal Evidence</dt>
                <dd>
                  <code>{record.terminalEvidenceId}</code>
                </dd>
              </div>
              <div>
                <dt>Snapshot hash</dt>
                <dd>
                  <code>{record.snapshotHash}</code>
                </dd>
              </div>
              <div>
                <dt>Result hash</dt>
                <dd>
                  <code>{record.resultHash}</code>
                </dd>
              </div>
              <div>
                <dt>Captured</dt>
                <dd>{formatTime(record.capturedAt)}</dd>
              </div>
            </dl>
          </details>
          {report.flow.topCounterparties.length === 0 ? null : (
            <details className="raw-details">
              <summary>已观测 top counterparties</summary>
              <div className="fact-grid">
                {report.flow.topCounterparties.map((item) => (
                  <div className="fact-row" key={`${item.direction}:${item.address}`}>
                    <span>
                      {item.direction} · {shortId(item.address)}
                    </span>
                    <span>
                      {item.observedAmount} ({item.transferCount})
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
