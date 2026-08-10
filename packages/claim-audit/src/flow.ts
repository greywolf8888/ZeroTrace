import {
  AnalysisMetadataSchema,
  ClaimAddressFlowSummarySchema,
  ClaimTransferObservationSchema,
  ClaimWindowSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type ClaimAddressFlowSummary,
  type ClaimTransferObservation,
  type ClaimWindow,
  type KnowledgeValue,
} from '@zerotrace/schemas';

export const CLAIM_FLOW_SUMMARY_MODEL_VERSION = 'claim-flow-summary-v1.0.0';

export interface ClaimAddressFlowSummaryInput {
  address: string;
  window: ClaimWindow;
  transfers: ClaimTransferObservation[];
  metadata: AnalysisMetadata;
  comparison?: 'CASE_SENSITIVE' | 'CASE_INSENSITIVE' | undefined;
  shareUnit?: string | undefined;
  coverageEvidenceIds?: string[] | undefined;
  topCounterpartyLimit?: number | undefined;
}

interface DirectionalTransfer {
  direction: 'INFLOW' | 'OUTFLOW';
  counterparty: string;
  transfer: ClaimTransferObservation;
}

function parseAtomic(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer string.`);
  }
  return BigInt(value);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Transfer time is invalid.');
  return parsed;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function coverageComplete(metadata: AnalysisMetadata): boolean {
  return (
    metadata.dataCoverage === 1 && metadata.sourceCoverage === 1 && metadata.historyCoverage === 1
  );
}

function actualAmount(value: bigint, metadata: AnalysisMetadata): KnowledgeValue<string> {
  return coverageComplete(metadata)
    ? knownValue(value.toString())
    : unknownValue(
        'INSUFFICIENT_DATA',
        'Observed flow is a lower bound until data, source, and history coverage are complete.',
      );
}

function observedBoundary(
  transfers: readonly ClaimTransferObservation[],
  boundary: 'first' | 'last',
  metadata: AnalysisMetadata,
): KnowledgeValue<string> {
  if (transfers.length === 0) {
    return coverageComplete(metadata)
      ? unknownValue('NOT_APPLICABLE', 'No matching transfer exists in the complete audit window.')
      : unknownValue(
          'INSUFFICIENT_DATA',
          'No matching transfer is observed, but coverage is incomplete.',
        );
  }
  const sorted = transfers
    .map((item) => item.observedAt)
    .sort((left, right) => {
      const order = timestamp(left) - timestamp(right);
      return order === 0 ? left.localeCompare(right) : order;
    });
  const value = boundary === 'first' ? sorted[0] : sorted.at(-1);
  if (value === undefined) throw new Error('Matching transfer boundary is unavailable.');
  return knownValue(value);
}

function snapshotTime(metadata: AnalysisMetadata): number | null {
  const snapshot = metadata.snapshot;
  if (
    snapshot === null ||
    !('blockTimestamp' in snapshot) ||
    snapshot.blockTimestamp === undefined
  ) {
    return null;
  }
  return timestamp(snapshot.blockTimestamp);
}

function aggregate(
  transfers: readonly DirectionalTransfer[],
  metadata: AnalysisMetadata,
): ClaimAddressFlowSummary['inflow'] {
  const observations = transfers.map((item) => item.transfer);
  const amount = observations.reduce(
    (total, item) => total + parseAtomic(item.amount, 'transfer amount'),
    0n,
  );
  return {
    observedAmount: amount.toString(),
    actualAmount: actualAmount(amount, metadata),
    transferCount: observations.length,
    uniqueCounterparties: new Set(transfers.map((item) => item.counterparty)).size,
    firstObservedAt: observedBoundary(observations, 'first', metadata),
    lastObservedAt: observedBoundary(observations, 'last', metadata),
    evidenceIds: unique(observations.flatMap((item) => item.evidenceIds)),
  };
}

function counterpartySummaries(
  transfers: readonly DirectionalTransfer[],
  limit: number,
): ClaimAddressFlowSummary['topCounterparties'] {
  const groups = new Map<
    string,
    {
      direction: DirectionalTransfer['direction'];
      address: string;
      amount: bigint;
      transfers: ClaimTransferObservation[];
    }
  >();
  for (const item of transfers) {
    const key = `${item.direction}:${item.counterparty}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        direction: item.direction,
        address: item.counterparty,
        amount: parseAtomic(item.transfer.amount, 'transfer amount'),
        transfers: [item.transfer],
      });
    } else {
      existing.amount += parseAtomic(item.transfer.amount, 'transfer amount');
      existing.transfers.push(item.transfer);
    }
  }
  return [...groups.values()]
    .sort((left, right) => {
      if (left.amount !== right.amount) return left.amount > right.amount ? -1 : 1;
      if (left.transfers.length !== right.transfers.length) {
        return right.transfers.length - left.transfers.length;
      }
      const direction = left.direction.localeCompare(right.direction);
      return direction === 0 ? left.address.localeCompare(right.address) : direction;
    })
    .slice(0, limit)
    .map((group) => {
      const times = group.transfers
        .map((item) => item.observedAt)
        .sort((left, right) => {
          const order = timestamp(left) - timestamp(right);
          return order === 0 ? left.localeCompare(right) : order;
        });
      return {
        direction: group.direction,
        address: group.address,
        observedAmount: group.amount.toString(),
        transferCount: group.transfers.length,
        firstObservedAt: times[0] ?? '',
        lastObservedAt: times.at(-1) ?? times[0] ?? '',
        evidenceIds: unique(group.transfers.flatMap((item) => item.evidenceIds)),
      };
    });
}

