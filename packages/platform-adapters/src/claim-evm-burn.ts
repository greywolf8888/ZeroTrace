import {
  deriveErc20BurnActions,
  ERC20_BURN_CONSERVATION_MODEL_VERSION,
} from '@zerotrace/claim-audit';
import { ProviderError, type EvmLogReader } from '@zerotrace/chain-adapters';
import { createEvidence, evidenceIdFor } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  EvidenceSchema,
  EvmClaimBurnConservationSchema,
  EvmSnapshotSchema,
  type AnalysisSnapshot,
  type Evidence,
  type EvmClaimBurnConservation,
} from '@zerotrace/schemas';
import { decodeFunctionResult, encodeFunctionData } from 'viem';
import type { z } from 'zod';

import {
  collectErc20ClaimTransfers,
  type EvmBlockAnchorReader,
  type EvmClaimReadAdapter,
} from './claim-evm.js';

type EvmSnapshot = z.infer<typeof EvmSnapshotSchema>;

export type EvmClaimBurnEvidenceWriter = (
  evidence: Evidence,
  sourceEvidenceIds?: readonly string[],
  snapshot?: AnalysisSnapshot,
) => Promise<Evidence>;

export interface ObserveEvmClaimBurnBlockOptions {
  tokenAddress: string;
  snapshot: EvmSnapshot;
  adapter: EvmClaimReadAdapter;
  logReader: EvmLogReader;
  blockReader: EvmBlockAnchorReader;
  writeEvidence: EvmClaimBurnEvidenceWriter;
  maxTransfers?: number | undefined;
  now?: (() => string) | undefined;
}

export interface EvmClaimBurnBlockRun {
  report: EvmClaimBurnConservation;
  evidence: Evidence[];
}

