import {
  api,
  type ClaimDeclarationParseResponse,
  type ClaimRuleReviewResponse,
  type Erc20DecimalsObservationResponse,
  type KnowledgeValue,
  type ReviewedClaimRuleValues,
} from '../../generated-api/client.js';
import { useState, type FormEvent } from 'react';
import { formatTime, KnowledgeDisplay, titleCase } from './part-01.js';

export function ClaimDeclarationPanel({ token }: { token?: string | undefined }) {
  const [tokenInput, setTokenInput] = useState(token ?? '');
  const [text, setText] = useState('');
  const [windowFrom, setWindowFrom] = useState('');
  const [windowTo, setWindowTo] = useState('');
  const [result, setResult] = useState<ClaimDeclarationParseResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reviewResults, setReviewResults] = useState<Record<string, ClaimRuleReviewResponse>>({});
  const [decimalsObservation, setDecimalsObservation] =
    useState<Erc20DecimalsObservationResponse>();
  const activeToken = token ?? tokenInput;
  const validToken = /^0x[0-9a-fA-F]{40}$/.test(activeToken);
  const hasWindow = windowFrom.length > 0 || windowTo.length > 0;
  const parsedFrom = Date.parse(windowFrom);
  const parsedTo = Date.parse(windowTo);
  const validWindow =
    !hasWindow ||
    (windowFrom.length > 0 &&
      windowTo.length > 0 &&
      Number.isFinite(parsedFrom) &&
      Number.isFinite(parsedTo) &&
      parsedFrom <= parsedTo);

  async function parseDeclaration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim().length === 0 || !validWindow || !validToken) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setReviewResults({});
    setDecimalsObservation(undefined);
    try {
      setResult(
        await api.parseClaimDeclaration(
          activeToken,
          text,
          hasWindow ? { from: windowFrom, to: windowTo } : undefined,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Claim declaration parsing failed.');
    } finally {
      setBusy(false);
    }
  }

  async function observeDecimals() {
    if (!validToken) return;
    setBusy(true);
    setError(undefined);
    try {
      setDecimalsObservation(await api.observeErc20Decimals(activeToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Token decimals observation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function reviewDraft(
    draft: ClaimDeclarationParseResponse['drafts'][number],
    form: HTMLFormElement,
  ) {
    if (result === undefined) return;
    const values = new FormData(form);
    const optional = (field: string) => {
      const value = String(values.get(field) ?? '').trim();
      return value.length === 0 ? undefined : value;
    };
    const reviewerLabel = optional('reviewerLabel');
    if (reviewerLabel === undefined) return;
    const decimalsText = optional('tokenDecimals');
    const observedDecimals =
      decimalsObservation?.decimals.state === 'known'
        ? decimalsObservation.decimals.value
        : undefined;
    const tokenDecimals = decimalsText === undefined ? observedDecimals : Number(decimalsText);
    const tokenDecimalsEvidenceId =
      optional('tokenDecimalsEvidenceId') ?? decimalsObservation?.evidence.id;
    const expectedShareBps = optional('expectedShareBps');
    const declaredHumanShareUnit =
      draft.shareUnitTokens.state === 'known' ? draft.shareUnitTokens.value : undefined;
    const shareUnit =
      optional('shareUnit') ??
      (declaredHumanShareUnit === undefined || tokenDecimals === undefined
        ? undefined
        : (BigInt(declaredHumanShareUnit) * 10n ** BigInt(tokenDecimals)).toString());
    const noExit = optional('noExit');
    const cadenceSeconds = optional('cadenceSeconds');
    const reviewedRule: ReviewedClaimRuleValues = {
      sourceAddress: String(values.get('sourceAddress') ?? '').trim(),
      destinationAddress: String(values.get('destinationAddress') ?? '').trim(),
      role: String(values.get('role') ?? draft.role),
      expectedAction: String(values.get('expectedAction') ?? draft.expectedAction),
      ...(expectedShareBps === undefined ? {} : { expectedShareBps }),
      window: {
        from: String(values.get('windowFrom') ?? '').trim(),
        to: String(values.get('windowTo') ?? '').trim(),
      },
      ...(shareUnit === undefined ? {} : { shareUnit }),
      ...(noExit === undefined ? {} : { noExit: noExit === 'true' }),
      ...(cadenceSeconds === undefined ? {} : { cadenceSeconds }),
    };
    setBusy(true);
    setError(undefined);
    try {
      const review = await api.reviewClaimRule(
        result.id,
        draft.id,
        reviewerLabel,
        reviewedRule,
        tokenDecimals,
        tokenDecimalsEvidenceId,
      );
      setReviewResults((current) => ({ ...current, [draft.id]: review }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Claim rule review failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel subject-panel quote-panel"
      aria-labelledby="claim-declaration-heading"
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Off-chain statement compiler</span>
          <h3 id="claim-declaration-heading">声明文本审阅</h3>
        </div>
        <span className="snapshot-badge">Declaration ≠ chain fact</span>
      </div>
      <p className="panel-copy">
        Paste a public announcement to create Evidence-linked review drafts. Missing addresses,
        exact dates, token decimals, or action proof remain Unknown and cannot enter Chain Verify.
      </p>
      <form
        className="quote-form claim-declaration-form"
        onSubmit={(event) => void parseDeclaration(event)}
      >
        {token === undefined ? (
          <>
            <label htmlFor="claim-declaration-token">BSC token address</label>
            <input
              id="claim-declaration-token"
              spellCheck={false}
              placeholder="0x…"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value.trim())}
            />
          </>
        ) : null}
        <label htmlFor="claim-declaration-text">公告文本</label>
        <textarea
          id="claim-declaration-text"
          placeholder="粘贴原始税率、销毁、流动性、金库、养老金或分红声明"
          value={text}
          maxLength={100_000}
          onChange={(event) => setText(event.target.value)}
        />
        <label htmlFor="claim-window-from">审计窗口开始（可选，带时区的 ISO 8601）</label>
        <input
          id="claim-window-from"
          spellCheck={false}
          placeholder="2026-08-02T00:00:00+08:00"
          value={windowFrom}
          onChange={(event) => setWindowFrom(event.target.value.trim())}
        />
        <label htmlFor="claim-window-to">Audit window end (optional, ISO 8601 with timezone)</label>
        <input
          id="claim-window-to"
          spellCheck={false}
          placeholder="2026-08-10T23:59:59+08:00"
          value={windowTo}
          onChange={(event) => setWindowTo(event.target.value.trim())}
        />
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || text.trim().length === 0 || !validWindow || !validToken}
        >
          {busy ? 'Compiling…' : 'Compile review drafts'}
        </button>
      </form>
      {!validWindow ? (
        <p className="inline-error">
          Supply both timezone-qualified boundaries and keep the end at or after the start.
        </p>
      ) : null}
      {error === undefined ? null : <p className="inline-error">{error}</p>}
      {result === undefined ? null : (
        <>
          <div className="snapshot-strip">
            <span>
              <b>Report</b> <code>{result.id}</code>
            </span>
            <span>
              <b>Drafts</b> {result.drafts.length}
            </span>
            <span>
              <b>Captured</b> {formatTime(result.freshness)}
            </span>
          </div>
          <div className="fact-grid claim-declaration-audit-grid">
            <div className="fact-row">
              <span>Source document Snapshot</span>
              <code>{result.sourceSnapshot.id}</code>
            </div>
            <div className="fact-row">
              <span>Document capture</span>
              <strong>{(result.coverage.documentCapture * 100).toFixed(0)}%</strong>
            </div>
            <div className="fact-row">
              <span>Field extraction coverage</span>
              <KnowledgeDisplay data={result.coverage.fieldExtraction} />
            </div>
            <div className="fact-row">
              <span>Independent-source coverage</span>
              <KnowledgeDisplay data={result.coverage.sourceIndependence} />
            </div>
            <div className="fact-row">
              <span>Chain verification coverage</span>
              <KnowledgeDisplay data={result.coverage.chainVerification} />
            </div>
            <div className="fact-row">
              <span>Extraction confidence</span>
              <KnowledgeDisplay data={result.extractionConfidence} />
            </div>
            <div className="fact-row">
              <span>Durable report</span>
              <KnowledgeDisplay data={result.durableReport} />
            </div>
            <div className="fact-row">
              <span>Terminal Evidence</span>
              <code>{result.terminalEvidenceId}</code>
            </div>
          </div>
          <p className="panel-copy">
            Extraction confidence measures deterministic parser coverage only. It does not measure
            whether the announcement is authentic or whether the declared actions occurred.
          </p>
          <details className="raw-details">
            <summary>精确回放 captured source document</summary>
            <dl className="evidence-meta-list">
              <div>
                <dt>Content hash</dt>
                <dd>
                  <code>{result.sourceSnapshot.contentHash}</code>
                </dd>
              </div>
              <div>
                <dt>Parser</dt>
                <dd>{result.parserVersion}</dd>
              </div>
              <div>
                <dt>Source Evidence</dt>
                <dd>
                  <code>{result.evidence.id}</code>
                </dd>
              </div>
            </dl>
            <pre>{result.sourceSnapshot.content}</pre>
          </details>
          {result.warnings.length === 0 ? null : (
            <div className="claim-warning-list" role="status">
              {result.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          {result.drafts.length === 0 ? (
            <div className="empty-state compact-empty">
              <strong>No supported declaration found</strong>
              <span>The source text is preserved as Analyst Evidence without invented rules.</span>
            </div>
          ) : (
            <div className="claim-draft-list">
              {result.drafts.map((draft) => {
                const review = reviewResults[draft.id];
                const known = <T,>(value: KnowledgeValue<T>): T | undefined =>
                  value.state === 'known' ? value.value : undefined;
                const declaredShareUnit = known(draft.shareUnitTokens);
                return (
                  <article className="claim-draft-card" key={draft.id}>
                    <div className="claim-draft-heading">
                      <div>
                        <span className="eyebrow">{titleCase(draft.role)}</span>
                        <h4>{titleCase(draft.expectedAction)}</h4>
                      </div>
                      <span
                        className={
                          draft.chainVerifyReadiness === 'READY_FOR_REVIEW'
                            ? 'status-chip status-up'
                            : 'status-chip status-degraded'
                        }
                      >
                        {titleCase(draft.chainVerifyReadiness)}
                      </span>
                    </div>
                    <div className="fact-grid">
                      <div className="fact-row">
                        <span>Source</span>
                        <KnowledgeDisplay data={draft.sourceAddress} />
                      </div>
                      <div className="fact-row">
                        <span>Destination</span>
                        <KnowledgeDisplay data={draft.destinationAddress} />
                      </div>
                      <div className="fact-row">
                        <span>Expected share bps</span>
                        <KnowledgeDisplay data={draft.expectedShareBps} />
                      </div>
                      <div className="fact-row">
                        <span>Share unit (tokens)</span>
                        <KnowledgeDisplay data={draft.shareUnitTokens} />
                      </div>
                      <div className="fact-row">
                        <span>No-exit wording</span>
                        <KnowledgeDisplay data={draft.noExit} />
                      </div>
                      <div className="fact-row">
                        <span>Cadence seconds</span>
                        <KnowledgeDisplay data={draft.cadenceSeconds} />
                      </div>
                    </div>
                    <div className="claim-draft-footer">
                      <span>
                        Missing:{' '}
                        {draft.missingFields.length === 0 ? 'none' : draft.missingFields.join(', ')}
                      </span>
                      <span>Human review required</span>
                    </div>
                    <details className="raw-details">
                      <summary>已匹配 declaration text</summary>
                      <pre>{draft.matchedText}</pre>
                    </details>
                    <form
                      id={`claim-review-${draft.id}`}
                      className="claim-review-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void reviewDraft(draft, event.currentTarget);
                      }}
                    >
                      <div className="claim-review-boundary">
                        Review materializes an Expected rule only. It does not verify the claim or
                        schedule a chain scan.
                      </div>
                      <label>
                        Reviewer label
                        <input name="reviewerLabel" defaultValue="local analyst session" required />
                      </label>
                      <label>
                        Source address
                        <input
                          name="sourceAddress"
                          defaultValue={known(draft.sourceAddress) ?? ''}
                          placeholder="0x…"
                          pattern="0x[0-9a-fA-F]{40}"
                          required
                        />
                      </label>
                      <label>
                        Destination address
                        <input
                          name="destinationAddress"
                          defaultValue={known(draft.destinationAddress) ?? ''}
                          placeholder="0x…"
                          pattern="0x[0-9a-fA-F]{40}"
                          required
                        />
                      </label>
                      <label>
                        Role
                        <select name="role" defaultValue={draft.role}>
                          {[
                            'TAX_RECEIVER',
                            'COMMUNITY_FUND',
                            'BUYBACK_BURN',
                            'BUYBACK_LIQUIDITY',
                            'PENSION_VAULT',
                            'DIVIDEND_DISTRIBUTOR',
                            'OTHER',
                          ].map((item) => (
                            <option key={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Expected action
                        <select name="expectedAction" defaultValue={draft.expectedAction}>
                          {[
                            'RECEIVE',
                            'DISTRIBUTE',
                            'BUYBACK',
                            'BURN',
                            'ADD_LIQUIDITY',
                            'LOCK',
                            'PAY_DIVIDEND',
                          ].map((item) => (
                            <option key={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Expected share (bps, optional)
                        <input
                          name="expectedShareBps"
                          defaultValue={known(draft.expectedShareBps) ?? ''}
                          inputMode="numeric"
                        />
                      </label>
                      <label>
                        Window start
                        <input
                          name="windowFrom"
                          defaultValue={known(draft.window)?.from ?? ''}
                          required
                        />
                      </label>
                      <label>
                        Window end
                        <input
                          name="windowTo"
                          defaultValue={known(draft.window)?.to ?? ''}
                          required
                        />
                      </label>
                      <label>
                        Share unit (atomic, optional)
                        <input
                          name="shareUnit"
                          defaultValue=""
                          placeholder={
                            declaredShareUnit === undefined
                              ? 'Atomic units'
                              : `${declaredShareUnit} human tokens require decimals Evidence`
                          }
                        />
                      </label>
                      <label>
                        Token decimals (required for human-token share units)
                        <input
                          name="tokenDecimals"
                          inputMode="numeric"
                          min="0"
                          max="255"
                          defaultValue={
                            decimalsObservation?.decimals.state === 'known'
                              ? decimalsObservation.decimals.value
                              : ''
                          }
                        />
                      </label>
                      <label>
                        Token-decimals Evidence ID
                        <input
                          name="tokenDecimalsEvidenceId"
                          placeholder="ev_…"
                          defaultValue={decimalsObservation?.evidence.id ?? ''}
                        />
                      </label>
                      <label>
                        No-exit rule (optional)
                        <select name="noExit" defaultValue={known(draft.noExit)?.toString() ?? ''}>
                          <option value="">Not set</option>
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      </label>
                      <label>
                        Cadence seconds (optional)
                        <input
                          name="cadenceSeconds"
                          defaultValue={known(draft.cadenceSeconds) ?? ''}
                        />
                      </label>
                      <button className="secondary-button" type="submit" disabled={busy}>
                        {busy ? 'Saving review…' : 'Save reviewed Expected rule'}
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={busy || !validToken}
                        onClick={() => void observeDecimals()}
                      >
                        Observe finalized token decimals
                      </button>
                      {decimalsObservation === undefined ? null : (
                        <div className="claim-review-boundary">
                          Decimals <KnowledgeDisplay data={decimalsObservation.decimals} /> ·
                          Evidence <code>{decimalsObservation.evidence.id}</code> · finalized block{' '}
                          {decimalsObservation.snapshot.ledger === 'EVM'
                            ? decimalsObservation.snapshot.blockNumber
                            : 'n/a'}
                        </div>
                      )}
                    </form>
                    {review === undefined ? null : (
                      <div className="claim-review-result" role="status">
                        <div className="claim-draft-heading">
                          <div>
                            <span className="eyebrow">不可变预期规则</span>
                            <h4>{review.rule.id}</h4>
                          </div>
                          <span className="status-chip status-up">Review saved</span>
                        </div>
                        <div className="fact-grid">
                          <div className="fact-row">
                            <span>Claim truth</span>
                            <KnowledgeDisplay data={review.claimTruth} />
                          </div>
                          <div className="fact-row">
                            <span>Chain verification</span>
                            <KnowledgeDisplay data={review.coverage.chainVerification} />
                          </div>
                          <div className="fact-row">
                            <span>Confidence</span>
                            <KnowledgeDisplay data={review.confidence} />
                          </div>
                          <div className="fact-row">
                            <span>Durable report</span>
                            <KnowledgeDisplay data={review.durableReport} />
                          </div>
                          <div className="fact-row">
                            <span>Review Evidence</span>
                            <code>{review.reviewEvidenceId}</code>
                          </div>
                          <div className="fact-row">
                            <span>Terminal Evidence</span>
                            <code>{review.terminalEvidenceId}</code>
                          </div>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
