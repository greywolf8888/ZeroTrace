BEGIN;

CREATE TABLE IF NOT EXISTS social_observation_windows (
  window_id text PRIMARY KEY CHECK (window_id ~ '^sow_[0-9a-f]{24}$'),
  ledger text NOT NULL CHECK (ledger IN ('EVM', 'SOLANA')),
  chain_id text NOT NULL,
  asset_key text NOT NULL,
  query_role text NOT NULL,
  approved_query text NOT NULL,
  provider_id text NOT NULL,
  query_version text NOT NULL,
  contract_version text NOT NULL,
  temporal_contract jsonb NOT NULL
    CHECK (jsonb_typeof(temporal_contract) = 'object')
    CHECK (temporal_contract ?& ARRAY[
      'sinceParameter', 'untilParameter', 'precision', 'untilMode', 'overlapSeconds'
    ])
    CHECK ((temporal_contract - ARRAY[
      'sinceParameter', 'untilParameter', 'precision', 'untilMode', 'overlapSeconds'
    ]) = '{}'::jsonb)
    CHECK ((temporal_contract->>'sinceParameter') ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$')
    CHECK ((temporal_contract->>'untilParameter') ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$')
    CHECK ((temporal_contract->>'sinceParameter') <> (temporal_contract->>'untilParameter'))
    CHECK ((temporal_contract->>'precision') IN ('INSTANT', 'UTC_DATE'))
    CHECK ((temporal_contract->>'untilMode') IN ('EXCLUSIVE', 'INCLUSIVE'))
    CHECK (jsonb_typeof(temporal_contract->'overlapSeconds') = 'number')
    CHECK (((temporal_contract->>'overlapSeconds')::numeric % 1) = 0)
    CHECK (((temporal_contract->>'overlapSeconds')::numeric) BETWEEN 0 AND 604800),
  content_policy_version text NOT NULL,
  rights_evidence_ids text[] NOT NULL CHECK (cardinality(rights_evidence_ids) > 0),
  from_at timestamptz NOT NULL,
  until_at timestamptz NOT NULL,
  page_size integer NOT NULL CHECK (page_size BETWEEN 1 AND 1000),
  cursor text,
  completed boolean NOT NULL DEFAULT false,
  pages integer NOT NULL DEFAULT 0 CHECK (pages >= 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  used_cursors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(used_cursors) = 'array'),
  receipt_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(receipt_ids) = 'array'),
  receipt_signatures jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(receipt_signatures) = 'array'),
  coverage text NOT NULL DEFAULT 'NOT_COMPLETE'
    CHECK (coverage IN ('NOT_COMPLETE', 'ACCESSIBLE_QUERY_RESULTS_PROCESSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_at < until_at),
  CHECK ((completed AND coverage = 'ACCESSIBLE_QUERY_RESULTS_PROCESSED') OR
         (NOT completed AND coverage = 'NOT_COMPLETE'))
);

CREATE TABLE IF NOT EXISTS social_observation_page_receipts (
  receipt_id text PRIMARY KEY CHECK (receipt_id ~ '^sor_[0-9a-f]{24}$'),
  window_id text NOT NULL REFERENCES social_observation_windows(window_id),
  page_revision bigint NOT NULL CHECK (page_revision >= 0),
  receipt_signature char(64) NOT NULL CHECK (receipt_signature ~ '^[0-9a-f]{64}$'),
  requested_cursor text,
  next_cursor text,
  records_persisted integer NOT NULL CHECK (records_persisted >= 0),
  records_rejected integer NOT NULL CHECK (records_rejected >= 0),
  normalized_page_hash char(64) NOT NULL CHECK (normalized_page_hash ~ '^[0-9a-f]{64}$'),
  evidence_ids text[] NOT NULL,
  procurement_request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_id, page_revision),
  UNIQUE (procurement_request_id)
);

CREATE TABLE IF NOT EXISTS social_observations (
  source_id text NOT NULL,
  post_id text NOT NULL CHECK (post_id ~ '^[1-9][0-9]{0,24}$'),
  ledger text NOT NULL CHECK (ledger IN ('EVM', 'SOLANA')),
  chain_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('ACTIVE', 'TOMBSTONED')),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  policy_version text NOT NULL,
  contract_version text NOT NULL,
  evidence_id text NOT NULL REFERENCES evidence(id) CHECK (evidence_id ~ '^ev_[0-9a-f]{24}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, post_id),
  CHECK (first_observed_at <= last_observed_at),
  CHECK (state <> 'TOMBSTONED' OR NOT (payload ? 'text'))
);

CREATE TABLE IF NOT EXISTS social_observation_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^soe_[0-9a-f]{24}$'),
  source_id text NOT NULL,
  post_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('OBSERVED', 'EDITED', 'TOMBSTONED')),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  evidence_id text NOT NULL REFERENCES evidence(id) CHECK (evidence_id ~ '^ev_[0-9a-f]{24}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (payload ? 'text')),
  FOREIGN KEY (source_id, post_id) REFERENCES social_observations(source_id, post_id)
);