const totalSupplyAbi = [
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

function evmAddress(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${field} must be an EVM address.`);
  return value.toLowerCase();
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function decodeTotalSupply(value: string): string {
  try {
    const decoded = decodeFunctionResult({
      abi: totalSupplyAbi,
      functionName: 'totalSupply',
      data: value as `0x${string}`,
    });
    if (typeof decoded !== 'bigint' || decoded < 0n) throw new Error('invalid uint256');
    return decoded.toString();
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', 'ERC-20 totalSupply response is malformed.', {
      cause: error,
    });
  }
}

async function persistSource(
  evidence: Evidence,
  writer: EvmClaimBurnEvidenceWriter,
  snapshot?: AnalysisSnapshot,
): Promise<Evidence> {
  const persisted = EvidenceSchema.parse(await writer(evidence, [], snapshot));
  if (persisted.id !== evidence.id || persisted.id !== evidenceIdFor(persisted)) {
    throw new Error('Burn conservation Evidence writer changed a canonical source node.');
  }
  return persisted;
}

export async function observeEvmClaimBurnBlock(
  options: ObserveEvmClaimBurnBlockOptions,
): Promise<EvmClaimBurnBlockRun> {
  const snapshot = EvmSnapshotSchema.parse(options.snapshot);
  if (
    snapshot.finality !== 'finalized' ||
    snapshot.blockTimestamp === undefined ||
    snapshot.parentBlockHash === undefined
  ) {
    throw new Error('EVM burn conservation requires a finalized timestamped non-genesis Snapshot.');
  }
  const blockNumber = BigInt(snapshot.blockNumber);
  if (blockNumber === 0n) {
    throw new Error('EVM burn conservation cannot compare totalSupply before genesis.');
  }
  const numericChainId = Number(snapshot.chainId.slice('eip155:'.length));
  if (!Number.isSafeInteger(numericChainId) || options.adapter.config.chainId !== numericChainId) {
    throw new Error('EVM burn adapter chain does not match the Snapshot.');
  }
  const tokenAddress = evmAddress(options.tokenAddress, 'tokenAddress');
  const parentBlockNumber = (blockNumber - 1n).toString();
  const parentAnchor = await options.blockReader.readAnchorAt(parentBlockNumber);
  if (
    parentAnchor.anchor.ledger !== 'EVM' ||
    parentAnchor.anchor.chainId !== snapshot.chainId ||
    parentAnchor.anchor.position !== parentBlockNumber ||
    parentAnchor.anchor.hash.toLowerCase() !== snapshot.parentBlockHash.toLowerCase() ||
    parentAnchor.anchor.finality !== 'finalized' ||
    parentAnchor.snapshot.ledger !== 'EVM' ||
    parentAnchor.snapshot.blockNumber !== parentBlockNumber ||
    parentAnchor.snapshot.blockHash.toLowerCase() !== snapshot.parentBlockHash.toLowerCase() ||
    parentAnchor.snapshot.blockTimestamp === undefined
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Parent block anchor does not match the burn-conservation Snapshot lineage.',
    );
  }
  const parentSnapshot = EvmSnapshotSchema.parse(parentAnchor.snapshot);
  const callData = encodeFunctionData({ abi: totalSupplyAbi, functionName: 'totalSupply' });
  const [beforeObservation, afterObservation] = await Promise.all([
    options.adapter.callObservation(
      tokenAddress,
      callData,
      `0x${BigInt(parentBlockNumber).toString(16)}`,
    ),
    options.adapter.callObservation(tokenAddress, callData, `0x${blockNumber.toString(16)}`),
  ]);
  const totalSupplyBefore = decodeTotalSupply(beforeObservation.value);
  const totalSupplyAfter = decodeTotalSupply(afterObservation.value);
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const beforeEvidence = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'CONTRACT_STATE',
    source: beforeObservation.endpointId,
    locator: `erc20-total-supply:${tokenAddress}:${parentBlockNumber}`,
    payload: {
      tokenAddress,
      function: 'totalSupply()',
      blockNumber: parentBlockNumber,
      blockHash: parentSnapshot.blockHash,
      rawResult: beforeObservation.value,
      totalSupply: totalSupplyBefore,
    },
    observedAt,
    blockOrSlot: parentBlockNumber,
    finality: 'finalized',
    summary: 'Snapshot-pinned ERC-20 totalSupply read before the candidate burn block.',
  });
  const afterEvidence = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'CONTRACT_STATE',
    source: afterObservation.endpointId,
    locator: `erc20-total-supply:${tokenAddress}:${snapshot.blockNumber}`,
    payload: {
      tokenAddress,
      function: 'totalSupply()',
      blockNumber: snapshot.blockNumber,
      blockHash: snapshot.blockHash,
      rawResult: afterObservation.value,
      totalSupply: totalSupplyAfter,
    },
    observedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: 'finalized',
    summary: 'Snapshot-pinned ERC-20 totalSupply read after the candidate burn block.',
  });
  const persistedBefore = await persistSource(
    beforeEvidence,
    options.writeEvidence,
    parentSnapshot,
  );
  const persistedAfter = await persistSource(afterEvidence, options.writeEvidence, snapshot);

  const collection = await collectErc20ClaimTransfers({
    tokenAddress,
    fromBlock: snapshot.blockNumber,
    toBlock: snapshot.blockNumber,
    snapshot,
    logReader: options.logReader,
    blockReader: options.blockReader,
    maxBlocksPerRequest: 1,
    maxRequests: 1,
    maxTransfers: options.maxTransfers,
    now: options.now,
  });
  const persistedTransfers: Evidence[] = [];
  for (const evidence of collection.evidence) {
    persistedTransfers.push(
      await persistSource(
        evidence,
        options.writeEvidence,
        evidence.blockOrSlot === snapshot.blockNumber ? snapshot : undefined,
      ),
    );
  }
  const sourceEvidenceIds = sortedUnique([
    persistedBefore.id,
    persistedAfter.id,
    ...persistedTransfers.map((item) => item.id),
  ]);
  const sourceSet = sortedUnique([
    parentAnchor.anchor.source,
    beforeObservation.endpointId,
    afterObservation.endpointId,
    ...collection.metadata.sourceSet,
  ]);
  const metadata = AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage: 1,
    sourceCoverage: 0.5,
    historyCoverage: 1,
    simulationCoverage: 0,
    freshness: snapshot.blockTimestamp,
    sourceSet,
    modelVersion: ERC20_BURN_CONSERVATION_MODEL_VERSION,
    confidence: 0.98,
    evidenceIds: sourceEvidenceIds,
  });
  const derivation = deriveErc20BurnActions({
    tokenAddress,
    blockNumber: snapshot.blockNumber,
    blockHash: snapshot.blockHash,
    parentBlockNumber,
    parentBlockHash: snapshot.parentBlockHash,
    totalSupplyBefore,
    totalSupplyAfter,
    transfers: collection.transfers,
    supplyEvidenceIds: [persistedBefore.id, persistedAfter.id],
    coverageEvidenceIds: collection.evidence
      .filter((item) => item.kind === 'PROVIDER_OBSERVATION')
      .map((item) => item.id),
    metadata,
  });
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${ERC20_BURN_CONSERVATION_MODEL_VERSION}`,
    locator: `erc20-burn-conservation:${tokenAddress}:${snapshot.blockNumber}@${snapshot.blockHash.toLowerCase()}`,
    payload: {
      tokenAddress,
      blockNumber: snapshot.blockNumber,
      blockHash: snapshot.blockHash.toLowerCase(),
      parentBlockNumber,
      parentBlockHash: snapshot.parentBlockHash.toLowerCase(),
      totalSupplyBefore,
      totalSupplyAfter,
      mintedAmount: derivation.mintedAmount,
      burnedAmount: derivation.burnedAmount,
      expectedSupplyAfter: derivation.expectedSupplyAfter,
      status: derivation.status,
      candidateBurnTransferIds: derivation.candidateBurnTransferIds,
      actions: derivation.actions,
    },
    observedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: 'finalized',
    summary:
      derivation.status === 'VERIFIED'
        ? 'ERC-20 burn actions derived from complete target-block Transfer coverage and exact totalSupply conservation.'
        : derivation.status === 'CONTRADICTED'
          ? 'Zero-address Transfer observations were not credited because totalSupply/event conservation failed.'
          : 'Target-block supply and Transfer events were conserved, but no non-zero burn action occurred.',
    sourceEvidenceIds: derivation.evidenceIds,
  });
  const persistedTerminal = EvidenceSchema.parse(
    await options.writeEvidence(terminal, derivation.evidenceIds, snapshot),
  );
  if (
    persistedTerminal.id !== terminal.id ||
    persistedTerminal.id !== evidenceIdFor(persistedTerminal, derivation.evidenceIds)
  ) {
    throw new Error('Burn conservation terminal Evidence is not canonical.');
  }
  const report = EvmClaimBurnConservationSchema.parse({
    ...derivation,
    terminalEvidenceId: persistedTerminal.id,
    metadata: {
      ...metadata,
      evidenceIds: sortedUnique([...sourceEvidenceIds, persistedTerminal.id]),
    },
  });
  return {
    report,
    evidence: [persistedBefore, persistedAfter, ...persistedTransfers, persistedTerminal],
  };
}
