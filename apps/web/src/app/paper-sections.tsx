import type { ReactNode } from 'react';

import type { HealthResponse } from '../generated-api/client.js';
import {
  PaperSimulationWorkspace,
  type PaperWorkspaceSection,
} from '../workspaces/paper-simulation.js';
import { ControlCampaignWorkspace, type View } from '../workspaces/shell/index.js';

const PAPER_VIEWS: Partial<Record<View, PaperWorkspaceSection>> = {
  radar: 'radar',
  history: 'history',
  rejected: 'rejected',
  candidates: 'candidates',
  prepareBuy: 'prepare-buy',
  paperPositions: 'positions',
  prepareSell: 'prepare-sell',
  alerts: 'alerts',
  research: 'research',
  settings: 'settings',
};

export function primaryPaperView(view: View): ReactNode | undefined {
  const section = PAPER_VIEWS[view];
  if (section !== undefined) return <PaperSimulationWorkspace section={section} />;
  if (view !== 'profiles') return undefined;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">控制证据 · 行为时间线 · 公共服务反证</span>
          <h1>庄家档案</h1>
          <p>证据强弱不等于身份概率；服务枢纽会阻断所有权传播。</p>
        </div>
      </div>
      <ControlCampaignWorkspace />
    </>
  );
}

export function GlobalModeStrip({ health }: { health?: HealthResponse | undefined }) {
  return (
    <div className="global-mode-strip" role="status" aria-label="全局模拟模式状态">
      <span>
        <b>模式</b> 模拟
      </span>
      <span>
        <b>链</b> BNB 智能链 / Solana
      </span>
      <span>
        <b>可用本金</b> 选择实验后显示
      </span>
      <span>
        <b>已占用</b> 未知
      </span>
      <span>
        <b>持仓风险</b> 未知
      </span>
      <span>
        <b>资料状态</b> {health === undefined ? '检查中' : health.status === 'UP' ? '可用' : '降级'}
      </span>
    </div>
  );
}
