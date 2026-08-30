import { createHash } from 'node:crypto';

import type { SocialPost, SocialSourceConfig } from './social-source.js';

export const EXTERNAL_CONTENT_POLICY_VERSION = 'external-content-policy-v1.0.0';

export interface ExternalContentRightsPolicy {
  policyVersion: string;
  sourceId: string;
  contractVersion: string;
  rightsStatus: 'VERIFIED' | 'REVOKED' | 'UNVERIFIED';
  rightsEvidenceIds: readonly string[];
  retention: 'METADATA_ONLY' | 'EPHEMERAL_TEXT' | 'DURABLE_TEXT';
  maxRetentionSeconds: number | null;
  deletionMode: 'POLL_OR_WEBHOOK_VERIFIED' | 'ARCHIVE_RIGHT_VERIFIED' | 'UNVERIFIED';
  deletionCheckMaxAgeSeconds: number;
  externalAi: 'PROHIBITED' | 'RIGHTS_GATED';
  verifiedAt: string;
  expiresAt: string;
}

export interface ExternalContentRecord {
  state: 'ACTIVE';
  sourceId: string;
  upstreamGroup: 'X';
  postId: string;
  text: string | null;
  contentHash: string;
  createdAt: string;
  observedAt: string;
  deletionCheckedAt: string;
  retainUntil: string | null;
  policyVersion: string;
  contractVersion: string;
  rightsEvidenceIds: string[];
}

export interface ExternalContentTombstone {
  state: 'TOMBSTONED';
  sourceId: string;
  upstreamGroup: 'X';
  postId: string;
  contentHash: string;
  deletedAt: string;
  reason: 'UPSTREAM_DELETED' | 'RIGHTS_REVOKED' | 'RETENTION_EXPIRED' | 'ANALYST_REQUEST';
  policyVersion: string;
  evidenceIds: string[];
}

export interface ExternalAiAuthorization {
  externalAiApproved: true;
  sourceId: string;
  postId: string;
  policyVersion: string;
  rightsEvidenceIds: string[];
  deletionCheckedAt: string;
}

function time(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`EXTERNAL_CONTENT_${field.toUpperCase()}_INVALID`);
  return parsed;
}

function validateEvidence(ids: readonly string[]): string[] {
  const result = [...new Set(ids)].sort();
  if (result.length === 0 || result.some((id) => !/^ev_[0-9a-f]{24}$/.test(id))) {
    throw new Error('EXTERNAL_CONTENT_RIGHTS_EVIDENCE_INVALID');
  }
  return result;
}

export function assertExternalContentPolicy(
  source: Pick<
    SocialSourceConfig,
    'id' | 'contractVersion' | 'identityVerified' | 'rightsApproved'
  >,
  policy: ExternalContentRightsPolicy,
  asOf: string,
): void {
  const now = time(asOf, 'as_of');
  if (
    !source.identityVerified ||
    !source.rightsApproved ||
    policy.rightsStatus !== 'VERIFIED' ||
    policy.sourceId !== source.id ||
    policy.contractVersion !== source.contractVersion ||
    policy.policyVersion.trim().length === 0 ||
    time(policy.verifiedAt, 'verified_at') > now ||
    time(policy.expiresAt, 'expires_at') < now
  ) {
    throw new Error('EXTERNAL_CONTENT_POLICY_NOT_ACTIVE');
  }
  validateEvidence(policy.rightsEvidenceIds);
  if (
    !Number.isSafeInteger(policy.deletionCheckMaxAgeSeconds) ||
    policy.deletionCheckMaxAgeSeconds < 60 ||
    policy.deletionCheckMaxAgeSeconds > 31_557_600
  ) {
    throw new Error('EXTERNAL_CONTENT_DELETION_WINDOW_INVALID');
  }
  if (policy.retention === 'METADATA_ONLY') {
    if (policy.maxRetentionSeconds !== null) {
      throw new Error('EXTERNAL_CONTENT_METADATA_RETENTION_MUST_BE_NULL');
    }
  } else if (
    !Number.isSafeInteger(policy.maxRetentionSeconds) ||
    (policy.maxRetentionSeconds as number) < 60 ||
    (policy.maxRetentionSeconds as number) > 31_557_600
  ) {
    throw new Error('EXTERNAL_CONTENT_TEXT_RETENTION_INVALID');
  }
  if (policy.retention !== 'METADATA_ONLY' && policy.deletionMode === 'UNVERIFIED') {
    throw new Error('EXTERNAL_CONTENT_DELETION_NOT_VERIFIED');
  }
}

