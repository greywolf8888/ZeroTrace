import {
  createOidcBearerVerifier,
  OidcAuthenticationError,
  productionAuthConfigured,
  productionResourceAuthConfigured,
  type Principal,
} from '@zerotrace/platform-auth';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    zerotracePrincipal: Principal | null;
  }
}

export type PlatformRouteAction = 'ANALYSIS_READ' | 'INVESTIGATION_WRITE' | 'ADMIN_OPERATION';

const readOnlyPostRoutes = [
  /^\/api\/v1\/query\/plan$/,
  /^\/api\/v1\/research\/social-query-plans$/,
  /^\/api\/v1\/rv\/constant-product$/,
  /^\/api\/v1\/rv\/flap-sell$/,
  /^\/api\/v1\/scenarios\/exit-race$/,
] as const;

const adminPostRoutes = [
  /^\/api\/v2\/jobs\/[^/]+\/(?:cancel|retry)$/,
  /^\/api\/v2\/analyst-decisions$/,
] as const;

export function classifyPlatformRoute(method: string, path: string): PlatformRouteAction | null {
  if (method === 'GET' && path.startsWith('/api/')) return 'ANALYSIS_READ';
  if (method === 'POST' && readOnlyPostRoutes.some((pattern) => pattern.test(path))) {
    return 'ANALYSIS_READ';
  }
  if (method === 'POST' && adminPostRoutes.some((pattern) => pattern.test(path))) {
    return 'ADMIN_OPERATION';
  }
  if (method === 'POST' && path.startsWith('/api/')) return 'INVESTIGATION_WRITE';
  return null;
}

export function authorizePlatformRoute(
  principal: Principal,
  action: PlatformRouteAction,
  deploymentTenantId: string,
): boolean {
  if (principal.tenantId !== deploymentTenantId) return false;
  if (principal.roles.includes('readonly') && principal.roles.length > 1) return false;
  if (action === 'ANALYSIS_READ') {
    return principal.roles.some((role) =>
      (['readonly', 'investigator', 'admin'] as const).includes(role),
    );
  }
  if (action === 'INVESTIGATION_WRITE') {
    return principal.roles.includes('investigator') || principal.roles.includes('admin');
  }
  return principal.roles.includes('admin') && principal.mfaSatisfied;
}

function resourceAuthConfigured(config: AppConfig): boolean {
  return productionResourceAuthConfigured({
    NODE_ENV: 'production',
    ...(config.oidcIssuer === undefined ? {} : { OIDC_ISSUER: config.oidcIssuer }),
    ...(config.oidcAudience === undefined ? {} : { OIDC_AUDIENCE: config.oidcAudience }),
    ...(config.oidcJwksUri === undefined ? {} : { OIDC_JWKS_URI: config.oidcJwksUri }),
    ...(config.oidcTenantClaim === undefined ? {} : { OIDC_TENANT_CLAIM: config.oidcTenantClaim }),
    ...(config.oidcRolesClaim === undefined ? {} : { OIDC_ROLES_CLAIM: config.oidcRolesClaim }),
    ...(config.tenantId === undefined ? {} : { ZEROTRACE_TENANT_ID: config.tenantId }),
  });
}

