import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  api,
  type PaperExperimentView,
  type PaperPortfolioSettingsResponse,
} from '../generated-api/client.js';
import { zhUserMessage } from '../i18n/zh-CN.js';
import { PaperNotificationCenter } from './paper-notification-center.js';
import { PaperEventTable, PaperReviewExplorer } from './paper-review-view.js';
import { shortId, StatusPill } from './shell/index.js';

export type PaperWorkspaceSection =
  | 'radar'
  | 'history'
  | 'rejected'
  | 'candidates'
  | 'prepare-buy'
  | 'positions'
  | 'prepare-sell'
  | 'alerts'
  | 'research'
  | 'settings';

const SECTION_TITLE: Record<PaperWorkspaceSection, string> = {
  radar: '新币雷达',
  history: '历史金狗',
  rejected: '失败与拒绝',
  candidates: '候选池',
  'prepare-buy': '准备买入',
  positions: '模拟持仓',
  'prepare-sell': '准备卖出',
  alerts: '提醒',
  research: '研究结果',
  settings: '设置',
};

function atomic(value: string, decimals: number): string {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value)) return '未知';
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction.length === 0 ? '' : `.${fraction}`}`;
}

export function PaperSimulationWorkspace({ section }: { section: PaperWorkspaceSection }) {
  const [settings, setSettings] = useState<PaperPortfolioSettingsResponse>();
  const [experiment, setExperiment] = useState<PaperExperimentView>();
  const [initialExperimentId] = useState(
    () => window.localStorage.getItem('zerotrace-paper-experiment') ?? '',
  );
  const [experimentId, setExperimentId] = useState(initialExperimentId);
  const [chain, setChain] = useState<'BSC' | 'SOLANA'>('SOLANA');
  const [name, setName] = useState('主模拟实验');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const loadExperiment = useCallback(async (id: string) => {
    if (id.trim().length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.paperExperiment(id.trim());
      setExperiment(response.experiment);
      setExperimentId(response.experiment.id);
      setChain(response.experiment.chain);
      window.localStorage.setItem('zerotrace-paper-experiment', response.experiment.id);
    } catch (cause) {
      setExperiment(undefined);
      setError(zhUserMessage(cause instanceof Error ? cause.message : cause, '模拟实验读取失败。'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void api
      .paperPortfolioSettings(controller.signal)
      .then(setSettings)
      .catch((cause: unknown) =>
        setError(zhUserMessage(cause instanceof Error ? cause.message : cause, '模拟设置不可用。')),
      );
    const experimentTimer =
      initialExperimentId.length === 0
        ? undefined
        : window.setTimeout(() => void loadExperiment(initialExperimentId), 0);
    return () => {
      controller.abort();
      if (experimentTimer !== undefined) window.clearTimeout(experimentTimer);
    };
  }, [initialExperimentId, loadExperiment]);

  const account = settings?.accounts.find((item) => item.chain === chain);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (settings === undefined || account === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.createPaperExperiment({
        name,
        chain,
        initialPrincipalAtomic: account.initialAtomic,
        policy: settings.policy,
      });
      setExperiment(response.experiment);
      setExperimentId(response.experiment.id);
      window.localStorage.setItem('zerotrace-paper-experiment', response.experiment.id);
    } catch (cause) {
      setError(zhUserMessage(cause instanceof Error ? cause.message : cause, '模拟实验创建失败。'));
    } finally {
      setBusy(false);
    }
  };

  const investedAtomic = useMemo(
    () =>
      experiment?.positions
        .reduce((sum, position) => sum + BigInt(position.costBasisAtomic), 0n)
        .toString(),
    [experiment],
  );
  const candidateEvents =
    experiment?.events.filter((event) => event.type === 'CANDIDATE_ENTERED') ?? [];
  const buyEvents =
    experiment?.events.filter(
      (event) => event.type === 'PREPARE_BUY' || event.type.startsWith('PAPER_BUY_'),
    ) ?? [];
  const sellEvents =
    experiment?.events.filter(
      (event) => event.type === 'PREPARE_SELL' || event.type.startsWith('PAPER_SELL_'),
    ) ?? [];

  const body = (() => {
    if (experiment === undefined) return null;
    if (section === 'radar') {
      return (
        <section className="panel paper-stage-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">实时发现边界</span>
              <h3>真实候选发现尚未通过双链门禁</h3>
            </div>
            <StatusPill status="BLOCKED" />
          </div>
          <p>
            当前实验可立即记录由已验证证据产生的候选，但不会用固定代币、样例收益或单一来源伪造雷达列表。
            BSC 与 Solana 的全量发现、分页终止和不可卖负例通过后，候选才会进入这里。
          </p>
        </section>
      );
    }
    if (section === 'history') return <PaperEventTable events={experiment.events} />;
    if (section === 'rejected' || section === 'research') return <PaperReviewExplorer />;
    if (section === 'candidates') return <PaperEventTable events={candidateEvents} />;
    if (section === 'prepare-buy') return <PaperEventTable events={buyEvents} />;
    if (section === 'prepare-sell') return <PaperEventTable events={sellEvents} />;
    if (section === 'positions') {
      return (
        <section className="panel">
          <div className="table-scroll">
            <table className="paper-table">
              <thead>
                <tr>
                  <th>资产</th>
                  <th>控制组</th>
                  <th>叙事组</th>
                  <th>模拟数量</th>
                  <th>已占用数量</th>
                  <th>剩余成本</th>
                  <th>退出容量</th>
                </tr>
              </thead>
              <tbody>
                {experiment.positions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-cell">
                      当前没有模拟持仓；不会用假收益填充页面。
                    </td>
                  </tr>
                ) : (
                  experiment.positions.map((position) => (
                    <tr key={position.assetId}>
                      <td>
                        <code title={position.assetId}>{shortId(position.assetId, 9)}</code>
                      </td>
                      <td>{position.controllerGroupId}</td>
                      <td>{position.narrativeGroupId}</td>
                      <td>{position.quantityAtomic}</td>
                      <td>{position.reservedQuantityAtomic}</td>
                      <td>
                        {atomic(position.costBasisAtomic, experiment.baseDecimals)}{' '}
                        {experiment.baseAsset}
                      </td>
                      <td>未知（需同一快照报价）</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      );
    }
    if (section === 'alerts') {
      return <PaperNotificationCenter experiment={experiment} />;
    }
    return (
      <section className="paper-settings-grid">
        <article className="panel">
          <span className="eyebrow">实验策略</span>
          <h3>{settings?.version ?? '配置不可用'}</h3>
          <dl className="paper-policy-list">
            <div>
              <dt>目标仓位</dt>
              <dd>{settings?.policy.targetPositionBps ?? '未知'} 基点</dd>
            </div>
            <div>
              <dt>单一资产上限</dt>
              <dd>{settings?.policy.maxSinglePositionBps ?? '未知'} 基点</dd>
            </div>
            <div>
              <dt>控制组上限</dt>
              <dd>{settings?.policy.maxControllerGroupBps ?? '未知'} 基点</dd>
            </div>
            <div>
              <dt>最低未占用本金</dt>
              <dd>{settings?.policy.minimumUncommittedCashBps ?? '未知'} 基点</dd>
            </div>
          </dl>
        </article>
        <article className="panel">
          <span className="eyebrow">权限边界</span>
          <h3>只读关联</h3>
          <p>钱包地址只可读取公开余额与交易；关联不会改变模拟本金，也不会自动跨链。</p>
          <div className="paper-boundary-note">
            无私钥、无签名、无审批、无广播、无真实资金移动。
          </div>
        </article>
        <article className="panel">
          <span className="eyebrow">公开网站与分享权限</span>
          <h3>默认不公开</h3>
          <p>
            案件、私人资料、模拟实验和复盘不会生成匿名公开链接。生产身份核验与逐报告分享授权完成前，公开分享保持关闭。
          </p>
          <StatusPill status="AUTH_NOT_CONFIGURED" />
        </article>
      </section>
    );
  })();

  return (
    <>
      <div className="page-heading page-heading-row">
        <div>
          <span className="eyebrow">双链条件模拟 · 持久账本 · 全阶段提醒</span>
          <h1>{SECTION_TITLE[section]}</h1>
          <p>模拟状态与链上真实资金严格隔离；未知、不可用、过期和数据源故障不会显示为 0。</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={busy || experiment === undefined}
          onClick={() =>
            experiment === undefined ? undefined : void loadExperiment(experiment.id)
          }
        >
          {busy ? '刷新中…' : '刷新实验'}
        </button>
      </div>
      <section className="paper-status-strip" aria-label="模拟实验状态">
        <div>
          <span>当前模式</span>
          <strong>模拟</strong>
        </div>
        <div>
          <span>链</span>
          <strong>{experiment?.chain ?? chain}</strong>
        </div>
        <div>
          <span>可用本金</span>
          <strong>
            {experiment === undefined
              ? '未选择实验'
              : `${atomic(experiment.availableCashAtomic, experiment.baseDecimals)} ${experiment.baseAsset}`}
          </strong>
        </div>
        <div>
          <span>已占用金额</span>
          <strong>
            {experiment === undefined || investedAtomic === undefined
              ? '未知'
              : `${atomic(investedAtomic, experiment.baseDecimals)} ${experiment.baseAsset}`}
          </strong>
        </div>
        <div>
          <span>持仓风险</span>
          <strong>
            {experiment === undefined ? '未知' : `${experiment.positions.length} 个持仓`}
          </strong>
        </div>
        <div>
          <span>资料状态</span>
          <strong>{experiment === undefined ? '未载入' : `持久版本 ${experiment.revision}`}</strong>
        </div>
      </section>
      {error === undefined ? null : <div className="alert alert-warning">{error}</div>}
      {experiment === undefined ? (
        <section className="panel paper-onboarding">
          <div>
            <span className="eyebrow">先创建或载入命名实验</span>
            <h2>模拟本金只在新建实验时初始化</h2>
            <p>{settings?.budgetMeaning ?? '正在读取版本化模拟本金与仓位策略。'}</p>
          </div>
          <form onSubmit={(event) => void create(event)}>
            <label htmlFor="paper-name">实验名称</label>
            <input id="paper-name" value={name} onChange={(event) => setName(event.target.value)} />
            <label htmlFor="paper-chain">链</label>
            <select
              id="paper-chain"
              value={chain}
              onChange={(event) => setChain(event.target.value === 'BSC' ? 'BSC' : 'SOLANA')}
            >
              <option value="SOLANA">Solana</option>
              <option value="BSC">BNB 智能链</option>
            </select>
            <div className="paper-principal-preview">
              初始模拟本金：{account?.initialNative ?? '未知'} {account?.nativeSymbol ?? ''}
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={busy || settings === undefined}
            >
              创建模拟实验
            </button>
          </form>
          <form
            className="paper-load-form"
            onSubmit={(event) => {
              event.preventDefault();
              void loadExperiment(experimentId);
            }}
          >
            <label htmlFor="paper-experiment-id">已有实验编号</label>
            <input
              id="paper-experiment-id"
              value={experimentId}
              onChange={(event) => setExperimentId(event.target.value)}
              placeholder="pex_…"
              spellCheck={false}
            />
            <button
              className="secondary-button"
              type="submit"
              disabled={busy || experimentId.length === 0}
            >
              载入实验
            </button>
          </form>
        </section>
      ) : (
        body
      )}
    </>
  );
}
