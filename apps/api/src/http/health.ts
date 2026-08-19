import type { ObjectStoreHealth, RawFactStorageHealth, StorageHealth } from '@zerotrace/storage';
import type { AppConfig } from '../config.js';
import type { AppRuntime } from '../runtime.js';

export function createHealthProbes(runtime: AppRuntime, config: AppConfig) {
  let healthCache:
    | { expiresAt: number; value: Awaited<ReturnType<AppRuntime['providerRegistry']['health']>> }
    | undefined;
  const providerHealth = async () => {
    if (healthCache !== undefined && healthCache.expiresAt > Date.now()) return healthCache.value;
    const value = await runtime.providerRegistry.health();
    healthCache = { expiresAt: Date.now() + config.healthCacheTtlMs, value };
    return value;
  };
  type RuntimeStorageHealth =
    | StorageHealth
    | Awaited<ReturnType<NonNullable<AppRuntime['semanticCheckpoints']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['flapHistoryProjection']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['flapLifetimeHeads']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['claimReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['claimDeclarationReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['claimRuleReviewReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['claimVerificationReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['controlSurfaces']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['solanaControlSurfaces']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['solanaTransactionReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['solanaDealerReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['bitcoinForensicGraphReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['actionSemanticsReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['pensionCandidateReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['pensionEntryReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['entityRelationshipReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['entityRelationshipTimelines']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['entityInvestigationGraphs']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['entityInvestigationGraphTimelines']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['controlCampaignReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['forensicCampaignAlerts']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['fundingSettlementReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['intelligenceSearch']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['labelIntelligenceReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['captureSchedules']>['health']>>
    | {
        status: 'EPHEMERAL';
        backend: 'MEMORY';
        durable: false;
        checkedAt: string;
      };
  let storageCache: { expiresAt: number; value: RuntimeStorageHealth } | undefined;
  const storageHealth = async (): Promise<RuntimeStorageHealth> => {
    if (storageCache !== undefined && storageCache.expiresAt > Date.now()) {
      return storageCache.value;
    }
    let value: RuntimeStorageHealth;
    if (runtime.evidenceRepository === undefined) {
      value = {
        status: 'EPHEMERAL',
        backend: 'MEMORY',
        durable: false,
        checkedAt: new Date().toISOString(),
      };
    } else {
      const [
        evidence,
        semanticCheckpoints,
        flapHistoryProjection,
        flapLifetimeHeads,
        claimReports,
        claimDeclarationReports,
        claimRuleReviewReports,
        claimVerificationReports,
        controlSurfaces,
        solanaControlSurfaces,
        solanaTransactionReports,
        solanaDealerReports,
        bitcoinForensicGraphReports,
        actionSemanticsReports,
        pensionCandidateReports,
        pensionEntryReports,
        entityRelationshipReports,
        entityRelationshipTimelines,
        entityInvestigationGraphs,
        entityInvestigationGraphTimelines,
        controlCampaignReports,
        forensicCampaignAlerts,
        fundingSettlementReports,
        intelligenceSearch,
        labelIntelligenceReports,
        captureSchedules,
      ] = await Promise.all([
        runtime.evidenceRepository.health(),
        runtime.semanticCheckpoints?.health(),
        runtime.flapHistoryProjection?.health(),
        runtime.flapLifetimeHeads?.health(),
        runtime.claimReports?.health(),
        runtime.claimDeclarationReports?.health(),
        runtime.claimRuleReviewReports?.health(),
        runtime.claimVerificationReports?.health(),
        runtime.controlSurfaces?.health(),
        runtime.solanaControlSurfaces?.health(),
        runtime.solanaTransactionReports?.health(),
        runtime.solanaDealerReports?.health(),
        runtime.bitcoinForensicGraphReports?.health(),
        runtime.actionSemanticsReports?.health(),
        runtime.pensionCandidateReports?.health(),
        runtime.pensionEntryReports?.health(),
        runtime.entityRelationshipReports?.health(),
        runtime.entityRelationshipTimelines?.health(),
        runtime.entityInvestigationGraphs?.health(),
        runtime.entityInvestigationGraphTimelines?.health(),
        runtime.controlCampaignReports?.health(),
        runtime.forensicCampaignAlerts?.health(),
        runtime.fundingSettlementReports?.health(),
        runtime.intelligenceSearch?.health(),
        runtime.labelIntelligenceReports?.health(),
        runtime.captureSchedules?.health(),
      ]);
      value =
        [
          evidence,
          semanticCheckpoints,
          flapHistoryProjection,
          flapLifetimeHeads,
          claimReports,
          claimDeclarationReports,
          claimRuleReviewReports,
          claimVerificationReports,
          controlSurfaces,
          solanaControlSurfaces,
          solanaTransactionReports,
          solanaDealerReports,
          bitcoinForensicGraphReports,
          actionSemanticsReports,
          pensionCandidateReports,
          pensionEntryReports,
          entityRelationshipReports,
          entityRelationshipTimelines,
          entityInvestigationGraphs,
          entityInvestigationGraphTimelines,
          controlCampaignReports,
          forensicCampaignAlerts,
          fundingSettlementReports,
          intelligenceSearch,
          labelIntelligenceReports,
          captureSchedules,
        ].find((component) => component?.status === 'DOWN') ?? evidence;
    }
    storageCache = { expiresAt: Date.now() + config.healthCacheTtlMs, value };
    return value;
  };
  type UnconfiguredStorageHealth = {
    status: 'UNCONFIGURED';
    backend: 'CLICKHOUSE' | 'POSTGRES' | 'S3_COMPATIBLE';
    durable: true;
    checkedAt: string;
  };
  type IngestionStorageHealth = {
    status: 'UP' | 'DOWN' | 'PARTIAL' | 'UNCONFIGURED';
    configured: number;
    required: 3;
    checkedAt: string;
    rawFacts: RawFactStorageHealth | UnconfiguredStorageHealth;
    checkpoints:
      | Awaited<ReturnType<NonNullable<AppRuntime['ingestionStorage']['checkpoints']>['health']>>
      | UnconfiguredStorageHealth;
    artifacts: ObjectStoreHealth | UnconfiguredStorageHealth;
  };
  let ingestionStorageCache: { expiresAt: number; value: IngestionStorageHealth } | undefined;
  const ingestionStorageHealth = async (): Promise<IngestionStorageHealth> => {
    if (ingestionStorageCache !== undefined && ingestionStorageCache.expiresAt > Date.now()) {
      return ingestionStorageCache.value;
    }
    const checkedAt = new Date().toISOString();
    const unconfigured = (
      backend: UnconfiguredStorageHealth['backend'],
    ): UnconfiguredStorageHealth => ({
      status: 'UNCONFIGURED',
      backend,
      durable: true,
      checkedAt,
    });
    const [rawFacts, checkpoints, artifacts] = await Promise.all([
      runtime.ingestionStorage.rawFacts?.health() ?? unconfigured('CLICKHOUSE'),
      runtime.ingestionStorage.checkpoints?.health() ?? unconfigured('POSTGRES'),
      runtime.ingestionStorage.artifacts?.health() ?? unconfigured('S3_COMPATIBLE'),
    ]);
    const components = [rawFacts, checkpoints, artifacts];
    const configured = components.filter((component) => component.status !== 'UNCONFIGURED').length;
    const status =
      configured === 0
        ? 'UNCONFIGURED'
        : components.some((component) => component.status === 'DOWN')
          ? 'DOWN'
          : configured === components.length
            ? 'UP'
            : 'PARTIAL';
    const value: IngestionStorageHealth = {
      status,
      configured,
      required: 3,
      checkedAt,
      rawFacts,
      checkpoints,
      artifacts,
    };
    ingestionStorageCache = {
      expiresAt: Date.now() + config.healthCacheTtlMs,
      value,
    };
    return value;
  };
  type EphemeralDataQualityStorageHealth = {
    status: 'EPHEMERAL';
    backend: 'MEMORY';
    durable: false;
    checkedAt: string;
  };
  type RuntimeDataQualityHealth = {
    status: 'UP' | 'PARTIAL' | 'INSUFFICIENT_SOURCES' | 'UNCONFIGURED' | 'DEGRADED' | 'DOWN';
    durable: boolean;
    checkedAt: string;
    configuredSources: Readonly<Record<string, number>>;
    results: Awaited<ReturnType<AppRuntime['dataQuality']['inspectAll']>>;
    storage:
      | Awaited<ReturnType<NonNullable<AppRuntime['dataQualityStorage']>['health']>>
      | EphemeralDataQualityStorageHealth;
    errorCode?: string;
  };
  let dataQualityCache: { expiresAt: number; value: RuntimeDataQualityHealth } | undefined;
  const dataQualityHealth = async (): Promise<RuntimeDataQualityHealth> => {
    if (dataQualityCache !== undefined && dataQualityCache.expiresAt > Date.now()) {
      return dataQualityCache.value;
    }
    const checkedAt = new Date().toISOString();
    const configuredSources = runtime.dataQuality.configuredSources();
    const storage =
      runtime.dataQualityStorage === undefined
        ? ({
            status: 'EPHEMERAL',
            backend: 'MEMORY',
            durable: false,
            checkedAt,
          } as const)
        : await runtime.dataQualityStorage.health();
    let value: RuntimeDataQualityHealth;
    try {
      if (storage.status === 'DOWN') {
        value = {
          status: 'DOWN',
          durable: storage.durable,
          checkedAt,
          configuredSources,
          results: [],
          storage,
          ...(storage.errorCode === undefined ? {} : { errorCode: storage.errorCode }),
        };
      } else {
        const results = await runtime.dataQuality.inspectAll();
        const configuredTotal = Object.values(configuredSources).reduce(
          (total, count) => total + count,
          0,
        );
        const disagreement = results.some(
          (result) => result.status === 'DISAGREEMENT' || result.alerts.length > 0,
        );
        const agreementCount = results.filter((result) => result.status === 'AGREEMENT').length;
        const status = disagreement
          ? 'DEGRADED'
          : configuredTotal === 0
            ? 'UNCONFIGURED'
            : agreementCount === results.length
              ? 'UP'
              : agreementCount > 0
                ? 'PARTIAL'
                : 'INSUFFICIENT_SOURCES';
        value = {
          status,
          durable: runtime.dataQuality.durable,
          checkedAt,
          configuredSources,
          results,
          storage,
        };
      }
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        typeof (error as Record<string, unknown>).code === 'string' &&
        /^[A-Z0-9_:-]{1,160}$/.test((error as Record<string, unknown>).code as string)
          ? ((error as Record<string, unknown>).code as string)
          : 'DATA_QUALITY_CHECK_FAILED';
      value = {
        status: 'DOWN',
        durable: runtime.dataQuality.durable,
        checkedAt,
        configuredSources,
        results: [],
        storage,
        errorCode: code,
      };
    }
    dataQualityCache = {
      expiresAt: Date.now() + config.healthCacheTtlMs,
      value,
    };
    return value;
  };

  const graphProjectionHealth = async () =>
    runtime.ageInvestigationGraphProjection === undefined
      ? ({
          status: 'UNCONFIGURED' as const,
          backend: 'APACHE_AGE' as const,
          durable: true as const,
          checkedAt: new Date().toISOString(),
          graphName: 'zerotrace_investigation' as const,
        } as const)
      : runtime.ageInvestigationGraphProjection.health();
  return {
    providerHealth,
    storageHealth,
    ingestionStorageHealth,
    dataQualityHealth,
    graphProjectionHealth,
  };
}
