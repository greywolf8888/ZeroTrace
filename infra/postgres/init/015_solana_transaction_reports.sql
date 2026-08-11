\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS solana_transaction_reports (
  id text PRIMARY KEY CHECK (id ~ '^str_[0-9a-f]{24}$'),
  chain_id text NOT NULL CHECK (chain_id = 'solana-mainnet'),
  signature text NOT NULL CHECK (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$'),
  snapshot_slot numeric(30, 0) NOT NULL CHECK (snapshot_slot >= 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$'),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) >= 2),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'solana-transaction-query-v1.1.0'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solana_transaction_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS solana_transaction_signature_latest_idx
  ON solana_transaction_reports (
    chain_id,
    signature,
    snapshot_slot DESC,
    captured_at DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION validate_solana_transaction_report_insert()
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
    OR NEW.report ->> 'signature' IS DISTINCT FROM NEW.signature
    OR NEW.report #>> '{subject,ledger}' IS DISTINCT FROM 'SOLANA'
    OR NEW.report #>> '{subject,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{subject,type}' IS DISTINCT FROM 'TRANSACTION'
    OR NEW.report #>> '{subject,id}' IS DISTINCT FROM NEW.signature
    OR NEW.report #>> '{subject,normalizedId}' IS DISTINCT FROM NEW.signature
    OR NEW.report #>> '{facts,status,state}' IS DISTINCT FROM 'known'
    OR NEW.report #>> '{facts,status,value}' IS DISTINCT FROM 'CONFIRMED'
    OR NEW.report #>> '{facts,slot,state}' IS DISTINCT FROM 'known'
    OR NEW.report #>> '{facts,slot,value}' IS DISTINCT FROM NEW.snapshot_slot::text
    OR NEW.report #>> '{facts,transactionSemantics,state}' IS DISTINCT FROM 'known'
    OR NEW.report #>> '{facts,transactionSemantics,value,signature}' IS DISTINCT FROM NEW.signature
    OR NEW.report #>> '{metadata,snapshot,ledger}' IS DISTINCT FROM 'SOLANA'
    OR NEW.report #>> '{metadata,snapshot,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{metadata,snapshot,slot}' IS DISTINCT FROM NEW.snapshot_slot::text
    OR NEW.report #>> '{metadata,snapshot,blockhash}' IS DISTINCT FROM NEW.snapshot_hash
    OR NEW.report #>> '{metadata,snapshot,commitment}' IS DISTINCT FROM 'finalized'
    OR NEW.report #>> '{metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR (NEW.report #>> '{metadata,snapshot,capturedAt}')::timestamptz IS DISTINCT FROM NEW.captured_at
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,evidenceIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,sourceSet}') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Solana transaction report conflicts with its stored identity';
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
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT item ->> 'id'
      FROM jsonb_array_elements(NEW.report -> 'evidence') item
      ORDER BY item ->> 'id'
    )
    OR NEW.source_set <> ARRAY(
      SELECT value
      FROM jsonb_array_elements_text(NEW.report #> '{metadata,sourceSet}') value
      ORDER BY value
    )
    OR EXISTS (SELECT 1 FROM unnest(NEW.evidence_ids) value WHERE value = '')
    OR EXISTS (SELECT 1 FROM unnest(NEW.source_set) value WHERE value = '')
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'Solana transaction report provenance arrays must be canonical';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    LEFT JOIN evidence e ON e.id = item
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Solana transaction report references missing Evidence';
  END IF;

  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  expected_locator := 'transaction-semantics:' || NEW.signature || '@' || NEW.snapshot_slot::text;
  IF NOT FOUND
    OR terminal.ledger <> 'SOLANA'
    OR terminal.chain_id <> NEW.chain_id
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:solana-transaction-semantics-v1.1.0'
    OR terminal.locator <> expected_locator
    OR terminal.block_or_slot <> NEW.snapshot_slot
    OR terminal.finality <> 'finalized'
  THEN
    RAISE EXCEPTION 'Solana transaction terminal Evidence conflicts with report identity';
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
    RAISE EXCEPTION 'Solana transaction terminal Evidence Snapshot conflicts with report identity';
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
    RAISE EXCEPTION 'Solana transaction terminal Evidence sources conflict with report provenance';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS solana_transaction_report_insert_guard
ON solana_transaction_reports;
CREATE TRIGGER solana_transaction_report_insert_guard
BEFORE INSERT ON solana_transaction_reports
FOR EACH ROW EXECUTE FUNCTION validate_solana_transaction_report_insert();

CREATE OR REPLACE FUNCTION reject_solana_transaction_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'solana_transaction_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS solana_transaction_report_update_guard
ON solana_transaction_reports;
CREATE TRIGGER solana_transaction_report_update_guard
BEFORE UPDATE ON solana_transaction_reports
FOR EACH ROW EXECUTE FUNCTION reject_solana_transaction_report_mutation();

DROP TRIGGER IF EXISTS solana_transaction_report_delete_guard
ON solana_transaction_reports;
CREATE TRIGGER solana_transaction_report_delete_guard
BEFORE DELETE ON solana_transaction_reports
FOR EACH ROW EXECUTE FUNCTION reject_solana_transaction_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('015_solana_transaction_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