CREATE INDEX IF NOT EXISTS social_observation_windows_pending_idx
ON social_observation_windows(updated_at, window_id)
WHERE completed = false;

CREATE INDEX IF NOT EXISTS social_observations_chain_idx
ON social_observations(ledger, chain_id, last_observed_at DESC, source_id, post_id);

CREATE OR REPLACE FUNCTION validate_social_evidence_arrays()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'social_observation_windows' THEN
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.rights_evidence_ids) AS ids(evidence_id)
      WHERE NOT EXISTS (SELECT 1 FROM evidence WHERE id = ids.evidence_id)
    ) THEN
      RAISE EXCEPTION 'social observation rights Evidence is incomplete';
    END IF;
  ELSIF TG_TABLE_NAME = 'social_observation_page_receipts' THEN
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.evidence_ids) AS ids(evidence_id)
      WHERE NOT EXISTS (SELECT 1 FROM evidence WHERE id = ids.evidence_id)
    ) THEN
      RAISE EXCEPTION 'social observation page Evidence is incomplete';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_window_evidence_guard ON social_observation_windows;
CREATE TRIGGER social_window_evidence_guard
BEFORE INSERT ON social_observation_windows
FOR EACH ROW EXECUTE FUNCTION validate_social_evidence_arrays();

DROP TRIGGER IF EXISTS social_receipt_evidence_guard ON social_observation_page_receipts;
CREATE TRIGGER social_receipt_evidence_guard
BEFORE INSERT ON social_observation_page_receipts
FOR EACH ROW EXECUTE FUNCTION validate_social_evidence_arrays();

CREATE OR REPLACE FUNCTION guard_social_observation_window_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.completed THEN
    RAISE EXCEPTION 'completed social observation windows are immutable';
  END IF;
  IF NEW.window_id <> OLD.window_id OR NEW.ledger <> OLD.ledger OR NEW.chain_id <> OLD.chain_id OR
     NEW.asset_key <> OLD.asset_key OR NEW.query_role <> OLD.query_role OR
     NEW.approved_query <> OLD.approved_query OR NEW.provider_id <> OLD.provider_id OR
     NEW.query_version <> OLD.query_version OR NEW.contract_version <> OLD.contract_version OR
     NEW.temporal_contract <> OLD.temporal_contract OR
     NEW.content_policy_version <> OLD.content_policy_version OR
     NEW.rights_evidence_ids <> OLD.rights_evidence_ids OR NEW.from_at <> OLD.from_at OR
     NEW.until_at <> OLD.until_at OR NEW.page_size <> OLD.page_size OR
     NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'social observation window identity is immutable';
  END IF;
  IF NEW.revision <> OLD.revision + 1 OR NEW.pages <> OLD.pages + 1 THEN
    RAISE EXCEPTION 'social observation window must advance exactly one page and revision';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_observation_window_update_guard ON social_observation_windows;
CREATE TRIGGER social_observation_window_update_guard
BEFORE UPDATE ON social_observation_windows
FOR EACH ROW EXECUTE FUNCTION guard_social_observation_window_update();

CREATE OR REPLACE FUNCTION reject_social_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS social_receipt_update_guard ON social_observation_page_receipts;
CREATE TRIGGER social_receipt_update_guard
BEFORE UPDATE OR DELETE ON social_observation_page_receipts
FOR EACH ROW EXECUTE FUNCTION reject_social_append_only_mutation();

DROP TRIGGER IF EXISTS social_event_update_guard ON social_observation_events;
CREATE TRIGGER social_event_update_guard
BEFORE UPDATE OR DELETE ON social_observation_events
FOR EACH ROW EXECUTE FUNCTION reject_social_append_only_mutation();

CREATE OR REPLACE FUNCTION guard_social_observation_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_id <> OLD.source_id OR NEW.post_id <> OLD.post_id OR NEW.ledger <> OLD.ledger OR
     NEW.chain_id <> OLD.chain_id OR NEW.first_observed_at <> OLD.first_observed_at OR
     NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'social observation identity is immutable and revision must advance once';
  END IF;
  IF OLD.state = 'TOMBSTONED' THEN
    RAISE EXCEPTION 'tombstoned social observations cannot be restored';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_observation_update_guard ON social_observations;
CREATE TRIGGER social_observation_update_guard
BEFORE UPDATE ON social_observations
FOR EACH ROW EXECUTE FUNCTION guard_social_observation_update();

INSERT INTO schema_migrations(version) VALUES ('046_social_observation_windows')
ON CONFLICT (version) DO NOTHING;

COMMIT;
