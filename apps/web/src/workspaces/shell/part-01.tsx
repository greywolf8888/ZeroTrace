import {
  type ControlCampaignSnapshot,
  type KnowledgeValue,
  type SubjectResponse,
} from '../../generated-api/client.js';
import { STATUS_LABELS, zhLabel, zhReason, zhUserMessage } from '../../i18n/zh-CN.js';
import { type ReactNode } from 'react';
import type {
  BitcoinUtxoSetView,
  BitcoinScriptControlView,
  BitcoinTransactionEntityView,
} from './chain-views.js';

export type View =
  | 'workbench'
  | 'cases'
  | 'monitoring'
  | 'system'
  | 'analyze'
  | 'overview'
  | 'search'
  | 'entities'
  | 'control'
  | 'campaigns'
  | 'claims'
  | 'scenario'
  | 'health'
  | 'supply'
  | 'capital'
  | 'profit'
  | 'evidence'
  | 'analyst';
export type Theme = 'dark' | 'light';

export const NAVIGATION: Array<{ id: View; label: string; marker: string }> = [
  { id: 'workbench', label: '工作台 / 查询', marker: '查询' },
  { id: 'cases', label: '案件', marker: '案件' },
  { id: 'monitoring', label: '监控与告警', marker: '监控' },
  { id: 'system', label: '数据源与系统', marker: '系统' },
];

export const DEVELOPER_NAVIGATION: Array<{ id: View; label: string; marker: string }> = [
  { id: 'analyze', label: '代币盘面分析', marker: '分析' },
  { id: 'search', label: '案件与调查', marker: '调查' },
  { id: 'overview', label: '盘面总览', marker: '总览' },
  { id: 'campaigns', label: '坐庄时间线', marker: '活动' },
  { id: 'supply', label: '供应现实', marker: '供应' },
  { id: 'entities', label: '实体与角色', marker: '实体' },
  { id: 'capital', label: '资金回流', marker: '回流' },
  { id: 'profit', label: '活动损益', marker: '损益' },
  { id: 'scenario', label: '可兑现价值', marker: '兑现' },
  { id: 'claims', label: '声明核验', marker: '声明' },
  { id: 'evidence', label: '证据账本', marker: '证据' },
  { id: 'analyst', label: '分析员工作台', marker: '认定' },
  { id: 'health', label: '数据健康', marker: '健康' },
  { id: 'control', label: '系统控制（开发）', marker: '系统' },
];

export const FUTURE_DOMAINS: string[] = [];

export function shortId(value: string, length = 12): string {
  if (value.length <= length * 2 + 1) return value;
  return value.slice(0, length) + '…' + value.slice(-length);
}

export function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return '不可用';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function titleCase(value: string): string {
  return zhLabel(value);
}

export function isValidBoundedBlockRange(fromBlock: string, toBlock: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(fromBlock) || !/^(?:0|[1-9]\d*)$/.test(toBlock)) return false;
  const from = BigInt(fromBlock);
  const to = BigInt(toBlock);
  return to >= from && to - from + 1n <= 50_000n;
}

export function nextMonitorStart(block: string): string | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(block)) return undefined;
  const next = BigInt(block) + 1n;
  return next <= BigInt(Number.MAX_SAFE_INTEGER) ? next.toString() : undefined;
}

export type CampaignGraphLayer = 'combined' | 'token' | 'funding' | 'settlement' | 'behavior';

export const CAMPAIGN_GRAPH_LAYERS: ReadonlyArray<{ id: CampaignGraphLayer; label: string }> = [
  { id: 'combined', label: '合并' },
  { id: 'token', label: '代币' },
  { id: 'funding', label: '资金' },
  { id: 'settlement', label: '结算' },
  { id: 'behavior', label: '行为' },
];

export function campaignSnapshotPosition(snapshot: ControlCampaignSnapshot): string {
  return snapshot.blockNumber ?? snapshot.height ?? snapshot.slot ?? '未知';
}

