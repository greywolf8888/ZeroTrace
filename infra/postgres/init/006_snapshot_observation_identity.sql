\set ON_ERROR_STOP on

BEGIN;

-- A Snapshot records when an observation was captured, not only which chain
-- anchor it describes. Re-reading the same immutable anchor at a later time is
-- a distinct replayable observation and must not collide with the earlier row.
ALTER TABLE analysis_snapshots
  DROP CONSTRAINT IF EXISTS analysis_snapshots_ledger_chain_id_block_or_slot_block_hash_key;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analysis_snapshots_observation_identity_key'
      AND conrelid = 'analysis_snapshots'::regclass
  ) THEN
    ALTER TABLE analysis_snapshots
      ADD CONSTRAINT analysis_snapshots_observation_identity_key
      UNIQUE (ledger, chain_id, block_or_slot, block_hash, config_hash, captured_at);
  END IF;
END
$migration$;

INSERT INTO schema_migrations(version)
VALUES ('006_snapshot_observation_identity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
