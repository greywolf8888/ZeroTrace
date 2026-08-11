\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS entity_relationship_reports (
  id text PRIMARY KEY CHECK (id ~ '^erh_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (chain_id <> ''),
  subject_a text NOT NULL CHECK (subject_a <> ''),
  subject_b text NOT NULL CHECK (subject_b <> '' AND subject_b <> subject_a),
  snapshot_position numeric(30, 0) NOT NULL CHECK (snapshot_position >= 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash <> ''),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) >= 2),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'entity-v0.1.0'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_relationship_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS entity_relationship_report_latest_idx
  ON entity_relationship_reports (
    ledger,
    chain_id,
    subject_a,
    subject_b,
    snapshot_position DESC,
    captured_at DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION validate_entity_relationship_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  terminal evidence%ROWTYPE;
  expected_position text;
  expected_hash text;
  expected_finality text;
  expected_locator text;
  source_evidence_ids text[];
BEGIN
  IF NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'entity-relationship-report-v1'
    OR (NEW.report ->> 'automaticOwnershipMergeAllowed')::boolean IS DISTINCT FROM false
    OR NEW.report #>> '{input,subjectA}' IS DISTINCT FROM NEW.subject_a
    OR NEW.report #>> '{input,subjectB}' IS DISTINCT FROM NEW.subject_b
    OR NEW.report #>> '{result,subjectA}' IS DISTINCT FROM NEW.subject_a
    OR NEW.report #>> '{result,subjectB}' IS DISTINCT FROM NEW.subject_b
    OR NEW.report #>> '{input,metadata,snapshot,ledger}' IS DISTINCT FROM NEW.ledger::text
    OR NEW.report #>> '{input,metadata,snapshot,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #> '{input,metadata,snapshot}' IS DISTINCT FROM
      NEW.report #> '{result,metadata,snapshot}'
    OR NEW.report #>> '{result,metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR (NEW.report #>> '{input,metadata,snapshot,capturedAt}')::timestamptz
      IS DISTINCT FROM NEW.captured_at
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR jsonb_typeof(NEW.report #> '{input,features}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report #> '{input,features}') = 0
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{input,metadata,evidenceIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{result,metadata,evidenceIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{input,metadata,sourceSet}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{result,metadata,sourceSet}') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Entity relationship report conflicts with its stored identity';
  END IF;

  CASE NEW.ledger
    WHEN 'EVM' THEN
      expected_position := NEW.report #>> '{input,metadata,snapshot,blockNumber}';
      expected_hash := NEW.report #>> '{input,metadata,snapshot,blockHash}';
      expected_finality := NEW.report #>> '{input,metadata,snapshot,finality}';
    WHEN 'BITCOIN' THEN
      expected_position := NEW.report #>> '{input,metadata,snapshot,height}';
      expected_hash := NEW.report #>> '{input,metadata,snapshot,blockHash}';
      expected_finality := NEW.report #>> '{input,metadata,snapshot,finality}';
    WHEN 'SOLANA' THEN
      expected_position := NEW.report #>> '{input,metadata,snapshot,slot}';
      expected_hash := NEW.report #>> '{input,metadata,snapshot,blockhash}';
      expected_finality := NEW.report #>> '{input,metadata,snapshot,commitment}';
  END CASE;

  IF expected_position IS DISTINCT FROM NEW.snapshot_position::text
    OR expected_hash IS DISTINCT FROM NEW.snapshot_hash
  THEN
    RAISE EXCEPTION 'Entity relationship report Snapshot conflicts with stored identity';
  END IF;

  source_evidence_ids := ARRAY(
    SELECT value
    FROM unnest(NEW.evidence_ids) value
    WHERE value <> NEW.terminal_evidence_id
    ORDER BY value
  );

  IF NEW.evidence_ids <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value)
    OR NEW.source_set <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value)
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{result,metadata,evidenceIds}') value
      ORDER BY value
    )
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT item ->> 'id'
      FROM jsonb_array_elements(NEW.report -> 'evidence') item
      ORDER BY item ->> 'id'
    )
    OR source_evidence_ids <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{input,metadata,evidenceIds}') value
      ORDER BY value
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.report #> '{input,features}') feature
      WHERE NOT (feature ->> 'evidenceId') = ANY(source_evidence_ids)
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{input,metadata,sourceSet}') value
      ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{result,metadata,sourceSet}') value
      ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT e.source
      FROM evidence e
      WHERE e.id = ANY(source_evidence_ids)
      ORDER BY e.source
    )
    OR EXISTS (SELECT 1 FROM unnest(NEW.evidence_ids) value WHERE value = '')
    OR EXISTS (SELECT 1 FROM unnest(NEW.source_set) value WHERE value = '')
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'Entity relationship report provenance arrays must be canonical and complete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    LEFT JOIN evidence e ON e.id = item
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Entity relationship report references missing Evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report -> 'evidence') item
    JOIN evidence e ON e.id = item ->> 'id'
    WHERE item ->> 'ledger' IS DISTINCT FROM e.ledger::text
      OR item ->> 'chainId' IS DISTINCT FROM e.chain_id
      OR item ->> 'kind' IS DISTINCT FROM e.evidence_kind
      OR item ->> 'source' IS DISTINCT FROM e.source
      OR item ->> 'locator' IS DISTINCT FROM e.locator
      OR item ->> 'sourceUri' IS DISTINCT FROM e.source_uri
      OR item ->> 'payloadHash' IS DISTINCT FROM e.payload_hash
      OR (item ->> 'observedAt')::timestamptz IS DISTINCT FROM e.observed_at
      OR item ->> 'blockOrSlot' IS DISTINCT FROM e.block_or_slot::text
      OR item ->> 'finality' IS DISTINCT FROM e.finality
      OR item ->> 'summary' IS DISTINCT FROM e.summary
      OR item ->> 'rawArtifactRef' IS DISTINCT FROM e.raw_artifact_ref
  ) THEN
    RAISE EXCEPTION 'Entity relationship report Evidence payload conflicts with durable Evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    JOIN evidence e ON e.id = item
    LEFT JOIN analysis_snapshots snapshot ON snapshot.id = e.snapshot_id
    WHERE e.ledger <> NEW.ledger
      OR e.chain_id <> NEW.chain_id
      OR e.block_or_slot <> NEW.snapshot_position
      OR e.finality <> expected_finality
      OR snapshot.id IS NULL
      OR snapshot.ledger <> NEW.ledger
      OR snapshot.chain_id <> NEW.chain_id
      OR snapshot.block_or_slot <> NEW.snapshot_position
      OR snapshot.block_hash <> NEW.snapshot_hash
      OR snapshot.captured_at <> NEW.captured_at
  ) THEN
    RAISE EXCEPTION 'Entity relationship Evidence is not anchored to the report Snapshot';
  END IF;

  expected_locator := 'entity-relationship:' || NEW.subject_a || ':' || NEW.subject_b;
  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  IF NOT FOUND
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:entity-v0.1.0'
    OR terminal.locator <> expected_locator
  THEN
    RAISE EXCEPTION 'Entity relationship terminal Evidence conflicts with report identity';
  END IF;

  IF (SELECT count(*) FROM evidence_edges WHERE derived_evidence_id = NEW.terminal_evidence_id)
      <> cardinality(source_evidence_ids)
    OR EXISTS (
      SELECT 1
      FROM unnest(source_evidence_ids) source_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM evidence_edges edge
        WHERE edge.derived_evidence_id = NEW.terminal_evidence_id
          AND edge.source_evidence_id = source_id
      )
    )
  THEN
    RAISE EXCEPTION 'Entity relationship terminal Evidence parents are incomplete';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS entity_relationship_report_insert_guard
ON entity_relationship_reports;
CREATE TRIGGER entity_relationship_report_insert_guard
BEFORE INSERT ON entity_relationship_reports
FOR EACH ROW EXECUTE FUNCTION validate_entity_relationship_report_insert();

CREATE OR REPLACE FUNCTION reject_entity_relationship_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'entity_relationship_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS entity_relationship_report_update_guard
ON entity_relationship_reports;
CREATE TRIGGER entity_relationship_report_update_guard
BEFORE UPDATE ON entity_relationship_reports
FOR EACH ROW EXECUTE FUNCTION reject_entity_relationship_report_mutation();

DROP TRIGGER IF EXISTS entity_relationship_report_delete_guard
ON entity_relationship_reports;
CREATE TRIGGER entity_relationship_report_delete_guard
BEFORE DELETE ON entity_relationship_reports
FOR EACH ROW EXECUTE FUNCTION reject_entity_relationship_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('018_entity_relationship_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
