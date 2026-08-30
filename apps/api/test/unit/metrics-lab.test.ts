import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerMetricsLabRoutes } from '../../src/plugins/metrics-lab.js';

describe('Metrics Lab catalog', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  async function app() {
    const instance = Fastify({ logger: false });
    apps.push(instance);
    await registerMetricsLabRoutes(instance);
    return instance;
  }

  it('exposes versioned Chinese definitions without enabling remote evaluation', async () => {
    const instance = await app();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/metrics-lab/catalog' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: 'metrics-catalog-v1.0.0',
      status: 'VERSIONED_REGISTRY_READY_EXECUTION_API_DISABLED',
    });
    const body = response.json<{
      definitions: Array<{ chineseName: string; basis: string }>;
      executionBoundary: string;
    }>();
    expect(body.definitions).toHaveLength(3);
    expect(body.definitions.every((definition) => definition.chineseName.length > 0)).toBe(true);
    expect(body.definitions.every((definition) => definition.basis === 'RAW')).toBe(true);
    expect(body.executionBoundary).toContain('不开放远程求值');
  });

  it('has no remote metric evaluation route', async () => {
    const instance = await app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/metrics-lab/evaluate',
      payload: { metricId: 'raw.transfer_count' },
    });

    expect(response.statusCode).toBe(404);
  });
});
