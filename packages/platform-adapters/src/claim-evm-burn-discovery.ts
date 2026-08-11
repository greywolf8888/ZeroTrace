import { type EvmLogReader } from '@zerotrace/chain-adapters';
import { EVM_ZERO_ADDRESS } from '@zerotrace/claim-audit';
import { createEvidence, evidenceIdFor } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  EvidenceSchema,
  EvmClaimBurnCandidateDiscoverySchema,
  EvmSnapshotSchema,
  unknownValue,
  type AnalysisSnapshot,
  type Evidence,
  type EvmClaimBurnCandidateBlock,
  type EvmClaimBurnCandidateDiscovery,
} from '@zerotrace/schemas';
import type { z } from 'zod';

import { collectErc20ClaimTransfers, type EvmBlockAnchorReader } from './claim-evm.js';
import type { EvmClaimBurnEvidenceWriter } from './claim-evm-burn.js';

type EvmSnapshot = z.infer<typeof EvmSnapshotSchema>;

export const ERC20_BURN_CANDIDATE_DISCOVERY_MODEL_VERSION = 'erc20-burn-candidate-discovery-v1.0.0';

export interface DiscoverErc20BurnCandidatesOptions {
  tokenAddress: string;
  fromBlock: string;
  toBlock: string;
  snapshot: EvmSnapshot;
  logReader: EvmLogReader;
  blockReader?: EvmBlockAnchorReader | undefined;
  writeEvidence: EvmClaimBurnEvidenceWriter;
  maxBlocksPerRequest?: number | undefined;
  maxRequests?: number | undefined;
  maxTransfers?: number | undefined;
  maxCandidates?: number | undefined;
  now?: (() => string) | undefined;
}

export interface Erc20BurnCandidateDiscoveryRun {
  report: EvmClaimBurnCandidateDiscovery;
  evidence: Evidence[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function persistSource(
  evidence: Evidence,
  writer: EvmClaimBurnEvidenceWriter,
  snapshot?: AnalysisSnapshot,
): Promise<Evidence> {
  const persisted = EvidenceSchema.parse(await writer(evidence, [], snapshot));
  if (persisted.id !== evidence.id || persisted.id !== evidenceIdFor(persisted)) {
    throw new Error('Burn candidate Evidence writer changed a canonical source node.');
  }
  return persisted;
}

function positiveInteger(value: number | undefined, fallback: number, field: string, max: number) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > max) {
    throw new Error(`${field} must be between 1 and ${max}.`);
  }
  return resolved;
}

