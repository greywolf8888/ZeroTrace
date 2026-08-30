import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerApiErrorHandler } from '../../src/http/error-handler.js';
import { registerQueryLabRoutes } from '../../src/plugins/query-lab.js';

describe('query lab planning routes', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function app() {
    const instance = Fastify({ logger: false });
    apps.push(instance);
    registerApiErrorHandler(instance);
    await registerQueryLabRoutes(instance);
    return instance;
  }

  it('publishes a versioned curated catalog without enabling execution', async () => {
    const instance = await app();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/query/catalog' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: 'query-catalog-v1.0.0',
      status: 'PLAN_ONLY_EXECUTION_DISABLED',
    });
    expect(response.json().relations).toHaveLength(2);
  });

  it('returns a bounded AST admission but no result', async () => {
    const instance = await app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/query/plan',
      payload: {
        sql: 'select ledger, count(*) from curated.evidence_index where observed_at <= $1 group by ledger limit 100',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      executionStatus: 'DISABLED',
      admission: {
        relations: ['curated.evidence_index'],
        parameterCount: 1,
        rowLimit: 100,
        readOnlyTransactionRequired: true,
        fileAccessAllowed: false,
        networkAccessAllowed: false,
      },
    });
    expect(response.json()).not.toHaveProperty('rows');
  });

  it('rejects write syntax, system tables and extra secret-shaped input', async () => {
    const instance = await app();
    for (const payload of [
      { sql: 'delete from evidence' },
      { sql: 'select * from pg_catalog.pg_tables limit 1' },
      { sql: 'select * from curated.evidence_index limit 1', privateKey: 'forbidden' },
    ]) {
      const response = await instance.inject({
        method: 'POST',
        url: '/api/v1/query/plan',
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});
