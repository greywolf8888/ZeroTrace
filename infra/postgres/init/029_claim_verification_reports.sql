\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS claim_verification_reports (
  id text PRIMARY KEY CHECK (id ~ '^cvr_[0-9a-f]{24}$'),
  review_report_id text NOT NULL REFERENCES claim_rule_review_reports(id) ON DELETE RESTRICT,
  review_result_hash char(64) NOT NULL CHECK (review_result_hash ~ '^[0-9a-f]{64}$'),
  rule_id text NOT NULL CHECK (rule_id ~ '^clr_[0-9a-f]{24}$'),
  asset_id text NOT NULL CHECK (asset_id ~ '^eip155:[0-9]+:erc20:0x[0-9a-f]{40}$'),
  from_block numeric(30, 0) NOT NULL CHECK (from_block >= 0),
  to_block numeric(30, 0) NOT NULL CHECK (to_block >= from_block),
  source_observation_report_id text NOT NULL REFERENCES evm_claim_reports(id) ON DELETE RESTRICT,
  destination_observation_report_id text NOT NULL REFERENCES evm_claim_reports(id) ON DELETE RESTRICT,
  action_semantics_report_ids text[] NOT NULL DEFAULT ARRAY[]::text[]
    CHECK (cardinality(action_semantics_report_ids) = 0),
  result_hash char(64) NOT NULL UNIQUE CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  status text NOT NULL CHECK (
    status IN ('VERIFIED', 'PARTIALLY_VERIFIED', 'CONTRADICTED', 'INSUFFICIENT_DATA')
  ),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'claim-verification-observation-v0.1.0'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS claim_verification_reports_rule_latest_idx
  ON claim_verification_reports (rule_id, to_block DESC, captured_at DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS claim_verification_reports_asset_latest_idx
  ON claim_verification_reports (asset_id, to_block DESC, captured_at DESC, id DESC);

CREATE OR REPLACE FUNCTION validate_claim_verification_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  review claim_rule_review_reports%ROWTYPE;
  source_report evm_claim_reports%ROWTYPE;
  destination_report evm_claim_reports%ROWTYPE;
  terminal evidence%ROWTYPE;
  terminal_snapshot analysis_snapshots%ROWTYPE;
  expected_id text;
  expected_parents text[];
  recursive_evidence_ids text[];
BEGIN
  SELECT * INTO review FROM claim_rule_review_reports WHERE id = NEW.review_report_id;
  SELECT * INTO source_report FROM evm_claim_reports WHERE id = NEW.source_observation_report_id;
  SELECT * INTO destination_report FROM evm_claim_reports
    WHERE id = NEW.destination_observation_report_id;
  IF NOT FOUND OR review.id IS NULL OR source_report.id IS NULL OR destination_report.id IS NULL THEN
    RAISE EXCEPTION 'Claim verification references missing durable inputs';
  END IF;

  expected_id := 'cvr_' || substr(
    encode(
      digest(
        convert_to(
          '{"resultHash":"' || NEW.result_hash ||
            '","schema":"zerotrace-claim-verification-observation-report-v1"}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    1,
    24
  );

  IF NEW.id IS DISTINCT FROM expected_id
    OR NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'claim-verification-observation-report-v1'
    OR NEW.report ->> 'id' IS DISTINCT FROM NEW.id
    OR NEW.report ->> 'resultHash' IS DISTINCT FROM NEW.result_hash
    OR NEW.report ->> 'reviewReportId' IS DISTINCT FROM NEW.review_report_id
    OR NEW.report ->> 'reviewResultHash' IS DISTINCT FROM NEW.review_result_hash
    OR NEW.report ->> 'ruleId' IS DISTINCT FROM NEW.rule_id
    OR NEW.report ->> 'assetId' IS DISTINCT FROM NEW.asset_id
    OR NEW.report ->> 'fromBlock' IS DISTINCT FROM NEW.from_block::text
    OR NEW.report ->> 'toBlock' IS DISTINCT FROM NEW.to_block::text
    OR NEW.report ->> 'sourceObservationReportId'
      IS DISTINCT FROM NEW.source_observation_report_id
    OR NEW.report ->> 'destinationObservationReportId'
      IS DISTINCT FROM NEW.destination_observation_report_id
    OR NEW.report ->> 'status' IS DISTINCT FROM NEW.status
    OR NEW.report #>> '{audit,status}' IS DISTINCT FROM NEW.status
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR NEW.report #>> '{metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR (NEW.report #>> '{metadata,snapshot,capturedAt}')::timestamptz
      IS DISTINCT FROM NEW.captured_at
    OR (NEW.report #>> '{metadata,freshness}')::timestamptz IS DISTINCT FROM NEW.captured_at
    OR jsonb_typeof(NEW.report -> 'evidenceIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,evidenceIds}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{metadata,sourceSet}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'actions') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report -> 'actions') <> 0
    OR jsonb_typeof(NEW.report -> 'actionSemanticsReportIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report -> 'actionSemanticsReportIds') <> 0
    OR jsonb_typeof(NEW.report -> 'actionSemanticsTerminalEvidenceIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report -> 'actionSemanticsTerminalEvidenceIds') <> 0
    OR NEW.report #>> '{coverage,actionSemantics,state}' IS DISTINCT FROM 'unknown'
    OR NEW.report #>> '{claimTruth,state}' IS DISTINCT FROM 'unknown'
    OR NEW.report #>> '{baseAmount,state}' IS DISTINCT FROM 'unknown'
  THEN
    RAISE EXCEPTION 'Claim verification report conflicts with its stored identity';
  END IF;

  IF NEW.review_result_hash <> review.result_hash
    OR NEW.rule_id <> review.rule_id
    OR NEW.asset_id <> review.asset_id
    OR NEW.report ->> 'reviewTerminalEvidenceId' <> review.terminal_evidence_id
    OR NEW.report #>> '{audit,items,0,claim,id}' <> NEW.rule_id
    OR NEW.report #>> '{audit,items,0,claim,assetId}' <> NEW.asset_id
    OR NEW.report #>> '{sourceObservation,address}' <>
      lower(review.report #>> '{rule,sourceAddress}')
    OR NEW.report #>> '{destinationObservation,address}' <>
      lower(review.report #>> '{rule,destinationAddress}')
  THEN
    RAISE EXCEPTION 'Claim verification does not match the reviewed rule revision';
  END IF;

  IF source_report.report IS DISTINCT FROM NEW.report -> 'sourceObservation'
    OR destination_report.report IS DISTINCT FROM NEW.report -> 'destinationObservation'
    OR source_report.from_block <> NEW.from_block
    OR destination_report.from_block <> NEW.from_block
    OR source_report.to_block <> NEW.to_block
    OR destination_report.to_block <> NEW.to_block
    OR source_report.chain_id <> destination_report.chain_id
    OR source_report.token_address <> destination_report.token_address
    OR source_report.snapshot_block <> destination_report.snapshot_block
    OR source_report.snapshot_hash <> destination_report.snapshot_hash
    OR NEW.asset_id <> (source_report.chain_id || ':erc20:' || source_report.token_address)
    OR jsonb_typeof(source_report.report -> 'transfers') IS DISTINCT FROM 'array'
    OR jsonb_typeof(destination_report.report -> 'transfers') IS DISTINCT FROM 'array'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(source_report.report -> 'transfers') transfer
      WHERE (transfer ->> 'blockNumber')::numeric < NEW.from_block
        OR (transfer ->> 'blockNumber')::numeric > NEW.to_block
        OR (
          lower(transfer ->> 'from') <> source_report.subject_address
          AND lower(transfer ->> 'to') <> source_report.subject_address
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(transfer -> 'evidenceIds') evidence_id
          WHERE NOT evidence_id = ANY(source_report.evidence_ids)
        )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(destination_report.report -> 'transfers') transfer
      WHERE (transfer ->> 'blockNumber')::numeric < NEW.from_block
        OR (transfer ->> 'blockNumber')::numeric > NEW.to_block
        OR (
          lower(transfer ->> 'from') <> destination_report.subject_address
          AND lower(transfer ->> 'to') <> destination_report.subject_address
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(transfer -> 'evidenceIds') evidence_id
          WHERE NOT evidence_id = ANY(destination_report.evidence_ids)
        )
    )
    OR (
      SELECT count(*) FROM jsonb_array_elements(source_report.report -> 'transfers')
    ) <> (
      SELECT count(DISTINCT transfer ->> 'id')
      FROM jsonb_array_elements(source_report.report -> 'transfers') transfer
    )
    OR (
      SELECT count(*) FROM jsonb_array_elements(destination_report.report -> 'transfers')
    ) <> (
      SELECT count(DISTINCT transfer ->> 'id')
      FROM jsonb_array_elements(destination_report.report -> 'transfers') transfer
    )
  THEN
    RAISE EXCEPTION 'Claim verification address observations are not exact replay inputs';
  END IF;

  IF NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value
    )
    OR NEW.evidence_ids <> ARRAY(
      SELECT value FROM jsonb_array_elements_text(NEW.report -> 'evidenceIds') value ORDER BY value
    )
    OR NEW.evidence_ids <> ARRAY(
      SELECT value FROM jsonb_array_elements_text(NEW.report #> '{metadata,evidenceIds}') value
      ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT value FROM jsonb_array_elements_text(NEW.report #> '{metadata,sourceSet}') value
      ORDER BY value
    )
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
    OR EXISTS (
      SELECT 1 FROM unnest(NEW.evidence_ids) item
      LEFT JOIN evidence stored ON stored.id = item
      WHERE stored.id IS NULL
    )
  THEN
    RAISE EXCEPTION 'Claim verification provenance arrays are not canonical and durable';
  END IF;

  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  SELECT * INTO terminal_snapshot FROM analysis_snapshots WHERE id = terminal.snapshot_id;
  IF terminal.id IS NULL
    OR terminal_snapshot.id IS NULL
    OR terminal.ledger <> 'EVM'
    OR terminal.chain_id <> source_report.chain_id
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:' || NEW.model_version
    OR terminal.locator <> 'claim-verification-observation:' || NEW.id || ':' || NEW.result_hash
    OR terminal.observed_at <> NEW.captured_at
    OR terminal.block_or_slot <> source_report.snapshot_block
    OR terminal.finality <> 'finalized'
    OR terminal_snapshot.ledger <> 'EVM'
    OR terminal_snapshot.chain_id <> source_report.chain_id
    OR terminal_snapshot.block_or_slot <> source_report.snapshot_block
    OR terminal_snapshot.block_hash <> source_report.snapshot_hash
    OR terminal_snapshot.captured_at <> NEW.captured_at
    OR terminal_snapshot.payload IS DISTINCT FROM NEW.report #> '{metadata,snapshot}'
  THEN
    RAISE EXCEPTION 'Claim verification terminal Evidence or Snapshot conflicts';
  END IF;

  expected_parents := ARRAY[
    review.terminal_evidence_id,
    source_report.terminal_evidence_id,
    destination_report.terminal_evidence_id
  ];
  expected_parents := ARRAY(
    SELECT DISTINCT value FROM unnest(expected_parents) value ORDER BY value
  );
  IF expected_parents <> ARRAY(
      SELECT source_evidence_id FROM evidence_edges
      WHERE derived_evidence_id = NEW.terminal_evidence_id
      ORDER BY source_evidence_id
    )
  THEN
    RAISE EXCEPTION 'Claim verification terminal Evidence parents are incomplete';
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
    RAISE EXCEPTION 'Claim verification Evidence ids must equal terminal derivation closure';
  END IF;

  IF EXISTS (
      SELECT 1 FROM evidence stored
      WHERE stored.id = ANY(NEW.evidence_ids)
        AND (
          stored.ledger <> 'EVM'
          OR stored.chain_id <> source_report.chain_id
          OR (stored.block_or_slot IS NOT NULL AND stored.block_or_slot > source_report.snapshot_block)
          OR stored.observed_at > NEW.captured_at
        )
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT stored.source
      FROM evidence stored
      WHERE stored.id = ANY(NEW.evidence_ids)
        AND stored.evidence_kind NOT IN ('DERIVED_FEATURE', 'NEGATIVE_EVIDENCE')
      ORDER BY stored.source
    )
  THEN
    RAISE EXCEPTION 'Claim verification Evidence chain/time bounds or source set conflict';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS claim_verification_report_insert_guard ON claim_verification_reports;
CREATE TRIGGER claim_verification_report_insert_guard
BEFORE INSERT ON claim_verification_reports
FOR EACH ROW EXECUTE FUNCTION validate_claim_verification_report_insert();

CREATE OR REPLACE FUNCTION reject_claim_verification_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'claim_verification_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS claim_verification_report_update_guard ON claim_verification_reports;
CREATE TRIGGER claim_verification_report_update_guard
BEFORE UPDATE ON claim_verification_reports
FOR EACH ROW EXECUTE FUNCTION reject_claim_verification_report_mutation();
DROP TRIGGER IF EXISTS claim_verification_report_delete_guard ON claim_verification_reports;
CREATE TRIGGER claim_verification_report_delete_guard
BEFORE DELETE ON claim_verification_reports
FOR EACH ROW EXECUTE FUNCTION reject_claim_verification_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('029_claim_verification_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
