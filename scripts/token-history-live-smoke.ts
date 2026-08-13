import {
  EvmLedgerAdapter,
  SafeJsonRpcTransport,
  SqdEvmContractCreationReader,
  SqdPortalClient,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import {
  decodeEvmAssetTransfers,
  deriveFundingSettlementReport,
} from '@zerotrace/funding-settlement-engine';
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
const DEFAULT_ETHEREUM_RPC_URL = 'https://ethereum-rpc.publicnode.com';
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

function blockArgument(name: string, fallback: number, aliases: readonly string[] = []): number {
  const value =
    argument(name) ??
    aliases.map((alias) => argument(alias)).find((item) => item !== undefined) ??
    String(fallback);
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

async function buildBoundedFundingSettlement(input: {
  report: TokenHistoryDiscoveryReport;
  facts: readonly RawChainFact[];
  exactReader: EvmLedgerAdapter;
  token: string;
  fromBlock: number;
  toBlock: number;
  probeHistoricalCode: boolean;
}): Promise<
  | {
      status: 'UNKNOWN';
      reason: string;
      focusWalletIds: readonly string[];
      focusSelection: {
        codeConfirmed: readonly string[];
        transactionSenderFallback: readonly string[];
      };
      codeProbeFailures: readonly string[];
    }
  | {
      status: 'DERIVED';
      report: ReturnType<typeof deriveFundingSettlementReport>;
      replayResultHash: string;
      focusWalletIds: readonly string[];
      focusSelection: {
        codeConfirmed: readonly string[];
        transactionSenderFallback: readonly string[];
      };
      codeProbeFailures: readonly string[];
    }
> {
  const observationByTransaction = new Map(
    input.report.observations.map((observation) => [observation.transactionHash, observation]),
  );
  const candidates = [
    ...new Set(
      input.report.observations.flatMap((observation) => [observation.from, observation.to]),
    ),
  ].filter((address) => address !== input.token.toLowerCase());
  const codeConfirmed: string[] = [];
  const codeStatus = new Map<string, string>();
  const codeProbeFailures: string[] = [];
  for (const address of candidates.sort()) {
    if (!input.probeHistoricalCode) continue;
    const observation = input.report.observations.find(
      (item) => item.from === address || item.to === address,
    );
    if (observation === undefined) continue;
    try {
      const code = await input.exactReader.getCodeObservationAtBlockHash(
        address,
        observation.snapshot.blockHash,
      );
      codeStatus.set(address, code.value);
      if (code.value === '0x') codeConfirmed.push(address);
    } catch (error) {
      codeProbeFailures.push(`${address}:${error instanceof Error ? error.message : 'ERROR'}`);
    }
  }
  const captures: Array<{
    transaction: NonNullable<Awaited<ReturnType<EvmLedgerAdapter['getTransaction']>>>;
    receipt: NonNullable<Awaited<ReturnType<EvmLedgerAdapter['getTransactionReceipt']>>>;
    snapshot: Extract<TokenHistoryDiscoveryReport['snapshot'], { ledger: 'EVM' }>;
    transactionEvidenceIds: readonly string[];
    rawArtifactRef?: string;
  }> = [];
  for (const transactionHash of input.report.relevantTransactionHashes) {
    const observation = observationByTransaction.get(transactionHash);
    if (observation === undefined) continue;
    const [transactionObservation, receiptObservation] = await Promise.all([
      input.exactReader.getTransactionObservation(transactionHash),
      input.exactReader.getTransactionReceiptObservation(transactionHash),
    ]);
    if (transactionObservation.value === null || receiptObservation.value === null) continue;
    const transactionFact = input.facts.find(
      (fact) => fact.factType === 'TRANSACTION' && fact.subject.toLowerCase() === transactionHash,
    );
    const evidenceIds =
      transactionFact?.evidenceId === undefined
        ? observation.evidenceIds
        : [transactionFact.evidenceId];
    captures.push({
      transaction: transactionObservation.value,
      receipt: receiptObservation.value,
      snapshot: observation.snapshot,
      transactionEvidenceIds: evidenceIds,
      ...(transactionFact?.rawArtifactRef === undefined
        ? {}
        : { rawArtifactRef: transactionFact.rawArtifactRef }),
    });
  }
  const transactionSenderFallback = [
    ...new Set(
      captures
        .map((capture) => capture.transaction.from.toLowerCase())
        .filter((address) => candidates.includes(address) && codeStatus.get(address) !== '0x'),
    ),
  ].sort();
  const focusWalletIds = [...new Set([...codeConfirmed, ...transactionSenderFallback])].sort();
  if (focusWalletIds.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: 'NO_EOA_FOCUS_WALLET_AFTER_EXACT_CODE_CHECK_AND_TX_SENDER_FALLBACK',
      focusWalletIds,
      focusSelection: { codeConfirmed, transactionSenderFallback },
      codeProbeFailures,
    };
  }
  const transfers = captures.flatMap((capture) => decodeEvmAssetTransfers(capture));
  if (transfers.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: 'NO_EXACT_ASSET_TRANSFERS_IN_RELEVANT_RECEIPTS',
      focusWalletIds,
      focusSelection: { codeConfirmed, transactionSenderFallback },
      codeProbeFailures,
    };
  }
  const sourceSet = [...new Set([...input.report.sourceSet, input.exactReader.sourceId])].sort();
  const report = deriveFundingSettlementReport({
    token: input.token,
    fromBlock: String(input.fromBlock),
    toBlock: String(input.toBlock),
    snapshot: input.report.snapshot as Extract<
      TokenHistoryDiscoveryReport['snapshot'],
      { ledger: 'EVM' }
    >,
    transfers,
    focusWalletIds,
    dataCoverage: input.report.dataCoverage,
    sourceCoverage: input.report.sourceCoverage,
    historyCoverage: 0,
    coverageScope: 'TRANSACTION_LOCAL',
    sourceSet,
    maxHops: 2,
  });
  const replay = deriveFundingSettlementReport({
    token: input.token,
    fromBlock: String(input.fromBlock),
    toBlock: String(input.toBlock),
    snapshot: input.report.snapshot as Extract<
      TokenHistoryDiscoveryReport['snapshot'],
      { ledger: 'EVM' }
    >,
    transfers: [...transfers].reverse(),
    focusWalletIds,
    dataCoverage: input.report.dataCoverage,
    sourceCoverage: input.report.sourceCoverage,
    historyCoverage: 0,
    coverageScope: 'TRANSACTION_LOCAL',
    sourceSet,
    maxHops: 2,
  });
  return {
    status: 'DERIVED',
    report,
    replayResultHash: replay.resultHash,
    focusWalletIds,
    focusSelection: { codeConfirmed, transactionSenderFallback },
    codeProbeFailures,
  };
}

