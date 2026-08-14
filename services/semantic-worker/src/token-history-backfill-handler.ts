import {
  EvmLedgerAdapter,
  FailoverJsonRpcTransport,
  SafeJsonRpcTransport,
  SqdEvmContractCreationReader,
  SqdPortalClient,
  type JsonRpcTransport,
} from '@zerotrace/chain-adapters';
import {
  CaptureExecutionError,
  type CaptureRun,
  type CaptureHandler,
} from '@zerotrace/capture-scheduler';
import {
  buildForensicCampaignAlerts,
  buildProviderBackedControlCampaign,
} from '@zerotrace/campaign-engine';
import { EvidenceLedger, createEvidence, hashPayload } from '@zerotrace/evidence';
import { buildFundingSettlementFromTokenHistory } from '@zerotrace/funding-settlement-engine';
import { TokenHistoryDiscovery } from '@zerotrace/ingestion';
import {
  CaptureRunSuccessSchema,
  TokenLiveCaptureParametersSchema,
  TokenHistoryBackfillParametersSchema,
  type TokenLiveCaptureParameters,
  type CaptureRunSuccess,
  type Evidence,
  type RawChainFact,
  type TokenHistoryBackfillParameters,
} from '@zerotrace/schemas';
import type {
  PostgresActionSemanticsReportRepository,
  PostgresControlCampaignReportRepository,
  PostgresCaptureScheduleRepository,
  PostgresEvidenceRepository,
  PostgresForensicCampaignAlertRepository,
  PostgresFundingSettlementReportRepository,
  PostgresIngestionCheckpointRepository,
  PostgresTokenHistoryDiscoveryReportRepository,
  ClickHouseRawFactRepository,
  RawArtifactStore,
} from '@zerotrace/storage';

import type { TokenHistoryBackfillWorkerConfig } from './token-history-backfill-config.js';
import { providerPolicy } from './worker.js';

export interface TokenHistoryBackfillHandlerResources {
  facts: ClickHouseRawFactRepository;
  checkpoints: PostgresIngestionCheckpointRepository;
  artifacts: RawArtifactStore;
  evidence: PostgresEvidenceRepository;
  actionSemantics: PostgresActionSemanticsReportRepository;
  reports: PostgresTokenHistoryDiscoveryReportRepository;
  funding: PostgresFundingSettlementReportRepository;
  campaigns: PostgresControlCampaignReportRepository;
  schedules: PostgresCaptureScheduleRepository;
  alerts: PostgresForensicCampaignAlertRepository;
}

function asRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;
  const value = error as { retryable?: unknown; sourceRetryable?: unknown };
  if (typeof value.sourceRetryable === 'boolean') return value.sourceRetryable;
  if (typeof value.retryable === 'boolean') return value.retryable;
  return true;
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'TOKEN_HISTORY_BACKFILL_FAILED';
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' && value.trim() !== ''
    ? value.slice(0, 160)
    : 'TOKEN_HISTORY_BACKFILL_FAILED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Token History backfill failed.';
}

function rangeNumber(parameters: TokenHistoryBackfillParameters): {
  fromBlock: number;
  toBlock: number;
} {
  const from = BigInt(parameters.fromBlock);
  const to = BigInt(parameters.toBlock);
  if (
    from > BigInt(Number.MAX_SAFE_INTEGER) ||
    to > BigInt(Number.MAX_SAFE_INTEGER) ||
    to < from ||
    to - from + 1n > 1_000_000n
  ) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_RANGE_INVALID',
      'Token History backfill range exceeds the worker safety bound.',
      false,
    );
  }
  return { fromBlock: Number(from), toBlock: Number(to) };
}

function chainForDataset(dataset: TokenHistoryBackfillParameters['dataset']): {
  chainId: number;
  chainName: string;
} {
  return dataset === 'ethereum-mainnet'
    ? { chainId: 1, chainName: 'Ethereum Mainnet' }
    : { chainId: 56, chainName: 'BNB Smart Chain' };
}

