import { type HealthResponse } from '../../generated-api/client.js';
import { zhUserMessage } from '../../i18n/zh-CN.js';
import { ledgerLabel, ProviderTable } from './part-03.js';
import { StatusPill, titleCase, KnowledgeDisplay, shortId, formatTime } from './part-01.js';

export function DataHealth({
  health,
  refresh,
  busy,
}: {
  health?: HealthResponse | undefined;
  refresh: () => void;
  busy: boolean;
}) {
  const chainName = (ledger: string, chainId: string): string => {
    if (chainId === 'eip155:1') return '以太坊主网';
    if (chainId === 'eip155:56') return 'BNB 智能链主网';
    if (chainId === 'bitcoin-mainnet') return 'Bitcoin 主网';
    if (chainId === 'solana-mainnet') return 'Solana 主网';
    return `${ledgerLabel(ledger)} 网络`;
  };
  return (
    <>
      <div className="page-heading page-heading-row">
        <div>
          <span className="eyebrow">来源覆盖与新鲜度</span>
          <h1>数据健康</h1>
          <p>故障或未配置的数据源只会成为可用性状态，绝不会被折算成业务数值 0。</p>
        </div>
        <button className="secondary-button" type="button" onClick={refresh} disabled={busy}>
          {busy ? '检查中…' : '刷新数据源'}
        </button>
      </div>
      <section className="panel">
        <ProviderTable health={health} />
      </section>
      <section className="panel anchor-quality-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">共同位置核验</span>
            <h3>锚点对账与连续性</h3>
          </div>
          <StatusPill status={health?.dataQuality.status ?? 'CHECKING'} />
        </div>
        <p className="panel-copy">
          对照前会将各数据源链头降低到共同区块或时隙。端点运营方独立性在明确配置并核验前保持未知。
        </p>
        {(health?.dataQuality.results.length ?? 0) === 0 ? (
          <div className="inline-empty">
            {health?.dataQuality.errorCode === undefined
              ? '暂无锚点观测。'
              : titleCase(health.dataQuality.errorCode)}
          </div>
        ) : (
          <div className="anchor-quality-grid">
            {health?.dataQuality.results.map((result) => {
              const canonicalHash =
                result.canonicalAnchor.state === 'known'
                  ? result.canonicalAnchor.value?.hash
                  : undefined;
              const continuityKnown = result.sources.filter(
                (source) => source.continuity?.continuous.state === 'known',
              ).length;
              return (
                <article className="anchor-quality-card" key={result.chainId}>
                  <div className="provider-card-top">
                    <div>
                      <span className={'chain-tag chain-' + result.ledger.toLowerCase()}>
                        {ledgerLabel(result.ledger)}
                      </span>
                      <h3>{chainName(result.ledger, result.chainId)}</h3>
                    </div>
                    <StatusPill status={result.status} />
                  </div>
                  <dl>
                    <div>
                      <dt>来源</dt>
                      <dd>
                        已观测 {result.observedSources}/{result.configuredSources} · 需要{' '}
                        {result.requiredSources}
                      </dd>
                    </div>
                    <div>
                      <dt>共同位置</dt>
                      <dd>
                        <KnowledgeDisplay data={result.comparisonPosition} />
                      </dd>
                    </div>
                    <div>
                      <dt>规范哈希</dt>
                      <dd>
                        {canonicalHash === undefined ? (
                          <KnowledgeDisplay data={result.canonicalAnchor} />
                        ) : (
                          <code title={canonicalHash}>{shortId(canonicalHash, 8)}</code>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>连续性</dt>
                      <dd>
                        {continuityKnown}/{result.sources.length} 个来源检查已知
                      </dd>
                    </div>
                    <div>
                      <dt>独立性</dt>
                      <dd>
                        <KnowledgeDisplay data={result.sourceIndependence} />
                      </dd>
                    </div>
                    <div>
                      <dt>证据数</dt>
                      <dd>{result.metadata.evidenceIds.length}</dd>
                    </div>
                  </dl>
                  {result.alerts.map((alert) => (
                    <div className="provider-error" key={alert.id}>
                      {titleCase(alert.severity)} ·{' '}
                      {zhUserMessage(alert.summary, '检测到跨源数据质量告警。')}
                    </div>
                  ))}
                </article>
              );
            })}
          </div>
        )}
        <div className="snapshot-strip anchor-quality-footer">
          <span>
            <b>存储</b>{' '}
            {health === undefined ? '不可用' : health.dataQuality.durable ? '持久化' : '仅当前会话'}
          </span>
          <span>
            <b>检查时间</b> {formatTime(health?.dataQuality.checkedAt)}
          </span>
        </div>
      </section>
      <section className="health-grid">
        <article className="panel provider-card storage-card">
          <div className="provider-card-top">
            <div>
              <span className="chain-tag storage-tag">磁盘</span>
              <h3>低成本存储配额</h3>
            </div>
            <StatusPill status={health?.storageQuota?.level ?? 'CHECKING'} />
          </div>
          <p className="panel-copy">
            ZeroTrace 默认不超过当前可用空间的
            70%。案件证据永不自动删除；未覆盖区间保持未知，不会变成 0。
          </p>
          <dl>
            <div>
              <dt>当前使用</dt>
              <dd>{health?.storageQuota?.labels.used ?? '未知'}</dd>
            </div>
            <div>
              <dt>可重建数据</dt>
              <dd>{health?.storageQuota?.labels.rebuildable ?? '未知'}</dd>
            </div>
            <div>
              <dt>不可删除证据</dt>
              <dd>{health?.storageQuota?.labels.permanent ?? '未知'}</dd>
            </div>
            <div>
              <dt>每日增长</dt>
              <dd>{health?.storageQuota?.labels.dailyGrowth ?? '未知'}</dd>
            </div>
            <div>
              <dt>预计满盘日期</dt>
              <dd>{health?.storageQuota?.labels.fullAt ?? '未知'}</dd>
            </div>
            <div>
              <dt>正在清理的类别</dt>
              <dd>{health?.storageQuota?.labels.evicting ?? '无'}</dd>
            </div>
          </dl>
        </article>
        <article className="panel provider-card storage-card">
          <div className="provider-card-top">
            <div>
              <span className="chain-tag storage-tag">溯源</span>
              <h3>证据存储</h3>
            </div>
            <StatusPill status={health?.storage.status ?? 'CHECKING'} />
          </div>
          <dl>
            <div>
              <dt>持久性</dt>
              <dd>
                {health === undefined ? '不可用' : health.storage.durable ? '持久化' : '进程内'}
              </dd>
            </div>
            <div>
              <dt>检查时间</dt>
              <dd>{formatTime(health?.storage.checkedAt)}</dd>
            </div>
          </dl>
          {health?.storage.errorCode === undefined ? null : (
            <div className="provider-error">{titleCase(health.storage.errorCode)}</div>
          )}
        </article>
        <article className="panel provider-card storage-card">
          <div className="provider-card-top">
            <div>
              <span className="chain-tag storage-tag">历史</span>
              <h3>终局摄入存储</h3>
            </div>
            <StatusPill status={health?.ingestionStorage.status ?? 'CHECKING'} />
          </div>
          <dl>
            <div>
              <dt>原始事实</dt>
              <dd>{titleCase(health?.ingestionStorage.rawFacts.status ?? 'checking')}</dd>
            </div>
            <div>
              <dt>检查点</dt>
              <dd>{titleCase(health?.ingestionStorage.checkpoints.status ?? 'checking')}</dd>
            </div>
            <div>
              <dt>原始工件</dt>
              <dd>{titleCase(health?.ingestionStorage.artifacts.status ?? 'checking')}</dd>
            </div>
            <div>
              <dt>已配置</dt>
              <dd>
                {health === undefined
                  ? '不可用'
                  : `${health.ingestionStorage.configured}/${health.ingestionStorage.required}`}
              </dd>
            </div>
          </dl>
          {[
            health?.ingestionStorage.rawFacts,
            health?.ingestionStorage.checkpoints,
            health?.ingestionStorage.artifacts,
          ].map((component, index) =>
            component?.errorCode === undefined ? null : (
              <div className="provider-error" key={`${component.backend}-${index}`}>
                {['原始事实', '检查点', '原始资料'][index]}：{titleCase(component.errorCode)}
              </div>
            ),
          )}
        </article>
        <article className="panel provider-card storage-card">
          <div className="provider-card-top">
            <div>
              <span className="chain-tag storage-tag">图谱</span>
              <h3>调查投影</h3>
            </div>
            <StatusPill status={health?.graphProjection?.status ?? 'UNCONFIGURED'} />
          </div>
          <dl>
            <div>
              <dt>运行方式</dt>
              <dd>{health?.graphProjection?.status === 'UP' ? '持久化图谱' : '尚未可用'}</dd>
            </div>
            <div>
              <dt>事实来源</dt>
              <dd>已持久化案件报告</dd>
            </div>
            <div>
              <dt>图谱状态</dt>
              <dd>{titleCase(health?.graphProjection?.status ?? 'UNCONFIGURED')}</dd>
            </div>
            <div>
              <dt>检查时间</dt>
              <dd>{formatTime(health?.graphProjection?.checkedAt)}</dd>
            </div>
          </dl>
          {health?.graphProjection?.errorCode === undefined ? null : (
            <div className="provider-error">{titleCase(health.graphProjection.errorCode)}</div>
          )}
        </article>
        {(health?.providers ?? []).map((provider, index) => (
          <article className="panel provider-card" key={provider.id}>
            <div className="provider-card-top">
              <div>
                <span className={'chain-tag chain-' + provider.ledger.toLowerCase()}>
                  {ledgerLabel(provider.ledger)}
                </span>
                <h3>
                  {ledgerLabel(provider.ledger)} 数据源 {index + 1}
                </h3>
              </div>
              <StatusPill status={provider.status} />
            </div>
            <dl>
              <div>
                <dt>检查时间</dt>
                <dd>{formatTime(provider.checkedAt)}</dd>
              </div>
              <div>
                <dt>链头</dt>
                <dd>
                  {provider.head.state === 'known'
                    ? provider.head.value
                    : titleCase(provider.head.reason ?? 'unknown')}
                </dd>
              </div>
              <div>
                <dt>延迟</dt>
                <dd>{provider.latencyMs === null ? '不可用' : provider.latencyMs + ' ms'}</dd>
              </div>
              <div>
                <dt>能力数</dt>
                <dd>{provider.capabilities.length}</dd>
              </div>
            </dl>
            {provider.errorDetail === undefined ? null : (
              <div className="provider-error">
                {zhUserMessage(provider.errorDetail, '数据源暂不可用，请稍后重试。')}
              </div>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
