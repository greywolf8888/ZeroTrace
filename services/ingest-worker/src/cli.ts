import 'dotenv/config';

import { SqdPortalClient } from '@zerotrace/chain-adapters';
import { SqdFinalizedIngestionPipeline } from '@zerotrace/ingestion';
import {
  ClickHouseRawFactRepository,
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
  RawArtifactStore,
} from '@zerotrace/storage';

import { loadIngestWorkerConfig } from './config.js';
import { publicWorkerError } from './errors.js';

const HELP = `ZeroTrace finalized historical ingestion

Usage:
  npm run ingest -- --dataset <dataset> --from <block-or-slot> --to <block-or-slot>

Datasets:
  ethereum-mainnet | binance-mainnet | bitcoin-mainnet | solana-mainnet

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
    const result = await new SqdFinalizedIngestionPipeline({
      source,
      checkpoints,
      artifacts,
      evidence,
      facts,
    }).run({ fromBlock: config.fromBlock, toBlock: config.toBlock });
    process.stdout.write(
      `${JSON.stringify({
        event: 'finalized_ingestion_complete',
        dataset: config.dataset,
        runId: result.run.id,
        status: result.run.status,
        requestedFrom: result.run.fromBlock,
        requestedTo: result.run.toBlock,
        nextBlock: result.run.nextBlock,
        processedBlocks: result.processedBlocks,
        alreadyTerminal: result.alreadyTerminal,
        sourceCompletion: result.sourceSummary?.completion ?? null,
      })}\n`,
    );
  } catch (error) {
    const safe = publicWorkerError(error);
    process.stderr.write(`${JSON.stringify({ event: 'finalized_ingestion_failed', ...safe })}\n`);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([
      ...(facts === undefined ? [] : [facts.close()]),
      ...(evidence === undefined ? [] : [evidence.close()]),
      ...(checkpoints === undefined ? [] : [checkpoints.close()]),
    ]);
  }
}

await main();
