\set ON_ERROR_STOP on

BEGIN;

CREATE INDEX IF NOT EXISTS subjects_identifier_idx
  ON subjects (normalized_identifier);
CREATE INDEX IF NOT EXISTS snapshots_chain_tip_idx
  ON analysis_snapshots (ledger, chain_id, block_or_slot DESC);
CREATE INDEX IF NOT EXISTS evidence_locator_idx
  ON evidence (ledger, chain_id, locator);
CREATE INDEX IF NOT EXISTS evidence_snapshot_idx
  ON evidence (snapshot_id);
CREATE INDEX IF NOT EXISTS evidence_payload_hash_idx
  ON evidence (payload_hash);
CREATE INDEX IF NOT EXISTS label_subject_time_idx
  ON label_observations (subject_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS entity_member_subject_idx
  ON entity_members (subject_id);
CREATE INDEX IF NOT EXISTS control_right_subject_idx
  ON control_rights (subject_id, right_type);
CREATE INDEX IF NOT EXISTS launches_asset_time_idx
  ON launches (asset_subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_health_time_idx
  ON provider_health_observations (provider_id, checked_at DESC);

INSERT INTO schema_migrations(version)
VALUES ('002_indexes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
