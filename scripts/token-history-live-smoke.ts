import {
  EvmLedgerAdapter,
  SafeJsonRpcTransport,
  SqdEvmContractCreationReader,
  SqdPortalClient,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import { buildForensicCaseBundle, verifyForensicCaseBundle } from '@zerotrace/forensic-evidence';
import { buildFundingSettlementFromTokenHistory } from '@zerotrace/funding-settlement-engine';
import {
  buildForensicCampaignAlerts,
  buildProviderBackedControlCampaign,
  ProviderCampaignReconstructionError,
} from '@zerotrace/campaign-engine';
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

function rawEvidenceLedger(source: EvidenceLedger): EvidenceLedger {
  const copy = new EvidenceLedger();
  for (const node of source.values()) {
    if (node.evidence.kind === 'DERIVED_FEATURE' || node.evidence.kind === 'NEGATIVE_EVIDENCE') {
      continue;
    }
    copy.add(node.evidence, node.sourceEvidenceIds, node.snapshot);
  }
  return copy;
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
  const fundingSettlement = await buildFundingSettlementFromTokenHistory({
    report: first.report,
    facts,
    exactReader,
    token: token.toLowerCase(),
    fromBlock,
    toBlock,
    probeHistoricalCode: !isEthereum,
  });
  const providerCampaign = (() => {
    if (fundingSettlement.status === 'UNKNOWN') {
      return {
        status: 'UNKNOWN' as const,
        reason: `FUNDING_SETTLEMENT:${fundingSettlement.reason}`,
      };
    }
    try {
      const result = buildProviderBackedControlCampaign({
        history: first.report,
        fundingSettlement: fundingSettlement.report,
        evidenceLedger: ledger,
        maxStageSnapshots: 8,
      });
      const replay = buildProviderBackedControlCampaign({
        history: first.report,
        fundingSettlement: fundingSettlement.report,
        evidenceLedger: rawEvidenceLedger(ledger),
        maxStageSnapshots: 8,
      });
      return {
        status: 'DERIVED' as const,
        result,
        replaySameHash: replay.bundle.resultHash === result.bundle.resultHash,
      };
    } catch (error) {
      return {
        status: 'UNKNOWN' as const,
        reason:
          error instanceof ProviderCampaignReconstructionError
            ? `${error.code}:${error.message}`
            : error instanceof Error
              ? error.message
              : 'PROVIDER_CAMPAIGN_RECONSTRUCTION_FAILED',
      };
    }
  })();
  const providerForensicCase = (() => {
    if (providerCampaign.status === 'UNKNOWN') {
      return {
        status: 'UNKNOWN' as const,
        reason: 'PROVIDER_CAMPAIGN_UNAVAILABLE',
      };
    }
    const bundle = buildForensicCaseBundle({
      campaign: providerCampaign.result.bundle,
      evidenceNodes: ledger.values(),
      gitCommit: process.env.GIT_COMMIT ?? null,
    });
    const verification = verifyForensicCaseBundle(bundle);
    if (!verification.valid) {
      throw new Error(
        `Forensic case offline verification failed: ${verification.errors.join('; ')}`,
      );
    }
    return {
      status: 'DERIVED' as const,
      caseId: bundle.caseId,
      manifestHash: bundle.manifest.manifestHash,
      resultHash: bundle.resultHash,
      evidenceCount: bundle.manifest.evidenceCount,
      snapshotCount: bundle.manifest.snapshotCount,
      rawArtifactCount: bundle.manifest.rawArtifactCount,
      offlineVerify: verification.valid,
    };
  })();
  const providerAlerts =
    providerCampaign.status === 'UNKNOWN'
      ? providerCampaign
      : {
          status: 'DERIVED' as const,
          alerts: buildForensicCampaignAlerts(providerCampaign.result.bundle).map((alert) => ({
            id: alert.id,
            behaviorEventId: alert.behaviorEventId,
            severity: alert.severity,
            classification: alert.classification,
            evidenceIds: alert.evidenceIds,
            resultHash: alert.resultHash,
          })),
        };
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
      providerCampaign:
        providerCampaign.status === 'UNKNOWN'
          ? providerCampaign
          : {
              status: providerCampaign.status,
              reportId: providerCampaign.result.bundle.campaign.id,
              resultHash: providerCampaign.result.bundle.resultHash,
              replaySameHash: providerCampaign.replaySameHash,
              calibrationStatus: providerCampaign.result.bundle.campaign.calibrationStatus,
              selectedWalletIds: providerCampaign.result.selectedWalletIds,
              openingBalanceUnknownWalletIds:
                providerCampaign.result.openingBalanceUnknownWalletIds,
              candidateWallets: providerCampaign.result.candidateDiscovery.candidates.map(
                (candidate) => ({
                  walletId: candidate.walletId,
                  reasons: candidate.reasons,
                  transactionCount: candidate.transactionCount,
                  evidenceIds: candidate.evidenceIds,
                }),
              ),
              stageBlocks: providerCampaign.result.stageBlocks,
              positions: providerCampaign.result.bundle.positions.map((position) => ({
                atBlock: position.atBlock,
                tokenBalanceRaw: position.tokenBalanceRaw,
                externalTokenInflowRaw: position.externalTokenInflowRaw,
                externalTokenOutflowRaw: position.externalTokenOutflowRaw,
                dexBuyRaw: position.dexBuyRaw,
                dexSellRaw: position.dexSellRaw,
              })),
              behaviorEvents: providerCampaign.result.bundle.behaviorEvents.map((event) => ({
                id: event.id,
                type: event.type,
                startBlock: event.startBlock,
                endBlock: event.endBlock,
                confidence: event.confidence,
                suppressionReasons: event.suppressionReasons,
                supportingEvidenceIds: event.supportingEvidenceIds,
                contradictingEvidenceIds: event.contradictingEvidenceIds,
              })),
              evidenceLine: {
                terminalBoundary: providerCampaign.result.bundle.evidenceLine.terminalBoundary,
                phases: providerCampaign.result.bundle.evidenceLine.phases,
                itemIds: providerCampaign.result.bundle.evidenceLine.itemIds,
                evidenceIds: providerCampaign.result.bundle.evidenceLine.evidenceIds,
              },
            },
      providerForensicCase,
      providerAlerts,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
