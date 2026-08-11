\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS flap_history_segments (
  id text PRIMARY KEY CHECK (id ~ '^fhs_[0-9a-f]{24}$'),
  scan_id uuid NOT NULL REFERENCES semantic_scan_runs(id) ON DELETE RESTRICT,
  chain_id text NOT NULL,
  token text NOT NULL CHECK (token ~ '^0x[0-9a-f]{40}$'),
  from_block numeric(30, 0) NOT NULL CHECK (from_block >= 0),
  to_block numeric(30, 0) NOT NULL CHECK (
    to_block >= from_block AND to_block - from_block < 50000
  ),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL,
  transaction_count integer NOT NULL CHECK (transaction_count >= 0),
  unrecognized_portal_log_count integer NOT NULL CHECK (unrecognized_portal_log_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flap_history_segments_range_key UNIQUE (scan_id, from_block, to_block)
);

CREATE INDEX IF NOT EXISTS flap_history_segments_token_idx
  ON flap_history_segments (chain_id, token, from_block, to_block);
CREATE INDEX IF NOT EXISTS flap_history_segments_scan_idx
  ON flap_history_segments (scan_id, from_block);

CREATE OR REPLACE FUNCTION validate_flap_history_segment_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  scan semantic_scan_runs%ROWTYPE;
  expected_to numeric(30, 0);
BEGIN
  SELECT * INTO scan FROM semantic_scan_runs WHERE id = NEW.scan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flap history segment scan does not exist';
  END IF;
  IF scan.scan_type <> 'FLAP_EVENT_HISTORY'
    OR scan.source <> 'sqd:binance-mainnet'
    OR scan.ledger <> 'EVM'
    OR scan.chain_id <> NEW.chain_id
    OR scan.subject <> NEW.token
  THEN
    RAISE EXCEPTION 'Flap history segment identity conflicts with its scan';
  END IF;
  IF scan.status <> 'RUNNING' OR NEW.from_block <> scan.next_block THEN
    RAISE EXCEPTION 'Flap history segment must start at the running scan cursor';
  END IF;
  expected_to := LEAST(scan.to_block, NEW.from_block + scan.chunk_size - 1);
  IF NEW.to_block <> expected_to THEN
    RAISE EXCEPTION 'Flap history segment must cover exactly one bounded scan chunk';
  END IF;
  IF NEW.result ->> 'platform' <> 'flap'
    OR NEW.result ->> 'token' <> NEW.token
    OR NEW.result #>> '{requestedRange,fromBlock}' <> NEW.from_block::text
    OR NEW.result #>> '{requestedRange,toBlock}' <> NEW.to_block::text
    OR NEW.result ->> 'requestedRangeCoverage' <> '1'
    OR NEW.result #>> '{metadata,modelVersion}' <> NEW.model_version
  THEN
    RAISE EXCEPTION 'Flap history segment result conflicts with its stored identity';
  END IF;
  IF NEW.evidence_ids <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value)
    OR NEW.source_set <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value)
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'Flap history segment provenance arrays must be canonical';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    LEFT JOIN evidence e ON e.id = item
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Flap history segment references missing Evidence';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS flap_history_segment_insert_guard ON flap_history_segments;
CREATE TRIGGER flap_history_segment_insert_guard
BEFORE INSERT ON flap_history_segments
FOR EACH ROW EXECUTE FUNCTION validate_flap_history_segment_insert();

CREATE OR REPLACE FUNCTION reject_flap_history_segment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'flap_history_segments is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS flap_history_segment_update_guard ON flap_history_segments;
CREATE TRIGGER flap_history_segment_update_guard
BEFORE UPDATE ON flap_history_segments
FOR EACH ROW EXECUTE FUNCTION reject_flap_history_segment_mutation();

DROP TRIGGER IF EXISTS flap_history_segment_delete_guard ON flap_history_segments;
CREATE TRIGGER flap_history_segment_delete_guard
BEFORE DELETE ON flap_history_segments
FOR EACH ROW EXECUTE FUNCTION reject_flap_history_segment_mutation();

INSERT INTO schema_migrations(version)
VALUES ('008_flap_history_projection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
