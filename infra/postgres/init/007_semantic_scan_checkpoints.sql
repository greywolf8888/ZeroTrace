\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS semantic_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type text NOT NULL,
  source text NOT NULL,
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL,
  subject text NOT NULL,
  from_block numeric(30, 0) NOT NULL CHECK (from_block >= 0),
  to_block numeric(30, 0) NOT NULL CHECK (to_block >= from_block),
  chunk_size integer NOT NULL CHECK (chunk_size > 0),
  identity_hash char(64) NOT NULL CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  identity jsonb NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'REQUESTED_RANGE_COMPLETE')),
  next_block numeric(30, 0) NOT NULL CHECK (next_block >= from_block),
  state_hash char(64) NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  state jsonb NOT NULL,
  evidence_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) <= 160),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT semantic_scan_runs_identity_key UNIQUE (
    scan_type,
    source,
    ledger,
    chain_id,
    subject,
    from_block,
    to_block,
    chunk_size,
    identity_hash
  ),
  CHECK (next_block <= to_block + 1),
  CHECK (
    (status = 'RUNNING' AND completed_at IS NULL)
    OR (status = 'REQUESTED_RANGE_COMPLETE' AND completed_at IS NOT NULL)
  ),
  CHECK (status <> 'REQUESTED_RANGE_COMPLETE' OR next_block = to_block + 1)
);

CREATE INDEX IF NOT EXISTS semantic_scan_runs_status_idx
  ON semantic_scan_runs (status, updated_at);
CREATE INDEX IF NOT EXISTS semantic_scan_runs_subject_idx
  ON semantic_scan_runs (scan_type, chain_id, subject, next_block);

CREATE OR REPLACE FUNCTION guard_semantic_scan_run_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.scan_type <> OLD.scan_type
    OR NEW.source <> OLD.source
    OR NEW.ledger <> OLD.ledger
    OR NEW.chain_id <> OLD.chain_id
    OR NEW.subject <> OLD.subject
    OR NEW.from_block <> OLD.from_block
    OR NEW.to_block <> OLD.to_block
    OR NEW.chunk_size <> OLD.chunk_size
    OR NEW.identity_hash <> OLD.identity_hash
    OR NEW.identity <> OLD.identity
    OR NEW.started_at <> OLD.started_at
  THEN
    RAISE EXCEPTION 'Semantic scan identity is immutable';
  END IF;

  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Completed semantic scans are immutable';
  END IF;
  IF NEW.next_block < OLD.next_block THEN
    RAISE EXCEPTION 'Semantic scan cursor may not move backwards';
  END IF;
  IF NEW.next_block > OLD.next_block + OLD.chunk_size THEN
    RAISE EXCEPTION 'Semantic scan cursor may not exceed one bounded chunk';
  END IF;
  IF NOT OLD.evidence_ids <@ NEW.evidence_ids THEN
    RAISE EXCEPTION 'Semantic scan Evidence IDs may not be removed';
  END IF;
  IF NEW.next_block = OLD.next_block
    AND (
      NEW.state_hash <> OLD.state_hash
      OR NEW.state <> OLD.state
      OR NEW.evidence_ids <> OLD.evidence_ids
    )
  THEN
    RAISE EXCEPTION 'Semantic scan state may change only with a forward cursor';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS semantic_scan_run_update_guard ON semantic_scan_runs;
CREATE TRIGGER semantic_scan_run_update_guard
BEFORE UPDATE ON semantic_scan_runs
FOR EACH ROW EXECUTE FUNCTION guard_semantic_scan_run_update();

CREATE OR REPLACE FUNCTION reject_semantic_scan_run_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'semantic_scan_runs is append-preserving; deletion is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS semantic_scan_run_delete_guard ON semantic_scan_runs;
CREATE TRIGGER semantic_scan_run_delete_guard
BEFORE DELETE ON semantic_scan_runs
FOR EACH ROW EXECUTE FUNCTION reject_semantic_scan_run_delete();

INSERT INTO schema_migrations(version)
VALUES ('007_semantic_scan_checkpoints')
ON CONFLICT (version) DO NOTHING;

COMMIT;
