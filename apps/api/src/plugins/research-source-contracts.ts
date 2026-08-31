import { externalContentPolicyStatus, type SocialSourceConfig } from '@zerotrace/provider-plane';

import type { AppHttpContext } from '../http/context.js';

export function sourceStatus(
  source: SocialSourceConfig,
):
  | 'READY'
  | 'DISABLED'
  | 'UNVERIFIED_IDENTITY'
  | 'RIGHTS_NOT_APPROVED'
  | 'CONTRACT_INCOMPLETE'
  | 'DISPATCH_POLICY_UNCONFIGURED'
  | 'CONTENT_POLICY_UNCONFIGURED'
  | 'CONTENT_POLICY_INACTIVE' {
  if (!source.identityVerified) return 'UNVERIFIED_IDENTITY';
  if (!source.rightsApproved) return 'RIGHTS_NOT_APPROVED';
  if (source.origin === null || source.documentation === null || source.search === null) {
    return 'CONTRACT_INCOMPLETE';
  }
  if (source.dispatch === null) return 'DISPATCH_POLICY_UNCONFIGURED';
  const contentPolicy = externalContentPolicyStatus(source);
  if (contentPolicy === 'UNCONFIGURED') return 'CONTENT_POLICY_UNCONFIGURED';
  if (contentPolicy === 'INACTIVE') return 'CONTENT_POLICY_INACTIVE';
  return source.enabled ? 'READY' : 'DISABLED';
}

export function publicSource(source: SocialSourceConfig, durableDispatchAvailable: boolean) {
  return {
    providerId: source.id,
    displayName: source.id === 'xapid' ? 'xapid（待确认具体服务）' : 'FxEmbed',
    status: sourceStatus(source),
    enabled: source.enabled,
    identityVerified: source.identityVerified,
    rightsApproved: source.rightsApproved,
    endpointConfigured: source.origin !== null && source.search !== null,
    documentation: source.documentation,
    contractVersion: source.contractVersion,
    contentPolicy:
      source.contentPolicy === null
        ? {
            status: 'UNCONFIGURED',
            retention: null,
            deletionMode: null,
            externalAi: 'PROHIBITED',
          }
        : {
            status: externalContentPolicyStatus(source),
            policyVersion: source.contentPolicy.policyVersion,
            rightsStatus: source.contentPolicy.rightsStatus,
            retention: source.contentPolicy.retention,
            deletionMode: source.contentPolicy.deletionMode,
            externalAi: source.contentPolicy.externalAi,
            expiresAt: source.contentPolicy.expiresAt,
          },
    authenticationConfigured:
      source.authentication.kind === 'NONE' || source.authentication.secretRef !== null,
    dispatchPolicyConfigured: source.dispatch !== null,
    observationWindowSupported: source.search !== null && source.search.temporal !== null,
    upstreamGroup: source.upstreamGroup,
    dispatchAllowed:
      sourceStatus(source) === 'READY' &&
      source.search !== null &&
      source.search.temporal !== null &&
      durableDispatchAvailable,
  };
}

export async function rightsEvidenceAvailable(
  context: AppHttpContext,
  source: SocialSourceConfig,
): Promise<boolean> {
  if (context.runtime.evidenceRepository === undefined || source.contentPolicy === null) {
    return false;
  }
  const rightsEvidence = await Promise.all(
    source.contentPolicy.rightsEvidenceIds.map((id) => context.runtime.evidenceRepository?.get(id)),
  );
  return rightsEvidence.every((node) => node !== undefined);
}
