import {
  api,
  type BitcoinForensicGraphReport,
  type BitcoinForensicGraphResponse,
  type SolanaDealerCampaignReport,
} from '../../generated-api/client.js';
import { useMemo, useState } from 'react';
import {
  StatusPill,
  MetricTile,
  shortId,
  KnowledgeDisplay,
  formatTime,
  titleCase,
} from './part-01.js';

export function SolanaDealerPanel() {
  const [mint, setMint] = useState('');
  const [fromSlot, setFromSlot] = useState('');
  const [toSlot, setToSlot] = useState('');
  const [report, setReport] = useState<SolanaDealerCampaignReport>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function capture() {
    const normalizedMint = mint.trim();
    const normalizedFrom = fromSlot.trim();
    const normalizedTo = toSlot.trim();
    if (
      normalizedMint.length === 0 ||
      !/^\d+$/.test(normalizedFrom) ||
      !/^\d+$/.test(normalizedTo) ||
      BigInt(normalizedTo) < BigInt(normalizedFrom) ||
      BigInt(normalizedTo) - BigInt(normalizedFrom) + 1n > 50_000n
    ) {
      setError('请输入 Solana mint 和有序的终局 slot 区间，最多 50,000 个 slot。');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.captureSolanaDealerCampaign({
        mint: normalizedMint,
        fromSlot: normalizedFrom,
        toSlot: normalizedTo,
      });
      const next = response.report ?? response.record?.report;
      if (next === undefined) throw new Error('捕获结果未返回 Solana 操盘报告。');
      setReport(next);
    } catch (cause) {
      setReport(undefined);
      setError(cause instanceof Error ? cause.message : 'Solana 操盘证据捕获失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel subject-panel" data-testid="solana-dealer-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Solana · SQD + 终局 RPC · 只读</span>
          <h3>操盘证据捕获</h3>
        </div>
        <StatusPill status={report?.status ?? 'NOT_RUN'} />
      </div>
      <p className="quote-note">
        捕获有界 Token 账户流、所有者分离、ALT/CPI 规范化交易语义、同交易 SOL 出资与可能的
        结算路径。未知期初余额和场所归因保持显式未知。
      </p>
      <form
        className="quote-form control-campaign-form"
        onSubmit={(event) => {
          event.preventDefault();
          void capture();
        }}
      >
        <label htmlFor="solana-dealer-mint">Mint 地址</label>
        <input
          id="solana-dealer-mint"
          value={mint}
          onChange={(event) => setMint(event.target.value)}
          placeholder="Solana mint 地址"
          spellCheck={false}
        />
        <label htmlFor="solana-dealer-from">起始 slot</label>
        <input
          id="solana-dealer-from"
          value={fromSlot}
          onChange={(event) => setFromSlot(event.target.value)}
          placeholder="例如 250000000"
          inputMode="numeric"
          spellCheck={false}
        />
        <label htmlFor="solana-dealer-to">结束 slot</label>
        <input
          id="solana-dealer-to"
          value={toSlot}
          onChange={(event) => setToSlot(event.target.value)}
          placeholder="终局 slot"
          inputMode="numeric"
          spellCheck={false}
        />
        <div className="control-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? '捕获中…' : '捕获操盘证据'}
          </button>
        </div>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {report === undefined ? null : (
        <div className="campaign-detail-stack" data-testid="solana-dealer-results">
          <div className="metric-grid">
            <MetricTile
              label="区间"
              value={`${report.fromSlot} → ${report.toSlot}`}
              detail="有界终局区间"
              state="known"
            />
            <MetricTile
              label="持有者"
              value={String(report.holders.length)}
              detail="已观测所有者身份"
              state="known"
            />
            <MetricTile
              label="Token 边"
              value={String(report.tokenFlowEdges.length)}
              detail="Evidence 绑定流向边"
              state="known"
            />
            <MetricTile
              label="Evidence 数"
              value={String(report.evidenceIds.length)}
              detail="可回放观测"
              state="known"
            />
            <MetricTile
              label="发射台信号"
              value={
                report.launchpadObservations === undefined
                  ? '未知'
                  : String(report.launchpadObservations.length)
              }
              detail="已钉扎 Solana 发射台解码"
              state={report.launchpadObservations === undefined ? 'unknown' : 'known'}
            />
          </div>
          <div className="two-column">
            <div className="detail-card">
              <span className="eyebrow">控制边界</span>
              <strong>{report.campaign?.campaign.id ?? '未物化'}</strong>
              <span>
                资金边 {report.fundingEdges.length} · 结算候选 {report.settlementEdges.length}
              </span>
              <span>{report.openingBalanceUnknownWalletIds.length} 个钱包的期初余额未知</span>
              <span>已抑制 PDA 所有者：{report.pdaSuppressedOwnerIds.length}</span>
            </div>
            <div className="detail-card">
              <span className="eyebrow">起源</span>
              <strong>{report.origin.state === 'known' ? '区间内已观测' : '未知'}</strong>
              <span>
                {report.origin.state === 'known' && report.origin.value !== undefined
                  ? `${report.origin.value.tokenProgram} · ${report.origin.value.firstObservedSlot}`
                  : report.origin.reason}
              </span>
              <span>{report.sourceSet.join(' · ')}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>所有者</th>
                  <th>Token 账户</th>
                  <th>原始余额</th>
                  <th>期初余额</th>
                </tr>
              </thead>
              <tbody>
                {report.holders.map((holder) => (
                  <tr key={holder.owner}>
                    <td>
                      <code>{shortId(holder.owner, 8)}</code>
                    </td>
                    <td>
                      <code>
                        {holder.tokenAccounts.map((account) => shortId(account, 8)).join(', ')}
                      </code>
                    </td>
                    <td>{holder.observedBalanceRaw}</td>
                    <td>
                      <KnowledgeDisplay data={holder.openingBalance} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.launchpadObservations === undefined ? null : (
            <div className="table-wrap" data-testid="solana-dealer-launchpad-observations">
              <div className="panel-header funding-settlement-subheader">
                <div>
                  <span className="eyebrow">官方只读解码器</span>
                  <h4>发射台观测</h4>
                </div>
                <span className="panel-note">{report.launchpadObservations.length} 个信号</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>平台</th>
                    <th>指令</th>
                    <th>路径</th>
                    <th>覆盖率</th>
                    <th>执行状态</th>
                  </tr>
                </thead>
                <tbody>
                  {report.launchpadObservations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        此有界区间内没有解码到已钉扎的 Solana 发射台指令。
                      </td>
                    </tr>
                  ) : (
                    report.launchpadObservations.map((observation) => (
                      <tr key={observation.id}>
                        <td>
                          <StatusPill status={observation.platform} />
                        </td>
                        <td>{observation.instructionName}</td>
                        <td>
                          <code>{observation.instructionPath}</code>
                        </td>
                        <td>
                          {Math.round(
                            Math.min(observation.accountCoverage, observation.argumentCoverage) *
                              100,
                          )}
                          %
                        </td>
                        <td>
                          <StatusPill status={observation.execution} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function BitcoinForensicGraphPanel() {
  const [transactionInput, setTransactionInput] = useState('');
  const [response, setResponse] = useState<BitcoinForensicGraphResponse>();
  const [report, setReport] = useState<BitcoinForensicGraphReport>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const transactionIds = useMemo(
    () => [
      ...new Set(
        transactionInput
          .split(/[\s,]+/)
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
    [transactionInput],
  );
  const invalidTransactionId = transactionIds.some((txid) => !/^[0-9a-f]{64}$/.test(txid));
  const validRequest =
    transactionIds.length > 0 && transactionIds.length <= 100 && !invalidTransactionId;

  async function capture() {
    if (!validRequest) {
      setError('请输入 1–100 个唯一、规范的 Bitcoin 交易 ID（每个 64 位十六进制字符）。');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const next = await api.captureBitcoinForensicGraph(transactionIds);
      const nextReport = next.report ?? next.record?.report;
      if (nextReport === undefined) throw new Error('捕获结果未返回 Bitcoin 取证图。');
      setResponse(next);
      setReport(nextReport);
    } catch (cause) {
      setResponse(undefined);
      setReport(undefined);
      setError(cause instanceof Error ? cause.message : 'Bitcoin 取证图捕获失败。');
    } finally {
      setBusy(false);
    }
  }

  const nodeLabels = useMemo(
    () => new Map((report?.nodes ?? []).map((node) => [node.id, node.reference])),
    [report],
  );

  return (
    <section className="panel subject-panel" data-testid="bitcoin-forensic-graph-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Bitcoin · Esplora · 最佳链 · 只读</span>
          <h3>UTXO 取证图</h3>
        </div>
        <StatusPill status={report?.case.evidenceLine.terminalBoundary ?? 'NOT_RUN'} />
      </div>
      <p className="quote-note">
        捕获已确认交易的 UTXO 路径、共同输入/找零候选、剥离、扇出、归集、出资与结算表示。
        CoinJoin、PayJoin、服务归因和所有权合并保持显式抑制或未知。
      </p>
      <form
        className="quote-form control-campaign-form"
        onSubmit={(event) => {
          event.preventDefault();
          void capture();
        }}
      >
        <label htmlFor="bitcoin-forensic-transactions">交易 ID</label>
        <textarea
          id="bitcoin-forensic-transactions"
          value={transactionInput}
          onChange={(event) => setTransactionInput(event.target.value)}
          placeholder="一个或多个 64 字符交易 ID，空格或逗号分隔"
          spellCheck={false}
          rows={3}
        />
        <div className="control-actions">
          <button className="primary-button" type="submit" disabled={busy || !validRequest}>
            {busy ? '捕获中…' : '捕获取证图'}
          </button>
          <span className="panel-note">{transactionIds.length}/100 个交易 ID</span>
        </div>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {report === undefined ? null : (
        <div className="campaign-detail-stack" data-testid="bitcoin-forensic-graph-results">
          <div className="metric-grid">
            <MetricTile
              label="交易数"
              value={String(report.transactionIds.length)}
              detail="已确认最佳链观测"
              state="known"
            />
            <MetricTile
              label="图节点"
              value={String(report.nodes.length)}
              detail="地址、UTXO、交易与未知节点"
              state="known"
            />
            <MetricTile
              label="图边"
              value={String(report.edges.length)}
              detail="已观测和有界候选"
              state="known"
            />
            <MetricTile
              label="数据覆盖率"
              value={`${Math.round(report.dataCoverage * 100)}%`}
              detail={`历史 ${Math.round(report.historyCoverage * 100)}%`}
              state={report.dataCoverage === 1 ? 'known' : 'unknown'}
            />
          </div>
          <div className="two-column">
            <div className="detail-card">
              <span className="eyebrow">Snapshot 边界</span>
              <strong>
                {report.snapshotStart.height ?? '未知'} → {report.snapshotEnd.height ?? '未知'}
              </strong>
              <span>来源：{report.sourceSet.join(' · ')}</span>
              <span>新鲜度：{formatTime(report.freshness)}</span>
            </div>
            <div className="detail-card">
              <span className="eyebrow">所有权策略</span>
              <strong>自动合并已阻断</strong>
              <span>案件 {shortId(report.case.id, 10)}</span>
              <span>
                图谱置信度 <KnowledgeDisplay data={report.confidence} />
              </span>
            </div>
          </div>
          {response?.durable === false ? (
            <div className="bitcoin-policy-boundary">
              <strong>持久性边界</strong>
              <p>未配置 PostgreSQL；本次捕获仅存在于当前响应中。</p>
            </div>
          ) : null}
          {report.suppressionReasons.length > 0 ? (
            <div className="bitcoin-policy-boundary bitcoin-suppression-ledger">
              <strong>抑制账本</strong>
              <ul>
                {report.suppressionReasons.map((reason) => (
                  <li key={reason}>{titleCase(reason)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>关系</th>
                  <th>类别</th>
                  <th>金额</th>
                  <th>Evidence</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {report.edges.slice(0, 120).map((edge) => (
                  <tr key={edge.id}>
                    <td>
                      <StatusPill status={edge.kind} />
                      <code>
                        {shortId(nodeLabels.get(edge.from) ?? edge.from, 7)} →{' '}
                        {shortId(nodeLabels.get(edge.to) ?? edge.to, 7)}
                      </code>
                    </td>
                    <td>{titleCase(edge.classification)}</td>
                    <td>
                      <KnowledgeDisplay data={edge.amountSats} />
                    </td>
                    <td>{edge.evidenceIds.length}</td>
                    <td>{edge.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.edges.length > 120 ? (
            <p className="panel-note">
              当前显示 {report.edges.length} 条边中的 120 条；持久化报告保留完整有界图。
            </p>
          ) : null}
          <div className="snapshot-strip">
            <span>
              <b>Evidence 数</b> {report.evidenceIds.length}
            </span>
            <span>
              <b>来源覆盖率</b> {Math.round(report.sourceCoverage * 100)}%
            </span>
            <span>
              <b>证据线</b> {report.case.evidenceLine.phases.length} 个阶段
            </span>
            <span>
              <b>结果</b> <code title={report.resultHash}>{shortId(report.resultHash, 8)}</code>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
