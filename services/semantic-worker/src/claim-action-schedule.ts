import { defineCaptureSchedule } from '@zerotrace/capture-scheduler';
import {
  ClaimRuleReviewReportSchema,
  EvmClaimActionsCaptureParametersSchema,
  type ClaimRuleReviewReport,
} from '@zerotrace/schemas';

export interface ClaimActionsScheduleLimits {
  maxBlocksPerRequest: number;
  maxRequests: number;
  maxTransfers: number;
  topCounterpartyLimit: number;
}

export interface BuildClaimActionsScheduleInput {
  reviewReport: ClaimRuleReviewReport;
  fromBlock: string;
  toBlock: string;
  at: string;
  createdAt: string;
  limits?: Partial<ClaimActionsScheduleLimits> | undefined;
}

const DEFAULT_LIMITS: ClaimActionsScheduleLimits = {
  maxBlocksPerRequest: 50_000,
  maxRequests: 1_000,
  maxTransfers: 25_000,
  topCounterpartyLimit: 10,
};

function canonicalTime(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${field} must be an ISO date-time.`);
  return parsed.toISOString();
}

function evmAsset(assetId: string): { chainId: string; tokenAddress: string } {
  const match = /^eip155:((?:0|[1-9]\d*)):erc20:(0x[0-9a-f]{40})$/.exec(assetId);
  if (match === null) {
    throw new Error('Reviewed Claim rule scheduling currently requires a canonical EVM ERC-20 asset.');
  }
  return { chainId: match[1] ?? '', tokenAddress: match[2] ?? '' };
}

export function buildClaimActionsSchedule(input: BuildClaimActionsScheduleInput) {
  const review = ClaimRuleReviewReportSchema.parse(input.reviewReport);
  if (!review.requiresChainVerification) {
    throw new Error('Reviewed Claim rule does not require chain verification.');
  }
  const createdAt = canonicalTime(input.createdAt, 'createdAt');
  const at = canonicalTime(input.at, 'at');
  if (Date.parse(at) < Date.parse(createdAt)) {
    throw new RangeError('Claim Actions schedule time may not precede creation.');
  }
  const asset = evmAsset(review.assetId);
  const parameters = EvmClaimActionsCaptureParametersSchema.parse({
    schemaVersion: 'evm-claim-actions-capture-v1',
    reviewReportId: review.id,
    reviewResultHash: review.resultHash,
    ruleId: review.rule.id,
    assetId: review.assetId,
    fromBlock: input.fromBlock,
    toBlock: input.toBlock,
    observerVersion: 'evm-claim-address-observation-v1.0.0',
    limits: { ...DEFAULT_LIMITS, ...input.limits },
  });
  return defineCaptureSchedule({
    captureKind: 'CLAIM_ACTIONS',
    target: {
      ledger: 'EVM',
      chainId: asset.chainId,
      subjectType: 'TOKEN',
      normalizedIdentifier: review.assetId,
    },
    parameters,
    trigger: { type: 'ONCE', at },
    retryPolicy: {
      maxAttempts: 5,
      initialDelaySeconds: 30,
      maximumDelaySeconds: 900,
      backoffMultiplierBps: 20_000,
    },
    createdAt,
  });
}
