\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS solana_control_surface_reports (
  id text PRIMARY KEY CHECK (id ~ '^scs_[0-9a-f]{24}$'),
  chain_id text NOT NULL CHECK (chain_id = 'solana-mainnet'),
  subject_address text NOT NULL CHECK (subject_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  snapshot_slot numeric(30, 0) NOT NULL CHECK (snapshot_slot >= 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$'),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solana_control_surface_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS solana_control_surface_subject_latest_idx
  ON solana_control_surface_reports (
    chain_id,
    subject_address,
    snapshot_slot DESC,
    captured_at DESC,
    created_at DESC,
    id DESC
  );

DROP INDEX IF EXISTS evm_control_surface_subject_latest_idx;
CREATE INDEX evm_control_surface_subject_latest_idx
  ON evm_control_surface_reports (
    chain_id,
    subject_address,
    snapshot_block DESC,
    captured_at DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION validate_solana_control_surface_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  terminal evidence%ROWTYPE;
  terminal_snapshot analysis_snapshots%ROWTYPE;
  expected_locator text;
BEGIN
  IF NEW.report ->> 'ledger' IS DISTINCT FROM 'SOLANA'
    OR NEW.report ->> 'chainId' IS DISTINCT FROM NEW.chain_id
    OR NEW.report ->> 'subject' IS DISTINCT FROM NEW.subject_address
    OR NEW.report #>> '{metadata,snapshot,ledger}' IS DISTINCT FROM 'SOLANA'
    OR NEW.report #>> '{metadata,snapshot,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{metadata,snapshot,slot}' IS DISTINCT FROM NEW.snapshot_slot::text
    OR NEW.report #>> '{metadata,snapshot,blockhash}' IS DISTINCT FROM NEW.snapshot_hash
    OR NEW.report #>> '{metadata,snapshot,commitment}' IS DISTINCT FROM 'finalized'
    OR NEW.report #>> '{metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR (NEW.report #>> '{metadata,snapshot,capturedAt}')::timestamptz IS DISTINCT FROM NEW.captured_at
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR jsonb_typeof(NEW.report #> '{metadata,evidenceIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,sourceSet}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'rights') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'coverage') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'extensions') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Solana control surface report conflicts with its stored identity';
  END IF;

  IF NEW.evidence_ids <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value)
    OR NEW.source_set <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value)
    OR NEW.evidence_ids <> ARRAY(
      SELECT jsonb_array_elements_text(NEW.report #> '{metadata,evidenceIds}')
    )
    OR NEW.source_set <> ARRAY(
      SELECT jsonb_array_elements_text(NEW.report #> '{metadata,sourceSet}')
    )
    OR EXISTS (SELECT 1 FROM unnest(NEW.evidence_ids) value WHERE value = '')
    OR EXISTS (SELECT 1 FROM unnest(NEW.source_set) value WHERE value = '')
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'Solana control surface provenance arrays must be canonical';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    LEFT JOIN evidence e ON e.id = item
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Solana control surface report references missing Evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT jsonb_array_elements_text(right_item -> 'evidenceIds') AS id
      FROM jsonb_array_elements(NEW.report -> 'rights') right_item
      UNION ALL
      SELECT jsonb_array_elements_text(coverage_item -> 'evidenceIds') AS id
      FROM jsonb_array_elements(NEW.report -> 'coverage') coverage_item
      UNION ALL
      SELECT jsonb_array_elements_text(extension_item -> 'evidenceIds') AS id
      FROM jsonb_array_elements(NEW.report -> 'extensions') extension_item
    ) nested
    WHERE NOT nested.id = ANY(NEW.evidence_ids)
  ) THEN
    RAISE EXCEPTION 'Solana control surface nested Evidence is missing from provenance';
  END IF;

  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  expected_locator := 'solana-control-surface-report:' || NEW.subject_address || '@' || NEW.snapshot_hash;
  IF NOT FOUND
    OR terminal.ledger <> 'SOLANA'
    OR terminal.chain_id <> NEW.chain_id
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:' || NEW.model_version
    OR terminal.locator <> expected_locator
    OR terminal.block_or_slot <> NEW.snapshot_slot
    OR terminal.finality <> 'finalized'
  THEN
    RAISE EXCEPTION 'Solana control surface terminal Evidence conflicts with its identity';
  END IF;

  SELECT * INTO terminal_snapshot
  FROM analysis_snapshots
  WHERE id = terminal.snapshot_id;
  IF NOT FOUND
    OR terminal_snapshot.ledger <> 'SOLANA'
    OR terminal_snapshot.chain_id <> NEW.chain_id
    OR terminal_snapshot.block_or_slot <> NEW.snapshot_slot
    OR terminal_snapshot.block_hash <> NEW.snapshot_hash
    OR terminal_snapshot.captured_at <> NEW.captured_at
  THEN
    RAISE EXCEPTION 'Solana control surface terminal Evidence Snapshot conflicts with its identity';
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
    RAISE EXCEPTION 'Solana control surface terminal Evidence sources conflict with provenance';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS solana_control_surface_report_insert_guard
ON solana_control_surface_reports;
CREATE TRIGGER solana_control_surface_report_insert_guard
BEFORE INSERT ON solana_control_surface_reports
FOR EACH ROW EXECUTE FUNCTION validate_solana_control_surface_report_insert();

CREATE OR REPLACE FUNCTION reject_solana_control_surface_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'solana_control_surface_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS solana_control_surface_report_update_guard
ON solana_control_surface_reports;
CREATE TRIGGER solana_control_surface_report_update_guard
BEFORE UPDATE ON solana_control_surface_reports
FOR EACH ROW EXECUTE FUNCTION reject_solana_control_surface_report_mutation();

DROP TRIGGER IF EXISTS solana_control_surface_report_delete_guard
ON solana_control_surface_reports;
CREATE TRIGGER solana_control_surface_report_delete_guard
BEFORE DELETE ON solana_control_surface_reports
FOR EACH ROW EXECUTE FUNCTION reject_solana_control_surface_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('014_solana_control_surface_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
