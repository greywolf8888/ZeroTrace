import { describe, expect, it } from 'vitest';

import { createReadOnlyQueryPolicy, guardReadOnlyQuery, QuerySecurityError } from './index.js';

function policy() {
  return createReadOnlyQueryPolicy({
    allowedRelations: ['curated.transfers', 'research.entity_metrics'],
    allowedFunctions: ['count', 'sum', 'coalesce'],
  });
}

describe('query security', () => {
  it('admits one bounded, parameterized curated SELECT', () => {
    const admitted = guardReadOnlyQuery(
      'select asset_id, count(*) from curated.transfers where known_at <= $1 group by asset_id limit 200 offset 2',
      policy(),
    );
    expect(admitted).toMatchObject({
      relations: ['curated.transfers'],
      functions: ['count'],
      parameterCount: 1,
      rowLimit: 200,
      offset: 2,
      readOnlyTransactionRequired: true,
      fileAccessAllowed: false,
      networkAccessAllowed: false,
    });
  });

  it('rejects mutations, multiple statements, locks, unsafe relations and unbounded reads', () => {
    for (const sql of [
      'delete from curated.transfers',
      'select * from curated.transfers limit 1; select * from curated.transfers limit 1',
      'select * from curated.transfers limit 1 for update skip locked',
      'select * into temporary leak from curated.transfers limit 1',
      'select * from pg_catalog.pg_tables limit 1',
      'select * from curated.transfers',
      'with x as (select * from curated.transfers) select * from x limit 1',
    ]) {
      expect(() => guardReadOnlyQuery(sql, policy()), sql).toThrow(QuerySecurityError);
    }
  });

  it('rejects table functions, volatile functions, current context and dynamic limits', () => {
    for (const sql of [
      "select * from read_csv_auto('secrets.csv') limit 1",
      'select pg_sleep(10) from curated.transfers limit 1',
      'select current_user from curated.transfers limit 1',
      'select observed_at::text from curated.transfers limit 1',
      'select * from curated.transfers limit $1',
      'select * from curated.transfers limit 10001',
      'select * from curated.transfers where known_at <= $2 limit 1',
    ]) {
      expect(() => guardReadOnlyQuery(sql, policy()), sql).toThrow(QuerySecurityError);
    }
  });

  it('rejects system relations at policy construction', () => {
    expect(() =>
      createReadOnlyQueryPolicy({
        allowedRelations: ['pg_catalog.pg_tables'],
        allowedFunctions: ['count'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'UNSAFE_POLICY' }));
  });
});