export async function discoverErc20BurnCandidates(
  options: DiscoverErc20BurnCandidatesOptions,
): Promise<Erc20BurnCandidateDiscoveryRun> {
  const snapshot = EvmSnapshotSchema.parse(options.snapshot);
  if (snapshot.finality !== 'finalized' || snapshot.blockTimestamp === undefined) {
    throw new Error('ERC-20 burn candidate discovery requires a finalized timestamped Snapshot.');
  }
  if (!/^(0|[1-9]\d*)$/.test(options.fromBlock) || !/^(0|[1-9]\d*)$/.test(options.toBlock)) {
    throw new Error('ERC-20 burn candidate range must use unsigned integer strings.');
  }
  const fromBlock = BigInt(options.fromBlock);
  const toBlock = BigInt(options.toBlock);
  if (
    toBlock < fromBlock ||
    toBlock > BigInt(snapshot.blockNumber) ||
    snapshot.blockNumber !== toBlock.toString()
  ) {
    throw new Error('ERC-20 burn candidate range must end at the supplied Snapshot.');
  }
  if (toBlock - fromBlock + 1n > 5_000_000n) {
    throw new Error('ERC-20 burn candidate discovery is limited to 5000000 blocks per run.');
  }
  const maxCandidates = positiveInteger(options.maxCandidates, 512, 'maxCandidates', 10_000);
  const maxBlocksPerRequest = positiveInteger(
    options.maxBlocksPerRequest,
    1_000_000,
    'maxBlocksPerRequest',
    1_000_000,
  );
  const maxRequests = positiveInteger(options.maxRequests, 100, 'maxRequests', 10_000);
  const maxTransfers = positiveInteger(options.maxTransfers, 25_000, 'maxTransfers', 1_000_000);
  const collection = await collectErc20ClaimTransfers({
    tokenAddress: options.tokenAddress,
    subjectAddress: EVM_ZERO_ADDRESS,
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

  const candidatesByBlock = new Map<
    string,
    EvmClaimBurnCandidateBlock & { mintedEventAmount: string; burnedEventAmount: string }
  >();
  let zeroAddressEventCount = 0;
  for (const transfer of collection.transfers) {
    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    const amount = BigInt(transfer.amount);
    if (amount === 0n) continue;
    if (from === EVM_ZERO_ADDRESS && to === EVM_ZERO_ADDRESS) {
      throw new Error('A non-zero zero-to-zero Transfer cannot become a burn candidate.');
    }
    if (from !== EVM_ZERO_ADDRESS && to !== EVM_ZERO_ADDRESS) {
      throw new Error('Zero-address candidate query returned an unrelated Transfer.');
    }
    zeroAddressEventCount += 1;
    if (to === EVM_ZERO_ADDRESS) {
      const existing = candidatesByBlock.get(transfer.blockNumber);
      if (existing === undefined) {
        candidatesByBlock.set(transfer.blockNumber, {
          blockNumber: transfer.blockNumber,
          blockHash: transfer.blockHash.toLowerCase(),
          burnTransferIds: [transfer.id],
          mintedEventAmount: '0',
          burnedEventAmount: amount.toString(),
        });
      } else {
        if (existing.blockHash !== transfer.blockHash.toLowerCase()) {
          throw new Error('Burn candidates disagree on a finalized block hash.');
        }
        existing.burnTransferIds.push(transfer.id);
        existing.burnedEventAmount = (BigInt(existing.burnedEventAmount) + amount).toString();
      }
    }
  }
  for (const transfer of collection.transfers) {
    if (
      BigInt(transfer.amount) === 0n ||
      transfer.from.toLowerCase() !== EVM_ZERO_ADDRESS ||
      transfer.to.toLowerCase() === EVM_ZERO_ADDRESS
    ) {
      continue;
    }
    const candidate = candidatesByBlock.get(transfer.blockNumber);
    if (candidate !== undefined) {
      candidate.mintedEventAmount = (
        BigInt(candidate.mintedEventAmount) + BigInt(transfer.amount)
      ).toString();
    }
  }
  const candidates = [...candidatesByBlock.values()]
    .sort((left, right) => (BigInt(left.blockNumber) < BigInt(right.blockNumber) ? -1 : 1))
    .map((candidate) => ({
      ...candidate,
      burnTransferIds: [...candidate.burnTransferIds].sort(),
    }));
  if (candidates.length > maxCandidates) {
    throw new Error(`Burn candidate result exceeds the configured ${maxCandidates}-block limit.`);
  }

  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const sourceEvidenceIds = sortedUnique(persistedSources.map((evidence) => evidence.id));
  const silentSupplyChangeDetection = unknownValue(
    'NOT_QUERIED',
    'This run covers zero-address Transfer events only. Storage-level or silent totalSupply changes require a separate all-block state analysis.',
  );
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${ERC20_BURN_CANDIDATE_DISCOVERY_MODEL_VERSION}`,
    locator: `erc20-burn-candidates:${collection.tokenAddress}:${fromBlock.toString()}-${toBlock.toString()}@${snapshot.blockHash.toLowerCase()}`,
    payload: {
      tokenAddress: collection.tokenAddress,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS',
      zeroAddressEventCount,
      candidates,
      silentSupplyChangeDetection,
    },
    observedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: 'finalized',
    summary:
      candidates.length === 0
        ? 'Complete zero-address Transfer event query found no burn candidates; silent supply changes remain Unknown.'
        : 'Complete zero-address Transfer event query found burn candidates that require exact-block supply-conservation promotion.',
    sourceEvidenceIds,
  });
  const persistedTerminal = EvidenceSchema.parse(
    await options.writeEvidence(terminal, sourceEvidenceIds, snapshot),
  );
  if (
    persistedTerminal.id !== terminal.id ||
    persistedTerminal.id !== evidenceIdFor(persistedTerminal, sourceEvidenceIds)
  ) {
    throw new Error('Burn candidate terminal Evidence is not canonical.');
  }
  const report = EvmClaimBurnCandidateDiscoverySchema.parse({
    tokenAddress: collection.tokenAddress,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS',
    status: candidates.length === 0 ? 'NO_EVENT_CANDIDATES' : 'CANDIDATES_DISCOVERED',
    zeroAddressEventCount,
    burnCandidateCount: candidates.length,
    candidates,
    silentSupplyChangeDetection,
    terminalEvidenceId: persistedTerminal.id,
    metadata: AnalysisMetadataSchema.parse({
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: collection.metadata.sourceSet,
      modelVersion: ERC20_BURN_CANDIDATE_DISCOVERY_MODEL_VERSION,
      confidence: 0.98,
      evidenceIds: sortedUnique([...sourceEvidenceIds, persistedTerminal.id]),
    }),
  });
  return { report, evidence: [...persistedSources, persistedTerminal] };
}
