import { productionAuthConfigured } from '@zerotrace/platform-auth';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';

export async function registerPlatformSecurity(
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    if (config.environment !== 'production') return;
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
