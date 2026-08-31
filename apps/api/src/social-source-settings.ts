import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  assertExternalContentPolicy,
  validateOrigin,
  type SocialSourceConfig,
} from '@zerotrace/provider-plane';

import type { AppConfig } from './config.js';

const JsonPathSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value)),
  )
  .max(12);

const ContentPolicySchema = z
  .object({
    policy_version: z.string().trim().min(1).max(128),
    source_id: z.enum(['fxembed', 'xapid']),
    contract_version: z.string().trim().min(1).max(128),
    rights_status: z.enum(['VERIFIED', 'REVOKED', 'UNVERIFIED']),
    rights_evidence_ids: z
      .array(z.string().regex(/^ev_[0-9a-f]{24}$/))
      .min(1)
      .max(128),
    retention: z.enum(['METADATA_ONLY', 'EPHEMERAL_TEXT', 'DURABLE_TEXT']),
    max_retention_seconds: z.number().int().positive().nullable(),
    deletion_mode: z.enum(['POLL_OR_WEBHOOK_VERIFIED', 'ARCHIVE_RIGHT_VERIFIED', 'UNVERIFIED']),
    deletion_check_max_age_seconds: z.number().int().positive(),
    external_ai: z.enum(['PROHIBITED', 'RIGHTS_GATED']),
    verified_at: z.iso.datetime({ offset: true }),
    expires_at: z.iso.datetime({ offset: true }),
  })
  .strict();

const TemporalContractSchema = z
  .object({
    since_parameter: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
    until_parameter: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
    precision: z.enum(['INSTANT', 'UTC_DATE']),
    until_mode: z.enum(['EXCLUSIVE', 'INCLUSIVE']),
    overlap_seconds: z.number().int().min(0).max(604_800),
  })
  .strict()
  .refine((value) => value.since_parameter !== value.until_parameter, {
    message: 'Temporal boundary parameters must be distinct.',
  });

const SearchSchema = z
  .object({
    path: z.string().min(1).max(512),
    query_parameter: z.string().min(1).max(64),
    cursor_parameter: z.string().min(1).max(64),
    count_parameter: z.string().min(1).max(64).nullable(),
    latest_parameter: z.string().min(1).max(64).nullable(),
    latest_value: z.string().min(1).max(128).nullable(),
    max_count: z.number().int().min(1).max(1_000),
    max_query_chars: z.number().int().min(1).max(20_000),
    items_path: JsonPathSchema,
    cursor_path: JsonPathSchema,
    missing_cursor_means_end: z.boolean(),
    success_path: JsonPathSchema.nullable(),
    success_value: z.union([z.string(), z.number()]).nullable(),
    id_path: JsonPathSchema,
    text_path: JsonPathSchema,
    created_at_path: JsonPathSchema,
    author_id_path: JsonPathSchema.nullable(),
    author_handle_path: JsonPathSchema.nullable(),
    temporal: TemporalContractSchema.nullable().optional(),
  })
  .strict();

const DispatchPolicySchema = z
  .object({
    account_id: z.string().regex(/^[A-Za-z0-9_:.-]{1,180}$/),
    cost_kind: z.enum(['VERIFIED_FREE', 'PAID_MAXIMUM', 'UNKNOWN']),
    max_units: z.string().regex(/^(0|[1-9][0-9]*)$/),
    max_microusd: z.string().regex(/^(0|[1-9][0-9]*)$/),
    cost_evidence: z.string().trim().min(1).max(512),
    quote_ttl_seconds: z.number().int().min(30).max(86_400),
    timeout_ms: z.number().int().min(1).max(120_000),
    max_response_bytes: z.number().int().min(1).max(20_000_000),
  })
  .strict();

const SourceSchema = z
  .object({
    provider_id: z.enum(['fxembed', 'xapid']),
    enabled: z.boolean(),
    identity_verified: z.boolean(),
    rights_approved: z.boolean(),
    origin: z.string().url().nullable(),
    documentation_url: z.string().url().nullable(),
    contract_version: z.string().trim().min(1).max(128).nullable(),
    authentication: z
      .object({
        type: z.enum(['NONE', 'BEARER', 'HEADER']).nullable(),
        header_name: z.string().min(1).max(64).nullable(),
        secret_ref: z
          .string()
          .regex(/^ZEROTRACE_SOCIAL_[A-Z0-9_]{1,96}$/)
          .nullable(),
      })
      .strict(),
    dispatch_policy: DispatchPolicySchema.nullable().optional(),
    search: SearchSchema.nullable(),
    content_policy: ContentPolicySchema.nullable().optional(),
    upstream_group: z.literal('X'),
  })
  .passthrough();

const SettingsSchema = z.union([
  SourceSchema.transform((source) => ({ version: 'V11.0', sources: [source] })),
  z
    .object({
      version: z.literal('V11.0'),
      sources: z.array(SourceSchema).min(1).max(8),
    })
    .strict(),
]);

