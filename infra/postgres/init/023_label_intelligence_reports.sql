\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS label_intelligence_reports (
  id text PRIMARY KEY CHECK (id ~ '^lir_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (chain_id <> ''),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  subject_type text NOT NULL CHECK (subject_type <> ''),
  normalized_identifier text NOT NULL CHECK (normalized_identifier <> ''),
  label_snapshot_id text NOT NULL CHECK (label_snapshot_id ~ '^lss_[0-9a-f]{24}$'),
  observation_set_hash char(64) NOT NULL CHECK (observation_set_hash ~ '^[0-9a-f]{64}$'),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) >= 2),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'label-intelligence-v0.1.0'),
  as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT label_intelligence_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS label_intelligence_report_latest_idx
  ON label_intelligence_reports (
    ledger,
    chain_id,
    subject_type,
    normalized_identifier,
    as_of DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION validate_label_intelligence_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  terminal evidence%ROWTYPE;
  expected_locator text;
  source_evidence_ids text[];
  observation_ids uuid[];
BEGIN
  IF NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'label-intelligence-report-v1'
    OR NEW.report #>> '{result,subject,id}' IS DISTINCT FROM NEW.subject_id::text
    OR NEW.report #>> '{result,subject,ledger}' IS DISTINCT FROM NEW.ledger::text
    OR NEW.report #>> '{result,subject,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{result,subject,subjectType}' IS DISTINCT FROM NEW.subject_type
    OR NEW.report #>> '{result,subject,normalizedIdentifier}'
      IS DISTINCT FROM NEW.normalized_identifier
    OR NEW.report #>> '{result,request,ledger}' IS DISTINCT FROM NEW.ledger::text
    OR NEW.report #>> '{result,request,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{result,request,subjectType}' IS DISTINCT FROM NEW.subject_type
    OR NEW.report #>> '{result,request,normalizedIdentifier}'
      IS DISTINCT FROM NEW.normalized_identifier
    OR (NEW.report #>> '{result,request,asOf}')::timestamptz IS DISTINCT FROM NEW.as_of
    OR NEW.report #>> '{result,snapshot,id}' IS DISTINCT FROM NEW.label_snapshot_id
    OR NEW.report #>> '{result,snapshot,observationSetHash}'
      IS DISTINCT FROM NEW.observation_set_hash
    OR (NEW.report #>> '{result,snapshot,asOf}')::timestamptz IS DISTINCT FROM NEW.as_of
    OR NEW.report #>> '{result,metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR (NEW.report #>> '{result,automaticEntityMergeAllowed}')::boolean IS DISTINCT FROM false
    OR (NEW.report #>> '{result,riskLabelOwnershipInferenceAllowed}')::boolean IS DISTINCT FROM false
    OR (NEW.report #>> '{result,crossChainSameLabelMergeAllowed}')::boolean IS DISTINCT FROM false
    OR jsonb_typeof(NEW.report #> '{result,observations}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report #> '{result,observations}') = 0
    OR jsonb_typeof(NEW.report #> '{result,snapshot,observationIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{result,metadata,evidenceIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{result,metadata,sourceSet}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Label Intelligence report conflicts with its stored identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM subjects subject
    WHERE subject.id = NEW.subject_id
      AND subject.ledger = NEW.ledger
      AND subject.chain_id = NEW.chain_id
      AND subject.subject_type = NEW.subject_type
      AND subject.normalized_identifier = NEW.normalized_identifier
  ) THEN
    RAISE EXCEPTION 'Label Intelligence report Subject Registry binding is invalid';
  END IF;

  observation_ids := ARRAY(
    SELECT (item #>> '{observation,id}')::uuid
    FROM jsonb_array_elements(NEW.report #> '{result,observations}') item
    ORDER BY item #>> '{observation,id}'
  );
  source_evidence_ids := ARRAY(
    SELECT DISTINCT observation.evidence_id
    FROM label_observations observation
    WHERE observation.id = ANY(observation_ids)
    ORDER BY observation.evidence_id
  );

  IF observation_ids <>
      ARRAY(SELECT DISTINCT value FROM unnest(observation_ids) value ORDER BY value)
    OR observation_ids <> ARRAY(
      SELECT value::uuid
      FROM jsonb_array_elements_text(NEW.report #> '{result,snapshot,observationIds}') value
      ORDER BY value
    )
    OR cardinality(observation_ids) < 1
    OR cardinality(observation_ids) <> (
      SELECT count(*) FROM label_observations observation WHERE observation.id = ANY(observation_ids)
    )
    OR EXISTS (
      SELECT 1
      FROM label_observations observation
      WHERE observation.id = ANY(observation_ids)
        AND observation.subject_id <> NEW.subject_id
    )
  THEN
    RAISE EXCEPTION 'Label Intelligence observation set is incomplete or non-canonical';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{result,observations}') item
    JOIN label_observations observation
      ON observation.id = (item #>> '{observation,id}')::uuid
    JOIN subjects subject ON subject.id = observation.subject_id
    WHERE item #>> '{observation,subjectId}' IS DISTINCT FROM subject.id::text
      OR item #>> '{observation,ledger}' IS DISTINCT FROM subject.ledger::text
      OR item #>> '{observation,chainId}' IS DISTINCT FROM subject.chain_id
      OR item #>> '{observation,subjectType}' IS DISTINCT FROM subject.subject_type
      OR item #>> '{observation,normalizedIdentifier}'
        IS DISTINCT FROM subject.normalized_identifier
      OR item #>> '{observation,source}' IS DISTINCT FROM observation.source
      OR item #>> '{observation,sourceClass}' IS DISTINCT FROM observation.source_class
      OR item #>> '{observation,label}' IS DISTINCT FROM observation.label
      OR item #>> '{observation,category}' IS DISTINCT FROM observation.category
      OR (item #>> '{observation,sourceConfidence}')::numeric
        IS DISTINCT FROM observation.source_confidence
      OR (item #>> '{observation,observedAt}')::timestamptz
        IS DISTINCT FROM observation.observed_at
      OR (item #>> '{observation,deterministic}')::boolean
        IS DISTINCT FROM observation.deterministic
      OR item #>> '{observation,licensePolicy}' IS DISTINCT FROM observation.license_policy
      OR item #>> '{observation,rawPayloadHash}' IS DISTINCT FROM observation.raw_payload_hash
      OR ARRAY(
        SELECT value
        FROM jsonb_array_elements_text(item #> '{observation,evidenceIds}') value
        ORDER BY value
      ) <> ARRAY[observation.evidence_id]
      OR (
        observation.actor_candidate IS NULL
        AND item #>> '{observation,actorCandidate,state}' = 'known'
      )
      OR (
        observation.actor_candidate IS NOT NULL
        AND (
          item #>> '{observation,actorCandidate,state}' IS DISTINCT FROM 'known'
          OR item #>> '{observation,actorCandidate,value}'
            IS DISTINCT FROM observation.actor_candidate
        )
      )
      OR (
        observation.valid_from IS NULL
        AND item #>> '{observation,validFrom,state}' = 'known'
      )
      OR (
        observation.valid_from IS NOT NULL
        AND (
          item #>> '{observation,validFrom,state}' IS DISTINCT FROM 'known'
          OR (item #>> '{observation,validFrom,value}')::timestamptz
            IS DISTINCT FROM observation.valid_from
        )
      )
      OR (
        observation.valid_to IS NULL
        AND item #>> '{observation,validTo,state}' = 'known'
      )
      OR (
        observation.valid_to IS NOT NULL
        AND (
          item #>> '{observation,validTo,state}' IS DISTINCT FROM 'known'
          OR (item #>> '{observation,validTo,value}')::timestamptz
            IS DISTINCT FROM observation.valid_to
        )
      )
  ) THEN
    RAISE EXCEPTION 'Label Intelligence observation payload conflicts with durable observations';
  END IF;

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
      SELECT value FROM unnest(NEW.evidence_ids) value
      WHERE value <> NEW.terminal_evidence_id
      ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{result,metadata,sourceSet}') value
      ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT observation.source
      FROM label_observations observation
      WHERE observation.id = ANY(observation_ids)
      ORDER BY observation.source
    )
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'Label Intelligence provenance arrays must be canonical and complete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    LEFT JOIN evidence stored ON stored.id = item
    WHERE stored.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Label Intelligence report references missing Evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(source_evidence_ids) item
    JOIN evidence stored ON stored.id = item
    WHERE stored.ledger <> NEW.ledger OR stored.chain_id <> NEW.chain_id
  ) THEN
    RAISE EXCEPTION 'Label Intelligence source Evidence is outside the Subject ledger scope';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report -> 'evidence') item
    JOIN evidence stored ON stored.id = item ->> 'id'
    WHERE item ->> 'ledger' IS DISTINCT FROM stored.ledger::text
      OR item ->> 'chainId' IS DISTINCT FROM stored.chain_id
      OR item ->> 'kind' IS DISTINCT FROM stored.evidence_kind
      OR item ->> 'source' IS DISTINCT FROM stored.source
      OR item ->> 'locator' IS DISTINCT FROM stored.locator
      OR item ->> 'sourceUri' IS DISTINCT FROM stored.source_uri
      OR item ->> 'payloadHash' IS DISTINCT FROM stored.payload_hash
      OR (item ->> 'observedAt')::timestamptz IS DISTINCT FROM stored.observed_at
      OR item ->> 'blockOrSlot' IS DISTINCT FROM stored.block_or_slot::text
      OR item ->> 'finality' IS DISTINCT FROM stored.finality
      OR item ->> 'summary' IS DISTINCT FROM stored.summary
      OR item ->> 'rawArtifactRef' IS DISTINCT FROM stored.raw_artifact_ref
  ) THEN
    RAISE EXCEPTION 'Label Intelligence Evidence payload conflicts with durable Evidence';
  END IF;

  expected_locator := 'label-intelligence:' || NEW.ledger::text || ':' || NEW.chain_id || ':' ||
    NEW.subject_id::text || ':' || NEW.label_snapshot_id;
  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  IF NOT FOUND
    OR terminal.ledger <> NEW.ledger
    OR terminal.chain_id <> NEW.chain_id
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:label-intelligence-v0.1.0'
    OR terminal.locator <> expected_locator
    OR terminal.observed_at <> NEW.as_of
    OR terminal.block_or_slot IS NOT NULL
    OR terminal.snapshot_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Label Intelligence terminal Evidence conflicts with report identity';
  END IF;

  IF (SELECT count(*) FROM evidence_edges WHERE derived_evidence_id = NEW.terminal_evidence_id)
      <> cardinality(source_evidence_ids)
    OR EXISTS (
      SELECT 1 FROM unnest(source_evidence_ids) source_id
      WHERE NOT EXISTS (
        SELECT 1 FROM evidence_edges edge
        WHERE edge.derived_evidence_id = NEW.terminal_evidence_id
          AND edge.source_evidence_id = source_id
      )
    )
  THEN
    RAISE EXCEPTION 'Label Intelligence terminal Evidence parents are incomplete';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS label_intelligence_report_insert_guard
ON label_intelligence_reports;
CREATE TRIGGER label_intelligence_report_insert_guard
BEFORE INSERT ON label_intelligence_reports
FOR EACH ROW EXECUTE FUNCTION validate_label_intelligence_report_insert();

CREATE OR REPLACE FUNCTION reject_label_intelligence_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'label_intelligence_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS label_intelligence_report_update_guard
ON label_intelligence_reports;
CREATE TRIGGER label_intelligence_report_update_guard
BEFORE UPDATE ON label_intelligence_reports
FOR EACH ROW EXECUTE FUNCTION reject_label_intelligence_report_mutation();

DROP TRIGGER IF EXISTS label_intelligence_report_delete_guard
ON label_intelligence_reports;
CREATE TRIGGER label_intelligence_report_delete_guard
BEFORE DELETE ON label_intelligence_reports
FOR EACH ROW EXECUTE FUNCTION reject_label_intelligence_report_mutation();

DROP VIEW IF EXISTS label_intelligence_search_documents_v1;
CREATE VIEW label_intelligence_search_documents_v1 AS
SELECT
  'LABEL_INTELLIGENCE:' || report.id || ':LABEL_SNAPSHOT' AS document_key,
  report.ledger,
  report.chain_id,
  report.subject_type,
  report.normalized_identifier,
  'LABEL_INTELLIGENCE'::text AS record_type,
  report.id AS record_id,
  'LABEL_SNAPSHOT'::text AS role,
  NULL::numeric(30, 0) AS snapshot_position,
  report.observation_set_hash::text AS snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set) AS source_set,
  report.model_version,
  CASE
    WHEN report.report #>> '{result,metadata,conclusionConfidence,state}' = 'known'
      THEN (report.report #>> '{result,metadata,conclusionConfidence,value}')::numeric
    ELSE NULL::numeric
  END AS confidence,
  report.as_of AS captured_at,
  NULL::uuid AS label_id,
  NULL::text AS label_text,
  NULL::text AS label_category,
  report.created_at
FROM label_intelligence_reports report;

INSERT INTO schema_migrations(version)
VALUES ('023_label_intelligence_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
