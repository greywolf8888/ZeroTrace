import { api, type EvmSupplyContinuityReplayResponse } from '../../generated-api/client.js';
import { useState, type FormEvent } from 'react';
import { titleCase, StatusPill } from './part-01.js';
import { ClaimDeclarationPanel } from './part-04.js';
import { PensionCandidateDiscoveryPanel, ClaimBurnPromotionReplayPanel } from './part-06.js';
import { ClaimBurnCandidateDiscoveryPanel, ClaimBurnConservationPanel } from './part-05.js';

export function SupplyContinuityReplayPanel() {
  const [token, setToken] = useState('');
  const [scanId, setScanId] = useState('');
  const [result, setResult] = useState<EvmSupplyContinuityReplayResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(token);
  const validScanId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId);

  async function replaySupply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken || !validScanId) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.replaySupplyContinuity(token, scanId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Supply-continuity replay failed.');
    } finally {
      setBusy(false);
    }
  }

  const terminal = result?.terminalResult ?? null;
  const statusClass =
    terminal?.status === 'VERIFIED_NO_CHANGE' ||
    terminal?.status === 'VERIFIED_EVENT_CONSERVED_CHANGES'
      ? 'status-chip status-up'
      : terminal?.status === 'UNEXPLAINED_SUPPLY_CHANGE'
        ? 'status-chip status-down'
        : 'status-chip status-degraded';
  return (
    <section
      className="panel subject-panel quote-panel"
      aria-labelledby="supply-continuity-heading"
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Supply Reality · durable replay</span>
          <h3 id="supply-continuity-heading">全区块供应连续性</h3>
        </div>
        <span className="snapshot-badge">PostgreSQL replay · no provider</span>
      </div>
      <p className="panel-copy">
        Verify every finalized totalSupply transition in one exact range. Each state read is pinned
        to a canonical block hash; every observed change must reconcile with complete same-block
        mint and burn events.
      </p>
      <form className="quote-form claim-burn-form" onSubmit={(event) => void replaySupply(event)}>
        <div className="claim-burn-field">
          <label htmlFor="claim-supply-token">Supply token address</label>
          <input
            id="claim-supply-token"
            spellCheck={false}
            placeholder="0x…"
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="claim-supply-scan">Supply scan ID</label>
          <input
            id="claim-supply-scan"
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
          {busy ? 'Replaying…' : 'Replay supply proof'}
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
                Resume the identical worker command. Partial samples never become a completed supply
                conclusion.
                {result.scan.lastErrorCode === null
                  ? ''
                  : ` Last bounded failure: ${result.scan.lastErrorCode}.`}
              </span>
            </div>
          ) : (
            <>
              <div className="snapshot-strip">
                <span className={statusClass}>{titleCase(terminal.status)}</span>
                <span>
                  <b>Blocks</b> {terminal.fromBlock}–{terminal.toBlock}
                </span>
                <span>
                  <b>Operators</b> {terminal.sourceIndependence.operatorCount}/
                  {terminal.sourceIndependence.requiredOperators}
                </span>
              </div>
              <div className="fact-grid burn-fact-grid">
                <div className="fact-row">
                  <span>Scanned transitions</span>
                  <strong>{terminal.scannedBlockCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Supply samples</span>
                  <strong>{terminal.supplySampleCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Initial supply</span>
                  <strong>{terminal.initialTotalSupply}</strong>
                </div>
                <div className="fact-row">
                  <span>Final supply</span>
                  <strong>{terminal.finalTotalSupply}</strong>
                </div>
                <div className="fact-row">
                  <span>Net supply delta</span>
                  <strong>{terminal.netSupplyDelta}</strong>
                </div>
                <div className="fact-row">
                  <span>已观测 changes</span>
                  <strong>{terminal.supplyChangeCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Event-conserved</span>
                  <strong>{terminal.eventConservedChangeCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Unexplained</span>
                  <strong>{terminal.unexplainedChangeCount}</strong>
                </div>
                <div className="fact-row">
                  <span>Terminal Evidence</span>
                  <code>{terminal.terminalEvidenceId}</code>
                </div>
              </div>
              <div
                className={
                  terminal.status === 'UNEXPLAINED_SUPPLY_CHANGE'
                    ? 'alert alert-error'
                    : terminal.status === 'INCONCLUSIVE_SOURCE_INDEPENDENCE'
                      ? 'alert alert-warning'
                      : 'alert alert-success'
                }
              >
                <strong>{titleCase(terminal.status)}</strong>
                <span>
                  {terminal.status === 'VERIFIED_NO_CHANGE'
                    ? 'No totalSupply change occurred inside this exact fully sampled range. This does not describe blocks outside the range.'
                    : terminal.status === 'VERIFIED_EVENT_CONSERVED_CHANGES'
                      ? 'Every observed supply change is exactly explained by complete same-block mint/burn events.'
                      : terminal.status === 'UNEXPLAINED_SUPPLY_CHANGE'
                        ? 'At least one totalSupply change is not explained by standard mint/burn events. It remains an anomaly, not an inferred burn.'
                        : 'All requested transitions were sampled, but the configured endpoints do not establish two independent operators.'}
                </span>
              </div>
              <div className="claim-draft-list">
                {terminal.sourceIndependence.attestations.map((attestation) => (
                  <article className="claim-draft-card" key={attestation.sourceId}>
                    <div className="claim-draft-heading">
                      <div>
                        <span className="eyebrow">Official operator attestation</span>
                        <h4>{attestation.operatorName}</h4>
                      </div>
                      <span className="status-chip status-up">{attestation.operatorId}</span>
                    </div>
                    <p className="panel-copy">
                      {attestation.hostname} · Evidence <code>{attestation.evidenceId}</code> ·{' '}
                      <a href={attestation.officialSource} target="_blank" rel="noreferrer">
                        official source
                      </a>
                    </p>
                  </article>
                ))}
              </div>
              <div className="claim-draft-list">
                {terminal.segments.map((segment) => (
                  <article
                    className="claim-draft-card"
                    key={`${segment.fromBlock}:${segment.toBlock}`}
                  >
                    <div className="claim-draft-heading">
                      <div>
                        <span className="eyebrow">All-block segment</span>
                        <h4>
                          Blocks {segment.fromBlock}–{segment.toBlock}
                        </h4>
                      </div>
                      <span
                        className={
                          segment.unexplainedChangeCount === 0
                            ? 'status-chip status-up'
                            : 'status-chip status-down'
                        }
                      >
                        {segment.sampleCount} samples
                      </span>
                    </div>
                    <div className="fact-grid">
                      <div className="fact-row">
                        <span>Start → end supply</span>
                        <strong>
                          {segment.startTotalSupply} → {segment.endTotalSupply}
                        </strong>
                      </div>
                      <div className="fact-row">
                        <span>Segment Evidence</span>
                        <code>{segment.terminalEvidenceId}</code>
                      </div>
                    </div>
                    {segment.changes.length === 0 ? (
                      <p className="panel-copy">
                        No totalSupply transition occurred in this segment.
                      </p>
                    ) : (
                      segment.changes.map((change) => (
                        <div className="fact-grid" key={change.certificateTerminalEvidenceId}>
                          <div className="fact-row">
                            <span>Change block</span>
                            <strong>{change.blockNumber}</strong>
                          </div>
                          <div className="fact-row">
                            <span>Supply delta</span>
                            <strong>{change.supplyDelta}</strong>
                          </div>
                          <div className="fact-row">
                            <span>Event delta</span>
                            <strong>{change.eventNetSupplyDelta}</strong>
                          </div>
                          <div className="fact-row">
                            <span>Reconciliation</span>
                            <strong>{titleCase(change.reconciliationStatus)}</strong>
                          </div>
                          <div className="fact-row">
                            <span>Certificate Evidence</span>
                            <code>{change.certificateTerminalEvidenceId}</code>
                          </div>
                        </div>
                      ))
                    )}
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

export function ClaimAuditWorkspace() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Public statement → review draft → Chain Verify</span>
          <h1>声明核验</h1>
          <p>
            Compile tax, treasury, burn, liquidity, pension, and dividend announcements without
            treating promotional language as an on-chain result.
          </p>
        </div>
        <StatusPill status="HUMAN_REVIEW_REQUIRED" />
      </div>
      <ClaimDeclarationPanel />
      <PensionCandidateDiscoveryPanel />
      <ClaimBurnCandidateDiscoveryPanel />
      <ClaimBurnPromotionReplayPanel />
      <SupplyContinuityReplayPanel />
      <ClaimBurnConservationPanel />
    </>
  );
}
