\set ON_ERROR_STOP on

BEGIN;

-- A successful range capture ends at one terminal Snapshot, but its provenance may legitimately
-- contain earlier block observations and off-chain declaration/review Evidence. Preserve exact
-- recursive closure while rejecting cross-chain, future-position, and post-capture observations.
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
  terminal_position numeric(30, 0);
BEGIN
  IF NEW.status <> 'SUCCEEDED' THEN
    RETURN NEW;
  END IF;
  SELECT snapshot.id, snapshot.payload, snapshot.ledger, snapshot.chain_id,
         terminal.evidence_kind, snapshot.block_or_slot
  INTO stored_snapshot_id, stored_snapshot, stored_ledger, stored_chain,
       terminal_kind, terminal_position
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
      SELECT 1
      FROM unnest(NEW.evidence_ids) item
      LEFT JOIN evidence stored ON stored.id = item
      LEFT JOIN analysis_snapshots ancestor_snapshot ON ancestor_snapshot.id = stored.snapshot_id
      WHERE stored.id IS NULL
        OR stored.ledger IS DISTINCT FROM stored_ledger
        OR stored.chain_id IS DISTINCT FROM stored_chain
        OR stored.observed_at > NEW.freshness
        OR (stored.block_or_slot IS NOT NULL AND stored.block_or_slot > terminal_position)
        OR (
          stored.snapshot_id IS NOT NULL
          AND (
            ancestor_snapshot.id IS NULL
            OR ancestor_snapshot.ledger IS DISTINCT FROM stored_ledger
            OR ancestor_snapshot.chain_id IS DISTINCT FROM stored_chain
            OR ancestor_snapshot.block_or_slot IS DISTINCT FROM stored.block_or_slot
            OR ancestor_snapshot.captured_at IS DISTINCT FROM stored.observed_at
          )
        )
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT stored.source
      FROM unnest(NEW.evidence_ids) item
      JOIN evidence stored ON stored.id = item
      WHERE stored.evidence_kind NOT IN ('DERIVED_FEATURE', 'NEGATIVE_EVIDENCE')
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
    RAISE EXCEPTION 'Successful capture run lacks canonical range-bounded Snapshot or Evidence provenance';
  END IF;
  RETURN NEW;
END
$function$;

INSERT INTO schema_migrations(version)
VALUES ('030_capture_range_evidence')
ON CONFLICT (version) DO NOTHING;

COMMIT;