function mapSource(input: z.infer<typeof SourceSchema>, asOf: string): SocialSourceConfig {
  const authenticationType = input.authentication.type ?? 'NONE';
  const source: SocialSourceConfig = {
    id: input.provider_id,
    origin: input.origin,
    identityVerified: input.identity_verified,
    rightsApproved: input.rights_approved,
    enabled: input.enabled,
    contractVersion: input.contract_version ?? 'UNVERIFIED',
    upstreamGroup: 'X',
    documentation: input.documentation_url,
    authentication: {
      kind: authenticationType,
      secretRef: input.authentication.secret_ref,
      headerName: input.authentication.header_name,
    },
    dispatch:
      input.dispatch_policy === undefined || input.dispatch_policy === null
        ? null
        : {
            accountId: input.dispatch_policy.account_id,
            costKind: input.dispatch_policy.cost_kind,
            maxUnits: input.dispatch_policy.max_units,
            maxMicrousd: input.dispatch_policy.max_microusd,
            costEvidence: input.dispatch_policy.cost_evidence,
            quoteTtlSeconds: input.dispatch_policy.quote_ttl_seconds,
            timeoutMs: input.dispatch_policy.timeout_ms,
            maxResponseBytes: input.dispatch_policy.max_response_bytes,
          },
    contentPolicy:
      input.content_policy === undefined || input.content_policy === null
        ? null
        : {
            policyVersion: input.content_policy.policy_version,
            sourceId: input.content_policy.source_id,
            contractVersion: input.content_policy.contract_version,
            rightsStatus: input.content_policy.rights_status,
            rightsEvidenceIds: [...new Set(input.content_policy.rights_evidence_ids)].sort(),
            retention: input.content_policy.retention,
            maxRetentionSeconds: input.content_policy.max_retention_seconds,
            deletionMode: input.content_policy.deletion_mode,
            deletionCheckMaxAgeSeconds: input.content_policy.deletion_check_max_age_seconds,
            externalAi: input.content_policy.external_ai,
            verifiedAt: input.content_policy.verified_at,
            expiresAt: input.content_policy.expires_at,
          },
    search:
      input.search === null
        ? null
        : {
            path: input.search.path,
            queryParameter: input.search.query_parameter,
            cursorParameter: input.search.cursor_parameter,
            countParameter: input.search.count_parameter,
            latestParameter: input.search.latest_parameter,
            latestValue: input.search.latest_value,
            maxCount: input.search.max_count,
            maxQueryChars: input.search.max_query_chars,
            itemsPath: input.search.items_path,
            cursorPath: input.search.cursor_path,
            missingCursorMeansEnd: input.search.missing_cursor_means_end,
            successPath: input.search.success_path,
            successValue: input.search.success_value,
            idPath: input.search.id_path,
            textPath: input.search.text_path,
            createdAtPath: input.search.created_at_path,
            authorIdPath: input.search.author_id_path,
            authorHandlePath: input.search.author_handle_path,
            temporal:
              input.search.temporal === undefined || input.search.temporal === null
                ? null
                : {
                    sinceParameter: input.search.temporal.since_parameter,
                    untilParameter: input.search.temporal.until_parameter,
                    precision: input.search.temporal.precision,
                    untilMode: input.search.temporal.until_mode,
                    overlapSeconds: input.search.temporal.overlap_seconds,
                  },
          },
  };
  if (source.origin !== null) validateOrigin(source.origin);
  if (authenticationType === 'NONE') {
    if (source.authentication.secretRef !== null || source.authentication.headerName !== null) {
      throw new Error('SOCIAL_SOURCE_NONE_AUTH_MUST_NOT_REFERENCE_SECRET');
    }
  } else if (source.authentication.secretRef === null) {
    throw new Error('SOCIAL_SOURCE_SECRET_REFERENCE_REQUIRED');
  } else if (authenticationType === 'BEARER' && source.authentication.headerName !== null) {
    throw new Error('SOCIAL_SOURCE_BEARER_HEADER_MUST_BE_NULL');
  } else if (
    authenticationType === 'HEADER' &&
    (source.authentication.headerName === null ||
      !/^x-[a-z0-9-]{1,61}$/i.test(source.authentication.headerName))
  ) {
    throw new Error('SOCIAL_SOURCE_HEADER_INVALID');
  }
  if (source.enabled) {
    if (
      input.authentication.type === null ||
      source.origin === null ||
      source.documentation === null ||
      source.search === null ||
      source.search.temporal === null ||
      source.contentPolicy === null ||
      source.dispatch === null ||
      source.contractVersion === 'UNVERIFIED'
    ) {
      throw new Error('SOCIAL_SOURCE_ENABLED_CONTRACT_INCOMPLETE');
    }
    if (source.dispatch.costKind === 'UNKNOWN') {
      throw new Error('SOURCE_PRICE_UNVERIFIED');
    }
    if (source.dispatch.costKind === 'VERIFIED_FREE' && source.dispatch.maxMicrousd !== '0') {
      throw new Error('FREE_SOURCE_CANNOT_RESERVE_MONEY');
    }
    assertExternalContentPolicy(source, source.contentPolicy, asOf);
  }
  return source;
}

export function parseSocialSourceSettings(
  value: unknown,
  asOf = new Date().toISOString(),
): SocialSourceConfig[] {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('SOCIAL_SOURCE_AS_OF_INVALID');
  const parsed = SettingsSchema.parse(value);
  const sources = parsed.sources.map((source) => mapSource(source, asOf));
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error('SOCIAL_SOURCE_ID_DUPLICATED');
  }
  return sources;
}

export function loadSocialSourceSettings(
  config: AppConfig,
  environment: NodeJS.ProcessEnv = process.env,
): SocialSourceConfig[] | undefined {
  if (config.socialSourceConfigPath === undefined) return undefined;
  const path = resolve(config.socialSourceConfigPath);
  try {
    const sources = parseSocialSourceSettings(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    for (const source of sources) {
      const ref = source.authentication.secretRef;
      if (source.enabled && source.authentication.kind !== 'NONE') {
        const secret = ref === null ? undefined : environment[ref];
        if (secret === undefined || secret.length === 0 || /[\r\n]/.test(secret)) {
          throw new Error('SOCIAL_SOURCE_REFERENCED_SECRET_UNAVAILABLE');
        }
      }
    }
    return sources;
  } catch (error) {
    throw new Error('SOCIAL_SOURCE_CONFIG_INVALID', { cause: error });
  }
}
