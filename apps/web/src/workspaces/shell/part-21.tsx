import { useEffect, useState, type FormEvent } from 'react';

import {
  api,
  type HealthResponse,
  type ResearchSourceSettingsResponse,
  type SocialObservationWindowView,
} from '../../generated-api/client.js';
import { zhUserMessage } from '../../i18n/zh-CN.js';
import { ledgerLabel, ProviderTable } from './part-03.js';
import { StatusPill, titleCase, KnowledgeDisplay, shortId, formatTime } from './part-01.js';

function localDateTime(milliseconds: number): string {
  const date = new Date(milliseconds);
  return new Date(milliseconds - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function mergeWindows(
  current: SocialObservationWindowView[],
  incoming: SocialObservationWindowView[],
): SocialObservationWindowView[] {
  const merged = new Map(current.map((window) => [window.id, window]));
  for (const window of incoming) merged.set(window.id, window);
  return [...merged.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function SocialObservationControls({
  researchSources,
}: {
  researchSources?: ResearchSourceSettingsResponse | undefined;
}) {
  const [providerId, setProviderId] = useState('');
  const [chain, setChain] = useState<'BSC' | 'SOLANA'>('BSC');
  const [address, setAddress] = useState('');
  const [from, setFrom] = useState(() => localDateTime(Date.now() - 24 * 60 * 60 * 1_000));
  const [until, setUntil] = useState(() => localDateTime(Date.now()));
  const [pageSize, setPageSize] = useState(30);
  const [queryVersion, setQueryVersion] = useState('social-query-v1');
  const [windows, setWindows] = useState<SocialObservationWindowView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [attemptKeys, setAttemptKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const load = async (after?: string) => {
    setBusy('list');
    setError(undefined);
    try {
      const page = await api.socialObservationWindows(after, 50);
      setWindows((current) =>
        after === undefined ? page.records : mergeWindows(current, page.records),
      );
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(
        zhUserMessage(
          cause instanceof Error ? cause.message : cause,
          '暂时无法读取持久社交观察窗口。',
        ),
      );
    } finally {
      setBusy(undefined);
    }
  };

  useEffect(() => {
    let active = true;
    void api
      .socialObservationWindows(undefined, 50)
      .then((page) => {
        if (!active) return;
        setWindows(page.records);
        setNextCursor(page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          zhUserMessage(
            cause instanceof Error ? cause.message : cause,
            '暂时无法读取持久社交观察窗口。',
          ),
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const source = researchSources?.sources.find(
      (candidate) => candidate.providerId === providerId,
    );
    if (source?.status !== 'READY') {
      setError('请选择身份、权益、费用与端点合同均已核验的来源。');
      return;
    }
    setBusy('create');
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await api.createSocialObservationWindows({
        providerId,
        queryVersion: queryVersion.trim(),
        pageSize,
        from: new Date(from).toISOString(),
        until: new Date(until).toISOString(),
        identity: { chain, address: address.trim() },
      });
      setWindows((current) => mergeWindows(current, result.windows));
      setMessage(result.warning);
    } catch (cause) {
      setError(
        zhUserMessage(cause instanceof Error ? cause.message : cause, '创建社交观察窗口失败。'),
      );
    } finally {
      setBusy(undefined);
    }
  };

  const fetchNext = async (window: SocialObservationWindowView) => {
    const source = researchSources?.sources.find(
      (candidate) => candidate.providerId === window.providerId,
    );
    if (source?.dispatchAllowed !== true) {
      setError('该来源当前没有持久额度、核验权益或发网许可，禁止读取。');
      return;
    }
    const idempotencyKey =
      attemptKeys[window.id] ??
      `ui:${window.id}:${window.revision}:${globalThis.crypto.randomUUID()}`;
    setAttemptKeys((current) => ({ ...current, [window.id]: idempotencyKey }));
    setBusy(window.id);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await api.fetchNextSocialObservationWindow(window.id, idempotencyKey);
      setWindows((current) => mergeWindows(current, [result.window]));
      setAttemptKeys((current) => {
        const next = { ...current };
        delete next[window.id];
        return next;
      });
      setMessage(
        result.replayed
          ? '已按原幂等键返回持久分页收据，没有再次发网。'
          : `已持久化 ${result.receipt.recordsPersisted} 条观察，并原子推进游标与免费额度。`,
      );
    } catch (cause) {
      setError(
        zhUserMessage(
          cause instanceof Error ? cause.message : cause,
          '读取失败；当前幂等键会保留，重试不会无意重复发网。',
        ),
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="panel source-settings-panel social-observation-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">持久分页 · 幂等发网 · 删除可传播</span>
          <h3>X 社交观察窗口</h3>
        </div>
        <StatusPill status={windows.length > 0 ? 'DURABLE' : 'EMPTY'} />
      </div>
      <p className="panel-copy">
        创建窗口不会发网；逐页读取要求管理员与 MFA，并先在现有采购权威预占已核验免费额度。xapid
        身份未知时仍会在发网前失败关闭。
      </p>
      <form className="quote-form social-observation-form" onSubmit={(event) => void create(event)}>
        <div className="claim-burn-field">
          <label htmlFor="social-source">来源合同</label>
          <select
            id="social-source"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            required
          >
            <option value="">选择经核验来源</option>
            {(researchSources?.sources ?? []).map((source) => (
              <option
                key={source.providerId}
                value={source.providerId}
                disabled={source.status !== 'READY' || source.observationWindowSupported !== true}
              >
                {source.displayName} · {source.status} ·
                {source.observationWindowSupported ? '时间窗已核验' : '时间窗未核验'}
              </option>
            ))}
          </select>
        </div>
        <div className="claim-burn-field">
          <label htmlFor="social-chain">链</label>
          <select
            id="social-chain"
            value={chain}
            onChange={(event) => setChain(event.target.value as 'BSC' | 'SOLANA')}
          >
            <option value="BSC">BNB 智能链</option>
            <option value="SOLANA">Solana</option>
          </select>
        </div>
        <div className="claim-burn-field social-address-field">
          <label htmlFor="social-address">合约 / mint 地址</label>
          <input
            id="social-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={chain === 'BSC' ? '0x…' : 'Base58 mint'}
            required
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="social-from">开始时间</label>
          <input
            id="social-from"
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="social-until">结束时间</label>
          <input
            id="social-until"
            type="datetime-local"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
            required
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="social-page-size">每页上限</label>
          <input
            id="social-page-size"
            type="number"
            min={1}
            max={1000}
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            required
          />
        </div>
        <div className="claim-burn-field">
          <label htmlFor="social-query-version">查询版本</label>
          <input
            id="social-query-version"
            value={queryVersion}
            onChange={(event) => setQueryVersion(event.target.value)}
            required
          />
        </div>
        <div className="control-actions">
          <button className="primary-button" type="submit" disabled={busy !== undefined}>
            {busy === 'create' ? '持久化中…' : '创建只读窗口'}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void load()}
            disabled={busy !== undefined}
          >
            刷新窗口
          </button>
        </div>
      </form>
      {error === undefined ? null : (
        <div className="provider-error social-window-message">{error}</div>
      )}
      {message === undefined ? null : (
        <div className="snapshot-strip social-window-message">{message}</div>
      )}
      {windows.length === 0 ? (
        <div className="inline-empty">暂无持久社交观察窗口。</div>
      ) : (
        <div className="health-grid social-window-grid">
          {windows.map((window) => {
            const source = researchSources?.sources.find(
              (candidate) => candidate.providerId === window.providerId,
            );
            return (
              <article className="provider-card" key={window.id}>
                <div className="provider-card-top">
                  <div>
                    <span className="chain-tag">{window.ledger === 'EVM' ? 'BSC' : 'SOLANA'}</span>
                    <h3>{window.queryRole}</h3>
                  </div>
                  <StatusPill status={window.completed ? 'COMPLETE' : 'PENDING'} />
                </div>
                <dl>
                  <div>
                    <dt>窗口</dt>
                    <dd title={window.id}>{shortId(window.id, 9)}</dd>
                  </div>
                  <div>
                    <dt>来源</dt>
                    <dd>{window.providerId}</dd>
                  </div>
                  <div>
                    <dt>分页</dt>
                    <dd>
                      {window.pages} 页 · 修订 {window.revision}
                    </dd>
                  </div>
                  <div>
                    <dt>覆盖</dt>
                    <dd>
                      {window.coverage === 'ACCESSIBLE_QUERY_RESULTS_PROCESSED'
                        ? '可访问结果已处理'
                        : '尚未完成'}
                    </dd>
                  </div>
                  <div>
                    <dt>游标</dt>
                    <dd>
                      {window.cursor === null
                        ? window.completed
                          ? '已结束'
                          : '起始页'
                        : '已持久化'}
                    </dd>
                  </div>
                  <div>
                    <dt>更新时间</dt>
                    <dd>{formatTime(window.updatedAt)}</dd>
                  </div>
                </dl>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void fetchNext(window)}
                  disabled={
                    busy !== undefined || window.completed || source?.dispatchAllowed !== true
                  }
                  title={
                    source?.dispatchAllowed === true
                      ? '预占一次已核验免费单位并读取下一页'
                      : '来源或持久额度尚未允许发网'
                  }
                >
                  {busy === window.id
                    ? '读取并落盘中…'
                    : window.completed
                      ? '分页完成'
                      : '读取下一页'}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {nextCursor === null ? null : (
        <div className="panel-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void load(nextCursor)}
            disabled={busy !== undefined}
          >
            加载更早窗口
          </button>
        </div>
      )}
    </section>
  );
}

export function DataHealth({
  health,
  researchSources,
  refresh,
  busy,
}: {
  health?: HealthResponse | undefined;
  researchSources?: ResearchSourceSettingsResponse | undefined;
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
      <section className="panel source-settings-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">零预算采购与来源授权</span>
            <h3>X / xapid 设置</h3>
          </div>
          <StatusPill status={researchSources?.procurement.status ?? 'UNAVAILABLE'} />
        </div>
        <p className="panel-copy">
          数据采购预算默认 0，密钥不代表付费同意。所有 X
          读取工具属于同一上游来源组，不增加证据权重。
        </p>
        <div className="health-grid">
          <article className="provider-card storage-card">
            <h3>持久预算</h3>
            <dl>
              <div>
                <dt>采购预算</dt>
                <dd>{researchSources?.procurementBudgetMicrousd ?? '未知'} 微美元</dd>
              </div>
              <div>
                <dt>付费来源</dt>
                <dd>{researchSources?.procurement.paidEnabled === true ? '已明确启用' : '关闭'}</dd>
              </div>
              <div>
                <dt>持久状态</dt>
                <dd>{researchSources?.procurement.status ?? '不可用'}</dd>
              </div>
              <div>
                <dt>剩余额度</dt>
                <dd>{researchSources?.procurement.remainingMicrousd ?? '未知'}</dd>
              </div>
            </dl>
          </article>
          {(researchSources?.sources ?? [])
            .filter((source) => source.providerId === 'xapid' || source.providerId === 'fxembed')
            .map((source) => (
              <article className="provider-card" key={source.providerId}>
                <div className="provider-card-top">
                  <div>
                    <span className="chain-tag">X</span>
                    <h3>{source.displayName}</h3>
                  </div>
                  <StatusPill status={source.status} />
                </div>
                <dl>
                  <div>
                    <dt>服务身份</dt>
                    <dd>{source.identityVerified ? '已核验' : '待确认'}</dd>
                  </div>
                  <div>
                    <dt>使用权</dt>
                    <dd>{source.rightsApproved ? '已批准' : '未批准'}</dd>
                  </div>
                  <div>
                    <dt>端点合同</dt>
                    <dd>{source.endpointConfigured ? '已配置' : '未知'}</dd>
                  </div>
                  <div>
                    <dt>网络调用</dt>
                    <dd>{source.dispatchAllowed ? '允许' : '禁止'}</dd>
                  </div>
                  <div>
                    <dt>历史时间窗</dt>
                    <dd>{source.observationWindowSupported ? '合同已核验' : '未核验'}</dd>
                  </div>
                </dl>
                {source.providerId === 'xapid' && !source.identityVerified ? (
                  <div className="provider-error">
                    需要准确服务域名、官方服务说明、授权范围和计费证据；系统不会猜测。
                  </div>
                ) : null}
              </article>
            ))}
        </div>
      </section>
      <SocialObservationControls researchSources={researchSources} />
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
