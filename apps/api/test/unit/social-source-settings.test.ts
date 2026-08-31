import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../src/config.js';
import {
  loadSocialSourceSettings,
  parseSocialSourceSettings,
} from '../../src/social-source-settings.js';

const asOf = '2026-08-31T00:00:00.000Z';

function activeSource() {
  return {
    provider_id: 'xapid',
    enabled: true,
    identity_verified: true,
    rights_approved: true,
    origin: 'https://verified-social.example.com',
    documentation_url: 'https://verified-social.example.com/docs',
    contract_version: 'verified-contract-v1',
    authentication: { type: 'NONE', header_name: null, secret_ref: null },
    dispatch_policy: {
      account_id: 'xapid-free-test',
      cost_kind: 'VERIFIED_FREE',
      max_units: '1',
      max_microusd: '0',
      cost_evidence: 'xapid-free-test-evidence',
      quote_ttl_seconds: 300,
      timeout_ms: 5000,
      max_response_bytes: 1000000,
    },
    content_policy: {
      policy_version: 'verified-rights-v1',
      source_id: 'xapid',
      contract_version: 'verified-contract-v1',
      rights_status: 'VERIFIED',
      rights_evidence_ids: [`ev_${'1'.repeat(24)}`],
      retention: 'METADATA_ONLY',
      max_retention_seconds: null,
      deletion_mode: 'UNVERIFIED',
      deletion_check_max_age_seconds: 3600,
      external_ai: 'PROHIBITED',
      verified_at: '2026-08-01T00:00:00.000Z',
      expires_at: '2027-08-01T00:00:00.000Z',
    },
    search: {
      path: '/v1/search',
      query_parameter: 'query',
      cursor_parameter: 'cursor',
      count_parameter: 'limit',
      latest_parameter: null,
      latest_value: null,
      max_count: 100,
      max_query_chars: 512,
      items_path: ['data'],
      cursor_path: ['nextCursor'],
      missing_cursor_means_end: true,
      success_path: null,
      success_value: null,
      id_path: ['id'],
      text_path: ['text'],
      created_at_path: ['createdAt'],
      author_id_path: ['authorId'],
      author_handle_path: ['authorHandle'],
      temporal: {
        since_parameter: 'from',
        until_parameter: 'until',
        precision: 'INSTANT',
        until_mode: 'EXCLUSIVE',
        overlap_seconds: 60,
      },
    },
    upstream_group: 'X',
  };
}

describe('X研究来源合同文件', () => {
  it('可直接读取仓库中的xapid未知身份模板，并保持停用和空端点', () => {
    const value = JSON.parse(readFileSync('config/xapid.example.json', 'utf8')) as unknown;
    expect(parseSocialSourceSettings(value, asOf)).toEqual([
      expect.objectContaining({
        id: 'xapid',
        enabled: false,
        identityVerified: false,
        rightsApproved: false,
        origin: null,
        documentation: null,
        contractVersion: 'UNVERIFIED',
        contentPolicy: null,
        search: null,
      }),
    ]);
    expect(
      loadSocialSourceSettings(
        { socialSourceConfigPath: 'config/xapid.example.json' } as AppConfig,
        {},
      ),
    ).toEqual([expect.objectContaining({ id: 'xapid', enabled: false, origin: null })]);
  });

  it('仅在身份、权益、内容规则和固定读取合同全部有效时启用', () => {
    expect(parseSocialSourceSettings(activeSource(), asOf)).toEqual([
      expect.objectContaining({
        id: 'xapid',
        enabled: true,
        origin: 'https://verified-social.example.com',
        contractVersion: 'verified-contract-v1',
        contentPolicy: expect.objectContaining({
          policyVersion: 'verified-rights-v1',
          rightsEvidenceIds: [`ev_${'1'.repeat(24)}`],
        }),
        dispatch: expect.objectContaining({
          accountId: 'xapid-free-test',
          costKind: 'VERIFIED_FREE',
          maxMicrousd: '0',
        }),
        search: expect.objectContaining({
          path: '/v1/search',
          queryParameter: 'query',
          cursorParameter: 'cursor',
          temporal: expect.objectContaining({
            precision: 'INSTANT',
            overlapSeconds: 60,
          }),
        }),
      }),
    ]);
  });

  it('拒绝未核验启用、私网origin、危险密钥引用和重复来源', () => {
    expect(() =>
      parseSocialSourceSettings(
        { ...activeSource(), identity_verified: false, rights_approved: false },
        asOf,
      ),
    ).toThrow('EXTERNAL_CONTENT_POLICY_NOT_ACTIVE');
    expect(() =>
      parseSocialSourceSettings({ ...activeSource(), origin: 'https://localhost' }, asOf),
    ).toThrow('NONPUBLIC_ORIGIN');
    expect(() =>
      parseSocialSourceSettings(
        {
          ...activeSource(),
          authentication: {
            type: 'BEARER',
            header_name: null,
            secret_ref: 'PATH_OR_INLINE_SECRET',
          },
        },
        asOf,
      ),
    ).toThrow();
    expect(() =>
      parseSocialSourceSettings(
        {
          ...activeSource(),
          dispatch_policy: {
            ...activeSource().dispatch_policy,
            cost_kind: 'UNKNOWN',
          },
        },
        asOf,
      ),
    ).toThrow('SOURCE_PRICE_UNVERIFIED');
    expect(() =>
      parseSocialSourceSettings(
        { ...activeSource(), search: { ...activeSource().search, temporal: null } },
        asOf,
      ),
    ).toThrow('SOCIAL_SOURCE_ENABLED_CONTRACT_INCOMPLETE');
    expect(() =>
      parseSocialSourceSettings(
        {
          ...activeSource(),
          search: {
            ...activeSource().search,
            temporal: {
              ...activeSource().search.temporal,
              until_parameter: activeSource().search.temporal.since_parameter,
            },
          },
        },
        asOf,
      ),
    ).toThrow();
    expect(() =>
      parseSocialSourceSettings(
        { version: 'V11.0', sources: [activeSource(), activeSource()] },
        asOf,
      ),
    ).toThrow('SOCIAL_SOURCE_ID_DUPLICATED');
  });
});
