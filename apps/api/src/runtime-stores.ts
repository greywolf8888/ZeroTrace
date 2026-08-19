import {
  AgeInvestigationGraphProjectionRepository,
  ClickHouseRawFactRepository,
  PostgresActionSemanticsReportRepository,
  PostgresBitcoinForensicGraphReportRepository,
  PostgresCaptureScheduleRepository,
  PostgresClaimDeclarationReportRepository,
  PostgresClaimReportRepository,
  PostgresClaimRuleReviewReportRepository,
  PostgresClaimVerificationReportRepository,
  PostgresControlCampaignReportRepository,
  PostgresEntityInvestigationGraphRepository,
  PostgresEntityInvestigationGraphTimelineRepository,
  PostgresEntityRelationshipReportRepository,
  PostgresEntityRelationshipTimelineRepository,
  PostgresEvmControlSurfaceRepository,
  PostgresFlapHistoryProjectionRepository,
  PostgresFlapLifetimeHeadRepository,
  PostgresFlapPensionEntryReportRepository,
  PostgresForensicCampaignAlertRepository,
  PostgresForensicReportRepository,
  PostgresFundingSettlementReportRepository,
  PostgresIngestionCheckpointRepository,
  PostgresIntelligenceSearchRepository,
  PostgresJobQueue,
  PostgresLabelIntelligenceReportRepository,
  PostgresPensionCandidateReportRepository,
  PostgresSemanticScanCheckpointRepository,
  PostgresSolanaControlSurfaceRepository,
  PostgresSolanaDealerCampaignReportRepository,
  PostgresSolanaTransactionReportRepository,
  RawArtifactStore,
  type EvidenceRepository,
} from '@zerotrace/storage';

import type { AppConfig } from './config.js';

function optionalStore<T>(enabled: boolean, create: () => T): T | undefined {
  return enabled ? create() : undefined;
}

function postgresOptions(config: AppConfig, maxConnections = 4) {
  if (config.postgresUrl === undefined) {
    throw new Error('PostgreSQL URL is required for durable stores.');
  }
  return {
    connectionString: config.postgresUrl,
    connectionTimeoutMs: Math.min(config.requestTimeoutMs, 5_000),
    statementTimeoutMs: config.requestTimeoutMs,
    maxConnections,
  };
}

export interface DurableRuntimeStores {
  rawFacts?: ClickHouseRawFactRepository | undefined;
  checkpoints?: PostgresIngestionCheckpointRepository | undefined;
  semanticCheckpoints?: PostgresSemanticScanCheckpointRepository | undefined;
  flapHistoryProjection?: PostgresFlapHistoryProjectionRepository | undefined;
  flapLifetimeHeads?: PostgresFlapLifetimeHeadRepository | undefined;
  claimReports?: PostgresClaimReportRepository | undefined;
  claimDeclarationReports?: PostgresClaimDeclarationReportRepository | undefined;
  claimRuleReviewReports?: PostgresClaimRuleReviewReportRepository | undefined;
  claimVerificationReports?: PostgresClaimVerificationReportRepository | undefined;
  controlSurfaces?: PostgresEvmControlSurfaceRepository | undefined;
  solanaControlSurfaces?: PostgresSolanaControlSurfaceRepository | undefined;
  solanaTransactionReports?: PostgresSolanaTransactionReportRepository | undefined;
  actionSemanticsReports?: PostgresActionSemanticsReportRepository | undefined;
  pensionCandidateReports?: PostgresPensionCandidateReportRepository | undefined;
  pensionEntryReports?: PostgresFlapPensionEntryReportRepository | undefined;
  entityRelationshipReports?: PostgresEntityRelationshipReportRepository | undefined;
  entityRelationshipTimelines?: PostgresEntityRelationshipTimelineRepository | undefined;
  entityInvestigationGraphs?: PostgresEntityInvestigationGraphRepository | undefined;
  entityInvestigationGraphTimelines?:
    PostgresEntityInvestigationGraphTimelineRepository | undefined;
  controlCampaignReports?: PostgresControlCampaignReportRepository | undefined;
  forensicReports?: PostgresForensicReportRepository | undefined;
  jobQueue?: PostgresJobQueue | undefined;
  forensicCampaignAlerts?: PostgresForensicCampaignAlertRepository | undefined;
  solanaDealerReports?: PostgresSolanaDealerCampaignReportRepository | undefined;
  bitcoinForensicGraphReports?: PostgresBitcoinForensicGraphReportRepository | undefined;
  fundingSettlementReports?: PostgresFundingSettlementReportRepository | undefined;
  intelligenceSearch?: PostgresIntelligenceSearchRepository | undefined;
  labelIntelligenceReports?: PostgresLabelIntelligenceReportRepository | undefined;
  captureSchedules?: PostgresCaptureScheduleRepository | undefined;
  ageInvestigationGraphProjection?: AgeInvestigationGraphProjectionRepository | undefined;
  artifacts?: RawArtifactStore | undefined;
  closeStores: (
    evidenceRepository?: EvidenceRepository,
    dataQualityRepository?: { close(): Promise<void> },
  ) => Promise<void>;
}

