import { useLanguage } from './i18n.js';
import { useEffect, useState } from 'react';
import { api, label, money, value, taskPath, type Page, type Registry, type Row } from './model.js';
type DashboardData = Pick<Page, 'snapshotRunId' | 'snapshot' | 'items'> & {
  ruleVersion: string;
  scope: string;
  truncated: boolean;
  totalExpected: string;
  coverage: Record<
    string,
    {
      state: string;
      value?: string;
    }
  >;
};
type Observation = {
  snapshot: Page['snapshot'];
  evidence: unknown[];
  blockTimestamp?: string;
};
type LiveData = {
  chain: {
    state: string;
    checkedAt?: string;
    observation: Observation | null;
    lastSuccessfulObservation: Observation | null;
    reason: string;
  };
  latestStored: {
    id: string;
    snapshot: Page['snapshot'];
    expiresAt: string;
  } | null;
};
export function LineIcon({ kind = 0 }: { kind?: number }) {
  const paths = [
    'M12 3 21 8v9l-9 5-9-5V8l9-5Zm0 10v9M3 8l9 5 9-5M12 3v10',
    'M4 7h16v14H4zM8 7V3h8v4M4 12h16M9 16h6',
    'M3 18V9h4v9M10 18V5h4v13M17 18V2h4v16M2 22h20',
    'M12 2 21 6v7c0 5-9 9-9 9s-9-4-9-9V6l9-4Zm-4 9 3 3 5-6',
    'M4 5h16v14H4zM4 9h16M8 2v6M16 2v6M8 13h3M8 16h7',
    'M10 8 6 4l-4 4 4 4M14 16l4 4 4-4-4-4M6 4v11h8M18 20V9h-8',
  ];
  return (
    <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[kind % paths.length]} />
    </svg>
  );
}
function downloadObservation(data: LiveData) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Arc_实时区块观察_未归档.json';
  link.click();
  URL.revokeObjectURL(url);
}
export function LiveStrip({
  runId,
  onLatest,
  compact = false,
}: {
  runId?: string | undefined;
  onLatest: () => void;
  compact?: boolean;
}) {
  const { localize, locale } = useLanguage();
  const [data, setData] = useState<LiveData>();
  const [automatic, setAutomatic] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let active = false;
    async function refresh() {
      if (active || (document.hidden && automatic)) return;
      active = true;
      try {
        const result = await api<LiveData>('/v1/live');
        if (!cancelled) {
          setData(result);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        active = false;
      }
    }
    void refresh();
    const interval = automatic ? setInterval(() => void refresh(), 30000) : undefined;
    const visible = () => {
      if (automatic && !document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [automatic, tick]);
  const observation = data?.chain.observation;
  const outdated = !!data?.chain.checkedAt && clock - Date.parse(data.chain.checkedAt) > 90000;
  const old =
    data?.chain.lastSuccessfulObservation ?? (failed || outdated ? observation : undefined);
  const fresh = !failed && !outdated && data?.chain.state === 'fresh' && !!observation;
  return (
    <section
      className={'live-strip no-print' + (compact ? ' live-compact' : '')}
      aria-label={localize('实时链状态')}
      title={localize('实时观察未归档，不用于正式取证；资金事实沿用固定快照。')}
    >
      <div className="live-title">
        <span className={'signal-dot ' + (fresh ? 'online' : 'offline')} />
        <strong>{localize('实时链观察')}</strong>
        <span className="quiet">{localize(automatic ? '30 秒刷新' : '已暂停自动刷新')}</span>
      </div>
      <div className="live-value">
        <span>{localize('来源声明的最终区块')}</span>
        <strong>
          {localize(
            fresh
              ? observation.snapshot.blockNumber
              : data?.chain.state === 'conflict'
                ? '来源冲突'
                : outdated || data?.chain.state === 'stale'
                  ? '观察已陈旧'
                  : failed || data
                    ? '暂不可用'
                    : '读取中…',
          )}
        </strong>
      </div>
      <div className="live-provenance">
        <small>
          {localize(
            fresh
              ? observation.snapshot.sourceSet.join(' · ')
              : old
                ? '上次成功区块 ' + old.snapshot.blockNumber + '（非当前值）'
                : '不以零替代缺失值',
          )}
        </small>
        <small>
          {localize(
            data?.chain.checkedAt
              ? new Date(data.chain.checkedAt).toLocaleString(locale)
              : '等待来源响应',
          )}
          {localize(' ')}
          {localize('· 单来源 · 未归档')}
        </small>
        {localize(
          fresh && observation.blockTimestamp && (
            <small>
              {localize('区块时间：')}
              {localize(new Date(observation.blockTimestamp).toLocaleString(locale))}
            </small>
          ),
        )}
      </div>
      <div className="live-actions">
        <button onClick={() => setAutomatic(!automatic)}>
          {localize(automatic ? '暂停实时刷新' : '开启实时刷新')}
        </button>
        <button onClick={() => setTick(tick + 1)}>{localize('刷新链观察')}</button>
        {localize(
          data && (
            <button onClick={() => downloadObservation(data)}>{localize('下载原始观察')}</button>
          ),
        )}
      </div>
      {localize(
        data?.latestStored && runId && data.latestStored.id !== runId && (
          <div className="snapshot-update">
            <span>{localize('已有更新的资金快照；当前页面保持固定。')}</span>
            <button onClick={onLatest}>{localize('查看最新快照')}</button>
          </div>
        ),
      )}
      <p className="live-boundary">
        {localize(
          '实时区块不代表任务资金实时到账。资金事实沿用持久快照；此观察未写入证据库，不能用于正式取证。',
        )}
      </p>
    </section>
  );
}
const coverageNames: Record<string, string> = {
  currentState: '当前状态',
  jobEnumeration: '任务枚举',
  lifecycleHistory: '生命周期历史',
  settlementHistory: '结算历史',
  accountPendingHistory: '账户待领取历史',
  deploymentVerification: '部署核验',
  sourceAgreement: '多来源一致性',
};
function grouping(items: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const row of items) {
    const key = value(row.cashState) ?? row.cashState.state.toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([state, rows]) => ({ state, rows }));
}
export function Dashboard({
  runId,
  registry,
  onNavigate,
}: {
  runId: string;
  registry: Registry;
  onNavigate: (url: string) => void;
}) {
  const { localize, locale } = useLanguage();
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<DashboardData>('/v1/dashboard?snapshotRunId=' + encodeURIComponent(runId))
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);
  if (error)
    return (
      <section role="status">{localize('固定快照总览暂不可用；下方任务查询仍可使用。')}</section>
    );
  if (!data || data.snapshotRunId !== runId)
    return <section role="status">{localize('正在读取固定快照总览…')}</section>;
  const groups = grouping(data.items);
  const total = data.items.length;
  const chartRows = data.items.slice(0, 12);
  const atoms = chartRows.map((row) => {
    const reward = value(row.reward);
    return reward ? value(reward.atomic) : undefined;
  });
  const max = atoms.reduce((m, a) => (a !== undefined && BigInt(a) > m ? BigInt(a) : m), 0n);
  const heights = atoms.map((a) =>
    a === undefined || max === 0n ? 0 : Number((BigInt(a) * 16000n) / max) / 100,
  );
  const segments = groups.map((g, i) => {
    const preceding = groups.slice(0, i).reduce((s, v) => s + v.rows.length, 0);
    return {
      ...g,
      from: total ? preceding / total : 0,
      portion: total ? g.rows.length / total : 0,
    };
  });
  return (
    <div className="neon-dashboard" aria-label={localize('固定快照事实总览')}>
      <section className="neon-hero">
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">{localize('链上任务 / 固定快照事实')}</p>
            <h2>{localize('证据驱动，逐笔可查。')}</h2>
          </div>
          <span className="snapshot-chip">
            {localize('只读观察 · ')}
            {localize(data.snapshot.sourceSet.length)}
            {localize(' 个来源')}
          </span>
        </div>
        <div className="hero-number">
          <span>{localize('已展示任务')}</span>
          <strong>
            {localize(total.toLocaleString(locale))}
            <small>{localize(' 项')}</small>
          </strong>
          <p>
            {localize('截至区块')}
            {localize(data.snapshot.blockNumber)} ·{localize(' ')}
            {localize(data.truncated ? '前 100 项观察子集' : '本快照已采集任务')}
          </p>
          <p>
            {localize('资金快照时间：')}
            {localize(
              new Date(data.snapshot.observedAt).toLocaleString(locale, {
                timeZone: 'Asia/Singapore',
              }),
            )}
            {localize('（新加坡时间）')}
          </p>
        </div>
        <div className="state-stream">
          <div className="stream-labels">
            {localize(
              groups.map((g, i) => (
                <button
                  key={g.state}
                  onClick={() => onNavigate('/?snapshotRunId=' + runId + ('&cashState=' + g.state))}
                >
                  <LineIcon kind={i} />
                  <span>
                    {localize(label(g.state))}
                    <strong>
                      {localize(g.rows.length)}
                      {localize(' 项')}
                    </strong>
                  </span>
                </button>
              )),
            )}
          </div>
          <svg className="stream-svg" viewBox="0 0 700 340" aria-hidden="true">
            <defs>
              <linearGradient id="stream-ink">
                <stop stopColor="#466317" />
                <stop offset=".55" stopColor="#b8f23d" />
                <stop offset="1" stopColor="#87b928" />
              </linearGradient>
            </defs>
            {localize(
              groups.map((g, i) =>
                Array.from({ length: 11 }, (_, j) => (
                  <path
                    key={g.state + j}
                    className="stream-strand"
                    style={{ animationDelay: `${i * 0.2 + j * 0.1}s` }}
                    d={`M0 ${32 + i * 42 + j * 4} C200 ${10 + i * 44 - j * 14},250 ${290 - i * 32 + j * 5},460 ${170 + (i - groups.length / 2) * 9 + j * 4}`}
                  />
                )),
              ),
            )}
            {localize([104, 118, 130].map((r) => <circle key={r} cx="554" cy="170" r={r} />))}
            <circle className="orbit-dash" cx="554" cy="170" r="118" />
            <text x="554" y="145" className="ring-label">
              {localize('任务状态分布')}
            </text>
            <text x="554" y="194" className="ring-value">
              {localize(total)}
            </text>
            <text x="554" y="220" className="ring-label">
              {localize('项 · 分类数量')}
            </text>
          </svg>
        </div>
        <p className="dashboard-scope">
          {localize(data.scope)}
          {localize(' 流线仅表达任务分类，不代表转账路径或金额。')}
        </p>
      </section>
      <div className="dashboard-grid">
        <section className="reward-chart">
          <div className="panel-title">
            <h3>{localize('任务约定报酬')}</h3>
            <span>
              {localize('USDC · 前 ')}
              {localize(chartRows.length)}
              {localize(' 项')}
            </span>
          </div>
          <svg
            viewBox="0 0 640 240"
            role="img"
            aria-label={localize('前十二项任务约定报酬比较，不代表实际到账')}
          >
            <defs>
              <linearGradient id="reward-fill" x2="0" y2="1">
                <stop stopColor="#b9f23b" />
                <stop offset="1" stopColor="#355313" />
              </linearGradient>
            </defs>
            {localize(
              [30, 70, 110, 150, 190].map((y) => (
                <line key={y} x1="24" x2="625" y1={y} y2={y} className="chart-grid" />
              )),
            )}
            {localize(
              chartRows.map((row, i) => (
                <g
                  key={row.jobId}
                  onClick={() => onNavigate(taskPath(registry, row.jobId, runId))}
                  role="link"
                  tabIndex={0}
                  aria-label={localize(
                    `任务 ${row.jobId}，约定报酬 ${value(row.reward) ? money(value(row.reward)!) : '未知：暂无法核验'}`,
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onNavigate(taskPath(registry, row.jobId, runId));
                  }}
                >
                  <title>
                    {localize('任务 #')}
                    {localize(row.jobId)} ·{localize(' ')}
                    {localize(value(row.reward) ? money(value(row.reward)!) : '未知：暂无法核验')}
                  </title>
                  <rect
                    x={32 + (i * 590) / Math.max(chartRows.length, 1)}
                    y={190 - heights[i]!}
                    width={Math.min(30, 430 / Math.max(chartRows.length, 1))}
                    height={heights[i]}
                    fill="url(#reward-fill)"
                  />
                  <text x={38 + (i * 590) / Math.max(chartRows.length, 1)} y="216">
                    #{localize(row.jobId)}
                  </text>
                  {localize(
                    atoms[i] === undefined && (
                      <text x={38 + (i * 590) / Math.max(chartRows.length, 1)} y="184">
                        {localize('未知')}
                      </text>
                    ),
                  )}
                </g>
              )),
            )}
            {localize(
              heights.map((h, i) =>
                i === 0 || atoms[i] === undefined || atoms[i - 1] === undefined ? null : (
                  <line
                    key={i}
                    x1={47 + ((i - 1) * 590) / Math.max(chartRows.length, 1)}
                    y1={190 - heights[i - 1]!}
                    x2={47 + (i * 590) / Math.max(chartRows.length, 1)}
                    y2={190 - h}
                    className="reward-line"
                  />
                ),
              ),
            )}
            {localize(
              heights.map((h, i) =>
                atoms[i] === undefined ? null : (
                  <circle
                    key={i}
                    cx={47 + (i * 590) / Math.max(chartRows.length, 1)}
                    cy={190 - h}
                    r="3"
                    className="reward-dot"
                  />
                ),
              ),
            )}
          </svg>
          <p className="quiet">
            {localize(
              '按任务编号排序；悬停或键盘聚焦查看精确报酬，点击回放任务。折线用于比较，不是时间趋势或收入预测。',
            )}
          </p>
        </section>
        <div className="dashboard-kpis">
          {localize(
            [
              [
                '已确认直接转账',
                data.items.filter((r) => value(r.cashState) === 'CONFIRMED_DIRECT').length,
                '项任务 · 以逐笔证据为准',
                5,
              ],
              [
                '仍待补足资金证据',
                data.items.filter(
                  (r) =>
                    r.cashState.state !== 'known' ||
                    ['UNKNOWN', 'NONE_OBSERVED', 'PARTIAL'].includes(value(r.cashState) ?? ''),
                ).length,
                '项任务 · 缺失值不归零',
                3,
              ],
              ['链上来源', data.snapshot.sourceSet.length, '个来源 · 不表示来源一致性已完成', 0],
            ].map(([title, number, note, icon]) => (
              <section key={String(title)}>
                <div>
                  <span>{localize(title)}</span>
                  <strong>{localize(number)}</strong>
                  <small>{localize(note)}</small>
                </div>
                <LineIcon kind={Number(icon)} />
              </section>
            )),
          )}
        </div>
        <section className="observed-tasks">
          <div className="panel-title">
            <h3>{localize('逐项事实回放')}</h3>
            <span>{localize('固定快照 · 前 5 项')}</span>
          </div>
          {localize(
            data.items.slice(0, 5).map((row, i) => (
              <button
                key={row.jobId}
                onClick={() => onNavigate(taskPath(registry, row.jobId, runId))}
              >
                <LineIcon kind={i} />
                <span>
                  {localize('任务 #')}
                  {localize(row.jobId)}
                  <small>
                    {localize(label(value(row.lifecycle) ?? row.lifecycle.state))} ·{localize(' ')}
                    {localize(label(value(row.cashState) ?? row.cashState.state))}
                  </small>
                </span>
                <strong>
                  {localize(value(row.reward) ? money(value(row.reward)!) : '未知：暂无法核验')}
                  <small>{localize('约定报酬')}</small>
                </strong>
              </button>
            )),
          )}
        </section>
        <section>
          <div className="panel-title">
            <h3>{localize('资金证据状态占比')}</h3>
            <span>{localize('任务数量口径')}</span>
          </div>
          <div className="distribution">
            <svg
              viewBox="0 0 220 220"
              role="img"
              aria-label={localize('已展示任务的资金证据状态占比')}
            >
              <circle className="donut-track" cx="110" cy="110" r="77" />
              {localize(
                segments.map((g, i) => (
                  <circle
                    key={g.state}
                    cx="110"
                    cy="110"
                    r="77"
                    pathLength="1"
                    strokeDasharray={`${g.portion} ${1 - g.portion}`}
                    strokeDashoffset={-g.from}
                    transform="rotate(-90 110 110)"
                    style={{ stroke: `hsl(78 72% ${58 - i * 6}%)` }}
                  >
                    <title>
                      {localize(label(g.state))}：{localize(g.rows.length)}
                      {localize(' 项')}
                    </title>
                  </circle>
                )),
              )}
              <text x="110" y="103" className="ring-label">
                {localize('已展示')}
              </text>
              <text x="110" y="136" className="ring-value">
                {localize(total)}
              </text>
            </svg>
            <ul>
              {localize(
                segments.map((g, i) => (
                  <li key={g.state}>
                    <i style={{ background: `hsl(78 72% ${58 - i * 6}%)` }} />
                    <span>{localize(label(g.state))}</span>
                    <strong>
                      {localize(g.rows.length)}
                      {localize(' 项')}
                    </strong>
                  </li>
                )),
              )}
            </ul>
          </div>
          <p className="quiet">{localize('只比较已展示任务，不能外推全链比例或现金实现率。')}</p>
        </section>
        <section className="coverage-dashboard">
          <div className="panel-title">
            <h3>{localize('核验覆盖')}</h3>
            <span>{localize('证据覆盖不等于概率')}</span>
          </div>
          {localize(
            Object.entries(data.coverage).map(([key, result]) => (
              <div className="coverage-track" key={key}>
                <span>{localize(coverageNames[key] ?? key)}</span>
                <strong className={result.value === 'complete' ? 'complete' : 'incomplete'}>
                  {localize(label(result.value ?? result.state))}
                </strong>
                <div className={'coverage-visual ' + (result.value ?? result.state)}>
                  <i />
                </div>
              </div>
            )),
          )}
          <small>{localize('实线为完整、条纹为部分、空线为未知；不显示未经计算的百分比。')}</small>
        </section>
        <section className="snapshot-ledger">
          <div className="panel-title">
            <h3>{localize('观察边界与溯源')}</h3>
            <LineIcon kind={3} />
          </div>
          <dl>
            <dt>{localize('事实时间')}</dt>
            <dd>{localize(new Date(data.snapshot.observedAt).toLocaleString(locale))}</dd>
            <dt>{localize('快照区块')}</dt>
            <dd>{localize(data.snapshot.blockNumber)}</dd>
            <dt>{localize('区块摘要')}</dt>
            <dd>{localize(data.snapshot.blockHash)}</dd>
            <dt>{localize('规则版本')}</dt>
            <dd>{localize(data.ruleVersion)}</dd>
            <dt>{localize('来源集合')}</dt>
            <dd>{localize(data.snapshot.sourceSet.join(' · '))}</dd>
            <dt>{localize('回放快照')}</dt>
            <dd>{localize(runId)}</dd>
          </dl>
          <p className="quiet">
            {localize(
              '历史覆盖不足时，总欠款和历史实现率保持未知。逐项进入任务可查看原始证据与结算解释。',
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
