import {
  EvmLedgerAdapter,
  SafeJsonRpcTransport,
  SqdEvmContractCreationReader,
  SqdPortalClient,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import {
  TokenHistoryDiscovery,
  type EvidenceWriter,
  type IngestionCheckpointWriter,
  type RawArtifactWriter,
  type RawFactWriter,
} from '@zerotrace/ingestion';
import type {
  TokenHistoryDiscoveryReport,
  RawChainFact,
  Evidence,
  AnalysisSnapshot,
} from '@zerotrace/schemas';
import type { IngestionRun } from '@zerotrace/storage';

const DEFAULT_SQD_URL = 'https://portal.sqd.dev';
const DEFAULT_BSC_RPC_URL = 'https://bsc-dataseed.bnbchain.org';
const DEFAULT_FROM_BLOCK = 113_485_950;
const DEFAULT_TO_BLOCK = 113_495_949;

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function blockArgument(name: string, fallback: number): number {
  const value = argument(name, String(fallback));
  if (value === undefined || !/^\d+$/.test(value))
    throw new Error(`${name} must be a block number.`);
  const block = Number(value);
  if (!Number.isSafeInteger(block)) throw new Error(`${name} is outside the safe integer range.`);
  return block;
}

class MemoryCheckpoints implements IngestionCheckpointWriter {
  run: IngestionRun | undefined;

  async begin(input: Parameters<IngestionCheckpointWriter['begin']>[0]): Promise<IngestionRun> {
    this.run ??= {
      id: `00000000-0000-4000-8000-${hashPayload(input.query).slice(0, 12)}`,
      source: input.source,
      dataset: input.dataset,
      ledger: input.ledger,
      chainId: input.chainId,
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
      queryHash: hashPayload(input.query),
      query: input.query,
      status: 'RUNNING',
      nextBlock: input.fromBlock,
      lastBlock: null,
      lastErrorCode: null,
      startedAt: input.startedAt ?? new Date().toISOString(),
      updatedAt: input.startedAt ?? new Date().toISOString(),
      completedAt: null,
    };
    return this.run;
  }

  async advance(_id: string, block: number): Promise<IngestionRun> {
    if (this.run === undefined) throw new Error('Checkpoint run is not initialized.');
    this.run = { ...this.run, nextBlock: block + 1, lastBlock: block };
    return this.run;
  }

  async finish(
    _id: string,
    status: 'REQUESTED_RANGE_COMPLETE' | 'SOURCE_HEAD_REACHED',
    nextBlock: number,
  ): Promise<IngestionRun> {
    if (this.run === undefined) throw new Error('Checkpoint run is not initialized.');
    this.run = { ...this.run, status, nextBlock, completedAt: new Date().toISOString() };
    return this.run;
  }

  async recordFailure(_id: string, errorCode: string): Promise<IngestionRun> {
    if (this.run === undefined) throw new Error('Checkpoint run is not initialized.');
    this.run = { ...this.run, lastErrorCode: errorCode };
    return this.run;
  }
}

class MemoryReports {
  report: TokenHistoryDiscoveryReport | undefined;

  async put(report: TokenHistoryDiscoveryReport): Promise<TokenHistoryDiscoveryReport> {
    if (this.report !== undefined && this.report.resultHash !== report.resultHash) {
      throw new Error('Live smoke report is not idempotent.');
    }
    this.report ??= report;
    return this.report;
  }

  async get(_id: string): Promise<TokenHistoryDiscoveryReport | undefined> {
    return this.report;
  }
}

function createArtifactWriter(): RawArtifactWriter {
  return {
    async put(input) {
      const artifactHash = hashPayload({
        schema: 'token-history-live-smoke-artifact-v1',
        ...input,
      });
      return {
        ref: `s3://zerotrace-live-smoke/token-history/${input.blockOrSlot}.json#sha256=${artifactHash}`,
        bucket: 'zerotrace-live-smoke',
        key: `token-history/${input.blockOrSlot}.json`,
        artifactHash,
        payloadHash: hashPayload(input.payload),
        size: JSON.stringify(input.payload).length,
        created: true,
      };
    },
  };
}

async function main(): Promise<void> {
  const token = argument('--token', process.env.TOKEN_HISTORY_SMOKE_TOKEN);
  if (token === undefined || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
    throw new Error('--token or TOKEN_HISTORY_SMOKE_TOKEN must be a valid EVM address.');
  }
  const fromBlock = blockArgument(
    '--from',
    Number(process.env.TOKEN_HISTORY_SMOKE_FROM ?? DEFAULT_FROM_BLOCK),
  );
  const toBlock = blockArgument(
    '--to',
    Number(process.env.TOKEN_HISTORY_SMOKE_TO ?? DEFAULT_TO_BLOCK),
  );
  if (toBlock < fromBlock) throw new Error('--to must be greater than or equal to --from.');
  const sqdUrl = process.env.SQD_PORTAL_URL ?? DEFAULT_SQD_URL;
  const bscRpcUrl = process.env.BSC_RPC_URL ?? DEFAULT_BSC_RPC_URL;
  const source = new SqdPortalClient({
    portalUrl: sqdUrl,
    dataset: 'binance-mainnet',
    policy: {
      allowedHosts: [new URL(sqdUrl).hostname.toLowerCase()],
      allowPrivateNetworks: false,
      allowHttpForPrivateNetworks: false,
    },
    timeoutMs: 60_000,
    maxRangeBlocks: toBlock - fromBlock + 1,
    maxResponseBytes: 64 * 1024 * 1024,
    maxAttempts: 3,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1_000,
    requestsPerSecond: 1,
  });
  const rpcHost = new URL(bscRpcUrl).hostname.toLowerCase();
  const exactReader = new EvmLedgerAdapter(
    {
      id: 'token-history-live-smoke-rpc',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    new SafeJsonRpcTransport({
      endpointId: `token-history-live-smoke-rpc@${rpcHost}`,
      baseUrl: bscRpcUrl,
      policy: {
        allowedHosts: [rpcHost],
        allowPrivateNetworks: false,
        allowHttpForPrivateNetworks: false,
      },
      timeoutMs: 15_000,
      resilience: {
        maxAttempts: 2,
        retryBaseDelayMs: 100,
        retryMaxDelayMs: 500,
        requestsPerSecond: 2,
      },
    }),
  );
  const ledger = new EvidenceLedger();
  const facts: RawChainFact[] = [];
  const checkpoints = new MemoryCheckpoints();
  const reports = new MemoryReports();
  const evidence: EvidenceWriter = {
    put(item: Evidence, sourceIds: readonly string[] = [], snapshot?: AnalysisSnapshot) {
      return Promise.resolve(ledger.add(item, sourceIds, snapshot));
    },
  };
  const factWriter: RawFactWriter = {
    put(fact) {
      facts.push(fact);
      return Promise.resolve(fact);
    },
  };
  const options = {
    source,
    exactReader,
    originReader: new SqdEvmContractCreationReader({
      source,
      maxRangeBlocks: toBlock - fromBlock + 1,
    }),
    token,
    fromBlock,
    toBlock,
    checkpoints,
    artifacts: createArtifactWriter(),
    evidence,
    facts: factWriter,
    reportStore: reports,
  };
  const first = await new TokenHistoryDiscovery(options).run();
  const replay = await new TokenHistoryDiscovery(options).run();
  console.log(
    JSON.stringify({
      event: 'token_history_live_smoke_complete',
      token: token.toLowerCase(),
      range: { fromBlock, toBlock },
      reportId: first.report.id,
      resultHash: first.report.resultHash,
      replaySameHash: first.report.resultHash === replay.report.resultHash,
      status: first.report.status,
      observations: first.report.observations.length,
      actionSemanticsBindings: first.report.actionSemanticsBindings.map((binding) => ({
        transactionHash: binding.transactionHash,
        status: binding.status,
        reason: binding.reason,
      })),
      origin: first.report.origin,
      sourceHead: first.report.sourceHead,
      checkpoint: first.report.checkpoint,
      providerTelemetry: first.report.providerTelemetry,
      providerCapabilityDeclarations: first.report.providerCapabilityDeclarations,
      sourceSet: first.report.sourceSet,
      coverage: {
        data: first.report.dataCoverage,
        source: first.report.sourceCoverage,
        history: first.report.historyCoverage,
      },
      exactRpcHealth: await exactReader.probe(),
      rawFacts: facts.length,
      evidence: ledger.values().length,
      replayAlreadyTerminal: replay.ingestion.alreadyTerminal,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
