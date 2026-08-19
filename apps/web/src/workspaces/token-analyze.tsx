import { useState, type FormEvent } from 'react';

import { api, type TokenAnalyzeResponse } from '../generated-api/client.js';
import { VirtualTable } from './virtual-table.js';
import { WorkstationStatusBanner } from './workstation-status.js';

export function TokenAnalyzeWorkspace() {
  const [chainId, setChainId] = useState('eip155:56');
  const [token, setToken] = useState('0xAeCBD0E461047d6B7Cfc82e637AD197097407777');
  const [mode, setMode] = useState<'FULL_LIFETIME' | 'BOUNDED_WINDOW'>('FULL_LIFETIME');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<TokenAnalyzeResponse>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setResult(
        await api.analyzeToken('EVM', chainId, token, {
          snapshotPolicy: 'FINALIZED',
          analysisMode: mode,
          forensicMode: 'FORENSIC',
        } as {
          snapshotPolicy: 'FINALIZED';
          analysisMode: 'FULL_LIFETIME' | 'BOUNDED_WINDOW';
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '盘面分析失败。');
    } finally {
      setBusy(false);
    }
  };

  const conservation = result?.supply?.conservation;
  const executable = result?.supply?.executable;

  return (
    <section className="two-column">
      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">正式入口</span>
            <h3>Token 盘面分析</h3>
          </div>
          <span className="snapshot-badge">只需链与 Token</span>
        </div>
        <p>
          普通分析员只提交账本、链标识和 Token。系统自动检查能力矩阵、钉住 FINALIZED
          快照并物化供应与角色。不要粘贴供应单元格或分录 JSON。
        </p>
        <form onSubmit={submit} className="forensic-form">
          <label htmlFor="analyze-chain">
            链标识
            <input
              id="analyze-chain"
              value={chainId}
              onChange={(event) => setChainId(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label htmlFor="analyze-token">
            Token
            <input
              id="analyze-token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label htmlFor="analyze-mode">
            分析模式
            <select
              id="analyze-mode"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as 'FULL_LIFETIME' | 'BOUNDED_WINDOW')
              }
            >
              <option value="FULL_LIFETIME">完整生命周期</option>
              <option value="BOUNDED_WINDOW">有界窗口</option>
            </select>
          </label>
          <button type="submit" disabled={busy || token.length === 0}>
            {busy ? '分析中' : '开始取证分析'}
          </button>
        </form>
        {error === undefined ? null : <p className="knowledge-unknown">{error}</p>}
        <WorkstationStatusBanner
          status={result?.status ?? 'IDLE'}
          {...(result?.reason === undefined ? {} : { reason: result.reason })}
        />
        {result === undefined ? null : (
          <>
            <dl className="forensic-metrics">
              <div>
                <dt>协议供应</dt>
                <dd>{conservation?.protocolSupplyAtomic ?? '未知 · 未物化'}</dd>
              </div>
              <div>
                <dt>可解释供应</dt>
                <dd>{conservation?.explainedSupplyAtomic ?? '未知 · 未物化'}</dd>
              </div>
              <div>
                <dt>未知差额</dt>
                <dd>{conservation?.unknownDifferenceAtomic ?? '未知 · 未物化'}</dd>
              </div>
              <div>
                <dt>当前可执行卖出</dt>
                <dd>{executable?.sellableNowAtomic ?? '未知 · 未物化'}</dd>
              </div>
            </dl>
            <h4>角色（聚合视图）</h4>
            <VirtualTable
              empty="角色未物化 · 保持未知。"
              columns={[
                { key: 'role', header: '角色' },
                { key: 'subject', header: '主体' },
              ]}
              rows={(result.roles?.assessments ?? []).map((item) => ({
                role: item.role,
                subject: item.subject.identifier,
              }))}
            />
            <h4>限制</h4>
            <ul>
              {result.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
      </article>
      <aside className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">计算与证据检查器</span>
            <h3>自动物化主链</h3>
          </div>
        </div>
        <p>入口不得要求粘贴 SupplyCell、Role 或分录 JSON。</p>
        <p>快照策略固定为 FINALIZED。未知、不可用、过期与 Provider 中断不得记为 0。</p>
        <div className="expert-only">
          <p>专家视图：角色分数是证据分，不是校准概率。服务路由与工厂不得标为控制实体或散户。</p>
        </div>
        <p>
          调查标识：
          {result?.investigationId ?? '未知 · 尚未物化'}
        </p>
        <p>
          任务：
          {result?.job?.id ?? '未知 · 尚未入队'}
        </p>
        <p>坐庄时间线与全盘退出 U 在历史任务完成前保持未知。</p>
      </aside>
    </section>
  );
}
