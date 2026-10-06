import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { SettlementCard } from './SettlementCard.js';
import { SettlementWorkbench } from './SettlementWorkbench.js';
import { Dashboard, LiveStrip } from './Dashboard.js';
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
function Address({ address }: { address: string }) {
  const [feedback, setFeedback] = useState('');
  return (
    <span className="address-wrap">
      <button
        className="address"
        title={'复制链上地址 ' + address}
        onClick={() =>
          void navigator.clipboard.writeText(address).then(
            () => setFeedback('已复制'),
            () => setFeedback('复制失败，请选中完整地址'),
          )
        }
      >
        {address.slice(0, 8)}…{address.slice(-6)}
      </button>
      <small role="status">{feedback}</small>
    </span>
  );
}
function App() {
  const [route, setRoute] = useState(location.pathname + location.search);
  const [registry, setRegistry] = useState<Registry>();
  const [page, setPage] = useState<Page>();
  const [detail, setDetail] = useState<Detail>();
  const [example, setExample] = useState<{ id: string; run: string }>();
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
  const navigate = useCallback((url: string, replace = false) => {
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    setRoute(location.pathname + location.search);
    setNotice('');
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
  }, [route, registry, navigate]);
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
    const q = new URLSearchParams();
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
          <span className="mark">◈</span>
          <div>
            <h1>Arc 任务证据台</h1>
            <p>ArcBounty 报酬与结算核验</p>
          </div>
        </a>
        <span className="network">Arc 主网 · 5042 · 只读</span>
      </header>
      <main className={report ? 'report' : detail && !consumer ? 'task-page' : ''}>
        {!report && (
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
        )}
        {page && registry && (
          <Dashboard runId={page.snapshotRunId} registry={registry} onNavigate={navigate} />
        )}
        {!detail && !report && (
          <section className="search-hero">
            <p className="eyebrow">从一个具体任务开始</p>
            <h2>{consumer ? '结算卡独立集成演示' : '核对你的报酬、费用和待领取款'}</h2>
            <p>
              输入任务编号、ArcBounty
              主网任务链接或完整地址，查看已采集的结算事实与证据。无需连接钱包。
            </p>
            <form onSubmit={submit}>
              <label htmlFor="task-input">任务编号、任务链接或地址</label>
              <div className="input-action">
                <input
                  id="task-input"
                  disabled={!registry || busy}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="任务编号 / https://arcbounty.app/bounty/… / 0x…"
                  required
                />
                <button className="primary" disabled={!registry || busy}>
                  查询
                </button>
              </div>
            </form>
            {example && registry && (
              <button
                className="subtle"
                onClick={() => navigate(taskPath(registry, example.id, example.run))}
              >
                查看已核验示例：任务 #{example.id}
              </button>
            )}
            <p className="quiet">查询只读已发布快照；不会匿名发起全链扫描。</p>
          </section>
        )}
        {error && (
          <div className="error" role="alert">
            <strong>
              {error instanceof ApiError && error.status === 410
                ? '固定快照已过期'
                : error instanceof ApiError && error.status === 422
                  ? '范围不受支持'
                  : '查询未完成'}
            </strong>
            <p>{error.message}</p>
            <p>缺失值不会显示为零；不会偷偷换成新快照。</p>
            {error instanceof ApiError && error.status === 410 ? (
              <button
                onClick={() =>
                  navigate(
                    consumer
                      ? '/consumer?jobId=' + encodeURIComponent(params.get('jobId') ?? '')
                      : location.pathname,
                  )
                }
              >
                查询新的已采集快照
              </button>
            ) : (
              <button onClick={() => navigate('/')}>返回首页重新查询</button>
            )}
          </div>
        )}
        {busy && <p role="status">正在读取持久快照…</p>}
        {notice && (
          <p role="status" className="feedback">
            {notice}
          </p>
        )}
        <div className={detail && !report && !consumer ? 'task-statusbar' : ''}>
          {testOnly && <p className="test-label">本地测试样例，不是主网证据。</p>}
          {capture && (
            <div className="freshness">
              <strong>
                采集时间：
                {new Date(capture.observedAt).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Singapore',
                })}
                （新加坡时间）
              </strong>
              <span>截至区块 {capture.blockNumber} · 单来源 · 存储回放</span>
              {(page?.freshness.state === 'stale' ||
                readAt - Date.parse(capture.observedAt) > 3600000) && <span>快照已陈旧</span>}
              {page?.freshness.state === 'provider-down' && (
                <span>来源当前不可用，保留已采集结果</span>
              )}
            </div>
          )}
          {(page || detail) && (
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
                重新加载已采集结果
              </button>
              <button
                onClick={() =>
                  void api<Record<string, unknown>>('/v1/coverage')
                    .then(setCoverage)
                    .catch(setError)
                }
              >
                查看覆盖与来源
              </button>
            </div>
          )}
        </div>
        {page && (
          <>
            <section className="filters">
              <h2>任务列表</h2>
              <div className="filter-grid">
                <label>
                  角色地址筛选
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="完整 0x 地址"
                  />
                </label>
                <label>
                  地址角色
                  <select
                    aria-label="地址角色"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="all">发布者或工作者</option>
                    <option value="poster">发布者</option>
                    <option value="worker">工作者</option>
                  </select>
                </label>
                <label>
                  业务状态
                  <select
                    aria-label="业务状态"
                    value={life}
                    onChange={(e) => setLife(e.target.value)}
                  >
                    <option value="">全部已采集业务状态</option>
                    {[
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
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  资金状态
                  <select
                    aria-label="资金状态"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                  >
                    <option value="">全部已采集资金状态</option>
                    {[
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
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={filter}>应用筛选</button>
              </div>
            </section>
            <div className="job-grid">
              {page.items.map((row) => (
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
                    任务 #{row.jobId}
                  </button>
                  <span
                    className={'badge ' + semantics(value(row.cashState) ?? row.cashState.state)}
                  >
                    {label(
                      value(row.cashState) ??
                        (row.cashState.state === 'conflict' ? 'CONFLICT' : 'UNKNOWN'),
                    )}
                  </span>
                  <p>{label(value(row.lifecycle) ?? 'TERMINAL_UNKNOWN')}</p>
                  <strong>{value(row.reward) ? money(value(row.reward)!) : '奖励面值未知'}</strong>
                  <p>
                    发布者：
                    <Address address={value(row.poster) ?? ''} />
                    <br />
                    工作者：
                    {value(row.worker) ? <Address address={value(row.worker)!} /> : '尚未指定'}
                  </p>
                  {params.has('address') && (
                    <p className="role-match">
                      查询地址的角色：{value(row.poster) === params.get('address') ? '发布者 ' : ''}
                      {value(row.worker) === params.get('address') ? '工作者' : ''}
                    </p>
                  )}
                </article>
              ))}
            </div>
            {page.items.length === 0 && (
              <section>
                <h3>当前快照与筛选范围内没有匹配记录</h3>
                <p>该结果不是全网无记录，也不表示款项为零。可清除筛选或核对支持的主网部署。</p>
                <button onClick={() => navigate('/')}>清除筛选</button>
              </section>
            )}
            <nav className="pagination" aria-label="任务分页">
              <button
                disabled={busy || !params.has('previous') || params.get('previous') === '[]'}
                onClick={() => paging(false)}
              >
                上一页
              </button>
              <span>固定快照分页</span>
              <button disabled={!page.nextCursor || busy} onClick={() => paging(true)}>
                下一页
              </button>
            </nav>
            <details className="advanced">
              <summary>高级：连续历史范围与覆盖缺口</summary>
              <section aria-label="连续历史范围">
                <h2>连续历史范围</h2>
                {value(page.historyRange) ? (
                  <>
                    <p>
                      声明窗口：区块 {value(page.historyRange)!.fromBlock}–
                      {value(page.historyRange)!.targetBlock}；连续核验至{' '}
                      {value(page.historyRange)!.contiguousThrough}；
                      {label(value(page.historyRange)!.status)}。
                    </p>
                    {value(page.historyRange)!.omittedPriorHistory && (
                      <p>窗口之前的历史未覆盖，不能据此认定旧任务资金为零或完整清偿。</p>
                    )}
                    {value(page.historyRange)!.gaps.map((g) => (
                      <p key={g.fromBlock}>
                        未核验区间 {g.fromBlock}–{g.toBlock}：{g.reason}
                      </p>
                    ))}
                  </>
                ) : (
                  <p>本快照未声明完整历史范围。</p>
                )}
              </section>
            </details>
          </>
        )}
        {detail && registry && (
          <>
            <div className="heading task-heading">
              <button
                className="no-print"
                onClick={() =>
                  navigate('/' + (params.get('returnQuery') ? '?' + params.get('returnQuery') : ''))
                }
              >
                ← 返回任务列表
              </button>
              {consumer && <span>独立消费者：真实 HTTP，同一结算结果模型</span>}
              <h2>
                {report ? '结算报告 · ' : ''}任务 #{detail.job.jobId}
              </h2>
              <span className={'badge ' + semantics(detail.result.state)}>
                {label(value(detail.job.lifecycle) ?? 'TERMINAL_UNKNOWN')}；
                {label(value(detail.job.cashState) ?? 'UNKNOWN')}
              </span>
            </div>
            <p className="roles">
              发布者：
              <Address address={value(detail.job.poster) ?? ''} />
              工作者：
              {value(detail.job.worker) ? (
                <Address address={value(detail.job.worker)!} />
              ) : (
                '尚未指定'
              )}
            </p>
            {report || consumer ? (
              <SettlementCard result={detail.result} onEvidence={reveal} />
            ) : (
              <SettlementWorkbench
                key={detail.snapshotRunId + detail.job.jobId}
                detail={detail}
                registry={registry}
                onEvidence={reveal}
                onTask={(id) => navigate(taskPath(registry, id, detail.snapshotRunId))}
              />
            )}
            <div className="toolbar no-print">
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(
                      location.origin + taskPath(registry, detail.job.jobId, detail.snapshotRunId),
                    )
                    .then(
                      () => setNotice('固定快照任务链接已复制'),
                      () => setNotice('复制失败，请从地址栏复制'),
                    )
                }
              >
                复制固定快照链接
              </button>
              <button
                className="primary"
                onClick={() =>
                  navigate(taskPath(registry, detail.job.jobId, detail.snapshotRunId, true))
                }
              >
                生成可读结算报告
              </button>
              {report && <button onClick={() => window.print()}>打印 / 保存 PDF</button>}
              <a
                className="button"
                href={`/api/v1/jobs/${registry.chainId}/${registry.adapter}/${detail.job.jobId}?snapshotRunId=${detail.snapshotRunId}&format=json`}
              >
                导出证据 JSON
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
                查看上游任务
              </a>
            </div>
            {report && (
              <p className="report-disclosure">
                这是同一固定快照的只读结算报告，不是官方审计证书。快照：{detail.snapshotRunId}
                ；金额和证据来自下列公开链上记录。
              </p>
            )}
            <section>
              <h3>资金分配明细</h3>
              {detail.settlementLegs.length === 0 ? (
                <p>当前历史不足，暂无法核验资金分配。</p>
              ) : (
                <div className="allocation-grid">
                  {detail.settlementLegs.map((l) => (
                    <article key={l.id}>
                      <strong>
                        {label(l.role)} · {label(l.kind)}
                      </strong>
                      <p>
                        应分配：{money(l.expectedAmount)}
                        <br />
                        观察到转移：
                        {value(l.observedAmount)
                          ? money(value(l.observedAmount)!)
                          : '未知：暂无法核验'}
                        <br />
                        曾转入待领取：
                        {value(l.parkedAmount) ? money(value(l.parkedAmount)!) : '未知：暂无法核验'}
                      </p>
                      <p>
                        {label(l.attribution)} · <Address address={l.payee} />
                      </p>
                      <button
                        onClick={() => reveal(l.evidenceIds)}
                        disabled={!l.evidenceIds.length}
                      >
                        查看该分配证据
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section>
              <h3>具体待领取与清偿关系</h3>
              <p>
                账户级待领取总余额不能分摊为每个任务的欠款；旧义务清偿不会覆盖新的义务。历史不完整时只显示已核验范围。
              </p>
              {detail.pendingAccounts.map((a) => (
                <article key={a.payee}>
                  <h4>
                    账户：
                    <Address address={a.payee} />
                  </h4>
                  <p>
                    账户总待领取：{money(a.balance)} · 历史{label(a.history)}
                    （账户级，不能重复归属任务）
                  </p>
                  {a.obligations
                    .filter((o) => o.jobId === detail.job.jobId)
                    .map((o) => (
                      <div className="obligation" key={o.id}>
                        <strong>
                          {label(o.status)}：{money(o.amount)}
                        </strong>
                        <p>本任务具体义务 {o.id}</p>
                        {o.clearedBy && <p>对应清偿事件：{o.clearedBy}</p>}
                        <a href={transaction(o.transactionHash)} target="_blank" rel="noreferrer">
                          查看停放交易
                        </a>
                      </div>
                    ))}
                  {!a.obligations.some((o) => o.jobId === detail.job.jobId) && (
                    <p>尚无可归属本任务的具体义务证据。</p>
                  )}
                  {a.withdrawals.map((w) => (
                    <details key={w.eventId}>
                      <summary>账户清偿批次：{money(w.amount)}</summary>
                      <p>
                        仅账户级，关联具体义务：
                        {w.obligationIds.join('、') || '未完整核验，不能推定已领取'}
                      </p>
                      <p>清偿事件：{w.eventId}</p>
                      <a href={transaction(w.transactionHash)} target="_blank" rel="noreferrer">
                        查看提现交易
                      </a>
                    </details>
                  ))}
                </article>
              ))}
            </section>
            <section>
              <h3>交易级 Gas（单列）</h3>
              <p>
                数值属于整笔交易；批量任务共用交易时，不分摊或重复累加为每个任务费用，也不从报酬中扣除。
              </p>
              {detail.result.gas.length === 0 ? (
                <p>交易 Gas 未取得可核验回执。</p>
              ) : (
                detail.result.gas.map((g) => (
                  <article key={g.transactionHash}>
                    <strong>{money(g.amount)}</strong>
                    <p>
                      付费方：
                      {value(g.payer) ? (
                        <Address address={value(g.payer)!} />
                      ) : (
                        '未知：回执未提供付费方'
                      )}
                    </p>
                    <a href={transaction(g.transactionHash)} target="_blank" rel="noreferrer">
                      浏览器交易：{g.transactionHash.slice(0, 12)}…
                    </a>
                    <button onClick={() => reveal(g.evidenceIds)}>核对 Gas 回执</button>
                  </article>
                ))
              )}
            </section>
            <section>
              <h3>链上事件时间线</h3>
              {detail.timeline.length === 0 ? (
                <p>尚未取得可核验历史事件。</p>
              ) : (
                detail.timeline.map((e) => (
                  <article className="timeline-item" key={e.id}>
                    <strong>{label(e.name)}</strong>
                    <span>区块 {e.blockNumber}</span>
                    <a href={transaction(e.transactionHash)} target="_blank" rel="noreferrer">
                      交易证据
                    </a>
                  </article>
                ))
              )}
              {detail.nextTimelineCursor && (
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
                  继续读取时间线
                </button>
              )}
            </section>
            <section className="no-print">
              <h3>有界补证状态</h3>
              {detail.evidenceRequest ? (
                <>
                  <p>申请基线快照：{detail.evidenceRequest.snapshotRunId}。</p>
                  {detail.evidenceRequest.snapshotRunId !== detail.snapshotRunId && (
                    <p>补证基线与当前查看快照不同；当前结果仍固定在原快照。</p>
                  )}
                  <p>
                    {detail.evidenceRequest.plan && !detail.evidenceRequest.plan.from ? (
                      '未启动新的扫描。'
                    ) : (
                      <>
                        {label(detail.evidenceRequest.status)}；所选区间{' '}
                        {detail.evidenceRequest.from}–{detail.evidenceRequest.to}，已核验至{' '}
                        {detail.evidenceRequest.head}。完成区间不表示完整任务历史。
                      </>
                    )}
                  </p>
                  <p>
                    {detail.evidenceRequest.plan?.reason ??
                      '旧申请未保存目标定位计划；扫描状态不能证明已补齐。'}
                  </p>
                  <p>
                    查证结果：
                    {detail.evidenceRequest.outcome
                      ? detail.evidenceRequest.outcome.state === 'PENDING'
                        ? '尚待扫描及新结果发布'
                        : label(detail.evidenceRequest.outcome.state)
                      : '旧申请未保存查证结果'}
                  </p>
                  {detail.evidenceRequest.outcome?.afterSnapshot && (
                    <>
                      <p>
                        新增相关证据：{detail.evidenceRequest.outcome.newEvidenceIds.length}；结论
                        {detail.evidenceRequest.outcome.conclusionChanged
                          ? '发生变化'
                          : '未发生变化'}
                        。当前固定快照未变。
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
                        打开补证后的固定快照
                      </button>
                    </>
                  )}
                </>
              ) : (
                <p>
                  当前没有该任务补证请求。每轮最多 2000 区块、总请求最多 200000
                  区块；同任务一小时最多一个新请求。
                </p>
              )}
              <button
                disabled={detail.evidenceRequest?.status === 'PENDING'}
                onClick={() =>
                  void api<{ message: string }>(
                    `/v1/jobs/${registry.chainId}/${registry.adapter}/${detail.job.jobId}/evidence-requests`,
                    'POST',
                  )
                    .then((r) => setNotice(r.message))
                    .catch(setError)
                }
              >
                申请本任务有界补证
              </button>
              <p className="quiet">补证以申请时最新已采集快照为基线；不会自动更换当前结果。</p>
              <button
                onClick={() =>
                  void api<Detail>(
                    `/v1/jobs/${registry.chainId}/${registry.adapter}/${detail.job.jobId}?snapshotRunId=${detail.snapshotRunId}`,
                  )
                    .then(setDetail)
                    .catch(setError)
                }
              >
                查询补证队列状态
              </button>
            </section>
            <details className="advanced" open={showEvidence}>
              <summary
                onClick={(e) => {
                  e.preventDefault();
                  setShowEvidence(!showEvidence);
                }}
              >
                证据与高级信息
              </summary>
              <h3>来源、覆盖与回放</h3>
              <div className="coverage">
                {Object.entries(detail.job.coverage).map(([k, v]) => (
                  <span className={'badge ' + semantics(value(v) ?? v.state)} key={k}>
                    {label(k)}：{label(value(v) ?? v.state)}
                  </span>
                ))}
              </div>
              <p>
                来源：持久存储回放；未经校准概率评估。规则版本 {detail.ruleVersion}
                。完整当前状态不表示完整历史；存储回放不表示实时在线核验。
              </p>
              <button onClick={() => setShowEvidence(true)}>查看原始证据</button>
              <details>
                <summary>查看原始状态</summary>
                <pre>{JSON.stringify(value(detail.rawState), null, 2)}</pre>
              </details>
              {detail.evidence.map((e) => (
                <details
                  id={'evidence-' + e.id}
                  key={e.id}
                  open={selectedEvidenceIds.includes(e.id)}
                >
                  <summary>证据 {e.id}</summary>
                  <p>
                    来源：{e.sourceAlias} · 摘要：{e.payloadHash}
                  </p>
                  <pre>{JSON.stringify(e.safePayload, null, 2)}</pre>
                </details>
              ))}
            </details>
          </>
        )}
        {coverage && (
          <details open className="advanced">
            <summary>数据覆盖与运行状态</summary>
            <p>完整当前状态不表示完整历史；存储回放不表示实时在线核验。</p>
            <pre>{JSON.stringify(coverage, null, 2)}</pre>
          </details>
        )}
        <footer>
          <p>
            仅支持已登记部署。局部结算事实可查询；正式取证模式仍依覆盖关闭。本组件独立提供数据，不表示
            Arc 官方认证、资助已获批或上游已采用。
          </p>
          {registry && (
            <nav>
              <a href={registry.navigation.sourceRepository} target="_blank" rel="noreferrer">
                部署分支公开源码
              </a>
              <a
                href="/consumer"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/consumer');
                }}
              >
                开发者：结算卡集成演示
              </a>
            </nav>
          )}
          <details>
            <summary>English overview（英文简介）</summary>
            <p>
              Arc Task Ledger is a read-only ArcBounty settlement viewer. Enter a supported task or
              address, inspect observed rewards and fees, verify task-specific obligations, and
              share a fixed-snapshot report. It reads Arc mainnet receipts and versioned PostgreSQL
              projections. Partial history remains explicit; no wallet connection or signing is
              required.
            </p>
          </details>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