function transportFor(
  urls: readonly string[],
  endpointPrefix: string,
  config: TokenHistoryBackfillWorkerConfig,
  requestsPerSecond: number,
): JsonRpcTransport {
  const transports = urls.map(
    (url, index) =>
      new SafeJsonRpcTransport({
        endpointId: `${endpointPrefix}@${new URL(url).hostname.toLowerCase()}${
          urls.length === 1 ? '' : `#${index + 1}`
        }`,
        baseUrl: url,
        policy: providerPolicy(config.providerAllowedHosts, config.allowPrivateProviderUrls),
        timeoutMs: config.requestTimeoutMs,
        resilience: {
          maxAttempts: config.maxAttempts,
          retryBaseDelayMs: config.retryBaseDelayMs,
          retryMaxDelayMs: config.retryMaxDelayMs,
          requestsPerSecond,
        },
      }),
  );
  const first = transports[0];
  if (first === undefined) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_RPC_UNCONFIGURED',
      `No read-only RPC endpoint is configured for ${endpointPrefix}.`,
      false,
    );
  }
  return transports.length === 1 ? first : new FailoverJsonRpcTransport(endpointPrefix, transports);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function loadFacts(
  resources: TokenHistoryBackfillHandlerResources,
  chainId: string,
  fromBlock: number,
  toBlock: number,
  maximum: number,
): Promise<RawChainFact[]> {
  const pageSize = 10_000;
  const facts: RawChainFact[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await resources.facts.listRange({
      ledger: 'EVM',
      chainId,
      fromBlock,
      toBlock,
      limit: pageSize,
      offset,
    });
    facts.push(...page);
    if (facts.length > maximum) {
      throw new CaptureExecutionError(
        'TOKEN_HISTORY_BACKFILL_FACT_LIMIT',
        `Raw Fact range exceeded the configured ${maximum}-row safety bound.`,
        false,
      );
    }
    if (page.length < pageSize) return facts;
  }
}

async function hydrateEvidence(
  ledger: EvidenceLedger,
  repository: PostgresEvidenceRepository,
  id: string,
  visiting = new Set<string>(),
): Promise<void> {
  if (ledger.get(id) !== undefined) return;
  if (visiting.has(id)) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EVIDENCE_CYCLE',
      `Evidence source cycle detected at ${id}.`,
      false,
    );
  }
  visiting.add(id);
  const node = await repository.get(id);
  if (node === undefined) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EVIDENCE_MISSING',
      `Required Evidence ${id} is not available in durable storage.`,
      false,
    );
  }
  for (const sourceId of node.sourceEvidenceIds) {
    await hydrateEvidence(ledger, repository, sourceId, visiting);
  }
  ledger.add(node.evidence, node.sourceEvidenceIds, node.snapshot);
  visiting.delete(id);
}

async function persistLedger(
  ledger: EvidenceLedger,
  repository: PostgresEvidenceRepository,
): Promise<void> {
  for (const node of ledger.values()) {
    await repository.put(node.evidence, node.sourceEvidenceIds, node.snapshot);
  }
}

function terminalEvidence(
  report: Awaited<ReturnType<TokenHistoryDiscovery['run']>>['report'],
  campaignId: string,
  campaignResultHash: string,
): Evidence {
  const snapshot = report.snapshot;
  if (snapshot.ledger !== 'EVM') {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_SNAPSHOT_INVALID',
      'Token History backfill terminal Snapshot is not EVM.',
      false,
    );
  }
  return createEvidence({
    ledger: 'EVM',
    chainId: report.chainId,
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:token-history-backfill-v1.0.0',
    locator: `token-history-backfill:${campaignId}`,
    payload: {
      schemaVersion: 'token-history-backfill-capture-result-v1',
      reportId: report.id,
      reportResultHash: report.resultHash,
      campaignId,
      campaignResultHash,
      fromBlock: report.fromBlock,
      toBlock: report.toBlock,
      status: report.status,
    },
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    observedAt: snapshot.capturedAt,
    summary: 'Token History backfill and provider-backed Control Campaign completed.',
    sourceEvidenceIds: report.rangeEvidenceIds,
  });
}

export function createTokenHistoryBackfillHandler(
  config: TokenHistoryBackfillWorkerConfig,
  resources: TokenHistoryBackfillHandlerResources,
): CaptureHandler {
  return async (run: CaptureRun, signal?: AbortSignal): Promise<CaptureRunSuccess> => {
    if (signal?.aborted === true) {
      throw new CaptureExecutionError(
        'TOKEN_HISTORY_BACKFILL_ABORTED',
        'Capture was aborted.',
        true,
      );
    }
    let parameters: TokenHistoryBackfillParameters;
    try {
      parameters = TokenHistoryBackfillParametersSchema.parse(run.parameters);
    } catch (error) {
      throw new CaptureExecutionError(
        'TOKEN_HISTORY_BACKFILL_INVALID_PARAMETERS',
        'Capture parameters are not a valid Token History backfill request.',
        false,
        error,
      );
    }
    const chain = chainForDataset(parameters.dataset);
    const expectedChainId = `eip155:${chain.chainId}`;
    if (
      run.captureKind !== 'TOKEN_HISTORY_BACKFILL' ||
      run.target.ledger !== 'EVM' ||
      run.target.chainId !== expectedChainId ||
      run.target.subjectType !== 'TOKEN' ||
      run.target.normalizedIdentifier !== parameters.token.toLowerCase()
    ) {
      throw new CaptureExecutionError(
        'TOKEN_HISTORY_BACKFILL_TARGET_MISMATCH',
        'Capture target does not match its immutable Token History parameters.',
        false,
      );
    }
    const { fromBlock, toBlock } = rangeNumber(parameters);
    const rpcUrls =
      parameters.dataset === 'ethereum-mainnet' ? config.ethereumRpcUrls : config.bscRpcUrls;
    const rpc = transportFor(
      rpcUrls,
      parameters.dataset === 'ethereum-mainnet' ? 'ethereum-rpc' : 'bsc-rpc',
      config,
      parameters.dataset === 'ethereum-mainnet'
        ? config.ethereumRequestsPerSecond
        : config.bscRequestsPerSecond,
    );
    const adapter = new EvmLedgerAdapter(
      {
        id: parameters.dataset === 'ethereum-mainnet' ? 'ethereum-rpc' : 'bsc-rpc',
        chainId: chain.chainId,
        chainName: chain.chainName,
        snapshotBlockTag: 'finalized',
      },
      rpc,
    );
    const source = new SqdPortalClient({
      portalUrl: config.sqdPortalUrl,
      dataset: parameters.dataset,
      policy: providerPolicy(config.sqdAllowedHosts, config.allowPrivateProviderUrls),
      timeoutMs: config.requestTimeoutMs,
      maxRangeBlocks: 1_000_000,
      maxAttempts: config.maxAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
      retryMaxDelayMs: config.retryMaxDelayMs,
      requestsPerSecond: config.sqdRequestsPerSecond,
    });
    const discovery = new TokenHistoryDiscovery({
      source,
      token: parameters.token,
      fromBlock,
      toBlock,
      exactReader: adapter,
      originReader: new SqdEvmContractCreationReader({
        source,
        maxRangeBlocks: 1_000_000,
        maxResults: 16,
      }),
      checkpoints: resources.checkpoints,
      artifacts: resources.artifacts,
      evidence: resources.evidence,
      facts: resources.facts,
      factReader: resources.facts,
      evidenceReader: resources.evidence,
      reportStore: resources.reports,
      actionSemantics: resources.actionSemantics,
    });
    try {
      const result = await discovery.run();
      if (signal !== undefined && signal.aborted) {
        throw new CaptureExecutionError(
          'TOKEN_HISTORY_BACKFILL_ABORTED',
          'Capture was aborted.',
          true,
        );
      }
      const report = result.report;
      const facts = await loadFacts(
        resources,
        expectedChainId,
        fromBlock,
        toBlock,
        config.maxFactRows,
      );
      const ledger = new EvidenceLedger();
      for (const id of report.evidenceIds) await hydrateEvidence(ledger, resources.evidence, id);
      const fundingResult = await buildFundingSettlementFromTokenHistory({
        report,
        facts,
        exactReader: adapter,
        token: parameters.token,
        fromBlock,
        toBlock,
        probeHistoricalCode: true,
      });
      const fundingReport =
        fundingResult.status === 'DERIVED'
          ? await resources.funding.put(fundingResult.report)
          : undefined;
      if (fundingReport !== undefined) {
        for (const id of fundingReport.evidenceIds) {
          await hydrateEvidence(ledger, resources.evidence, id);
        }
      }
      const reconstruction = buildProviderBackedControlCampaign({
        history: report,
        ...(fundingReport === undefined ? {} : { fundingSettlement: fundingReport }),
        evidenceLedger: ledger,
        maxStageSnapshots: 8,
      });
      await persistLedger(ledger, resources.evidence);
      const campaign = await resources.campaigns.put(reconstruction.bundle);
      for (const alert of buildForensicCampaignAlerts(campaign.bundle)) {
        await resources.alerts.put(alert);
      }
      const terminal = terminalEvidence(report, campaign.id, campaign.resultHash);
      ledger.add(terminal, report.rangeEvidenceIds, report.snapshot);
      await resources.evidence.put(terminal, report.rangeEvidenceIds, report.snapshot);
      const evidenceIds = ledger
        .values()
        .map((node) => node.evidence.id)
        .sort();
      const sourceSet = sortedUnique([
        ...report.sourceSet,
        ...campaign.sourceSet,
        ...(fundingReport?.sourceSet ?? []),
      ]);
      const coverage = Math.min(
        report.dataCoverage,
        report.sourceCoverage,
        report.historyCoverage,
        campaign.bundle.campaign.metadata.dataCoverage,
        campaign.bundle.campaign.metadata.sourceCoverage,
        campaign.bundle.campaign.metadata.historyCoverage,
      );
      return CaptureRunSuccessSchema.parse({
        resultRef: `control-campaign:${campaign.id}#sha256=${campaign.resultHash}`,
        snapshot: report.snapshot,
        terminalEvidenceId: terminal.id,
        evidenceIds,
        sourceSet,
        modelVersion: 'token-history-backfill-capture-v1.0.0',
        coverage,
        freshness: report.snapshot.capturedAt,
        // This is capture completeness, not a calibrated probability for the inferred campaign.
        confidence: coverage,
      });
    } catch (error) {
      if (error instanceof CaptureExecutionError) throw error;
      throw new CaptureExecutionError(
        errorCode(error),
        errorMessage(error),
        asRetryable(error),
        error,
      );
    }
  };
}

