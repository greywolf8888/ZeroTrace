import {
  api,
  type FlapConfigurationField,
  type FlapEventHistoryResponse,
  type FlapHistoryProjectionPageResponse,
  type FlapLifetimeHeadResponse,
  type FlapLifetimeMaterializationResponse,
  type FlapEventTransactionResponse,
} from '../../generated-api/client.js';
import { useState, type FormEvent } from 'react';
import {
  isValidBoundedBlockRange,
  titleCase,
  KnowledgeDisplay,
  shortId,
  formatTime,
} from './part-01.js';
import { EvidencePanel } from './part-03.js';

export function FlapEventTransactionPanel({ token }: { token: string }) {
  const [transactionHash, setTransactionHash] = useState('');
  const [result, setResult] = useState<FlapEventTransactionResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [historyFromBlock, setHistoryFromBlock] = useState('');
  const [historyToBlock, setHistoryToBlock] = useState('');
  const [historyResult, setHistoryResult] = useState<FlapEventHistoryResponse>();
  const [historyError, setHistoryError] = useState<string>();
  const [historyBusy, setHistoryBusy] = useState(false);
  const [projectionScanId, setProjectionScanId] = useState('');
  const [projectionResult, setProjectionResult] = useState<FlapHistoryProjectionPageResponse>();
  const [projectionError, setProjectionError] = useState<string>();
  const [projectionBusy, setProjectionBusy] = useState(false);
  const [lifetimeScanId, setLifetimeScanId] = useState('');
  const [lifetimeResult, setLifetimeResult] = useState<FlapLifetimeMaterializationResponse>();
  const [lifetimeError, setLifetimeError] = useState<string>();
  const [lifetimeBusy, setLifetimeBusy] = useState(false);
  const [latestLifetimeHead, setLatestLifetimeHead] = useState<FlapLifetimeHeadResponse>();
  const [latestLifetimeError, setLatestLifetimeError] = useState<string>();
  const [latestLifetimeBusy, setLatestLifetimeBusy] = useState(false);
  const validTransactionHash = /^0x[0-9a-fA-F]{64}$/.test(transactionHash);
  const validHistoryRange = isValidBoundedBlockRange(historyFromBlock, historyToBlock);
  const validProjectionScanId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      projectionScanId,
    );
  const validLifetimeScanId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      lifetimeScanId,
    );

  async function inspectTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validTransactionHash) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.flapEventTransaction(token, transactionHash));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Flap event inspection failed.');
    } finally {
      setBusy(false);
    }
  }

  async function scanHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validHistoryRange) return;
    setHistoryBusy(true);
    setHistoryError(undefined);
    setHistoryResult(undefined);
    try {
      setHistoryResult(await api.flapEventHistory(token, historyFromBlock, historyToBlock));
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : 'Flap history scan failed.');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function loadProjection(afterBlock?: number) {
    if (!validProjectionScanId) return;
    setProjectionBusy(true);
    setProjectionError(undefined);
    if (afterBlock === undefined) setProjectionResult(undefined);
    try {
      setProjectionResult(await api.flapHistoryProjection(token, projectionScanId, afterBlock));
    } catch (cause) {
      setProjectionError(
        cause instanceof Error ? cause.message : 'Flap history projection replay failed.',
      );
    } finally {
      setProjectionBusy(false);
    }
  }

  function replayProjection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadProjection();
  }

  async function replayLifetime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validLifetimeScanId) return;
    setLifetimeBusy(true);
    setLifetimeError(undefined);
    setLifetimeResult(undefined);
    try {
      setLifetimeResult(await api.flapLifetimeMaterialization(token, lifetimeScanId));
    } catch (cause) {
      setLifetimeError(
        cause instanceof Error ? cause.message : 'Flap lifetime materialization replay failed.',
      );
    } finally {
      setLifetimeBusy(false);
    }
  }

  async function loadLatestLifetimeHead() {
    setLatestLifetimeBusy(true);
    setLatestLifetimeError(undefined);
    setLatestLifetimeHead(undefined);
    try {
      setLatestLifetimeHead(await api.flapLatestLifetimeHead(token));
    } catch (cause) {
      setLatestLifetimeError(
        cause instanceof Error ? cause.message : 'Latest Flap lifetime head replay failed.',
      );
    } finally {
      setLatestLifetimeBusy(false);
    }
  }

  const configurationRows: Array<[string, FlapConfigurationField]> =
    result?.configuration === null || result?.configuration === undefined
      ? []
      : [
          ['Curve address', result.configuration.curveAddress],
          ['Curve parameter', result.configuration.curveParameter],
          ['Virtual quote reserve', result.configuration.virtualQuoteReserve],
          ['Virtual base reserve', result.configuration.virtualBaseReserve],
          ['Virtual liquidity squared', result.configuration.virtualLiquiditySquared],
          ['DEX supply threshold', result.configuration.dexSupplyThreshold],
          ['Quote token', result.configuration.quoteTokenAddress],
          ['Migrator', result.configuration.migratorType],
          ['Token version', result.configuration.tokenVersion],
          ['Buy tax bps', result.configuration.buyTaxBps],
          ['Sell tax bps', result.configuration.sellTaxBps],
          ['DEX', result.configuration.dexId],
          ['LP fee profile', result.configuration.lpFeeProfile],
        ];
  const creationRows: Array<[string, string]> =
    result?.creation === null || result?.creation === undefined
      ? []
      : [
          ['Creator', result.creation.creator],
          ['Name', result.creation.name],
          ['Symbol', result.creation.symbol],
          ['Metadata URI', result.creation.metadataUri],
          ['Nonce', result.creation.nonce],
        ];

  return (
    <>
      <section className="panel subject-panel quote-panel event-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Exact receipt and Portal logs</span>
            <h3>Flap 创建 / 迁移交易</h3>
          </div>
          <span className="snapshot-badge">Transaction-local</span>
        </div>
        <form className="quote-form" onSubmit={(event) => void inspectTransaction(event)}>
          <label htmlFor="flap-event-transaction">Creation or migration transaction hash</label>
          <input
            id="flap-event-transaction"
            placeholder="0x…"
            value={transactionHash}
            onChange={(event) => setTransactionHash(event.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={busy || !validTransactionHash}
          >
            {busy ? 'Decoding receipt…' : '检查 events'}
          </button>
        </form>
        <p className="quote-note">
          This decodes a supplied transaction at its exact block. It does not claim complete launch
          history until automatic chain-wide discovery has run.
        </p>
        {error === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Event inspection unavailable</strong>
            {error}
          </div>
        )}
        {result === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Classification</b> {titleCase(result.transactionKind)}
              </span>
              <span>
                <b>Platform match</b> <KnowledgeDisplay data={result.platformMatch} />
              </span>
              <span>
                <b>Events</b> {result.decodedEventNames.join(', ') || 'None supported'}
              </span>
              <span>
                <b>Unrecognized Portal logs</b> {result.unrecognizedPortalLogCount}
              </span>
              <span>
                <b>History coverage</b> {Math.round(result.metadata.historyCoverage * 100)}%
              </span>
            </div>
            {creationRows.length === 0 ? null : (
              <div className="fact-grid">
                {creationRows.map(([label, value]) => (
                  <div className="fact-row" key={label}>
                    <span>{label}</span>
                    <code>{shortId(value, 16)}</code>
                  </div>
                ))}
              </div>
            )}
            {configurationRows.length === 0 ? null : (
              <div className="fact-grid">
                {configurationRows.map(([label, field]) => (
                  <div className="fact-row" key={label}>
                    <span>
                      {label} <small>{titleCase(field.source)}</small>
                    </span>
                    <KnowledgeDisplay data={field.value} />
                  </div>
                ))}
              </div>
            )}
            {result.migration === null ? null : (
              <div className="fact-grid">
                <div className="fact-row">
                  <span>Launch pool</span>
                  <KnowledgeDisplay
                    data={
                      result.migration.launchedToDex === null
                        ? { state: 'unknown', reason: 'INSUFFICIENT_DATA' }
                        : { state: 'known', value: result.migration.launchedToDex.pool }
                    }
                  />
                </div>
                <div className="fact-row">
                  <span>Token amount</span>
                  <KnowledgeDisplay
                    data={
                      result.migration.launchedToDex === null
                        ? { state: 'unknown', reason: 'INSUFFICIENT_DATA' }
                        : { state: 'known', value: result.migration.launchedToDex.tokenAmount }
                    }
                  />
                </div>
                <div className="fact-row">
                  <span>Quote amount</span>
                  <KnowledgeDisplay
                    data={
                      result.migration.launchedToDex === null
                        ? { state: 'unknown', reason: 'INSUFFICIENT_DATA' }
                        : { state: 'known', value: result.migration.launchedToDex.quoteAmount }
                    }
                  />
                </div>
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel subject-panel event-history-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Chunked read-only Portal log scan</span>
            <h3>Flap 有界事件历史</h3>
          </div>
          <span className="snapshot-badge">最多 50,000 个区块</span>
        </div>
        <form className="history-range-form" onSubmit={(event) => void scanHistory(event)}>
          <label htmlFor="flap-history-from">
            <span>起始区块</span>
            <input
              id="flap-history-from"
              inputMode="numeric"
              value={historyFromBlock}
              onChange={(event) => setHistoryFromBlock(event.target.value.trim())}
              placeholder="起始区块"
            />
          </label>
          <label htmlFor="flap-history-to">
            <span>结束区块</span>
            <input
              id="flap-history-to"
              inputMode="numeric"
              value={historyToBlock}
              onChange={(event) => setHistoryToBlock(event.target.value.trim())}
              placeholder="结束区块"
            />
          </label>
          <button
            className="secondary-button"
            type="submit"
            disabled={historyBusy || !validHistoryRange}
          >
            {historyBusy ? '正在扫描日志…' : '扫描区间'}
          </button>
        </form>
        <p className="quote-note">
          A completed bounded scan proves only the requested range. Token-lifetime coverage stays
          Unknown until deployment-origin indexing is continuous.
        </p>
        {historyError === undefined ? null : (
          <div className="alert alert-warning">
            <strong>History scan unavailable</strong>
            {historyError}
          </div>
        )}
        {historyResult === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Requested range</b> {historyResult.requestedRange.fromBlock}–
                {historyResult.requestedRange.toBlock}
              </span>
              <span>
                <b>Range coverage</b> {Math.round(historyResult.requestedRangeCoverage * 100)}%
              </span>
              <span>
                <b>Lifetime coverage</b> <KnowledgeDisplay data={historyResult.lifetimeCoverage} />
              </span>
              <span>
                <b>Transactions</b> {historyResult.chronology.length}
              </span>
              <span>
                <b>History coverage</b> {Math.round(historyResult.metadata.historyCoverage * 100)}%
              </span>
            </div>
            {historyResult.chronology.length === 0 ? (
              <div className="alert alert-warning">
                <strong>No matching event in this bounded range</strong>
                This is not a token-lifetime absence claim.
              </div>
            ) : (
              <div className="fact-grid">
                {historyResult.chronology.map((item) => (
                  <div className="fact-row" key={item.transactionHash}>
                    <span>
                      Block {item.blockNumber} · {titleCase(item.transactionKind)}
                    </span>
                    <code title={item.transactionHash}>{shortId(item.transactionHash, 10)}</code>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel subject-panel event-history-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Immutable segment replay</span>
            <h3>Flap 持久化历史投影</h3>
          </div>
          <span className="snapshot-badge">链上只读 · 10 segments/page</span>
        </div>
        <form className="quote-form" onSubmit={replayProjection}>
          <label htmlFor="flap-history-scan-id">Worker scan ID</label>
          <input
            id="flap-history-scan-id"
            placeholder="00000000-0000-4000-8000-000000000000"
            value={projectionScanId}
            onChange={(event) => setProjectionScanId(event.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={projectionBusy || !validProjectionScanId}
          >
            {projectionBusy ? 'Loading projection…' : 'Replay projection'}
          </button>
        </form>
        <p className="quote-note">
          Paste the scan ID emitted by <code>flap:history</code>. Pages replay immutable stored
          segments; this view does not trigger SQD/RPC scans or imply token-lifetime coverage.
        </p>
        {projectionError === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Projection replay unavailable</strong>
            {projectionError}
          </div>
        )}
        {projectionResult === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Status</b> {titleCase(projectionResult.scan.status)}
              </span>
              <span>
                <b>Requested range</b> {projectionResult.scan.requestedRange.fromBlock}–
                {projectionResult.scan.requestedRange.toBlock}
              </span>
              <span>
                <b>Range coverage</b>{' '}
                {Math.round(projectionResult.scan.requestedRangeCoverage * 100)}%
              </span>
              <span>
                <b>Next block</b> {projectionResult.scan.nextBlock}
              </span>
              <span>
                <b>Lifetime coverage</b>{' '}
                {projectionResult.scan.terminalResult === null ? (
                  <span className="knowledge-unknown">Not completed</span>
                ) : (
                  <KnowledgeDisplay data={projectionResult.scan.terminalResult.lifetimeCoverage} />
                )}
              </span>
            </div>
            {projectionResult.segments.length === 0 ? (
              <div className="alert alert-warning">
                <strong>No segments on this page</strong>
                The scan may not have advanced to this cursor.
              </div>
            ) : (
              <div className="fact-grid">
                {projectionResult.segments.map((segment) => (
                  <div className="fact-row" key={segment.id}>
                    <span>
                      Blocks {segment.fromBlock}–{segment.toBlock} · {segment.transactionCount}{' '}
                      transactions
                    </span>
                    <code title={segment.terminalEvidenceId}>
                      {shortId(segment.terminalEvidenceId, 10)}
                    </code>
                  </div>
                ))}
              </div>
            )}
            {projectionResult.page.hasMore && projectionResult.page.nextAfterBlock !== null ? (
              <div className="panel-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={projectionBusy}
                  onClick={() =>
                    void loadProjection(projectionResult.page.nextAfterBlock ?? undefined)
                  }
                >
                  {projectionBusy ? '加载中…' : 'Next stored page'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
      <section className="panel subject-panel event-history-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Dataset start → origin → finalized target</span>
            <h3>Flap 精确生命周期物化</h3>
          </div>
          <span className="snapshot-badge">Provider-free replay</span>
        </div>
        <div className="history-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={latestLifetimeBusy}
            onClick={() => void loadLatestLifetimeHead()}
          >
            {latestLifetimeBusy ? '正在加载已接受头…' : '加载最新已接受头'}
          </button>
        </div>
        <p className="quote-note">
          The accepted head is provider-free replay from the append-only scheduler chain. A missing
          head is Unknown, never zero lifetime coverage.
        </p>
        {latestLifetimeError === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Latest accepted head unavailable</strong>
            {latestLifetimeError}
          </div>
        )}
        {latestLifetimeHead === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Accepted sequence</b> {latestLifetimeHead.head.sequence}
              </span>
              <span>
                <b>Head type</b> {titleCase(latestLifetimeHead.head.headType)}
              </span>
              <span>
                <b>Finalized target</b> {latestLifetimeHead.head.targetBlock}
              </span>
              <span>
                <b>Lifetime coverage</b>{' '}
                <KnowledgeDisplay data={latestLifetimeHead.head.result.lifetimeCoverage} />
              </span>
            </div>
            <div className="fact-grid">
              <div className="fact-row">
                <span>Head / scan</span>
                <code title={`${latestLifetimeHead.head.id} / ${latestLifetimeHead.head.scanId}`}>
                  {shortId(latestLifetimeHead.head.id, 10)} ·{' '}
                  {shortId(latestLifetimeHead.head.scanId, 10)}
                </code>
              </div>
              <div className="fact-row">
                <span>Continuity</span>
                {latestLifetimeHead.head.result.continuity === undefined ? (
                  <code>Initial exact materialization</code>
                ) : (
                  <code>
                    {titleCase(latestLifetimeHead.head.result.continuity.status)} ·{' '}
                    {latestLifetimeHead.head.result.predecessor?.targetBlock} →{' '}
                    {latestLifetimeHead.head.result.targetBlock}
                  </code>
                )}
              </div>
              <div className="fact-row">
                <span>Evidence root</span>
                <code title={latestLifetimeHead.head.terminalEvidenceId}>
                  {shortId(latestLifetimeHead.head.terminalEvidenceId, 10)}
                </code>
              </div>
              <div className="fact-row">
                <span>Freshness</span>
                <code>{formatTime(latestLifetimeHead.head.result.metadata.freshness)}</code>
              </div>
            </div>
          </>
        )}
        <form className="quote-form" onSubmit={(event) => void replayLifetime(event)}>
          <label htmlFor="flap-lifetime-scan-id">Lifetime materialization scan ID</label>
          <input
            id="flap-lifetime-scan-id"
            placeholder="00000000-0000-4000-8000-000000000000"
            value={lifetimeScanId}
            onChange={(event) => setLifetimeScanId(event.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={lifetimeBusy || !validLifetimeScanId}
          >
            {lifetimeBusy ? 'Loading lifetime proof…' : 'Replay lifetime proof'}
          </button>
        </form>
        <p className="quote-note">
          Paste the scan ID emitted by <code>flap:lifetime</code>. Known lifetime coverage requires
          official SQD dataset-start coverage, one unique deployment origin, and complete supported
          Portal event history through the same finalized Snapshot. This view performs no chain
          reads.
        </p>
        {lifetimeError === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Lifetime replay unavailable</strong>
            {lifetimeError}
          </div>
        )}
        {lifetimeResult === undefined ? null : (
          <>
            <div className="snapshot-strip">
              <span>
                <b>Status</b> {titleCase(lifetimeResult.scan.status)}
              </span>
              <span>
                <b>Dataset coverage</b> {lifetimeResult.scan.datasetStartBlock}–
                {lifetimeResult.scan.targetBlock}
              </span>
              <span>
                <b>Materialization coverage</b>{' '}
                {Math.round(lifetimeResult.scan.requestedRangeCoverage * 100)}%
              </span>
              <span>
                <b>Lifetime coverage</b>{' '}
                {lifetimeResult.scan.terminalResult === null ? (
                  <span className="knowledge-unknown">Not completed</span>
                ) : (
                  <KnowledgeDisplay data={lifetimeResult.scan.terminalResult.lifetimeCoverage} />
                )}
              </span>
            </div>
            {lifetimeResult.scan.terminalResult === null ? (
              <div className="alert alert-warning">
                <strong>Composite checkpoint is still running</strong>
                No terminal lifetime conclusion is available yet; this is not zero coverage.
              </div>
            ) : (
              <div className="fact-grid">
                <div className="fact-row">
                  <span>Deployment origin</span>
                  {lifetimeResult.scan.terminalResult.origin.state === 'known' ? (
                    <code>
                      Block{' '}
                      {lifetimeResult.scan.terminalResult.origin.value?.creationTrace.blockNumber}
                    </code>
                  ) : (
                    <KnowledgeDisplay data={lifetimeResult.scan.terminalResult.origin} />
                  )}
                </div>
                <div className="fact-row">
                  <span>Origin scan</span>
                  <code title={lifetimeResult.scan.terminalResult.originScanId}>
                    {shortId(lifetimeResult.scan.terminalResult.originScanId, 10)}
                  </code>
                </div>
                <div className="fact-row">
                  <span>Origin search</span>
                  {lifetimeResult.scan.terminalResult.originSearchMode === 'VERIFIED_HINT' ? (
                    <span className="knowledge-unknown">
                      Verified hint only · full dataset incomplete
                    </span>
                  ) : (
                    <code>Full dataset</code>
                  )}
                </div>
                <div className="fact-row">
                  <span>History projection</span>
                  {lifetimeResult.scan.terminalResult.historyProjection === null ? (
                    <span className="knowledge-unknown">Unknown · no unique origin</span>
                  ) : (
                    <code title={lifetimeResult.scan.terminalResult.historyProjection.scanId}>
                      {lifetimeResult.scan.terminalResult.historyProjection.segmentCount} segments ·{' '}
                      {lifetimeResult.scan.terminalResult.historyProjection.transactionCount}{' '}
                      transactions
                    </code>
                  )}
                </div>
                <div className="fact-row">
                  <span>Evidence confidence</span>
                  <code>
                    {Math.round(lifetimeResult.scan.terminalResult.metadata.confidence * 100)}%
                  </code>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {result === undefined || result.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={result.evidence}
          eyebrow="Receipt → Portal event → normalized fact"
          title="Flap 交易证据账本"
        />
      )}
      {historyResult === undefined || historyResult.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={historyResult.evidence}
          eyebrow="Bounded Portal logs → receipt-replayed chronology"
          title="Flap 历史证据账本"
        />
      )}
      {lifetimeResult?.scan.terminalResult === null ||
      lifetimeResult?.scan.terminalResult === undefined ||
      lifetimeResult.scan.terminalResult.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={lifetimeResult.scan.terminalResult.evidence}
          eyebrow="SQD dataset metadata → origin proof → history projection"
          title="Flap 生命周期证据根"
        />
      )}
      {latestLifetimeHead === undefined ||
      latestLifetimeHead.head.result.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={latestLifetimeHead.head.result.evidence}
          eyebrow="Accepted predecessor → continuity proof → delta projection"
          title="最新 Flap 生命周期头证据根"
        />
      )}
    </>
  );
}