async function main(): Promise<void> {
  const network = argument('--network', 'bsc');
  if (network !== 'bsc' && network !== 'ethereum') {
    throw new Error('--network must be bsc or ethereum.');
  }
  const isEthereum = network === 'ethereum';
  const dataset = isEthereum ? ('ethereum-mainnet' as const) : ('binance-mainnet' as const);
  const chainId = isEthereum ? 1 : 56;
  const token = argument('--token', process.env.TOKEN_HISTORY_SMOKE_TOKEN);
  if (token === undefined || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
    throw new Error('--token or TOKEN_HISTORY_SMOKE_TOKEN must be a valid EVM address.');
  }
  const fromBlock = blockArgument(
    '--from',
    Number(
      process.env[isEthereum ? 'TOKEN_HISTORY_SMOKE_ETHEREUM_FROM' : 'TOKEN_HISTORY_SMOKE_FROM'] ??
        DEFAULT_FROM_BLOCK,
    ),
    ['--from-block'],
  );
  const toBlock = blockArgument(
    '--to',
    Number(
      process.env[isEthereum ? 'TOKEN_HISTORY_SMOKE_ETHEREUM_TO' : 'TOKEN_HISTORY_SMOKE_TO'] ??
        DEFAULT_TO_BLOCK,
    ),
    ['--to-block'],
  );
  if (toBlock < fromBlock) throw new Error('--to must be greater than or equal to --from.');
  const sqdUrl = process.env.SQD_PORTAL_URL ?? DEFAULT_SQD_URL;
  const configuredRpcUrl = argument(
    '--rpc-url',
    isEthereum ? process.env.ETH_RPC_URL : process.env.BSC_RPC_URL,
  );
  const rpcUrl =
    configuredRpcUrl === undefined || configuredRpcUrl.includes('${ALCHEMY_API_KEY}')
      ? isEthereum
        ? DEFAULT_ETHEREUM_RPC_URL
        : DEFAULT_BSC_RPC_URL
      : configuredRpcUrl;
  const source = new SqdPortalClient({
    portalUrl: sqdUrl,
    dataset,
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
  const rpcHost = new URL(rpcUrl).hostname.toLowerCase();
  const exactReader = new EvmLedgerAdapter(
    {
      id: `token-history-live-smoke-${network}-rpc`,
      chainId,
      chainName: isEthereum ? 'Ethereum' : 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    new SafeJsonRpcTransport({
      endpointId: `token-history-live-smoke-${network}-rpc@${rpcHost}`,
      baseUrl: rpcUrl,
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
    ...(isEthereum
      ? {}
      : {
          originReader: new SqdEvmContractCreationReader({
            source,
            maxRangeBlocks: toBlock - fromBlock + 1,
          }),
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
  const fundingSettlement = await buildBoundedFundingSettlement({
    report: first.report,
    facts,
    exactReader,
    token: token.toLowerCase(),
    fromBlock,
    toBlock,
    probeHistoricalCode: !isEthereum,
  });
  console.log(
    JSON.stringify({
      event: 'token_history_live_smoke_complete',
      network,
      dataset,
      chainId,
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
      fundingSettlement:
        fundingSettlement.status === 'UNKNOWN'
          ? fundingSettlement
          : {
              status: fundingSettlement.status,
              id: fundingSettlement.report.id,
              resultHash: fundingSettlement.report.resultHash,
              reportStatus: fundingSettlement.report.status,
              replaySameHash:
                fundingSettlement.report.resultHash === fundingSettlement.replayResultHash,
              coverageScope: fundingSettlement.report.coverageScope,
              coverage: {
                data: fundingSettlement.report.dataCoverage,
                source: fundingSettlement.report.sourceCoverage,
                history: fundingSettlement.report.historyCoverage,
              },
              focusWalletIds: fundingSettlement.focusWalletIds,
              focusSelection: fundingSettlement.focusSelection,
              codeProbeFailures: fundingSettlement.codeProbeFailures,
              fundingEdges: fundingSettlement.report.fundingEdges.map((edge) => ({
                relation: edge.relation,
                source: edge.source,
                destination: edge.destination,
                asset: edge.asset,
                amountAtomic: edge.amountAtomic,
                transactionHash: edge.transactionHash,
                evidenceIds: edge.evidenceIds,
              })),
              settlementEdges: fundingSettlement.report.settlementEdges.map((edge) => ({
                relation: edge.relation,
                source: edge.source,
                destination: edge.destination,
                asset: edge.asset,
                amountAtomic: edge.amountAtomic,
                transactionHash: edge.transactionHash,
                evidenceIds: edge.evidenceIds,
              })),
              patterns: fundingSettlement.report.patterns.map((pattern) => ({
                kind: pattern.kind,
                source: pattern.source,
                destinations: pattern.destinations,
                edgeIds: pattern.edgeIds,
                evidenceIds: pattern.evidenceIds,
              })),
              suppressedPaths: fundingSettlement.report.suppressedPaths.map((path) => ({
                reason: path.reason,
                source: path.source,
                destination: path.destination,
                transactionHash: path.transactionHash,
                evidenceIds: path.evidenceIds,
              })),
              drilldown: fundingSettlement.report.drilldown,
            },
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
