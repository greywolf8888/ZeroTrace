import {
  summarizeClaimAddressFlows,
  type ClaimAddressFlowSummaryInput,
} from '@zerotrace/claim-audit';
import type { EvmLogReader } from '@zerotrace/chain-adapters';
import { canonicalJson, createEvidence, evidenceIdFor } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  ClaimWindowSchema,
  EvidenceSchema,
  EvmClaimAddressObservationSchema,
  EvmSnapshotSchema,
  type AnalysisSnapshot,
  type Evidence,
  type EvmClaimAddressObservation,
} from '@zerotrace/schemas';
import type { z } from 'zod';

import {
  collectErc20ClaimTransfers,
  inspectEvmCustody,
  type EvmBlockAnchorReader,
  type EvmClaimReadAdapter,
} from './claim-evm.js';

type EvmSnapshot = z.infer<typeof EvmSnapshotSchema>;

export const EVM_CLAIM_ADDRESS_OBSERVATION_MODEL_VERSION = 'evm-claim-address-observation-v1.0.0';

export type EvmClaimEvidenceWriter = (
  evidence: Evidence,
  sourceEvidenceIds?: readonly string[],
  snapshot?: AnalysisSnapshot,
) => Promise<Evidence>;

export interface EvmClaimAddressObservationRun {
  report: EvmClaimAddressObservation;
  evidence: Evidence[];
}