export function summarizeClaimAddressFlows(
  input: ClaimAddressFlowSummaryInput,
): ClaimAddressFlowSummary {
  const metadata = AnalysisMetadataSchema.parse(input.metadata);
  if (metadata.snapshot === null) {
    throw new Error('Claim flow summary requires a replayable chain Snapshot.');
  }
  const window = ClaimWindowSchema.parse(input.window);
  const transfers = ClaimTransferObservationSchema.array().parse(input.transfers);
  if (new Set(transfers.map((item) => item.id)).size !== transfers.length) {
    throw new Error('Claim flow transfer ids must be unique.');
  }
  if (input.address.length === 0) throw new Error('Claim flow address is required.');
  const comparison =
    input.comparison ??
    (metadata.snapshot.ledger === 'EVM' ? 'CASE_INSENSITIVE' : 'CASE_SENSITIVE');
  const normalize =
    comparison === 'CASE_INSENSITIVE'
      ? (value: string) => value.toLowerCase()
      : (value: string) => value;
  const target = normalize(input.address);
  const fromTime = timestamp(window.from);
  const toTime = timestamp(window.to);
  const capturedBlockTime = snapshotTime(metadata);
  if (capturedBlockTime !== null && toTime > capturedBlockTime) {
    throw new Error('Claim flow window must not extend beyond the Snapshot block timestamp.');
  }
  const limit = input.topCounterpartyLimit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('topCounterpartyLimit must be between 1 and 100.');
  }

  const relevant = transfers.filter((item) => {
    const time = timestamp(item.observedAt);
    if (capturedBlockTime !== null && time > capturedBlockTime) {
      throw new Error('Claim flow transfer must not occur after the Snapshot block timestamp.');
    }
    return time >= fromTime && time <= toTime;
  });
  const directional: DirectionalTransfer[] = [];
  const selfTransfers: ClaimTransferObservation[] = [];
  for (const transfer of relevant) {
    const from = normalize(transfer.from);
    const to = normalize(transfer.to);
    if (from === target && to === target) {
      selfTransfers.push(transfer);
    } else if (to === target) {
      directional.push({
        direction: 'INFLOW',
        counterparty: from,
        transfer,
      });
    } else if (from === target) {
      directional.push({
        direction: 'OUTFLOW',
        counterparty: to,
        transfer,
      });
    }
  }
  const inflows = directional.filter((item) => item.direction === 'INFLOW');
  const outflows = directional.filter((item) => item.direction === 'OUTFLOW');
  const shareUnit =
    input.shareUnit === undefined ? undefined : parseAtomic(input.shareUnit, 'shareUnit');
  if (shareUnit === 0n) throw new Error('shareUnit must be positive.');
  const exactMultipleDeposits =
    shareUnit === undefined
      ? 0
      : inflows.filter(
          (item) => parseAtomic(item.transfer.amount, 'transfer amount') % shareUnit === 0n,
        ).length;
  const exactUnitDeposits =
    shareUnit === undefined
      ? 0
      : inflows.filter((item) => parseAtomic(item.transfer.amount, 'transfer amount') === shareUnit)
          .length;
  const observedWholeShares =
    shareUnit === undefined
      ? 0n
      : inflows.reduce((total, item) => {
          const amount = parseAtomic(item.transfer.amount, 'transfer amount');
          return amount % shareUnit === 0n ? total + amount / shareUnit : total;
        }, 0n);
  const nonMultipleObservedAmount =
    shareUnit === undefined
      ? 0n
      : inflows.reduce((total, item) => {
          const amount = parseAtomic(item.transfer.amount, 'transfer amount');
          return amount % shareUnit === 0n ? total : total + amount;
        }, 0n);
  const selfTransferAmount = selfTransfers.reduce(
    (total, item) => total + parseAtomic(item.amount, 'self-transfer amount'),
    0n,
  );
  const coverageEvidenceIds = unique(input.coverageEvidenceIds ?? metadata.evidenceIds);
  if (coverageEvidenceIds.length === 0) {
    throw new Error('Claim flow summary requires coverage Evidence.');
  }
  if (coverageEvidenceIds.some((id) => !metadata.evidenceIds.includes(id))) {
    throw new Error('Claim flow coverage Evidence must belong to the source metadata.');
  }
  const evidenceIds = unique([
    ...coverageEvidenceIds,
    ...directional.flatMap((item) => item.transfer.evidenceIds),
    ...selfTransfers.flatMap((item) => item.evidenceIds),
  ]);
  const result: ClaimAddressFlowSummary = {
    address: input.address,
    window,
    inflow: aggregate(inflows, metadata),
    outflow: aggregate(outflows, metadata),
    shareUnitAssessment:
      shareUnit === undefined
        ? null
        : {
            unit: shareUnit.toString(),
            observedDeposits: inflows.length,
            exactUnitDeposits,
            exactMultipleDeposits,
            nonMultipleDeposits: inflows.length - exactMultipleDeposits,
            observedWholeShares: observedWholeShares.toString(),
            nonMultipleObservedAmount: nonMultipleObservedAmount.toString(),
            exactMultipleCoverage:
              inflows.length === 0
                ? unknownValue(
                    'NOT_APPLICABLE',
                    'No observed deposits are available for this ratio.',
                  )
                : knownValue(exactMultipleDeposits / inflows.length),
          },
    selfTransferCount: selfTransfers.length,
    selfTransferObservedAmount: selfTransferAmount.toString(),
    topCounterparties: counterpartySummaries(directional, limit),
    metadata: {
      ...metadata,
      modelVersion: CLAIM_FLOW_SUMMARY_MODEL_VERSION,
      evidenceIds,
    },
  };
  return ClaimAddressFlowSummarySchema.parse(result);
}
