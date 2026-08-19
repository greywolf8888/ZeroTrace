import {
  api,
  type FlapInspectionResponse,
  type FlapPancakeV2SellScenarioResponse,
  type FlapSellQuoteResponse,
  type KnowledgeValue,
} from '../../generated-api/client.js';
import { useState, type FormEvent } from 'react';
import { KnowledgeDisplay, StatusPill, shortId } from './part-01.js';
import { TokenAmountKnowledge } from './part-02.js';
import { EvidencePanel } from './part-03.js';
import { FlapEventTransactionPanel } from './part-15.js';
import { ClaimDeclarationPanel } from './part-04.js';
import { ClaimReportPanel } from './part-14.js';
import { FlapPancakeV2ReconciliationPanel, FlapPancakeV2BuyScenarioPanel } from './part-16.js';
import { FlapPensionEntryScenarioPanel } from './part-17.js';

export function FlapPancakeV2SellScenarioPanel({
  token,
  blockNumber,
}: {
  token: string;
  blockNumber: string;
}) {
  const [amounts, setAmounts] = useState('1000000, 5000000, 10000000');
  const [result, setResult] = useState<FlapPancakeV2SellScenarioResponse>();
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
      setResult(await api.flapPancakeV2SellScenarios(token, parsedInputs, blockNumber));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pancake V2 sell scenario query failed.');
    } finally {
      setBusy(false);
    }
  }

  const market = result?.market.state === 'known' ? result.market.value : undefined;
  return (
    <>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="flap-sell-scenarios-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">Nominal value ≠ configured estimate ≠ execution RV</span>
            <h3 id="flap-sell-scenarios-heading">Pancake V2 退出规模情景</h3>
          </div>
          <span className="snapshot-badge">链上只读, same Snapshot</span>
        </div>
        <p className="panel-copy">
          Compare token exit sizes against shared quote reserves. The official Router gross quote is
          checked independently; configured sell tax is an estimate until fork execution measures
          the settlement balance delta.
        </p>
        <form className="quote-form" onSubmit={(event) => void runScenarios(event)}>
          <label htmlFor="flap-sell-scenario-amounts">Token amounts (comma separated)</label>
          <input
            id="flap-sell-scenario-amounts"
            inputMode="decimal"
            placeholder="1000000, 5000000, 10000000"
            value={amounts}
            onChange={(event) => setAmounts(event.target.value)}
          />
          <button className="secondary-button" type="submit" disabled={busy || !inputsValid}>
            {busy ? 'Reading exit route…' : 'Run exit scenarios'}
          </button>
        </form>
        <p className="quote-note">
          No approval, token transfer, swap, signing, or broadcast occurs. Max-sell, blacklist,
          dynamic tax, swapback, gas and revert behavior remain Unknown without a pinned fork.
        </p>
        {error === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Exit scenarios unavailable</strong>
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
                <span>Current spot price</span>
                <strong>{market.currentSpotPrice}</strong>
              </div>
              <div className="fact-row">
                <span>Quote reserve</span>
                <strong>{market.quoteReserve.decimal}</strong>
              </div>
              <div className="fact-row">
                <span>Configured sell tax bps</span>
                <KnowledgeDisplay data={market.configuredSellTaxBps} />
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
                    <th>Token in</th>
                    <th>Nominal at spot</th>
                    <th>Router gross quote</th>
                    <th>Configured-tax quote</th>
                    <th>Execution net</th>
                    <th>Average tax exit</th>
                    <th>Post-sell spot</th>
                    <th>Total exit haircut</th>
                    <th>Quote reserve used</th>
                    <th>Quote check</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scenarios.map((scenario) => (
                    <tr key={scenario.tokenInput.atomic}>
                      <td>{scenario.tokenInput.decimal}</td>
                      <td>{scenario.nominalSpotQuoteValue.decimal}</td>
                      <td>{scenario.officialRouterGrossQuoteOutput.decimal}</td>
                      <td>
                        <TokenAmountKnowledge data={scenario.configuredTaxNetQuoteOutput} />
                      </td>
                      <td>
                        <TokenAmountKnowledge data={scenario.executionNetQuoteOutput} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.averageConfiguredTaxExitPrice} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.modeledConfiguredTaxPostSellSpotPrice} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.configuredTotalExitHaircutBps} /> bps
                      </td>
                      <td>
                        <KnowledgeDisplay data={scenario.configuredTaxQuoteReserveConsumedBps} />{' '}
                        bps
                      </td>
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
              <strong>Execution capacity remains Unknown</strong>
              {result.executionCapacity.detail ??
                'Pool math alone cannot prove that the token can execute this exit.'}
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
          eyebrow="Certified market → gross Router quote → tax estimate → execution Unknown"
          title="Pancake V2 退出证据"
        />
      )}
    </>
  );
}

