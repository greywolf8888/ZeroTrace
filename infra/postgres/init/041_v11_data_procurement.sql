BEGIN;

CREATE TABLE IF NOT EXISTS data_procurement_ledgers (
  scope_id text PRIMARY KEY CHECK (scope_id ~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'),
  policy jsonb NOT NULL,
  state jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state ->> 'revision')::bigint = revision),
  CHECK (jsonb_typeof(policy) = 'object'),
  CHECK (jsonb_typeof(state) = 'object')
);

INSERT INTO data_procurement_ledgers (scope_id, policy, state, revision)
VALUES (
  'global',
  '{"version":"data-policy-v11.0","paidAllowed":false,"approvedProviderIds":[]}'::jsonb,
  '{"revision":0,"remainingMicrousd":"0","accounts":{},"tickets":{},"blocked":false}'::jsonb,
  0
)
ON CONFLICT (scope_id) DO NOTHING;

CREATE OR REPLACE FUNCTION reject_data_procurement_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'data procurement ledgers cannot be deleted';
END;
$$;

DROP TRIGGER IF EXISTS data_procurement_no_delete ON data_procurement_ledgers;
CREATE TRIGGER data_procurement_no_delete
BEFORE DELETE ON data_procurement_ledgers
FOR EACH ROW EXECUTE FUNCTION reject_data_procurement_delete();

INSERT INTO schema_migrations(version) VALUES ('041_v11_data_procurement')
ON CONFLICT (version) DO NOTHING;

COMMIT;
