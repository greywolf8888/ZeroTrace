import {
  discoverPensionCandidateMetrics,
  EVM_PENSION_CANDIDATE_DISCOVERY_MODEL_VERSION,
} from '@zerotrace/claim-audit';
import type { EvmLogReader } from '@zerotrace/chain-adapters';
import { createEvidence, evidenceIdFor } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  EvidenceSchema,
  EvmPensionCandidateDiscoverySchema,
  EvmPensionCandidatePolicySchema,
  EvmSnapshotSchema,
  unknownValue,
  type AnalysisSnapshot,
  type Evidence,
  type EvmPensionCandidateDiscovery,
  type EvmPensionCandidatePolicy,
  type EvmPensionVaultCandidate,
} from '@zerotrace/schemas';
import type { z } from 'zod';

import { collectErc20ClaimTransfers, type EvmBlockAnchorReader } from './claim-evm.js';
import type { EvmClaimEvidenceWriter } from './claim-evm-observation.js';

type EvmSnapshot = z.infer<typeof EvmSnapshotSchema>;

export interface DiscoverEvmPensionCandidatesOptions {
  tokenAddress: string;
  fromBlock: string;
  toBlock: string;
  snapshot: EvmSnapshot;
  policy: EvmPensionCandidatePolicy;
  logReader: EvmLogReader;
  writeEvidence: EvmClaimEvidenceWriter;
  blockReader?: EvmBlockAnchorReader | undefined;
  maxBlocksPerRequest?: number | undefined;
  maxRequests?: number | undefined;
  maxTransfers?: number | undefined;
  now?: (() => string) | undefined;
}