export function createDurableStores(config: AppConfig): DurableRuntimeStores {
  const postgres = config.postgresUrl !== undefined;
  const pg = () => postgresOptions(config);
  const stores = {
    rawFacts: optionalStore(config.clickhouseUrl !== undefined, () => {
      if (config.clickhouseUrl === undefined) throw new Error('ClickHouse URL missing.');
      return new ClickHouseRawFactRepository({
        url: config.clickhouseUrl,
        requestTimeoutMs: config.requestTimeoutMs,
        maxConnections: 4,
        ...(config.clickhouseUsername === undefined ? {} : { username: config.clickhouseUsername }),
        ...(config.clickhousePassword === undefined
          ? {}
          : { password: config.clickhousePassword.reveal() }),
      });
    }),
    checkpoints: optionalStore(postgres, () => new PostgresIngestionCheckpointRepository(pg())),
    semanticCheckpoints: optionalStore(
      postgres,
      () => new PostgresSemanticScanCheckpointRepository(pg()),
    ),
    flapHistoryProjection: optionalStore(
      postgres,
      () => new PostgresFlapHistoryProjectionRepository(pg()),
    ),
    flapLifetimeHeads: optionalStore(postgres, () => new PostgresFlapLifetimeHeadRepository(pg())),
    claimReports: optionalStore(postgres, () => new PostgresClaimReportRepository(pg())),
    claimDeclarationReports: optionalStore(
      postgres,
      () => new PostgresClaimDeclarationReportRepository(pg()),
    ),
    claimRuleReviewReports: optionalStore(
      postgres,
      () => new PostgresClaimRuleReviewReportRepository(pg()),
    ),
    claimVerificationReports: optionalStore(
      postgres,
      () => new PostgresClaimVerificationReportRepository(pg()),
    ),
    controlSurfaces: optionalStore(postgres, () => new PostgresEvmControlSurfaceRepository(pg())),
    solanaControlSurfaces: optionalStore(
      postgres,
      () => new PostgresSolanaControlSurfaceRepository(pg()),
    ),
    solanaTransactionReports: optionalStore(
      postgres,
      () => new PostgresSolanaTransactionReportRepository(pg()),
    ),
    actionSemanticsReports: optionalStore(
      postgres,
      () => new PostgresActionSemanticsReportRepository(pg()),
    ),
    pensionCandidateReports: optionalStore(
      postgres,
      () => new PostgresPensionCandidateReportRepository(pg()),
    ),
    pensionEntryReports: optionalStore(
      postgres,
      () => new PostgresFlapPensionEntryReportRepository(pg()),
    ),
    entityRelationshipReports: optionalStore(
      postgres,
      () => new PostgresEntityRelationshipReportRepository(pg()),
    ),
    entityRelationshipTimelines: optionalStore(
      postgres,
      () => new PostgresEntityRelationshipTimelineRepository(pg()),
    ),
    entityInvestigationGraphs: optionalStore(
      postgres,
      () => new PostgresEntityInvestigationGraphRepository(pg()),
    ),
    entityInvestigationGraphTimelines: optionalStore(
      postgres,
      () => new PostgresEntityInvestigationGraphTimelineRepository(pg()),
    ),
    controlCampaignReports: optionalStore(
      postgres,
      () => new PostgresControlCampaignReportRepository(pg()),
    ),
    forensicReports: optionalStore(postgres, () => new PostgresForensicReportRepository(pg())),
    jobQueue: optionalStore(postgres, () => new PostgresJobQueue(pg())),
    forensicCampaignAlerts: optionalStore(
      postgres,
      () => new PostgresForensicCampaignAlertRepository(pg()),
    ),
    solanaDealerReports: optionalStore(
      postgres,
      () => new PostgresSolanaDealerCampaignReportRepository(pg()),
    ),
    bitcoinForensicGraphReports: optionalStore(
      postgres,
      () => new PostgresBitcoinForensicGraphReportRepository(pg()),
    ),
    fundingSettlementReports: optionalStore(
      postgres,
      () => new PostgresFundingSettlementReportRepository(pg()),
    ),
    intelligenceSearch: optionalStore(
      postgres,
      () => new PostgresIntelligenceSearchRepository(pg()),
    ),
    labelIntelligenceReports: optionalStore(
      postgres,
      () => new PostgresLabelIntelligenceReportRepository(pg()),
    ),
    captureSchedules: optionalStore(postgres, () => new PostgresCaptureScheduleRepository(pg())),
    ageInvestigationGraphProjection: optionalStore(config.ageUrl !== undefined, () => {
      if (config.ageUrl === undefined) throw new Error('Apache AGE URL missing.');
      return new AgeInvestigationGraphProjectionRepository({
        connectionString: config.ageUrl,
        connectionTimeoutMs: Math.min(config.requestTimeoutMs, 5_000),
        statementTimeoutMs: config.requestTimeoutMs,
        maxConnections: 2,
      });
    }),
    artifacts: optionalStore(
      config.objectStoreEndpoint !== undefined &&
        config.objectStoreAccessKey !== undefined &&
        config.objectStoreSecretKey !== undefined,
      () => {
        if (
          config.objectStoreEndpoint === undefined ||
          config.objectStoreAccessKey === undefined ||
          config.objectStoreSecretKey === undefined
        ) {
          throw new Error('Object store credentials missing.');
        }
        return new RawArtifactStore({
          endpoint: config.objectStoreEndpoint,
          accessKey: config.objectStoreAccessKey,
          secretKey: config.objectStoreSecretKey.reveal(),
          ...(config.objectStoreBucket === undefined ? {} : { bucket: config.objectStoreBucket }),
        });
      },
    ),
  };

  return {
    ...stores,
    closeStores: async (evidenceRepository, dataQualityRepository) => {
      await Promise.all([
        evidenceRepository?.close(),
        dataQualityRepository?.close(),
        stores.checkpoints?.close(),
        stores.semanticCheckpoints?.close(),
        stores.flapHistoryProjection?.close(),
        stores.flapLifetimeHeads?.close(),
        stores.claimReports?.close(),
        stores.claimDeclarationReports?.close(),
        stores.claimRuleReviewReports?.close(),
        stores.claimVerificationReports?.close(),
        stores.controlSurfaces?.close(),
        stores.solanaControlSurfaces?.close(),
        stores.solanaTransactionReports?.close(),
        stores.solanaDealerReports?.close(),
        stores.bitcoinForensicGraphReports?.close(),
        stores.actionSemanticsReports?.close(),
        stores.pensionCandidateReports?.close(),
        stores.pensionEntryReports?.close(),
        stores.entityRelationshipReports?.close(),
        stores.entityRelationshipTimelines?.close(),
        stores.entityInvestigationGraphs?.close(),
        stores.entityInvestigationGraphTimelines?.close(),
        stores.controlCampaignReports?.close(),
        stores.forensicReports?.close(),
        stores.jobQueue?.close(),
        stores.forensicCampaignAlerts?.close(),
        stores.fundingSettlementReports?.close(),
        stores.intelligenceSearch?.close(),
        stores.labelIntelligenceReports?.close(),
        stores.captureSchedules?.close(),
        stores.ageInvestigationGraphProjection?.close(),
        stores.rawFacts?.close(),
        stores.artifacts?.close(),
      ]);
    },
  };
}
