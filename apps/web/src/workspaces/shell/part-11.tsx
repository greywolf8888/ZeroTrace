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
import { BitcoinForensicGraphPanel, SolanaDealerPanel } from './part-10.js';
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
          <span className="eyebrow">Control Campaign · 证据线 · replayable Snapshot</span>
          <h1>坐庄时间线</h1>
          <p>
            Follow token flow, cluster positions, behavior events, and forensic Evidence without
            silently turning labels into ownership or attribution into certainty.
          </p>
        </div>
        <StatusPill status="READ_ONLY" />
      </div>
      <section className="panel subject-panel quote-panel" data-testid="control-campaign-query">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Durable Postgres reports only</span>
            <h3>加载 Token 活动历史</h3>
          </div>
          <span className="snapshot-badge">Provider-free forensic export available</span>
        </div>
        <form
          className="quote-form control-campaign-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label htmlFor="campaign-chain">链 ID</label>
          <input
            id="campaign-chain"
            value={chainId}
            onChange={(event) => setChainId(event.target.value)}
            placeholder="eip155:56"
            spellCheck={false}
          />
          <label htmlFor="campaign-token">Token</label>
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
              {busy ? '加载中…' : 'Load campaigns'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || selected === undefined}
              onClick={() => void replay()}
            >
              Replay stored Snapshot
            </button>
          </div>
        </form>
        <p className="quote-note">
          Unknown, unavailable, stale, and provider-down remain distinct. An uncalibrated Evidence
          score is displayed as a score, never as a probability or ownership conclusion.
        </p>
        {error === undefined ? null : <p className="inline-error">{error}</p>}
      </section>

      <BitcoinForensicGraphPanel />

      <SolanaDealerPanel />

      {loaded && (showFundingLayer || showSettlementLayer) ? (
        <FundingSettlementPanel
          response={visibleFundingSettlement}
          error={visibleFundingSettlementError}
          layer={visibleFundingLayer}
        />
      ) : null}

      {loaded && records.length === 0 && error === undefined ? (
        <section className="panel empty-state" data-testid="control-campaign-empty">
          <strong>No durable Control Campaign report was found.</strong>
          <span>The token may not have been materialized, or storage is not configured.</span>
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
                <span className="eyebrow">Immutable campaign reports</span>
                <h3>活动索引</h3>
              </div>
              <span className="panel-note">{records.length} report(s)</span>
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
                    <small>block {record.campaign.startBlock}</small>
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
                    label="Campaign score"
                    value={campaign.evidenceScore.toFixed(3)}
                    detail="Uncalibrated Evidence score"
                    state="known"
                  />
                  <MetricTile
                    label="Controlled supply"
                    value={
                      campaign.controlledSupply.state === 'known'
                        ? (campaign.controlledSupply.value ?? 'Unknown')
                        : 'Unknown'
                    }
                    detail="Cluster position aggregate"
                    state={campaign.controlledSupply.state === 'known' ? 'known' : 'unknown'}
                  />
                  <MetricTile
                    label="Data coverage"
                    value={`${Math.round(campaign.evidenceCoverage * 100)}%`}
                    detail="已观测 campaign Evidence"
                    state={campaign.evidenceCoverage === 1 ? 'known' : 'unknown'}
                  />
                  <MetricTile
                    label="Source coverage"
                    value={`${Math.round(campaign.sourceCoverage * 100)}%`}
                    detail="Provider/source completeness"
                    state={campaign.sourceCoverage === 1 ? 'known' : 'unknown'}
                  />
                  <MetricTile
                    label="History coverage"
                    value={`${Math.round(campaign.historyCoverage * 100)}%`}
                    detail="Range completeness"
                    state={campaign.historyCoverage === 1 ? 'known' : 'unknown'}
                  />
                  <MetricTile
                    label="Wallets"
                    value={String(
                      campaign.coreWalletIds.length + campaign.satelliteWalletIds.length,
                    )}
                    detail="Core + satellite candidates"
                    state="known"
                  />
                </div>
                <div className="fact-grid">
                  <div className="fact-row">
                    <span>Campaign ID</span>
                    <code>{campaign.id}</code>
                  </div>
                  <div className="fact-row">
                    <span>Block range</span>
                    <span>
                      {campaign.startBlock} → <KnowledgeDisplay data={campaign.endBlock} />
                    </span>
                  </div>
                  <div className="fact-row">
                    <span>Snapshot position</span>
                    <code>{snapshotPosition}</code>
                  </div>
                  <div className="fact-row">
                    <span>Calibration</span>
                    <StatusPill status={campaign.calibrationStatus} />
                  </div>
                  <div className="fact-row">
                    <span>Campaign confidence</span>
                    <KnowledgeDisplay data={campaign.campaignConfidence} />
                  </div>
                  <div className="fact-row">
                    <span>Entity mutation</span>
                    <strong className="knowledge-unknown">已阻止</strong>
                  </div>
                  <div className="fact-row">
                    <span>Sources</span>
                    <span>{campaign.metadata.sourceSet.join(' · ')}</span>
                  </div>
                  <div className="fact-row">
                    <span>Result hash</span>
                    <code>{shortId(selected.resultHash, 18)}</code>
                  </div>
                </div>
                <div className="case-export-bar" data-testid="control-campaign-export">
                  <div>
                    <span className="eyebrow">Forensic Case Bundle</span>
                    <strong>Evidence closure · manifest hash · offline replay</strong>
                    {forensicCase === undefined ? null : (
                      <small>
                        {forensicCase.case.caseId} · {forensicCase.case.manifest.evidenceCount}{' '}
                        Evidence · {forensicCase.case.manifest.snapshotCount} Snapshots ·{' '}
                        {forensicCase.case.manifest.rawArtifactCount} raw artifacts
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
                    {busy ? 'Exporting…' : 'Export Case Bundle'}
                  </button>
                </div>
                <div className="case-export-bar monitor-bar" data-testid="control-campaign-monitor">
                  <div>
                    <span className="eyebrow">Incremental finalized monitor</span>
                    <strong>链上只读 schedule · reorg-aware cursor · no automatic action</strong>
                    {monitor === undefined ? (
                      <small>
                        Starts after Snapshot {snapshotPosition}; the worker captures only newly
                        finalized blocks.
                      </small>
                    ) : (
                      <small>
                        {monitor.monitor.monitorId} · {titleCase(monitor.monitor.status)} · next{' '}
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
                        ? 'A known safe Snapshot block is required to start a monitor.'
                        : undefined
                    }
                  >
                    {busy
                      ? 'Starting…'
                      : monitor === undefined
                        ? 'Start monitor'
                        : 'Replay monitor'}
                  </button>
                </div>
              </section>

              {comparisonReference === undefined ? null : (
                <section className="panel campaign-comparison" data-testid="campaign-comparison">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">
                        Immutable report comparison · descriptive only
                      </span>
                      <h3>活动对照</h3>
                    </div>
                    <StatusPill status="READ_ONLY" />
                  </div>
                  <p className="panel-copy">
                    This compares two stored Snapshot-bound reports. It does not infer ownership,
                    merge entities, or convert an uncalibrated score into probability.
                  </p>
                  <div className="metric-grid compact-grid">
                    <MetricTile
                      label="Wallet overlap"
                      value={
                        comparisonWalletOverlap === undefined
                          ? 'Unknown'
                          : `${comparisonWalletOverlap}%`
                      }
                      detail="Jaccard over observed core + satellite IDs"
                      state={comparisonWalletOverlap === undefined ? 'unknown' : 'known'}
                    />
                    <MetricTile
                      label="Wallet count Δ"
                      value={
                        comparisonWalletDelta === undefined
                          ? 'Unknown'
                          : String(comparisonWalletDelta)
                      }
                      detail="Selected minus reference report"
                      state={comparisonWalletDelta === undefined ? 'unknown' : 'known'}
                    />
                    <MetricTile
                      label="Evidence item Δ"
                      value={
                        comparisonEvidenceDelta === undefined
                          ? 'Unknown'
                          : String(comparisonEvidenceDelta)
                      }
                      detail="Selected minus reference report"
                      state={comparisonEvidenceDelta === undefined ? 'unknown' : 'known'}
                    />
                    <MetricTile
                      label="Coverage"
                      value={`${Math.round(campaign.evidenceCoverage * 100)}% → ${Math.round(comparisonReference.campaign.evidenceCoverage * 100)}%`}
                      detail="Selected → reference Evidence coverage"
                      state="known"
                    />
                  </div>
                  <div className="fact-grid">
                    <div className="fact-row">
                      <span>Selected report</span>
                      <code>{selected.campaign.id}</code>
                    </div>
                    <div className="fact-row">
                      <span>Reference report</span>
                      <code>{comparisonReference.campaign.id}</code>
                    </div>
                    <div className="fact-row">
                      <span>Snapshot positions</span>
                      <span>
                        {campaignSnapshotPosition(selected.campaign.snapshotEnd)} →{' '}
                        {campaignSnapshotPosition(comparisonReference.campaign.snapshotEnd)}
                      </span>
                    </div>
                    <div className="fact-row">
                      <span>Result hashes</span>
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
                    <span className="eyebrow">Forensic Alert Stream · Evidence-bound</span>
                    <h3>活动告警</h3>
                  </div>
                  <span className="panel-note">
                    {visibleAlertsLoaded ? `${visibleAlerts.length} alert(s)` : '加载中…'}
                  </span>
                </div>
                {visibleAlertsError !== undefined ? (
                  <p className="inline-error alert-state-message">{visibleAlertsError}</p>
                ) : !visibleAlertsLoaded ? (
                  <p className="empty-cell alert-state-message">Replaying durable alerts…</p>
                ) : visibleAlerts.length === 0 ? (
                  <p className="empty-cell alert-state-message">
                    No durable alert was materialized for this campaign.
                  </p>
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
                          {alert.evidenceIds.length} Evidence node(s) · confidence{' '}
                          <KnowledgeDisplay data={alert.confidence} /> ·{' '}
                          {formatTime(alert.createdAt)}
                        </p>
                        <small>
                          {alert.suppressionApplied.length === 0
                            ? 'No suppression applied.'
                            : `Suppression: ${alert.suppressionApplied.join(' · ')}`}
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
                      <span className="eyebrow">Conserved Cluster Position snapshots</span>
                      <h3>仓位时间线</h3>
                    </div>
                    <span className="panel-note">{selected.positions.length} snapshot(s)</span>
                  </div>
                  {selected.positions.length === 0 ? (
                    <p className="empty-cell">No conserved position snapshot was materialized.</p>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Block</th>
                            <th>Token balance</th>
                            <th>External in / out</th>
                            <th>Wallets</th>
                            <th>Sell-ready</th>
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
                      <span className="eyebrow">Behavior Events · ordered by observed range</span>
                      <h3>活动时间线</h3>
                    </div>
                    <span className="panel-note">{selected.behaviorEvents.length} event(s)</span>
                  </div>
                  {selected.behaviorEvents.length === 0 ? (
                    <p className="empty-cell">No behavior event was materialized.</p>
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
                            <p>{event.explanation}</p>
                            <small>
                              {event.supportingEvidenceIds.length} supporting Evidence · confidence{' '}
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
                    <span className="eyebrow">Forensic 证据线 · no direct entity merge</span>
                    <h3>证据线</h3>
                  </div>
                  <StatusPill status={evidenceLine.terminalBoundary} />
                </div>
                <div className="evidence-line-phases">
                  {evidenceLine.phases.map((phase) => (
                    <div className="evidence-line-phase" key={phase.phase}>
                      <div>
                        <strong>{titleCase(phase.phase)}</strong>
                        <span>{phase.itemIds.length} item(s)</span>
                      </div>
                      <div className="coverage-bar">
                        <span style={{ width: `${Math.round(phase.coverage * 100)}%` }} />
                      </div>
                      {phase.attributionStopped ? (
                        <small className="knowledge-unknown">Attribution stopped at boundary</small>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Evidence</th>
                        <th>Phase</th>
                        <th>Block</th>
                        <th>主体</th>
                        <th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.evidenceItems.length === 0 ? (
                        <tr>
                          <td className="empty-cell" colSpan={5}>
                            No campaign Evidence item was materialized.
                          </td>
                        </tr>
                      ) : (
                        selected.evidenceItems.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <code title={item.id}>{shortId(item.evidenceId, 9)}</code>
                              <br />
                              <small>{item.polarity}</small>
                            </td>
                            <td>
                              {titleCase(item.phase)}
                              <br />
                              <small>{titleCase(item.role)}</small>
                            </td>
                            <td>{item.blockNumber}</td>
                            <td>
                              {item.subjectA === undefined && item.subjectB === undefined
                                ? 'Not specified'
                                : `${shortId(item.subjectA ?? 'Unknown', 7)} → ${shortId(item.subjectB ?? 'Unknown', 7)}`}
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
