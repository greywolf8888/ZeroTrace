import type { FastifyInstance } from 'fastify';
import { resolveSourceOperators } from '@zerotrace/data-quality';
import { LAUNCHPAD_PROTOCOL_REGISTRY, PLATFORM_REGISTRY } from '@zerotrace/platform-adapters';
import type { AppHttpContext } from '../http/context.js';

export async function registerSystemRoutes(
  app: FastifyInstance,
  ctx: AppHttpContext,
): Promise<void> {
  const {
    runtime,
    config,
    metricsRegistry,
    providerHealth,
    storageHealth,
    ingestionStorageHealth,
    dataQualityHealth,
    graphProjectionHealth,
  } = ctx;
  app.get('/health/live', { schema: { tags: ['system'] } }, async () => ({
    status: 'UP',
    service: 'zerotrace-api',
    version: '0.1.0',
    readOnly: true,
    checkedAt: new Date().toISOString(),
  }));

  app.get('/health/ready', { schema: { tags: ['system'] } }, async (_request, reply) => {
    const [providers, storage, graphProjection] = await Promise.all([
      providerHealth(),
      storageHealth(),
      graphProjectionHealth(),
    ]);
    const serviceReady = storage.status !== 'DOWN';
    const status =
      providers.some((provider) => provider.status === 'UP') && serviceReady ? 'UP' : 'DEGRADED';
    return reply.code(serviceReady ? 200 : 503).send({
      status,
      service: 'zerotrace-api',
      readOnly: true,
      providers,
      storage,
      graphProjection,
      checkedAt: new Date().toISOString(),
    });
  });

  app.get('/health', { schema: { tags: ['system'] } }, async () => {
    const [providers, storage, ingestionStorage, dataQuality, graphProjection] = await Promise.all([
      providerHealth(),
      storageHealth(),
      ingestionStorageHealth(),
      dataQualityHealth(),
      graphProjectionHealth(),
    ]);
    return {
      status:
        providers.some((provider) => provider.status === 'UP') &&
        storage.status !== 'DOWN' &&
        ingestionStorage.status !== 'DOWN' &&
        !['DOWN', 'DEGRADED'].includes(dataQuality.status)
          ? 'UP'
          : 'DEGRADED',
      service: 'zerotrace-api',
      readOnly: true,
      providers,
      storage,
      ingestionStorage,
      dataQuality,
      graphProjection,
      storageQuota:
        runtime.storagePlane === undefined ? undefined : await runtime.storagePlane.inspectQuota(),
      checkedAt: new Date().toISOString(),
    };
  });

  app.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
    reply.header('content-type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });

  app.get('/api/v1/data-quality/anchors', { schema: { tags: ['system'] } }, async () =>
    dataQualityHealth(),
  );

  const dataQualityConfiguredSources = runtime.dataQuality.configuredSources();
  const dataQualityReady = Object.values(dataQualityConfiguredSources).some(
    (count) => count >= config.dataQualityMinSources,
  );
  const bscReconciliationSources =
    runtime.evmSourceAdapters?.get(56)?.map((adapter) => adapter.sourceId) ?? [];
  const bscOperatorResolution = resolveSourceOperators(bscReconciliationSources);
  const bscReconciliationStatus =
    bscReconciliationSources.length < config.dataQualityMinSources
      ? 'TWO_BSC_ENDPOINTS_REQUIRED'
      : bscOperatorResolution.independence.state !== 'known'
        ? 'IMPLEMENTED_OPERATOR_REGISTRY_INCOMPLETE'
        : bscOperatorResolution.independence.value
          ? 'IMPLEMENTED_OPERATOR_INDEPENDENCE_CONFIGURED'
          : 'IMPLEMENTED_SAME_OPERATOR_INCONCLUSIVE';

  app.get('/api/v1/capabilities', { schema: { tags: ['system'] } }, async () => ({
    readOnly: true,
    core: [
      { id: 'canonical-schemas', status: 'IMPLEMENTED' },
      {
        id: 'paper-simulation',
        status:
          runtime.paperSimulation === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_DUAL_CHAIN_LIVE_ACCEPTANCE',
        detail:
          'BSC/Solana 模拟实验使用版本化本金与仓位策略、原子命令/事件/发件箱、revision 围栏、业务键去重和稳定游标；冻结命令日志可生成带 Snapshot、覆盖率、来源集、历史新鲜度和非概率证据分数的交易复盘与拒绝反事实报告。只修改本地模拟账本，不签名、不广播、不移动真实资金；真实双链行情、成本、退出容量与外部提醒送达仍受各自实链门禁约束。',
      },
      {
        id: 'evidence-ledger',
        status:
          runtime.evidenceRepository === undefined
            ? 'IMPLEMENTED_EPHEMERAL'
            : 'IMPLEMENTED_DURABLE',
        detail:
          runtime.evidenceRepository === undefined
            ? 'POSTGRES_URL is absent; Evidence is process-local.'
            : 'PostgreSQL append-only Evidence and Snapshot persistence is configured.',
      },
      {
        id: 'control-campaign-p0',
        status:
          runtime.controlCampaignReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PROVIDER_FREE_REPLAY',
        detail:
          'Token Flow, candidate screening, conserved Cluster Positions, Behavior Events, deterministic Campaign bundles, Evidence-bound alerts, and provider-free Campaign/SSE replay are wired from immutable PostgreSQL reports. Real token-history discovery and provider-backed backfill are wired; calibration and independent acceptance remain explicit pending boundaries.',
      },
      {
        id: 'global-intelligence-search',
        status:
          runtime.intelligenceSearch === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_EXACT_PROJECTION',
        detail:
          'Exact identifier, registered label, and label-category lookup projects immutable Evidence-bound reports plus registered Entity memberships from PostgreSQL. Symbol/ticker, platform/project lexical lookup, complete Subject Registry coverage, and semantic checkpoint indexing remain explicit gaps. An empty projection never means that a subject does not exist on-chain.',
      },
      {
        id: 'label-intelligence',
        status:
          runtime.labelIntelligenceReports === undefined || runtime.evidenceRepository === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_OBSERVATION_SNAPSHOT',
        detail:
          'Materializes all registered observations for one ledger-scoped Subject into an immutable Label Snapshot with source-priority review order, freshness states, preserved conflicts, conservative Service Hub suppression and terminal Evidence. Labels never merge Entities, risk labels never imply common control, and same text never merges subjects across chains. External label-source adapters and complete registry coverage remain pending.',
      },
      {
        id: 'evm-current-state',
        status: runtime.evmAdapters.size > 0 ? 'IMPLEMENTED' : 'PROVIDER_REQUIRED',
      },
      {
        id: 'bitcoin-esplora',
        status: runtime.bitcoinAdapter === undefined ? 'PROVIDER_REQUIRED' : 'IMPLEMENTED',
      },
      {
        id: 'solana-current-state',
        status: runtime.solanaAdapter === undefined ? 'PROVIDER_REQUIRED' : 'IMPLEMENTED',
      },
      {
        id: 'typed-ledger-query',
        status:
          runtime.evmAdapters.size > 0 &&
          runtime.bitcoinAdapter !== undefined &&
          runtime.solanaAdapter !== undefined
            ? 'IMPLEMENTED'
            : 'PROVIDERS_PARTIALLY_CONFIGURED',
        detail:
          'Read-only EVM transaction/block, Bitcoin address/transaction/block/outpoint, and Solana transaction/slot queries use strict provider-response validation and bind observations to Evidence plus replayable Snapshots. Bitcoin transactions add conservative common-input/change candidates with CoinJoin/Payjoin/service suppression and no automatic entity merge. Solana transactions normalize legacy/v0 messages, loaded ALT accounts, signer/writable flags, outer/CPI instructions, official System/SPL/Token-2022 core asset-flow semantics and recorded SOL/SPL balance effects while preserving missing owners, extension state and metadata as Unknown. Null, pending, mempool, and provider failures remain distinct.',
      },
      {
        id: 'query-lab-ast-guard',
        status: 'IMPLEMENTED_PLAN_ONLY_EXECUTION_DISABLED',
        detail:
          'PostgreSQL SQL 先解析为类型化 AST，再只接受单条、静态 LIMIT、Curated/Research 关系白名单与确定性函数白名单的 SELECT。DDL/DML、锁、表值函数、系统关系、文件/网络表面、当前会话状态、动态 LIMIT、参数缺口和过量扫描计划均失败关闭。迁移 044 提供两个最小脱敏安全视图，但独立只读角色、租户 RLS、取消/成本执行器与真实 PostgreSQL 验收完成前只返回计划，不执行 SQL。',
      },
      {
        id: 'flap-bsc-inspection',
        status: runtime.evmAdapters.has(56)
          ? 'PARTIALLY_IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'Versioned read-only Flap Portal V8Safe/V6/V5 decoding binds deployment metadata, bytecode, raw state, normalized launch fields, Snapshot, and Evidence. Transaction-local TokenCreated/configuration/migration decoding is available separately; automatic history discovery, tax/vault internals, migration/LP control analysis, and complete realizable value remain pending.',
      },
      {
        id: 'flap-event-transaction',
        status: runtime.evmAdapters.has(56)
          ? 'IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'A caller-supplied Flap transaction hash is decoded against the versioned Portal event interface at its exact block. Creation defaults remain source-tagged, unavailable curve internals remain Unknown, and migration facts carry receipt/log/derived Evidence. Chain-wide discovery remains pending.',
      },
      {
        id: 'flap-bounded-event-history',
        status: runtime.evmAdapters.has(56)
          ? 'IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'Bounded Portal log ranges use the finalized SQD BSC stream when configured, with strict RPC-log fallback, then decode by token and replay exact RPC receipts/block hashes. Requested-range coverage is distinct from token-lifetime coverage, which remains Unknown until deployment-origin indexing is continuous.',
      },
      {
        id: 'flap-event-history-projection',
        status:
          runtime.semanticCheckpoints === undefined || runtime.flapHistoryProjection === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A one-shot worker with separately configured SQD/BSC read providers projects wider finalized ranges as immutable bounded segments, persists each segment before cursor advancement, and resumes one exact pending segment after interruption. This API replays stored scan-ID pages without providers. Requested-range completion does not imply continuous token-lifetime coverage.',
      },
      {
        id: 'erc20-burn-candidate-promotion',
        status:
          runtime.semanticCheckpoints === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_INDEPENDENT_VALIDATION',
        detail:
          'A read-only BSC worker checkpoints complete zero-address event segments only after every candidate has an exact-block totalSupply/Transfer conservation certificate. Scan-ID API/UI replay uses PostgreSQL only, rejects corrupt state, and keeps silent supply-change detection Unknown.',
      },
      {
        id: 'evm-pension-behavior-candidate-discovery',
        status:
          runtime.evidenceRepository === undefined || runtime.pensionCandidateReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : !runtime.evmAdapters.has(56)
              ? 'BSC_PROVIDER_REQUIRED'
              : runtime.sqdBscLogReader === undefined
                ? 'SQD_PROVIDER_REQUIRED'
                : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A caller-supplied, versioned share-unit/depositor policy scans a complete finalized BSC ERC-20 Transfer range, emits only behavioral wallet candidates, and persists an immutable Evidence-linked report for provider-free replay. Official pension role, participant exit policy and dividend execution remain Unknown until independent source and flow Evidence support them.',
      },
      {
        id: 'flap-pension-entry-economics',
        status:
          runtime.evidenceRepository === undefined ||
          runtime.pensionCandidateReports === undefined ||
          runtime.pensionEntryReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : !runtime.evmAdapters.has(56)
              ? 'BSC_PROVIDER_REQUIRED'
              : 'IMPLEMENTED_PENDING_PINNED_FORK_EXECUTION',
        detail:
          'A durable pension-behavior candidate is joined to same-Snapshot Pancake V2 buy scenarios to calculate modeled whole-share capacity, remainder and average acquisition cost across input sizes, then stored as an immutable content-addressed Scenario Report for provider-free replay. The non-zero destination remains custody rather than supply burn; actual receipt, transfer tax/swapback, irreversibility and dividend execution remain Unknown.',
      },
      {
        id: 'erc20-supply-continuity',
        status:
          runtime.semanticCheckpoints === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : (runtime.evmSourceAdapters?.get(56)?.length ?? 0) < 2
              ? 'IMPLEMENTED_DURABLE_INCONCLUSIVE_SOURCE_COVERAGE'
              : 'IMPLEMENTED_DURABLE_OPERATOR_REGISTRY_GATED',
        detail:
          'A read-only BSC worker samples ERC-20 totalSupply at every finalized block transition with EIP-1898 canonical block-hash calls, compares every configured source exactly, and reconciles each supply change against complete same-block mint/burn Transfer Evidence before checkpoint advancement. Verified status additionally requires two officially registered operators; completed scan replay is provider-free.',
      },
      {
        id: 'flap-lifetime-materialization',
        status:
          runtime.semanticCheckpoints === undefined || runtime.flapHistoryProjection === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A one-shot worker composes official SQD dataset-start metadata, unique Flap deployment origin, and immutable origin-to-target event history at one exact finalized BSC Snapshot. Lifetime coverage is Known only when every child proof is complete; this API replays the composite checkpoint by scan ID without contacting providers.',
      },
      {
        id: 'flap-lifetime-heads',
        status:
          runtime.semanticCheckpoints === undefined ||
          runtime.flapHistoryProjection === undefined ||
          runtime.flapLifetimeHeads === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A continuous read-only worker reconciles a finalized BSC endpoint quorum, accepts one exact INITIAL lifetime materialization, then appends only Evidence-proven continuous deltas. A finalized conflict triggers all-source historical verification, append-only suffix invalidation and safe replay from the newest verified ancestor; unavailable or disagreeing sources cannot choose a branch. The latest accepted state replays without providers; forced real-reorg and independent-operator acceptance remain pending.',
      },
      {
        id: 'flap-token-origin',
        status: !runtime.evmAdapters.has(56)
          ? 'BSC_PROVIDER_REQUIRED'
          : runtime.sqdBscCreationReader === undefined
            ? 'SQD_PROVIDER_REQUIRED'
            : runtime.semanticCheckpoints === undefined
              ? 'IMPLEMENTED_EPHEMERAL_PENDING_REAL_CHAIN_VALIDATION'
              : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A synchronous, range-limited finalized SQD create-trace search validates multi-response continuation metadata and rebinds a unique result to the exact BSC receipt, TokenCreated event, and Snapshot. When PostgreSQL is configured, every bounded chunk and terminal result resumes through immutable semantic checkpoints. Empty bounded ranges produce negative Evidence but never imply lifetime absence; the continuous lifetime scheduler composes this primitive only after exact coverage.',
      },
      {
        id: 'flap-bsc-sell-preview',
        status: runtime.evmAdapters.has(56)
          ? 'PARTIALLY_IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'Read-only Portal previewSell produces a fixed-block, provider-observed quote with Evidence. Non-tradable, migrated, unsupported, excessive-input, and provider-failure states never become zero proceeds.',
      },
      {
        id: 'cross-source-anchor-reconciliation',
        status: dataQualityReady
          ? runtime.dataQuality.durable
            ? 'IMPLEMENTED_DURABLE_PENDING_INDEPENDENT_VALIDATION'
            : 'IMPLEMENTED_EPHEMERAL_PENDING_INDEPENDENT_VALIDATION'
          : 'INDEPENDENT_PROVIDERS_REQUIRED',
        detail:
          'Common-position anchor comparison, continuity checks, reorg alerts, and explicit disagreement states are wired. Endpoint operator independence is not inferred from hostnames.',
      },
      {
        id: 'typed-discrepancy-audit',
        status: 'IMPLEMENTED_DETERMINISTIC',
        detail:
          'Evidence-grounded same-Snapshot comparisons enforce zero mismatch for exact state, exact-decimal typed budgets for derived/quote/aggregate values, warning bands, coverage gates, and Unknown exclusion from numeric denominators.',
      },
      {
        id: 'flap-pancake-v2-multi-source-reconciliation',
        status: bscReconciliationStatus,
        detail:
          'Each reconciled BSC endpoint independently reruns the complete Flap/Pancake V2 market, buy and sell certificate at one agreed finalized block. Exact state and typed 0.50% market/RV budgets fail closed; source independence becomes Known only for endpoints matched by the versioned official operator registry.',
      },
      {
        id: 'evm-control-surface',
        status:
          runtime.controlSurfaces === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : runtime.evmAdapters.size === 0
              ? 'EVM_PROVIDER_REQUIRED'
              : runtime.evmSourceVerification === undefined
                ? 'IMPLEMENTED_STANDARD_SURFACE_SOURCE_PROVIDER_OPTIONAL'
                : 'IMPLEMENTED_STANDARD_AND_SOURCE_SURFACE',
        detail:
          'Finalized multi-source EVM inspection covers exact ERC-1167 bytecode, EIP-1967 implementation/admin/beacon slots, ERC-173 owner(), registered Safe owners/threshold, and Snapshot-bound runtime logic code. Optional Sourcify V2 metadata is accepted only on exact bytecode equality; declared ABI mutations stay separate from effective rights. Reports and Evidence replay without providers. Effective custom authorization, history, and controller recursion remain pending.',
      },
      {
        id: 'solana-control-surface',
        status:
          runtime.solanaControlSurfaces === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : runtime.solanaAdapter === undefined
              ? 'SOLANA_PROVIDER_REQUIRED'
              : 'IMPLEMENTED_TOKEN_PROGRAM_AND_LOADER_V3',
        detail:
          'One finalized-slot account set is decoded with official SPL Token and Token-2022 codecs, including base authorities, classic multisig thresholds, extension authorities, and loader-v3 ProgramData upgrade authority. Reports replay without providers. Squads configuration, Anchor IDL, verifiable builds, authority history, and recursive controllers remain explicit Unknown.',
      },
      {
        id: 'solana-transaction-semantic-replay',
        status:
          runtime.solanaTransactionReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : runtime.solanaAdapter === undefined
              ? 'IMPLEMENTED_PROVIDER_FREE_REPLAY_ONLY'
              : 'IMPLEMENTED_DURABLE_LIVE_AND_REPLAY',
        detail:
          'Finalized Solana transaction semantics, official core asset flows, exact token reconciliation and their complete Evidence set are stored as immutable content-addressed reports. Latest/exact replay remains available without a provider and is explicitly marked as replayed.',
      },
      {
        id: 'action-semantics',
        status:
          runtime.actionSemanticsReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PROVIDER_FREE_REPLAY',
        detail:
          'Chain-neutral EVM, Bitcoin and Solana action primitives persist as immutable content-addressed reports with canonical transaction identities, exact Snapshot-bound Evidence closure and non-derived source provenance. Latest/exact reads never contact a provider; the durable capture scheduler and Token History backfill binding are separate from the action report surface. There is no public report-write endpoint.',
      },
      {
        id: 'claim-declaration-replay',
        status:
          runtime.claimDeclarationReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_SOURCE_DOCUMENT_REPLAY',
        detail:
          'Submitted EVM declarations retain the exact source document as a content-addressed Snapshot, deterministic extraction coverage, direct source and terminal Evidence, and an immutable report. Exact/latest reads do not contact a provider. Source authenticity, independent corroboration, chain verification and non-EVM declaration normalization remain explicit Unknown or pending.',
      },
      {
        id: 'claim-rule-review-replay',
        status:
          runtime.claimRuleReviewReports === undefined ||
          runtime.claimDeclarationReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_EXPECTED_RULE_REVIEW',
        detail:
          'Human-confirmed or overridden declaration fields materialize immutable Expected Claim rules with exact source/review Evidence and provider-free replay. Claim truth, reviewer authority, chain verification and confidence remain explicitly Unknown until separate deterministic observation and audit stages complete.',
      },
      {
        id: 'claim-verification-observation',
        status:
          runtime.claimVerificationReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_BSC_CAPTURE_AND_REPLAY',
        detail:
          'The generic CLAIM_ACTIONS capture handler binds one reviewed EVM rule revision to a bounded finalized BSC range, captures source/destination custody and ERC-20 transfer Evidence under one terminal Snapshot, and persists an immutable verification report. Action Semantics, complete custody history, source independence and claim authenticity remain explicit Unknown until their dedicated adapters and coverage are available.',
      },
      {
        id: 'finalized-historical-ingestion',
        status:
          runtime.ingestionStorage.rawFacts !== undefined &&
          runtime.ingestionStorage.checkpoints !== undefined &&
          runtime.ingestionStorage.artifacts !== undefined
            ? 'IMPLEMENTED_DURABLE'
            : Object.values(runtime.ingestionStorage).some((value) => value !== undefined)
              ? 'STORAGE_PARTIALLY_CONFIGURED'
              : 'STORAGE_REQUIRED',
        detail:
          'Restart-safe SQD finalized blocks, transactions, EVM logs/traces/state diffs, Bitcoin inputs/outputs, and Solana instructions/logs/balances/token balances/rewards are implemented with durable provenance. Anchor continuity/reorg detection is wired separately; semantic transfers, protocol decoding, and non-EVM continuous handlers remain pending.',
      },
      {
        id: 'durable-capture-scheduling',
        status:
          runtime.captureSchedules === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_CLAIM_TOKEN_HISTORY_AND_MONITOR_HANDLERS',
        detail:
          'Generic EVM/Bitcoin/Solana read-only schedules use deterministic occurrence IDs, exclusive expiring leases, bounded retries and immutable attempts. CLAIM_ACTIONS and TOKEN_HISTORY_BACKFILL have production handler bindings; Token Live Capture persists restart-safe Token History, Funding/Settlement, Control Campaign, Evidence-bound alerts, and provider-free SSE replay. Temporal/NATS adapters and non-EVM handlers remain pending.',
      },
      {
        id: 'entity-evidence-fusion',
        status:
          runtime.evidenceRepository === undefined ||
          runtime.entityRelationshipReports === undefined ||
          runtime.entityRelationshipTimelines === undefined ||
          runtime.entityInvestigationGraphs === undefined ||
          runtime.entityInvestigationGraphTimelines === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : runtime.ageInvestigationGraphProjection === undefined
              ? 'IMPLEMENTED_DURABLE_TEMPORAL_INVESTIGATION_GRAPH'
              : 'IMPLEMENTED_DURABLE_TEMPORAL_GRAPH_WITH_AGE_PROJECTION',
        detail:
          'Evidence-weighted pair scoring emits immutable Snapshot-bound hypotheses and pair timelines. Exact-Snapshot graph reports now compose into cross-Snapshot investigation timelines with explicit pair/request-scope deltas, parent-linked continuity, retained Unknown/negative/service states, provider-free replay, and no inferred membership or relationship termination. Apache AGE remains an optional rebuildable exact-Snapshot acceleration index; PostgreSQL reports are authoritative. Analyst overrides, protocol-scale relationship extraction and real-world calibration remain pending.',
      },
      { id: 'constant-product-rv', status: 'IMPLEMENTED_DETERMINISTIC' },
      { id: 'shared-liquidity-exit-race', status: 'IMPLEMENTED_DETERMINISTIC' },
    ],
    extended: [
      {
        id: 'X70',
        title: '完整 Maps、Profiler、Tracer、查询与指标',
        status: 'PARTIAL_EXECUTABLE_FOUNDATION',
        implemented: [
          '不可变 Campaign/Entity 图谱与跨快照时间线',
          '仓位、资金、结算、权限、Evidence 下钻与取证报告',
          '三账本类型化只读查询',
          'AST 级只读查询计划与最小脱敏目录',
        ],
        blockers: [
          'Query 执行角色、租户 RLS、取消与物化未验收',
          '版本化 Metrics Registry、Cohort 和 Point-in-Time 指标执行器未接线',
          '完整 Maps Time Travel/Profiler 资产与 PnL 实链覆盖未通过',
        ],
        realMainnetAcceptance: 'NOT_PASSED',
      },
      {
        id: 'X71',
        title: '其他既有链与跨账本范围恢复验收',
        status: 'PARTIAL_PROVIDER_AND_REAL_CHAIN_GATED',
        implemented: ['EVM、Bitcoin、Solana 一级账本适配', '链中立 Action Semantics 与 Evidence'],
        blockers: [
          'BSC/Solana 命名实链门禁未全部通过',
          'Bridge 消息匹配、CEX/Privacy 最后边界与其他链连续索引未完成实链验收',
        ],
        realMainnetAcceptance: 'NOT_PASSED',
      },
      {
        id: 'X72',
        title: '案件、取证、团队权限与报告全范围',
        status: 'PARTIAL_RESOURCE_AUTH_REQUIRED',
        implemented: [
          '不可变案件包、中文摘要、哈希清单与回放脚本',
          'OIDC JWT 身份验证与桌面会话认证',
        ],
        blockers: ['租户资源绑定、角色/作用域映射、四眼流程持久化、脱敏公开报告未闭合'],
        realMainnetAcceptance: 'NOT_PASSED',
      },
      {
        id: 'X73',
        title: '其余外部平台与 AI 观察来源补齐',
        status: 'PARTIAL_EXTERNAL_IDENTITY_AND_CREDENTIAL_GATED',
        implemented: ['版本化来源目录、零采购预算账本、AI 兼容能力探测与失败关闭'],
        blockers: [
          'xapid 服务身份/权益未核验',
          '真实 AI Provider 未配置探测',
          '外部内容权利、删除与送达未实测',
        ],
        realMainnetAcceptance: 'NOT_PASSED',
      },
      {
        id: 'X74',
        title: '全范围依赖许可、安全与发布验证',
        status: 'PENDING_CONSOLIDATED_RELEASE_GATES',
        implemented: ['许可证门禁、依赖锁、OIDC 签名验证、只读边界与 Windows/Tauri 工程'],
        blockers: [
          '全量发布门禁、真实 PostgreSQL 迁移、Windows 清洁机、签名更新、24h Soak 未全部通过',
        ],
        realMainnetAcceptance: 'NOT_PASSED',
      },
      {
        id: 'Z90',
        title: '原有范围与新增范围全部完成',
        status: 'BLOCKED_BY_NAMED_GATES',
        blockers: ['X70-X74 未全部通过', 'B14、S16、P44 与外部发布验收未全部通过'],
        realMainnetAcceptance: 'NOT_PASSED',
      },
    ],
    boundaries: {
      transactionSigning: 'FORBIDDEN',
      transactionBroadcasting: 'FORBIDDEN',
      privateKeyStorage: 'FORBIDDEN',
    },
  }));

  app.get('/api/v1/chains', { schema: { tags: ['system'] } }, async () => ({
    chains: [
      {
        ledger: 'EVM',
        chainId: `eip155:${config.ethereumChainId}`,
        name: 'Ethereum',
        configured: runtime.evmAdapters.has(config.ethereumChainId),
      },
      {
        ledger: 'EVM',
        chainId: `eip155:${config.bscChainId}`,
        name: 'BNB Smart Chain',
        configured: runtime.evmAdapters.has(config.bscChainId),
      },
      {
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        name: 'Bitcoin',
        configured: runtime.bitcoinAdapter !== undefined,
      },
      {
        ledger: 'SOLANA',
        chainId: 'solana-mainnet',
        name: 'Solana',
        configured: runtime.solanaAdapter !== undefined,
      },
    ],
  }));

  app.get('/api/v1/platforms', { schema: { tags: ['system'] } }, async () => ({
    platforms: PLATFORM_REGISTRY,
    launchpadRegistry: LAUNCHPAD_PROTOCOL_REGISTRY,
    gmgnConfigured: config.gmgnConfigured,
  }));

  app.get('/api/v1/provider-slots', { schema: { tags: ['system'] } }, async () => ({
    slots: config.providerSlotStatus,
    traceAuthType: config.bscTraceRpcAuthType,
    traceOperatorId: config.bscTraceOperatorId,
    note: 'UNCONFIGURED 插槽不得把依赖 Case 记为 PASS；缺 Key 不得阻止进程启动。',
  }));
}
