\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  dataset text NOT NULL,
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL,
  from_block numeric(30, 0) NOT NULL CHECK (from_block >= 0),
  to_block numeric(30, 0) NOT NULL CHECK (to_block >= from_block),
  query_hash char(64) NOT NULL CHECK (query_hash ~ '^[0-9a-f]{64}$'),
  query jsonb NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'REQUESTED_RANGE_COMPLETE', 'SOURCE_HEAD_REACHED')),
  next_block numeric(30, 0) NOT NULL CHECK (next_block >= from_block),
  last_block numeric(30, 0),
  last_error_code text,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (source, dataset, from_block, to_block, query_hash),
  CHECK (next_block <= to_block + 1),
  CHECK (last_block IS NULL OR (last_block >= from_block AND last_block <= to_block)),
  CHECK (last_block IS NULL OR next_block >= last_block + 1),
  CHECK (
    (status = 'RUNNING' AND completed_at IS NULL)
    OR (status <> 'RUNNING' AND completed_at IS NOT NULL)
  ),
  CHECK (status <> 'REQUESTED_RANGE_COMPLETE' OR next_block = to_block + 1)
);

CREATE INDEX IF NOT EXISTS ingestion_runs_status_idx
  ON ingestion_runs (status, updated_at);
CREATE INDEX IF NOT EXISTS ingestion_runs_dataset_cursor_idx
  ON ingestion_runs (dataset, next_block);

CREATE OR REPLACE FUNCTION guard_ingestion_run_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.source <> OLD.source
    OR NEW.dataset <> OLD.dataset
    OR NEW.ledger <> OLD.ledger
    OR NEW.chain_id <> OLD.chain_id
    OR NEW.from_block <> OLD.from_block
    OR NEW.to_block <> OLD.to_block
    OR NEW.query_hash <> OLD.query_hash
    OR NEW.query <> OLD.query
    OR NEW.started_at <> OLD.started_at
  THEN
    RAISE EXCEPTION 'Ingestion run identity is immutable';
  END IF;

  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Completed ingestion runs are immutable';
  END IF;
  IF NEW.next_block < OLD.next_block THEN
    RAISE EXCEPTION 'Ingestion cursor may not move backwards';
  END IF;
  IF OLD.last_block IS NOT NULL
    AND (NEW.last_block IS NULL OR NEW.last_block < OLD.last_block)
  THEN
    RAISE EXCEPTION 'Ingestion last block may not move backwards';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS ingestion_run_update_guard ON ingestion_runs;
CREATE TRIGGER ingestion_run_update_guard
BEFORE UPDATE ON ingestion_runs
FOR EACH ROW EXECUTE FUNCTION guard_ingestion_run_update();

CREATE OR REPLACE FUNCTION reject_ingestion_run_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'ingestion_runs is append-preserving; deletion is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS ingestion_run_delete_guard ON ingestion_runs;
CREATE TRIGGER ingestion_run_delete_guard
BEFORE DELETE ON ingestion_runs
FOR EACH ROW EXECUTE FUNCTION reject_ingestion_run_delete();

INSERT INTO schema_migrations(version)
VALUES ('004_ingestion_checkpoints')
ON CONFLICT (version) DO NOTHING;

COMMIT;
