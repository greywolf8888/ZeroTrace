import {
  type FundingSettlementReport,
  type FundingSettlementReportResponse,
} from '../../generated-api/client.js';
import {
  StatusPill,
  titleCase,
  MetricTile,
  KnowledgeDisplay,
  formatTime,
  shortId,
} from './part-01.js';

export function isFundingSettlementReport(
  value: FundingSettlementReportResponse['report'] | undefined,
): value is FundingSettlementReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 'funding-settlement-report-v1'
  );
}

export function FundingSettlementPanel({
  response,
  error,
  layer = 'combined',
}: {
  response: FundingSettlementReportResponse | undefined;
  error: string | undefined;
  layer?: 'combined' | 'funding' | 'settlement';
}) {
  if (error !== undefined) {
    return (
      <section className="panel funding-settlement-panel" data-testid="funding-settlement-report">
        <div className="panel-header">
          <div>
            <span className="eyebrow">资金与结算图</span>
            <h3>持久化报告不可用</h3>
          </div>
          <StatusPill status="UNAVAILABLE" />
        </div>
        <p className="panel-copy funding-settlement-copy">{error}</p>
      </section>
    );
  }

  const report = isFundingSettlementReport(response?.report) ? response.report : undefined;
  if (report === undefined) {
    return (
      <section className="panel funding-settlement-panel" data-testid="funding-settlement-report">
        <div className="panel-header">
          <div>
            <span className="eyebrow">资金与结算图</span>
            <h3>未找到持久化报告</h3>
          </div>
          <StatusPill status="NOT_QUERIED" />
        </div>
        <p className="panel-copy funding-settlement-copy">
          Funding and settlement inference has not been materialized for this token. No numeric
          coverage or ownership conclusion is inferred from the absence of a report.
        </p>
      </section>
    );
  }

  const edges = [
    ...(layer === 'settlement'
      ? []
      : report.fundingEdges.map((edge) => ({ lane: 'Funding', edge }))),
    ...(layer === 'funding'
      ? []
      : report.settlementEdges.map((edge) => ({ lane: 'Settlement', edge }))),
  ];

  return (
    <section className="panel funding-settlement-panel" data-testid="funding-settlement-report">
      <div className="panel-header">
        <div>
          <span className="eyebrow">
            {layer === 'combined' ? '资金与结算图' : `${titleCase(layer)} 图`} · replayable Snapshot
          </span>
          <h3>交易证据，不是所有权证明</h3>
        </div>
        <StatusPill status={report.status} />
      </div>
      <p className="panel-copy funding-settlement-copy">
        This bounded graph records observed asset paths and explicit service boundaries. It does not
        merge entities, establish common control, or treat an uncalibrated confidence value as a
        probability.
      </p>
      <div className="metric-grid compact-grid funding-settlement-metrics">
        <MetricTile
          label="Funding edges"
          value={String(report.fundingEdges.length)}
          detail="已观测 relations"
          state="known"
        />
        <MetricTile
          label="Settlement edges"
          value={String(report.settlementEdges.length)}
          detail="已观测 exits or proceeds"
          state="known"
        />
        <MetricTile
          label="Patterns"
          value={String(report.patterns.length)}
          detail="Deterministic bounded patterns"
          state={report.patterns.length === 0 ? 'unknown' : 'known'}
        />
        <MetricTile
          label="History coverage"
          value={`${Math.round(report.historyCoverage * 100)}%`}
          detail={titleCase(report.coverageScope)}
          state={report.coverageScope === 'RANGE_COMPLETE' ? 'known' : 'unknown'}
        />
      </div>
      <div className="fact-grid funding-settlement-facts">
        <div className="fact-row">
          <span>Report ID</span>
          <code>{report.id}</code>
        </div>
        <div className="fact-row">
          <span>Block range</span>
          <code>
            {report.fromBlock} → {report.toBlock}
          </code>
        </div>
        <div className="fact-row">
          <span>Coverage scope</span>
          <StatusPill status={report.coverageScope} />
        </div>
        <div className="fact-row">
          <span>Snapshot</span>
          <code>{report.snapshot.blockNumber}</code>
        </div>
        <div className="fact-row">
          <span>Confidence</span>
          <KnowledgeDisplay data={report.confidence} />
        </div>
        <div className="fact-row">
          <span>Evidence / drilldown</span>
          <span>
            {report.evidenceIds.length} / {report.drilldown.length} transactions
          </span>
        </div>
        <div className="fact-row">
          <span>Freshness</span>
          <span>{formatTime(report.freshness)}</span>
        </div>
        <div className="fact-row">
          <span>Result hash</span>
          <code>{shortId(report.resultHash, 18)}</code>
        </div>
      </div>
      <div className="funding-settlement-section">
        <div className="panel-header funding-settlement-subheader">
          <div>
            <span className="eyebrow">Exact transaction paths</span>
            <h4>已观测 relations</h4>
          </div>
          <span className="panel-note">{edges.length} edge(s)</span>
        </div>
        <div className="table-scroll">
          <table className="funding-settlement-table">
            <thead>
              <tr>
                <th>Lane</th>
                <th>Relation</th>
                <th>Path</th>
                <th>Asset / amount</th>
                <th>Block / hops</th>
              </tr>
            </thead>
            <tbody>
              {edges.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={5}>
                    No relation was derived within the declared coverage scope.
                  </td>
                </tr>
              ) : (
                edges.map(({ lane, edge }) => (
                  <tr key={lane + ':' + edge.id}>
                    <td>
                      <StatusPill status={lane} />
                    </td>
                    <td>{titleCase(edge.relation)}</td>
                    <td>
                      <code title={edge.path.join(' → ')}>
                        {shortId(edge.source, 6)} → {shortId(edge.destination, 6)}
                      </code>
                      <small className="funding-settlement-subline">
                        tx {shortId(edge.transactionHash, 7)}
                      </small>
                    </td>
                    <td>
                      <code>{edge.asset === 'NATIVE' ? 'Native' : shortId(edge.asset, 7)}</code>
                      <small className="funding-settlement-subline">{edge.amountAtomic}</small>
                    </td>
                    <td>
                      {edge.blockNumber}
                      <small className="funding-settlement-subline">{edge.hopDepth} hop(s)</small>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {report.suppressedPaths.length === 0 ? null : (
        <div className="funding-settlement-section funding-settlement-suppressions">
          <div className="panel-header funding-settlement-subheader">
            <div>
              <span className="eyebrow">Attribution boundaries</span>
              <h4>被抑制路径</h4>
            </div>
            <span className="panel-note">{report.suppressedPaths.length} path(s)</span>
          </div>
          <div className="table-scroll">
            <table className="funding-settlement-table">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Path</th>
                  <th>Transaction</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {report.suppressedPaths.map((path) => (
                  <tr key={path.id}>
                    <td>
                      <StatusPill status={path.reason} />
                    </td>
                    <td>
                      <code>
                        {shortId(path.source, 6)} → {shortId(path.destination, 6)}
                      </code>
                    </td>
                    <td>
                      <code>{shortId(path.transactionHash, 8)}</code>
                    </td>
                    <td>{path.evidenceIds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
