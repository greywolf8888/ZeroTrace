import { hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  ClaimActionObservationSchema,
  EvmClaimTransferObservationSchema,
  type AnalysisMetadata,
  type ClaimActionObservation,
  type EvmClaimTransferObservation,
} from '@zerotrace/schemas';

export const ERC20_BURN_CONSERVATION_MODEL_VERSION = 'erc20-burn-conservation-v1.0.0';
export const EVM_ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

export type ClaimBurnConservationStatus = 'VERIFIED' | 'CONTRADICTED' | 'NOT_APPLICABLE';

export interface DeriveErc20BurnActionsInput {
  tokenAddress: string;
  blockNumber: string;
  blockHash: string;
  parentBlockNumber: string;
  parentBlockHash: string;
  totalSupplyBefore: string;
  totalSupplyAfter: string;
  transfers: EvmClaimTransferObservation[];
  supplyEvidenceIds: string[];
  coverageEvidenceIds: string[];
  metadata: AnalysisMetadata;
}

export interface Erc20BurnActionDerivation {
  tokenAddress: string;
  blockNumber: string;
  blockHash: string;
  parentBlockNumber: string;
  parentBlockHash: string;
  totalSupplyBefore: string;
  totalSupplyAfter: string;
  mintedAmount: string;
  burnedAmount: string;
  supplyDelta: string;
  eventNetSupplyDelta: string;
  expectedSupplyAfter: string;
  status: ClaimBurnConservationStatus;
  candidateBurnTransferIds: string[];
  actions: ClaimActionObservation[];
  evidenceIds: string[];
  metadata: AnalysisMetadata;
}

function evmAddress(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${field} must be an EVM address.`);
  return value.toLowerCase();
}

function evmHash(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${field} must be an EVM hash.`);
  return value.toLowerCase();
}

