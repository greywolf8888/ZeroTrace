import {
  api,
  type FlapPancakeV2BuyScenarioResponse,
  type FlapPancakeV2ReconciliationResponse,
} from '../../generated-api/client.js';
import { useState, type FormEvent } from 'react';
import { StatusPill, KnowledgeDisplay, titleCase, shortId } from './part-01.js';
import { EvidencePanel } from './part-03.js';
import { TokenAmountKnowledge } from './part-02.js';

export function FlapPancakeV2ReconciliationPanel({ token }: { token: string }) {
  const [quoteAmounts, setQuoteAmounts] = useState('100, 1000, 10000');
  const [tokenAmounts, setTokenAmounts] = useState('1000000, 5000000, 10000000');
  const [result, setResult] = useState<FlapPancakeV2ReconciliationResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const parseAmounts = (value: string) =>
    value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  const quoteInputs = parseAmounts(quoteAmounts);
  const tokenInputs = parseAmounts(tokenAmounts);
  const validAmountList = (values: readonly string[]) =>
    values.length >= 1 &&
    values.length <= 8 &&
    new Set(values).size === values.length &&
    values.every(
      (value) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value),
    );
  const inputsValid = validAmountList(quoteInputs) && validAmountList(tokenInputs);

  async function runReconciliation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inputsValid) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.flapPancakeV2Reconciliation(token, quoteInputs, tokenInputs));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Multi-source reconciliation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="flap-reconciliation-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">Common finalized block + documented operators</span>
            <h3 id="flap-reconciliation-heading">独立市场与可兑现价值对账</h3>
          </div>
          <span className="snapshot-badge">Exact state · quote budget 0.5%</span>
        </div>
        <p className="panel-copy">
          Re-read the complete Pancake V2 market, buy quotes and exit quotes through every
          configured BSC source at one finalized block. Different hostnames count as independent
          only when official endpoint documents identify different operators.
        </p>
        <form
          className="quote-form reconciliation-form"
          onSubmit={(event) => void runReconciliation(event)}
        >
          <div className="claim-burn-field">
            <label htmlFor="flap-reconciliation-quote-amounts">Quote-asset buy amounts</label>
            <input
              id="flap-reconciliation-quote-amounts"
              inputMode="decimal"
              value={quoteAmounts}
              onChange={(event) => setQuoteAmounts(event.target.value)}
            />
          </div>
          <div className="claim-burn-field">
            <label htmlFor="flap-reconciliation-token-amounts">Token exit amounts</label>
            <input
              id="flap-reconciliation-token-amounts"
              inputMode="decimal"
              value={tokenAmounts}
              onChange={(event) => setTokenAmounts(event.target.value)}
            />
          </div>
          <button className="secondary-button" type="submit" disabled={busy || !inputsValid}>
            {busy ? 'Reconciling sources…' : 'Run independent check'}
          </button>
        </form>
        <p className="quote-note">
          This is read-only RPC replay. It never approves, signs, swaps, transfers, or broadcasts.
        </p>
        {error === undefined ? null : (
          <div className="alert alert-warning reconciliation-alert">
            <strong>Reconciliation unavailable</strong>
            {error}
          </div>
        )}
        {result === undefined ? null : (
          <>
            <div className="fact-grid quote-facts">
              <div className="fact-row">
                <span>Terminal status</span>
                <StatusPill status={result.status} />
              </div>
              <div className="fact-row">
                <span>Finalized block</span>
                <strong>{result.blockNumber}</strong>
              </div>
              <div className="fact-row">
                <span>Operator independence</span>
                <StatusPill status={result.sourceIndependence.status} />
              </div>
              <div className="fact-row">
                <span>Independence value</span>
                <KnowledgeDisplay data={result.sourceIndependence.independence} />
              </div>
              <div className="fact-row">
                <span>Operators / required</span>
                <strong>
                  {result.sourceIndependence.operatorCount} /{' '}
                  {result.sourceIndependence.requiredOperators}
                </strong>
              </div>
              <div className="fact-row">
                <span>Checks</span>
                <strong>
                  {result.audit.summary.passed} pass · {result.audit.summary.failed} fail ·{' '}
                  {result.audit.summary.inconclusive} inconclusive
                </strong>
              </div>
            </div>
            {result.status === 'PASS' ? null : (
              <div
                className={`alert ${result.status === 'FAIL' ? 'alert-error' : 'alert-warning'} reconciliation-alert`}
              >
                <strong>{titleCase(result.status)}</strong>
                {result.status === 'FAIL'
                  ? 'At least one exact state or bounded quote comparison exceeded its allowed error.'
                  : 'The result is not a verified agreement. Unknown source ownership or incomplete coverage is not converted to a pass.'}
              </div>
            )}
            <div className="table-scroll reconciliation-table">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Documented operator</th>
                    <th>Buy checks</th>
                    <th>Exit checks</th>
                    <th>Pool</th>
                    <th>Spot price</th>
                  </tr>
                </thead>
                <tbody>
                  {result.sources.map((source) => {
                    const market =
                      source.buy.market.state === 'known' ? source.buy.market.value : undefined;
                    return (
                      <tr key={source.sourceId}>
                        <td>
                          <code>{source.sourceId}</code>
                        </td>
                        <td>
                          <KnowledgeDisplay data={source.operatorId} />
                        </td>
                        <td>
                          <StatusPill status={source.buy.validation.status} />
                        </td>
                        <td>
                          <StatusPill status={source.sell.validation.status} />
                        </td>
                        <td>{market === undefined ? 'Unknown' : shortId(market.pool)}</td>
                        <td>{market === undefined ? 'Unknown' : market.currentSpotPrice}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="raw-details" open={result.status !== 'PASS'}>
              <summary>
                Comparison ledger ({result.audit.summary.total} checks; exact fields require zero
                error)
              </summary>
              <div className="table-scroll reconciliation-table">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Class</th>
                      <th>Result</th>
                      <th>Actual</th>
                      <th>Reference</th>
                      <th>Error</th>
                      <th>Pass budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.audit.checks.map((check) => (
                      <tr key={check.id}>
                        <td>
                          <code>{check.fieldPath}</code>
                        </td>
                        <td>{titleCase(check.comparisonClass)}</td>
                        <td>
                          <StatusPill status={check.disposition} />
                        </td>
                        <td>
                          <KnowledgeDisplay data={check.actual} />
                        </td>
                        <td>
                          <KnowledgeDisplay data={check.reference} />
                        </td>
                        <td>
                          <KnowledgeDisplay data={check.relativeErrorPct} />
                        </td>
                        <td>
                          <KnowledgeDisplay data={check.passThresholdPct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <div className="snapshot-strip">
              <span>
                <b>Block hash</b> {shortId(result.blockHash)}
              </span>
              <span>
                <b>Registry Evidence</b> {shortId(result.sourceIndependence.registryEvidenceId)}
              </span>
              <span>
                <b>Independence Evidence</b> {shortId(result.sourceIndependence.terminalEvidenceId)}
              </span>
              <span>
                <b>Terminal Evidence</b> {shortId(result.terminalEvidenceId)}
              </span>
            </div>
          </>
        )}
      </section>
      {result === undefined ? null : (
        <EvidencePanel
          evidence={result.evidence}
          eyebrow="Finalized anchors → official operator attestations → market and RV comparisons"
          title="多源对账证据"
        />
      )}
    </>
  );
}

export function FlapPancakeV2BuyScenarioPanel({
  token,
  blockNumber,
}: {
  token: string;
  blockNumber: string;
}) {
  const [amounts, setAmounts] = useState('100, 1000, 10000');
  const [result, setResult] = useState<FlapPancakeV2BuyScenarioResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const parsedInputs = amounts
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const inputsValid =
    parsedInputs.length >= 1 &&
    parsedInputs.length <= 8 &&
    new Set(parsedInputs).size === parsedInputs.length &&
    parsedInputs.every(
      (value) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value),
    );

  async function runScenarios(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inputsValid) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.flapPancakeV2BuyScenarios(token, parsedInputs, blockNumber));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pancake V2 scenario query failed.');
    } finally {
      setBusy(false);
    }
  }

  const market = result?.market.state === 'known' ? result.market.value : undefined;
  return (
    <>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="flap-buy-scenarios-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">Official router quote + deterministic pool check</span>
            <h3 id="flap-buy-scenarios-heading">Pancake V2 买入规模情景</h3>
          </div>
          <span className="snapshot-badge">链上只读, same Snapshot</span>
        </div>
        <p className="panel-copy">
          Compare one to eight quote-asset buy sizes. Gross output comes from the official V2
          router; the pool formula must stay inside the 0.1% deterministic error budget.
        </p>
        <form className="quote-form" onSubmit={(event) => void runScenarios(event)}>
          <label htmlFor="flap-buy-scenario-amounts">Quote amounts (comma separated)</label>
          <input
            id="flap-buy-scenario-amounts"
            inputMode="decimal"
            placeholder="100, 1000, 10000"
            value={amounts}
            onChange={(event) => setAmounts(event.target.value)}
          />
          <button className="secondary-button" type="submit" disabled={busy || !inputsValid}>
            {busy ? 'Reading pool…' : 'Run buy scenarios'}
          </button>
        </form>
        <p className="quote-note">
          Actual wallet receipt remains Unknown until a pinned-fork swap reproduces token tax and
          swapback behavior. No approval, signing, transaction, or broadcast is performed.
        </p>
        {error === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Buy scenarios unavailable</strong>
            {error}
          </div>
        )}
        {result === undefined ? null : market === undefined ? (
          <div className="alert alert-warning">
            <strong>DEX market unavailable</strong>
            <KnowledgeDisplay data={result.market} />
          </div>
        ) : (
          <>
            <div className="fact-grid quote-facts">
              <div className="fact-row">
                <span>Venue</span>
                <strong>{market.venue}</strong>
              </div>
              <div className="fact-row">
                <span>Current spot price</span>
                <strong>{market.currentSpotPrice}</strong>
              </div>
              <div className="fact-row">
                <span>Quote reserve</span>
                <strong>{market.quoteReserve.decimal}</strong>
              </div>
              <div className="fact-row">
                <span>Token reserve</span>
                <strong>{market.tokenReserve.decimal}</strong>
              </div>
              <div className="fact-row">
                <span>DEX fee bps</span>
                <strong>{market.dexFeeBps}</strong>
              </div>
              <div className="fact-row">
                <span>Configured buy tax bps</span>
                <KnowledgeDisplay data={market.configuredBuyTaxBps} />
              </div>
              <div className="fact-row">
                <span>Automatic quote check</span>
                <StatusPill
                  status={`${result.validation.status} · ${result.validation.failedScenarioCount} failed`}
                />
              </div>
            </div>
            <div className="table-scroll scenario-table">
              <table>
                <thead>
                  <tr>
                    <th>Quote in</th>
                    <th>Router gross token</th>
                    <th>Configured-tax estimate</th>
                    <th>Execution net</th>
                    <th>Average estimate</th>
                    <th>Post-buy spot</th>
                    <th>Price move</th>
                    <th>Quote check</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scenarios.map((scenario) => (
                    <tr key={scenario.quoteInput.atomic}>
                      <td>{scenario.quoteInput.decimal}</td>
                      <td>{scenario.officialRouterGrossTokenOutput.decimal}</td>
                      <td>
                        <TokenAmountKnowledge data={scenario.configuredTaxNetTokenOutput} />
                      </td>
                      <td>
                        <TokenAmountKnowledge data={scenario.executionNetTokenOutput} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.averageConfiguredTaxBuyPrice} />
                      </td>
                      <td>{scenario.modeledPostBuySpotPrice}</td>
                      <td>{scenario.modeledPriceChangeBps} bps</td>
                      <td>
                        <StatusPill
                          status={
                            scenario.withinDeterministicTolerance
                              ? `PASS ${scenario.deterministicQuoteErrorBps} BPS`
                              : `FAIL ${scenario.deterministicQuoteErrorBps} BPS`
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="alert alert-warning pension-boundary">
              <strong>Pension-wallet boundary</strong>
              {result.pensionSinkTreatment.detail ??
                'A wallet transfer is not treated as a supply burn or irreversible sink.'}
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Pool</b> {shortId(market.pool)}
              </span>
              <span>
                <b>Block</b> {String(result.metadata.snapshot?.blockNumber ?? 'Unknown')}
              </span>
              <span>
                <b>Terminal Evidence</b> {shortId(result.terminalEvidenceId ?? 'Unavailable')}
              </span>
            </div>
          </>
        )}
      </section>
      {result === undefined || result.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={result.evidence}
          eyebrow="Pool identity → reserves → official router → deterministic check"
          title="Pancake V2 情景证据"
        />
      )}
    </>
  );
}
