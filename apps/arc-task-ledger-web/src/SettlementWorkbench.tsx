import { useLanguage } from './i18n.js';
import { useState } from 'react';
import { SettlementCard } from './SettlementCard.js';
import { label, money, value, type Detail, type Registry } from './model.js';
import { flowLayout } from './flow-geometry.js';
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
  const { localize } = useLanguage();
  const [selection, setSelection] = useState<{
    kind: 'flow' | 'node' | 'metric';
    id: string;
  }>();
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
  const graphLayout = flowLayout(flows, nodes, 320);
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
    <div className="workbench" aria-label={localize('任务资金与证据工作台')}>
      <aside className="workbench-navigation no-print" aria-label={localize('任务导航')}>
        <span className="eyebrow">{localize('任务工作区')}</span>
        <h3>
          {localize('当前任务 #')}
          {localize(detail.job.jobId)}
        </h3>
        {localize(
          detail.snapshotTasks && (
            <nav className="snapshot-tasks" aria-label={localize('固定快照任务列表')}>
              <small>{localize('此快照前 20 个任务')}</small>
              {localize(
                detail.snapshotTasks.map((task) => (
                  <button
                    key={task.jobId}
                    aria-current={task.jobId === detail.job.jobId ? 'page' : undefined}
                    onClick={() => onTask(task.jobId)}
                  >
                    {localize('任务 #')}
                    {localize(task.jobId)}
                    <small>{localize(label(value(task.lifecycle) ?? 'TERMINAL_UNKNOWN'))}</small>
                  </button>
                )),
              )}
            </nav>
          ),
        )}
        <p>{localize(label(value(detail.job.lifecycle) ?? 'TERMINAL_UNKNOWN'))}</p>
        <label>
          {localize('查看收款角色')}
          <select
            aria-label={localize('查看收款角色')}
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="all">{localize('全部角色')}</option>
            <option value="WORKER">{localize('工作者')}</option>
            <option value="POSTER">{localize('发布者')}</option>
          </select>
        </label>
        <dl>
          <dt>{localize('固定快照')}</dt>
          <dd>{localize(detail.snapshotRunId)}</dd>
          <dt>{localize('链上位置')}</dt>
          <dd>
            {localize('区块 ')}
            {localize(detail.job.snapshot.blockNumber)}
          </dd>
          <dt>{localize('数据来源')}</dt>
          <dd>{localize(detail.job.snapshot.sourceSet.join('、'))}</dd>
        </dl>
        <p className="quiet">
          {localize('关系表示本任务角色；不推断共同控制。中转、奖励、领取不重复合计。')}
        </p>
      </aside>
      <div className="workbench-center">
        <nav className="mobile-workbench-tabs no-print" aria-label={localize('工作区视图')}>
          {localize(
            ['结果', '资金流', '证据'].map((tab) => (
              <button key={tab} aria-pressed={view === tab} onClick={() => setView(tab)}>
                {localize(tab)}
              </button>
            )),
          )}
        </nav>
        <label className="mobile-role-select no-print">
          {localize('查看收款角色')}
          {localize(' ')}
          <select
            aria-label={localize('手机收款角色')}
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="all">{localize('全部角色')}</option>
            <option value="WORKER">{localize('工作者')}</option>
            <option value="POSTER">{localize('发布者')}</option>
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
          aria-label={localize('本任务资金路径')}
        >
          <div className="panel-heading">
            <h3>{localize('资金路径')}</h3>
            <span>
              {localize(flows.length)}
              {localize(' 条已识别记录')}
            </span>
          </div>
          <p className="flow-legend">
            {localize('实线：已观察转移／序列核验领取 · 虚线：待领取分配声明')}
          </p>
          {localize(
            !flows.length ? (
              <p>{localize('尚无足够证据绘制资金路径；缺失历史不会自动补线。')}</p>
            ) : (
              <>
                <svg
                  className="flow-graph"
                  viewBox="0 0 800 320"
                  role="group"
                  aria-label={localize('选择资金边或地址查看依据')}
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
                  {localize(
                    flows.map((f) => {
                      const geometry = graphLayout.get(f.id)!;
                      const edgePath = geometry.path,
                        mx = geometry.x,
                        my = geometry.y;
                      return (
                        <g
                          key={f.id}
                          role="button"
                          tabIndex={0}
                          aria-label={localize(
                            label(f.role) +
                              ' ' +
                              label(f.kind) +
                              ' ' +
                              phaseLabel(f.phase) +
                              ' ' +
                              money(f.amount),
                          )}
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
                          <line
                            x1={geometry.anchorX}
                            y1={geometry.anchorY}
                            x2={mx}
                            y2={my}
                            stroke="#668a26"
                            strokeDasharray="3 3"
                          />
                          <rect x={mx - 64} y={my - 25} width="128" height="50" rx="8" />
                          <text x={mx} y={my - 10} textAnchor="middle">
                            {localize(label(f.kind))}
                          </text>
                          <text x={mx} y={my + 5} textAnchor="middle">
                            {localize(money(f.amount))}
                          </text>
                          <text className="flow-phase" x={mx} y={my + 19} textAnchor="middle">
                            {localize(phaseLabel(f.phase))}
                          </text>
                        </g>
                      );
                    }),
                  )}
                  {localize(
                    nodes.map((n) => (
                      <g
                        key={n.address}
                        role="button"
                        tabIndex={0}
                        aria-label={localize('选择' + n.name + '地址 ' + n.address)}
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
                          {localize(n.name)}
                        </text>
                        <text x={n.x} y={n.y + 14} textAnchor="middle" className="flow-address">
                          {localize(n.address.slice(0, 6))}…{localize(n.address.slice(-4))}
                        </text>
                      </g>
                    )),
                  )}
                </svg>
                <details className="flow-table">
                  <summary>{localize('资金路径表格（键盘可访问）')}</summary>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{localize('资金类型')}</th>
                          <th>{localize('金额与范围')}</th>
                          <th>{localize('方向')}</th>
                          <th>{localize('依据')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {localize(
                          flows.map((f) => (
                            <tr key={f.id}>
                              <td>
                                {localize(label(f.role))} · {localize(label(f.kind))}
                              </td>
                              <td>
                                {localize(money(f.amount))}
                                <small>{localize(phaseLabel(f.phase))}</small>
                              </td>
                              <td>
                                {localize(f.from)}
                                <br />→ {localize(f.to)}
                              </td>
                              <td>
                                <button onClick={() => selectFlow(f.id)}>
                                  {localize('检查此记录')}
                                </button>
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ),
          )}
        </section>
      </div>
      <aside
        className={'workbench-inspector ' + (view === '证据' ? 'mobile-active' : '')}
        aria-label={localize('资金记录检查器')}
      >
        <span className="eyebrow">{localize('证据检查器')}</span>
        {localize(
          metric ? (
            <>
              <h3>{localize(metric.label)}</h3>
              <strong className="inspector-amount">{localize(money(metric.amount))}</strong>
              <p>
                {localize(
                  metric.qualifier === 'AT_LEAST'
                    ? '已识别下限；其他历史未覆盖'
                    : metric.phase === 'CLAIMED'
                      ? '仅具体义务核验领取'
                      : '仅所声明观察范围',
                )}
              </p>
            </>
          ) : flow ? (
            <>
              <h3>
                {localize(label(flow.role))} · {localize(label(flow.kind))}
              </h3>
              <strong className="inspector-amount">{localize(money(flow.amount))}</strong>
              <p>{localize(phaseLabel(flow.phase))}</p>
              <dl>
                <dt>{localize('来自')}</dt>
                <dd>{localize(flow.from)}</dd>
                <dt>{localize('去向')}</dt>
                <dd>{localize(flow.to)}</dd>
              </dl>
              {localize(
                flow.transactionHashes.map((hash) => (
                  <div key={hash}>
                    <a href={transaction(hash)} target="_blank" rel="noreferrer">
                      {localize('查看交易')}
                      {localize(hash.slice(0, 10))}…
                    </a>
                    <br />
                    <a
                      href={
                        '/?' +
                        new URLSearchParams({
                          transaction: hash,
                          taskId: detail.job.jobId,
                          taskRun: detail.snapshotRunId,
                          taskLeg: flow.id.replace(/:(DIRECT|PARKED|CLAIMED)$/, ''),
                        })
                      }
                    >
                      {localize(
                        '用此任务条件重新核验交易 / Verify transaction with task conditions',
                      )}
                    </a>
                  </div>
                )),
              )}
              <p>
                {localize('支持事件：')}
                {localize(flow.eventIds.length || '当前时间线未包含；以回执为准')}
              </p>
            </>
          ) : selection?.kind === 'node' ? (
            <>
              <h3>{localize('选中地址')}</h3>
              <p>{localize(selection.id)}</p>
            </>
          ) : (
            <>
              <h3>{localize('选择一条资金记录')}</h3>
              <p>{localize('点击资金边、地址或金额证据，核对对应来源与原始记录。')}</p>
            </>
          ),
        )}
        {localize(
          selectedEvidence.map((e) => (
            <article key={e.id}>
              <strong>
                {localize('证据 ')}
                {localize(e.id)}
              </strong>
              <p>
                {localize('来源：')}
                {localize(e.sourceAlias)}
              </p>
              <p className="quiet">
                {localize('摘要：')}
                {localize(e.payloadHash)}
              </p>
              <details>
                <summary>{localize('展开此记录原始数据')}</summary>
                <pre>{JSON.stringify(e.safePayload, null, 2)}</pre>
              </details>
            </article>
          )),
        )}
        {localize(
          supportIds
            .filter((id) => !detail.evidence.some((e) => e.id === id))
            .map((id) => (
              <p key={id}>
                {localize('引用证据 ')}
                {localize(id)}
                {localize(' 暂未取得原文。')}
              </p>
            )),
        )}
        {localize(
          !!supportIds.length && (
            <button onClick={() => onEvidence(supportIds)}>{localize('打开这些支持记录')}</button>
          ),
        )}
      </aside>
    </div>
  );
}
