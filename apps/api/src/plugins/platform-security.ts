import { productionAuthConfigured } from '@zerotrace/platform-auth';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';

export async function registerPlatformSecurity(
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> {
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
    if (
      !productionAuthConfigured({
        NODE_ENV: 'production',
        ...(config.oidcIssuer === undefined ? {} : { OIDC_ISSUER: config.oidcIssuer }),
        ...(config.oidcAudience === undefined ? {} : { OIDC_AUDIENCE: config.oidcAudience }),
      })
    ) {
      return reply.code(503).send({
        error: {
          code: 'AUTH_NOT_CONFIGURED',
          message: '生产环境必须配置 OIDC Issuer 与 Audience，禁止开放匿名写。',
          retryable: false,
        },
      });
    }
  });
}
