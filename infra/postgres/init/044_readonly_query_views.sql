\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS curated;
REVOKE CREATE ON SCHEMA curated FROM PUBLIC;

CREATE OR REPLACE VIEW curated.evidence_index
WITH (security_barrier = true)
AS
SELECT
  id,
  ledger::text AS ledger,
  chain_id,
  evidence_kind,
  source,
  observed_at,
  block_or_slot,
  finality,
  summary,
  snapshot_id,
  created_at
FROM public.evidence;

CREATE OR REPLACE VIEW curated.analysis_snapshot_index
WITH (security_barrier = true)
AS
SELECT
  id,
  ledger::text AS ledger,
  chain_id,
  block_or_slot,
  block_hash,
  commitment,
  captured_at,
  entity_model_version,
  simulation_version,
  label_snapshot,
  config_hash,
  created_at
FROM public.analysis_snapshots;

REVOKE ALL ON curated.evidence_index FROM PUBLIC;
REVOKE ALL ON curated.analysis_snapshot_index FROM PUBLIC;

INSERT INTO schema_migrations(version)
VALUES ('044_readonly_query_views')
ON CONFLICT (version) DO NOTHING;

COMMIT;
