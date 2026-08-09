import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { SqdFinalizedBlock, SqdFinalizedRangeRequest } from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import {
  createSqdProfileRequest,
  SqdFinalizedIngestionPipeline,
  type SqdFinalizedSource,
} from '@zerotrace/ingestion';
import {
  ClickHouseRawFactRepository,
  createRawChainFact,
  RawArtifactStore,
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
} from '@zerotrace/storage';

const postgresUrl = process.env.TEST_POSTGRES_URL;
const clickHouseUrl = process.env.TEST_CLICKHOUSE_URL;
const objectStoreEndpoint = process.env.TEST_OBJECT_STORE_ENDPOINT;
const objectStoreAccessKey = process.env.TEST_OBJECT_STORE_ACCESS_KEY;
const objectStoreSecretKey = process.env.TEST_OBJECT_STORE_SECRET_KEY;
const configured =
  clickHouseUrl !== undefined &&
  objectStoreEndpoint !== undefined &&
  objectStoreAccessKey !== undefined &&
  objectStoreSecretKey !== undefined &&
  postgresUrl !== undefined;
const storageDescribe = configured ? describe : describe.skip;
const testRunId = randomUUID();
const testChainId = `integration-${testRunId}`;
const testDataset = 'ethereum-mainnet';
const testProvider = `sqd:integration-${testRunId}`;
const pipelineBlockNumber = Number.parseInt(testRunId.replaceAll('-', '').slice(0, 8), 16) + 1;

const observedAt = '2026-08-09T13:00:00.000Z';
const payload = {
  header: {
    number: 0,
    hash: '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
    parentHash: `0x${'0'.repeat(64)}`,
    timestamp: 0,
  },
};

