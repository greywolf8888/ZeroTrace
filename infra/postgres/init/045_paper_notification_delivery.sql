\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS paper_notification_delivery_state (
  outbox_id text NOT NULL REFERENCES paper_notification_outbox(id) ON DELETE RESTRICT,
  experiment_id text NOT NULL REFERENCES paper_experiments(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'DESKTOP')),
  state text NOT NULL CHECK (state IN ('PENDING', 'LEASED', 'DELIVERED', 'DISPATCHED')),
  attempt_count bigint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token_hash text CHECK (lease_token_hash IS NULL OR lease_token_hash ~ '^[0-9a-f]{64}$'),
  lease_owner_hash text CHECK (lease_owner_hash IS NULL OR lease_owner_hash ~ '^[0-9a-f]{64}$'),
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  delivered_at timestamptz,
  dispatched_at timestamptz,
  read_at timestamptz,
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (outbox_id, channel),
  CHECK (
    (state = 'LEASED' AND lease_token_hash IS NOT NULL AND lease_owner_hash IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'LEASED' AND lease_token_hash IS NULL AND lease_owner_hash IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK (channel <> 'IN_APP' OR state = 'DELIVERED'),
  CHECK (channel <> 'IN_APP' OR delivered_at IS NOT NULL),
  CHECK (channel = 'IN_APP' OR delivered_at IS NULL),
  CHECK (channel = 'IN_APP' OR read_at IS NULL),
  CHECK (channel <> 'DESKTOP' OR state <> 'DELIVERED'),
  CHECK ((state = 'DISPATCHED') = (dispatched_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS paper_notification_delivery_claim_idx
  ON paper_notification_delivery_state (
    experiment_id,
    channel,
    state,
    next_attempt_at ASC,
    lease_expires_at ASC,
    outbox_id ASC
  );

CREATE TABLE IF NOT EXISTS paper_notification_delivery_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outbox_id text NOT NULL,
  channel text NOT NULL,
  experiment_id text NOT NULL REFERENCES paper_experiments(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN (
      'GENERATED',
      'DELIVERED',
      'CLAIMED',
      'DISPATCHED',
      'DELIVERY_FAILED',
      'LEASE_EXPIRED',
      'READ'
    )
  ),
  attempt_number bigint NOT NULL CHECK (attempt_number >= 0),
  lease_token_hash text CHECK (lease_token_hash IS NULL OR lease_token_hash ~ '^[0-9a-f]{64}$'),
  actor_hash text CHECK (actor_hash IS NULL OR actor_hash ~ '^[0-9a-f]{64}$'),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  event_at timestamptz NOT NULL,
  FOREIGN KEY (outbox_id, channel)
    REFERENCES paper_notification_delivery_state(outbox_id, channel)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS paper_notification_delivery_events_lookup_idx
  ON paper_notification_delivery_events (
    outbox_id,
    channel,
    lease_token_hash,
    event_at ASC,
    id ASC
  );

CREATE OR REPLACE FUNCTION create_paper_notification_delivery_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO paper_notification_delivery_state (
    outbox_id, experiment_id, channel, state, attempt_count, next_attempt_at,
    delivered_at, created_at, updated_at
  ) VALUES
    (NEW.id, NEW.experiment_id, 'IN_APP', 'DELIVERED', 0, NEW.created_at,
      NEW.created_at, NEW.created_at, NEW.created_at),
    (NEW.id, NEW.experiment_id, 'DESKTOP', 'PENDING', 0, NEW.created_at,
      NULL, NEW.created_at, NEW.created_at);

  INSERT INTO paper_notification_delivery_events (
    outbox_id, channel, experiment_id, event_type, attempt_number, event_at
  ) VALUES
    (NEW.id, 'IN_APP', NEW.experiment_id, 'GENERATED', 0, NEW.created_at),
    (NEW.id, 'IN_APP', NEW.experiment_id, 'DELIVERED', 0, NEW.created_at),
    (NEW.id, 'DESKTOP', NEW.experiment_id, 'GENERATED', 0, NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paper_notification_delivery_create ON paper_notification_outbox;
CREATE TRIGGER paper_notification_delivery_create
AFTER INSERT ON paper_notification_outbox
FOR EACH ROW EXECUTE FUNCTION create_paper_notification_delivery_state();

INSERT INTO paper_notification_delivery_state (
  outbox_id, experiment_id, channel, state, attempt_count, next_attempt_at,
  delivered_at, created_at, updated_at
)
SELECT id, experiment_id, 'IN_APP', 'DELIVERED', 0, created_at,
       created_at, created_at, created_at
FROM paper_notification_outbox
ON CONFLICT (outbox_id, channel) DO NOTHING;

INSERT INTO paper_notification_delivery_state (
  outbox_id, experiment_id, channel, state, attempt_count, next_attempt_at,
  created_at, updated_at
)
SELECT id, experiment_id, 'DESKTOP', 'PENDING', 0, created_at, created_at, created_at
FROM paper_notification_outbox
ON CONFLICT (outbox_id, channel) DO NOTHING;

INSERT INTO paper_notification_delivery_events (
  outbox_id, channel, experiment_id, event_type, attempt_number, event_at
)
SELECT state.outbox_id, state.channel, state.experiment_id, 'GENERATED', 0, state.created_at
FROM paper_notification_delivery_state AS state
WHERE NOT EXISTS (
  SELECT 1 FROM paper_notification_delivery_events AS event
  WHERE event.outbox_id = state.outbox_id
    AND event.channel = state.channel
    AND event.event_type = 'GENERATED'
);

INSERT INTO paper_notification_delivery_events (
  outbox_id, channel, experiment_id, event_type, attempt_number, event_at
)
SELECT state.outbox_id, state.channel, state.experiment_id, 'DELIVERED', 0, state.delivered_at
FROM paper_notification_delivery_state AS state
WHERE state.channel = 'IN_APP'
  AND state.delivered_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM paper_notification_delivery_events AS event
    WHERE event.outbox_id = state.outbox_id
      AND event.channel = state.channel
      AND event.event_type = 'DELIVERED'
  );

CREATE OR REPLACE FUNCTION reject_paper_delivery_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'paper notification delivery state cannot be deleted';
END;
$$;

DROP TRIGGER IF EXISTS paper_notification_delivery_no_delete ON paper_notification_delivery_state;
CREATE TRIGGER paper_notification_delivery_no_delete
BEFORE DELETE ON paper_notification_delivery_state
FOR EACH ROW EXECUTE FUNCTION reject_paper_delivery_delete();

DROP TRIGGER IF EXISTS paper_notification_events_append_only ON paper_notification_delivery_events;
CREATE TRIGGER paper_notification_events_append_only
BEFORE UPDATE OR DELETE ON paper_notification_delivery_events
FOR EACH ROW EXECUTE FUNCTION reject_paper_audit_mutation();

INSERT INTO schema_migrations(version) VALUES ('045_paper_notification_delivery')
ON CONFLICT (version) DO NOTHING;

COMMIT;
