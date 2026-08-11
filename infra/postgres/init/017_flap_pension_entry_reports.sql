\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS flap_pension_entry_reports (
  id text PRIMARY KEY CHECK (id ~ '^per_[0-9a-f]{24}$'),
  chain_id text NOT NULL CHECK (chain_id = 'eip155:56'),
  token_address text NOT NULL CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
  pension_report_id text NOT NULL REFERENCES evm_pension_candidate_reports(id) ON DELETE RESTRICT,
  pension_wallet text NOT NULL CHECK (pension_wallet ~ '^0x[0-9a-f]{40}$'),
  block_number numeric(30, 0) NOT NULL CHECK (block_number >= 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^0x[0-9a-f]{64}$'),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) >= 4),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'flap-pension-entry-economics-v0.1.0'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flap_pension_entry_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS flap_pension_entry_latest_idx
  ON flap_pension_entry_reports (
    chain_id,
    token_address,
    block_number DESC,
    captured_at DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION validate_flap_pension_entry_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  behavior_report evm_pension_candidate_reports%ROWTYPE;
  terminal evidence%ROWTYPE;
  terminal_snapshot analysis_snapshots%ROWTYPE;
  expected_locator text;
  quote_inputs text;
BEGIN
  IF NEW.report ->> 'platform' IS DISTINCT FROM 'flap'
    OR NEW.report ->> 'token' IS DISTINCT FROM NEW.token_address
    OR NEW.report #>> '{behavior,reportId}' IS DISTINCT FROM NEW.pension_report_id
    OR NEW.report #>> '{behavior,wallet}' IS DISTINCT FROM NEW.pension_wallet
    OR NEW.report #>> '{metadata,snapshot,ledger}' IS DISTINCT FROM 'EVM'
    OR NEW.report #>> '{metadata,snapshot,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{metadata,snapshot,blockNumber}' IS DISTINCT FROM NEW.block_number::text
    OR lower(NEW.report #>> '{metadata,snapshot,blockHash}') IS DISTINCT FROM NEW.snapshot_hash
    OR NEW.report #>> '{metadata,snapshot,finality}' IS DISTINCT FROM 'finalized'
    OR NEW.report #>> '{metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR (NEW.report #>> '{metadata,snapshot,capturedAt}')::timestamptz IS DISTINCT FROM NEW.captured_at
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR NEW.report ->> 'destinationTreatment' IS DISTINCT FROM 'NON_ZERO_CUSTODY_ADDRESS'
    OR jsonb_typeof(NEW.report -> 'entries') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report -> 'entries') = 0
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,evidenceIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,sourceSet}') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Flap pension entry report conflicts with its stored identity';
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
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{metadata,sourceSet}') value
      ORDER BY value
    )
    OR EXISTS (SELECT 1 FROM unnest(NEW.evidence_ids) value WHERE value = '')
    OR EXISTS (SELECT 1 FROM unnest(NEW.source_set) value WHERE value = '')
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'Flap pension entry report provenance arrays must be canonical and complete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    LEFT JOIN evidence e ON e.id = item
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Flap pension entry report references missing Evidence';
  END IF;

  SELECT * INTO behavior_report
  FROM evm_pension_candidate_reports
  WHERE id = NEW.pension_report_id;
  IF NOT FOUND
    OR behavior_report.chain_id <> NEW.chain_id
    OR behavior_report.token_address <> NEW.token_address
    OR behavior_report.terminal_evidence_id <> NEW.report #>> '{behavior,reportTerminalEvidenceId}'
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(behavior_report.report -> 'candidates') candidate
      WHERE candidate ->> 'address' = NEW.pension_wallet
        AND candidate ->> 'evidenceId' = NEW.report #>> '{behavior,candidateEvidenceId}'
    )
  THEN
    RAISE EXCEPTION 'Flap pension entry behavior reference conflicts with durable candidate report';
  END IF;

  SELECT string_agg(entry #>> '{buyScenario,quoteInput,atomic}', ',' ORDER BY ordinality)
    INTO quote_inputs
  FROM jsonb_array_elements(NEW.report -> 'entries') WITH ORDINALITY AS points(entry, ordinality);
  expected_locator :=
    'rv:flap-pension-entry:' || NEW.token_address || ':' || NEW.pension_wallet || ':' ||
    quote_inputs || '@' || NEW.block_number::text;
  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  IF NOT FOUND
    OR terminal.ledger <> 'EVM'
    OR terminal.chain_id <> NEW.chain_id
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:flap-pension-entry-economics-v0.1.0'
    OR terminal.locator <> expected_locator
    OR terminal.block_or_slot <> NEW.block_number
    OR terminal.finality <> 'finalized'
  THEN
    RAISE EXCEPTION 'Flap pension entry terminal Evidence conflicts with report identity';
  END IF;

  SELECT * INTO terminal_snapshot
  FROM analysis_snapshots
  WHERE id = terminal.snapshot_id;
  IF NOT FOUND
    OR terminal_snapshot.ledger <> 'EVM'
    OR terminal_snapshot.chain_id <> NEW.chain_id
    OR terminal_snapshot.block_or_slot <> NEW.block_number
    OR lower(terminal_snapshot.block_hash) <> NEW.snapshot_hash
    OR terminal_snapshot.captured_at <> NEW.captured_at
  THEN
    RAISE EXCEPTION 'Flap pension entry terminal Evidence Snapshot conflicts with report identity';
  END IF;

  IF (SELECT count(*) FROM evidence_edges WHERE derived_evidence_id = NEW.terminal_evidence_id) <> 3
    OR NOT EXISTS (
      SELECT 1 FROM evidence_edges
      WHERE derived_evidence_id = NEW.terminal_evidence_id
        AND source_evidence_id = NEW.report #>> '{behavior,candidateEvidenceId}'
    )
    OR NOT EXISTS (
      SELECT 1 FROM evidence_edges
      WHERE derived_evidence_id = NEW.terminal_evidence_id
        AND source_evidence_id = NEW.report #>> '{behavior,reportTerminalEvidenceId}'
    )
    OR (SELECT count(*)
        FROM evidence_edges edge
        JOIN evidence source ON source.id = edge.source_evidence_id
        WHERE edge.derived_evidence_id = NEW.terminal_evidence_id
          AND source.source = 'zerotrace:flap-pancake-v2-pool-buy-scenarios-v0.1.0') <> 1
  THEN
    RAISE EXCEPTION 'Flap pension entry terminal Evidence parents are incomplete';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS flap_pension_entry_report_insert_guard
ON flap_pension_entry_reports;
CREATE TRIGGER flap_pension_entry_report_insert_guard
BEFORE INSERT ON flap_pension_entry_reports
FOR EACH ROW EXECUTE FUNCTION validate_flap_pension_entry_report_insert();

CREATE OR REPLACE FUNCTION reject_flap_pension_entry_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'flap_pension_entry_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS flap_pension_entry_report_update_guard
ON flap_pension_entry_reports;
CREATE TRIGGER flap_pension_entry_report_update_guard
BEFORE UPDATE ON flap_pension_entry_reports
FOR EACH ROW EXECUTE FUNCTION reject_flap_pension_entry_report_mutation();

DROP TRIGGER IF EXISTS flap_pension_entry_report_delete_guard
ON flap_pension_entry_reports;
CREATE TRIGGER flap_pension_entry_report_delete_guard
BEFORE DELETE ON flap_pension_entry_reports
FOR EACH ROW EXECUTE FUNCTION reject_flap_pension_entry_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('017_flap_pension_entry_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