storageDescribe('historical ingestion storage integration', () => {
  let facts: ClickHouseRawFactRepository;
  let artifacts: RawArtifactStore;
  let evidence: PostgresEvidenceRepository;
  let checkpoints: PostgresIngestionCheckpointRepository;

  beforeAll(async () => {
    facts = new ClickHouseRawFactRepository({ url: clickHouseUrl as string });
    artifacts = new RawArtifactStore({
      endpoint: objectStoreEndpoint as string,
      accessKey: objectStoreAccessKey as string,
      secretKey: objectStoreSecretKey as string,
      bucket: 'zerotrace-raw-integration',
    });
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: postgresUrl as string,
      maxConnections: 2,
    });
    checkpoints = new PostgresIngestionCheckpointRepository({
      connectionString: postgresUrl as string,
      maxConnections: 2,
    });
    await artifacts.initialize();
  });

  afterAll(async () => {
    await Promise.all([facts.close(), evidence.close(), checkpoints.close()]);
  });

  it('observes initialized, versioned, durable backends', async () => {
    await expect(artifacts.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'S3_COMPATIBLE',
      versioning: true,
    });
    await expect(facts.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'CLICKHOUSE',
      logicalDeduplication: 'REPLACING_MERGE_TREE',
    });
    await expect(checkpoints.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(evidence.health()).resolves.toMatchObject({ status: 'UP', durable: true });
  });

  it('persists an artifact before its Evidence-linked Raw Fact and replays both', async () => {
    const artifact = await artifacts.put({
      ledger: 'EVM',
      chainId: testChainId,
      blockOrSlot: '0',
      provider: testProvider,
      capturedAt: observedAt,
      payload,
    });
    const evidence = createEvidence({
      ledger: 'EVM',
      chainId: testChainId,
      kind: 'BLOCK',
      source: testProvider,
      locator: 'block:0',
      payload,
      observedAt,
      blockOrSlot: '0',
      finality: 'finalized',
      rawArtifactRef: artifact.ref,
      summary: 'SQD finalized Ethereum genesis block.',
    });
    const fact = createRawChainFact({
      ledger: 'EVM',
      chainId: testChainId,
      blockOrSlot: '0',
      blockHash: payload.header.hash,
      factType: 'BLOCK',
      subject: payload.header.hash,
      provider: testProvider,
      finality: 'finalized',
      payload,
      evidenceId: evidence.id,
      rawArtifactRef: artifact.ref,
      observedAt,
    });

    await expect(facts.put(fact)).resolves.toEqual(fact);
    await expect(facts.put(fact)).resolves.toEqual(fact);
    await expect(facts.get(fact.id)).resolves.toEqual(fact);
    await expect(artifacts.get(artifact.ref)).resolves.toMatchObject({ payload });
    await expect(
      facts.listRange({ ledger: 'EVM', chainId: testChainId, fromBlock: 0, toBlock: 0 }),
    ).resolves.toEqual([fact]);
    await expect(
      artifacts.put({
        ledger: 'EVM',
        chainId: testChainId,
        blockOrSlot: '0',
        provider: testProvider,
        capturedAt: observedAt,
        payload,
      }),
    ).resolves.toMatchObject({ ref: artifact.ref, created: false });
  });

  it('runs the restart-safe finalized pipeline across all three durable stores', async () => {
    const block: SqdFinalizedBlock = {
      header: {
        number: pipelineBlockNumber,
        hash: `0x${testRunId.replaceAll('-', '').padEnd(64, '0')}`,
        parentHash: payload.header.hash,
        timestamp: 1_438_269_988,
      },
      transactions: [
        { hash: `0x${'a'.repeat(64)}`, from: `0x${'1'.repeat(40)}`, value: '1' },
        { hash: `0x${'b'.repeat(64)}`, from: `0x${'2'.repeat(40)}`, value: '2' },
      ],
      logs: [
        {
          transactionHash: `0x${'a'.repeat(64)}`,
          transactionIndex: 0,
          logIndex: 0,
          address: `0x${'3'.repeat(40)}`,
          topics: [],
          data: '0x',
        },
      ],
    };
    const source: SqdFinalizedSource = {
      dataset: testDataset,
      ledger: 'EVM',
      chainId: '1',
      metadata: async () => ({
        dataset: testDataset,
        aliases: [],
        realTime: true,
        startBlock: 0,
      }),
      readFinalizedRange: async (
        request: SqdFinalizedRangeRequest,
        onBlock: (item: SqdFinalizedBlock) => void | Promise<void>,
      ) => {
        await onBlock(block);
        return {
          dataset: testDataset,
          completion: 'REQUESTED_RANGE_COMPLETE',
          requestedFrom: request.fromBlock,
          requestedTo: request.toBlock,
          lastBlock: pipelineBlockNumber,
          nextBlock: pipelineBlockNumber + 1,
          finalizedHead: pipelineBlockNumber,
          blocks: 1,
          requests: 1,
          retries: 0,
        };
      },
    };
    const pipeline = new SqdFinalizedIngestionPipeline({
      source,
      checkpoints,
      artifacts,
      evidence,
      facts,
      nowImplementation: () => new Date('2026-08-09T13:30:00.000Z'),
    });

    const request = createSqdProfileRequest({
      dataset: testDataset,
      profile: 'ledger-records',
      fromBlock: pipelineBlockNumber,
      toBlock: pipelineBlockNumber,
    });
    const completed = await pipeline.run(request);
    expect(completed).toMatchObject({
      processedBlocks: 1,
      recordCoverage: {
        transactions: { state: 'MATERIALIZED', processed: 2 },
        logs: { state: 'MATERIALIZED', processed: 1 },
        inputs: { state: 'NOT_APPLICABLE', processed: null },
        outputs: { state: 'NOT_APPLICABLE', processed: null },
        instructions: { state: 'NOT_APPLICABLE', processed: null },
      },
      transactionCoverage: 'MATERIALIZED',
      processedTransactions: 2,
      alreadyTerminal: false,
      run: { status: 'REQUESTED_RANGE_COMPLETE', nextBlock: pipelineBlockNumber + 1 },
    });
    const storedFacts = await facts.listRange({
      ledger: 'EVM',
      chainId: '1',
      fromBlock: pipelineBlockNumber,
      toBlock: pipelineBlockNumber,
    });
    expect(storedFacts).toHaveLength(4);
    expect(storedFacts.map((fact) => fact.factType).sort()).toEqual([
      'BLOCK',
      'LOG',
      'TRANSACTION',
      'TRANSACTION',
    ]);
    for (const storedFact of storedFacts) {
      await expect(evidence.get(storedFact.evidenceId)).resolves.toMatchObject({
        evidence: { rawArtifactRef: storedFact.rawArtifactRef },
        snapshot: { ledger: 'EVM', blockNumber: String(pipelineBlockNumber) },
      });
    }
    await expect(artifacts.get(storedFacts[0]!.rawArtifactRef)).resolves.toMatchObject({
      payload: block,
    });

    await expect(pipeline.run(request)).resolves.toMatchObject({
      processedBlocks: 0,
      recordCoverage: {
        transactions: { state: 'MATERIALIZED', processed: 0 },
        logs: { state: 'MATERIALIZED', processed: 0 },
        inputs: { state: 'NOT_APPLICABLE', processed: null },
        outputs: { state: 'NOT_APPLICABLE', processed: null },
        instructions: { state: 'NOT_APPLICABLE', processed: null },
      },
      transactionCoverage: 'MATERIALIZED',
      processedTransactions: 0,
      alreadyTerminal: true,
      run: { id: completed.run.id },
    });
  });
});