export function overlapPercent(
  left: readonly string[],
  right: readonly string[],
): number | undefined {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return undefined;
  let intersection = 0;
  for (const value of leftSet) if (rightSet.has(value)) intersection += 1;
  return Math.round((intersection / union.size) * 100);
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll('_', '-');
  return (
    <span className={'status-pill status-' + normalized}>
      {STATUS_LABELS[status] ?? titleCase(status)}
    </span>
  );
}

export function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="icon-box" aria-hidden="true">
      {children}
    </span>
  );
}

export function MetricTile({
  label,
  value,
  detail,
  state = 'unknown',
}: {
  label: string;
  value: string;
  detail: string;
  state?: 'known' | 'unknown' | 'unavailable';
}) {
  const stateLabel = state === 'known' ? '已知' : state === 'unavailable' ? '不可用' : '未知';
  return (
    <article className={'metric-tile metric-' + state}>
      <details>
        <summary>
          <div className="metric-label">{label}</div>
          <div className="metric-value">{value}</div>
          <div className="metric-detail">
            <span className="metric-dot" />
            {detail}
          </div>
        </summary>
        <p className="metric-evidence-drill">
          证据钻取：当前状态为{stateLabel}
          。未知、不可用、过期与数据源故障不得记为数字 0。完整结论必须绑定快照、证据
          闭包、覆盖率、来源集、模型/策略版本与回放入口。
        </p>
      </details>
    </article>
  );
}

export function KnowledgeDisplay({ data }: { data: KnowledgeValue<unknown> }) {
  if (data.state === 'known') {
    const display = typeof data.value === 'object' ? '已知' : String(data.value ?? '无值');
    return <span className="knowledge-known">{display}</span>;
  }
  return (
    <span
      className={'knowledge-' + data.state}
      title={
        data.detail === undefined
          ? undefined
          : zhUserMessage(data.detail, '详细原因尚未完成中文说明。')
      }
    >
      {zhReason(data.reason ?? data.state)}
    </span>
  );
}

export function knownObject<T>(value: KnowledgeValue<unknown> | undefined): T | undefined {
  return value?.state === 'known' && typeof value.value === 'object' && value.value !== null
    ? (value.value as T)
    : undefined;
}

export function knownText(value: KnowledgeValue<unknown> | undefined): string {
  if (value?.state !== 'known') return '未知';
  return String(value.value ?? '无值');
}

