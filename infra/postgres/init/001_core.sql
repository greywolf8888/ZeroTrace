\set ON_ERROR_STOP on

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_kind') THEN
    CREATE TYPE ledger_kind AS ENUM ('EVM', 'BITCOIN', 'SOLANA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_state') THEN
    CREATE TYPE knowledge_state AS ENUM ('KNOWN', 'UNKNOWN', 'UNAVAILABLE');
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL,
  subject_type text NOT NULL,
  normalized_identifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ledger, chain_id, subject_type, normalized_identifier)
);

CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL,
  block_or_slot numeric(30, 0) NOT NULL CHECK (block_or_slot >= 0),
  block_hash text NOT NULL,
  commitment text,
  captured_at timestamptz NOT NULL,
  provider_versions jsonb NOT NULL,
  adapter_versions jsonb NOT NULL,
  platform_config_version text,
  entity_model_version text NOT NULL,
  simulation_version text,
  label_snapshot text NOT NULL,
  config_hash char(64) NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ledger, chain_id, block_or_slot, block_hash, config_hash)
);

CREATE TABLE IF NOT EXISTS evidence (
  id text PRIMARY KEY,
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL,
  evidence_kind text NOT NULL,
  source text NOT NULL,
  locator text NOT NULL,
  source_uri text,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  block_or_slot numeric(30, 0),
  finality text,
  summary text NOT NULL,
  raw_artifact_ref text,
  snapshot_id uuid REFERENCES analysis_snapshots(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_edges (
  derived_evidence_id text NOT NULL REFERENCES evidence(id),
  source_evidence_id text NOT NULL REFERENCES evidence(id),
  relation text NOT NULL DEFAULT 'DERIVED_FROM',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (derived_evidence_id, source_evidence_id),
  CHECK (derived_evidence_id <> source_evidence_id)
);

CREATE TABLE IF NOT EXISTS label_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id),
  source text NOT NULL,
  source_class text NOT NULL,
  label text NOT NULL,
  category text NOT NULL,
  actor_candidate text,
  source_confidence numeric(7, 6) NOT NULL CHECK (source_confidence BETWEEN 0 AND 1),
  evidence_id text NOT NULL REFERENCES evidence(id),
  observed_at timestamptz NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  deterministic boolean NOT NULL,
  license_policy text NOT NULL,
  raw_payload_hash char(64) NOT NULL CHECK (raw_payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classification text NOT NULL,
  confidence_state knowledge_state NOT NULL,
  confidence numeric(7, 6) CHECK (confidence BETWEEN 0 AND 1),
  model_version text NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES analysis_snapshots(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (confidence_state = 'KNOWN' AND confidence IS NOT NULL)
    OR (confidence_state <> 'KNOWN' AND confidence IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS entity_members (
  entity_id uuid NOT NULL REFERENCES entities(id),
  subject_id uuid NOT NULL REFERENCES subjects(id),
  membership_class text NOT NULL,
  probability_state knowledge_state NOT NULL,
  probability numeric(7, 6) CHECK (probability BETWEEN 0 AND 1),
  evidence_ids text[] NOT NULL,
  PRIMARY KEY (entity_id, subject_id),
  CHECK (
    (probability_state = 'KNOWN' AND probability IS NOT NULL)
    OR (probability_state <> 'KNOWN' AND probability IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS control_rights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id),
  controller_subject_id uuid NOT NULL REFERENCES subjects(id),
  right_type text NOT NULL,
  scope jsonb NOT NULL,
  threshold_state knowledge_state NOT NULL,
  threshold_value text,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_ids text[] NOT NULL,
  active_from timestamptz,
  active_to timestamptz,
  snapshot_id uuid NOT NULL REFERENCES analysis_snapshots(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (threshold_state = 'KNOWN' AND threshold_value IS NOT NULL)
    OR (threshold_state <> 'KNOWN' AND threshold_value IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  platform_version text,
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL,
  asset_subject_id uuid NOT NULL REFERENCES subjects(id),
  lifecycle text NOT NULL,
  mechanism_snapshot jsonb NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES analysis_snapshots(id),
  evidence_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_type text NOT NULL,
  engine_version text NOT NULL,
  seed bigint NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES analysis_snapshots(id),
  inputs jsonb NOT NULL,
  outputs jsonb NOT NULL,
  evidence_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_health_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id text NOT NULL,
  ledger ledger_kind NOT NULL,
  status text NOT NULL,
  head_state knowledge_state NOT NULL,
  head_value text,
  latency_ms integer CHECK (latency_ms >= 0),
  error_code text,
  checked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (head_state = 'KNOWN' AND head_value IS NOT NULL)
    OR (head_state <> 'KNOWN' AND head_value IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS analyst_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid REFERENCES subjects(id),
  entity_id uuid REFERENCES entities(id),
  action text NOT NULL,
  author text NOT NULL,
  reason text NOT NULL,
  previous_value jsonb,
  new_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (subject_id IS NOT NULL OR entity_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only; mutation is forbidden', TG_TABLE_NAME;
END
$function$;

DROP TRIGGER IF EXISTS evidence_append_only ON evidence;
CREATE TRIGGER evidence_append_only
BEFORE UPDATE OR DELETE ON evidence
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

DROP TRIGGER IF EXISTS label_observation_append_only ON label_observations;
CREATE TRIGGER label_observation_append_only
BEFORE UPDATE OR DELETE ON label_observations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

DROP TRIGGER IF EXISTS snapshot_append_only ON analysis_snapshots;
CREATE TRIGGER snapshot_append_only
BEFORE UPDATE OR DELETE ON analysis_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

DROP TRIGGER IF EXISTS analyst_override_append_only ON analyst_overrides;
CREATE TRIGGER analyst_override_append_only
BEFORE UPDATE OR DELETE ON analyst_overrides
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

INSERT INTO schema_migrations(version)
VALUES ('001_core')
ON CONFLICT (version) DO NOTHING;

COMMIT;
