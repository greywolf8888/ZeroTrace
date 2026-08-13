import 'dotenv/config';

import {
  EvmLedgerAdapter,
  SafeJsonRpcTransport,
  SqdEvmContractCreationReader,
  SqdPortalClient,
  type ProviderUrlPolicy,
} from '@zerotrace/chain-adapters';
import {
  createSqdProfileRequest,
  SqdFinalizedIngestionPipeline,
  TokenHistoryDiscovery,
} from '@zerotrace/ingestion';
import {
  PostgresActionSemanticsReportRepository,
  ClickHouseRawFactRepository,
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
  PostgresTokenHistoryDiscoveryReportRepository,
  RawArtifactStore,
} from '@zerotrace/storage';

import {
  loadIngestWorkerConfig,
  TOKEN_HISTORY_PROFILE,
  type IngestWorkerConfig,
} from './config.js';
import { publicWorkerError } from './errors.js';

const HELP = `ZeroTrace finalized historical ingestion

Usage:
  npm run ingest -- --dataset <dataset> --profile <profile> --from <block-or-slot> --to <block-or-slot>

Datasets:
  ethereum-mainnet | binance-mainnet | bitcoin-mainnet | solana-mainnet

Profiles:
  block-headers (default) | transactions | ledger-records | token-history (--token required)

This worker is read-only with respect to chains. It never signs or broadcasts transactions.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  let facts: ClickHouseRawFactRepository | undefined;
  let evidence: PostgresEvidenceRepository | undefined;
  let checkpoints: PostgresIngestionCheckpointRepository | undefined;
  let actionSemantics: PostgresActionSemanticsReportRepository | undefined;
  let tokenHistoryReports: PostgresTokenHistoryDiscoveryReportRepository | undefined;
  try {
    const config = loadIngestWorkerConfig(process.env, args);
    const source = new SqdPortalClient({
      portalUrl: config.portalUrl,
      dataset: config.dataset,
      policy: config.providerPolicy,
      timeoutMs: config.requestTimeoutMs,
      maxRangeBlocks: config.toBlock - config.fromBlock + 1,
      maxAttempts: config.maxAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
      retryMaxDelayMs: config.retryMaxDelayMs,
      requestsPerSecond: config.requestsPerSecond,
    });
    facts = new ClickHouseRawFactRepository({
      url: config.clickHouseUrl,
      ...(config.clickHouseUsername === undefined ? {} : { username: config.clickHouseUsername }),
      ...(config.clickHousePassword === undefined ? {} : { password: config.clickHousePassword }),
    });
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: config.postgresUrl,
      maxConnections: 4,
    });
    checkpoints = new PostgresIngestionCheckpointRepository({
      connectionString: config.postgresUrl,
      maxConnections: 4,
    });
    const artifacts = new RawArtifactStore({
      endpoint: config.objectStoreEndpoint,
      accessKey: config.objectStoreAccessKey,
      secretKey: config.objectStoreSecretKey,
      bucket: config.objectStoreBucket,
    });
    const health = await Promise.all([
      facts.health(),
      evidence.health(),
      checkpoints.health(),
      artifacts.health(),
    ]);
    const failed = health.find((item) => item.status !== 'UP');
    if (failed !== undefined) {
      throw Object.assign(new Error('A required durable storage backend is unavailable.'), {
        code: failed.errorCode ?? 'STORAGE_UNAVAILABLE',
        retryable: true,
      });
    }
    if (config.profile === TOKEN_HISTORY_PROFILE) {
      tokenHistoryReports = new PostgresTokenHistoryDiscoveryReportRepository({
        connectionString: config.postgresUrl,
        maxConnections: 4,
      });
      actionSemantics = new PostgresActionSemanticsReportRepository({
        connectionString: config.postgresUrl,
        maxConnections: 4,
      });
      const tokenHistoryHealth = await Promise.all([
        tokenHistoryReports.health(),
        actionSemantics.health(),
      ]);
      const tokenHistoryFailure = tokenHistoryHealth.find((item) => item.status !== 'UP');
      if (tokenHistoryFailure !== undefined) {
        throw Object.assign(
          new Error('Token History Discovery durable report storage is unavailable.'),
          {
            code: tokenHistoryFailure.errorCode ?? 'TOKEN_HISTORY_STORAGE_UNAVAILABLE',
            retryable: true,
          },
        );
      }
      const exactReader =
        config.evmRpcUrl === undefined
          ? undefined
          : new EvmLedgerAdapter(
              {
                id: 'token-history-rpc',
                chainId: config.evmChainId,
                chainName: config.dataset === 'ethereum-mainnet' ? 'Ethereum' : 'BNB Smart Chain',
                snapshotBlockTag: 'finalized',
              },
              new SafeJsonRpcTransport({
                endpointId: `token-history-rpc@${new URL(config.evmRpcUrl).hostname.toLowerCase()}`,
                baseUrl: config.evmRpcUrl,
                policy: providerPolicy(config.evmRpcUrl, config.providerPolicy),
                timeoutMs: config.requestTimeoutMs,
                resilience: {
                  maxAttempts: config.maxAttempts,
                  retryBaseDelayMs: config.retryBaseDelayMs,
                  retryMaxDelayMs: config.retryMaxDelayMs,
                  requestsPerSecond: config.requestsPerSecond,
                },
              }),
            );
      const result = await new TokenHistoryDiscovery({
        source,
        token: config.token as string,
        fromBlock: config.fromBlock,
        toBlock: config.toBlock,
        checkpoints,
        artifacts,
        evidence,
        facts,
        factReader: facts,
        evidenceReader: evidence,
        reportStore: tokenHistoryReports,
        actionSemantics,
        ...(exactReader === undefined ? {} : { exactReader }),
        originReader: new SqdEvmContractCreationReader({
          source,
          maxRangeBlocks: config.toBlock - config.fromBlock + 1,
        }),
      }).run();
      process.stdout.write(
        `${JSON.stringify({
          event: 'token_history_discovery_complete',
          reportId: result.report.id,
          resultHash: result.report.resultHash,
          status: result.report.status,
          observations: result.report.observations.length,
          actionSemanticsBindings: result.report.actionSemanticsBindings.length,
          sourceCoverage: result.report.sourceCoverage,
          historyCoverage: result.report.historyCoverage,
          exactRpcConfigured: exactReader !== undefined,
          runId: result.ingestion.run.id,
          checkpointStatus: result.ingestion.run.status,
          alreadyTerminal: result.ingestion.alreadyTerminal,
        })}\n`,
      );
    } else {
      const request = createSqdProfileRequest({
        dataset: config.dataset,
        profile: config.profile,
        fromBlock: config.fromBlock,
        toBlock: config.toBlock,
      });
      const result = await new SqdFinalizedIngestionPipeline({
        source,
        checkpoints,
        artifacts,
        evidence,
        facts,
      }).run(request);
      process.stdout.write(
        `${JSON.stringify({
          event: 'finalized_ingestion_complete',
          dataset: config.dataset,
          profile: config.profile,
          runId: result.run.id,
          status: result.run.status,
          requestedFrom: result.run.fromBlock,
          requestedTo: result.run.toBlock,
          nextBlock: result.run.nextBlock,
          processedBlocks: result.processedBlocks,
          recordCoverage: result.recordCoverage,
          transactionCoverage: result.transactionCoverage,
          processedTransactions: result.processedTransactions,
          alreadyTerminal: result.alreadyTerminal,
          sourceCompletion: result.sourceSummary?.completion ?? null,
        })}\n`,
      );
    }
  } catch (error) {
    const safe = publicWorkerError(error);
    process.stderr.write(`${JSON.stringify({ event: 'finalized_ingestion_failed', ...safe })}\n`);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([
      ...(facts === undefined ? [] : [facts.close()]),
      ...(evidence === undefined ? [] : [evidence.close()]),
      ...(checkpoints === undefined ? [] : [checkpoints.close()]),
      ...(actionSemantics === undefined ? [] : [actionSemantics.close()]),
      ...(tokenHistoryReports === undefined ? [] : [tokenHistoryReports.close()]),
    ]);
  }
}

function providerPolicy(
  url: string,
  base: IngestWorkerConfig['providerPolicy'],
): ProviderUrlPolicy {
  const host = new URL(url).hostname.toLowerCase();
  return {
    allowedHosts: [...new Set([...base.allowedHosts, host])],
    allowPrivateNetworks: base.allowPrivateNetworks,
    allowHttpForPrivateNetworks: base.allowHttpForPrivateNetworks,
  };
}

await main();
