import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';

const DEFAULT_ALLOWED_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
] as const;

export type OidcAuthenticationErrorCode =
  'OIDC_AUTHORIZATION_REQUIRED' | 'OIDC_TOKEN_INVALID' | 'OIDC_VERIFIER_UNAVAILABLE';

export class OidcAuthenticationError extends Error {
  public constructor(
    public readonly code: OidcAuthenticationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OidcAuthenticationError';
  }
}

export interface OidcVerifierConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
  allowedAlgorithms?: readonly string[];
  timeoutMs?: number;
  authorization?: OidcAuthorizationConfig;
}

export type OidcPlatformRole = 'investigator' | 'admin' | 'readonly';

export interface OidcAuthorizationConfig {
  expectedTenantId: string;
  tenantClaim: string;
  rolesClaim: string;
  mfaClaim?: string;
}

export interface VerifiedOidcAuthorization {
  tenantId: string;
  roles: readonly OidcPlatformRole[];
  mfaSatisfied: boolean;
}

export interface VerifiedOidcPrincipal {
  subject: string;
  issuer: string;
  audiences: readonly string[];
  issuedAt: number | null;
  expiresAt: number;
  authorization: VerifiedOidcAuthorization | null;
}

export interface OidcBearerVerifier {
  verifyAuthorization(authorization: string | undefined): Promise<VerifiedOidcPrincipal>;
}

export interface OidcVerifierDependencies {
  keyResolver?: JWTVerifyGetKey;
}

function validatedHttpsUrl(value: string, field: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} 必须是有效的 HTTPS URL。`);
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new Error(`${field} 必须使用 HTTPS，且不得包含凭据或片段。`);
  }
  return url;
}

function audiences(payload: JWTPayload): readonly string[] {
  if (typeof payload.aud === 'string') return [payload.aud];
  return payload.aud ?? [];
}

function bearerToken(authorization: string | undefined): string {
  if (authorization === undefined) {
    throw new OidcAuthenticationError('OIDC_AUTHORIZATION_REQUIRED', '需要 Bearer 访问令牌。');
  }
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (match?.[1] === undefined || match[1].length > 16_384) {
    throw new OidcAuthenticationError('OIDC_TOKEN_INVALID', 'Bearer 访问令牌格式无效。');
  }
  return match[1];
}

function claimPath(value: string, field: string): string[] {
  const parts = value.split('.');
  if (
    parts.length === 0 ||
    parts.length > 8 ||
    parts.some(
      (part) =>
        !/^[A-Za-z0-9_-]{1,64}$/.test(part) ||
        part === '__proto__' ||
        part === 'prototype' ||
        part === 'constructor',
    )
  ) {
    throw new Error(`${field} 必须是安全的点分隔 claim 路径。`);
  }
  return parts;
}

function readClaim(payload: JWTPayload, path: readonly string[]): unknown {
  let current: unknown = payload;
  for (const part of path) {
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function authorizationClaims(
  payload: JWTPayload,
  config: OidcAuthorizationConfig,
): VerifiedOidcAuthorization {
  const tenant = readClaim(payload, claimPath(config.tenantClaim, 'OIDC_TENANT_CLAIM'));
  const roleClaim = readClaim(payload, claimPath(config.rolesClaim, 'OIDC_ROLES_CLAIM'));
  const rolesRaw = typeof roleClaim === 'string' ? [roleClaim] : roleClaim;
  const canonicalRoles = new Set<OidcPlatformRole>(['investigator', 'admin', 'readonly']);
  if (
    typeof tenant !== 'string' ||
    tenant.length === 0 ||
    tenant !== config.expectedTenantId ||
    !Array.isArray(rolesRaw) ||
    rolesRaw.length === 0 ||
    rolesRaw.some(
      (role) => typeof role !== 'string' || !canonicalRoles.has(role as OidcPlatformRole),
    )
  ) {
    throw new OidcAuthenticationError(
      'OIDC_TOKEN_INVALID',
      'OIDC 租户或 ZeroTrace 角色 claim 缺失、越权或格式无效。',
    );
  }
  if (rolesRaw.includes('readonly') && rolesRaw.length > 1) {
    throw new OidcAuthenticationError(
      'OIDC_TOKEN_INVALID',
      'readonly 不得与提升权限角色同时出现。',
    );
  }
  let mfaSatisfied = false;
  if (config.mfaClaim !== undefined) {
    const mfa = readClaim(payload, claimPath(config.mfaClaim, 'OIDC_MFA_CLAIM'));
    if (typeof mfa !== 'boolean') {
      throw new OidcAuthenticationError('OIDC_TOKEN_INVALID', 'OIDC MFA claim 必须是布尔值。');
    }
    mfaSatisfied = mfa;
  }
  return {
    tenantId: tenant,
    roles: [...new Set(rolesRaw as OidcPlatformRole[])].sort(),
    mfaSatisfied,
  };
}

export function createOidcBearerVerifier(
  config: OidcVerifierConfig,
  dependencies: OidcVerifierDependencies = {},
): OidcBearerVerifier {
  validatedHttpsUrl(config.issuer, 'OIDC_ISSUER');
  const issuer = config.issuer;
  const audience = config.audience.trim();
  if (audience.length === 0) throw new Error('OIDC_AUDIENCE 不得为空。');
  const jwksUri = validatedHttpsUrl(config.jwksUri, 'OIDC_JWKS_URI');
  const algorithms = [...(config.allowedAlgorithms ?? DEFAULT_ALLOWED_ALGORITHMS)];
  if (algorithms.length === 0 || algorithms.some((algorithm) => algorithm.trim().length === 0)) {
    throw new Error('OIDC 允许算法列表不得为空。');
  }
  if (config.authorization !== undefined) {
    if (config.authorization.expectedTenantId.trim().length === 0) {
      throw new Error('ZEROTRACE_TENANT_ID 不得为空。');
    }
    claimPath(config.authorization.tenantClaim, 'OIDC_TENANT_CLAIM');
    claimPath(config.authorization.rolesClaim, 'OIDC_ROLES_CLAIM');
    if (config.authorization.mfaClaim !== undefined) {
      claimPath(config.authorization.mfaClaim, 'OIDC_MFA_CLAIM');
    }
  }
  const keyResolver =
    dependencies.keyResolver ??
    createRemoteJWKSet(jwksUri, {
      timeoutDuration: config.timeoutMs ?? 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });

  return {
    async verifyAuthorization(authorization) {
      const token = bearerToken(authorization);
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, keyResolver, {
          issuer,
          audience,
          algorithms,
        }));
      } catch (error) {
        if (error instanceof OidcAuthenticationError) throw error;
        if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
          throw new OidcAuthenticationError(
            'OIDC_VERIFIER_UNAVAILABLE',
            'OIDC 密钥服务当前不可用。',
          );
        }
        throw new OidcAuthenticationError('OIDC_TOKEN_INVALID', 'OIDC 访问令牌验证失败。');
      }

      if (
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0 ||
        typeof payload.exp !== 'number'
      ) {
        throw new OidcAuthenticationError(
          'OIDC_TOKEN_INVALID',
          'OIDC 访问令牌缺少 subject 或到期时间。',
        );
      }
      return {
        subject: payload.sub,
        issuer,
        audiences: audiences(payload),
        issuedAt: payload.iat ?? null,
        expiresAt: payload.exp,
        authorization:
          config.authorization === undefined
            ? null
            : authorizationClaims(payload, config.authorization),
      };
    },
  };
}