function previousSuccessfulRunEnd(runs: readonly CaptureRun[]):
  | {
      blockNumber: number;
      blockHash: string;
    }
  | undefined {
  const successful = runs
    .flatMap((run) =>
      run.status === 'SUCCEEDED' && run.result.state === 'known' ? [run.result.value] : [],
    )
    .filter(
      (
        result,
      ): result is CaptureRunSuccess & {
        snapshot: { ledger: 'EVM'; blockNumber: string; blockHash: string };
      } => result.snapshot.ledger === 'EVM',
    )
    .sort((left, right) => {
      const position = BigInt(left.snapshot.blockNumber) - BigInt(right.snapshot.blockNumber);
      return position === 0n ? 0 : position < 0n ? 1 : -1;
    })[0];
  if (successful?.snapshot.ledger !== 'EVM') return undefined;
  const blockNumber = Number(successful.snapshot.blockNumber);
  if (!Number.isSafeInteger(blockNumber)) return undefined;
  return { blockNumber, blockHash: successful.snapshot.blockHash };
}

function liveCaptureEvidence(input: {
  run: CaptureRun;
  parameters: TokenLiveCaptureParameters;
  snapshot: Extract<
    Awaited<ReturnType<EvmLedgerAdapter['readHeadAnchor']>>['snapshot'],
    { ledger: 'EVM' }
  >;
  fromBlock: number;
}): ReturnType<typeof createEvidence> {
  return createEvidence({
    ledger: 'EVM',
    chainId: input.snapshot.chainId,
    kind: 'PROVIDER_OBSERVATION',
    source: 'zerotrace:token-live-capture-v1.0.0',
    locator: `token-live-capture:heartbeat:${input.run.scheduleId}:${input.snapshot.blockNumber}`,
    payload: {
      schemaVersion: 'token-live-capture-heartbeat-v1',
      scheduleId: input.run.scheduleId,
      token: input.parameters.token,
      fromBlock: String(input.fromBlock),
      finalizedHead: input.snapshot.blockNumber,
      state: 'NO_NEW_FINALIZED_RANGE',
    },
    blockOrSlot: input.snapshot.blockNumber,
    finality: input.snapshot.finality,
    observedAt: input.snapshot.capturedAt,
    summary: 'Finalized Token Campaign monitor observed no new range to capture.',
  });
}

