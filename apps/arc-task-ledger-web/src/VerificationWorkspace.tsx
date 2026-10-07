import { useEffect, useRef, useState, type FormEvent } from 'react';
import { browserReplayReportBundle } from '../../../packages/arc-task-ledger/src/verifier-browser-replay.js';
import type {
  SettlementReport,
  ReportBundle,
} from '../../../packages/arc-task-ledger/src/verifier-report-core.js';
import { VerificationFlow } from './VerificationFlow.js';
import { VerifierTaskChooser, type VerifierTaskReference } from './VerifierTaskChooser.js';
import { VerificationReport, type Verification } from './VerificationReport.js';
import { useLanguage } from './i18n.js';
import {
  decimalUsdcToAtomic18,
  displayUsdc,
  parseExpectation,
  parseTransactionInput,
  type SettlementCheck,
} from '../../../packages/arc-task-ledger/src/verifier-core.js';

export function VerificationWorkspace({
  reportId,
  navigate,
}: {
  reportId?: string | undefined;
  navigate: (url: string) => void;
}) {
  const { language: lang, t, localize, date } = useLanguage();
  const [editing, setEditing] = useState(!reportId);
  const [loadingReport, setLoadingReport] = useState(!!reportId);
  const [operation, setOperation] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pending, setPending] = useState<string>();
  const [reportRefresh, setReportRefresh] = useState(0);
  const [reportError, setReportError] = useState('');
  const [savedReports, setHistory] = useState<
    {
      report_id: string;
      bundle_hash: string;
      transaction_hash: string;
      created_at: string;
      outcome: string | null;
      public: boolean;
    }[]
  >([]);
  const request = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const inspector = useRef<HTMLDialogElement>(null);
  const replayInput = useRef<HTMLInputElement>(null);
  const [checkEvidence, setCheckEvidence] = useState<SettlementCheck>();
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
  const explain = (code: string) => (labels[code] ? localize(labels[code]) : code);
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
      setExpiresAt(data.expiresAt);
    }
    const fingerprint = JSON.stringify([path, body]);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, key: crypto.randomUUID() };
    const response = await fetch('/api' + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zasv-csrf': session.current,
        'idempotency-key': request.current.key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    if (response.status === 202) {
      setPending(data.requestId);
      return null;
    }
    if (!response.ok)
      throw Error(data.code + ': ' + (data.message ?? '请稍后重试 / Please retry later'));
    request.current = undefined;
    return data;
  }
  useEffect(() => {
    void fetch('/api/v1/reports')
      .then(async (r) => {
        if (r.ok) setHistory((await r.json()).reports);
      })
      .catch(() => undefined);
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
    const id = reportId;
    if (!id || !/^zasv_[a-f0-9]{64}$/.test(id)) return;
    let cancelled = false;
    void fetch('/api/v1/reports/' + id, { signal: AbortSignal.timeout(20000) })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.message);
        if (cancelled) return;
        setResult(data);
        setEditing(!data.report.expectation);
        setTaskMode(data.report.expectation?.provenance === 'REGISTERED_TASK');
        setTask(data.observation.taskContext);
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
      })
      .finally(() => {
        if (!cancelled) setLoadingReport(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId, reportRefresh]);
  async function reportAction(action: 'recheck' | 'share-preview' | 'publish') {
    if (!result) return;
    setBusy(true);
    setOperation(action);
    setReportError('');
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
      if (!data) return;
      if (action === 'recheck') {
        setResult(data);
        navigate('/?report=' + data.report.reportId);
        setReportRefresh((v) => v + 1);
        setSharePreview(undefined);
      } else if (action === 'share-preview') setSharePreview(data);
      else {
        setShareLink(location.origin + data.path);
        setSharePreview(undefined);
        if (data.reportId === result.report.reportId)
          setResult({ ...result, visibility: data.visibility });
        navigate(data.path);
        setReportRefresh((v) => v + 1);
      }
    } catch (e) {
      setReportError(String(e));
    } finally {
      setBusy(false);
      setOperation('');
    }
  }
  async function submit(compare = false) {
    setBusy(true);
    setOperation(compare ? 'compare' : 'read');
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
        transaction: parseTransactionInput(transaction.trim()),
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
      if (!data) return;
      setResult(data);
      if (compare) {
        setEditing(false);
        navigate('/?report=' + data.report.reportId);
      } else {
        navigate('/?report=' + data.report.reportId);
      }
      setSharePreview(undefined);
      setShareLink('');
      if (!compare) setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setOperation('');
    }
  }
  const facts = result?.observation.acquisition.facts;
  const inspectedMovements =
    facts?.movements.filter((m) =>
      checkEvidence ? checkEvidence.movementIds.includes(m.id) : m.id === evidence,
    ) ?? [];
  const inspectedLogIds = new Set(inspectedMovements.flatMap((m) => [m.id, ...m.mirrorLogIds]));
  const payeeInvalid = !!payee && !/^0x[0-9a-f]{40}$/i.test(payee);
  const payerInvalid = !!payer && !/^0x[0-9a-f]{40}$/i.test(payer);
  const decimalInvalid = (v: string) => {
    if (!v) return false;
    try {
      decimalUsdcToAtomic18(v);
      return false;
    } catch {
      return true;
    }
  };
  const amountInvalid = decimalInvalid(amount);
  const maxInvalid =
    mode === 'RANGE' &&
    (decimalInvalid(max) ||
      (!amountInvalid &&
        !!amount &&
        !!max &&
        !decimalInvalid(max) &&
        BigInt(decimalUsdcToAtomic18(max)) < BigInt(decimalUsdcToAtomic18(amount))));
  let dirty = false;
  if (result && editing) {
    const e = result.report.expectation;
    try {
      dirty =
        !e ||
        result.report.transactionHash !== parseTransactionInput(transaction.trim()) ||
        e.expectedPayee !== payee.toLowerCase() ||
        (e.expectedMovementPayer ?? '') !== payer.toLowerCase() ||
        e.amountMode !== mode ||
        e.minAmountAtomic18 !== decimalUsdcToAtomic18(amount) ||
        e.maxAmountAtomic18 !== decimalUsdcToAtomic18(mode === 'EXACT' ? amount : max) ||
        (e.deadline ?? '') !== deadline ||
        [...e.selection].sort().join() !== [...selected].sort().join();
    } catch {
      dirty = true;
    }
  }
  function inspectMovement(id: string) {
    setEvidence(id);
    setCheckEvidence(undefined);
    inspector.current?.showModal();
  }
  function editConditions() {
    setEditing(true);
    requestAnimationFrame(() =>
      document
        .getElementById('conditions-editor')
        ?.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
  }
  function inspectCheck(c: SettlementCheck) {
    setCheckEvidence(c);
    setEvidence(c.movementIds[0]);
    inspector.current?.showModal();
  }
  async function checkPending() {
    if (!pending) return;
    try {
      const r = await fetch('/api/v1/verifications/' + pending);
      const data = await r.json();
      if (!r.ok) throw Error(data.code + ': ' + data.message);
      if (data.status === 'COMPLETED') {
        request.current = undefined;
        setPending(undefined);
        navigate('/?report=' + data.result.report.reportId);
      } else if (data.status === 'FAILED') {
        setPending(undefined);
        setReportError(data.errorCode);
      }
    } catch (e) {
      setReportError(String(e));
    }
  }
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
          <h2>
            {reportId
              ? t('已保存的核验报告', 'Saved verification report')
              : t('核验一笔 Arc USDC 结算', 'Verify an Arc USDC settlement')}
          </h2>
        </div>
      </div>
      {loadingReport && (
        <p role="status">
          {t('正在打开固定报告（不查询链）…', 'Opening the immutable report (no chain query)…')}
        </p>
      )}
      <nav
        hidden={!editing}
        className="verifier-modes"
        aria-label={t('核验模式', 'Verification modes')}
      >
        <button type="button" aria-pressed={!taskMode} onClick={() => setTaskMode(false)}>
          {t('通用交易核验', 'Transaction verification')}
        </button>
        <button type="button" aria-pressed={taskMode} onClick={() => setTaskMode(true)}>
          {t('ArcBounty任务模式', 'ArcBounty task mode')}
        </button>
      </nav>
      <details hidden={!!reportId} className="no-print">
        <summary>{t('打开已保存的公开示例', 'Open a saved public example')}</summary>
        <p className="quiet">
          {t(
            '仅列出明确公开的固定报告。条件来源见报告；不证明订单用途或履约。',
            'Only explicitly published fixed reports. Inspect condition provenance; purpose and fulfillment are unverified.',
          )}
        </p>
        {examples.length ? (
          examples.map((example, index) => (
            <p key={example.reportId}>
              <a href={'/?report=' + example.reportId}>
                {t('固定主网报告', 'Fixed mainnet report')} {index + 1} ·{' '}
                <code>
                  {example.transactionHash.slice(0, 10)}…{example.transactionHash.slice(-8)}
                </code>
              </a>
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
      {taskMode && editing && (
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
            setError('');
          }}
        />
      )}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submit();
        }}
        className="verification-input no-print"
        hidden={!editing}
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
        <button className="primary" type="submit" disabled={busy || !transaction}>
          {busy && operation === 'read'
            ? t('正在读取链原件…', 'Reading chain originals…')
            : t('读取交易', 'Read transaction')}
        </button>
      </form>
      <p hidden={!editing} className="quiet">
        {t(
          '输入尚未保存的交易即可读取真实链原件；选择具体资金转移，再按你填写的条件核对。',
          'Read a new transaction from the chain, select exact movements, then compare your supplied conditions.',
        )}
      </p>
      {error && (
        <div role="alert" className="error" id="verification-error">
          <p>
            {t(
              '核验未完成。输入已保留，请检查哈希、地址、金额或服务状态后重试。',
              'Verification incomplete. Your input is preserved. Check the hash, addresses, amount or service status and retry.',
            )}
          </p>
          <details>
            <summary>{t('原始错误', 'Original error')}</summary>
            <pre>{error}</pre>
          </details>
          <button
            onClick={() => {
              request.current = undefined;
              setError('');
            }}
          >
            {t('开始一次新尝试', 'Start a new attempt')}
          </button>
        </div>
      )}
      {result && editing && (
        <p role="status">
          {t('读取状态', 'Acquisition')}: {result.observation.acquisition.state} ·{' '}
          {result.observation.acquisition.code} · {result.observation.source.alias}
        </p>
      )}
      {result && (
        <VerificationReport
          data={result}
          dirty={dirty}
          onEvidence={inspectCheck}
          actions={
            <nav
              className="report-quick-actions no-print"
              aria-label={t('报告快捷操作', 'Report quick actions')}
            >
              <a href={'/api/v1/reports/' + result.report.reportId + '/bundle'} download>
                {t('导出原件包', 'Export raw bundle')}
              </a>
              <button onClick={() => window.print()}>
                {t('打印 / 保存PDF', 'Print / Save PDF')}
              </button>
              <button onClick={editConditions}>
                {t('编辑条件建立新版本', 'Edit conditions for a new version')}
              </button>
            </nav>
          }
        />
      )}
      <section className="report-actions no-print" aria-label={t('报告操作', 'Report actions')}>
        {result && (
          <>
            <p className="address">
              {t('固定报告已保存', 'Immutable report saved')}:{' '}
              <a href={'/?report=' + result.report.reportId}>{result.report.reportId}</a>
            </p>
            <button onClick={() => navigate('/')}>
              {t('开始新核验', 'Start new verification')}
            </button>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(location.origin + '/?report=' + result.report.reportId)
                  .then(
                    () => setShareLink(location.origin + '/?report=' + result.report.reportId),
                    () =>
                      setReportError(
                        t(
                          '复制失败，请复制地址栏链接',
                          'Copy failed; copy the link from the address bar',
                        ),
                      ),
                  )
              }
            >
              {t('复制报告链接', 'Copy report link')}
            </button>
            <p className="scope-note">
              {result.canManage
                ? t(
                    '私有报告由当前浏览器会话拥有，最长7天；清除Cookie或会话过期无法恢复所有权。请及时导出原件。',
                    'Private ownership belongs to this browser session for up to 7 days. Clearing cookies or session expiry prevents ownership recovery. Export promptly.',
                  )
                : t(
                    '当前为公开报告阅览者；管理操作只对原会话所有者开放。',
                    'Public report viewer; management is available only to the original owner session.',
                  )}
              {expiresAt && (
                <>
                  {' '}
                  {t('会话到期', 'Session expires')}: {date(expiresAt)}
                </>
              )}
            </p>
            {result.canManage && (
              <button disabled={busy} type="button" onClick={() => void reportAction('recheck')}>
                {t('在线重新查询', 'Requery chain')}
              </button>
            )}
            {result.canManage && result.visibility !== 'PUBLIC' && (
              <button
                disabled={busy}
                type="button"
                onClick={() => void reportAction('share-preview')}
              >
                {t('预览公开分享', 'Preview public sharing')}
              </button>
            )}
            <details>
              <summary>{t('查看冻结条件与报告', 'Inspect frozen conditions and report')}</summary>
              <pre tabIndex={0}>{JSON.stringify(result.report, null, 2)}</pre>
            </details>
          </>
        )}
        {busy && operation !== 'read' && (
          <p role="status">
            {operation === 'compare'
              ? t('正在核对条件…', 'Comparing conditions…')
              : operation === 'recheck'
                ? t('正在重新查询链…', 'Requerying the chain…')
                : operation === 'share-preview'
                  ? t('正在生成分享预览…', 'Preparing sharing preview…')
                  : t('正在保存公开版本…', 'Saving public version…')}
          </p>
        )}
        {pending && (
          <p role="status">
            {t('请求处理中', 'Request running')} <code>{pending}</code>{' '}
            <button onClick={() => void checkPending()}>
              {t('查询状态（不启动链读取）', 'Check status (no chain work)')}
            </button>
          </p>
        )}
        {reportError && (
          <div role="alert" className="error">
            <p>
              {t(
                '此操作未完成。请检查原会话权限或服务状态；当前报告保持固定。',
                'Operation incomplete. Check original session access or service status; the report remains fixed.',
              )}
            </p>
            <details>
              <summary>{t('原始错误', 'Original error')}</summary>
              <pre>{reportError}</pre>
            </details>
          </div>
        )}
        <div className="offline-replay">
          <p>
            {t('离线复算原件包（文件在本机处理）', 'Replay bundle offline (processed locally)')}
          </p>
          <button type="button" onClick={() => replayInput.current?.click()}>
            {t('选择原件包文件', 'Choose bundle file')}
          </button>
          <input
            ref={replayInput}
            hidden
            aria-label={t(
              '离线复算原件包（文件在本机处理）',
              'Replay bundle offline (processed locally)',
            )}
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
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
        </div>
        {replay && <p role="status">{replay}</p>}
        {sharePreview && (
          <section aria-label={t('公开分享完整预览', 'Full public sharing preview')}>
            <p>
              {t(
                '将公开链上原件、收款地址、金额、时间条件及逐项结果，并可能进入公开示例列表；内部业务引用已移除。公开固定版本不能撤回。',
                'Sharing publishes raw chain data, payee, amount, time conditions and checks, and may list the report among public examples. Private context references are removed. The public fixed version cannot be withdrawn.',
              )}
            </p>
            <VerificationReport
              preview
              data={{ report: sharePreview.report, observation: sharePreview.bundle.observation }}
            />
            <details>
              <summary>{t('完整公开原件包', 'Full public raw bundle')}</summary>
              <pre tabIndex={0}>{JSON.stringify(sharePreview.bundle, null, 2)}</pre>
            </details>
            <button disabled={busy} onClick={() => void reportAction('publish')}>
              {t('确认公开此固定版本', 'Confirm publication of this fixed version')}
            </button>
            <button onClick={() => setSharePreview(undefined)}>{t('取消', 'Cancel')}</button>
          </section>
        )}
        {shareLink && (
          <p>
            {t('报告链接（访问权限不变）', 'Report link (access unchanged)')}:{' '}
            <a href={shareLink}>{shareLink}</a>
          </p>
        )}
      </section>
      <div className="verification-columns no-print" data-editing={editing}>
        <section
          hidden={!editing || !facts}
          id="conditions-editor"
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
              aria-invalid={payeeInvalid}
              aria-describedby={payeeInvalid ? 'payee-error' : undefined}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="0x…"
              maxLength={42}
            />
          </label>
          {payeeInvalid && (
            <p className="error" id="payee-error">
              {t('请输入完整的0x收款地址。', 'Enter the full 0x payee address.')}
            </p>
          )}
          <label>
            {t(
              '预期资金付款人（可选，不是交易发送者）',
              'Expected movement payer (optional, separate from transaction sender)',
            )}
            <input
              value={payer}
              aria-invalid={payerInvalid}
              aria-describedby={payerInvalid ? 'payer-error' : undefined}
              onChange={(e) => setPayer(e.target.value)}
              placeholder="0x…"
              maxLength={42}
            />
          </label>
          {payerInvalid && (
            <p className="error" id="payer-error">
              {t('请输入完整的0x付款地址。', 'Enter the full 0x payer address.')}
            </p>
          )}
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
              aria-invalid={amountInvalid}
              aria-describedby={amountInvalid ? 'amount-error' : undefined}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              maxLength={80}
            />
          </label>
          {amountInvalid && (
            <p className="error" id="amount-error">
              {t(
                '请输入非负金额，最多18位小数。',
                'Enter a nonnegative amount with up to 18 decimals.',
              )}
            </p>
          )}
          {mode === 'RANGE' && (
            <label>
              {t('最大金额（USDC）', 'Maximum (USDC)')}
              <input
                value={max}
                aria-invalid={maxInvalid}
                aria-describedby={maxInvalid ? 'max-error' : undefined}
                onChange={(e) => setMax(e.target.value)}
                inputMode="decimal"
                maxLength={80}
              />
            </label>
          )}
          {maxInvalid && (
            <p className="error" id="max-error">
              {t(
                '最大金额须不小于最小金额，且最多18位小数。',
                'Maximum must be at least the minimum, with up to 18 decimals.',
              )}
            </p>
          )}
          <label>
            {t('截止时间（可选，UTC）', 'Deadline (optional, UTC)')}
            <input
              type="datetime-local"
              step="1"
              value={deadline ? deadline.slice(0, 19) : ''}
              onChange={(e) =>
                setDeadline(e.target.value ? new Date(e.target.value + 'Z').toISOString() : '')
              }
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
            className="primary"
            type="button"
            disabled={
              busy ||
              !!pending ||
              !selected.length ||
              !payee ||
              !amount ||
              payeeInvalid ||
              payerInvalid ||
              amountInvalid ||
              maxInvalid ||
              (mode === 'RANGE' && !max)
            }
            onClick={() => void submit(true)}
          >
            {t('按当前条件核对', 'Compare conditions')}
          </button>
        </section>
        <section hidden={!editing || !result} aria-label={t('规范资金转移', 'Canonical movements')}>
          <h3>{t('选择具体资金转移', 'Select exact movements')}</h3>
          <p className="quiet">
            {t(
              '勾选框确定核对范围；图和查看按钮只打开证据。手机使用同一资金清单。',
              'Checkboxes choose the comparison scope. The diagram and inspect buttons open evidence only. Mobile uses the same movement list.',
            )}
          </p>
          {facts && (
            <div className="verification-flow-desktop">
              <VerificationFlow
                movements={facts.movements}
                selected={evidence}
                onSelect={inspectMovement}
                lang={lang}
              />
            </div>
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
              <button type="button" onClick={() => inspectMovement(m.id)}>
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
        </section>
        <dialog
          ref={inspector}
          className="evidence-dialog"
          aria-label={t('原始证据检查器', 'Raw evidence inspector')}
        >
          <div className="dialog-heading">
            <h3>{t('所选资金原件', 'Selected raw evidence')}</h3>
            <button autoFocus onClick={() => inspector.current?.close()}>
              {t('关闭', 'Close')}
            </button>
          </div>
          <p>
            {(checkEvidence ? explain(checkEvidence.code) : evidence) ??
              t(
                '点击资金金额或核对项查看回执位置。',
                'Select a movement or check to inspect its receipt position.',
              )}
          </p>
          {(evidence || checkEvidence) && result && (
            <pre tabIndex={0}>
              {JSON.stringify(
                checkEvidence && !checkEvidence.movementIds.length
                  ? {
                      check: checkEvidence,
                      source: result.observation.source,
                      acquisition: result.report.acquisition,
                      transaction: result.observation.raw.transaction,
                      receipt: result.observation.raw.receipt,
                    }
                  : {
                      movements: inspectedMovements,
                      logs: result.observation.raw.receipt?.logs.filter((l) =>
                        inspectedLogIds.has(`5042:${l.transactionHash}:${BigInt(l.logIndex)}`),
                      ),
                    },
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
        </dialog>
      </div>

      {!reportId && (
        <details className="session-history no-print">
          <summary>
            {t('当前会话已保存报告（最近20版本）', 'Saved session reports (latest 20 versions)')}
          </summary>
          <p>
            {t(
              '仅列出原浏览器会话拥有的报告。',
              'Only reports owned by the original browser session are listed.',
            )}
          </p>
          {savedReports.map((h) => (
            <p key={h.report_id + h.bundle_hash}>
              <a href={'/?report=' + h.report_id}>
                {h.outcome ? explain(h.outcome) : t('观察报告', 'Observation report')} ·{' '}
                {h.transaction_hash.slice(0, 12)}… · {date(h.created_at)}
              </a>
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