export function externalContentPolicyStatus(
  source: Pick<
    SocialSourceConfig,
    'id' | 'contractVersion' | 'identityVerified' | 'rightsApproved' | 'contentPolicy'
  >,
  asOf = new Date().toISOString(),
): 'READY' | 'UNCONFIGURED' | 'INACTIVE' {
  if (source.contentPolicy === null) return 'UNCONFIGURED';
  try {
    assertExternalContentPolicy(source, source.contentPolicy, asOf);
    return 'READY';
  } catch {
    return 'INACTIVE';
  }
}

export function prepareExternalContentRecord(
  source: SocialSourceConfig,
  post: SocialPost,
  deletionCheckedAt: string,
): ExternalContentRecord {
  const policy = source.contentPolicy;
  if (policy === null) throw new Error('EXTERNAL_CONTENT_POLICY_REQUIRED');
  assertExternalContentPolicy(source, policy, post.observedAt);
  if (post.sourceId !== source.id || post.upstreamGroup !== source.upstreamGroup) {
    throw new Error('EXTERNAL_CONTENT_SOURCE_MISMATCH');
  }
  const observedAt = time(post.observedAt, 'observed_at');
  const deletionCheck = time(deletionCheckedAt, 'deletion_checked_at');
  if (Math.abs(observedAt - deletionCheck) > policy.deletionCheckMaxAgeSeconds * 1_000) {
    throw new Error('EXTERNAL_CONTENT_DELETION_CHECK_STALE');
  }
  const text = policy.retention === 'METADATA_ONLY' ? null : post.text;
  const retainUntil =
    policy.maxRetentionSeconds === null
      ? null
      : new Date(observedAt + policy.maxRetentionSeconds * 1_000).toISOString();
  return {
    state: 'ACTIVE',
    sourceId: source.id,
    upstreamGroup: source.upstreamGroup,
    postId: post.id,
    text,
    contentHash: createHash('sha256').update(post.text, 'utf8').digest('hex'),
    createdAt: post.createdAt,
    observedAt: post.observedAt,
    deletionCheckedAt: new Date(deletionCheck).toISOString(),
    retainUntil,
    policyVersion: policy.policyVersion,
    contractVersion: source.contractVersion,
    rightsEvidenceIds: validateEvidence(policy.rightsEvidenceIds),
  };
}

export function tombstoneExternalContent(
  record: ExternalContentRecord,
  input: {
    deletedAt: string;
    reason: ExternalContentTombstone['reason'];
    evidenceIds: readonly string[];
  },
): ExternalContentTombstone {
  const deletedAt = time(input.deletedAt, 'deleted_at');
  if (deletedAt < time(record.observedAt, 'observed_at')) {
    throw new Error('EXTERNAL_CONTENT_TOMBSTONE_PRECEDES_OBSERVATION');
  }
  return {
    state: 'TOMBSTONED',
    sourceId: record.sourceId,
    upstreamGroup: record.upstreamGroup,
    postId: record.postId,
    contentHash: record.contentHash,
    deletedAt: new Date(deletedAt).toISOString(),
    reason: input.reason,
    policyVersion: record.policyVersion,
    evidenceIds: validateEvidence([...record.rightsEvidenceIds, ...input.evidenceIds]),
  };
}

export function authorizeExternalAiTransfer(
  source: SocialSourceConfig,
  record: ExternalContentRecord | ExternalContentTombstone,
  asOf: string,
): ExternalAiAuthorization {
  const policy = source.contentPolicy;
  if (policy === null) throw new Error('EXTERNAL_CONTENT_POLICY_REQUIRED');
  assertExternalContentPolicy(source, policy, asOf);
  if (
    policy.externalAi !== 'RIGHTS_GATED' ||
    record.state !== 'ACTIVE' ||
    record.text === null ||
    record.sourceId !== source.id ||
    record.policyVersion !== policy.policyVersion ||
    time(asOf, 'as_of') < time(record.deletionCheckedAt, 'deletion_checked_at') ||
    time(asOf, 'as_of') - time(record.deletionCheckedAt, 'deletion_checked_at') >
      policy.deletionCheckMaxAgeSeconds * 1_000
  ) {
    throw new Error('EXTERNAL_CONTENT_AI_TRANSFER_NOT_AUTHORIZED');
  }
  return {
    externalAiApproved: true,
    sourceId: source.id,
    postId: record.postId,
    policyVersion: policy.policyVersion,
    rightsEvidenceIds: [...record.rightsEvidenceIds],
    deletionCheckedAt: record.deletionCheckedAt,
  };
}
