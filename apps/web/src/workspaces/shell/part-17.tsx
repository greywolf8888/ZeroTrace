import {
  api,
  type FlapPancakeV2PensionEntryResponse,
  type StoredFlapPensionEntryReport,
} from '../../generated-api/client.js';
import { useState, type FormEvent } from 'react';
import { shortId, KnowledgeDisplay, StatusPill, formatTime } from './part-01.js';
import { TokenAmountKnowledge } from './part-02.js';
import { EvidencePanel } from './part-03.js';

export function FlapPensionEntryScenarioPanel({
  token,
  blockNumber,
}: {
  token: string;
  blockNumber: string;
}) {
  const [amounts, setAmounts] = useState('100, 1000, 10000');
  const [reportId, setReportId] = useState('');
  const [wallet, setWallet] = useState('');
  const [result, setResult] = useState<FlapPancakeV2PensionEntryResponse>();
  const [scenarioReport, setScenarioReport] = useState<{
    id: string;
    resultHash: string;
    createdAt: string;
    replayed: boolean;
  }>();
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
  const reportValid = reportId.length === 0 || /^pcr_[0-9a-f]{24}$/.test(reportId);
  const walletValid = wallet.length === 0 || /^0x[0-9a-fA-F]{40}$/.test(wallet);

  async function runEntryScenarios(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inputsValid || !reportValid || !walletValid) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setScenarioReport(undefined);
    try {
      const response = await api.flapPancakeV2PensionEntryScenarios(
        token,
        parsedInputs,
        blockNumber,
        reportId,
        wallet,
      );
      setResult(response);
      if (response.durableReport !== undefined) {
        setScenarioReport({ ...response.durableReport, replayed: false });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pension entry analysis failed.');
    } finally {
      setBusy(false);
    }
  }

  async function loadLatestScenarioReport() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setScenarioReport(undefined);
    try {
      const response = await api.flapPancakeV2PensionEntryLatestReport(token);
      const record: StoredFlapPensionEntryReport = response.record;
      setResult(record.report);
      setScenarioReport({
        id: record.id,
        resultHash: record.resultHash,
        createdAt: record.createdAt,
        replayed: true,
      });
      setReportId(record.pensionReportId);
      setWallet(record.pensionWallet);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Scenario Report replay failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="flap-pension-entry-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">Durable behavior report × same-Snapshot market</span>
            <h3 id="flap-pension-entry-heading">养老金入场经济</h3>
          </div>
          <span className="snapshot-badge">Scenario, no transaction</span>
        </div>
        <p className="panel-copy">
          Estimate how many complete observed share units each quote amount can acquire, the average
          quote cost per share, and the remainder. Leave report and wallet blank to use the latest
          report when it contains exactly one candidate.
        </p>
        <form
          className="quote-form pension-entry-form"
          onSubmit={(event) => void runEntryScenarios(event)}
        >
          <label htmlFor="flap-pension-entry-amounts">Quote amounts (comma separated)</label>
          <input
            id="flap-pension-entry-amounts"
            inputMode="decimal"
            value={amounts}
            onChange={(event) => setAmounts(event.target.value)}
          />
          <label htmlFor="flap-pension-entry-report">行为报告 ID（可选）</label>
          <input
            id="flap-pension-entry-report"
            placeholder="最新持久化报告"
            value={reportId}
            onChange={(event) => setReportId(event.target.value.trim())}
          />
          <label htmlFor="flap-pension-entry-wallet">候选钱包（可选）</label>
          <input
            id="flap-pension-entry-wallet"
            placeholder="仅有一个候选时自动选择"
            value={wallet}
            onChange={(event) => setWallet(event.target.value.trim())}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={busy || !inputsValid || !reportValid || !walletValid}
          >
            {busy ? '正在连接证据…' : '计算养老金入场'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void loadLatestScenarioReport()}
          >
            加载最新情景报告
          </button>
        </form>
        <p className="quote-note">
          This is a read-only configured-tax model. Actual wallet receipt and the later transfer
          require pinned-fork execution before ZeroTrace will call them Known.
        </p>
        {error === undefined ? null : (
          <div className="alert alert-warning">
            <strong>Pension entry unavailable</strong>
            {error}
          </div>
        )}
        {result === undefined ? null : (
          <div data-testid="pension-entry-result">
            <div className="fact-grid quote-facts">
              <div className="fact-row">
                <span>Behavior candidate</span>
                <strong>{shortId(result.behavior.wallet)}</strong>
              </div>
              <div className="fact-row">
                <span>已观测 share unit</span>
                <strong>{result.behavior.shareUnit.decimal}</strong>
              </div>
              <div className="fact-row">
                <span>Behavior report</span>
                <strong>{shortId(result.behavior.reportId)}</strong>
              </div>
              <div className="fact-row">
                <span>Behavior range</span>
                <strong>
                  {result.behavior.fromBlock}–{result.behavior.toBlock}
                </strong>
              </div>
              <div className="fact-row">
                <span>Official pension role</span>
                <KnowledgeDisplay data={result.behavior.roleAttribution} />
              </div>
              <div className="fact-row">
                <span>No-exit policy</span>
                <KnowledgeDisplay data={result.behavior.participantExitPolicy} />
              </div>
              <div className="fact-row">
                <span>Dividend execution</span>
                <KnowledgeDisplay data={result.behavior.dividendExecution} />
              </div>
              <div className="fact-row">
                <span>Automatic quote check</span>
                <StatusPill status={result.validation.status} />
              </div>
              <div className="fact-row">
                <span>Scenario Report</span>
                <strong>
                  {scenarioReport === undefined ? '不可用' : shortId(scenarioReport.id)}
                </strong>
              </div>
              <div className="fact-row">
                <span>Report access</span>
                <strong>
                  {scenarioReport === undefined
                    ? '不可用'
                    : scenarioReport.replayed
                      ? 'Provider-free replay'
                      : 'Persisted live result'}
                </strong>
              </div>
            </div>
            <div className="table-scroll scenario-table">
              <table>
                <thead>
                  <tr>
                    <th>Quote in</th>
                    <th>Modeled net token</th>
                    <th>Share equivalent</th>
                    <th>Whole shares</th>
                    <th>Average cost / share</th>
                    <th>Committed token</th>
                    <th>Remainder token</th>
                    <th>Post-deposit spot</th>
                    <th>Execution shares</th>
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map((entry) => (
                    <tr key={entry.buyScenario.quoteInput.atomic}>
                      <td>{entry.buyScenario.quoteInput.decimal}</td>
                      <td>
                        <TokenAmountKnowledge data={entry.modeledNetTokenOutput} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={entry.modeledShareEquivalent} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={entry.modeledWholeShares} />
                      </td>
                      <td>
                        <TokenAmountKnowledge data={entry.modeledAverageQuoteCostPerShare} />
                      </td>
                      <td>
                        <TokenAmountKnowledge data={entry.modeledCommittedTokenAmount} />
                      </td>
                      <td>
                        <TokenAmountKnowledge data={entry.modeledRemainderTokenAmount} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={entry.modeledPostDepositSpotPrice} />
                      </td>
                      <td>
                        <KnowledgeDisplay data={entry.executionWholeShares} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="alert alert-warning pension-boundary">
              <strong>Custody is not supply burn</strong>
              The candidate is a non-zero custody address. Total-supply reduction and irreversible
              custody remain <KnowledgeDisplay data={result.totalSupplyReduction} /> and{' '}
              <KnowledgeDisplay data={result.custodyIrreversible} />. A plain wallet transfer leaves
              the modeled pool price unchanged; tax/swapback execution may not.
            </div>
            <div className="snapshot-strip">
              <span>
                <b>Market block</b> {String(result.metadata.snapshot?.blockNumber ?? 'Unknown')}
              </span>
              <span>
                <b>Candidate Evidence</b> {shortId(result.behavior.candidateEvidenceId)}
              </span>
              <span>
                <b>Terminal Evidence</b> {shortId(result.terminalEvidenceId)}
              </span>
              {scenarioReport === undefined ? null : (
                <span>
                  <b>结果哈希</b> {shortId(scenarioReport.resultHash)}
                </span>
              )}
              {scenarioReport === undefined ? null : (
                <span>
                  <b>Stored</b> {formatTime(scenarioReport.createdAt)}
                </span>
              )}
            </div>
          </div>
        )}
      </section>
      {result === undefined ? null : (
        <EvidencePanel
          evidence={result.evidence}
          eyebrow="Behavior report → Router/pool quote → share economics"
          title="养老金入场证据"
        />
      )}
    </>
  );
}
