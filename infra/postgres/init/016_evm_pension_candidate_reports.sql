\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS evm_pension_candidate_reports (
  id text PRIMARY KEY CHECK (id ~ '^pcr_[0-9a-f]{24}$'),
  chain_id text NOT NULL CHECK (chain_id ~ '^eip155:[1-9][0-9]*$'),
  token_address text NOT NULL CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
  from_block numeric(30, 0) NOT NULL CHECK (from_block >= 0),
  to_block numeric(30, 0) NOT NULL CHECK (to_block >= from_block),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^0x[0-9a-f]{64}$'),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) >= 2),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'evm-pension-candidate-discovery-v1.0.0'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evm_pension_candidate_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS evm_pension_candidate_latest_idx
  ON evm_pension_candidate_reports (
    chain_id,
    token_address,
    to_block DESC,
    captured_at DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION validate_evm_pension_candidate_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  terminal evidence%ROWTYPE;
  terminal_snapshot analysis_snapshots%ROWTYPE;
  candidate jsonb;
  candidate_evidence evidence%ROWTYPE;
  expected_locator text;
BEGIN
  IF NEW.report ->> 'tokenAddress' IS DISTINCT FROM NEW.token_address
    OR NEW.report ->> 'fromBlock' IS DISTINCT FROM NEW.from_block::text
    OR NEW.report ->> 'toBlock' IS DISTINCT FROM NEW.to_block::text
    OR NEW.report #>> '{metadata,snapshot,ledger}' IS DISTINCT FROM 'EVM'
    OR NEW.report #>> '{metadata,snapshot,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{metadata,snapshot,blockNumber}' IS DISTINCT FROM NEW.to_block::text
    OR lower(NEW.report #>> '{metadata,snapshot,blockHash}') IS DISTINCT FROM NEW.snapshot_hash
    OR NEW.report #>> '{metadata,snapshot,finality}' IS DISTINCT FROM 'finalized'
    OR NEW.report #>> '{metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR (NEW.report #>> '{metadata,snapshot,capturedAt}')::timestamptz IS DISTINCT FROM NEW.captured_at
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR jsonb_typeof(NEW.report -> 'candidates') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'coverageEvidenceIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,evidenceIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,sourceSet}') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'EVM pension candidate report conflicts with its stored identity';
  END IF;

  IF NEW.evidence_ids <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value)
    OR NEW.source_set <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value)
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{metadata,evidenceIds}') value
      ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{metadata,sourceSet}') value
      ORDER BY value
    )
    OR EXISTS (SELECT 1 FROM unnest(NEW.evidence_ids) value WHERE value = '')
    OR EXISTS (SELECT 1 FROM unnest(NEW.source_set) value WHERE value = '')
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'EVM pension candidate report provenance arrays must be canonical';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    LEFT JOIN evidence e ON e.id = item
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION 'EVM pension candidate report references missing Evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW.report -> 'coverageEvidenceIds') item
    LEFT JOIN evidence e ON e.id = item
    WHERE e.id IS NULL
      OR e.ledger <> 'EVM'
      OR e.chain_id <> NEW.chain_id
      OR e.evidence_kind <> 'PROVIDER_OBSERVATION'
      OR NOT e.source = ANY(NEW.source_set)
      OR e.finality <> 'finalized'
  ) THEN
    RAISE EXCEPTION 'EVM pension candidate coverage Evidence conflicts with report provenance';
  END IF;

  FOR candidate IN SELECT value FROM jsonb_array_elements(NEW.report -> 'candidates') LOOP
    SELECT * INTO candidate_evidence
    FROM evidence
    WHERE id = candidate ->> 'evidenceId';
    expected_locator :=
      'pension-behavior-candidate:' || NEW.token_address || ':' ||
      (candidate ->> 'address') || ':' || NEW.from_block::text || '-' || NEW.to_block::text;
    IF NOT FOUND
      OR candidate_evidence.ledger <> 'EVM'
      OR candidate_evidence.chain_id <> NEW.chain_id
      OR candidate_evidence.evidence_kind <> 'DERIVED_FEATURE'
      OR candidate_evidence.source <> 'zerotrace:evm-pension-candidate-discovery-v1.0.0'
      OR candidate_evidence.locator <> expected_locator
      OR candidate_evidence.block_or_slot <> NEW.to_block
      OR candidate_evidence.finality <> 'finalized'
    THEN
      RAISE EXCEPTION 'EVM pension behavioral candidate Evidence conflicts with report identity';
    END IF;
    IF ARRAY(
        SELECT source_evidence_id
        FROM evidence_edges
        WHERE derived_evidence_id = candidate ->> 'evidenceId'
        ORDER BY source_evidence_id
      ) <> ARRAY(
        SELECT value
        FROM jsonb_array_elements_text(candidate -> 'transferEvidenceIds') value
        ORDER BY value
      )
    THEN
      RAISE EXCEPTION 'EVM pension behavioral candidate Evidence sources are incomplete';
    END IF;
  END LOOP;

  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  expected_locator :=
    'pension-behavior-discovery:' || NEW.token_address || ':' || NEW.from_block::text || '-' ||
    NEW.to_block::text || '@' || NEW.snapshot_hash;
  IF NOT FOUND
    OR terminal.ledger <> 'EVM'
    OR terminal.chain_id <> NEW.chain_id
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:evm-pension-candidate-discovery-v1.0.0'
    OR terminal.locator <> expected_locator
    OR terminal.block_or_slot <> NEW.to_block
    OR terminal.finality <> 'finalized'
  THEN
    RAISE EXCEPTION 'EVM pension candidate terminal Evidence conflicts with report identity';
  END IF;

  SELECT * INTO terminal_snapshot
  FROM analysis_snapshots
  WHERE id = terminal.snapshot_id;
  IF NOT FOUND
    OR terminal_snapshot.ledger <> 'EVM'
    OR terminal_snapshot.chain_id <> NEW.chain_id
    OR terminal_snapshot.block_or_slot <> NEW.to_block
    OR lower(terminal_snapshot.block_hash) <> NEW.snapshot_hash
    OR terminal_snapshot.captured_at <> NEW.captured_at
  THEN
    RAISE EXCEPTION 'EVM pension candidate terminal Evidence Snapshot conflicts with report identity';
  END IF;

  IF ARRAY(
      SELECT source_evidence_id
      FROM evidence_edges
      WHERE derived_evidence_id = NEW.terminal_evidence_id
      ORDER BY source_evidence_id
    ) <> ARRAY(
      SELECT value
      FROM unnest(NEW.evidence_ids) value
      WHERE value <> NEW.terminal_evidence_id
      ORDER BY value
    )
  THEN
    RAISE EXCEPTION 'EVM pension candidate terminal Evidence sources conflict with report provenance';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS evm_pension_candidate_report_insert_guard
ON evm_pension_candidate_reports;
CREATE TRIGGER evm_pension_candidate_report_insert_guard
BEFORE INSERT ON evm_pension_candidate_reports
FOR EACH ROW EXECUTE FUNCTION validate_evm_pension_candidate_report_insert();

CREATE OR REPLACE FUNCTION reject_evm_pension_candidate_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'evm_pension_candidate_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS evm_pension_candidate_report_update_guard
ON evm_pension_candidate_reports;
CREATE TRIGGER evm_pension_candidate_report_update_guard
BEFORE UPDATE ON evm_pension_candidate_reports
FOR EACH ROW EXECUTE FUNCTION reject_evm_pension_candidate_report_mutation();

DROP TRIGGER IF EXISTS evm_pension_candidate_report_delete_guard
ON evm_pension_candidate_reports;
CREATE TRIGGER evm_pension_candidate_report_delete_guard
BEFORE DELETE ON evm_pension_candidate_reports
FOR EACH ROW EXECUTE FUNCTION reject_evm_pension_candidate_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('016_evm_pension_candidate_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
