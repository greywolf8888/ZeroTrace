import {
  AnalysisMetadataSchema,
  EvmClaimTransferObservationSchema,
  EvmPensionCandidateMetricsSchema,
  EvmPensionCandidatePolicySchema,
  unknownValue,
  type AnalysisMetadata,
  type EvmClaimTransferObservation,
  type EvmPensionCandidateMetrics,
  type EvmPensionCandidatePolicy,
} from '@zerotrace/schemas';

export const EVM_PENSION_CANDIDATE_DISCOVERY_MODEL_VERSION =
  'evm-pension-candidate-discovery-v1.0.0';

const EVM_ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

export interface DiscoverPensionCandidateMetricsInput {
  fromBlock: string;
  toBlock: string;
  transfers: readonly EvmClaimTransferObservation[];
  metadata: AnalysisMetadata;
  coverageEvidenceIds: readonly string[];
  policy: EvmPensionCandidatePolicy;
}

interface MutableCandidate {
  address: string;
  inflowTransferCount: number;
  outflowTransferCount: number;
  exactUnitDepositCount: number;
  exactMultipleDepositCount: number;
  nonMultipleDepositCount: number;
  exactUnitDepositors: Set<string>;
  outflowDestinations: Set<string>;
  observedInflowAmount: bigint;
  observedOutflowAmount: bigint;
  observedWholeShares: bigint;
  inflowTimes: string[];
  outflowTimes: string[];
  transferEvidenceIds: Set<string>;
}