export interface EvmPensionCandidateDiscoveryRun {
  report: EvmPensionCandidateDiscovery;
  evidence: Evidence[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  field: string,
) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${field} must be between 1 and ${maximum}.`);
  }
  return resolved;
}

async function persistSource(
  evidence: Evidence,
  writer: EvmClaimEvidenceWriter,
  snapshot?: AnalysisSnapshot,
): Promise<Evidence> {
  const persisted = EvidenceSchema.parse(await writer(evidence, [], snapshot));
  if (persisted.id !== evidence.id || persisted.id !== evidenceIdFor(persisted)) {
    throw new Error('Pension candidate Evidence writer changed a canonical source node.');
  }
  return persisted;
}

export async function discoverEvmPensionCandidates(
  options: DiscoverEvmPensionCandidatesOptions,
): Promise<EvmPensionCandidateDiscoveryRun> {
  const snapshot = EvmSnapshotSchema.parse(options.snapshot);
  const policy = EvmPensionCandidatePolicySchema.parse(options.policy);
  if (snapshot.finality !== 'finalized' || snapshot.blockTimestamp === undefined) {
    throw new Error('Pension candidate discovery requires a finalized timestamped EVM Snapshot.');
  }
  if (!/^(0|[1-9]\d*)$/.test(options.fromBlock) || !/^(0|[1-9]\d*)$/.test(options.toBlock)) {
    throw new Error('Pension candidate block range must use unsigned integer strings.');
  }
  const fromBlock = BigInt(options.fromBlock);
  const toBlock = BigInt(options.toBlock);
  if (
    toBlock < fromBlock ||
    snapshot.blockNumber !== toBlock.toString() ||
    toBlock - fromBlock + 1n > 5_000_000n
  ) {
    throw new Error(
      'Pension candidate discovery requires an ordered range of at most 5000000 blocks ending at its Snapshot.',
    );
  }
  const maxBlocksPerRequest = positiveInteger(
    options.maxBlocksPerRequest,
    1_000_000,
    1_000_000,
    'maxBlocksPerRequest',
  );
  const maxRequests = positiveInteger(options.maxRequests, 100, 10_000, 'maxRequests');
  const maxTransfers = positiveInteger(options.maxTransfers, 25_000, 1_000_000, 'maxTransfers');
  const collection = await collectErc20ClaimTransfers({
    tokenAddress: options.tokenAddress,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    snapshot,
    logReader: options.logReader,
    ...(options.blockReader === undefined ? {} : { blockReader: options.blockReader }),
    maxBlocksPerRequest,
    maxRequests,
    maxTransfers,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const persistedSources: Evidence[] = [];
  for (const evidence of collection.evidence) {
    persistedSources.push(
      await persistSource(
        evidence,
        options.writeEvidence,
        evidence.blockOrSlot === snapshot.blockNumber ? snapshot : undefined,
      ),
    );
  }
  const coverageEvidenceIds = sortedUnique(
    persistedSources
      .filter((evidence) => evidence.kind === 'PROVIDER_OBSERVATION')
      .map((evidence) => evidence.id),
  );
  const metrics = discoverPensionCandidateMetrics({
    fromBlock: collection.fromBlock,
    toBlock: collection.toBlock,
    transfers: collection.transfers,
    metadata: collection.metadata,
    coverageEvidenceIds,
    policy,
  });
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const candidates: EvmPensionVaultCandidate[] = [];
  const candidateEvidence: Evidence[] = [];
  for (const metric of metrics) {
    const node = createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${EVM_PENSION_CANDIDATE_DISCOVERY_MODEL_VERSION}`,
      locator: `pension-behavior-candidate:${collection.tokenAddress}:${metric.address}:${collection.fromBlock}-${collection.toBlock}`,
      payload: { metric, policy },
      observedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: 'finalized',
      summary:
        'Address satisfied the explicit share-unit/depositor behavior policy; official role and payout meaning remain Unknown.',
      sourceEvidenceIds: metric.transferEvidenceIds,
    });
    const persisted = EvidenceSchema.parse(
      await options.writeEvidence(node, metric.transferEvidenceIds, snapshot),
    );
    if (
      persisted.id !== node.id ||
      persisted.id !== evidenceIdFor(persisted, metric.transferEvidenceIds)
    ) {
      throw new Error('Pension candidate derived Evidence is not canonical.');
    }
    candidateEvidence.push(persisted);
    candidates.push({
      ...metric,
      evidenceId: persisted.id,
      roleAttribution: unknownValue(
        'INSUFFICIENT_DATA',
        'Repeated share-unit deposits are behavioral Evidence only; no official pension-vault source was supplied.',
      ),
      participantExitPolicy: unknownValue(
        'INSUFFICIENT_DATA',
        'Wallet-level inflow/outflow history cannot prove whether individual participants may exit.',
      ),
      dividendExecution: unknownValue(
        'NOT_QUERIED',
        'Outflows are not classified as dividends without recipient, cadence, funding-source and controller Evidence.',
      ),
    });
  }
  candidates.sort((left, right) => left.address.localeCompare(right.address));
  const terminalSourceEvidenceIds = sortedUnique([
    ...coverageEvidenceIds,
    ...candidateEvidence.map((evidence) => evidence.id),
  ]);
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${EVM_PENSION_CANDIDATE_DISCOVERY_MODEL_VERSION}`,
    locator: `pension-behavior-discovery:${collection.tokenAddress}:${collection.fromBlock}-${collection.toBlock}@${snapshot.blockHash.toLowerCase()}`,
    payload: {
      tokenAddress: collection.tokenAddress,
      fromBlock: collection.fromBlock,
      toBlock: collection.toBlock,
      policy,
      scannedTransferCount: collection.transfers.length,
      candidates,
    },
    observedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: 'finalized',
    summary:
      candidates.length === 0
        ? 'Complete requested Transfer range produced no address satisfying the explicit pension behavior policy.'
        : 'Complete requested Transfer range produced behavioral candidates without official role or dividend attribution.',
    sourceEvidenceIds: terminalSourceEvidenceIds,
  });
  const persistedTerminal = EvidenceSchema.parse(
    await options.writeEvidence(terminal, terminalSourceEvidenceIds, snapshot),
  );
  if (
    persistedTerminal.id !== terminal.id ||
    persistedTerminal.id !== evidenceIdFor(persistedTerminal, terminalSourceEvidenceIds)
  ) {
    throw new Error('Pension candidate terminal Evidence is not canonical.');
  }
  const reportEvidenceIds = sortedUnique([...terminalSourceEvidenceIds, persistedTerminal.id]);
  const metadata = AnalysisMetadataSchema.parse({
    ...collection.metadata,
    snapshot,
    freshness: snapshot.blockTimestamp,
    modelVersion: EVM_PENSION_CANDIDATE_DISCOVERY_MODEL_VERSION,
    confidence: Math.min(collection.metadata.confidence, 0.75),
    evidenceIds: reportEvidenceIds,
  });
  const report = EvmPensionCandidateDiscoverySchema.parse({
    tokenAddress: collection.tokenAddress,
    fromBlock: collection.fromBlock,
    toBlock: collection.toBlock,
    policy,
    scannedTransferCount: collection.transfers.length,
    candidates,
    coverageEvidenceIds,
    terminalEvidenceId: persistedTerminal.id,
    metadata,
  });
  return {
    report,
    evidence: [...persistedSources, ...candidateEvidence, persistedTerminal],
  };
}
