import {
  createOidcBearerVerifier,
  OidcAuthenticationError,
  productionAuthConfigured,
} from '@zerotrace/platform-auth';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';

export async function registerPlatformSecurity(
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  const oidcConfigured = productionAuthConfigured({
    NODE_ENV: 'production',
    ...(config.oidcIssuer === undefined ? {} : { OIDC_ISSUER: config.oidcIssuer }),
    ...(config.oidcAudience === undefined ? {} : { OIDC_AUDIENCE: config.oidcAudience }),
    ...(config.oidcJwksUri === undefined ? {} : { OIDC_JWKS_URI: config.oidcJwksUri }),
  });
  const oidcVerifier =
    oidcConfigured &&
    config.oidcIssuer !== undefined &&
    config.oidcAudience !== undefined &&
    config.oidcJwksUri !== undefined
      ? createOidcBearerVerifier({
          issuer: config.oidcIssuer,
          audience: config.oidcAudience,
          jwksUri: config.oidcJwksUri,
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
      return;
    }
    const path = request.url.split('?')[0] ?? request.url;
    if (path === '/health' || path === '/live' || path === '/ready' || path === '/metrics') {
      return;
    }
    if (oidcVerifier === undefined) {
      return reply.code(503).send({
        error: {
          code: 'AUTH_NOT_CONFIGURED',
          message: '生产环境必须配置 OIDC Issuer、Audience 与 JWKS URI，禁止开放匿名访问。',
          retryable: false,
        },
      });
    }
    try {
      await oidcVerifier.verifyAuthorization(request.headers.authorization);
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
