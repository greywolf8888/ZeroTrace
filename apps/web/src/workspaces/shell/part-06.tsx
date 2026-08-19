import {
  api,
  type EvmClaimBurnPromotionReplayResponse,
  type StoredPensionCandidateReport,
} from '../../generated-api/client.js';
import { useState, type FormEvent } from 'react';
import { formatTime, shortId, KnowledgeDisplay, titleCase } from './part-01.js';

export function PensionCandidateDiscoveryPanel() {
  const [token, setToken] = useState('');
  const [fromBlock, setFromBlock] = useState('');
  const [toBlock, setToBlock] = useState('');
  const [shareUnitAtomic, setShareUnitAtomic] = useState('');
  const [minimumDeposits, setMinimumDeposits] = useState('5');
  const [minimumDepositors, setMinimumDepositors] = useState('5');
  const [maximumCandidates, setMaximumCandidates] = useState('20');
  const [record, setRecord] = useState<StoredPensionCandidateReport>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'discover' | 'replay'>();
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(token);
  const validRange = (() => {
    if (!/^(0|[1-9]\d*)$/.test(fromBlock) || !/^[1-9]\d*$/.test(toBlock)) return false;
    const from = BigInt(fromBlock);
    const to = BigInt(toBlock);
    return to >= from && to - from + 1n <= 5_000_000n;
  })();
  const validShareUnit = /^[1-9]\d*$/.test(shareUnitAtomic) && shareUnitAtomic.length <= 96;
  const numericPolicy = [minimumDeposits, minimumDepositors, maximumCandidates].map(Number);
  const validPolicy =
    numericPolicy.every((value) => Number.isSafeInteger(value) && value >= 1) &&
    numericPolicy[0]! <= 100_000 &&
    numericPolicy[1]! <= 100_000 &&
    numericPolicy[2]! <= 1_000;

  async function discover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken || !validRange || !validShareUnit || !validPolicy) return;
    setBusy('discover');
    setError(undefined);
    setRecord(undefined);
    try {
      const result = await api.discoverPensionCandidates(token, {
        fromBlock,
        toBlock,
        shareUnitAtomic,
        minimumExactUnitDeposits: numericPolicy[0]!,
        minimumUniqueExactUnitDepositors: numericPolicy[1]!,
        maximumCandidates: numericPolicy[2]!,
      });
      setRecord(result.durableReport);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pension candidate discovery failed.');
    } finally {
      setBusy(undefined);
    }
  }

  async function replayLatest() {
    if (!validToken) return;
    setBusy('replay');
    setError(undefined);
    setRecord(undefined);
    try {
      setRecord((await api.latestPensionCandidateReport(token)).record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pension candidate replay failed.');
    } finally {
      setBusy(undefined);
    }
  }

  const report = record?.report;
  return (
    <section
      className="panel subject-panel quote-panel"
      aria-labelledby="pension-candidate-heading"
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Behavioral discovery · immutable replay</span>
          <h3 id="pension-candidate-heading">养老金金库候选</h3>
        </div>
        <span className="snapshot-badge">BSC SQD · Evidence only</span>
      </div>
      <p className="panel-copy">
        Find wallets receiving repeated exact share-unit deposits across a complete finalized
        Transfer range. Token, range and policy inputs are explicit, asset-independent and versioned
        in the report; a named acceptance case must supply its own reviewed values.
      </p>
      <div className="alert alert-warning">
        <strong>Behavior is not identity</strong>
        <span>
          A matching wallet is only a chain-observed candidate. Official pension ownership, no-exit
          rules, participant membership and weekly dividend execution remain Unknown until
          independently evidenced.
        </span>
      </div>
      <form
        className="quote-form pension-candidate-form"
        onSubmit={(event) => void discover(event)}
      >
        <div className="claim-burn-field pension-token-field">
          <label htmlFor="pension-token">BSC token</label>
          <input
            id="pension-token"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="pension-from">起始区块</label>
          <input
            id="pension-from"
            inputMode="numeric"
            value={fromBlock}
            onChange={(event) => setFromBlock(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="pension-to">终局至区块</label>
          <input
            id="pension-to"
            inputMode="numeric"
            placeholder="当前终局区块"
            value={toBlock}
            onChange={(event) => setToBlock(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field pension-share-field">
          <label htmlFor="pension-share-unit">份额单位（原子量）</label>
          <input
            id="pension-share-unit"
            inputMode="numeric"
            value={shareUnitAtomic}
            onChange={(event) => setShareUnitAtomic(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="pension-min-deposits">Min exact deposits</label>
          <input
            id="pension-min-deposits"
            inputMode="numeric"
            value={minimumDeposits}
            onChange={(event) => setMinimumDeposits(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="pension-min-depositors">Min unique depositors</label>
          <input
            id="pension-min-depositors"
            inputMode="numeric"
            value={minimumDepositors}
            onChange={(event) => setMinimumDepositors(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="pension-max-candidates">Candidate ceiling</label>
          <input
            id="pension-max-candidates"
            inputMode="numeric"
            value={maximumCandidates}
            onChange={(event) => setMaximumCandidates(event.target.value.trim())}
          />
        </div>
        <div className="panel-actions pension-candidate-actions">
          <button
            className="secondary-button"
            type="submit"
            disabled={
              busy !== undefined || !validToken || !validRange || !validShareUnit || !validPolicy
            }
          >
            {busy === 'discover' ? 'Scanning…' : 'Discover candidates'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy !== undefined || !validToken}
            onClick={() => void replayLatest()}
          >
            {busy === 'replay' ? 'Replaying…' : 'Replay latest'}
          </button>
        </div>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {record === undefined || report === undefined ? null : (
        <div className="burn-conservation-result" data-testid="pension-candidate-result">
          <div className="snapshot-strip">
            <span className="status-chip status-up">Complete requested range</span>
            <span>
              <b>Transfers</b> {report.scannedTransferCount}
            </span>
            <span>
              <b>Candidates</b> {report.candidates.length}
            </span>
            <span>
              <b>区间</b> {report.fromBlock}–{report.toBlock}
            </span>
          </div>
          <div className="fact-grid burn-fact-grid">
            <div className="fact-row">
              <span>Durable report</span>
              <code>{record.id}</code>
            </div>
            <div className="fact-row">
              <span>Policy model</span>
              <code>{record.modelVersion}</code>
            </div>
            <div className="fact-row">
              <span>份额单位（原子量）</span>
              <strong>{report.policy.shareUnitAtomic}</strong>
            </div>
            <div className="fact-row">
              <span>Snapshot block</span>
              <strong>{record.toBlock}</strong>
            </div>
            <div className="fact-row">
              <span>Captured</span>
              <strong>{formatTime(record.capturedAt)}</strong>
            </div>
            <div className="fact-row">
              <span>Terminal Evidence</span>
              <code>{record.terminalEvidenceId}</code>
            </div>
          </div>
          {report.candidates.length === 0 ? (
            <p className="panel-copy">
              No wallet satisfied this exact recorded policy inside this complete requested range.
              This does not prove that no pension mechanism exists under another unit, threshold,
              token, or time window.
            </p>
          ) : (
            <div className="claim-draft-list">
              {report.candidates.map((candidate) => (
                <article className="claim-draft-card" key={candidate.address}>
                  <div className="claim-draft-heading">
                    <div>
                      <span className="eyebrow">Behavioral candidate</span>
                      <h4>{shortId(candidate.address, 10)}</h4>
                    </div>
                    <span className="status-chip status-degraded">角色未知</span>
                  </div>
                  <div className="fact-grid">
                    <div className="fact-row">
                      <span>Exact unit deposits</span>
                      <strong>{candidate.exactUnitDepositCount}</strong>
                    </div>
                    <div className="fact-row">
                      <span>Unique exact-unit depositors</span>
                      <strong>{candidate.uniqueExactUnitDepositorCount}</strong>
                    </div>
                    <div className="fact-row">
                      <span>已观测 whole shares</span>
                      <strong>{candidate.observedWholeShares}</strong>
                    </div>
                    <div className="fact-row">
                      <span>已观测 net amount (atomic)</span>
                      <strong>{candidate.observedNetAmount}</strong>
                    </div>
                    <div className="fact-row">
                      <span>已观测 inflows / outflows</span>
                      <strong>
                        {candidate.inflowTransferCount} / {candidate.outflowTransferCount}
                      </strong>
                    </div>
                    <div className="fact-row">
                      <span>First / last inflow</span>
                      <strong>
                        {formatTime(candidate.firstInflowAt)} → {formatTime(candidate.lastInflowAt)}
                      </strong>
                    </div>
                    <div className="fact-row">
                      <span>Official role</span>
                      <KnowledgeDisplay data={candidate.roleAttribution} />
                    </div>
                    <div className="fact-row">
                      <span>No-exit policy</span>
                      <KnowledgeDisplay data={candidate.participantExitPolicy} />
                    </div>
                    <div className="fact-row">
                      <span>Weekly dividends</span>
                      <KnowledgeDisplay data={candidate.dividendExecution} />
                    </div>
                    <div className="fact-row">
                      <span>Candidate Evidence</span>
                      <code>{candidate.evidenceId}</code>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function ClaimBurnPromotionReplayPanel() {
  const [token, setToken] = useState('');
  const [scanId, setScanId] = useState('');
  const [result, setResult] = useState<EvmClaimBurnPromotionReplayResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(token);
  const validScanId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId);

  async function replayPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken || !validScanId) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.replayClaimBurnPromotion(token, scanId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Burn promotion replay failed.');
    } finally {
      setBusy(false);
    }
  }

  const terminal = result?.terminalResult ?? null;
  return (
    <section className="panel subject-panel quote-panel" aria-labelledby="burn-promotion-heading">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Durable worker replay</span>
          <h3 id="burn-promotion-heading">销毁晋升证书</h3>
        </div>
        <span className="snapshot-badge">PostgreSQL replay · no provider</span>
      </div>
      <p className="panel-copy">
        Replay a semantic-worker scan by ID. Completed candidate blocks include exact-block supply
        conservation; event coverage never becomes proof of silent supply changes.
      </p>
      <form
        className="quote-form claim-burn-form"
        onSubmit={(event) => void replayPromotion(event)}
      >
        <div className="claim-burn-field">
          <label htmlFor="claim-burn-promotion-token">Promoted token address</label>
          <input
            id="claim-burn-promotion-token"
            spellCheck={false}
            placeholder="0x…"
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="claim-burn-promotion-scan">Promotion scan ID</label>
          <input
            id="claim-burn-promotion-scan"
            spellCheck={false}
            placeholder="00000000-0000-4000-8000-000000000000"
            value={scanId}
            onChange={(event) => setScanId(event.target.value.trim())}
          />
        </div>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !validToken || !validScanId}
        >
          {busy ? 'Replaying…' : 'Replay promotion'}
        </button>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {result === undefined ? null : (
        <div className="burn-conservation-result">
          <div className="snapshot-strip">
            <span
              className={
                result.scan.status === 'REQUESTED_RANGE_COMPLETE'
                  ? 'status-chip status-up'
                  : 'status-chip status-degraded'
              }
            >
              {titleCase(result.scan.status)}
            </span>
            <span>
              <b>Range progress</b> {(result.scan.requestedRangeCoverage * 100).toFixed(2)}%
            </span>
            <span>
              <b>Next block</b> {result.scan.nextBlock}
            </span>
          </div>
          {terminal === null ? (
            <div className="alert alert-warning">
              <strong>Scan is not terminal</strong>
              <span>
                Resume the identical worker command. No result is inferred from partial segments.
                {result.scan.lastErrorCode === null
                  ? ''
                  : ` Last bounded failure: ${result.scan.lastErrorCode}.`}
              </span>
            </div>
          ) : (
            <>
              <div className="fact-grid burn-fact-grid">
                <div className="fact-row">
                  <span>Candidate blocks</span>
                  <strong>{terminal.burnCandidateCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Verified candidates</span>
                  <strong>{terminal.verifiedCandidateCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Contradicted candidates</span>
                  <strong>{terminal.contradictedCandidateCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Verified actions</span>
                  <strong>{terminal.verifiedActionCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Terminal Evidence</span>
                  <code>{terminal.terminalEvidenceId}</code>
                </div>
                <div className="fact-row">
                  <span>Silent supply changes</span>
                  <strong>{titleCase(terminal.silentSupplyChangeDetection.state)}</strong>
                </div>
              </div>
              <div className="alert alert-warning">
                <strong>Scoped certificate</strong>
                <span>
                  {terminal.silentSupplyChangeDetection.state === 'unknown'
                    ? terminal.silentSupplyChangeDetection.detail
                    : 'Silent supply-change detection must remain Unknown.'}
                </span>
              </div>
              <div className="claim-draft-list">
                {terminal.segments.map((segment) => (
                  <article
                    className="claim-draft-card"
                    key={`${segment.fromBlock}:${segment.toBlock}`}
                  >
                    <div className="claim-draft-heading">
                      <div>
                        <span className="eyebrow">Finalized event segment</span>
                        <h4>
                          Blocks {segment.fromBlock}–{segment.toBlock}
                        </h4>
                      </div>
                      <span className="status-chip status-up">
                        {segment.burnCandidateCount} certified
                      </span>
                    </div>
                    <p className="panel-copy">
                      Discovery Evidence <code>{segment.discoveryTerminalEvidenceId}</code>
                    </p>
                    {segment.certificates.map((certificate) => (
                      <div className="fact-grid" key={certificate.terminalEvidenceId}>
                        <div className="fact-row">
                          <span>Certificate block</span>
                          <strong>{certificate.blockNumber}</strong>
                        </div>
                        <div className="fact-row">
                          <span>Conservation status</span>
                          <strong>{titleCase(certificate.status)}</strong>
                        </div>
                        <div className="fact-row">
                          <span>Burned event amount</span>
                          <strong>{certificate.burnedEventAmount}</strong>
                        </div>
                        <div className="fact-row">
                          <span>Certificate Evidence</span>
                          <code>{certificate.terminalEvidenceId}</code>
                        </div>
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
