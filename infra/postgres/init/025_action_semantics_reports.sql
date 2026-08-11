\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS action_semantics_reports (
  id text PRIMARY KEY CHECK (id ~ '^asr_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (length(chain_id) BETWEEN 1 AND 128),
  snapshot_position numeric(30, 0) NOT NULL CHECK (snapshot_position >= 0),
  snapshot_hash text NOT NULL CHECK (length(snapshot_hash) > 0),
  transaction_ids text[] NOT NULL CHECK (cardinality(transaction_ids) > 0),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) >= 2),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'action-semantics-v0.1.0'),
  classification_coverage double precision NOT NULL
    CHECK (classification_coverage BETWEEN 0 AND 1),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT action_semantics_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS action_semantics_transaction_ids_idx
  ON action_semantics_reports USING gin (transaction_ids);

CREATE INDEX IF NOT EXISTS action_semantics_latest_idx
  ON action_semantics_reports (
    ledger,
    chain_id,
    snapshot_position DESC,
    captured_at DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION validate_action_semantics_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  terminal evidence%ROWTYPE;
  expected_id text;
  expected_locator text;
  expected_finality text;
  expected_position text;
  expected_hash text;
  action_evidence_ids text[];
  recursive_evidence_ids text[];
  known_actions integer;
  total_actions integer;
BEGIN
  IF jsonb_typeof(NEW.report -> 'actions') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report -> 'actions') = 0
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,evidenceIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,sourceSet}') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Action Semantics report arrays are missing';
  END IF;

  expected_position := CASE NEW.ledger
    WHEN 'EVM' THEN NEW.report #>> '{snapshot,blockNumber}'
    WHEN 'BITCOIN' THEN NEW.report #>> '{snapshot,height}'
    WHEN 'SOLANA' THEN NEW.report #>> '{snapshot,slot}'
  END;
  expected_hash := CASE NEW.ledger
    WHEN 'SOLANA' THEN NEW.report #>> '{snapshot,blockhash}'
    ELSE NEW.report #>> '{snapshot,blockHash}'
  END;
  expected_finality := CASE NEW.ledger
    WHEN 'SOLANA' THEN NEW.report #>> '{snapshot,commitment}'
    ELSE NEW.report #>> '{snapshot,finality}'
  END;
  expected_locator := 'action-semantics:' || NEW.ledger::text || ':' || NEW.chain_id || ':' ||
    NEW.snapshot_position::text || ':' || NEW.result_hash;
  expected_id := 'asr_' || substr(
    encode(
      digest(
        convert_to(
          '{"resultHash":"' || NEW.result_hash ||
            '","schema":"zerotrace-action-semantics-report-v1"}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    1,
    24
  );

  SELECT
    count(*) FILTER (WHERE action #>> '{primitive,state}' = 'known'),
    count(*)
  INTO known_actions, total_actions
  FROM jsonb_array_elements(NEW.report -> 'actions') action;

  IF NEW.id IS DISTINCT FROM expected_id
    OR NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'action-semantics-report-v1'
    OR NEW.report ->> 'resultHash' IS DISTINCT FROM NEW.result_hash
    OR NEW.report #>> '{snapshot,ledger}' IS DISTINCT FROM NEW.ledger::text
    OR NEW.report #>> '{snapshot,chainId}' IS DISTINCT FROM NEW.chain_id
    OR expected_position IS DISTINCT FROM NEW.snapshot_position::text
    OR expected_hash IS DISTINCT FROM NEW.snapshot_hash
    OR NEW.report -> 'snapshot' IS DISTINCT FROM NEW.report #> '{metadata,snapshot}'
    OR NEW.report #>> '{metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR (NEW.report #>> '{metadata,confidence}')::double precision IS DISTINCT FROM 1::double precision
    OR (NEW.report #>> '{metadata,freshness}')::timestamptz IS DISTINCT FROM NEW.captured_at
    OR (NEW.report #>> '{snapshot,capturedAt}')::timestamptz IS DISTINCT FROM NEW.captured_at
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR (NEW.report ->> 'classificationCoverage')::double precision
      IS DISTINCT FROM NEW.classification_coverage
    OR known_actions::double precision / total_actions::double precision
      IS DISTINCT FROM NEW.classification_coverage
  THEN
    RAISE EXCEPTION 'Action Semantics report conflicts with its stored identity';
  END IF;

  IF (NEW.ledger = 'EVM' AND NEW.snapshot_hash !~ '^0x[0-9a-fA-F]{64}$')
    OR (NEW.ledger = 'BITCOIN' AND NEW.snapshot_hash !~ '^[0-9a-f]{64}$')
    OR (NEW.ledger = 'SOLANA' AND NEW.snapshot_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$')
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.report -> 'actions') action
      WHERE action ->> 'ledger' IS DISTINCT FROM NEW.ledger::text
        OR action ->> 'chainId' IS DISTINCT FROM NEW.chain_id
        OR action ->> 'blockOrSlot' IS DISTINCT FROM NEW.snapshot_position::text
        OR action ->> 'transactionId' IS NULL
        OR CASE NEW.ledger
          WHEN 'EVM' THEN action ->> 'transactionId' !~ '^0x[0-9a-f]{64}$'
          WHEN 'BITCOIN' THEN action ->> 'transactionId' !~ '^[0-9a-f]{64}$'
          WHEN 'SOLANA' THEN action ->> 'transactionId' !~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$'
        END
    )
  THEN
    RAISE EXCEPTION 'Action Semantics ledger identity is not canonical';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT evidence_id
    FROM jsonb_array_elements(NEW.report -> 'actions') action,
      LATERAL jsonb_array_elements_text(action -> 'evidenceIds') evidence_id
    ORDER BY evidence_id
  ) INTO action_evidence_ids;

  IF NEW.transaction_ids <>
      ARRAY(SELECT DISTINCT action ->> 'transactionId'
        FROM jsonb_array_elements(NEW.report -> 'actions') action
        ORDER BY action ->> 'transactionId')
    OR NEW.evidence_ids <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value)
    OR NEW.source_set <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value)
    OR NEW.transaction_ids <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.transaction_ids) value ORDER BY value)
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{metadata,evidenceIds}') value
      ORDER BY value
    )
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT item ->> 'id'
      FROM jsonb_array_elements(NEW.report -> 'evidence') item
      ORDER BY item ->> 'id'
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{metadata,sourceSet}') value
      ORDER BY value
    )
    OR action_evidence_ids <> ARRAY(
      SELECT value
      FROM unnest(NEW.evidence_ids) value
      WHERE value <> NEW.terminal_evidence_id
      ORDER BY value
    )
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
    OR EXISTS (SELECT 1 FROM unnest(NEW.transaction_ids) value WHERE value = '')
    OR EXISTS (SELECT 1 FROM unnest(NEW.evidence_ids) value WHERE value = '')
    OR EXISTS (SELECT 1 FROM unnest(NEW.source_set) value WHERE value = '')
  THEN
    RAISE EXCEPTION 'Action Semantics provenance arrays must be canonical and complete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    LEFT JOIN evidence stored ON stored.id = item
    WHERE stored.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Action Semantics report references missing Evidence';
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
    RAISE EXCEPTION 'Action Semantics Evidence payload conflicts with durable Evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    JOIN evidence stored ON stored.id = item
    LEFT JOIN analysis_snapshots snapshot ON snapshot.id = stored.snapshot_id
    WHERE snapshot.id IS NULL
      OR snapshot.payload IS DISTINCT FROM NEW.report -> 'snapshot'
      OR snapshot.ledger <> NEW.ledger
      OR snapshot.chain_id <> NEW.chain_id
      OR snapshot.block_or_slot <> NEW.snapshot_position
      OR snapshot.block_hash <> NEW.snapshot_hash
      OR snapshot.captured_at <> NEW.captured_at
  ) THEN
    RAISE EXCEPTION 'Action Semantics Evidence is outside the exact replay Snapshot';
  END IF;

  IF NEW.source_set <> ARRAY(
    SELECT DISTINCT stored.source
    FROM evidence stored
    WHERE stored.id = ANY(NEW.evidence_ids)
      AND stored.evidence_kind NOT IN (
        'DERIVED_FEATURE',
        'NEGATIVE_EVIDENCE',
        'ANALYST_OBSERVATION'
      )
    ORDER BY stored.source
  ) THEN
    RAISE EXCEPTION 'Action Semantics source set must contain exact non-derived Evidence sources';
  END IF;

  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  IF NOT FOUND
    OR terminal.ledger <> NEW.ledger
    OR terminal.chain_id <> NEW.chain_id
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:action-semantics-v0.1.0'
    OR terminal.locator <> expected_locator
    OR terminal.observed_at <> NEW.captured_at
    OR terminal.block_or_slot <> NEW.snapshot_position
    OR terminal.finality <> expected_finality
  THEN
    RAISE EXCEPTION 'Action Semantics terminal Evidence conflicts with report identity';
  END IF;

  IF ARRAY(
      SELECT source_evidence_id
      FROM evidence_edges
      WHERE derived_evidence_id = NEW.terminal_evidence_id
      ORDER BY source_evidence_id
    ) <> action_evidence_ids
  THEN
    RAISE EXCEPTION 'Action Semantics terminal Evidence parents are incomplete';
  END IF;

  WITH RECURSIVE ancestry(id, path) AS (
    SELECT NEW.terminal_evidence_id, ARRAY[NEW.terminal_evidence_id]::text[]
    UNION ALL
    SELECT edge.source_evidence_id, ancestry.path || edge.source_evidence_id
    FROM ancestry
    JOIN evidence_edges edge ON edge.derived_evidence_id = ancestry.id
    WHERE NOT edge.source_evidence_id = ANY(ancestry.path)
  )
  SELECT ARRAY(SELECT DISTINCT id FROM ancestry ORDER BY id)
  INTO recursive_evidence_ids;

  IF recursive_evidence_ids <> NEW.evidence_ids THEN
    RAISE EXCEPTION 'Action Semantics Evidence IDs must be the exact terminal derivation closure';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS action_semantics_report_insert_guard
ON action_semantics_reports;
CREATE TRIGGER action_semantics_report_insert_guard
BEFORE INSERT ON action_semantics_reports
FOR EACH ROW EXECUTE FUNCTION validate_action_semantics_report_insert();

CREATE OR REPLACE FUNCTION reject_action_semantics_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'action_semantics_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS action_semantics_report_update_guard
ON action_semantics_reports;
CREATE TRIGGER action_semantics_report_update_guard
BEFORE UPDATE ON action_semantics_reports
FOR EACH ROW EXECUTE FUNCTION reject_action_semantics_report_mutation();

DROP TRIGGER IF EXISTS action_semantics_report_delete_guard
ON action_semantics_reports;
CREATE TRIGGER action_semantics_report_delete_guard
BEFORE DELETE ON action_semantics_reports
FOR EACH ROW EXECUTE FUNCTION reject_action_semantics_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('025_action_semantics_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