export function BitcoinIntelligencePanel({ response }: { response: SubjectResponse }) {
  if (response.subject.ledger !== 'BITCOIN') return null;
  const utxoSet = knownObject<BitcoinUtxoSetView>(response.facts.utxoSet);
  const scriptControl = knownObject<BitcoinScriptControlView>(response.facts.scriptControl);
  const transactionEntity = knownObject<BitcoinTransactionEntityView>(
    response.facts.transactionEntityAnalysis,
  );
  if (response.subject.type === 'ADDRESS' && utxoSet !== undefined) {
    return (
      <section className="panel bitcoin-intelligence" data-testid="bitcoin-address-intelligence">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Stable-tip address observation</span>
            <h3>Bitcoin UTXO 对账</h3>
          </div>
          <StatusPill
            status={utxoSet.balanceAgreement.state === 'known' ? 'AGREEMENT' : 'CONFLICT'}
          />
        </div>
        <div className="bitcoin-summary-grid">
          <div>
            <span>Confirmed balance</span>
            <strong>{knownText(response.facts.confirmedBalanceSats)} sats</strong>
          </div>
          <div>
            <span>Mempool delta</span>
            <strong>{knownText(response.facts.mempoolDeltaSats)} sats</strong>
          </div>
          <div>
            <span>已观测 UTXO value</span>
            <strong>{utxoSet.totalValueSats} sats</strong>
          </div>
          <div>
            <span>UTXOs</span>
            <strong>
              {utxoSet.confirmedUtxoCount} 已确认 · {utxoSet.mempoolUtxoCount} 内存池
            </strong>
          </div>
        </div>
        <div className="bitcoin-policy-boundary">
          <strong>策略边界</strong>
          <p>
            RBF 有效性与 CPFP 包状态在缺少 Bitcoin Core 内存池策略及祖先/后代数据时保持未知。仅有
            sequence 信号不是最终策略。
          </p>
        </div>
        <div className="table-scroll bitcoin-utxo-table">
          <table>
            <thead>
              <tr>
                <th>Outpoint</th>
                <th>Value</th>
                <th>State</th>
                <th>Block</th>
              </tr>
            </thead>
            <tbody>
              {utxoSet.utxos.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    No unspent outputs were observed at this Snapshot.
                  </td>
                </tr>
              ) : (
                utxoSet.utxos.map((utxo) => (
                  <tr key={utxo.outpoint}>
                    <td>
                      <code title={utxo.outpoint}>{shortId(utxo.outpoint, 13)}</code>
                    </td>
                    <td>{utxo.valueSats} sats</td>
                    <td>{utxo.confirmed ? 'Confirmed' : 'Mempool'}</td>
                    <td>
                      <KnowledgeDisplay data={utxo.blockHeight} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  if (response.subject.type === 'TRANSACTION' && transactionEntity !== undefined) {
    return (
      <section className="panel bitcoin-intelligence" data-testid="bitcoin-transaction-entity">
        <div className="panel-header">
          <div>
            <span className="eyebrow">候选证据 · 不自动合并</span>
            <h3>Bitcoin 交易实体筛查</h3>
          </div>
          <StatusPill status={transactionEntity.structuralPattern} />
        </div>
        <div className="bitcoin-summary-grid">
          <div>
            <span>输入地址覆盖</span>
            <strong>{Math.round(transactionEntity.inputAddressCoverage * 100)}%</strong>
          </div>
          <div>
            <span>共同输入信号</span>
            <KnowledgeDisplay data={transactionEntity.commonInputHeuristic} />
          </div>
          <div>
            <span>等额输出组</span>
            <strong>{transactionEntity.equalOutputGroups.length}</strong>
          </div>
          <div>
            <span>自动所有权合并</span>
            <strong className="knowledge-unknown">
              {transactionEntity.automaticOwnershipMergeAllowed ? '允许' : '已阻止'}
            </strong>
          </div>
        </div>
        <div className="bitcoin-control-grid bitcoin-entity-boundaries">
          <div>
            <span>所有权结论</span>
            <KnowledgeDisplay data={transactionEntity.ownershipConclusion} />
            <p>共同输入只作为候选证据，绝不直接合并实体。</p>
          </div>
          <div>
            <span>Payjoin 污染</span>
            <KnowledgeDisplay data={transactionEntity.payjoinContaminationRisk} />
            <p>最终交易不会暴露 BIP78 Payjoin 协商来源。</p>
          </div>
          <div>
            <span>服务 / 托管风险</span>
            <KnowledgeDisplay data={transactionEntity.serviceClusterRisk} />
            <p>需要单独的版本化归属来源与快照。</p>
          </div>
          <div>
            <span>选中找零输出</span>
            <KnowledgeDisplay data={transactionEntity.selectedChangeOutput} />
            <p>脚本类型匹配只是候选，不是安全的找零归属。</p>
          </div>
        </div>
        <div className="bitcoin-policy-boundary bitcoin-suppression-ledger">
          <strong>抑制账本</strong>
          {transactionEntity.suppressionReasons.length === 0 ? (
            <p>未观测到结构性抑制原因；外部归属仍为未知。</p>
          ) : (
            <ul>
              {transactionEntity.suppressionReasons.map((reason) => (
                <li key={reason}>{titleCase(reason)}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="table-scroll bitcoin-change-table">
          <table>
            <thead>
              <tr>
                <th>找零候选</th>
                <th>金额</th>
                <th>脚本</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              {transactionEntity.changeCandidates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    没有有界变更候选通过结构过滤。
                  </td>
                </tr>
              ) : (
                transactionEntity.changeCandidates.map((candidate) => (
                  <tr key={candidate.vout}>
                    <td>vout {candidate.vout}</td>
                    <td>{candidate.valueSats} sats</td>
                    <td>{candidate.scriptType}</td>
                    <td>{candidate.signals.map(titleCase).join(' · ')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="snapshot-strip">
          <span>
            <b>Fee</b> {transactionEntity.feeSats} sats
          </span>
          <span>
            <b>Virtual size</b> {transactionEntity.virtualSizeBytes} vB
          </span>
          <span>
            <b>Fee rate</b> <KnowledgeDisplay data={transactionEntity.feeRateSatPerVbyte} />
          </span>
          <span>
            <b>Fee arithmetic</b> <KnowledgeDisplay data={transactionEntity.feeReconciles} />
          </span>
        </div>
      </section>
    );
  }
  if (response.subject.type !== 'OUTPOINT' || scriptControl === undefined) return null;
  const multisig =
    scriptControl.multisig.state === 'known' ? scriptControl.multisig.value : undefined;
  const timelocks = [...scriptControl.absoluteTimelocks, ...scriptControl.relativeTimelocks];
  return (
    <section className="panel bitcoin-intelligence" data-testid="bitcoin-outpoint-intelligence">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Observable spend conditions</span>
          <h3>Bitcoin 脚本控制</h3>
        </div>
        <StatusPill status={scriptControl.spendConditionVisibility} />
      </div>
      <div className="bitcoin-summary-grid">
        <div>
          <span>Script class</span>
          <strong>{scriptControl.scriptClass}</strong>
        </div>
        <div>
          <span>Signature requirement</span>
          <KnowledgeDisplay data={scriptControl.signatureRequirement} />
        </div>
        <div>
          <span>Multisig</span>
          <strong>
            {multisig === undefined
              ? titleCase(scriptControl.multisig.reason ?? 'unknown')
              : `${multisig.threshold}-of-${multisig.signerCount}`}
          </strong>
        </div>
        <div>
          <span>Taproot spend path</span>
          <KnowledgeDisplay data={scriptControl.taprootSpendPath} />
        </div>
      </div>
      <div className="bitcoin-control-grid">
        <div>
          <span>Controller identity</span>
          <KnowledgeDisplay data={scriptControl.controllerIdentity} />
          <p>A 公钥、哈希或脚本不是实体身份.</p>
        </div>
        <div>
          <span>Full script conditions</span>
          <KnowledgeDisplay data={scriptControl.scriptConditionsComplete} />
          <p>Hidden P2SH/P2WSH/Taproot branches stay Unknown until revealed and verified.</p>
        </div>
        <div>
          <span>Effective RBF</span>
          <KnowledgeDisplay
            data={
              response.facts.effectiveSpendingTransactionRbf ?? {
                state: 'unknown',
                reason: 'NOT_QUERIED',
              }
            }
          />
          <p>Requires active node policy and inherited ancestor state.</p>
        </div>
        <div>
          <span>CPFP package</span>
          <KnowledgeDisplay
            data={
              response.facts.spendingTransactionCpfpPackage ?? {
                state: 'unknown',
                reason: 'NOT_QUERIED',
              }
            }
          />
          <p>Requires Core ancestor/descendant package fields.</p>
        </div>
      </div>
      <div className="bitcoin-timelocks">
        <strong>已观测 timelocks</strong>
        {timelocks.length === 0 ? (
          <span>None decoded in the visible script.</span>
        ) : (
          <ul>
            {timelocks.map((lock, index) => (
              <li key={`${lock.kind}-${lock.value}-${index}`}>
                {titleCase(lock.kind)} · {lock.value} — {lock.detail}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
