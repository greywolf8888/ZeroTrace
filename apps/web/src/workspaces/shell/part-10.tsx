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
      setError('Enter a Solana mint and an ordered 终局 slot range up to 50,000 slots.');
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
      if (next === undefined) throw new Error('Capture returned no Solana dealer report.');
      setReport(next);
    } catch (cause) {
      setReport(undefined);
      setError(cause instanceof Error ? cause.message : 'Solana dealer capture failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel subject-panel" data-testid="solana-dealer-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Solana · SQD + finalized RPC · read-only</span>
          <h3>操盘证据捕获</h3>
        </div>
        <StatusPill status={report?.status ?? 'NOT_RUN'} />
      </div>
      <p className="quote-note">
        Captures bounded token-account flows, owner separation, ALT/CPI-normalized transaction
        semantics, same-transaction SOL funding, and possible settlement paths. Unknown opening
        balances and venue attribution remain explicit.
      </p>
      <form
        className="quote-form control-campaign-form"
        onSubmit={(event) => {
          event.preventDefault();
          void capture();
        }}
      >
        <label htmlFor="solana-dealer-mint">Mint</label>
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
              label="Range"
              value={`${report.fromSlot} → ${report.toSlot}`}
              detail="Finalized bounded range"
              state="known"
            />
            <MetricTile
              label="Holders"
              value={String(report.holders.length)}
              detail="Owner identities observed"
              state="known"
            />
            <MetricTile
              label="Token edges"
              value={String(report.tokenFlowEdges.length)}
              detail="Evidence-bound flow edges"
              state="known"
            />
            <MetricTile
              label="Evidence"
              value={String(report.evidenceIds.length)}
              detail="Replayable observations"
              state="known"
            />
            <MetricTile
              label="Launchpad signals"
              value={
                report.launchpadObservations === undefined
                  ? 'Unknown'
                  : String(report.launchpadObservations.length)
              }
              detail="已钉扎 Solana launchpad decodes"
              state={report.launchpadObservations === undefined ? 'unknown' : 'known'}
            />
          </div>
          <div className="two-column">
            <div className="detail-card">
              <span className="eyebrow">Control boundary</span>
              <strong>{report.campaign?.campaign.id ?? 'Not materialized'}</strong>
              <span>
                Funding {report.fundingEdges.length} · Settlement candidates{' '}
                {report.settlementEdges.length}
              </span>
              <span>
                Opening balance Unknown for {report.openingBalanceUnknownWalletIds.length} wallet(s)
              </span>
              <span>PDA owners suppressed: {report.pdaSuppressedOwnerIds.length}</span>
            </div>
            <div className="detail-card">
              <span className="eyebrow">Origin</span>
              <strong>{report.origin.state === 'known' ? '已观测 in range' : 'Unknown'}</strong>
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
                  <th>Owner</th>
                  <th>Token account(s)</th>
                  <th>Balance raw</th>
                  <th>Opening</th>
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
                  <span className="eyebrow">Official read-only decoder</span>
                  <h4>发射台观测</h4>
                </div>
                <span className="panel-note">{report.launchpadObservations.length} signal(s)</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th>Instruction</th>
                    <th>Path</th>
                    <th>Coverage</th>
                    <th>Execution</th>
                  </tr>
                </thead>
                <tbody>
                  {report.launchpadObservations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        No pinned Solana launchpad instruction was decoded in this bounded range.
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
      setError('Enter 1–100 unique canonical Bitcoin transaction IDs (64 hex characters each).');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const next = await api.captureBitcoinForensicGraph(transactionIds);
      const nextReport = next.report ?? next.record?.report;
      if (nextReport === undefined) throw new Error('Capture returned no Bitcoin forensic graph.');
      setResponse(next);
      setReport(nextReport);
    } catch (cause) {
      setResponse(undefined);
      setReport(undefined);
      setError(cause instanceof Error ? cause.message : 'Bitcoin forensic graph capture failed.');
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
          <span className="eyebrow">Bitcoin · Esplora · best-chain · read-only</span>
          <h3>UTXO 取证图</h3>
        </div>
        <StatusPill status={report?.case.evidenceLine.terminalBoundary ?? 'NOT_RUN'} />
      </div>
      <p className="quote-note">
        Captures confirmed transaction UTXO paths, common-input/change candidates, peeling, fanout,
        consolidation, funding and settlement representations. CoinJoin, PayJoin, service
        attribution, and ownership merges remain explicitly suppressed or Unknown.
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
            {busy ? 'Capturing…' : 'Capture Forensic Graph'}
          </button>
          <span className="panel-note">{transactionIds.length}/100 transaction IDs</span>
        </div>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {report === undefined ? null : (
        <div className="campaign-detail-stack" data-testid="bitcoin-forensic-graph-results">
          <div className="metric-grid">
            <MetricTile
              label="Transactions"
              value={String(report.transactionIds.length)}
              detail="Confirmed best-chain observations"
              state="known"
            />
            <MetricTile
              label="Graph nodes"
              value={String(report.nodes.length)}
              detail="Addresses, UTXOs, transactions, Unknowns"
              state="known"
            />
            <MetricTile
              label="Graph edges"
              value={String(report.edges.length)}
              detail="已观测 and bounded candidates"
              state="known"
            />
            <MetricTile
              label="Data coverage"
              value={`${Math.round(report.dataCoverage * 100)}%`}
              detail={`History ${Math.round(report.historyCoverage * 100)}%`}
              state={report.dataCoverage === 1 ? 'known' : 'unknown'}
            />
          </div>
          <div className="two-column">
            <div className="detail-card">
              <span className="eyebrow">Snapshot boundary</span>
              <strong>
                {report.snapshotStart.height ?? 'Unknown'} →{' '}
                {report.snapshotEnd.height ?? 'Unknown'}
              </strong>
              <span>Sources: {report.sourceSet.join(' · ')}</span>
              <span>Freshness: {formatTime(report.freshness)}</span>
            </div>
            <div className="detail-card">
              <span className="eyebrow">Ownership policy</span>
              <strong>自动合并已阻断</strong>
              <span>Case {shortId(report.case.id, 10)}</span>
              <span>
                Graph confidence <KnowledgeDisplay data={report.confidence} />
              </span>
            </div>
          </div>
          {response?.durable === false ? (
            <div className="bitcoin-policy-boundary">
              <strong>Durability boundary</strong>
              <p>PostgreSQL is not configured; this capture is available in the response only.</p>
            </div>
          ) : null}
          {report.suppressionReasons.length > 0 ? (
            <div className="bitcoin-policy-boundary bitcoin-suppression-ledger">
              <strong>Suppression ledger</strong>
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
                  <th>Relationship</th>
                  <th>Class</th>
                  <th>Amount</th>
                  <th>Evidence</th>
                  <th>Reason</th>
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
              Showing 120 of {report.edges.length} edges; the durable report retains the full
              bounded graph.
            </p>
          ) : null}
          <div className="snapshot-strip">
            <span>
              <b>Evidence</b> {report.evidenceIds.length}
            </span>
            <span>
              <b>Source coverage</b> {Math.round(report.sourceCoverage * 100)}%
            </span>
            <span>
              <b>Evidence line</b> {report.case.evidenceLine.phases.length} phase(s)
            </span>
            <span>
              <b>Result</b> <code title={report.resultHash}>{shortId(report.resultHash, 8)}</code>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
