import 'dotenv/config';

import {
  buildProviderBackedControlCampaign,
  ProviderCampaignReconstructionError,
} from '@zerotrace/campaign-engine';
import {
  EvmLedgerAdapter,
  SafeJsonRpcTransport,
  SqdEvmContractCreationReader,
  SqdPortalClient,
  type ProviderUrlPolicy,
} from '@zerotrace/chain-adapters';
import {
  buildFundingSettlementFromTokenHistory,
  type TokenHistoryFundingSettlementResult,
} from '@zerotrace/funding-settlement-engine';
import {
  createSqdProfileRequest,
  SqdFinalizedIngestionPipeline,
  TokenHistoryDiscovery,
  type EvidenceWriter,
} from '@zerotrace/ingestion';
import { EvidenceLedger } from '@zerotrace/evidence';
import {
  PostgresActionSemanticsReportRepository,
  ClickHouseRawFactRepository,
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
  PostgresTokenHistoryDiscoveryReportRepository,
  PostgresControlCampaignReportRepository,
  PostgresFundingSettlementReportRepository,
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
  let controlCampaignReports: PostgresControlCampaignReportRepository | undefined;
  let fundingSettlementReports: PostgresFundingSettlementReportRepository | undefined;
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
      controlCampaignReports = new PostgresControlCampaignReportRepository({
        connectionString: config.postgresUrl,
        maxConnections: 4,
      });
      fundingSettlementReports = new PostgresFundingSettlementReportRepository({
        connectionString: config.postgresUrl,
        maxConnections: 4,
      });
      const tokenHistoryHealth = await Promise.all([
        tokenHistoryReports.health(),
        actionSemantics.health(),
        controlCampaignReports.health(),
        fundingSettlementReports.health(),
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
      const evidenceRepository = evidence;
      const factRepository = facts;
      const campaignReports = controlCampaignReports;
      const fundingReports = fundingSettlementReports;
      if (
        evidenceRepository === undefined ||
        factRepository === undefined ||
        campaignReports === undefined ||
        fundingReports === undefined
      ) {
        throw new Error('Token History campaign storage dependencies are unavailable.');
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
      const evidenceLedger = new EvidenceLedger();
      const evidenceWriter: EvidenceWriter = {
        put: async (item, sourceIds = [], snapshot) => {
          const stored = await evidenceRepository.put(item, sourceIds, snapshot);
          if (evidenceLedger.get(stored.evidence.id) === undefined) {
            evidenceLedger.add(stored.evidence, stored.sourceEvidenceIds, stored.snapshot);
          }
          return stored;
        },
      };
      const result = await new TokenHistoryDiscovery({
        source,
        token: config.token as string,
        fromBlock: config.fromBlock,
        toBlock: config.toBlock,
        checkpoints,
        artifacts,
        evidence: evidenceWriter,
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
      const hydrateEvidence = async (id: string): Promise<void> => {
        if (evidenceLedger.get(id) !== undefined) return;
        const stored = await evidenceRepository.get(id);
        if (stored === undefined)
          throw new Error(`Evidence ${id} is unavailable for campaign reconstruction.`);
        for (const sourceId of stored.sourceEvidenceIds) await hydrateEvidence(sourceId);
        evidenceLedger.add(stored.evidence, stored.sourceEvidenceIds, stored.snapshot);
      };
      let providerCampaign:
        | {
            status: 'DERIVED';
            id: string;
            resultHash: string;
            replaySameHash: boolean;
          }
        | { status: 'UNKNOWN'; reason: string };
      let fundingSettlement:
        | Extract<TokenHistoryFundingSettlementResult, { status: 'DERIVED' }>
        | { status: 'UNKNOWN'; reason: string };
      if (exactReader === undefined) {
        fundingSettlement = {
          status: 'UNKNOWN',
          reason: 'EXACT_RPC_NOT_CONFIGURED',
        };
      } else {
        try {
          const tokenFacts = [] as Awaited<ReturnType<ClickHouseRawFactRepository['listRange']>>;
          for (let offset = 0; ; offset += 10_000) {
            const page = await factRepository.listRange({
              ledger: 'EVM',
              chainId: result.report.chainId,
              fromBlock: config.fromBlock,
              toBlock: config.toBlock,
              limit: 10_000,
              offset,
            });
            tokenFacts.push(...page);
            if (page.length < 10_000) break;
          }
          const derived = await buildFundingSettlementFromTokenHistory({
            report: result.report,
            facts: tokenFacts,
            exactReader,
            token: config.token as string,
            fromBlock: config.fromBlock,
            toBlock: config.toBlock,
            probeHistoricalCode: config.dataset === 'binance-mainnet',
          });
          if (derived.status === 'UNKNOWN') {
            fundingSettlement = derived;
          } else {
            const stored = await fundingReports.put(derived.report);
            fundingSettlement = { ...derived, report: stored };
          }
        } catch (error) {
          fundingSettlement = {
            status: 'UNKNOWN',
            reason: error instanceof Error ? error.message : 'FUNDING_SETTLEMENT_FAILED',
          };
        }
      }
      try {
        for (const evidenceId of result.report.evidenceIds) await hydrateEvidence(evidenceId);
        if (fundingSettlement.status === 'DERIVED') {
          for (const evidenceId of fundingSettlement.report.evidenceIds) {
            await hydrateEvidence(evidenceId);
          }
        }
        const reconstructed = buildProviderBackedControlCampaign({
          history: result.report,
          ...(fundingSettlement.status === 'DERIVED'
            ? { fundingSettlement: fundingSettlement.report }
            : {}),
          evidenceLedger,
          maxStageSnapshots: 8,
        });
        for (const derivedEvidence of reconstructed.derivedEvidence) {
          const node = evidenceLedger.get(derivedEvidence.id);
          if (node === undefined) {
            throw new Error(
              `Derived Campaign Evidence ${derivedEvidence.id} is unavailable for durable storage.`,
            );
          }
          await evidenceRepository.put(derivedEvidence, node.sourceEvidenceIds, node.snapshot);
        }
        const stored = await campaignReports.put(reconstructed.bundle);
        providerCampaign = {
          status: 'DERIVED',
          id: stored.id,
          resultHash: stored.resultHash,
          replaySameHash: stored.resultHash === reconstructed.bundle.resultHash,
        };
      } catch (error) {
        providerCampaign = {
          status: 'UNKNOWN',
          reason:
            error instanceof ProviderCampaignReconstructionError
              ? `${error.code}:${error.message}`
              : error instanceof Error
                ? error.message
                : 'PROVIDER_CAMPAIGN_RECONSTRUCTION_FAILED',
        };
      }
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
          providerCampaign,
          fundingSettlement:
            fundingSettlement.status === 'UNKNOWN'
              ? fundingSettlement
              : {
                  status: fundingSettlement.status,
                  id: fundingSettlement.report.id,
                  resultHash: fundingSettlement.report.resultHash,
                  replaySameHash:
                    fundingSettlement.report.resultHash === fundingSettlement.replayResultHash,
                  reportStatus: fundingSettlement.report.status,
                  coverageScope: fundingSettlement.report.coverageScope,
                  coverage: {
                    data: fundingSettlement.report.dataCoverage,
                    source: fundingSettlement.report.sourceCoverage,
                    history: fundingSettlement.report.historyCoverage,
                  },
                  focusWalletIds: fundingSettlement.focusWalletIds,
                  focusSelection: fundingSettlement.focusSelection,
                  codeProbeFailures: fundingSettlement.codeProbeFailures,
                  fundingEdges: fundingSettlement.report.fundingEdges.length,
                  settlementEdges: fundingSettlement.report.settlementEdges.length,
                  suppressedPaths: fundingSettlement.report.suppressedPaths.length,
                },
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
      ...(controlCampaignReports === undefined ? [] : [controlCampaignReports.close()]),
      ...(fundingSettlementReports === undefined ? [] : [fundingSettlementReports.close()]),
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
