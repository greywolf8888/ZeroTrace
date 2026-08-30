import type { FastifyInstance } from 'fastify';

import {
  externalContentPolicyStatus,
  FXEMBED_TEMPLATE,
  XAPID_TEMPLATE,
  type SocialSourceConfig,
} from '@zerotrace/provider-plane';

import type { AppHttpContext } from '../http/context.js';

function sourceStatus(
  source: SocialSourceConfig,
):
  | 'READY'
  | 'DISABLED'
  | 'UNVERIFIED_IDENTITY'
  | 'RIGHTS_NOT_APPROVED'
  | 'CONTRACT_INCOMPLETE'
  | 'CONTENT_POLICY_UNCONFIGURED'
  | 'CONTENT_POLICY_INACTIVE' {
  if (!source.identityVerified) return 'UNVERIFIED_IDENTITY';
  if (!source.rightsApproved) return 'RIGHTS_NOT_APPROVED';
  if (source.origin === null || source.documentation === null || source.search === null) {
    return 'CONTRACT_INCOMPLETE';
  }
  const contentPolicy = externalContentPolicyStatus(source);
  if (contentPolicy === 'UNCONFIGURED') return 'CONTENT_POLICY_UNCONFIGURED';
  if (contentPolicy === 'INACTIVE') return 'CONTENT_POLICY_INACTIVE';
  return source.enabled ? 'READY' : 'DISABLED';
}

function publicSource(source: SocialSourceConfig, durableDispatchAvailable: boolean) {
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
    upstreamGroup: source.upstreamGroup,
    dispatchAllowed: sourceStatus(source) === 'READY' && durableDispatchAvailable,
  };
}

export async function registerResearchSourceRoutes(
  app: FastifyInstance,
  context: AppHttpContext,
): Promise<void> {
  app.get('/api/v1/settings/research-sources', { schema: { tags: ['system'] } }, async () => {
    const configured = context.runtime.socialSources ?? [FXEMBED_TEMPLATE, XAPID_TEMPLATE];
    let procurement:
      | {
          status: 'DURABLE';
          remainingMicrousd: string;
          paidEnabled: boolean;
          blocked: boolean;
          revision: number;
          updatedAt: string;
        }
      | {
          status: 'UNAVAILABLE' | 'NOT_INITIALIZED';
          remainingMicrousd: null;
          paidEnabled: false;
          blocked: null;
          revision: null;
          updatedAt: null;
          reason: string;
        };
    if (context.runtime.dataProcurement === undefined) {
      procurement = {
        status: 'UNAVAILABLE',
        remainingMicrousd: null,
        paidEnabled: false,
        blocked: null,
        revision: null,
        updatedAt: null,
        reason: 'DURABLE_STORAGE_UNAVAILABLE',
      };
    } else {
      try {
        const record = await context.runtime.dataProcurement.get('global');
        procurement = {
          status: 'DURABLE',
          remainingMicrousd: record.state.remainingMicrousd,
          paidEnabled: record.policy.paidAllowed,
          blocked: record.state.blocked,
          revision: record.state.revision,
          updatedAt: record.updatedAt,
        };
      } catch (error) {
        procurement = {
          status: 'NOT_INITIALIZED',
          remainingMicrousd: null,
          paidEnabled: false,
          blocked: null,
          revision: null,
          updatedAt: null,
          reason:
            error instanceof Error && 'code' in error
              ? String((error as { code: unknown }).code)
              : 'DATA_PROCUREMENT_UNAVAILABLE',
        };
      }
    }
    return {
      policyVersion: 'data-policy-v11.0',
      procurementBudgetMicrousd: '0',
      paidEnabledByDefault: false,
      credentialsAreSpendConsent: false,
      unknownPrice: 'BLOCK',
      autoFailoverToPaid: false,
      procurement,
      sources: configured.map((source) =>
        publicSource(source, procurement.status === 'DURABLE' && procurement.blocked === false),
      ),
      xUpstreamEvidenceRule: 'ALL_X_TOOLS_ONE_UPSTREAM_GROUP',
    };
  });
}
