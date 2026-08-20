import {
  hydrateLocalIndex,
  MinioArtifactStore,
  openStoragePlane,
  persistLocalIndex,
  type StoragePlane,
} from '@zerotrace/storage-plane';
import { ObjectStoreArtifactStore, PostgresMetadataStore } from '@zerotrace/storage';
import type { CaptureReport, TokenCaptureRuntime } from '@zerotrace/token-market-capture';

import type { AppConfig } from './config.js';

export function createStoragePlane(config: AppConfig): StoragePlane {
  const objectStoreEndpoint = config.objectStoreEndpoint;
  const objectStoreAccessKey = config.objectStoreAccessKey;
  const objectStoreSecretKey = config.objectStoreSecretKey;
  const useObjectStore =
    config.storageProfile !== 'LOW_COST_CASE' &&
    objectStoreEndpoint !== undefined &&
    objectStoreAccessKey !== undefined &&
    objectStoreSecretKey !== undefined;
  return openStoragePlane({
    rootDir: config.storageRoot,
    profile: config.storageProfile,
    postgresConfigured: config.postgresUrl !== undefined,
    minioConfigured: objectStoreEndpoint !== undefined,
    archiveNodeConfigured: false,
    ...(config.clickhouseUrl === undefined ? {} : { clickhouseUrl: config.clickhouseUrl }),
    ...(config.postgresUrl === undefined
      ? {}
      : { metadata: new PostgresMetadataStore(config.postgresUrl) }),
    ...(useObjectStore
      ? {
          artifacts: new MinioArtifactStore(
            new ObjectStoreArtifactStore({
              endpoint: objectStoreEndpoint,
              accessKey: objectStoreAccessKey,
              secretKey: objectStoreSecretKey.reveal(),
              bucket: config.objectStoreBucket ?? 'zerotrace-raw',
            }),
          ),
        }
      : {}),
  });
}

export function bindStoragePlane(
  runtime: TokenCaptureRuntime,
  plane: StoragePlane,
): TokenCaptureRuntime {
  const cachedOrigins = runtime.cachedOrigins ?? new Map();
  return {
    ...runtime,
    cachedOrigins,
    async hydrate(request) {
      const hydrated = await hydrateLocalIndex({
        plane,
        index: runtime.index,
        chainId: request.chainId,
        token: request.token,
      });
      if (hydrated.origin?.status === 'COMPLETE') {
        cachedOrigins.set(request.token.toLowerCase(), {
          status: hydrated.origin.status,
          ...(hydrated.origin.creationTx === undefined
            ? {}
            : { creationTx: hydrated.origin.creationTx }),
          ...(hydrated.origin.deployer === undefined ? {} : { deployer: hydrated.origin.deployer }),
          ...(hydrated.origin.createdBlock === undefined
            ? {}
            : { createdBlock: hydrated.origin.createdBlock }),
          ...(hydrated.origin.codeHash === undefined ? {} : { codeHash: hydrated.origin.codeHash }),
          ...(hydrated.origin.limitation === undefined
            ? {}
            : { limitation: hydrated.origin.limitation }),
          ...(hydrated.origin.limitationCode === undefined
            ? {}
            : { limitationCode: hydrated.origin.limitationCode }),
        });
      }
    },
    async persist(request, report: CaptureReport) {
      await persistLocalIndex({
        plane,
        index: runtime.index,
        chainId: request.chainId,
        token: request.token,
        origin: {
          status: report.origin.status,
          updatedAt: new Date().toISOString(),
          ...(report.origin.creationTx === undefined ? {} : { creationTx: report.origin.creationTx }),
          ...(report.origin.deployer === undefined ? {} : { deployer: report.origin.deployer }),
          ...(report.origin.createdBlock === undefined
            ? {}
            : { createdBlock: report.origin.createdBlock }),
          ...(report.origin.codeHash === undefined ? {} : { codeHash: report.origin.codeHash }),
          ...(report.origin.limitation === undefined ? {} : { limitation: report.origin.limitation }),
          ...(report.origin.limitationCode === undefined
            ? {}
            : { limitationCode: report.origin.limitationCode }),
        },
        stages: report.stages.map((stage) => ({
          chainId: request.chainId,
          token: request.token.toLowerCase(),
          stage:
            stage.name === 'SNAPSHOT'
              ? 'CURRENT_SNAPSHOT'
              : stage.name === 'ORIGIN'
                ? 'ORIGIN'
                : stage.name === 'HISTORY' || stage.name === 'SUPPLY'
                  ? 'LIFETIME_HISTORY'
                  : stage.name === 'ENTITY' || stage.name === 'CAMPAIGN'
                    ? 'ENTITY_AND_CAMPAIGN'
                    : stage.name === 'CAPITAL' || stage.name === 'RV'
                      ? 'CAPITAL_AND_RV'
                      : 'CASE_AND_REPLAY',
          status:
            stage.status === 'PENDING' || stage.status === 'RUNNING'
              ? 'NOT_RUN'
              : stage.status,
          updatedAt: new Date().toISOString(),
          ...(stage.limitation === undefined ? {} : { limitation: stage.limitation }),
        })),
      });
      await plane.artifacts.put(
        `case/${request.chainId.replaceAll(':', '_')}/${request.token.toLowerCase()}/capture.json`,
        Buffer.from(JSON.stringify(report)),
        { dataClass: 'PERMANENT_EVIDENCE', contentType: 'application/json', permanent: true },
      );
    },
  };
}