export interface ObserveEvmClaimAddressOptions {
  tokenAddress: string;
  address: string;
  fromBlock: string;
  toBlock: string;
  window: ClaimAddressFlowSummaryInput['window'];
  snapshot: EvmSnapshot;
  custodyAdapter: EvmClaimReadAdapter;
  logReader: EvmLogReader;
  writeEvidence: EvmClaimEvidenceWriter;
  blockReader?: EvmBlockAnchorReader | undefined;
  shareUnit?: string | undefined;
  topCounterpartyLimit?: number | undefined;
  maxBlocksPerRequest?: number | undefined;
  maxRequests?: number | undefined;
  maxTransfers?: number | undefined;
  now?: (() => string) | undefined;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function evmAddress(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${field} must be an EVM address.`);
  return value.toLowerCase();
}

function blockRange(from: string, to: string, snapshot: EvmSnapshot): [bigint, bigint] {
  if (!/^(0|[1-9]\d*)$/.test(from) || !/^(0|[1-9]\d*)$/.test(to)) {
    throw new Error('EVM claim address block range must use unsigned integer strings.');
  }
  let fromBlock: bigint;
  let toBlock: bigint;
  try {
    fromBlock = BigInt(from);
    toBlock = BigInt(to);
  } catch {
    throw new Error('EVM claim address block range must use unsigned integer strings.');
  }
  if (fromBlock < 0n || toBlock < fromBlock || toBlock > BigInt(snapshot.blockNumber)) {
    throw new Error('EVM claim address block range is invalid or exceeds the Snapshot.');
  }
  return [fromBlock, toBlock];
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): void {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
}

function sameSnapshot(left: AnalysisSnapshot | null, right: AnalysisSnapshot): boolean {
  return left !== null && canonicalJson(left) === canonicalJson(right);
}

async function persistEvidence(
  items: readonly Evidence[],
  writer: EvmClaimEvidenceWriter,
  snapshot: EvmSnapshot,
): Promise<Evidence[]> {
  const persisted: Evidence[] = [];
  for (const item of items) {
    const boundSnapshot = item.blockOrSlot === snapshot.blockNumber ? snapshot : undefined;
    const parsed = EvidenceSchema.parse(await writer(item, [], boundSnapshot));
    if (parsed.id !== item.id || parsed.id !== evidenceIdFor(parsed)) {
      throw new Error('Claim observation Evidence writer changed a canonical source node.');
    }
    persisted.push(parsed);
  }
  return persisted;
}

export async function observeEvmClaimAddress(
  options: ObserveEvmClaimAddressOptions,
): Promise<EvmClaimAddressObservationRun> {
  const snapshot = EvmSnapshotSchema.parse(options.snapshot);
  if (snapshot.finality !== 'finalized' || snapshot.blockTimestamp === undefined) {
    throw new Error('EVM claim address observation requires a finalized timestamped Snapshot.');
  }
  const tokenAddress = evmAddress(options.tokenAddress, 'tokenAddress');
  const address = evmAddress(options.address, 'address');
  const [fromBlock, toBlock] = blockRange(options.fromBlock, options.toBlock, snapshot);
  if (options.custodyAdapter.config.chainId !== Number(snapshot.chainId.slice('eip155:'.length))) {
    throw new Error('Custody adapter chain does not match the Snapshot.');
  }
  const window = ClaimWindowSchema.parse(options.window);
  if (Date.parse(window.to) > Date.parse(snapshot.blockTimestamp)) {
    throw new Error('Claim flow window must not extend beyond the Snapshot block timestamp.');
  }
  if (
    options.shareUnit !== undefined &&
    (!/^[1-9]\d*$/.test(options.shareUnit) || BigInt(options.shareUnit) === 0n)
  ) {
    throw new Error('shareUnit must be a positive integer string.');
  }
  boundedInteger(options.topCounterpartyLimit, 10, 1, 100, 'topCounterpartyLimit');
  boundedInteger(options.maxBlocksPerRequest, 50_000, 1, 1_000_000, 'maxBlocksPerRequest');
  boundedInteger(options.maxRequests, 1_000, 1, 10_000, 'maxRequests');
  boundedInteger(options.maxTransfers, 25_000, 1, 1_000_000, 'maxTransfers');
  const blocksPerRequest = BigInt(options.maxBlocksPerRequest ?? 50_000);
  const requestBudget = BigInt(options.maxRequests ?? 1_000);
  if (((toBlock - fromBlock) / blocksPerRequest + 1n) * 2n > requestBudget) {
    throw new Error('EVM claim address block range exceeds the configured request budget.');
  }

  // Capture point-in-time authority before a potentially long range scan. Public RPC providers may
  // prune the target state while the scan is running; a later custody read would not be same-Snapshot.
  const custodyInspection = await inspectEvmCustody({
    address,
    snapshot,
    adapter: options.custodyAdapter,
    now: options.now,
  });
  const persistedCustody = await persistEvidence(
    custodyInspection.evidence,
    options.writeEvidence,
    snapshot,
  );

  const collection = await collectErc20ClaimTransfers({
    tokenAddress,
    subjectAddress: address,
    fromBlock: options.fromBlock,
    toBlock: options.toBlock,
    snapshot,
    logReader: options.logReader,
    blockReader: options.blockReader,
    maxBlocksPerRequest: options.maxBlocksPerRequest,
    maxRequests: options.maxRequests,
    maxTransfers: options.maxTransfers,
    now: options.now,
  });
  const persistedTransfers = await persistEvidence(
    collection.evidence,
    options.writeEvidence,
    snapshot,
  );
  if (
    !sameSnapshot(custodyInspection.metadata.snapshot, snapshot) ||
    !sameSnapshot(collection.metadata.snapshot, snapshot)
  ) {
    throw new Error('Claim custody and transfer observations do not share the requested Snapshot.');
  }

  const flow = summarizeClaimAddressFlows({
    address,
    window,
    transfers: collection.transfers,
    metadata: collection.metadata,
    shareUnit: options.shareUnit,
    coverageEvidenceIds: collection.evidence
      .filter((item) => item.kind === 'PROVIDER_OBSERVATION')
      .map((item) => item.id),
    topCounterpartyLimit: options.topCounterpartyLimit,
  });
  const sourceEvidenceIds = sortedUnique([
    ...custodyInspection.custody.evidenceIds,
    ...flow.metadata.evidenceIds,
  ]);
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${EVM_CLAIM_ADDRESS_OBSERVATION_MODEL_VERSION}`,
    locator: `evm-claim-address:${collection.tokenAddress}:${custodyInspection.custody.address}:${collection.fromBlock}-${collection.toBlock}`,
    payload: {
      tokenAddress: collection.tokenAddress,
      address: custodyInspection.custody.address,
      fromBlock: collection.fromBlock,
      toBlock: collection.toBlock,
      window,
      custody: custodyInspection.custody,
      flow,
    },
    observedAt: snapshot.capturedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    summary:
      'Same-Snapshot EVM custody and ERC-20 address-flow observations were composed without terminal-action attribution.',
    sourceEvidenceIds,
  });
  const persistedTerminal = EvidenceSchema.parse(
    await options.writeEvidence(terminal, sourceEvidenceIds, snapshot),
  );
  if (
    persistedTerminal.id !== terminal.id ||
    persistedTerminal.id !== evidenceIdFor(persistedTerminal, sourceEvidenceIds)
  ) {
    throw new Error('Claim observation terminal Evidence is not canonical.');
  }
  const metadata = AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage: Math.min(
      custodyInspection.metadata.dataCoverage,
      collection.metadata.dataCoverage,
    ),
    sourceCoverage: Math.min(
      custodyInspection.metadata.sourceCoverage,
      collection.metadata.sourceCoverage,
    ),
    // The transfer window is complete, but custody is a point-in-time authority observation rather
    // than historical authority coverage across the whole window.
    historyCoverage: Math.min(
      custodyInspection.metadata.historyCoverage,
      collection.metadata.historyCoverage,
    ),
    simulationCoverage: 0,
    freshness: snapshot.blockTimestamp,
    sourceSet: sortedUnique([
      ...custodyInspection.metadata.sourceSet,
      ...collection.metadata.sourceSet,
    ]),
    modelVersion: EVM_CLAIM_ADDRESS_OBSERVATION_MODEL_VERSION,
    confidence: Math.min(custodyInspection.metadata.confidence, collection.metadata.confidence),
    evidenceIds: sortedUnique([...sourceEvidenceIds, persistedTerminal.id]),
  });
  const report = EvmClaimAddressObservationSchema.parse({
    tokenAddress: collection.tokenAddress,
    address: custodyInspection.custody.address,
    fromBlock: collection.fromBlock,
    toBlock: collection.toBlock,
    window,
    custody: custodyInspection.custody,
    custodyMetadata: custodyInspection.metadata,
    flow,
    terminalEvidenceId: persistedTerminal.id,
    metadata,
  });
  return {
    report,
    evidence: [...persistedCustody, ...persistedTransfers, persistedTerminal],
  };
}
