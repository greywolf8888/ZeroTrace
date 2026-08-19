import {
  api,
  type EvmClaimBurnCandidateDiscoveryResponse,
  type EvmClaimBurnConservationResponse,
} from '../../generated-api/client.js';
import { useState, type FormEvent } from 'react';
import { titleCase, KnowledgeDisplay } from './part-01.js';

export function ClaimBurnConservationPanel() {
  const [token, setToken] = useState('');
  const [blockNumber, setBlockNumber] = useState('');
  const [result, setResult] = useState<EvmClaimBurnConservationResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(token);
  const validBlock = /^[1-9]\d*$/.test(blockNumber);

  async function inspectBurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken || !validBlock) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.inspectClaimBurnConservation(token, blockNumber));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Burn conservation inspection failed.');
    } finally {
      setBusy(false);
    }
  }

  const report = result?.report;
  const statusClass =
    report?.status === 'VERIFIED'
      ? 'status-chip status-up'
      : report?.status === 'CONTRADICTED'
        ? 'status-chip status-down'
        : 'status-chip status-degraded';

  return (
    <section
      className="panel subject-panel quote-panel"
      aria-labelledby="burn-conservation-heading"
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Finalized block certificate</span>
          <h3 id="burn-conservation-heading">销毁供应守恒</h3>
        </div>
        <span className="snapshot-badge">Zero address alone is insufficient</span>
      </div>
      <p className="panel-copy">
        Compare parent/target totalSupply with every Transfer mint and burn in one finalized block.
        This proves or rejects candidate actions for that block; it does not prove a whole window
        has no other actions.
      </p>
      <form className="quote-form claim-burn-form" onSubmit={(event) => void inspectBurn(event)}>
        <div className="claim-burn-field">
          <label htmlFor="claim-burn-token">Burn token address</label>
          <input
            id="claim-burn-token"
            spellCheck={false}
            placeholder="0x…"
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field claim-burn-block-field">
          <label htmlFor="claim-burn-block">Finalized burn block</label>
          <input
            id="claim-burn-block"
            inputMode="numeric"
            placeholder="115000000"
            value={blockNumber}
            onChange={(event) => setBlockNumber(event.target.value.trim())}
          />
        </div>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !validToken || !validBlock}
        >
          {busy ? 'Verifying…' : 'Verify burn conservation'}
        </button>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {report === undefined ? null : (
        <div className="burn-conservation-result">
          <div className="snapshot-strip">
            <span className={statusClass}>{titleCase(report.status)}</span>
            <span>
              <b>Block</b> {report.blockNumber}
            </span>
            <span>
              <b>Terminal Evidence</b> <code>{report.terminalEvidenceId}</code>
            </span>
          </div>
          <div className="fact-grid burn-fact-grid">
            <div className="fact-row">
              <span>Supply before</span>
              <strong>{report.totalSupplyBefore}</strong>
            </div>
            <div className="fact-row">
              <span>Supply after</span>
              <strong>{report.totalSupplyAfter}</strong>
            </div>
            <div className="fact-row">
              <span>Mint events</span>
              <strong>{report.mintedAmount}</strong>
            </div>
            <div className="fact-row">
              <span>Burn events</span>
              <strong>{report.burnedAmount}</strong>
            </div>
            <div className="fact-row">
              <span>Supply delta</span>
              <strong>{report.supplyDelta}</strong>
            </div>
            <div className="fact-row">
              <span>Event net delta</span>
              <strong>{report.eventNetSupplyDelta}</strong>
            </div>
          </div>
          <p className={report.status === 'CONTRADICTED' ? 'inline-error' : 'panel-copy'}>
            {report.status === 'VERIFIED'
              ? 'Supply/event conservation verified. The Evidence-linked actions are eligible for 声明核验.'
              : report.status === 'CONTRADICTED'
                ? 'Supply/event conservation failed. Zero-address Transfers were not credited as burn actions.'
                : 'The complete block is conserved and contains no non-zero burn action.'}
          </p>
          {report.actions.length === 0 ? null : (
            <div className="claim-draft-list">
              {report.actions.map((action) => (
                <article className="claim-draft-card" key={action.id}>
                  <div className="claim-draft-heading">
                    <div>
                      <span className="eyebrow">Conserved action</span>
                      <h4>Burn {action.amount}</h4>
                    </div>
                    <span className="status-chip status-up">Action generated</span>
                  </div>
                  <div className="fact-grid">
                    <div className="fact-row">
                      <span>Actor</span>
                      <code>{action.actor}</code>
                    </div>
                    <div className="fact-row">
                      <span>Path</span>
                      <code>{action.path.join(' → ')}</code>
                    </div>
                    <div className="fact-row">
                      <span>Transfer</span>
                      <code>{action.transferIds.join(', ')}</code>
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

export function ClaimBurnCandidateDiscoveryPanel() {
  const [token, setToken] = useState('');
  const [fromBlock, setFromBlock] = useState('');
  const [toBlock, setToBlock] = useState('');
  const [result, setResult] = useState<EvmClaimBurnCandidateDiscoveryResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(token);
  const validFrom = /^(0|[1-9]\d*)$/.test(fromBlock);
  const validTo = /^[1-9]\d*$/.test(toBlock);
  const ordered = validFrom && validTo && BigInt(fromBlock) <= BigInt(toBlock);

  async function discoverCandidates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken || !ordered) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.discoverClaimBurnCandidates(token, fromBlock, toBlock));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Burn candidate discovery failed.');
    } finally {
      setBusy(false);
    }
  }

  const report = result?.report;
  return (
    <section className="panel subject-panel quote-panel" aria-labelledby="burn-discovery-heading">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Long-range event discovery</span>
          <h3 id="burn-discovery-heading">销毁候选区间</h3>
        </div>
        <span className="snapshot-badge">BSC SQD · read-only</span>
      </div>
      <p className="panel-copy">
        Search a finalized range for non-zero ERC-20 Transfers to the zero address. Each candidate
        still needs the exact-block conservation certificate above. Silent or custom supply changes
        are outside this event query and remain Unknown.
      </p>
      <form
        className="quote-form claim-burn-form"
        onSubmit={(event) => void discoverCandidates(event)}
      >
        <div className="claim-burn-field">
          <label htmlFor="claim-burn-discovery-token">Candidate token address</label>
          <input
            id="claim-burn-discovery-token"
            spellCheck={false}
            placeholder="0x…"
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field claim-burn-block-field">
          <label htmlFor="claim-burn-discovery-from">起始区块</label>
          <input
            id="claim-burn-discovery-from"
            inputMode="numeric"
            placeholder="113485950"
            value={fromBlock}
            onChange={(event) => setFromBlock(event.target.value.trim())}
          />
        </div>
        <div className="claim-burn-field claim-burn-block-field">
          <label htmlFor="claim-burn-discovery-to">结束区块</label>
          <input
            id="claim-burn-discovery-to"
            inputMode="numeric"
            placeholder="115154970"
            value={toBlock}
            onChange={(event) => setToBlock(event.target.value.trim())}
          />
        </div>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !validToken || !ordered}
        >
          {busy ? 'Discovering…' : 'Discover burn candidates'}
        </button>
      </form>
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {report === undefined ? null : (
        <div className="burn-conservation-result">
          <div className="snapshot-strip">
            <span
              className={
                report.status === 'CANDIDATES_DISCOVERED'
                  ? 'status-chip status-degraded'
                  : 'status-chip status-up'
              }
            >
              {titleCase(report.status)}
            </span>
            <span>
              <b>区间</b> {report.fromBlock}–{report.toBlock}
            </span>
            <span>
              <b>Terminal Evidence</b> <code>{report.terminalEvidenceId}</code>
            </span>
          </div>
          <div className="fact-grid burn-fact-grid">
            <div className="fact-row">
              <span>Zero-address events</span>
              <strong>{report.zeroAddressEventCount}</strong>
            </div>
            <div className="fact-row">
              <span>Candidate blocks</span>
              <strong>{report.burnCandidateCount}</strong>
            </div>
            <div className="fact-row">
              <span>Coverage scope</span>
              <code>{report.coverageScope}</code>
            </div>
            <div className="fact-row">
              <span>Silent supply changes</span>
              <KnowledgeDisplay data={report.silentSupplyChangeDetection} />
            </div>
          </div>
          <div className="alert alert-warning">
            <strong>Event-only boundary</strong>
            <span>
              {report.silentSupplyChangeDetection.state === 'unknown'
                ? report.silentSupplyChangeDetection.detail
                : 'Silent supply-change coverage must remain Unknown for this query.'}
            </span>
          </div>
          {report.candidates.length === 0 ? (
            <p className="panel-copy">
              No zero-address burn candidate was observed in the complete event query. This is not
              proof that totalSupply never changed silently.
            </p>
          ) : (
            <div className="claim-draft-list">
              {report.candidates.map((candidate) => (
                <article
                  className="claim-draft-card"
                  key={`${candidate.blockNumber}:${candidate.blockHash}`}
                >
                  <div className="claim-draft-heading">
                    <div>
                      <span className="eyebrow">Needs exact-block promotion</span>
                      <h4>Block {candidate.blockNumber}</h4>
                    </div>
                    <span className="status-chip status-degraded">Candidate only</span>
                  </div>
                  <div className="fact-grid">
                    <div className="fact-row">
                      <span>已观测 burn events</span>
                      <strong>{candidate.burnedEventAmount}</strong>
                    </div>
                    <div className="fact-row">
                      <span>Same-block mint events</span>
                      <strong>{candidate.mintedEventAmount}</strong>
                    </div>
                    <div className="fact-row">
                      <span>Burn Transfers</span>
                      <strong>{candidate.burnTransferIds.length}</strong>
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
