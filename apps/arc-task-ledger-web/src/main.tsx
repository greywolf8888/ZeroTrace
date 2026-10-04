import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
type K<T> = { state: 'known'; value: T } | { state: string; reason: string };
interface Amount {
  atomic: K<string>;
  decimals: 18;
}
interface Row {
  jobKey: string;
  jobId: string;
  adapter: string;
  poster: string;
  worker: K<string>;
  reward: Amount;
  lifecycle: string;
  cashState: string;
  selfTake: boolean;
  freshness?: 'known' | 'stale';
  snapshot: {
    chainId: string;
    blockNumber: string;
    blockHash: string;
    observedAt: string;
    sourceSet?: string[];
  };
  coverage: Record<string, string>;
}
interface Page {
  snapshotRunId: string;
  snapshot?: Row['snapshot'];
  items: Row[];
  nextCursor: K<string>;
  freshness: { state: string; capturedAt: string };
  historyRange?: K<{
    fromBlock: string;
    targetBlock: string;
    contiguousThrough: string;
    status: string;
    omittedPriorHistory: boolean;
    gaps: { fromBlock: string; toBlock: string; reason: string }[];
  }>;
}
interface Detail {
  job: Row;
  rawState: Record<string, unknown>;
  settlementLegs: {
    id: string;
    role: string;
    kind: string;
    payee: string;
    observedAmount: Amount;
    parkedAmount: Amount;
    expectedAmount: Amount;
    attribution: string;
    evidenceIds: string[];
  }[];
  timeline: {
    id: string;
    name: string;
    blockNumber: string;
    transactionHash: string;
    args: Record<string, unknown>;
  }[];
  nextTimelineCursor: K<string>;
  evidence: { id: string; payloadHash: string; raw: unknown }[];
  pendingAccounts: { payee: string; balance: Amount; history: string }[];
  ruleVersion: string;
  snapshotRunId: string;
  gas: { transactionHash: string; amount: Amount }[];
}
const labels: Record<string, string> = {
  NOT_APPLICABLE: '零分配，无应付义务',
  ZERO_ALLOCATION: '已核验零分配',
  OPEN: '待接单',
  TAKEN: '已接单',
  SUBMITTED: '已提交',
  REJECTION_PENDING: '拒绝待处理',
  DISPUTED: '争议中',
  TERMINAL_UNKNOWN: '任务已结束，路径待核验',
  APPROVED: '已批准',
  CANCELLED: '已取消',
  EXPIRED: '已执行到期',
  REJECTED: '已拒绝',
  DISPUTE_WORKER: '裁定工作者胜',
  DISPUTE_POSTER: '裁定发布者胜',
  TIMEOUT_SPLIT: '仲裁超时分账',
  EXTERNAL_REFUND_RECONCILED: '外部退款已协调',
  CONFIRMED_DIRECT: '已核验直接转移',
  PARKED: '曾转入待领取',
  PARTIAL: '部分直接转移，部分待领取',
  UNKNOWN: '暂无法核验',
  CONFLICT: '证据冲突',
  NONE_OBSERVED: '未观察到任务付款',
  VERIFIED_SEQUENCE_DERIVED: '完整账户序列推导已领取',
  WORKER: '工作者',
  POSTER: '发布者',
  PROTOCOL: '协议费用',
  ADAPTER: '任务适配器',
  ESCROW: '托管合约',
  DEPOSIT: '奖励存入',
  ESCROW_TRANSIT: '托管中转',
  BOND_DEPOSIT: '保证金存入',
  REWARD: '奖励',
  FEE: '费用',
  REFUND: '退款',
  BOND_RETURN: '保证金退回',
  BOND_FORFEIT: '保证金没收',
  TIMEOUT_SHARE: '超时份额',
  DIRECT: '唯一直接转移',
  UNIQUE_EVENT_SEGMENT: '唯一事件段',
  ACCOUNT_ONLY: '仅账户级',
  AMBIGUOUS: '归属有歧义',
  complete: '完整',
  partial: '不完整',
  unknown: '未知',
  conflict: '冲突',
  currentState: '当前状态',
  jobEnumeration: '任务枚举',
  lifecycleHistory: '生命周期历史',
  settlementHistory: '结算历史',
  accountPendingHistory: '待领取历史',
  deploymentVerification: '部署核验',
  sourceAgreement: '来源一致性',
  BountyCreated: '创建任务',
  BountyTaken: '接单',
  WorkSubmitted: '提交工作',
  BountyCompleted: '任务完成事件',
  BountyAutoApproved: '自动批准',
  BountyCancelled: '取消任务',
  BountyExpired: '执行到期',
  ProtocolFeePaid: '费用分配声明',
  PayoutParked: '转入待领取',
  WithdrawalClaimed: '账户提现',
  WorkerBondPosted: '保证金存入事件',
  WorkerBondRefunded: '保证金退回声明',
  WorkerBondForfeited: '保证金没收声明',
  ArbitratorTimeoutClaimed: '仲裁超时分账',
  ExternalRefundReconciled: '外部退款协调',
  RejectionProposed: '提出拒绝',
  RejectionFinalized: '拒绝生效',
  RejectionChallenged: '拒绝被挑战',
  RejectionWithdrawn: '撤回拒绝',
  DisputeRaised: '发起争议',
  DisputeResponded: '回应争议',
  DisputeResolved: '争议裁决',
};
function text(value: string) {
  return labels[value] ?? `协议字段：${value}`;
}
function knownValue<T>(value: K<T>): T | undefined {
  return value.state === 'known' && 'value' in value ? value.value : undefined;
}
function money(value: Amount) {
  const atoms = knownValue(value.atomic);
  if (atoms === undefined) return '暂无法核验';
  const n = BigInt(atoms);
  const fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${n / 10n ** 18n}${fraction ? '.' + fraction : ''} USDC`;
}
function normalizeRow(wire: Record<string, unknown>): Row {
  const coverage = Object.fromEntries(
    Object.entries(wire.coverage as Record<string, K<string>>).map(([key, k]) => [
      key,
      knownValue(k) ?? k.state,
    ]),
  );
  const cash = wire.cashState as K<string>;
  return {
    ...wire,
    poster: knownValue(wire.poster as K<string>) ?? '',
    reward: knownValue(wire.reward as K<Amount>) ?? {
      atomic: { state: 'unknown', reason: '面值未核验' },
      decimals: 18,
    },
    lifecycle: knownValue(wire.lifecycle as K<string>) ?? 'TERMINAL_UNKNOWN',
    cashState: knownValue(cash) ?? (cash.state === 'conflict' ? 'CONFLICT' : 'UNKNOWN'),
    coverage,
  } as unknown as Row;
}
async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`, { signal: AbortSignal.timeout(10000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? '读取失败，请检查服务。');
  if (Array.isArray(body.items)) body.items = body.items.map(normalizeRow);
  if ('nextCursor' in body)
    body.nextCursor = body.nextCursor
      ? { state: 'known', value: body.nextCursor }
      : { state: 'unknown', reason: '末页' };
  if (body.job) {
    body.job = normalizeRow(body.job);
    body.rawState = knownValue(body.rawState) ?? {};
    body.nextTimelineCursor = body.nextTimelineCursor
      ? { state: 'known', value: body.nextTimelineCursor }
      : { state: 'unknown', reason: '末页' };
    body.evidence = body.evidence.map((e: Record<string, unknown>) => ({
      ...e,
      raw: e.safePayload,
    }));
    body.settlementLegs = body.settlementLegs.map((leg: Record<string, unknown>) => ({
      ...leg,
      observedAmount: knownValue(leg.observedAmount as K<Amount>) ?? {
        atomic: leg.observedAmount,
        decimals: 18,
      },
      parkedAmount: knownValue(leg.parkedAmount as K<Amount>) ?? {
        atomic: leg.parkedAmount,
        decimals: 18,
      },
    }));
  }
  return body as T;
}
function Address({ value }: { value: string }) {
  return (
    <button
      className="address"
      title={`复制链上地址 ${value}`}
      onClick={() => void navigator.clipboard.writeText(value)}
    >
      {value.slice(0, 8)}…{value.slice(-6)}
    </button>
  );
}
function Coverage({ coverage }: { coverage: Record<string, string> }) {
  return (
    <div className="coverage">
      {Object.entries(coverage).map(([key, value]) => (
        <span key={key} className={`badge ${value}`}>
          {text(key)}：{text(value)}
        </span>
      ))}
    </div>
  );
}
function App() {
  const [page, setPage] = useState<Page>();
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [address, setAddress] = useState('');
  const [coverage, setCoverage] = useState<Record<string, unknown>>();
  const [showCoverage, setShowCoverage] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  async function load(query = '', cursor?: string) {
    setLoading(true);
    setError('');
    try {
      setPage(
        await get<Page>(
          `/v1/jobs?limit=10${query ? '&address=' + encodeURIComponent(query) : ''}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
        ),
      );
      setDetail(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败。');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    get<Page>('/v1/jobs?limit=10')
      .then((p) => {
        if (!cancelled) setPage(p);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function open(row: Row) {
    setLoading(true);
    setError('');
    try {
      setDetail(
        await get<Detail>(
          `/v1/jobs/5042/${row.adapter}/${row.jobId}?snapshotRunId=${page!.snapshotRunId}`,
        ),
      );
      setShowEvidence(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '详情读取失败。');
    } finally {
      setLoading(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    setAddress(filter);
    void load(filter);
  }
  const next = page ? knownValue(page.nextCursor) : undefined;
  return (
    <>
      <header>
        <div className="brand">
          <span className="mark">◈</span>
          <div>
            <h1>Arc 任务证据台</h1>
            <p>只读任务历史 · 结算事实 · 可回放证据</p>
          </div>
        </div>
        <span className="network">Arc 主网 · 5042</span>
      </header>
      <main>
        <div className="notice">
          业务完成事件与真实资金到账分别核验。奖励、费用、保证金及账户待领取保持独立。
        </div>
        <div className="toolbar">
          <button onClick={() => void load(address)}>刷新快照</button>
          <button
            onClick={() => {
              setShowCoverage(!showCoverage);
              if (!showCoverage)
                get<Record<string, unknown>>('/v1/coverage')
                  .then(setCoverage)
                  .catch((e) => setError(e.message));
            }}
          >
            查看覆盖与来源
          </button>
          <span>
            {page
              ? `存储回放 · 截至区块 ${page.snapshot?.blockNumber ?? page.items[0]?.snapshot.blockNumber ?? '当前范围为空'} · ${page.freshness.state === 'provider-down' ? '来源当前不可用' : page.freshness.state === 'stale' ? '快照已陈旧' : '显示采集时状态'}`
              : '尚无可用快照'}
          </span>
        </div>
        {page && (
          <section aria-label="连续历史范围">
            <h2>连续历史范围</h2>
            {page.historyRange && knownValue(page.historyRange) ? (
              (() => {
                const range = knownValue(page.historyRange)!;
                return (
                  <>
                    <p>
                      声明窗口：区块 {range.fromBlock}–{range.targetBlock}；连续核验至{' '}
                      {range.contiguousThrough}；{text(range.status)}。
                    </p>
                    {range.omittedPriorHistory && (
                      <p>窗口之前的历史未覆盖，不能据此认定旧任务资金为零或完整清偿。</p>
                    )}
                    {range.gaps.map((gap) => (
                      <p key={gap.fromBlock}>
                        未核验区间 {gap.fromBlock}–{gap.toBlock}：{gap.reason}
                      </p>
                    ))}
                  </>
                );
              })()
            ) : (
              <p>此快照尚未声明连续历史范围；定点证据不能代表全历史。</p>
            )}
          </section>
        )}
        {showCoverage && (
          <section>
            <h2>数据覆盖与运行状态</h2>
            {page && <Coverage coverage={page.items[0]?.coverage ?? {}} />}
            <pre>{JSON.stringify(coverage, null, 2)}</pre>
            <p>完整当前状态不表示完整历史；存储回放不表示实时在线核验。</p>
          </section>
        )}
        {error && (
          <div role="alert" className="error">
            <strong>数据暂不可用</strong>
            <p>{error}</p>
            <p>请检查数据库与采集记录，再重试；缺失值不会显示为零。</p>
          </div>
        )}
        {loading && <p role="status">正在读取持久快照…</p>}
        {!detail ? (
          <>
            <div className="heading">
              <h2>任务列表</h2>
              <form onSubmit={submit}>
                <label htmlFor="filter">角色地址筛选</label>
                <input
                  id="filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="0x…"
                />
                <button>查询</button>
              </form>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>发布者 / 工作者</th>
                    <th>奖励面值</th>
                    <th>业务状态</th>
                    <th>现金状态</th>
                  </tr>
                </thead>
                <tbody>
                  {page?.items.map((row) => (
                    <tr key={row.jobKey}>
                      <td>
                        <button className="job-link" onClick={() => void open(row)}>
                          任务 #{row.jobId}
                        </button>
                        {row.selfTake && <small>自行接单标记</small>}
                        {row.freshness === 'stale' && <small>旧快照，当前状态未刷新</small>}
                      </td>
                      <td>
                        <Address value={row.poster} />
                        <br />
                        {knownValue(row.worker) ? (
                          <Address value={knownValue(row.worker)!} />
                        ) : (
                          <span>尚未指定</span>
                        )}
                      </td>
                      <td>{money(row.reward)}</td>
                      <td>{text(row.lifecycle)}</td>
                      <td>
                        <span className="badge partial">{text(row.cashState)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {page && page.items.length === 0 && (
              <p>当前快照与筛选范围内没有记录。该结果仅适用于已声明的覆盖范围。</p>
            )}
            <button disabled={!next || loading} onClick={() => void load(address, next)}>
              下一页
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setDetail(undefined)}>← 返回任务列表</button>
            <div className="heading">
              <h2>任务 #{detail.job.jobId}</h2>
              <a
                className="button"
                href={`/api/v1/jobs/5042/${detail.job.adapter}/${detail.job.jobId}?snapshotRunId=${detail.snapshotRunId}&format=json`}
              >
                导出证据 JSON
              </a>
            </div>
            <p className="conclusion">
              {text(detail.job.lifecycle)}；{text(detail.job.cashState)}。
            </p>
            <Coverage coverage={detail.job.coverage} />
            <div className="grid">
              <section>
                <h3>合约状态快照</h3>
                <p>奖励面值：{money(detail.job.reward)}</p>
                <p>
                  发布者：
                  <Address value={detail.job.poster} />
                </p>
                <p>规则版本：{detail.ruleVersion}</p>
                <p>采集时间：{detail.job.snapshot.observedAt}</p>
                <details>
                  <summary>查看原始状态</summary>
                  <pre>{JSON.stringify(detail.rawState, null, 2)}</pre>
                </details>
              </section>
              <section>
                <h3>独立资金腿</h3>
                {detail.settlementLegs.length === 0 ? (
                  <p>当前历史不足，暂无法核验资金腿。</p>
                ) : (
                  detail.settlementLegs.map((leg) => (
                    <article key={leg.id}>
                      <strong>
                        {text(leg.role)} · {text(leg.kind)}
                      </strong>
                      <p>
                        应分配：{money(leg.expectedAmount)}
                        <br />
                        观察到转移：{money(leg.observedAmount)}
                        <br />
                        曾转入待领取：{money(leg.parkedAmount)}
                      </p>
                      <p>
                        {text(leg.attribution)} · <Address value={leg.payee} />
                      </p>
                    </article>
                  ))
                )}
              </section>
            </div>
            <section>
              <h3>账户级待领取</h3>
              <p>此处金额属于整个账户，不能在每个任务中重复汇总。</p>
              {detail.pendingAccounts.map((account) => (
                <p key={account.payee}>
                  <Address value={account.payee} /> {money(account.balance)} · 历史
                  {text(account.history)}
                </p>
              ))}
            </section>
            <section>
              <h3>链上事件时间线</h3>
              {detail.timeline.length === 0 ? (
                <p>尚未取得可核验历史事件。</p>
              ) : (
                detail.timeline.map((e) => (
                  <article key={e.id}>
                    <strong>{text(e.name)}</strong>
                    <p>区块 {e.blockNumber}</p>
                    <details>
                      <summary>交易与事件参数</summary>
                      <pre>{JSON.stringify(e, null, 2)}</pre>
                    </details>
                  </article>
                ))
              )}
              {knownValue(detail.nextTimelineCursor) && (
                <button
                  onClick={() =>
                    get<Detail>(
                      `/v1/jobs/5042/${detail.job.adapter}/${detail.job.jobId}?snapshotRunId=${detail.snapshotRunId}&timelineCursor=${encodeURIComponent(knownValue(detail.nextTimelineCursor)!)}`,
                    )
                      .then((d) =>
                        setDetail({ ...d, timeline: [...detail.timeline, ...d.timeline] }),
                      )
                      .catch((e) => setError(e.message))
                  }
                >
                  继续读取时间线
                </button>
              )}
            </section>
            <section>
              <h3>证据与回放</h3>
              <p>来源：持久存储回放；未经校准概率评估。Gas 单列，未从任务奖励扣除。</p>
              <button onClick={() => setShowEvidence(!showEvidence)}>查看原始证据</button>
              {showEvidence &&
                detail.evidence.map((e) => (
                  <details key={e.id}>
                    <summary>证据 {e.id}</summary>
                    <p>内容摘要 {e.payloadHash}</p>
                    <pre>{JSON.stringify(e.raw, null, 2)}</pre>
                  </details>
                ))}
            </section>
          </>
        )}
        <footer>
          {page?.items.some((r) => r.snapshot.sourceSet?.includes('test-only')) && (
            <p>本地测试样例，不是主网证据。</p>
          )}
          仅支持已登记部署。此组件独立提供数据，不表示 Arc 官方认证或 ArcBounty 已采用。
          <br />
          {page && `快照采集于 ${page.freshness.capturedAt}`}
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