function unsigned(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be an unsigned integer string.`);
  }
  return BigInt(value);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function deriveErc20BurnActions(
  input: DeriveErc20BurnActionsInput,
): Erc20BurnActionDerivation {
  const metadata = AnalysisMetadataSchema.parse(input.metadata);
  const snapshot = metadata.snapshot;
  if (
    snapshot === null ||
    snapshot.ledger !== 'EVM' ||
    snapshot.finality !== 'finalized' ||
    snapshot.blockTimestamp === undefined
  ) {
    throw new Error('ERC-20 burn derivation requires a finalized timestamped EVM Snapshot.');
  }
  const tokenAddress = evmAddress(input.tokenAddress, 'tokenAddress');
  const blockHash = evmHash(input.blockHash, 'blockHash');
  const parentBlockHash = evmHash(input.parentBlockHash, 'parentBlockHash');
  const blockNumber = unsigned(input.blockNumber, 'blockNumber');
  const parentBlockNumber = unsigned(input.parentBlockNumber, 'parentBlockNumber');
  if (
    parentBlockNumber + 1n !== blockNumber ||
    snapshot.blockNumber !== blockNumber.toString() ||
    snapshot.blockHash.toLowerCase() !== blockHash ||
    snapshot.parentBlockHash?.toLowerCase() !== parentBlockHash
  ) {
    throw new Error('ERC-20 burn derivation block lineage does not match the Snapshot.');
  }
  if (metadata.dataCoverage !== 1 || metadata.historyCoverage !== 1) {
    throw new Error('ERC-20 burn derivation requires complete target-block data and history.');
  }
  const supplyEvidenceIds = sortedUnique(input.supplyEvidenceIds);
  const coverageEvidenceIds = sortedUnique(input.coverageEvidenceIds);
  if (supplyEvidenceIds.length !== 2 || coverageEvidenceIds.length === 0) {
    throw new Error(
      'ERC-20 burn derivation requires two supply reads and block-log coverage Evidence.',
    );
  }
  const transfers = EvmClaimTransferObservationSchema.array().parse(input.transfers);
  if (new Set(transfers.map((transfer) => transfer.id)).size !== transfers.length) {
    throw new Error('ERC-20 burn derivation transfer ids must be unique.');
  }
  const transferPositions = new Set<string>();
  for (const transfer of transfers) {
    if (
      transfer.blockNumber !== blockNumber.toString() ||
      transfer.blockHash.toLowerCase() !== blockHash
    ) {
      throw new Error('ERC-20 burn derivation received a transfer outside the target block.');
    }
    const position = `${transfer.transactionId.toLowerCase()}:${transfer.logIndex}`;
    if (transferPositions.has(position)) {
      throw new Error('ERC-20 burn derivation transfer log positions must be unique.');
    }
    transferPositions.add(position);
    const from = evmAddress(transfer.from, 'transfer.from');
    const to = evmAddress(transfer.to, 'transfer.to');
    const amount = unsigned(transfer.amount, 'transfer.amount');
    if (amount > 0n && from === EVM_ZERO_ADDRESS && to === EVM_ZERO_ADDRESS) {
      throw new Error('A non-zero zero-to-zero Transfer cannot establish mint/burn semantics.');
    }
  }
  const requiredEvidenceIds = sortedUnique([
    ...supplyEvidenceIds,
    ...coverageEvidenceIds,
    ...transfers.flatMap((transfer) => transfer.evidenceIds),
  ]);
  const metadataEvidence = new Set(metadata.evidenceIds);
  if (requiredEvidenceIds.some((id) => !metadataEvidence.has(id))) {
    throw new Error('ERC-20 burn derivation metadata is missing source Evidence.');
  }

  const mintTransfers = transfers.filter(
    (transfer) =>
      evmAddress(transfer.from, 'transfer.from') === EVM_ZERO_ADDRESS &&
      evmAddress(transfer.to, 'transfer.to') !== EVM_ZERO_ADDRESS &&
      unsigned(transfer.amount, 'transfer.amount') > 0n,
  );
  const burnTransfers = transfers.filter(
    (transfer) =>
      evmAddress(transfer.to, 'transfer.to') === EVM_ZERO_ADDRESS &&
      evmAddress(transfer.from, 'transfer.from') !== EVM_ZERO_ADDRESS &&
      unsigned(transfer.amount, 'transfer.amount') > 0n,
  );
  const minted = mintTransfers.reduce(
    (total, transfer) => total + unsigned(transfer.amount, 'transfer.amount'),
    0n,
  );
  const burned = burnTransfers.reduce(
    (total, transfer) => total + unsigned(transfer.amount, 'transfer.amount'),
    0n,
  );
  const before = unsigned(input.totalSupplyBefore, 'totalSupplyBefore');
  const after = unsigned(input.totalSupplyAfter, 'totalSupplyAfter');
  const expectedAfter = before + minted - burned;
  const conserved = expectedAfter === after;
  const status: ClaimBurnConservationStatus = !conserved
    ? 'CONTRADICTED'
    : burned === 0n
      ? 'NOT_APPLICABLE'
      : 'VERIFIED';
  const conservationEvidenceIds = sortedUnique([
    ...supplyEvidenceIds,
    ...coverageEvidenceIds,
    ...mintTransfers.flatMap((transfer) => transfer.evidenceIds),
    ...burnTransfers.flatMap((transfer) => transfer.evidenceIds),
  ]);
  const actions: ClaimActionObservation[] = !conserved
    ? []
    : burnTransfers.map((transfer) => ({
        id: `cba_${hashPayload({
          modelVersion: ERC20_BURN_CONSERVATION_MODEL_VERSION,
          chainId: snapshot.chainId,
          tokenAddress,
          blockNumber: blockNumber.toString(),
          transferId: transfer.id,
        }).slice(0, 24)}`,
        type: 'BURN' as const,
        actor: evmAddress(transfer.from, 'transfer.from'),
        amount: transfer.amount,
        observedAt: transfer.observedAt,
        transferIds: [transfer.id],
        path: [evmAddress(transfer.from, 'transfer.from'), EVM_ZERO_ADDRESS],
        evidenceIds: conservationEvidenceIds,
      }));
  ClaimActionObservationSchema.array().parse(actions);
  return {
    tokenAddress,
    blockNumber: blockNumber.toString(),
    blockHash,
    parentBlockNumber: parentBlockNumber.toString(),
    parentBlockHash,
    totalSupplyBefore: before.toString(),
    totalSupplyAfter: after.toString(),
    mintedAmount: minted.toString(),
    burnedAmount: burned.toString(),
    supplyDelta: (after - before).toString(),
    eventNetSupplyDelta: (minted - burned).toString(),
    expectedSupplyAfter: expectedAfter.toString(),
    status,
    candidateBurnTransferIds: burnTransfers.map((transfer) => transfer.id),
    actions,
    evidenceIds: conservationEvidenceIds,
    metadata,
  };
}