export function createTokenHistoryLiveCaptureHandler(
  config: TokenHistoryBackfillWorkerConfig,
  resources: TokenHistoryBackfillHandlerResources,
): CaptureHandler {
  const backfill = createTokenHistoryBackfillHandler(config, resources);
  return async (run: CaptureRun, signal?: AbortSignal) => {
    if (run.captureKind !== 'TOKEN_LIVE_CAPTURE') {
      throw new CaptureExecutionError(
        'TOKEN_LIVE_CAPTURE_KIND_INVALID',
        'Capture run is not a Token Live Capture run.',
        false,
      );
    }
    let parameters: TokenLiveCaptureParameters;
    try {
      parameters = TokenLiveCaptureParametersSchema.parse(run.parameters);
    } catch (error) {
      throw new CaptureExecutionError(
        'TOKEN_LIVE_CAPTURE_INVALID_PARAMETERS',
        'Capture parameters are not a valid Token Live Capture request.',
        false,
        error,
      );
    }
    const chain = chainForDataset(parameters.dataset);
    const expectedChainId = `eip155:${chain.chainId}`;
    if (
      run.target.ledger !== 'EVM' ||
      run.target.chainId !== expectedChainId ||
      run.target.subjectType !== 'TOKEN' ||
      run.target.normalizedIdentifier !== parameters.token.toLowerCase()
    ) {
      throw new CaptureExecutionError(
        'TOKEN_LIVE_CAPTURE_TARGET_MISMATCH',
        'Live monitor target does not match its immutable Token Live Capture parameters.',
        false,
      );
    }
    if (resources.schedules === undefined) {
      throw new CaptureExecutionError(
        'TOKEN_LIVE_CAPTURE_SCHEDULER_UNAVAILABLE',
        'Live monitor requires durable schedule history for its incremental cursor.',
        false,
      );
    }
    const rpcUrls =
      parameters.dataset === 'ethereum-mainnet' ? config.ethereumRpcUrls : config.bscRpcUrls;
    const rpc = transportFor(
      rpcUrls,
      parameters.dataset === 'ethereum-mainnet' ? 'ethereum-rpc' : 'bsc-rpc',
      config,
      parameters.dataset === 'ethereum-mainnet'
        ? config.ethereumRequestsPerSecond
        : config.bscRequestsPerSecond,
    );
    const adapter = new EvmLedgerAdapter(
      {
        id: parameters.dataset === 'ethereum-mainnet' ? 'ethereum-rpc' : 'bsc-rpc',
        chainId: chain.chainId,
        chainName: chain.chainName,
        snapshotBlockTag: 'finalized',
      },
      rpc,
    );
    try {
      const head = await adapter.readHeadAnchor();
      if (head.snapshot.ledger !== 'EVM') {
        throw new CaptureExecutionError(
          'TOKEN_LIVE_CAPTURE_SNAPSHOT_INVALID',
          'Finalized monitor head Snapshot is not EVM.',
          false,
        );
      }
      const finalizedHeadQuantity = BigInt(head.snapshot.blockNumber);
      const initialFromQuantity = BigInt(parameters.initialFromBlock);
      if (
        finalizedHeadQuantity > BigInt(Number.MAX_SAFE_INTEGER) ||
        initialFromQuantity > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new CaptureExecutionError(
          'TOKEN_LIVE_CAPTURE_RANGE_INVALID',
          'Live monitor head or initial cursor exceeded the safe integer range.',
          false,
        );
      }
      const finalizedHead = Number(finalizedHeadQuantity);
      const initialFromBlock = Number(initialFromQuantity);
      const runs = await resources.schedules.listRunsForSchedule(run.scheduleId, 100);
      const previous = previousSuccessfulRunEnd(runs);
      if (previous !== undefined) {
        if (previous.blockNumber > finalizedHead) {
          throw new CaptureExecutionError(
            'TOKEN_LIVE_CAPTURE_REORG_DETECTED',
            'Finalized monitor head moved behind its durable cursor.',
            true,
          );
        }
        const priorAnchor = await adapter.readAnchorAt(String(previous.blockNumber));
        if (
          priorAnchor.snapshot.ledger !== 'EVM' ||
          priorAnchor.snapshot.blockHash.toLowerCase() !== previous.blockHash.toLowerCase()
        ) {
          throw new CaptureExecutionError(
            'TOKEN_LIVE_CAPTURE_REORG_DETECTED',
            'Finalized monitor cursor no longer matches the provider chain.',
            true,
          );
        }
      }
      const fromBlock = Math.max(
        initialFromBlock,
        previous === undefined ? initialFromBlock : previous.blockNumber + 1,
      );
      if (!Number.isSafeInteger(fromBlock)) {
        throw new CaptureExecutionError(
          'TOKEN_LIVE_CAPTURE_RANGE_INVALID',
          'Live monitor cursor exceeded the safe integer range.',
          false,
        );
      }
      if (fromBlock > finalizedHead) {
        const evidence = liveCaptureEvidence({
          run,
          parameters,
          snapshot: head.snapshot,
          fromBlock,
        });
        await resources.evidence.put(evidence, [], head.snapshot);
        return CaptureRunSuccessSchema.parse({
          resultRef: `token-live-capture:${run.scheduleId}#sha256=${hashPayload(evidence)}`,
          snapshot: head.snapshot,
          terminalEvidenceId: evidence.id,
          evidenceIds: [evidence.id],
          sourceSet: [adapter.sourceId].sort(),
          modelVersion: 'token-live-capture-v1.0.0',
          coverage: 1,
          freshness: head.snapshot.capturedAt,
          confidence: 1,
        });
      }
      const toBlockQuantity = [
        BigInt(finalizedHead),
        BigInt(fromBlock) + BigInt(parameters.windowBlocks) - 1n,
      ].reduce((minimum, value) => (value < minimum ? value : minimum));
      if (toBlockQuantity > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new CaptureExecutionError(
          'TOKEN_LIVE_CAPTURE_RANGE_INVALID',
          'Live monitor capture window exceeded the safe integer range.',
          false,
        );
      }
      const toBlock = Number(toBlockQuantity);
      const backfillRun = {
        ...run,
        captureKind: 'TOKEN_HISTORY_BACKFILL' as const,
        parameters: {
          schemaVersion: 'token-history-backfill-v1' as const,
          dataset: parameters.dataset,
          token: parameters.token,
          fromBlock: String(fromBlock),
          toBlock: String(toBlock),
          modelVersion: 'token-history-backfill-v1.0.0' as const,
          policyVersion: 'token-history-policy-v1.0.0' as const,
        },
      } satisfies CaptureRun;
      const result = await backfill(backfillRun, signal);
      return CaptureRunSuccessSchema.parse({
        ...result,
        modelVersion: 'token-live-capture-v1.0.0',
      });
    } catch (error) {
      if (error instanceof CaptureExecutionError) throw error;
      throw new CaptureExecutionError(
        errorCode(error),
        errorMessage(error),
        asRetryable(error),
        error,
      );
    }
  };
}
