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
          此 Token 尚未物化资金与结算推断。缺少报告不会被推导为数值覆盖率或所有权结论。
        </p>
      </section>
    );
  }

  const edges = [
    ...(layer === 'settlement' ? [] : report.fundingEdges.map((edge) => ({ lane: '资金', edge }))),
    ...(layer === 'funding' ? [] : report.settlementEdges.map((edge) => ({ lane: '结算', edge }))),
  ];

  return (
    <section className="panel funding-settlement-panel" data-testid="funding-settlement-report">
      <div className="panel-header">
        <div>
          <span className="eyebrow">
            {layer === 'combined' ? '资金与结算图' : `${titleCase(layer)}图`} · 可回放 Snapshot
          </span>
          <h3>交易证据，不是所有权证明</h3>
        </div>
        <StatusPill status={report.status} />
      </div>
      <p className="panel-copy funding-settlement-copy">
        此有界图记录已观测资产路径和显式服务边界；不合并实体、不认定共同控制，也不把未经校准的
        置信值解释为概率。
      </p>
      <div className="metric-grid compact-grid funding-settlement-metrics">
        <MetricTile
          label="资金边"
          value={String(report.fundingEdges.length)}
          detail="已观测关系"
          state="known"
        />
        <MetricTile
          label="结算边"
          value={String(report.settlementEdges.length)}
          detail="已观测退出或所得"
          state="known"
        />
        <MetricTile
          label="模式数"
          value={String(report.patterns.length)}
          detail="确定性有界模式"
          state={report.patterns.length === 0 ? 'unknown' : 'known'}
        />
        <MetricTile
          label="历史覆盖率"
          value={`${Math.round(report.historyCoverage * 100)}%`}
          detail={titleCase(report.coverageScope)}
          state={report.coverageScope === 'RANGE_COMPLETE' ? 'known' : 'unknown'}
        />
      </div>
      <div className="fact-grid funding-settlement-facts">
        <div className="fact-row">
          <span>报告 ID</span>
          <code>{report.id}</code>
        </div>
        <div className="fact-row">
          <span>区块范围</span>
          <code>
            {report.fromBlock} → {report.toBlock}
          </code>
        </div>
        <div className="fact-row">
          <span>覆盖范围</span>
          <StatusPill status={report.coverageScope} />
        </div>
        <div className="fact-row">
          <span>Snapshot</span>
          <code>{report.snapshot.blockNumber}</code>
        </div>
        <div className="fact-row">
          <span>置信度</span>
          <KnowledgeDisplay data={report.confidence} />
        </div>
        <div className="fact-row">
          <span>Evidence / 下钻</span>
          <span>
            {report.evidenceIds.length} / {report.drilldown.length} 笔交易
          </span>
        </div>
        <div className="fact-row">
          <span>新鲜度</span>
          <span>{formatTime(report.freshness)}</span>
        </div>
        <div className="fact-row">
          <span>结果哈希</span>
          <code>{shortId(report.resultHash, 18)}</code>
        </div>
      </div>
      <div className="funding-settlement-section">
        <div className="panel-header funding-settlement-subheader">
          <div>
            <span className="eyebrow">精确交易路径</span>
            <h4>已观测关系</h4>
          </div>
          <span className="panel-note">{edges.length} 条边</span>
        </div>
        <div className="table-scroll">
          <table className="funding-settlement-table">
            <thead>
              <tr>
                <th>通道</th>
                <th>关系</th>
                <th>路径</th>
                <th>资产 / 数量</th>
                <th>区块 / 跳数</th>
              </tr>
            </thead>
            <tbody>
              {edges.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={5}>
                    声明的覆盖范围内未推导出关系。
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
                        交易 {shortId(edge.transactionHash, 7)}
                      </small>
                    </td>
                    <td>
                      <code>{edge.asset === 'NATIVE' ? '原生资产' : shortId(edge.asset, 7)}</code>
                      <small className="funding-settlement-subline">{edge.amountAtomic}</small>
                    </td>
                    <td>
                      {edge.blockNumber}
                      <small className="funding-settlement-subline">{edge.hopDepth} 跳</small>
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
              <span className="eyebrow">归因边界</span>
              <h4>被抑制路径</h4>
            </div>
            <span className="panel-note">{report.suppressedPaths.length} 条路径</span>
          </div>
          <div className="table-scroll">
            <table className="funding-settlement-table">
              <thead>
                <tr>
                  <th>原因</th>
                  <th>路径</th>
                  <th>交易</th>
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
