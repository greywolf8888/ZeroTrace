import { useEffect, useRef, useState, type FormEvent } from 'react';
import { browserReplayReportBundle } from '../../../packages/arc-task-ledger/src/verifier-browser-replay.js';
import type {
  SettlementReport,
  ReportBundle,
} from '../../../packages/arc-task-ledger/src/verifier-report-core.js';
import { VerificationFlow } from './VerificationFlow.js';
import { VerifierTaskChooser, type VerifierTaskReference } from './VerifierTaskChooser.js';
import {
  decimalUsdcToAtomic18,
  displayUsdc,
  parseExpectation,
  type SettlementEvaluation,
  type SettlementExpectation,
} from '../../../packages/arc-task-ledger/src/verifier-core.js';
import type { TransactionObservation } from '../../../packages/arc-task-ledger/src/transaction-reader.js';

interface Verification {
  report: SettlementReport;
  observation: TransactionObservation;
  expectation: SettlementExpectation | null;
  evaluation: SettlementEvaluation | null;
  ruleVersion: string;
  parserVersion: string;
}
export function VerificationWorkspace() {
  const session = useRef<string>('');
  const [task, setTask] = useState<VerifierTaskReference>();
  const [taskMode, setTaskMode] = useState(false);
  const [examples, setExamples] = useState<{ reportId: string; transactionHash: string }[]>([]);
  const [sharePreview, setSharePreview] = useState<{
    report: SettlementReport;
    bundle: ReportBundle;
    bundleHash: string;
    warning: string;
  }>();
  const [shareLink, setShareLink] = useState(''),
    [replay, setReplay] = useState('');
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const labels: Record<string, string> = {
    MATCHED: '匹配',
    MISMATCHED: '不匹配',
    INCONCLUSIVE: '未知',
    UNSUPPORTED: '暂不支持',
    PASS: '通过',
    FAIL: '不符合',
    UNKNOWN: '未知',
    NOT_APPLICABLE: '不适用',
    CHAIN: '网络',
    ACQUISITION: '链数据读取',
    TX_SUCCESS: '交易成功状态',
    TRANSACTION_SUCCESS: '交易成功状态',
    SELECTION: '选定资金转移',
    PAYMENT_MOVEMENT: '可作为付款的资金转移',
    PAYEE: '收款人',
    PAYER: '资金付款人',
    MOVEMENT_PAYER: '资金付款人',
    AMOUNT: '金额',
    NOT_BEFORE: '最早时间',
    DEADLINE: '截止时间',
    TRANSFER: '转移',
    MINT: '增发',
    BURN: '销毁',
    ZERO: '零值事件',
    SELF: '自转移',
    NATIVE: '原生接口',
    ERC20_MIRRORED: 'ERC-20镜像接口',
    AMBIGUOUS: '接口关系不明确',
    matched: '镜像一致',
    absent: '未观察到镜像',
    ambiguous: '镜像匹配不唯一',
    native_only: '仅原生接口',
    missing: '镜像缺失',
    conflict: '镜像冲突',
  };
  const explain = (code: string) =>
    lang === 'zh' && labels[code] ? `${labels[code]} (${code})` : code;
  const [transaction, setTransaction] = useState(() => {
      const tx = new URLSearchParams(location.search).get('transaction');
      return tx && /^0x[0-9a-f]{64}$/i.test(tx) ? tx : '';
    }),
    [payee, setPayee] = useState(''),
    [payer, setPayer] = useState(''),
    [amount, setAmount] = useState(''),
    [max, setMax] = useState(''),
    [mode, setMode] = useState<'EXACT' | 'RANGE'>('EXACT'),
    [deadline, setDeadline] = useState('');
  const [selected, setSelected] = useState<string[]>([]),
    [result, setResult] = useState<Verification>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [evidence, setEvidence] = useState<string>();
  async function post(path: string, body: unknown) {
    if (!session.current) {
      const response = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.code + ': ' + data.message);
      session.current = data.csrfToken;
    }
    const response = await fetch('/api' + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zasv-csrf': session.current,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    if (!response.ok || response.status === 202)
      throw Error(data.code + ': ' + (data.message ?? '请稍后重试 / Please retry later'));
    return data;
  }
  useEffect(() => {
    void fetch('/api/v1/verifier/examples')
      .then(async (response) => {
        if (response.ok) setExamples((await response.json()).examples);
      })
      .catch(() => setExamples([]));
    const params = new URLSearchParams(location.search);
    const tx = params.get('transaction');
    if (tx && /^0x[0-9a-f]{64}$/i.test(tx)) {
      const jobId = params.get('taskId'),
        snapshotRunId = params.get('taskRun'),
        legId = params.get('taskLeg');
      if (jobId && snapshotRunId && legId)
        void fetch(
          '/api/v1/task-conditions/' +
            jobId +
            '?' +
            new URLSearchParams({ snapshotRunId, legId, transaction: tx }),
        )
          .then(async (response) => {
            const data = await response.json();
            if (!response.ok) throw Error(data.message);
            const c = data.context;
            setTask(c);
            setPayee(c.expectedPayee);
            setPayer(c.expectedMovementPayer ?? '');
            setAmount(displayUsdc(c.expectedAmountAtomic18));
          })
          .catch((e) => setError(String(e)));
    }
    const id = params.get('report');
    if (!id || !/^zasv_[a-f0-9]{64}$/.test(id)) return;
    let cancelled = false;
    void fetch('/api/v1/reports/' + id)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.message);
        if (cancelled) return;
        setResult(data);
        setTransaction(data.report.transactionHash);
        const e = data.report.expectation;
        if (e) {
          setPayee(e.expectedPayee);
          setPayer(e.expectedMovementPayer ?? '');
          setMode(e.amountMode);
          setAmount(displayUsdc(e.minAmountAtomic18));
          setMax(displayUsdc(e.maxAmountAtomic18));
          setDeadline(e.deadline ?? '');
          setSelected(e.selection);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function reportAction(action: 'recheck' | 'share-preview' | 'publish') {
    if (!result) return;
    setBusy(true);
    setError('');
    try {
      const data = await post(
        '/v1/reports/' + result.report.reportId + '/' + action,
        action === 'publish'
          ? {
              confirmReportId: sharePreview?.report.reportId,
              confirmBundleHash: sharePreview?.bundleHash,
            }
          : {},
      );
      if (action === 'recheck') {
        setResult(data);
        setSharePreview(undefined);
      } else if (action === 'share-preview') setSharePreview(data);
      else {
        setShareLink(location.origin + data.path);
        setSharePreview(undefined);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(compare = false) {
    setBusy(true);
    setError('');
    try {
      const expectation = compare
        ? parseExpectation({
            schemaVersion: 'zasv-expectation-v1',
            chainId: '5042',
            asset: 'USDC',
            expectedPayee: payee,
            ...(payer ? { expectedMovementPayer: payer } : {}),
            amountMode: mode,
            minAmountAtomic18: decimalUsdcToAtomic18(amount),
            maxAmountAtomic18: decimalUsdcToAtomic18(mode === 'EXACT' ? amount : max),
            ...(deadline ? { deadline } : {}),
            selection: selected,
            provenance: 'USER_INPUT',
          })
        : undefined;
      const data = (await post('/v1/verifications', {
        transaction,
        ...(expectation ? { expectation } : {}),
        ...(expectation &&
        task &&
        expectation.expectedPayee === task.expectedPayee &&
        expectation.expectedMovementPayer === task.expectedMovementPayer &&
        expectation.amountMode === 'EXACT' &&
        expectation.minAmountAtomic18 === task.expectedAmountAtomic18 &&
        !deadline
          ? { task: { jobId: task.jobId, snapshotRunId: task.snapshotRunId, legId: task.legId } }
          : {}),
      })) as Verification;
      setResult(data);
      setSharePreview(undefined);
      setShareLink('');
      if (!compare) setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const facts = result?.observation.acquisition.facts;
  return (
    <section
      className="verifier-workspace"
      aria-label={t('Arc USDC结算核验', 'Arc USDC settlement verification')}
      lang={lang === 'zh' ? 'zh-CN' : 'en'}
    >
      <div className="verifier-title">
        <div>
          <p className="eyebrow">
            Arc · USDC · {t('只读结算核验', 'Read-only settlement verification')}
          </p>
          <h2>{t('核验一笔 Arc USDC 结算', 'Verify an Arc USDC settlement')}</h2>
        </div>
        <button
          type="button"
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          aria-label={t('切换为英文', 'Switch to Chinese')}
        >
          {lang === 'zh' ? 'English' : '中文'}
        </button>
      </div>
      <nav className="verifier-modes" aria-label={t('核验模式', 'Verification modes')}>
        <button type="button" aria-pressed={!taskMode} onClick={() => setTaskMode(false)}>
          {t('通用交易核验', 'Transaction verification')}
        </button>
        <button type="button" aria-pressed={taskMode} onClick={() => setTaskMode(true)}>
          {t('ArcBounty任务模式', 'ArcBounty task mode')}
        </button>
      </nav>
      <details>
        <summary>{t('打开已保存的公开示例', 'Open a saved public example')}</summary>
        <p className="quiet">
          {t(
            '仅列出明确公开的固定报告。条件来源见报告；不证明订单用途或履约。',
            'Only explicitly published fixed reports. Inspect condition provenance; purpose and fulfillment are unverified.',
          )}
        </p>
        {examples.length ? (
          examples.map((example) => (
            <p key={example.reportId}>
              <a href={'/?report=' + example.reportId}>{example.transactionHash}</a>
            </p>
          ))
        ) : (
          <p>
            {t(
              '暂无公开示例，请输入交易开始核验。',
              'No public examples yet. Enter a transaction to begin.',
            )}
          </p>
        )}
      </details>
      {taskMode && (
        <VerifierTaskChooser
          lang={lang}
          onChoose={(context, tx) => {
            setTask(context);
            setTransaction(tx);
            setPayee(context.expectedPayee);
            setPayer(context.expectedMovementPayer ?? '');
            setAmount(displayUsdc(context.expectedAmountAtomic18));
            setMode('EXACT');
            setDeadline('');
            setSelected([]);
            setResult(undefined);
            setError('');
          }}
        />
      )}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submit();
        }}
        className="verification-input"
      >
        <label>
          {t('交易哈希或官方交易链接', 'Transaction hash or official explorer link')}
          <input
            value={transaction}
            id="transaction-input"
            onChange={(e) => setTransaction(e.target.value)}
            required
            maxLength={200}
            placeholder="0x…"
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={busy || !transaction}>
          {busy ? t('正在有界读取…', 'Reading within limits…') : t('读取交易', 'Read transaction')}
        </button>
      </form>
      <p className="quiet">
        {t(
          '输入尚未保存的交易即可读取真实链原件；选择具体资金转移，再按你填写的条件核对。',
          'Read a new transaction from the chain, select exact movements, then compare your supplied conditions.',
        )}
      </p>
      {error && (
        <p role="alert" className="error">
          {error} ·{' '}
          {t('输入已保留，可修正或重试。', 'Your input is preserved for correction or retry.')}
        </p>
      )}
      {result && (
        <p role="status">
          {t('读取状态', 'Acquisition')}: {result.observation.acquisition.state} ·{' '}
          {result.observation.acquisition.code} · {result.observation.source.alias}
        </p>
      )}
      <div className="verification-columns">
        <section
          className="verifier-conditions"
          aria-label={t('核对条件', 'Settlement conditions')}
        >
          <h3>{t('按当前输入条件核对', 'Compare current supplied conditions')}</h3>
          {task && (
            <p>
              {t(
                '条件取自固定任务协议投影；修改地址或金额后作为手填条件核对。',
                'Conditions come from a fixed task protocol projection; edited payee or amount is treated as user input.',
              )}{' '}
              #{task.jobId}
            </p>
          )}
          <label>
            {t('预期收款人', 'Expected payee')}
            <input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="0x…"
              maxLength={42}
            />
          </label>
          <label>
            {t(
              '预期资金付款人（可选，不是交易发送者）',
              'Expected movement payer (optional, separate from transaction sender)',
            )}
            <input
              value={payer}
              onChange={(e) => setPayer(e.target.value)}
              placeholder="0x…"
              maxLength={42}
            />
          </label>
          <label>
            {t('金额规则', 'Amount rule')}
            <select value={mode} onChange={(e) => setMode(e.target.value as 'EXACT' | 'RANGE')}>
              <option value="EXACT">{t('精确金额', 'Exact')}</option>
              <option value="RANGE">{t('范围', 'Range')}</option>
            </select>
          </label>
          <label>
            {t(
              '金额 / 最小金额（USDC，最多18位小数）',
              'Amount / minimum (USDC, up to 18 decimals)',
            )}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              maxLength={80}
            />
          </label>
          {mode === 'RANGE' && (
            <label>
              {t('最大金额（USDC）', 'Maximum (USDC)')}
              <input
                value={max}
                onChange={(e) => setMax(e.target.value)}
                inputMode="decimal"
                maxLength={80}
              />
            </label>
          )}
          <label>
            {t('截止时间（可选，UTC）', 'Deadline (optional, UTC)')}
            <input
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              placeholder="2026-10-07T12:00:00Z"
              maxLength={30}
            />
          </label>
          <p className="quiet">
            {t(
              '冻结条件不证明付款前已有约定；用途与履约没有核验。',
              'Freezing conditions does not prove prior agreement, purpose, or fulfillment.',
            )}
          </p>
          <button
            type="button"
            disabled={busy || !selected.length || !payee || !amount}
            onClick={() => void submit(true)}
          >
            {t('按当前条件核对', 'Compare conditions')}
          </button>
        </section>
        <section aria-label={t('规范资金转移', 'Canonical movements')}>
          <h3>{t('选择具体资金转移', 'Select exact movements')}</h3>
          {facts && (
            <VerificationFlow
              movements={facts.movements}
              selected={evidence}
              onSelect={setEvidence}
              lang={lang}
            />
          )}
          {facts && (
            <p className="snapshot">
              {t('固定区块', 'Fixed block')} {facts.blockNumber} · {facts.blockTimestamp}
              <br />
              {t('交易发送者', 'Transaction sender')}: {facts.transactionSender}
              <br />
              {t('Gas单列', 'Gas, separate')}: {displayUsdc(facts.gasAtomic18)} USDC
            </p>
          )}
          {!facts && (
            <p>
              {t(
                '读取完成后在此选择资金转移；缺失值不会显示为0。',
                'Select movements after acquisition. Missing values are never displayed as zero.',
              )}
            </p>
          )}
          {facts?.movements.map((m) => (
            <div
              className={'verification-movement ' + (evidence === m.id ? 'selected' : '')}
              key={m.id}
            >
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id),
                    )
                  }
                />
                {displayUsdc(m.atomic)} USDC · {explain(m.kind)} · {explain(m.interface)}
              </label>
              <button type="button" onClick={() => setEvidence(m.id)}>
                {t('查看资金与原件', 'Inspect movement and raw evidence')}
              </button>
              <p className="address">
                {m.from} → {m.to}
              </p>
              <small>
                {m.id} · {t('镜像核对', 'Mirror check')}: {explain(m.crossCheck)}
              </small>
            </div>
          ))}
          {facts && facts.movements.length === 0 && (
            <p>
              {t(
                '本交易没有可识别的规范USDC资金转移。',
                'No canonical USDC movement was identified in this transaction.',
              )}
            </p>
          )}
          {result?.evaluation && (
            <section aria-label={t('逐项核验结果', 'Individual checks')}>
              <h3>
                {t('条件核对结果', 'Condition outcome')}: {explain(result.evaluation.outcome)}
              </h3>
              <p>
                {t('选定总额', 'Selected amount')}:{' '}
                {result.evaluation.selectedAmountAtomic18 === null
                  ? t('未知', 'Unknown')
                  : displayUsdc(result.evaluation.selectedAmountAtomic18) + ' USDC'}
              </p>
              <dl className="verification-account">
                {(
                  [
                    ['incomingAtomic18', '本交易观察收入', 'Observed incoming in this transaction'],
                    ['outgoingAtomic18', '本交易观察支出', 'Observed outgoing in this transaction'],
                    ['netMovementAtomic18', '净资金转移（未扣Gas）', 'Net movement before Gas'],
                    ['gasAtomic18', '收款人承担的Gas', 'Gas borne by payee'],
                    [
                      'netAfterGasAtomic18',
                      '扣Gas后本交易净变化',
                      'Net transaction change after Gas',
                    ],
                  ] as const
                ).map(([key, zh, en]) => (
                  <div key={key}>
                    <dt>{t(zh, en)}</dt>
                    <dd>
                      {result.evaluation!.account[key] === null
                        ? t(
                            '未知或不适用，见付费方',
                            'Unknown or not applicable; inspect Gas payer',
                          )
                        : displayUsdc(result.evaluation!.account[key]!) + ' USDC'}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="quiet">
                {t(
                  '这些是本交易观察范围；用途、事前约定、订单归属与履约均未验证。',
                  'These values cover this transaction only. Purpose, prior agreement, order attribution and fulfillment remain unverified.',
                )}
              </p>
              {result.evaluation.checks.map((c) => (
                <button
                  className={'verification-check ' + c.state.toLowerCase()}
                  type="button"
                  key={c.code}
                  onClick={() => setEvidence(c.movementIds[0])}
                >
                  {explain(c.code)}: {explain(c.state)}
                  <br />
                  <small>
                    {t('期望', 'Expected')} {JSON.stringify(c.expected)} · {t('实际', 'Actual')}{' '}
                    {JSON.stringify(c.actual)}
                  </small>
                </button>
              ))}
            </section>
          )}
        </section>
        <aside aria-label={t('原始证据检查器', 'Raw evidence inspector')}>
          <h3>{t('所选资金原件', 'Selected raw evidence')}</h3>
          <p>
            {evidence ??
              t(
                '点击资金金额或核对项查看回执位置。',
                'Select a movement or check to inspect its receipt position.',
              )}
          </p>
          {evidence && result && (
            <pre tabIndex={0}>
              {JSON.stringify(
                result.observation.raw.receipt?.logs.filter(
                  (l) => `${'5042'}:${l.transactionHash}:${BigInt(l.logIndex)}` === evidence,
                ),
                null,
                2,
              )}
            </pre>
          )}
          <p className="quiet">
            {t(
              '来源声明的最终性；尚未验证收据树包含证明或独立来源。',
              'Source-reported finality; no receipt inclusion proof or independent source verification.',
            )}
          </p>
        </aside>
      </div>
      <section className="report-actions" aria-label={t('报告操作', 'Report actions')}>
        {result && (
          <>
            <p className="address">
              {t('固定报告已保存', 'Immutable report saved')}: {result.report.reportId}
            </p>
            <a href={'/api/v1/reports/' + result.report.reportId + '/bundle'} download>
              {t('导出原件包', 'Export raw bundle')}
            </a>
            <button disabled={busy} type="button" onClick={() => void reportAction('recheck')}>
              {t('在线重新查询', 'Requery chain')}
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={() => void reportAction('share-preview')}
            >
              {t('预览公开分享', 'Preview public sharing')}
            </button>
            <details>
              <summary>{t('查看冻结条件与报告', 'Inspect frozen conditions and report')}</summary>
              <pre tabIndex={0}>{JSON.stringify(result.report, null, 2)}</pre>
            </details>
          </>
        )}
        <label>
          {t('离线复算原件包（文件在本机处理）', 'Replay bundle offline (processed locally)')}
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setReplay('');
              setError('');
              try {
                if (file.size > 16777216) throw Error(t('文件超过16MiB上限', 'File exceeds 16MiB'));
                const checked = await browserReplayReportBundle(JSON.parse(await file.text()));
                setReplay(
                  t(
                    '完整性与原件复算通过；离线不验证主网真实性。',
                    'Integrity and raw recomputation passed; mainnet authenticity is not verified offline.',
                  ) +
                    ' ' +
                    checked.reportId,
                );
              } catch (e) {
                setError(String(e));
              }
            }}
          />
        </label>
        {replay && <p role="status">{replay}</p>}
        {sharePreview && (
          <section aria-label={t('公开分享完整预览', 'Full public sharing preview')}>
            <p>
              {t(
                '将公开链上原件、收款地址、金额、时间条件及逐项结果，并可能进入公开示例列表；内部业务引用已移除。公开固定版本不能撤回。',
                'Sharing publishes raw chain data, payee, amount, time conditions and checks, and may list the report among public examples. Private context references are removed. The public fixed version cannot be withdrawn.',
              )}
            </p>
            <pre tabIndex={0}>{JSON.stringify(sharePreview.bundle, null, 2)}</pre>
            <button disabled={busy} onClick={() => void reportAction('publish')}>
              {t('确认公开此固定版本', 'Confirm publication of this fixed version')}
            </button>
            <button onClick={() => setSharePreview(undefined)}>{t('取消', 'Cancel')}</button>
          </section>
        )}
        {shareLink && (
          <p>
            {t('公开报告链接', 'Public report link')}: <a href={shareLink}>{shareLink}</a>
          </p>
        )}
      </section>
    </section>
  );
}