function unsigned(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${field} must be an unsigned integer.`);
  return BigInt(value);
}

function normalizedAddress(value: string): string {
  return value.toLowerCase();
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function mutableCandidate(map: Map<string, MutableCandidate>, address: string): MutableCandidate {
  const existing = map.get(address);
  if (existing !== undefined) return existing;
  const created: MutableCandidate = {
    address,
    inflowTransferCount: 0,
    outflowTransferCount: 0,
    exactUnitDepositCount: 0,
    exactMultipleDepositCount: 0,
    nonMultipleDepositCount: 0,
    exactUnitDepositors: new Set<string>(),
    outflowDestinations: new Set<string>(),
    observedInflowAmount: 0n,
    observedOutflowAmount: 0n,
    observedWholeShares: 0n,
    inflowTimes: [],
    outflowTimes: [],
    transferEvidenceIds: new Set<string>(),
  };
  map.set(address, created);
  return created;
}

function requireCompleteCoverage(
  metadataInput: AnalysisMetadata,
  fromBlock: bigint,
  toBlock: bigint,
  coverageEvidenceIds: readonly string[],
): AnalysisMetadata {
  const metadata = AnalysisMetadataSchema.parse(metadataInput);
  const snapshot = metadata.snapshot;
  const evidenceSet = new Set(metadata.evidenceIds);
  if (
    snapshot?.ledger !== 'EVM' ||
    snapshot.finality !== 'finalized' ||
    snapshot.blockTimestamp === undefined ||
    BigInt(snapshot.blockNumber) !== toBlock ||
    metadata.dataCoverage !== 1 ||
    metadata.historyCoverage !== 1 ||
    metadata.sourceSet.length === 0 ||
    fromBlock > toBlock
  ) {
    throw new Error(
      'Pension candidate discovery requires a complete finalized EVM range ending at its Snapshot.',
    );
  }
  const canonicalCoverage = sortedUnique(coverageEvidenceIds);
  if (
    canonicalCoverage.length === 0 ||
    canonicalCoverage.length !== coverageEvidenceIds.length ||
    canonicalCoverage.some((evidenceId, index) => evidenceId !== coverageEvidenceIds[index]) ||
    canonicalCoverage.some((evidenceId) => !evidenceSet.has(evidenceId))
  ) {
    throw new Error(
      'Pension candidate coverage Evidence must be canonical and present in metadata.',
    );
  }
  return metadata;
}

export function discoverPensionCandidateMetrics(
  input: DiscoverPensionCandidateMetricsInput,
): EvmPensionCandidateMetrics[] {
  const policy = EvmPensionCandidatePolicySchema.parse(input.policy);
  const fromBlock = unsigned(input.fromBlock, 'fromBlock');
  const toBlock = unsigned(input.toBlock, 'toBlock');
  const metadata = requireCompleteCoverage(
    input.metadata,
    fromBlock,
    toBlock,
    input.coverageEvidenceIds,
  );
  const snapshotTime = Date.parse(
    metadata.snapshot?.ledger === 'EVM' && metadata.snapshot.blockTimestamp !== undefined
      ? metadata.snapshot.blockTimestamp
      : '',
  );
  const shareUnit = BigInt(policy.shareUnitAtomic);
  const transferIds = new Set<string>();
  const metadataEvidenceIds = new Set(metadata.evidenceIds);
  const candidates = new Map<string, MutableCandidate>();

  for (const inputTransfer of input.transfers) {
    const transfer = EvmClaimTransferObservationSchema.parse(inputTransfer);
    if (transferIds.has(transfer.id)) {
      throw new Error('Pension candidate discovery rejects duplicate transfer identities.');
    }
    transferIds.add(transfer.id);
    const blockNumber = BigInt(transfer.blockNumber);
    const observedAt = Date.parse(transfer.observedAt);
    if (
      blockNumber < fromBlock ||
      blockNumber > toBlock ||
      !Number.isFinite(observedAt) ||
      observedAt > snapshotTime ||
      transfer.evidenceIds.some((evidenceId) => !metadataEvidenceIds.has(evidenceId))
    ) {
      throw new Error(
        'Pension candidate transfer range, time, or Evidence conflicts with the analysis metadata.',
      );
    }
    const amount = BigInt(transfer.amount);
    if (amount === 0n) continue;
    const from = normalizedAddress(transfer.from);
    const to = normalizedAddress(transfer.to);
    if (from === to || from === EVM_ZERO_ADDRESS || to === EVM_ZERO_ADDRESS) continue;

    const recipient = mutableCandidate(candidates, to);
    recipient.inflowTransferCount += 1;
    recipient.observedInflowAmount += amount;
    recipient.inflowTimes.push(transfer.observedAt);
    for (const evidenceId of transfer.evidenceIds) recipient.transferEvidenceIds.add(evidenceId);
    if (amount % shareUnit === 0n) {
      recipient.exactMultipleDepositCount += 1;
      recipient.observedWholeShares += amount / shareUnit;
      if (amount === shareUnit) {
        recipient.exactUnitDepositCount += 1;
        recipient.exactUnitDepositors.add(from);
      }
    } else {
      recipient.nonMultipleDepositCount += 1;
    }

    const sender = mutableCandidate(candidates, from);
    sender.outflowTransferCount += 1;
    sender.observedOutflowAmount += amount;
    sender.outflowDestinations.add(to);
    sender.outflowTimes.push(transfer.observedAt);
    for (const evidenceId of transfer.evidenceIds) sender.transferEvidenceIds.add(evidenceId);
  }

  const qualified = [...candidates.values()].filter(
    (candidate) =>
      candidate.exactUnitDepositCount >= policy.minimumExactUnitDeposits &&
      candidate.exactUnitDepositors.size >= policy.minimumUniqueExactUnitDepositors,
  );
  if (qualified.length > policy.maximumCandidates) {
    throw new Error(
      `Pension candidate result exceeds the explicit ${policy.maximumCandidates}-candidate limit.`,
    );
  }

  return qualified
    .map((candidate) => {
      candidate.inflowTimes.sort();
      candidate.outflowTimes.sort();
      return EvmPensionCandidateMetricsSchema.parse({
        address: candidate.address,
        inflowTransferCount: candidate.inflowTransferCount,
        outflowTransferCount: candidate.outflowTransferCount,
        exactUnitDepositCount: candidate.exactUnitDepositCount,
        exactMultipleDepositCount: candidate.exactMultipleDepositCount,
        nonMultipleDepositCount: candidate.nonMultipleDepositCount,
        uniqueExactUnitDepositorCount: candidate.exactUnitDepositors.size,
        uniqueOutflowDestinationCount: candidate.outflowDestinations.size,
        observedInflowAmount: candidate.observedInflowAmount.toString(),
        observedOutflowAmount: candidate.observedOutflowAmount.toString(),
        observedNetAmount: (
          candidate.observedInflowAmount - candidate.observedOutflowAmount
        ).toString(),
        observedWholeShares: candidate.observedWholeShares.toString(),
        firstInflowAt: candidate.inflowTimes[0],
        lastInflowAt: candidate.inflowTimes.at(-1),
        firstOutflowAt:
          candidate.outflowTimes.length === 0
            ? unknownValue('NOT_APPLICABLE', 'No non-zero outflow was observed in this range.')
            : { state: 'known', value: candidate.outflowTimes[0] },
        lastOutflowAt:
          candidate.outflowTimes.length === 0
            ? unknownValue('NOT_APPLICABLE', 'No non-zero outflow was observed in this range.')
            : { state: 'known', value: candidate.outflowTimes.at(-1) },
        criteria: ['EXACT_SHARE_UNIT_DEPOSITS', 'UNIQUE_DEPOSITOR_THRESHOLD'],
        transferEvidenceIds: sortedUnique([...candidate.transferEvidenceIds]),
      });
    })
    .sort((left, right) => left.address.localeCompare(right.address));
}
