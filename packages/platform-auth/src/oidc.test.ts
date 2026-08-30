import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { createOidcBearerVerifier } from './oidc.js';
import type { OidcAuthenticationError } from './oidc.js';

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'zerotrace-test';
  const verifier = createOidcBearerVerifier(
    {
      issuer: 'https://idp.example',
      audience: 'zerotrace',
      jwksUri: 'https://idp.example/.well-known/jwks.json',
    },
    { keyResolver: createLocalJWKSet({ keys: [publicJwk] }) },
  );
  return { privateKey, verifier };
}

async function authorizedFixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'zerotrace-test';
  const verifier = createOidcBearerVerifier(
    {
      issuer: 'https://idp.example',
      audience: 'zerotrace',
      jwksUri: 'https://idp.example/.well-known/jwks.json',
      authorization: {
        expectedTenantId: 'tenant-1',
        tenantClaim: 'zerotrace.tenant',
        rolesClaim: 'zerotrace.roles',
        mfaClaim: 'zerotrace.mfa',
      },
    },
    { keyResolver: createLocalJWKSet({ keys: [publicJwk] }) },
  );
  return { privateKey, verifier };
}

async function token(
  privateKey: CryptoKey,
  overrides: {
    audience?: string;
    expiresAt?: number;
    omitExpiration?: boolean;
    claims?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  let builder = new SignJWT({ purpose: 'read-only-research', ...overrides.claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'zerotrace-test' })
    .setIssuer('https://idp.example')
    .setAudience(overrides.audience ?? 'zerotrace')
    .setSubject('analyst-1')
    .setIssuedAt(now);
  if (overrides.omitExpiration !== true) {
    builder = builder.setExpirationTime(overrides.expiresAt ?? now + 300);
  }
  return builder.sign(privateKey);
}

describe('OIDC bearer verifier', () => {
  it('verifies signature, issuer, audience, subject and expiry', async () => {
    const { privateKey, verifier } = await fixture();
    const principal = await verifier.verifyAuthorization(`Bearer ${await token(privateKey)}`);
    expect(principal.subject).toBe('analyst-1');
    expect(principal.issuer).toBe('https://idp.example');
    expect(principal.audiences).toEqual(['zerotrace']);
  });

  it('rejects missing, wrong-audience, expired and incomplete tokens', async () => {
    const { privateKey, verifier } = await fixture();
    await expect(verifier.verifyAuthorization(undefined)).rejects.toMatchObject({
      code: 'OIDC_AUTHORIZATION_REQUIRED',
    } satisfies Partial<OidcAuthenticationError>);
    await expect(
      verifier.verifyAuthorization(`Bearer ${await token(privateKey, { audience: 'other' })}`),
    ).rejects.toMatchObject({ code: 'OIDC_TOKEN_INVALID' });
    await expect(
      verifier.verifyAuthorization(
        `Bearer ${await token(privateKey, { expiresAt: Math.floor(Date.now() / 1_000) - 10 })}`,
      ),
    ).rejects.toMatchObject({ code: 'OIDC_TOKEN_INVALID' });
    await expect(
      verifier.verifyAuthorization(`Bearer ${await token(privateKey, { omitExpiration: true })}`),
    ).rejects.toMatchObject({ code: 'OIDC_TOKEN_INVALID' });
  });

  it('extracts only explicitly configured tenant, canonical roles, and MFA claims', async () => {
    const { privateKey, verifier } = await authorizedFixture();
    const principal = await verifier.verifyAuthorization(
      `Bearer ${await token(privateKey, {
        claims: {
          zerotrace: { tenant: 'tenant-1', roles: ['investigator'], mfa: true },
        },
      })}`,
    );
    expect(principal.authorization).toEqual({
      tenantId: 'tenant-1',
      roles: ['investigator'],
      mfaSatisfied: true,
    });
  });

  it('rejects cross-tenant, unknown-role, and malformed authorization claims', async () => {
    const { privateKey, verifier } = await authorizedFixture();
    for (const zerotrace of [
      { tenant: 'tenant-2', roles: ['investigator'], mfa: true },
      { tenant: 'tenant-1', roles: ['owner'], mfa: true },
      { tenant: 'tenant-1', roles: ['admin'], mfa: 'yes' },
    ]) {
      await expect(
        verifier.verifyAuthorization(
          `Bearer ${await token(privateKey, { claims: { zerotrace } })}`,
        ),
      ).rejects.toMatchObject({ code: 'OIDC_TOKEN_INVALID' });
    }
    expect(() =>
      createOidcBearerVerifier({
        issuer: 'https://idp.example',
        audience: 'zerotrace',
        jwksUri: 'https://idp.example/.well-known/jwks.json',
        authorization: {
          expectedTenantId: 'tenant-1',
          tenantClaim: '__proto__.tenant',
          rolesClaim: 'zerotrace.roles',
        },
      }),
    ).toThrow(/安全的点分隔 claim 路径/);
  });
});
