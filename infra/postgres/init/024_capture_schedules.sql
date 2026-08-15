\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS capture_schedules (
  id text PRIMARY KEY CHECK (id ~ '^cps_[0-9a-f]{24}$'),
  identity_hash char(64) NOT NULL UNIQUE CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  capture_kind text NOT NULL,
  operation text NOT NULL CHECK (operation = 'READ_ONLY_CAPTURE'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (chain_id <> ''),
  subject_type text NOT NULL CHECK (subject_type <> ''),
  normalized_identifier text NOT NULL CHECK (normalized_identifier <> ''),
  parameters jsonb NOT NULL,
  trigger jsonb NOT NULL CHECK (jsonb_typeof(trigger) = 'object'),
  retry_policy jsonb NOT NULL CHECK (jsonb_typeof(retry_policy) = 'object'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED')),
  next_run_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((status = 'ACTIVE') = (next_run_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS capture_schedules_due_idx
  ON capture_schedules (next_run_at, id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS capture_schedules_target_idx
  ON capture_schedules (ledger, chain_id, subject_type, normalized_identifier, capture_kind);

CREATE TABLE IF NOT EXISTS capture_runs (
  id text PRIMARY KEY CHECK (id ~ '^cpr_[0-9a-f]{24}$'),
  schedule_id text NOT NULL REFERENCES capture_schedules(id) ON DELETE RESTRICT,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('LEASED', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED_TERMINAL')),
  attempt integer NOT NULL CHECK (attempt > 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_token char(32) CHECK (lease_token IS NULL OR lease_token ~ '^[0-9a-f]{32}$'),
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  result jsonb,
  result_ref text,
  snapshot_id uuid REFERENCES analysis_snapshots(id) ON DELETE RESTRICT,
  terminal_evidence_id text REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[],
  source_set text[],
  model_version text,
  coverage numeric(7, 6) CHECK (coverage BETWEEN 0 AND 1),
  freshness timestamptz,
  confidence numeric(7, 6) CHECK (confidence BETWEEN 0 AND 1),
  failure jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (schedule_id, scheduled_for),
  CHECK (attempt <= max_attempts),
  CHECK (
    (status = 'LEASED'
      AND lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_started_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND lease_expires_at > lease_started_at)
    OR (status <> 'LEASED'
      AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_started_at IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (status = 'SUCCEEDED'
      AND result IS NOT NULL AND result_ref IS NOT NULL AND snapshot_id IS NOT NULL
      AND terminal_evidence_id IS NOT NULL AND evidence_ids IS NOT NULL
      AND source_set IS NOT NULL AND model_version IS NOT NULL AND coverage IS NOT NULL
      AND freshness IS NOT NULL AND confidence IS NOT NULL AND failure IS NULL
      AND completed_at IS NOT NULL)
    OR (status <> 'SUCCEEDED'
      AND result IS NULL AND result_ref IS NULL AND snapshot_id IS NULL
      AND terminal_evidence_id IS NULL AND evidence_ids IS NULL
      AND source_set IS NULL AND model_version IS NULL AND coverage IS NULL
      AND freshness IS NULL AND confidence IS NULL)
  ),
  CHECK (
    (status IN ('RETRY_WAIT', 'FAILED_TERMINAL') AND failure IS NOT NULL)
    OR (status NOT IN ('RETRY_WAIT', 'FAILED_TERMINAL') AND failure IS NULL)
  ),
  CHECK ((status IN ('SUCCEEDED', 'FAILED_TERMINAL')) = (completed_at IS NOT NULL)),
  CHECK (status <> 'RETRY_WAIT' OR attempt < max_attempts)
);

CREATE INDEX IF NOT EXISTS capture_runs_claim_idx
  ON capture_runs (available_at, scheduled_for, id)
  WHERE status = 'RETRY_WAIT';
CREATE INDEX IF NOT EXISTS capture_runs_expired_lease_idx
  ON capture_runs (lease_expires_at, id)
  WHERE status = 'LEASED';
CREATE INDEX IF NOT EXISTS capture_runs_schedule_idx
  ON capture_runs (schedule_id, scheduled_for DESC, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS capture_run_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id text NOT NULL REFERENCES capture_runs(id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt > 0),
  lease_owner text NOT NULL,
  lease_token char(32) NOT NULL CHECK (lease_token ~ '^[0-9a-f]{32}$'),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL CHECK (finished_at >= started_at),
  outcome text NOT NULL CHECK (
    outcome IN ('SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE', 'LEASE_EXPIRED')
  ),
  failure jsonb,
  evidence_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  UNIQUE (run_id, attempt),
  CHECK ((outcome = 'SUCCEEDED') = (failure IS NULL))
);

CREATE OR REPLACE FUNCTION validate_capture_schedule_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.definition ->> 'schemaVersion' IS DISTINCT FROM 'capture-schedule-v1'
    OR NEW.definition ->> 'id' IS DISTINCT FROM NEW.id
    OR NEW.definition ->> 'identityHash' IS DISTINCT FROM NEW.identity_hash
    OR NEW.definition ->> 'captureKind' IS DISTINCT FROM NEW.capture_kind
    OR NEW.definition ->> 'operation' IS DISTINCT FROM NEW.operation
    OR NEW.definition #>> '{target,ledger}' IS DISTINCT FROM NEW.ledger::text
    OR NEW.definition #>> '{target,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.definition #>> '{target,subjectType}' IS DISTINCT FROM NEW.subject_type
    OR NEW.definition #>> '{target,normalizedIdentifier}' IS DISTINCT FROM NEW.normalized_identifier
    OR NEW.definition -> 'parameters' IS DISTINCT FROM NEW.parameters
    OR NEW.definition -> 'trigger' IS DISTINCT FROM NEW.trigger
    OR NEW.definition -> 'retryPolicy' IS DISTINCT FROM NEW.retry_policy
    OR (NEW.definition ->> 'createdAt')::timestamptz IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Capture schedule conflicts with its immutable definition';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS capture_schedule_insert_guard ON capture_schedules;
CREATE TRIGGER capture_schedule_insert_guard
BEFORE INSERT ON capture_schedules
FOR EACH ROW EXECUTE FUNCTION validate_capture_schedule_insert();

CREATE OR REPLACE FUNCTION guard_capture_schedule_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id <> OLD.id
    OR NEW.identity_hash <> OLD.identity_hash
    OR NEW.capture_kind <> OLD.capture_kind
    OR NEW.operation <> OLD.operation
    OR NEW.ledger <> OLD.ledger
    OR NEW.chain_id <> OLD.chain_id
    OR NEW.subject_type <> OLD.subject_type
    OR NEW.normalized_identifier <> OLD.normalized_identifier
    OR NEW.parameters <> OLD.parameters
    OR NEW.trigger <> OLD.trigger
    OR NEW.retry_policy <> OLD.retry_policy
    OR NEW.definition <> OLD.definition
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Capture schedule identity is immutable';
  END IF;
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'Completed capture schedules are immutable';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Capture schedule revision must advance exactly once';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Capture schedule time may not move backwards';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS capture_schedule_update_guard ON capture_schedules;
CREATE TRIGGER capture_schedule_update_guard
BEFORE UPDATE ON capture_schedules
FOR EACH ROW EXECUTE FUNCTION guard_capture_schedule_update();

CREATE OR REPLACE FUNCTION guard_capture_run_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id <> OLD.id
    OR NEW.schedule_id <> OLD.schedule_id
    OR NEW.scheduled_for <> OLD.scheduled_for
    OR NEW.max_attempts <> OLD.max_attempts
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Capture run identity is immutable';
  END IF;
  IF OLD.status IN ('SUCCEEDED', 'FAILED_TERMINAL') THEN
    RAISE EXCEPTION 'Terminal capture runs are immutable';
  END IF;
  IF OLD.status = 'LEASED' AND NEW.status NOT IN ('LEASED', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED_TERMINAL') THEN
    RAISE EXCEPTION 'Leased capture run transition is invalid';
  END IF;
  IF OLD.status = 'RETRY_WAIT' AND NEW.status <> 'LEASED' THEN
    RAISE EXCEPTION 'Retry capture run transition is invalid';
  END IF;
  IF NEW.attempt <>
    OLD.attempt + (CASE WHEN OLD.status = 'RETRY_WAIT' THEN 1 ELSE 0 END)
  THEN
    RAISE EXCEPTION 'Capture attempt progression is invalid';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Capture run time may not move backwards';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS capture_run_update_guard ON capture_runs;
CREATE TRIGGER capture_run_update_guard
BEFORE UPDATE ON capture_runs
FOR EACH ROW EXECUTE FUNCTION guard_capture_run_update();

CREATE OR REPLACE FUNCTION validate_capture_run_success()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  stored_snapshot_id uuid;
  stored_snapshot jsonb;
  stored_ledger ledger_kind;
  stored_chain text;
  terminal_kind text;
BEGIN
  IF NEW.status <> 'SUCCEEDED' THEN
    RETURN NEW;
  END IF;
  SELECT snapshot.id, snapshot.payload, snapshot.ledger, snapshot.chain_id,
         terminal.evidence_kind
  INTO stored_snapshot_id, stored_snapshot, stored_ledger, stored_chain, terminal_kind
  FROM evidence terminal
  JOIN analysis_snapshots snapshot ON snapshot.id = terminal.snapshot_id
  WHERE terminal.id = NEW.terminal_evidence_id;

  IF stored_snapshot IS NULL
    OR stored_snapshot_id IS DISTINCT FROM NEW.snapshot_id
    OR stored_snapshot IS DISTINCT FROM NEW.result -> 'snapshot'
    OR terminal_kind IS DISTINCT FROM 'DERIVED_FEATURE'
    OR stored_ledger IS DISTINCT FROM (
      SELECT ledger FROM capture_schedules WHERE id = NEW.schedule_id
    )
    OR stored_chain IS DISTINCT FROM (
      SELECT chain_id FROM capture_schedules WHERE id = NEW.schedule_id
    )
    OR NEW.result ->> 'resultRef' IS DISTINCT FROM NEW.result_ref
    OR NEW.result ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR NEW.result ->> 'modelVersion' IS DISTINCT FROM NEW.model_version
    OR (NEW.result ->> 'coverage')::numeric IS DISTINCT FROM NEW.coverage
    OR (NEW.result ->> 'freshness')::timestamptz IS DISTINCT FROM NEW.freshness
    OR (NEW.result ->> 'confidence')::numeric IS DISTINCT FROM NEW.confidence
    OR NEW.evidence_ids <> ARRAY(
      SELECT value FROM jsonb_array_elements_text(NEW.result -> 'evidenceIds') value ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT value FROM jsonb_array_elements_text(NEW.result -> 'sourceSet') value ORDER BY value
    )
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value
    )
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
    OR EXISTS (
      SELECT 1 FROM unnest(NEW.evidence_ids) item
      LEFT JOIN evidence stored ON stored.id = item
      WHERE stored.id IS NULL OR stored.snapshot_id IS DISTINCT FROM stored_snapshot_id
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT stored.source
      FROM unnest(NEW.evidence_ids) item
      JOIN evidence stored ON stored.id = item
      WHERE stored.evidence_kind <> 'DERIVED_FEATURE'
      ORDER BY stored.source
    )
    OR EXISTS (
      WITH RECURSIVE reachable(id) AS (
        SELECT NEW.terminal_evidence_id
        UNION
        SELECT edge.source_evidence_id
        FROM evidence_edges edge
        JOIN reachable parent ON parent.id = edge.derived_evidence_id
      )
      SELECT 1
      FROM (
        (SELECT item AS id FROM unnest(NEW.evidence_ids) item
         EXCEPT SELECT id FROM reachable)
        UNION ALL
        (SELECT id FROM reachable
         EXCEPT SELECT item AS id FROM unnest(NEW.evidence_ids) item)
      ) difference
    )
  THEN
    RAISE EXCEPTION 'Successful capture run lacks canonical Snapshot or Evidence provenance';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS capture_run_success_guard ON capture_runs;
CREATE TRIGGER capture_run_success_guard
BEFORE INSERT OR UPDATE ON capture_runs
FOR EACH ROW EXECUTE FUNCTION validate_capture_run_success();

CREATE OR REPLACE FUNCTION reject_capture_scheduler_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Capture scheduler history is append-preserving; deletion is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS capture_schedule_delete_guard ON capture_schedules;
CREATE TRIGGER capture_schedule_delete_guard
BEFORE DELETE ON capture_schedules
FOR EACH ROW EXECUTE FUNCTION reject_capture_scheduler_delete();
DROP TRIGGER IF EXISTS capture_run_delete_guard ON capture_runs;
CREATE TRIGGER capture_run_delete_guard
BEFORE DELETE ON capture_runs
FOR EACH ROW EXECUTE FUNCTION reject_capture_scheduler_delete();
DROP TRIGGER IF EXISTS capture_run_attempt_update_guard ON capture_run_attempts;
CREATE TRIGGER capture_run_attempt_update_guard
BEFORE UPDATE OR DELETE ON capture_run_attempts
FOR EACH ROW EXECUTE FUNCTION reject_capture_scheduler_delete();

INSERT INTO schema_migrations(version)
VALUES ('024_capture_schedules')
ON CONFLICT (version) DO NOTHING;

COMMIT;
