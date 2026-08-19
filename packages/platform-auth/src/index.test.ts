import { describe, expect, it } from 'vitest';

import { appendAudit, authorize, productionAuthConfigured, requireFourEyes } from './index.js';

const investigator = {
  subject: 'alice',
  roles: ['investigator'] as const,
  tenantId: 't1',
  mfaSatisfied: true,
};

describe('platform auth', () => {
  it('blocks cross-tenant reads', () => {
    expect(authorize(investigator, 'case.read', 't2')).toBe(false);
  });

  it('requires a distinct reviewer for four-eyes', () => {
    expect(() => requireFourEyes('case.publish', investigator, investigator)).toThrow(/第二人/);
    expect(() =>
      requireFourEyes('case.publish', investigator, { ...investigator, subject: 'bob' }),
    ).not.toThrow();
  });

  it('chains audit hashes', () => {
    const first = appendAudit('0'.repeat(64), {
      actor: 'alice',
      role: 'investigator',
      action: 'case.open',
      reason: 'intake',
      payload: { id: 1 },
    });
    const second = appendAudit(first, {
      actor: 'bob',
      role: 'admin',
      action: 'case.publish',
      reason: 'four-eyes',
      payload: { id: 1 },
    });
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails closed in production without OIDC', () => {
    expect(productionAuthConfigured({ NODE_ENV: 'production' })).toBe(false);
    expect(
      productionAuthConfigured({
        NODE_ENV: 'production',
        OIDC_ISSUER: 'https://idp.example',
        OIDC_AUDIENCE: 'zerotrace',
      }),
    ).toBe(true);
  });
});