export function FlapLaunchPanel({ inspection }: { inspection: FlapInspectionResponse }) {
  const launch = inspection.launch;
  const [sellAmount, setSellAmount] = useState('');
  const [sellQuote, setSellQuote] = useState<FlapSellQuoteResponse>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteBusy, setQuoteBusy] = useState(false);
  const quoteOnlyEvidence =
    sellQuote?.evidence.filter(
      (item) => !inspection.evidence.some((inspectionItem) => inspectionItem.id === item.id),
    ) ?? [];

  async function previewSell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (launch === null || !/^(?:0|[1-9]\d*)$/.test(sellAmount)) return;
    setQuoteBusy(true);
    setQuoteError(undefined);
    setSellQuote(undefined);
    try {
      setSellQuote(await api.flapSellQuote(inspection.token, sellAmount, launch.sourceBlockOrSlot));
    } catch (error) {
      setQuoteError(error instanceof Error ? error.message : 'Flap sell preview failed.');
    } finally {
      setQuoteBusy(false);
    }
  }

  return (
    <>
      <section className="panel subject-panel launch-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Versioned BSC Portal inspection</span>
            <h3>Flap 发射机制</h3>
          </div>
          <StatusPill
            status={
              inspection.platformMatch.state === 'known' && inspection.platformMatch.value
                ? (launch?.lifecycle ?? 'MATCHED')
                : (inspection.platformMatch.reason ?? inspection.platformMatch.state)
            }
          />
        </div>
        {launch === null ? (
          <div className="alert alert-warning">
            <strong>No evidenced Flap launch</strong>
            <KnowledgeDisplay data={inspection.platformMatch} />
          </div>
        ) : (
          <>
            <div className="fact-grid">
              {[
                ['Platform match', inspection.platformMatch],
                ['Platform version', launch.platformVersion],
                ['Portal', launch.factoryOrProgram],
                ['Quote asset', launch.quoteAsset],
                ['Spot price', launch.spotPrice],
                ['Curve type', launch.curveType],
                ['Real quote reserve', launch.realQuoteReserve],
                ['Virtual base reserve', launch.virtualBaseReserve],
                ['Virtual quote reserve', launch.virtualQuoteReserve],
                ['Circulating supply', launch.circulatingSupply],
                ['Remaining supply', launch.remainingSupply],
                ['Progress', launch.progress],
                ['Graduation threshold', launch.graduationThreshold],
                ['Current sell capacity', launch.currentSellCapacity],
                ['Tax model', launch.taxModel],
                ['Buy tax bps', launch.buyTaxBps],
                ['Sell tax bps', launch.sellTaxBps],
                ['Migration pool', launch.migrationPool],
                ['LP locked', launch.lpLocked],
                ['LP burned', launch.lpBurned],
              ].map(([label, value]) => (
                <div className="fact-row" key={label as string}>
                  <span>{label as string}</span>
                  <KnowledgeDisplay data={value as KnowledgeValue<unknown>} />
                </div>
              ))}
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Snapshot block</b> {launch.sourceBlockOrSlot}
              </span>
              <span>
                <b>Decoder</b> {launch.sourceVersion}
              </span>
              <span>
                <b>Confidence</b> {Math.round(inspection.metadata.confidence * 100)}%
              </span>
            </div>
            <details className="raw-details">
              <summary>View Flap replay metadata</summary>
              <pre>{JSON.stringify(inspection.metadata.snapshot, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
      <FlapEventTransactionPanel token={inspection.token} />
      <ClaimDeclarationPanel token={inspection.token} />
      <ClaimReportPanel token={inspection.token} />
      {launch?.lifecycle === 'DEX_TRADING' ? (
        <>
          <FlapPancakeV2ReconciliationPanel token={inspection.token} />
          <FlapPancakeV2BuyScenarioPanel
            token={inspection.token}
            blockNumber={launch.sourceBlockOrSlot}
          />
          <FlapPensionEntryScenarioPanel
            token={inspection.token}
            blockNumber={launch.sourceBlockOrSlot}
          />
          <FlapPancakeV2SellScenarioPanel
            token={inspection.token}
            blockNumber={launch.sourceBlockOrSlot}
          />
        </>
      ) : null}
      {launch?.lifecycle !== 'PRIMARY_MARKET' ? null : (
        <section className="panel subject-panel quote-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">链上只读 eth_call at the same Snapshot</span>
              <h3>Flap 可兑现卖出预览</h3>
            </div>
            <span className="snapshot-badge">无签名、无广播</span>
          </div>
          <form className="quote-form" onSubmit={(event) => void previewSell(event)}>
            <label htmlFor="flap-sell-amount">卖出数量（原子单位）</label>
            <input
              id="flap-sell-amount"
              inputMode="numeric"
              pattern="(?:0|[1-9][0-9]*)"
              placeholder="输入 Token 数量"
              value={sellAmount}
              onChange={(event) => setSellAmount(event.target.value.trim())}
            />
            <button
              className="secondary-button"
              type="submit"
              disabled={quoteBusy || !/^(?:0|[1-9]\d*)$/.test(sellAmount)}
            >
              {quoteBusy ? 'Reading Portal…' : 'Preview sell'}
            </button>
          </form>
          <p className="quote-note">
            The amount and returned proceeds stay in atomic units until token and quote decimals are
            separately evidenced.
          </p>
          {quoteError === undefined ? null : (
            <div className="alert alert-warning">
              <strong>Sell preview unavailable</strong>
              {quoteError}
            </div>
          )}
          {sellQuote === undefined ? null : (
            <>
              <div className="fact-grid quote-facts">
                {[
                  ['Input quantity', { state: 'known', value: sellQuote.quote.inputQuantity }],
                  ['Quote asset', sellQuote.quoteAsset],
                  ['Realizable value', sellQuote.quote.realizableValue],
                  ['Nominal value', sellQuote.quote.nominalValue],
                  ['Average exit price', sellQuote.quote.averageExitPrice],
                  ['Price impact bps', sellQuote.quote.priceImpactBps],
                  ['Total fee bps', sellQuote.quote.totalFeeBps],
                ].map(([label, value]) => (
                  <div className="fact-row" key={label as string}>
                    <span>{label as string}</span>
                    <KnowledgeDisplay data={value as KnowledgeValue<unknown>} />
                  </div>
                ))}
              </div>
              <div className="snapshot-strip">
                <span>
                  <b>Route</b> {sellQuote.quote.route.join(' → ') || 'Unavailable'}
                </span>
                <span>
                  <b>Model</b> {sellQuote.quote.metadata.modelVersion}
                </span>
              </div>
            </>
          )}
        </section>
      )}
      {inspection.evidence.length === 0 ? null : (
        <EvidencePanel
          evidence={inspection.evidence}
          eyebrow="Portal state → normalized mechanism"
          title="Flap 证据账本"
        />
      )}
      {quoteOnlyEvidence.length === 0 ? null : (
        <EvidencePanel
          evidence={quoteOnlyEvidence}
          eyebrow="Requested amount → Portal previewSell"
          title="卖出报价证据账本"
        />
      )}
    </>
  );
}