export async function registerPlatformSecurity(
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  app.decorateRequest('zerotracePrincipal', null);
  const oidcConfigured = productionAuthConfigured({
    NODE_ENV: 'production',
    ...(config.oidcIssuer === undefined ? {} : { OIDC_ISSUER: config.oidcIssuer }),
    ...(config.oidcAudience === undefined ? {} : { OIDC_AUDIENCE: config.oidcAudience }),
    ...(config.oidcJwksUri === undefined ? {} : { OIDC_JWKS_URI: config.oidcJwksUri }),
  });
  const resourceConfigured = resourceAuthConfigured(config);
  const oidcVerifier =
    oidcConfigured &&
    resourceConfigured &&
    config.oidcIssuer !== undefined &&
    config.oidcAudience !== undefined &&
    config.oidcJwksUri !== undefined &&
    config.tenantId !== undefined &&
    config.oidcTenantClaim !== undefined &&
    config.oidcRolesClaim !== undefined
      ? createOidcBearerVerifier({
          issuer: config.oidcIssuer,
          audience: config.oidcAudience,
          jwksUri: config.oidcJwksUri,
          authorization: {
            expectedTenantId: config.tenantId,
            tenantClaim: config.oidcTenantClaim,
            rolesClaim: config.oidcRolesClaim,
            ...(config.oidcMfaClaim === undefined ? {} : { mfaClaim: config.oidcMfaClaim }),
          },
        })
      : undefined;

  app.addHook('onRequest', async (request, reply) => {
    if (config.environment !== 'production') return;
    if (config.desktopAuthToken !== undefined) {
      const expected = Buffer.from(config.desktopAuthToken.reveal(), 'utf8');
      const providedHeader = request.headers['x-zerotrace-desktop-token'];
      const provided = Buffer.from(
        typeof providedHeader === 'string' ? providedHeader : '',
        'utf8',
      );
      const loopback =
        request.ip === '127.0.0.1' || request.ip === '::1' || request.ip === '::ffff:127.0.0.1';
      if (
        !loopback ||
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      ) {
        return reply.code(401).send({
          error: {
            code: 'DESKTOP_AUTH_REQUIRED',
            message: '本机桌面会话认证失败。',
            retryable: false,
          },
        });
      }
      request.zerotracePrincipal = {
        subject: 'local-desktop-session',
        roles: ['admin'],
        tenantId: config.tenantId ?? 'local-desktop',
        mfaSatisfied: true,
      };
      return;
    }
    const path = request.url.split('?')[0] ?? request.url;
    if (request.method === 'OPTIONS') return;
    if (path === '/health' || path === '/live' || path === '/ready' || path === '/metrics') return;
    if (!oidcConfigured) {
      return reply.code(503).send({
        error: {
          code: 'AUTH_NOT_CONFIGURED',
          message: '生产环境必须配置 OIDC Issuer、Audience 与 JWKS URI，禁止开放匿名访问。',
          retryable: false,
        },
      });
    }
    if (!resourceConfigured || oidcVerifier === undefined || config.tenantId === undefined) {
      return reply.code(503).send({
        error: {
          code: 'AUTHORIZATION_NOT_CONFIGURED',
          message:
            '生产环境必须显式配置部署租户、OIDC 租户 claim 与角色 claim；ZeroTrace 不猜测 IdP 字段。',
          retryable: false,
        },
      });
    }
    try {
      const verified = await oidcVerifier.verifyAuthorization(request.headers.authorization);
      if (verified.authorization === null) {
        throw new OidcAuthenticationError('OIDC_TOKEN_INVALID', 'OIDC 访问令牌缺少授权上下文。');
      }
      const principal: Principal = {
        subject: verified.subject,
        roles: verified.authorization.roles,
        tenantId: verified.authorization.tenantId,
        mfaSatisfied: verified.authorization.mfaSatisfied,
      };
      const action = classifyPlatformRoute(request.method, path);
      if (action === null || !authorizePlatformRoute(principal, action, config.tenantId)) {
        return reply.code(403).send({
          error: {
            code: 'RESOURCE_AUTHORIZATION_DENIED',
            message: '当前租户、角色或 MFA 上下文无权访问该资源。',
            retryable: false,
          },
        });
      }
      request.zerotracePrincipal = principal;
    } catch (error) {
      const known = error instanceof OidcAuthenticationError;
      const unavailable = known && error.code === 'OIDC_VERIFIER_UNAVAILABLE';
      return reply.code(unavailable ? 503 : 401).send({
        error: {
          code: known ? error.code : 'OIDC_TOKEN_INVALID',
          message: unavailable ? 'OIDC 密钥服务当前不可用。' : 'OIDC 访问令牌无效。',
          retryable: unavailable,
        },
      });
    }
  });
}
