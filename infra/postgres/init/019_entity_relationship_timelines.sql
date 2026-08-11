\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS entity_relationship_timeline_reports (
  id text PRIMARY KEY CHECK (id ~ '^ert_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (chain_id <> ''),
  subject_a text NOT NULL CHECK (subject_a <> ''),
  subject_b text NOT NULL CHECK (subject_b <> '' AND subject_b <> subject_a),
  from_position numeric(30, 0) NOT NULL CHECK (from_position >= 0),
  to_position numeric(30, 0) NOT NULL CHECK (to_position >= from_position),
  result_hash char(64) NOT NULL UNIQUE CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  report_ids text[] NOT NULL CHECK (cardinality(report_ids) >= 2),
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) >= 3),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'entity-timeline-v0.1.0'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entity_relationship_timeline_latest_idx
  ON entity_relationship_timeline_reports (
    ledger, chain_id, subject_a, subject_b, to_position DESC, captured_at DESC, created_at DESC, id DESC
  );

CREATE OR REPLACE FUNCTION validate_entity_relationship_timeline_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  terminal evidence%ROWTYPE;
  latest_snapshot jsonb;
  expected_position text;
  expected_finality text;
  expected_locator text;
  parent_evidence_ids text[];
BEGIN
  IF NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'entity-relationship-timeline-report-v1'
    OR (NEW.report ->> 'automaticOwnershipMergeAllowed')::boolean IS DISTINCT FROM false
    OR NEW.report #>> '{timeline,request,ledger}' IS DISTINCT FROM NEW.ledger::text
    OR NEW.report #>> '{timeline,request,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{timeline,request,subjectA}' IS DISTINCT FROM NEW.subject_a
    OR NEW.report #>> '{timeline,request,subjectB}' IS DISTINCT FROM NEW.subject_b
    OR NEW.report #>> '{timeline,request,fromPosition}' IS DISTINCT FROM NEW.from_position::text
    OR NEW.report #>> '{timeline,request,toPosition}' IS DISTINCT FROM NEW.to_position::text
    OR NEW.report #>> '{timeline,metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR jsonb_typeof(NEW.report #> '{timeline,observations}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report #> '{timeline,observations}') < 2
    OR jsonb_typeof(NEW.report #> '{timeline,transitions}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report #> '{timeline,transitions}') < 1
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Entity relationship timeline conflicts with its stored identity';
  END IF;

  latest_snapshot := NEW.report #> '{timeline,metadata,snapshot}';
  CASE NEW.ledger
    WHEN 'EVM' THEN
      expected_position := latest_snapshot ->> 'blockNumber';
      expected_finality := latest_snapshot ->> 'finality';
    WHEN 'BITCOIN' THEN
      expected_position := latest_snapshot ->> 'height';
      expected_finality := latest_snapshot ->> 'finality';
    WHEN 'SOLANA' THEN
      expected_position := latest_snapshot ->> 'slot';
      expected_finality := latest_snapshot ->> 'commitment';
  END CASE;
  IF expected_position IS DISTINCT FROM NEW.to_position::text
    OR (latest_snapshot ->> 'capturedAt')::timestamptz IS DISTINCT FROM NEW.captured_at
  THEN
    RAISE EXCEPTION 'Entity relationship timeline latest Snapshot conflicts with stored identity';
  END IF;

  parent_evidence_ids := ARRAY(
    SELECT DISTINCT observation ->> 'terminalEvidenceId'
    FROM jsonb_array_elements(NEW.report #> '{timeline,observations}') observation
    ORDER BY observation ->> 'terminalEvidenceId'
  );

  IF NEW.report_ids <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.report_ids) value ORDER BY value)
    OR NEW.evidence_ids <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value)
    OR NEW.source_set <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value)
    OR NEW.report_ids <> ARRAY(
      SELECT DISTINCT observation ->> 'reportId'
      FROM jsonb_array_elements(NEW.report #> '{timeline,observations}') observation
      ORDER BY observation ->> 'reportId'
    )
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT item ->> 'id'
      FROM jsonb_array_elements(NEW.report -> 'evidence') item
      ORDER BY item ->> 'id'
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{timeline,metadata,sourceSet}') value
      ORDER BY value
    )
    OR NEW.report #> '{timeline,metadata,evidenceIds}' IS DISTINCT FROM to_jsonb(parent_evidence_ids)
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'Entity relationship timeline provenance arrays must be canonical and complete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{timeline,observations}') observation
    LEFT JOIN entity_relationship_reports relationship
      ON relationship.id = observation ->> 'reportId'
    WHERE relationship.id IS NULL
      OR relationship.ledger <> NEW.ledger
      OR relationship.chain_id <> NEW.chain_id
      OR relationship.subject_a <> NEW.subject_a
      OR relationship.subject_b <> NEW.subject_b
      OR relationship.result_hash <> observation ->> 'resultHash'
      OR relationship.terminal_evidence_id <> observation ->> 'terminalEvidenceId'
      OR relationship.report #>> '{result,classification}' <> observation ->> 'classification'
      OR relationship.report #> '{result,sameControllerProbability}' IS DISTINCT FROM observation -> 'sameControllerProbability'
      OR relationship.report #> '{result,coordinationProbability}' IS DISTINCT FROM observation -> 'coordinationProbability'
      OR relationship.report #> '{result,independenceProbability}' IS DISTINCT FROM observation -> 'independenceProbability'
      OR relationship.report #> '{result,metadata,snapshot}' IS DISTINCT FROM observation -> 'snapshot'
      OR (relationship.report #>> '{result,serviceSuppressionApplied}')::boolean
        IS DISTINCT FROM (observation ->> 'serviceSuppressionApplied')::boolean
  ) THEN
    RAISE EXCEPTION 'Entity relationship timeline observation conflicts with a durable relationship report';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report -> 'evidence') item
    LEFT JOIN evidence e ON e.id = item ->> 'id'
    WHERE e.id IS NULL
      OR item ->> 'ledger' IS DISTINCT FROM e.ledger::text
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
    RAISE EXCEPTION 'Entity relationship timeline Evidence payload conflicts with durable Evidence';
  END IF;

  expected_locator := 'entity-relationship-timeline:' || NEW.subject_a || ':' || NEW.subject_b || ':'
    || NEW.from_position::text || ':' || NEW.to_position::text;
  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  IF NOT FOUND
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:entity-timeline-v0.1.0'
    OR terminal.locator <> expected_locator
    OR terminal.block_or_slot::text <> expected_position
    OR terminal.finality <> expected_finality
  THEN
    RAISE EXCEPTION 'Entity relationship timeline terminal Evidence conflicts with report identity';
  END IF;

  IF (SELECT count(*) FROM evidence_edges WHERE derived_evidence_id = NEW.terminal_evidence_id)
      <> cardinality(parent_evidence_ids)
    OR EXISTS (
      SELECT 1 FROM unnest(parent_evidence_ids) source_id
      WHERE NOT EXISTS (
        SELECT 1 FROM evidence_edges edge
        WHERE edge.derived_evidence_id = NEW.terminal_evidence_id
          AND edge.source_evidence_id = source_id
      )
    )
  THEN
    RAISE EXCEPTION 'Entity relationship timeline terminal Evidence parents are incomplete';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS entity_relationship_timeline_insert_guard
ON entity_relationship_timeline_reports;
CREATE TRIGGER entity_relationship_timeline_insert_guard
BEFORE INSERT ON entity_relationship_timeline_reports
FOR EACH ROW EXECUTE FUNCTION validate_entity_relationship_timeline_insert();

CREATE OR REPLACE FUNCTION reject_entity_relationship_timeline_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'entity_relationship_timeline_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS entity_relationship_timeline_update_guard
ON entity_relationship_timeline_reports;
CREATE TRIGGER entity_relationship_timeline_update_guard
BEFORE UPDATE ON entity_relationship_timeline_reports
FOR EACH ROW EXECUTE FUNCTION reject_entity_relationship_timeline_mutation();

DROP TRIGGER IF EXISTS entity_relationship_timeline_delete_guard
ON entity_relationship_timeline_reports;
CREATE TRIGGER entity_relationship_timeline_delete_guard
BEFORE DELETE ON entity_relationship_timeline_reports
FOR EACH ROW EXECUTE FUNCTION reject_entity_relationship_timeline_mutation();

INSERT INTO schema_migrations(version)
VALUES ('019_entity_relationship_timelines')
ON CONFLICT (version) DO NOTHING;

COMMIT;
