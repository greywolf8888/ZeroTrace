import {
  StatusPill,
  titleCase,
  shortId,
  CAMPAIGN_GRAPH_LAYERS,
  MetricTile,
  KnowledgeDisplay,
  campaignSnapshotPosition,
  formatTime,
} from './part-01.js';
import { zhLabel, zhUserMessage } from '../../i18n/zh-CN.js';
import { FundingSettlementPanel } from './part-09.js';
import { useControlCampaign } from './use-control-campaign.js';

export function ControlCampaignWorkspace() {
  const {
    busy,
    campaign,
    chainId,
    comparisonEvidenceDelta,
    comparisonReference,
    comparisonWalletDelta,
    comparisonWalletOverlap,
    error,
    evidenceLine,
    exportCase,
    forensicCase,
    forensicCaseError,
    graphLayer,
    load,
    loaded,
    monitor,
    monitorError,
    monitorStartBlock,
    records,
    replay,
    selected,
    setChainId,
    setGraphLayer,
    setSelectedId,
    setToken,
    showBehaviorLayer,
    showFundingLayer,
    showSettlementLayer,
    showTokenLayer,
    snapshotPosition,
    startMonitor,
    token,
    visibleAlerts,
    visibleAlertsError,
    visibleAlertsLoaded,
    visibleFundingLayer,
    visibleFundingSettlement,
    visibleFundingSettlementError,
  } = useControlCampaign();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">控制活动 · 证据线 · 可回放快照</span>
          <h1>坐庄时间线</h1>
          <p>
            沿代币流向、集群仓位、行为事件和取证证据复盘；标签不会被静默转换为
            所有权，归因也不会被包装成确定事实。
          </p>
        </div>
        <StatusPill status="READ_ONLY" />
      </div>
      <section className="panel subject-panel quote-panel" data-testid="control-campaign-query">
        <div className="panel-header">
          <div>
            <span className="eyebrow">仅限持久化案件报告</span>
            <h3>加载代币活动历史</h3>
          </div>
          <span className="snapshot-badge">支持脱离数据源导出取证包</span>
        </div>
        <form
          className="quote-form control-campaign-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label htmlFor="campaign-chain">链标识</label>
          <input
            id="campaign-chain"
            value={chainId}
            onChange={(event) => setChainId(event.target.value)}
            placeholder="eip155:56"
            spellCheck={false}
          />
          <label htmlFor="campaign-token">代币地址</label>
          <input
            id="campaign-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
          />
          <div className="control-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={busy || token.trim().length === 0}
            >
              {busy ? '加载中…' : '加载活动'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || selected === undefined}
              onClick={() => void replay()}
            >
              回放已存快照
            </button>
          </div>
        </form>
        <p className="quote-note">
          未知、不可用、过期和数据源故障保持为不同状态。未经校准的证据分数只显示为
          分数，绝不解释为概率或所有权结论。
        </p>
        {error === undefined ? null : <p className="inline-error">{error}</p>}
      </section>

      {loaded && (showFundingLayer || showSettlementLayer) ? (
        <FundingSettlementPanel
          response={visibleFundingSettlement}
          error={visibleFundingSettlementError}
          layer={visibleFundingLayer}
        />
      ) : null}

      {loaded && records.length === 0 && error === undefined ? (
        <section className="panel empty-state" data-testid="control-campaign-empty">
          <strong>未找到持久化控制活动报告。</strong>
          <span>该代币可能尚未物化，或持久化存储尚未配置。</span>
        </section>
      ) : null}

      {records.length > 0 ? (
        <section
          className="two-column control-campaign-layout"
          data-testid="control-campaign-results"
        >
          <div className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">不可变活动报告</span>
                <h3>活动索引</h3>
              </div>
              <span className="panel-note">{records.length} 份报告</span>
            </div>
            <div className="campaign-index-list">
              {records.map((record) => (
                <button
                  className={
                    'campaign-index-item ' + (record === selected ? 'campaign-index-active' : '')
                  }
                  key={record.campaign.id}
                  type="button"
                  onClick={() => setSelectedId(record.campaign.id)}
                >
                  <span>
                    <strong>{titleCase(record.campaign.currentStage)}</strong>
                    <small>{shortId(record.campaign.id, 9)}</small>
                  </span>
                  <span>
                    <StatusPill status={record.campaign.status} />
                    <small>区块 {record.campaign.startBlock}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selected === undefined || campaign === undefined || evidenceLine === undefined ? null : (
            <div className="campaign-detail-stack">
              <div className="campaign-graph-tabs" role="tablist" aria-label="坐庄活动图层">
                {CAMPAIGN_GRAPH_LAYERS.map((layer) => (
                  <button
                    className={'campaign-graph-tab ' + (graphLayer === layer.id ? 'active' : '')}
                    key={layer.id}
                    type="button"
                    role="tab"
                    aria-selected={graphLayer === layer.id}
                    onClick={() => setGraphLayer(layer.id)}
                  >
                    {layer.label}
                  </button>
                ))}
              </div>
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">
                      {shortId(campaign.id, 13)} · {campaign.token}
                    </span>
                    <h3>活动态势</h3>
                  </div>
                  <StatusPill status={campaign.currentStage} />
                </div>
                <div className="metric-grid compact-grid">
                  <MetricTile
                    label="活动分数"
                    value={campaign.evidenceScore.toFixed(3)}
                    detail="未经校准的证据分数"
                    state="known"
                  />
                  <MetricTile
                    label="受控供应量"
                    value={
                      campaign.controlledSupply.state === 'known'
                        ? (campaign.controlledSupply.value ?? '未知')
                        : '未知'
                    }
                    detail="集群仓位汇总"
                    state={campaign.controlledSupply.state === 'known' ? 'known' : 'unknown'}
                  />
                  <MetricTile
                    label="数据覆盖率"
                    value={`${Math.round(campaign.evidenceCoverage * 100)}%`}
                    detail="已观测活动证据"
                    state={campaign.evidenceCoverage === 1 ? 'known' : 'unknown'}
                  />
                  <MetricTile
                    label="来源覆盖率"
                    value={`${Math.round(campaign.sourceCoverage * 100)}%`}
                    detail="数据源完整度"
                    state={campaign.sourceCoverage === 1 ? 'known' : 'unknown'}
                  />
                  <MetricTile
                    label="历史覆盖率"
                    value={`${Math.round(campaign.historyCoverage * 100)}%`}
                    detail="区间完整度"
                    state={campaign.historyCoverage === 1 ? 'known' : 'unknown'}
                  />
                  <MetricTile
                    label="钱包数"
                    value={String(
                      campaign.coreWalletIds.length + campaign.satelliteWalletIds.length,
                    )}
                    detail="核心与卫星候选"
                    state="known"
                  />
                </div>
                <div className="fact-grid">
                  <div className="fact-row">
                    <span>活动编号</span>
                    <code>{campaign.id}</code>
                  </div>
                  <div className="fact-row">
                    <span>区块范围</span>
                    <span>
                      {campaign.startBlock} → <KnowledgeDisplay data={campaign.endBlock} />
                    </span>
                  </div>
                  <div className="fact-row">
                    <span>快照位置</span>
                    <code>{snapshotPosition}</code>
                  </div>
                  <div className="fact-row">
                    <span>校准状态</span>
                    <StatusPill status={campaign.calibrationStatus} />
                  </div>
                  <div className="fact-row">
                    <span>活动置信度</span>
                    <KnowledgeDisplay data={campaign.campaignConfidence} />
                  </div>
                  <div className="fact-row">
                    <span>实体变更</span>
                    <strong className="knowledge-unknown">已阻止</strong>
                  </div>
                  <div className="fact-row">
                    <span>来源数量</span>
                    <span>{campaign.metadata.sourceSet.length} 个数据源</span>
                  </div>
                  <div className="fact-row">
                    <span>结果哈希</span>
                    <code>{shortId(selected.resultHash, 18)}</code>
                  </div>
                </div>
                <div className="case-export-bar" data-testid="control-campaign-export">
                  <div>
                    <span className="eyebrow">取证案件包</span>
                    <strong>证据闭包 · 清单哈希 · 离线回放</strong>
                    {forensicCase === undefined ? null : (
                      <small>
                        {forensicCase.case.caseId} · {forensicCase.case.manifest.evidenceCount}{' '}
                        条证据 · {forensicCase.case.manifest.snapshotCount} 个快照 ·{' '}
                        {forensicCase.case.manifest.rawArtifactCount} 个原始工件
                      </small>
                    )}
                    {forensicCaseError === undefined ? null : (
                      <small className="knowledge-unknown">{forensicCaseError}</small>
                    )}
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void exportCase()}
                  >
                    {busy ? '导出中…' : '导出案件包'}
                  </button>
                </div>
                <div className="case-export-bar monitor-bar" data-testid="control-campaign-monitor">
                  <div>
                    <span className="eyebrow">终局区块增量监控</span>
                    <strong>链上只读调度 · 重组感知游标 · 无自动操作</strong>
                    {monitor === undefined ? (
                      <small>从快照 {snapshotPosition} 之后开始；工作进程只捕获新终局区块。</small>
                    ) : (
                      <small>
                        {monitor.monitor.monitorId} · {titleCase(monitor.monitor.status)} · 下次{' '}
                        <KnowledgeDisplay data={monitor.monitor.nextRunAt} />
                      </small>
                    )}
                    {monitorError === undefined ? null : (
                      <small className="knowledge-unknown">{monitorError}</small>
                    )}
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy || monitorStartBlock === undefined}
                    onClick={() => void startMonitor()}
                    title={
                      monitorStartBlock === undefined
                        ? '启动监控需要一个已知且安全的快照区块。'
                        : undefined
                    }
                  >
                    {busy ? '启动中…' : monitor === undefined ? '启动监控' : '回放监控'}
                  </button>
                </div>
              </section>

              {comparisonReference === undefined ? null : (
                <section className="panel campaign-comparison" data-testid="campaign-comparison">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">不可变报告对照 · 仅作描述</span>
                      <h3>活动对照</h3>
                    </div>
                    <StatusPill status="READ_ONLY" />
                  </div>
                  <p className="panel-copy">
                    此处对照两份绑定快照的持久化报告，不推断所有权、不合并实体，也不把
                    未校准分数转换为概率。
                  </p>
                  <div className="metric-grid compact-grid">
                    <MetricTile
                      label="钱包重合度"
                      value={
                        comparisonWalletOverlap === undefined
                          ? '未知'
                          : `${comparisonWalletOverlap}%`
                      }
                      detail="基于已观测核心与卫星钱包的集合重合度"
                      state={comparisonWalletOverlap === undefined ? 'unknown' : 'known'}
                    />
                    <MetricTile
                      label="钱包数量差值"
                      value={
                        comparisonWalletDelta === undefined ? '未知' : String(comparisonWalletDelta)
                      }
                      detail="所选报告减去参考报告"
                      state={comparisonWalletDelta === undefined ? 'unknown' : 'known'}
                    />
                    <MetricTile
                      label="证据条目差值"
                      value={
                        comparisonEvidenceDelta === undefined
                          ? '未知'
                          : String(comparisonEvidenceDelta)
                      }
                      detail="所选报告减去参考报告"
                      state={comparisonEvidenceDelta === undefined ? 'unknown' : 'known'}
                    />
                    <MetricTile
                      label="覆盖率"
                      value={`${Math.round(campaign.evidenceCoverage * 100)}% → ${Math.round(comparisonReference.campaign.evidenceCoverage * 100)}%`}
                      detail="所选报告到参考报告的证据覆盖率"
                      state="known"
                    />
                  </div>
                  <div className="fact-grid">
                    <div className="fact-row">
                      <span>所选报告</span>
                      <code>{selected.campaign.id}</code>
                    </div>
                    <div className="fact-row">
                      <span>参考报告</span>
                      <code>{comparisonReference.campaign.id}</code>
                    </div>
                    <div className="fact-row">
                      <span>快照位置</span>
                      <span>
                        {campaignSnapshotPosition(selected.campaign.snapshotEnd)} →{' '}
                        {campaignSnapshotPosition(comparisonReference.campaign.snapshotEnd)}
                      </span>
                    </div>
                    <div className="fact-row">
                      <span>结果哈希</span>
                      <code title={`${selected.resultHash} → ${comparisonReference.resultHash}`}>
                        {shortId(selected.resultHash, 8)} →{' '}
                        {shortId(comparisonReference.resultHash, 8)}
                      </code>
                    </div>
                  </div>
                </section>
              )}

              <section className="panel" data-testid="control-campaign-alerts">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">取证告警流 · 证据绑定</span>
                    <h3>活动告警</h3>
                  </div>
                  <span className="panel-note">
                    {visibleAlertsLoaded ? `${visibleAlerts.length} 条告警` : '加载中…'}
                  </span>
                </div>
                {visibleAlertsError !== undefined ? (
                  <p className="inline-error alert-state-message">{visibleAlertsError}</p>
                ) : !visibleAlertsLoaded ? (
                  <p className="empty-cell alert-state-message">正在回放持久化告警…</p>
                ) : visibleAlerts.length === 0 ? (
                  <p className="empty-cell alert-state-message">此活动没有已物化的持久化告警。</p>
                ) : (
                  <div className="alert-list">
                    {visibleAlerts.map((alert) => (
                      <article
                        className={'campaign-alert alert-' + alert.severity.toLowerCase()}
                        key={alert.id}
                      >
                        <div className="campaign-alert-heading">
                          <div>
                            <span className="eyebrow">{titleCase(alert.classification)}</span>
                            <strong>{shortId(alert.id, 10)}</strong>
                          </div>
                          <StatusPill status={alert.severity} />
                        </div>
                        <p>
                          {alert.evidenceIds.length} 个证据节点 · 置信度{' '}
                          <KnowledgeDisplay data={alert.confidence} /> ·{' '}
                          {formatTime(alert.createdAt)}
                        </p>
                        <small>
                          {alert.suppressionApplied.length === 0
                            ? '未应用抑制规则。'
                            : `抑制规则：${alert.suppressionApplied.map(zhLabel).join(' · ')}`}
                        </small>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {showTokenLayer ? (
                <section className="panel" data-testid="control-campaign-positions">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">守恒的集群仓位快照</span>
                      <h3>仓位时间线</h3>
                    </div>
                    <span className="panel-note">{selected.positions.length} 个快照</span>
                  </div>
                  {selected.positions.length === 0 ? (
                    <p className="empty-cell">未物化守恒仓位快照。</p>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>区块</th>
                            <th>代币余额</th>
                            <th>外部流入 / 流出</th>
                            <th>钱包数</th>
                            <th>可卖出量</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.positions.map((position) => (
                            <tr key={position.id}>
                              <td>{position.atBlock}</td>
                              <td>
                                <code>{position.tokenBalanceRaw}</code>
                              </td>
                              <td>
                                <code>{position.externalTokenInflowRaw}</code>
                                <br />
                                <small>−{position.externalTokenOutflowRaw}</small>
                              </td>
                              <td>{position.walletCount}</td>
                              <td>
                                <KnowledgeDisplay data={position.sellReadyTokenRaw} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : null}

              {showBehaviorLayer ? (
                <section className="panel" data-testid="control-campaign-timeline">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">行为事件 · 按观测区间排序</span>
                      <h3>活动时间线</h3>
                    </div>
                    <span className="panel-note">{selected.behaviorEvents.length} 个事件</span>
                  </div>
                  {selected.behaviorEvents.length === 0 ? (
                    <p className="empty-cell">未物化行为事件。</p>
                  ) : (
                    <div className="timeline-list">
                      {selected.behaviorEvents.map((event) => (
                        <article className="timeline-event" key={event.id}>
                          <div className="timeline-marker" />
                          <div>
                            <div className="timeline-event-heading">
                              <strong>{titleCase(event.type)}</strong>
                              <StatusPill status={event.status} />
                            </div>
                            <span className="timeline-range">
                              {event.startBlock} → {event.endBlock} · {formatTime(event.startTime)}
                            </span>
                            <p>
                              {zhUserMessage(event.explanation, '该事件说明尚未完成中文映射。')}
                            </p>
                            <small>
                              {event.supportingEvidenceIds.length} 条支持证据 · 置信度{' '}
                              <KnowledgeDisplay data={event.confidence} />
                            </small>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              <section className="panel" data-testid="control-campaign-evidence-line">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">取证证据线 · 不直接合并实体</span>
                    <h3>证据线</h3>
                  </div>
                  <StatusPill status={evidenceLine.terminalBoundary} />
                </div>
                <div className="evidence-line-phases">
                  {evidenceLine.phases.map((phase) => (
                    <div className="evidence-line-phase" key={phase.phase}>
                      <div>
                        <strong>{titleCase(phase.phase)}</strong>
                        <span>{phase.itemIds.length} 个条目</span>
                      </div>
                      <div className="coverage-bar">
                        <span style={{ width: `${Math.round(phase.coverage * 100)}%` }} />
                      </div>
                      {phase.attributionStopped ? (
                        <small className="knowledge-unknown">归因已在边界停止</small>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>证据</th>
                        <th>阶段</th>
                        <th>区块</th>
                        <th>主体</th>
                        <th>审阅</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.evidenceItems.length === 0 ? (
                        <tr>
                          <td className="empty-cell" colSpan={5}>
                            未物化活动证据条目。
                          </td>
                        </tr>
                      ) : (
                        selected.evidenceItems.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <code title={item.id}>{shortId(item.evidenceId, 9)}</code>
                              <br />
                              <small>{zhLabel(item.polarity)}</small>
                            </td>
                            <td>
                              {titleCase(item.phase)}
                              <br />
                              <small>{titleCase(item.role)}</small>
                            </td>
                            <td>{item.blockNumber}</td>
                            <td>
                              {item.subjectA === undefined && item.subjectB === undefined
                                ? '未指定'
                                : `${shortId(item.subjectA ?? '未知', 7)} → ${shortId(item.subjectB ?? '未知', 7)}`}
                            </td>
                            <td>
                              <StatusPill status={item.reviewState} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
