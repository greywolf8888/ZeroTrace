import { useLanguage, LanguageProvider, LanguageSwitch } from './i18n.js';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { SettlementCard } from './SettlementCard.js';
import { SettlementWorkbench } from './SettlementWorkbench.js';
import { Dashboard, LiveStrip } from './Dashboard.js';
import { VerificationWorkspace } from './VerificationWorkspace.js';
import {
  api,
  ApiError,
  label,
  value,
  money,
  semantics,
  parseInput,
  taskPath,
  type Registry,
  type Page,
  type Detail,
} from './model.js';
import './style.css';
import './neon.css';
import './verifier.css';
function Address({ address }: { address: string }) {
  const { localize } = useLanguage();
  const [feedback, setFeedback] = useState('');
  return (
    <span className="address-wrap">
      <button
        className="address"
        title={localize('复制链上地址 ' + address)}
        onClick={() =>
          void navigator.clipboard.writeText(address).then(
            () => setFeedback('已复制'),
            () => setFeedback('复制失败，请选中完整地址'),
          )
        }
      >
        {localize(address.slice(0, 8))}…{localize(address.slice(-6))}
      </button>
      <small role="status">{localize(feedback)}</small>
    </span>
  );
}
function App() {
  const { localize, locale, t } = useLanguage();
  const [route, setRoute] = useState(location.pathname + location.search);
  const [registry, setRegistry] = useState<Registry>();
  const [page, setPage] = useState<Page>();
  const [detail, setDetail] = useState<Detail>();
  const [example, setExample] = useState<{
    id: string;
    run: string;
  }>();
  const initial = new URLSearchParams(location.search);
  const [input, setInput] = useState(initial.get('address') ?? '');
  const [role, setRole] = useState(initial.get('role') ?? 'all');
  const [life, setLife] = useState(initial.get('lifecycle') ?? '');
  const [cash, setCash] = useState(initial.get('cashState') ?? '');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [readAt, setReadAt] = useState(() => Date.now());
  const [notice, setNotice] = useState('');
  const [showEvidence, setShowEvidence] = useState(false);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [coverage, setCoverage] = useState<Record<string, unknown>>();
  const report = route.split('?')[0]!.endsWith('/report');
  const consumer = route.startsWith('/consumer');
  const params = new URLSearchParams(route.split('?')[1]);
  const showTasks =
    consumer ||
    params.get('view') === 'tasks' ||
    ['address', 'role', 'lifecycle', 'cashState', 'cursor'].some((k) => params.has(k));
  const navigate = useCallback((url: string, replace = false) => {
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    setRoute(location.pathname + location.search);
    if (location.pathname === '/') setDetail(undefined);
    setNotice('');
    if (!replace) window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  useEffect(() => {
    const update = () => setRoute(location.pathname + location.search);
    addEventListener('popstate', update);
    api<Registry>('/v1/registry')
      .then(setRegistry)
      .catch((e) => setError(e));
    return () => removeEventListener('popstate', update);
  }, []);
  useEffect(() => {
    if (!registry) return;
    let cancelled = false;
    api<Page>('/v1/jobs?limit=1&cashState=CONFIRMED_DIRECT')
      .then((p) => {
        if (!cancelled && p.items[0]) setExample({ id: p.items[0].jobId, run: p.snapshotRunId });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [registry]);
  useEffect(() => {
    if (!registry) return;
    let cancelled = false;
    const u = new URL(route, location.origin);
    let redirected = false;
    const parts = u.pathname.split('/').filter(Boolean);
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setBusy(true);
      setReadAt(Date.now());
      setError(undefined);
      setShowEvidence(false);
      setSelectedEvidenceIds([]);
      if (!parts.length && !showTasks) {
        setDetail(undefined);
        setPage(undefined);
        return;
      }
      if (parts[0] === 'tasks') {
        if (
          parts[1] !== registry.chainId ||
          parts[2]?.toLowerCase() !== registry.adapter ||
          !parts[3] ||
          !/^\d{1,78}$/.test(parts[3]) ||
          parts.length > 5 ||
          (parts[4] && parts[4] !== 'report')
        )
          throw new ApiError('UNSUPPORTED_DEPLOYMENT', '任务路径不在已登记主网部署内。', 422);
        const data = await api<Detail>(
          `/v1/jobs/${registry.chainId}/${registry.adapter}/${parts[3]}${u.searchParams.get('snapshotRunId') ? '?snapshotRunId=' + encodeURIComponent(u.searchParams.get('snapshotRunId')!) : ''}`,
        );
        if (cancelled) return;
        setDetail(data);
        setPage(undefined);
        if (!u.searchParams.has('snapshotRunId')) {
          redirected = true;
          navigate(
            taskPath(registry, data.job.jobId, data.snapshotRunId, u.pathname.endsWith('/report')),
            true,
          );
        }
      } else if (u.pathname === '/consumer') {
        setDetail(undefined);
        setPage(undefined);
        if (u.searchParams.has('jobId')) {
          const parsed = parseInput(u.searchParams.get('jobId')!, registry);
          if (!('jobId' in parsed)) throw Error('集成演示请输入任务编号。');
          const data = await api<Detail>(
            `/v1/jobs/${registry.chainId}/${registry.adapter}/${parsed.jobId}${u.searchParams.has('snapshotRunId') ? '?snapshotRunId=' + encodeURIComponent(u.searchParams.get('snapshotRunId')!) : ''}`,
          );
          if (cancelled) return;
          setDetail(data);
          if (!u.searchParams.has('snapshotRunId')) {
            redirected = true;
            navigate(
              '/consumer?jobId=' + parsed.jobId + '&snapshotRunId=' + data.snapshotRunId,
              true,
            );
          }
        }
      } else if (u.pathname === '/') {
        const q = new URLSearchParams({ limit: '10' });
        for (const k of ['address', 'role', 'lifecycle', 'cashState', 'snapshotRunId', 'cursor']) {
          const v = u.searchParams.get(k);
          if (v) q.set(k, v);
        }
        const data = await api<Page>('/v1/jobs?' + q);
        if (cancelled) return;
        setPage(data);
        setDetail(undefined);
        if (!u.searchParams.has('snapshotRunId')) {
          redirected = true;
          u.searchParams.set('snapshotRunId', data.snapshotRunId);
          navigate(u.pathname + u.search, true);
        }
        if (u.searchParams.has('address')) setInput(u.searchParams.get('address')!);
        setRole(u.searchParams.get('role') ?? 'all');
        setLife(u.searchParams.get('lifecycle') ?? '');
        setCash(u.searchParams.get('cashState') ?? '');
      } else throw new ApiError('UNSUPPORTED_ROUTE', '页面路径不受支持；请从首页查询。', 404);
    })()
      .catch((e) => {
        if (!cancelled) {
          setDetail(undefined);
          setPage(undefined);
          setError(e instanceof Error ? e : Error('读取失败。'));
        }
      })
      .finally(() => {
        if (!cancelled && !redirected) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route, registry, navigate, showTasks]);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!registry) return;
    try {
      const parsed = parseInput(input, registry);
      if ('jobId' in parsed) {
        navigate(consumer ? '/consumer?jobId=' + parsed.jobId : taskPath(registry, parsed.jobId));
        return;
      }
      const q = new URLSearchParams({ address: parsed.address, role });
      if (life) q.set('lifecycle', life);
      if (cash) q.set('cashState', cash);
      navigate('/?' + q);
    } catch (e) {
      setError(e instanceof Error ? e : Error('输入不受支持。'));
    }
  }
  function filter() {
    const q = new URLSearchParams({ view: 'tasks' });
    if (input.trim()) {
      if (!/^0x[\da-fA-F]{40}$/.test(input.trim())) {
        setError(Error('地址格式不合法，请输入完整地址。'));
        return;
      }
      q.set('address', input.trim().toLowerCase());
      q.set('role', role);
    }
    if (life) q.set('lifecycle', life);
    if (cash) q.set('cashState', cash);
    navigate('/?' + q);
  }
  function paging(next: boolean) {
    if (!page) return;
    const q = new URLSearchParams(params);
    let previous: string[];
    try {
      previous = JSON.parse(q.get('previous') ?? '[]');
      if (
        !Array.isArray(previous) ||
        previous.some((p) => typeof p !== 'string' || p.length > 2048) ||
        previous.length > 20
      )
        throw Error();
    } catch {
      setError(Error('前页位置不合法，请重新加载列表。'));
      return;
    }
    if (next && page.nextCursor) {
      previous.push(q.get('cursor') ?? '');
      q.set('cursor', page.nextCursor);
    } else {
      const cursor = previous.pop();
      if (cursor === undefined) return;
      if (cursor) q.set('cursor', cursor);
      else q.delete('cursor');
    }
    q.set('previous', JSON.stringify(previous));
    navigate('/?' + q);
  }
  function reveal(ids: string[]) {
    setSelectedEvidenceIds(ids);
    setShowEvidence(true);
    setTimeout(
      () =>
        document
          .getElementById('evidence-' + ids[0])
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      30,
    );
  }
  const capture = detail?.job.snapshot ?? page?.snapshot;
  const testOnly = capture?.sourceSet?.some((s) => s.includes('test'));
  const transaction = (hash: string) =>
    registry!.navigation.transactionOrigin + registry!.navigation.transactionPathPrefix + hash;
  return (
    <>
      <header>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          <img className="mark" src="/brand/bundlemark-icon.png" alt="" width="48" height="48" />
          <div>
            <h1>BundleMark</h1>
            <p>
              {t(
                'Arc 交易报告核验器 · USDC 只读核验',
                'Arc transaction report verifier · Read-only USDC',
              )}
            </p>
          </div>
        </a>
        <span className="network">{localize('Arc 主网 · 5042 · 只读')}</span>
        <nav className="app-navigation no-print" aria-label={localize('工作区视图')}>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            {localize('核验')}
          </a>
          <a
            href="/?view=tasks"
            onClick={(e) => {
              e.preventDefault();
              navigate('/?view=tasks');
            }}
          >
            {localize('任务列表')}
          </a>
        </nav>
        <LanguageSwitch />
      </header>
      <main className={report ? 'report' : detail && !consumer ? 'task-page' : ''}>
        {localize(
          !detail && !report && !consumer && !showTasks && (
            <VerificationWorkspace
              key={params.get('report') ?? 'new'}
              reportId={params.get('report') ?? undefined}
              navigate={navigate}
            />
          ),
        )}
        {localize(
          !report && (
            <details open={!!detail} className="snapshot-summary">
              <summary>{localize('链状态与已保存任务概览')}</summary>
              <LiveStrip
                compact={!!detail}
                runId={page?.snapshotRunId ?? detail?.snapshotRunId}
                onLatest={() => {
                  if (detail && registry)
                    navigate(
                      consumer
                        ? '/consumer?jobId=' + detail.job.jobId
                        : taskPath(registry, detail.job.jobId),
                    );
                  else {
                    const query = new URLSearchParams(params);
                    for (const key of ['snapshotRunId', 'cursor', 'previous']) query.delete(key);
                    navigate('/?' + query);
                  }
                }}
              />
            </details>
          ),
        )}
        {localize(
          showTasks && page && registry && (
            <details className="snapshot-summary">
              <summary>{localize('已采集任务快照统计（可选）')}</summary>
              <Dashboard runId={page.snapshotRunId} registry={registry} onNavigate={navigate} />
            </details>
          ),
        )}
        {localize(
          showTasks && !detail && !report && (
            <section className="search-hero">
              <p className="eyebrow">{localize('从一个具体任务开始')}</p>
              <h2>{localize(consumer ? '结算卡独立集成演示' : '核对你的报酬、费用和待领取款')}</h2>
              <p>
                {localize(
                  '输入任务编号、ArcBounty 主网任务链接或完整地址，查看已采集的结算事实与证据。无需连接钱包。',
                )}
              </p>
              <form onSubmit={submit}>
                <label htmlFor="task-input">{localize('任务编号、任务链接或地址')}</label>
                <div className="input-action">
                  <input
                    id="task-input"
                    disabled={!registry || busy}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={localize('任务编号 / https://arcbounty.app/bounty/… / 0x…')}
                    required
                  />
                  <button className="primary" disabled={!registry || busy}>
                    {localize('查询')}
                  </button>
                </div>
              </form>
              {localize(
                example && registry && (
                  <button
                    className="subtle"
                    onClick={() => navigate(taskPath(registry, example.id, example.run))}
                  >
                    {localize('查看已核验示例：任务 #')}
                    {localize(example.id)}
                  </button>
                ),
              )}
              <p className="quiet">{localize('查询只读已发布快照；不会匿名发起全链扫描。')}</p>
            </section>
          ),
        )}
        {localize(
          error && (showTasks || route.startsWith('/tasks/') || !!report) && (
            <div className="error" role="alert">
              <strong>
                {localize(
                  error instanceof ApiError && error.status === 410
                    ? '固定快照已过期'
                    : error instanceof ApiError && error.status === 422
                      ? '范围不受支持'
                      : '查询未完成',
                )}
              </strong>
              <p>{localize(error.message)}</p>
              <p>{localize('缺失值不会显示为零；不会偷偷换成新快照。')}</p>
              {localize(
                error instanceof ApiError && error.status === 410 ? (
                  <button
                    onClick={() =>
                      navigate(
                        consumer
                          ? '/consumer?jobId=' + encodeURIComponent(params.get('jobId') ?? '')
                          : location.pathname,
                      )
                    }
                  >
                    {localize('查询新的已采集快照')}
                  </button>
                ) : (
                  <button onClick={() => navigate('/')}>{localize('返回首页重新查询')}</button>
                ),
              )}
            </div>
          ),
        )}
        {localize(busy && <p role="status">{localize('正在读取持久快照…')}</p>)}
        {localize(
          notice && (
            <p role="status" className="feedback">
              {localize(notice)}
            </p>
          ),
        )}
        <div
          hidden={!showTasks && !detail}
          className={detail && !report && !consumer ? 'task-statusbar' : ''}
        >
          {localize(
            testOnly && <p className="test-label">{localize('本地测试样例，不是主网证据。')}</p>,
          )}
          {localize(
            capture && (
              <div className="freshness">
                <strong>
                  {localize('采集时间：')}
                  {localize(
                    new Date(capture.observedAt).toLocaleString(locale, {
                      timeZone: 'Asia/Singapore',
                    }),
                  )}
                  {localize('（新加坡时间）')}
                </strong>
                <span>
                  {localize('截至区块 ')}
                  {localize(capture.blockNumber)}
                  {localize(' · 单来源 · 存储回放')}
                </span>
                {localize(
                  (page?.freshness.state === 'stale' ||
                    readAt - Date.parse(capture.observedAt) > 3600000) && (
                    <span>{localize('快照已陈旧')}</span>
                  ),
                )}
                {localize(
                  page?.freshness.state === 'provider-down' && (
                    <span>{localize('来源当前不可用，保留已采集结果')}</span>
                  ),
                )}
              </div>
            ),
          )}
          {localize(
            (page || detail) && (
              <div className="toolbar no-print">
                <button
                  onClick={() => {
                    if (detail && registry)
                      navigate(
                        consumer
                          ? '/consumer?jobId=' + detail.job.jobId
                          : taskPath(registry, detail.job.jobId),
                      );
                    else {
                      const q = new URLSearchParams(params);
                      q.delete('snapshotRunId');
                      q.delete('cursor');
                      q.delete('previous');
                      navigate('/?' + q);
                    }
                    setNotice('只重新读取已采集结果，不主动重新核验链。');
                  }}
                >
                  {localize('重新加载已采集结果')}
                </button>
                <button
                  onClick={() =>
                    void api<Record<string, unknown>>('/v1/coverage')
                      .then(setCoverage)
                      .catch(setError)
                  }
                >
                  {localize('查看覆盖与来源')}
                </button>
              </div>
            ),
          )}
        </div>
        {localize(
          showTasks && page && (
            <>
              <section className="filters">
                <h2>{localize('任务列表')}</h2>
                <div className="filter-grid">
                  <label>
                    {localize('角色地址筛选')}
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={localize('完整 0x 地址')}
                    />
                  </label>
                  <label>
                    {localize('地址角色')}
                    <select
                      aria-label={localize('地址角色')}
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      <option value="all">{localize('发布者或工作者')}</option>
                      <option value="poster">{localize('发布者')}</option>
                      <option value="worker">{localize('工作者')}</option>
                    </select>
                  </label>
                  <label>
                    {localize('业务状态')}
                    <select
                      aria-label={localize('业务状态')}
                      value={life}
                      onChange={(e) => setLife(e.target.value)}
                    >
                      <option value="">{localize('全部已采集业务状态')}</option>
                      {localize(
                        [
                          'OPEN',
                          'TAKEN',
                          'SUBMITTED',
                          'DISPUTED',
                          'APPROVED',
                          'CANCELLED',
                          'REJECTED',
                          'EXPIRED',
                          'DISPUTE_WORKER',
                          'DISPUTE_POSTER',
                          'TIMEOUT_SPLIT',
                          'TERMINAL_UNKNOWN',
                        ].map((s) => (
                          <option key={s} value={s}>
                            {localize(label(s))}
                          </option>
                        )),
                      )}
                    </select>
                  </label>
                  <label>
                    {localize('资金状态')}
                    <select
                      aria-label={localize('资金状态')}
                      value={cash}
                      onChange={(e) => setCash(e.target.value)}
                    >
                      <option value="">{localize('全部已采集资金状态')}</option>
                      {localize(
                        [
                          'CONFIRMED_DIRECT',
                          'PARKED',
                          'PARTIAL',
                          'UNKNOWN',
                          'CONFLICT',
                          'NONE_OBSERVED',
                          'NOT_APPLICABLE',
                          'VERIFIED_SEQUENCE_DERIVED',
                        ].map((s) => (
                          <option key={s} value={s}>
                            {localize(label(s))}
                          </option>
                        )),
                      )}
                    </select>
                  </label>
                  <button onClick={filter}>{localize('应用筛选')}</button>
                </div>
              </section>
              <div className="job-grid">
                {localize(
                  page.items.map((row) => (
                    <article className="job-card" key={row.jobId}>
                      <button
                        className="job-link"
                        onClick={() => {
                          if (registry)
                            navigate(
                              taskPath(registry, row.jobId, page.snapshotRunId) +
                                '&returnQuery=' +
                                encodeURIComponent(params.toString()),
                            );
                        }}
                      >
                        {localize('任务 #')}
                        {localize(row.jobId)}
                      </button>
                      <span
                        className={
                          'badge ' + semantics(value(row.cashState) ?? row.cashState.state)
                        }
                      >
                        {localize(
                          label(
                            value(row.cashState) ??
                              (row.cashState.state === 'conflict' ? 'CONFLICT' : 'UNKNOWN'),
                          ),
                        )}
                      </span>
                      <p>{localize(label(value(row.lifecycle) ?? 'TERMINAL_UNKNOWN'))}</p>
                      <strong>
                        {localize(value(row.reward) ? money(value(row.reward)!) : '奖励面值未知')}
                      </strong>
                      <p>
                        {localize('发布者：')}
                        <Address address={value(row.poster) ?? ''} />
                        <br />
                        {localize('工作者：')}
                        {localize(
                          value(row.worker) ? <Address address={value(row.worker)!} /> : '尚未指定',
                        )}
                      </p>
                      {localize(
                        params.has('address') && (
                          <p className="role-match">
                            {localize('查询地址的角色：')}
                            {localize(value(row.poster) === params.get('address') ? '发布者 ' : '')}
                            {localize(value(row.worker) === params.get('address') ? '工作者' : '')}
                          </p>
                        ),
                      )}
                    </article>
                  )),
                )}
              </div>
              {localize(
                page.items.length === 0 && (
                  <section>
                    <h3>{localize('当前快照与筛选范围内没有匹配记录')}</h3>
                    <p>
                      {localize(
                        '该结果不是全网无记录，也不表示款项为零。可清除筛选或核对支持的主网部署。',
                      )}
                    </p>
                    <button onClick={() => navigate('/?view=tasks')}>{localize('清除筛选')}</button>
                  </section>
                ),
              )}
              <nav className="pagination" aria-label={localize('任务分页')}>
                <button
                  disabled={busy || !params.has('previous') || params.get('previous') === '[]'}
                  onClick={() => paging(false)}
                >
                  {localize('上一页')}
                </button>
                <span>{localize('固定快照分页')}</span>
                <button disabled={!page.nextCursor || busy} onClick={() => paging(true)}>
                  {localize('下一页')}
                </button>
              </nav>
              <details className="advanced">
                <summary>{localize('高级：连续历史范围与覆盖缺口')}</summary>
                <section aria-label={localize('连续历史范围')}>
                  <h2>{localize('连续历史范围')}</h2>
                  {localize(
                    value(page.historyRange) ? (
                      <>
                        <p>
                          {localize('声明窗口：区块')}
                          {localize(value(page.historyRange)!.fromBlock)}–
                          {localize(value(page.historyRange)!.targetBlock)}
                          {localize('；连续核验至')}
                          {localize(' ')}
                          {localize(value(page.historyRange)!.contiguousThrough)}；
                          {localize(label(value(page.historyRange)!.status))}。
                        </p>
                        {localize(
                          value(page.historyRange)!.omittedPriorHistory && (
                            <p>
                              {localize(
                                '窗口之前的历史未覆盖，不能据此认定旧任务资金为零或完整清偿。',
                              )}
                            </p>
                          ),
                        )}
                        {localize(
                          value(page.historyRange)!.gaps.map((g) => (
                            <p key={g.fromBlock}>
                              {localize('未核验区间 ')}
                              {localize(g.fromBlock)}–{localize(g.toBlock)}：{localize(g.reason)}
                            </p>
                          )),
                        )}
                      </>
                    ) : (
                      <p>{localize('本快照未声明完整历史范围。')}</p>
                    ),
                  )}
                </section>
              </details>
            </>
          ),
        )}
        {localize(
          detail && registry && (
            <>
              <div className="heading task-heading">
                <button
                  className="no-print"
                  onClick={() => navigate('/?' + (params.get('returnQuery') ?? 'view=tasks'))}
                >
                  {localize('← 返回任务列表')}
                </button>
                {localize(
                  consumer && <span>{localize('独立消费者：真实 HTTP，同一结算结果模型')}</span>,
                )}
                <h2>
                  {localize(report ? '结算报告 · ' : '')}
                  {localize('任务 #')}
                  {localize(detail.job.jobId)}
                </h2>
                <span className={'badge ' + semantics(detail.result.state)}>
                  {localize(label(value(detail.job.lifecycle) ?? 'TERMINAL_UNKNOWN'))}；
                  {localize(label(value(detail.job.cashState) ?? 'UNKNOWN'))}
                </span>
              </div>
              <p className="roles">
                {localize('发布者：')}
                <Address address={value(detail.job.poster) ?? ''} />
                {localize('工作者：')}
                {localize(
                  value(detail.job.worker) ? (
                    <Address address={value(detail.job.worker)!} />
                  ) : (
                    '尚未指定'
                  ),
                )}
              </p>
              {localize(
                report || consumer ? (
                  <SettlementCard result={detail.result} onEvidence={reveal} />
                ) : (
                  <SettlementWorkbench
                    key={detail.snapshotRunId + detail.job.jobId}
                    detail={detail}
                    registry={registry}
                    onEvidence={reveal}
                    onTask={(id) => navigate(taskPath(registry, id, detail.snapshotRunId))}
                  />
                ),
              )}
              <div className="toolbar no-print">
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(
                        location.origin +
                          taskPath(registry, detail.job.jobId, detail.snapshotRunId),
                      )
                      .then(
                        () => setNotice('固定快照任务链接已复制'),
                        () => setNotice('复制失败，请从地址栏复制'),
                      )
                  }
                >
                  {localize('复制固定快照链接')}
                </button>
                <button
                  className="primary"
                  onClick={() =>
                    navigate(taskPath(registry, detail.job.jobId, detail.snapshotRunId, true))
                  }
                >
                  {localize('生成可读结算报告')}
                </button>
                {localize(
                  report && (
                    <button onClick={() => window.print()}>{localize('打印 / 保存 PDF')}</button>
                  ),
                )}
                <a
                  className="button"
                  href={`/api/v1/jobs/${registry.chainId}/${registry.adapter}/${detail.job.jobId}?snapshotRunId=${detail.snapshotRunId}&format=json`}
                >
                  {localize('导出证据 JSON')}
                </a>
                <a
                  className="button"
                  href={
                    registry.navigation.taskOrigin +
                    registry.navigation.taskPathPrefix +
                    detail.job.jobId
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {localize('查看上游任务')}
                </a>
              </div>
              {localize(
                report && (
                  <p className="report-disclosure">
                    {localize('这是同一固定快照的只读结算报告，不是官方审计证书。快照：')}
                    {localize(detail.snapshotRunId)}
                    {localize('；金额和证据来自下列公开链上记录。')}
                  </p>
                ),
              )}
              <section>
                <h3>{localize('资金分配明细')}</h3>
                {localize(
                  detail.settlementLegs.length === 0 ? (
                    <p>{localize('当前历史不足，暂无法核验资金分配。')}</p>
                  ) : (
                    <div className="allocation-grid">
                      {localize(
                        detail.settlementLegs.map((l) => (
                          <article key={l.id}>
                            <strong>
                              {localize(label(l.role))} · {localize(label(l.kind))}
                            </strong>
                            <p>
                              {localize('应分配：')}
                              {localize(money(l.expectedAmount))}
                              <br />
                              {localize('观察到转移：')}
                              {localize(
                                value(l.observedAmount)
                                  ? money(value(l.observedAmount)!)
                                  : '未知：暂无法核验',
                              )}
                              <br />
                              {localize('曾转入待领取：')}
                              {localize(
                                value(l.parkedAmount)
                                  ? money(value(l.parkedAmount)!)
                                  : '未知：暂无法核验',
                              )}
                            </p>
                            <p>
                              {localize(label(l.attribution))} · <Address address={l.payee} />
                            </p>
                            <button
                              onClick={() => reveal(l.evidenceIds)}
                              disabled={!l.evidenceIds.length}
                            >
                              {localize('查看该分配证据')}
                            </button>
                          </article>
                        )),
                      )}
                    </div>
                  ),
                )}
              </section>
              <section>
                <h3>{localize('具体待领取与清偿关系')}</h3>
                <p>
                  {localize(
                    '账户级待领取总余额不能分摊为每个任务的欠款；旧义务清偿不会覆盖新的义务。历史不完整时只显示已核验范围。',
                  )}
                </p>
                {localize(
                  detail.pendingAccounts.map((a) => (
                    <article key={a.payee}>
                      <h4>
                        {localize('账户：')}
                        <Address address={a.payee} />
                      </h4>
                      <p>
                        {localize('账户总待领取：')}
                        {localize(money(a.balance))}
                        {localize(' · 历史')}
                        {localize(label(a.history))}
                        {localize('（账户级，不能重复归属任务）')}
                      </p>
                      {localize(
                        a.obligations
                          .filter((o) => o.jobId === detail.job.jobId)
                          .map((o) => (
                            <div className="obligation" key={o.id}>
                              <strong>
                                {localize(label(o.status))}：{localize(money(o.amount))}
                              </strong>
                              <p>
                                {localize('本任务具体义务 ')}
                                {localize(o.id)}
                              </p>
                              {localize(
                                o.clearedBy && (
                                  <p>
                                    {localize('对应清偿事件：')}
                                    {localize(o.clearedBy)}
                                  </p>
                                ),
                              )}
                              <a
                                href={transaction(o.transactionHash)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {localize('查看停放交易')}
                              </a>
                            </div>
                          )),
                      )}
                      {localize(
                        !a.obligations.some((o) => o.jobId === detail.job.jobId) && (
                          <p>{localize('尚无可归属本任务的具体义务证据。')}</p>
                        ),
                      )}
                      {localize(
                        a.withdrawals.map((w) => (
                          <details key={w.eventId}>
                            <summary>
                              {localize('账户清偿批次：')}
                              {localize(money(w.amount))}
                            </summary>
                            <p>
                              {localize('仅账户级，关联具体义务：')}
                              {localize(w.obligationIds.join('、') || '未完整核验，不能推定已领取')}
                            </p>
                            <p>
                              {localize('清偿事件：')}
                              {localize(w.eventId)}
                            </p>
                            <a
                              href={transaction(w.transactionHash)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {localize('查看提现交易')}
                            </a>
                          </details>
                        )),
                      )}
                    </article>
                  )),
                )}
              </section>
              <section>
                <h3>{localize('交易级 Gas（单列）')}</h3>
                <p>
                  {localize(
                    '数值属于整笔交易；批量任务共用交易时，不分摊或重复累加为每个任务费用，也不从报酬中扣除。',
                  )}
                </p>
                {localize(
                  detail.result.gas.length === 0 ? (
                    <p>{localize('交易 Gas 未取得可核验回执。')}</p>
                  ) : (
                    detail.result.gas.map((g) => (
                      <article key={g.transactionHash}>
                        <strong>{localize(money(g.amount))}</strong>
                        <p>
                          {localize('付费方：')}
                          {localize(
                            value(g.payer) ? (
                              <Address address={value(g.payer)!} />
                            ) : (
                              '未知：回执未提供付费方'
                            ),
                          )}
                        </p>
                        <a href={transaction(g.transactionHash)} target="_blank" rel="noreferrer">
                          {localize('浏览器交易：')}
                          {localize(g.transactionHash.slice(0, 12))}…
                        </a>
                        <button onClick={() => reveal(g.evidenceIds)}>
                          {localize('核对 Gas 回执')}
                        </button>
                      </article>
                    ))
                  ),
                )}
              </section>
              <section>
                <h3>{localize('链上事件时间线')}</h3>
                {localize(
                  detail.timeline.length === 0 ? (
                    <p>{localize('尚未取得可核验历史事件。')}</p>
                  ) : (
                    detail.timeline.map((e) => (
                      <article className="timeline-item" key={e.id}>
                        <strong>{localize(label(e.name))}</strong>
                        <span>
                          {localize('区块 ')}
                          {localize(e.blockNumber)}
                        </span>
                        <a href={transaction(e.transactionHash)} target="_blank" rel="noreferrer">
                          {localize('交易证据')}
                        </a>
                      </article>
                    ))
                  ),
                )}
                {localize(
                  detail.nextTimelineCursor && (
                    <button
                      onClick={() =>
                        void api<Detail>(
                          `/v1/jobs/${registry.chainId}/${registry.adapter}/${detail.job.jobId}?snapshotRunId=${detail.snapshotRunId}&timelineCursor=${encodeURIComponent(detail.nextTimelineCursor!)}`,
                        )
                          .then((d) =>
                            setDetail({ ...d, timeline: [...detail.timeline, ...d.timeline] }),
                          )
                          .catch(setError)
                      }
                    >
                      {localize('继续读取时间线')}
                    </button>
                  ),
                )}
              </section>
              <section className="no-print">
                <h3>{localize('有界补证状态')}</h3>
                {localize(
                  detail.evidenceRequest ? (
                    <>
                      <p>
                        {localize('申请基线快照：')}
                        {localize(detail.evidenceRequest.snapshotRunId)}。
                      </p>
                      {localize(
                        detail.evidenceRequest.snapshotRunId !== detail.snapshotRunId && (
                          <p>{localize('补证基线与当前查看快照不同；当前结果仍固定在原快照。')}</p>
                        ),
                      )}
                      <p>
                        {localize(
                          detail.evidenceRequest.plan && !detail.evidenceRequest.plan.from ? (
                            '未启动新的扫描。'
                          ) : (
                            <>
                              {localize(label(detail.evidenceRequest.status))}
                              {localize('；所选区间')}
                              {localize(' ')}
                              {localize(detail.evidenceRequest.from)}–
                              {localize(detail.evidenceRequest.to)}
                              {localize('，已核验至')}
                              {localize(' ')}
                              {localize(detail.evidenceRequest.head)}
                              {localize('。完成区间不表示完整任务历史。')}
                            </>
                          ),
                        )}
                      </p>
                      <p>
                        {localize(
                          detail.evidenceRequest.plan?.reason ??
                            '旧申请未保存目标定位计划；扫描状态不能证明已补齐。',
                        )}
                      </p>
                      <p>
                        {localize('查证结果：')}
                        {localize(
                          detail.evidenceRequest.outcome
                            ? detail.evidenceRequest.outcome.state === 'PENDING'
                              ? '尚待扫描及新结果发布'
                              : label(detail.evidenceRequest.outcome.state)
                            : '旧申请未保存查证结果',
                        )}
                      </p>
                      {localize(
                        detail.evidenceRequest.outcome?.afterSnapshot && (
                          <>
                            <p>
                              {localize('新增相关证据：')}
                              {localize(detail.evidenceRequest.outcome.newEvidenceIds.length)}
                              {localize('；结论')}
                              {localize(
                                detail.evidenceRequest.outcome.conclusionChanged
                                  ? '发生变化'
                                  : '未发生变化',
                              )}
                              {localize('。当前固定快照未变。')}
                            </p>
                            <button
                              onClick={() =>
                                navigate(
                                  taskPath(
                                    registry,
                                    detail.job.jobId,
                                    detail.evidenceRequest!.outcome!.afterSnapshot,
                                    report,
                                  ),
                                )
                              }
                            >
                              {localize('打开补证后的固定快照')}
                            </button>
                          </>
                        ),
                      )}
                    </>
                  ) : (
                    <p>
                      {localize(
                        '当前没有该任务补证请求。每轮最多 2000 区块、总请求最多 200000 区块；同任务一小时最多一个新请求。',
                      )}
                    </p>
                  ),
                )}
                <button
                  disabled={detail.evidenceRequest?.status === 'PENDING'}
                  onClick={() =>
                    void api<{
                      message: string;
                    }>(
                      `/v1/jobs/${registry.chainId}/${registry.adapter}/${detail.job.jobId}/evidence-requests`,
                      'POST',
                    )
                      .then((r) => setNotice(r.message))
                      .catch(setError)
                  }
                >
                  {localize('申请本任务有界补证')}
                </button>
                <p className="quiet">
                  {localize('补证以申请时最新已采集快照为基线；不会自动更换当前结果。')}
                </p>
                <button
                  onClick={() =>
                    void api<Detail>(
                      `/v1/jobs/${registry.chainId}/${registry.adapter}/${detail.job.jobId}?snapshotRunId=${detail.snapshotRunId}`,
                    )
                      .then(setDetail)
                      .catch(setError)
                  }
                >
                  {localize('查询补证队列状态')}
                </button>
              </section>
              <details className="advanced" open={showEvidence}>
                <summary
                  onClick={(e) => {
                    e.preventDefault();
                    setShowEvidence(!showEvidence);
                  }}
                >
                  {localize('证据与高级信息')}
                </summary>
                <h3>{localize('来源、覆盖与回放')}</h3>
                <div className="coverage">
                  {localize(
                    Object.entries(detail.job.coverage).map(([k, v]) => (
                      <span className={'badge ' + semantics(value(v) ?? v.state)} key={k}>
                        {localize(label(k))}：{localize(label(value(v) ?? v.state))}
                      </span>
                    )),
                  )}
                </div>
                <p>
                  {localize('来源：持久存储回放；未经校准概率评估。规则版本')}
                  {localize(detail.ruleVersion)}
                  {localize('。完整当前状态不表示完整历史；存储回放不表示实时在线核验。')}
                </p>
                <button onClick={() => setShowEvidence(true)}>{localize('查看原始证据')}</button>
                <details>
                  <summary>{localize('查看原始状态')}</summary>
                  <pre>{JSON.stringify(value(detail.rawState), null, 2)}</pre>
                </details>
                {localize(
                  detail.evidence.map((e) => (
                    <details
                      id={'evidence-' + e.id}
                      key={e.id}
                      open={selectedEvidenceIds.includes(e.id)}
                    >
                      <summary>
                        {localize('证据 ')}
                        {localize(e.id)}
                      </summary>
                      <p>
                        {localize('来源：')}
                        {localize(e.sourceAlias)}
                        {localize(' · 摘要：')}
                        {localize(e.payloadHash)}
                      </p>
                      <pre>{JSON.stringify(e.safePayload, null, 2)}</pre>
                    </details>
                  )),
                )}
              </details>
            </>
          ),
        )}
        {localize(
          coverage && (
            <details open className="advanced">
              <summary>{localize('数据覆盖与运行状态')}</summary>
              <p>{localize('完整当前状态不表示完整历史；存储回放不表示实时在线核验。')}</p>
              <pre>{JSON.stringify(coverage, null, 2)}</pre>
            </details>
          ),
        )}
        <footer>
          <p>
            {localize(
              '仅支持已登记部署。局部结算事实可查询；正式取证模式仍依覆盖关闭。本组件独立提供数据，不表示 Arc 官方认证、资助已获批或上游已采用。',
            )}
          </p>
          {localize(
            registry && (
              <nav>
                <a href={registry.navigation.sourceRepository} target="_blank" rel="noreferrer">
                  {t('项目源码与使用说明', 'Source code and documentation')}
                </a>
                <a
                  href="/consumer"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/consumer');
                  }}
                >
                  {localize('开发者：结算卡集成演示')}
                </a>
              </nav>
            ),
          )}
          <details>
            <summary>{t('组件范围', 'Component scope')}</summary>
            <p>
              {t(
                '输入 Arc 主网交易，读取 USDC 资金转移，按收款条件核对，保存、分享和导出固定报告。登记任务使用既有快照和证据。覆盖不足保持未知；不需要连接钱包或签名。',
                'Read Arc mainnet USDC movements, compare supplied conditions, and save, share or export immutable reports. Registered tasks reuse existing snapshots and evidence. Incomplete coverage remains unknown. No wallet connection or signing is required.',
              )}
            </p>
          </details>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>,
);
