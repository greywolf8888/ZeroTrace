import { useState } from 'react';
import { SettlementCard } from './SettlementCard.js';
import { label, money, value, type Detail, type Registry } from './model.js';

/** 联动只读服务器投影；本组件不计算或匹配链上金额。 */
export function SettlementWorkbench({
  detail,
  registry,
  onEvidence,
  onTask,
}: {
  detail: Detail;
  registry: Registry;
  onEvidence: (ids: string[]) => void;
  onTask: (id: string) => void;
}) {
  const [selection, setSelection] = useState<{ kind: 'flow' | 'node' | 'metric'; id: string }>();
  const [role, setRole] = useState<'all' | 'WORKER' | 'POSTER'>('all');
  const [view, setView] = useState('结果');
  const flows = detail.result.flows;
  const flow = selection?.kind === 'flow' ? flows.find((f) => f.id === selection.id) : undefined;
  const metric =
    selection?.kind === 'metric'
      ? detail.result.metrics.find((m) => m.key === selection.id)
      : undefined;
  const addresses = [...new Set([registry.adapter, ...flows.flatMap((f) => [f.from, f.to])])];
  const nodes = addresses.map((address, i) => {
    const angle = ((i - 1) / Math.max(1, addresses.length - 1)) * Math.PI * 2 - Math.PI / 2;
    const roles = [
      ...new Set([
        ...(address === value(detail.job.poster) ? ['POSTER'] : []),
        ...(address === value(detail.job.worker) ? ['WORKER'] : []),
        ...flows.filter((f) => f.to === address).map((f) => f.role),
      ]),
    ];
    return {
      address,
      name:
        address === registry.adapter ? '任务适配器' : roles.map(label).join(' / ') || '链上地址',
      x: i === 0 ? 400 : 400 + Math.cos(angle) * 260,
      y: i === 0 ? 160 : 160 + Math.sin(angle) * 105,
    };
  });
  const supportIds =
    metric?.evidenceIds ??
    flow?.evidenceIds ??
    (selection?.kind === 'node'
      ? [
          ...new Set(
            flows
              .filter((f) => [f.from, f.to].includes(selection.id))
              .flatMap((f) => f.evidenceIds),
          ),
        ]
      : []);
  const selectedEvidence = detail.evidence.filter((e) => supportIds.includes(e.id));
  const phaseLabel = (phase: string) =>
    phase === 'DIRECT' ? '已观察转移' : phase === 'CLAIMED' ? '义务序列核验领取' : '待领取分配声明';
  const selectFlow = (id: string) => {
    setSelection({ kind: 'flow', id });
    setView('证据');
  };
  const transaction = (hash: string) =>
    registry.navigation.transactionOrigin + registry.navigation.transactionPathPrefix + hash;
  return (
    <div className="workbench" aria-label="任务资金与证据工作台">
      <aside className="workbench-navigation no-print" aria-label="任务导航">
        <span className="eyebrow">任务工作区</span>
        <h3>当前任务 #{detail.job.jobId}</h3>
        {detail.snapshotTasks && (
          <nav className="snapshot-tasks" aria-label="固定快照任务列表">
            <small>此快照前 20 个任务</small>
            {detail.snapshotTasks.map((task) => (
              <button
                key={task.jobId}
                aria-current={task.jobId === detail.job.jobId ? 'page' : undefined}
                onClick={() => onTask(task.jobId)}
              >
                任务 #{task.jobId}
                <small>{label(value(task.lifecycle) ?? 'TERMINAL_UNKNOWN')}</small>
              </button>
            ))}
          </nav>
        )}
        <p>{label(value(detail.job.lifecycle) ?? 'TERMINAL_UNKNOWN')}</p>
        <label>
          查看收款角色
          <select
            aria-label="查看收款角色"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="all">全部角色</option>
            <option value="WORKER">工作者</option>
            <option value="POSTER">发布者</option>
          </select>
        </label>
        <dl>
          <dt>固定快照</dt>
          <dd>{detail.snapshotRunId}</dd>
          <dt>链上位置</dt>
          <dd>区块 {detail.job.snapshot.blockNumber}</dd>
          <dt>数据来源</dt>
          <dd>{detail.job.snapshot.sourceSet.join('、')}</dd>
        </dl>
        <p className="quiet">关系表示本任务角色；不推断共同控制。中转、奖励、领取不重复合计。</p>
      </aside>
      <div className="workbench-center">
        <nav className="mobile-workbench-tabs no-print" aria-label="工作区视图">
          {['结果', '资金流', '证据'].map((tab) => (
            <button key={tab} aria-pressed={view === tab} onClick={() => setView(tab)}>
              {tab}
            </button>
          ))}
        </nav>
        <label className="mobile-role-select no-print">
          查看收款角色{' '}
          <select
            aria-label="手机收款角色"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="all">全部角色</option>
            <option value="WORKER">工作者</option>
            <option value="POSTER">发布者</option>
          </select>
        </label>
        <div className={'workbench-results ' + (view === '结果' ? 'mobile-active' : '')}>
          <SettlementCard
            result={detail.result}
            role={role}
            compact
            onEvidence={(ids, key) => {
              if (key) setSelection({ kind: 'metric', id: key });
              setView('证据');
              onEvidence(ids);
            }}
          />
        </div>
        <section
          className={'flow-panel ' + (view === '资金流' ? 'mobile-active' : '')}
          aria-label="本任务资金路径"
        >
          <div className="panel-heading">
            <h3>资金路径</h3>
            <span>{flows.length} 条已识别记录</span>
          </div>
          <p className="flow-legend">实线：已观察转移／序列核验领取 · 虚线：待领取分配声明</p>
          {!flows.length ? (
            <p>尚无足够证据绘制资金路径；缺失历史不会自动补线。</p>
          ) : (
            <>
              <svg
                className="flow-graph"
                viewBox="0 0 800 320"
                role="group"
                aria-label="选择资金边或地址查看依据"
              >
                <defs>
                  <marker
                    id="flow-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {flows.map((f) => {
                  const from = nodes.find((n) => n.address === f.from)!;
                  const to = nodes.find((n) => n.address === f.to)!;
                  const dx = to.x - from.x,
                    dy = to.y - from.y;
                  const length = Math.hypot(dx, dy) || 1;
                  const offset = Math.abs(dx) > Math.abs(dy) ? 52 : 0;
                  const mx = (from.x + to.x) / 2 - (dy / length) * offset,
                    my = (from.y + to.y) / 2 + (dx / length) * offset;
                  const inset = Math.min(70 / Math.abs(dx || 1), 25 / Math.abs(dy || 1));
                  const edgePath =
                    from.address === to.address
                      ? `M ${from.x + 70} ${from.y} C ${from.x + 135} ${from.y - 90} ${from.x + 50} ${from.y - 115} ${from.x} ${from.y - 25}`
                      : `M ${from.x + dx * inset} ${from.y + dy * inset} Q ${mx} ${my} ${to.x - dx * inset} ${to.y - dy * inset}`;
                  return (
                    <g
                      key={f.id}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        label(f.role) +
                        ' ' +
                        label(f.kind) +
                        ' ' +
                        phaseLabel(f.phase) +
                        ' ' +
                        money(f.amount)
                      }
                      aria-pressed={flow?.id === f.id}
                      data-flow-id={f.id}
                      onClick={() => selectFlow(f.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectFlow(f.id);
                        }
                      }}
                      className={
                        'flow-edge ' +
                        f.phase.toLowerCase() +
                        (flow?.id === f.id ? ' selected' : '')
                      }
                    >
                      <path d={edgePath} markerEnd="url(#flow-arrow)" />
                      <rect x={mx - 64} y={my - 25} width="128" height="50" rx="8" />
                      <text x={mx} y={my - 10} textAnchor="middle">
                        {label(f.kind)}
                      </text>
                      <text x={mx} y={my + 5} textAnchor="middle">
                        {money(f.amount)}
                      </text>
                      <text className="flow-phase" x={mx} y={my + 19} textAnchor="middle">
                        {phaseLabel(f.phase)}
                      </text>
                    </g>
                  );
                })}
                {nodes.map((n) => (
                  <g
                    key={n.address}
                    role="button"
                    tabIndex={0}
                    aria-label={'选择' + n.name + '地址 ' + n.address}
                    onClick={() => {
                      setSelection({ kind: 'node', id: n.address });
                      setView('证据');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelection({ kind: 'node', id: n.address });
                        setView('证据');
                      }
                    }}
                    className={'flow-node ' + (selection?.id === n.address ? 'selected' : '')}
                  >
                    <rect x={n.x - 70} y={n.y - 25} width="140" height="50" rx="9" />
                    <text x={n.x} y={n.y - 3} textAnchor="middle">
                      {n.name}
                    </text>
                    <text x={n.x} y={n.y + 14} textAnchor="middle" className="flow-address">
                      {n.address.slice(0, 6)}…{n.address.slice(-4)}
                    </text>
                  </g>
                ))}
              </svg>
              <details className="flow-table">
                <summary>资金路径表格（键盘可访问）</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>资金类型</th>
                        <th>金额与范围</th>
                        <th>方向</th>
                        <th>依据</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flows.map((f) => (
                        <tr key={f.id}>
                          <td>
                            {label(f.role)} · {label(f.kind)}
                          </td>
                          <td>
                            {money(f.amount)}
                            <small>{phaseLabel(f.phase)}</small>
                          </td>
                          <td>
                            {f.from}
                            <br />→ {f.to}
                          </td>
                          <td>
                            <button onClick={() => selectFlow(f.id)}>检查此记录</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </section>
      </div>
      <aside
        className={'workbench-inspector ' + (view === '证据' ? 'mobile-active' : '')}
        aria-label="资金记录检查器"
      >
        <span className="eyebrow">证据检查器</span>
        {metric ? (
          <>
            <h3>{metric.label}</h3>
            <strong className="inspector-amount">{money(metric.amount)}</strong>
            <p>
              {metric.qualifier === 'AT_LEAST'
                ? '已识别下限；其他历史未覆盖'
                : metric.phase === 'CLAIMED'
                  ? '仅具体义务核验领取'
                  : '仅所声明观察范围'}
            </p>
          </>
        ) : flow ? (
          <>
            <h3>
              {label(flow.role)} · {label(flow.kind)}
            </h3>
            <strong className="inspector-amount">{money(flow.amount)}</strong>
            <p>{phaseLabel(flow.phase)}</p>
            <dl>
              <dt>来自</dt>
              <dd>{flow.from}</dd>
              <dt>去向</dt>
              <dd>{flow.to}</dd>
            </dl>
            {flow.transactionHashes.map((hash) => (
              <a key={hash} href={transaction(hash)} target="_blank" rel="noreferrer">
                查看交易 {hash.slice(0, 10)}…
              </a>
            ))}
            <p>支持事件：{flow.eventIds.length || '当前时间线未包含；以回执为准'}</p>
          </>
        ) : selection?.kind === 'node' ? (
          <>
            <h3>选中地址</h3>
            <p>{selection.id}</p>
          </>
        ) : (
          <>
            <h3>选择一条资金记录</h3>
            <p>点击资金边、地址或金额证据，核对对应来源与原始记录。</p>
          </>
        )}
        {selectedEvidence.map((e) => (
          <article key={e.id}>
            <strong>证据 {e.id}</strong>
            <p>来源：{e.sourceAlias}</p>
            <p className="quiet">摘要：{e.payloadHash}</p>
            <details>
              <summary>展开此记录原始数据</summary>
              <pre>{JSON.stringify(e.safePayload, null, 2)}</pre>
            </details>
          </article>
        ))}
        {supportIds
          .filter((id) => !detail.evidence.some((e) => e.id === id))
          .map((id) => (
            <p key={id}>引用证据 {id} 暂未取得原文。</p>
          ))}
        {!!supportIds.length && (
          <button onClick={() => onEvidence(supportIds)}>打开这些支持记录</button>
        )}
      </aside>
    </div>
  );
}
