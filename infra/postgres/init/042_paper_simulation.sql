BEGIN;

CREATE TABLE IF NOT EXISTS paper_experiments (
  id text PRIMARY KEY CHECK (id ~ '^pex_[0-9a-f]{24}$'),
  chain text NOT NULL CHECK (chain IN ('BSC', 'SOLANA')),
  initial_state jsonb NOT NULL,
  current_state jsonb NOT NULL,
  current_state_hash text NOT NULL CHECK (current_state_hash ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((current_state ->> 'id') = id),
  CHECK ((current_state ->> 'revision')::bigint = revision)
);

CREATE TABLE IF NOT EXISTS paper_experiment_commands (
  experiment_id text NOT NULL REFERENCES paper_experiments(id) ON DELETE RESTRICT,
  command_id text NOT NULL,
  ordinal bigint NOT NULL CHECK (ordinal > 0),
  command_hash text NOT NULL CHECK (command_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (experiment_id, command_id),
  UNIQUE (experiment_id, ordinal)
);

CREATE TABLE IF NOT EXISTS paper_experiment_events (
  id text PRIMARY KEY CHECK (id ~ '^pev_[0-9a-f]{24}$'),
  experiment_id text NOT NULL REFERENCES paper_experiments(id) ON DELETE RESTRICT,
  ordinal bigint NOT NULL CHECK (ordinal > 0),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (experiment_id, ordinal)
);

CREATE TABLE IF NOT EXISTS paper_notification_outbox (
  id text PRIMARY KEY CHECK (id ~ '^pob_[0-9a-f]{24}$'),
  experiment_id text NOT NULL REFERENCES paper_experiments(id) ON DELETE RESTRICT,
  business_key text NOT NULL,
  event_id text NOT NULL REFERENCES paper_experiment_events(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('NORMAL', 'URGENT')),
  delivery_state text NOT NULL CHECK (delivery_state = 'PENDING'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (experiment_id, business_key)
);

CREATE INDEX IF NOT EXISTS paper_notification_outbox_page_idx
  ON paper_notification_outbox (experiment_id, created_at ASC, id ASC);

CREATE OR REPLACE FUNCTION reject_paper_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'paper simulation audit rows are append-only';
END;
$$;

DROP TRIGGER IF EXISTS paper_experiments_no_delete ON paper_experiments;
CREATE TRIGGER paper_experiments_no_delete
BEFORE DELETE ON paper_experiments
FOR EACH ROW EXECUTE FUNCTION reject_paper_audit_mutation();

DROP TRIGGER IF EXISTS paper_commands_append_only ON paper_experiment_commands;
CREATE TRIGGER paper_commands_append_only
BEFORE UPDATE OR DELETE ON paper_experiment_commands
FOR EACH ROW EXECUTE FUNCTION reject_paper_audit_mutation();

DROP TRIGGER IF EXISTS paper_events_append_only ON paper_experiment_events;
CREATE TRIGGER paper_events_append_only
BEFORE UPDATE OR DELETE ON paper_experiment_events
FOR EACH ROW EXECUTE FUNCTION reject_paper_audit_mutation();

DROP TRIGGER IF EXISTS paper_outbox_append_only ON paper_notification_outbox;
CREATE TRIGGER paper_outbox_append_only
BEFORE UPDATE OR DELETE ON paper_notification_outbox
FOR EACH ROW EXECUTE FUNCTION reject_paper_audit_mutation();

INSERT INTO schema_migrations(version) VALUES ('042_paper_simulation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
