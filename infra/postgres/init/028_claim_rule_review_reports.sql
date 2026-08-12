\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS claim_rule_review_reports (
  id text PRIMARY KEY CHECK (id ~ '^crr_[0-9a-f]{24}$'),
  declaration_report_id text NOT NULL
    REFERENCES claim_declaration_reports(id) ON DELETE RESTRICT,
  declaration_result_hash char(64) NOT NULL
    CHECK (declaration_result_hash ~ '^[0-9a-f]{64}$'),
  document_hash char(64) NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  draft_id text NOT NULL CHECK (draft_id ~ '^cld_[0-9a-f]{24}$'),
  rule_id text NOT NULL UNIQUE CHECK (rule_id ~ '^clr_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (length(chain_id) BETWEEN 1 AND 128),
  asset_id text NOT NULL CHECK (length(asset_id) BETWEEN 1 AND 512),
  result_hash char(64) NOT NULL UNIQUE CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  review_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  token_decimals_evidence_id text REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) BETWEEN 4 AND 5),
  source_set text[] NOT NULL CHECK (cardinality(source_set) BETWEEN 2 AND 3),
  model_version text NOT NULL CHECK (length(model_version) BETWEEN 1 AND 160),
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_rule_review_reports_evm_asset_check CHECK (
    ledger = 'EVM'
    AND asset_id ~ '^eip155:[1-9][0-9]*:erc20:0x[0-9a-f]{40}$'
    AND asset_id LIKE chain_id || ':%'
  )
);

CREATE INDEX IF NOT EXISTS claim_rule_review_reports_asset_latest_idx
  ON claim_rule_review_reports (asset_id, reviewed_at DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS claim_rule_review_reports_draft_latest_idx
  ON claim_rule_review_reports (
    declaration_report_id,
    draft_id,
    reviewed_at DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION validate_claim_rule_review_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  declaration claim_declaration_reports%ROWTYPE;
  review_observation evidence%ROWTYPE;
  terminal evidence%ROWTYPE;
  decimals evidence%ROWTYPE;
  expected_id text;
  expected_terminal_sources text[];
  actual_terminal_sources text[];
  expected_source_set text[];
BEGIN
  IF jsonb_typeof(NEW.report -> 'declarationDraft') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.report -> 'rule') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.report -> 'fieldOrigins') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'evidenceIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'declarationEvidenceIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'sourceSet') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Claim rule review report structure is incomplete';
  END IF;

  SELECT * INTO declaration
  FROM claim_declaration_reports
  WHERE id = NEW.declaration_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim rule review source declaration is missing';
  END IF;

  expected_id := 'crr_' || substr(
    encode(
      digest(
        convert_to(
          '{"resultHash":"' || NEW.result_hash ||
            '","schema":"zerotrace-claim-rule-review-report-v1"}',
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
    OR NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'claim-rule-review-report-v1'
    OR NEW.report ->> 'id' IS DISTINCT FROM NEW.id
    OR NEW.report ->> 'resultHash' IS DISTINCT FROM NEW.result_hash
    OR NEW.report ->> 'declarationReportId' IS DISTINCT FROM NEW.declaration_report_id
    OR NEW.report ->> 'declarationResultHash' IS DISTINCT FROM NEW.declaration_result_hash
    OR NEW.report ->> 'documentHash' IS DISTINCT FROM NEW.document_hash
    OR NEW.report ->> 'draftId' IS DISTINCT FROM NEW.draft_id
    OR NEW.report ->> 'assetId' IS DISTINCT FROM NEW.asset_id
    OR NEW.report #>> '{declarationDraft,id}' IS DISTINCT FROM NEW.draft_id
    OR NEW.report #>> '{declarationDraft,assetId}' IS DISTINCT FROM NEW.asset_id
    OR NEW.report #>> '{rule,id}' IS DISTINCT FROM NEW.rule_id
    OR NEW.report #>> '{rule,assetId}' IS DISTINCT FROM NEW.asset_id
    OR NEW.report ->> 'reviewEvidenceId' IS DISTINCT FROM NEW.review_evidence_id
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR NEW.report ->> 'tokenDecimalsEvidenceId'
      IS DISTINCT FROM NEW.token_decimals_evidence_id
    OR NEW.report ->> 'modelVersion' IS DISTINCT FROM NEW.model_version
    OR (NEW.report ->> 'reviewedAt')::timestamptz IS DISTINCT FROM NEW.reviewed_at
    OR (NEW.report ->> 'freshness')::timestamptz IS DISTINCT FROM NEW.reviewed_at
    OR NEW.report #>> '{coverage,sourceDocument}' IS DISTINCT FROM '1'
    OR NEW.report #>> '{coverage,humanReview}' IS DISTINCT FROM '1'
    OR NEW.report #>> '{coverage,fieldCompleteness}' IS DISTINCT FROM '1'
    OR NEW.report #>> '{coverage,chainVerification,state}' IS DISTINCT FROM 'unknown'
    OR NEW.report #>> '{claimTruth,state}' IS DISTINCT FROM 'unknown'
    OR NEW.report #>> '{reviewerAuthority,state}' IS DISTINCT FROM 'unknown'
    OR NEW.report #>> '{confidence,state}' IS DISTINCT FROM 'unknown'
    OR NEW.report ->> 'requiresChainVerification' IS DISTINCT FROM 'true'
    OR declaration.result_hash IS DISTINCT FROM NEW.declaration_result_hash
    OR declaration.document_hash IS DISTINCT FROM NEW.document_hash
    OR declaration.asset_id IS DISTINCT FROM NEW.asset_id
    OR declaration.ledger IS DISTINCT FROM NEW.ledger
    OR declaration.chain_id IS DISTINCT FROM NEW.chain_id
    OR NOT (declaration.report -> 'drafts' @> jsonb_build_array(NEW.report -> 'declarationDraft'))
  THEN
    RAISE EXCEPTION 'Claim rule review conflicts with its identity or source declaration';
  END IF;

  IF NEW.evidence_ids <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value)
    OR NEW.source_set <>
      ARRAY(SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value)
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report -> 'evidenceIds') value
      ORDER BY value
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report -> 'sourceSet') value
      ORDER BY value
    )
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT item ->> 'id'
      FROM jsonb_array_elements(NEW.report -> 'evidence') item
      ORDER BY item ->> 'id'
    )
    OR declaration.evidence_ids <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report -> 'declarationEvidenceIds') value
      ORDER BY value
    )
    OR ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{rule,claimEvidenceIds}') value
      ORDER BY value
    ) <> ARRAY(
      SELECT value FROM unnest(NEW.evidence_ids) value
      WHERE value <> NEW.terminal_evidence_id
      ORDER BY value
    )
  THEN
    RAISE EXCEPTION 'Claim rule review provenance arrays are not canonical';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report -> 'evidence') item
    LEFT JOIN evidence stored ON stored.id = item ->> 'id'
    WHERE stored.id IS NULL
      OR item ->> 'ledger' IS DISTINCT FROM stored.ledger::text
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
    RAISE EXCEPTION 'Claim rule review embedded Evidence conflicts with durable Evidence';
  END IF;

  SELECT * INTO review_observation FROM evidence WHERE id = NEW.review_evidence_id;
  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  IF NOT FOUND
    OR review_observation.id IS NULL
    OR review_observation.ledger <> NEW.ledger
    OR review_observation.chain_id <> NEW.chain_id
    OR review_observation.evidence_kind <> 'ANALYST_OBSERVATION'
    OR review_observation.locator <>
      'claim-rule-review:' || NEW.declaration_report_id || ':' || NEW.draft_id
    OR review_observation.observed_at <> NEW.reviewed_at
    OR review_observation.source = declaration.source_set[1]
    OR review_observation.snapshot_id IS NOT NULL
    OR terminal.ledger <> NEW.ledger
    OR terminal.chain_id <> NEW.chain_id
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:' || NEW.model_version
    OR terminal.locator <> 'claim-rule-review-report:' || NEW.id || ':' || NEW.result_hash
    OR terminal.observed_at <> NEW.reviewed_at
    OR terminal.snapshot_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Claim rule review direct or terminal Evidence conflicts';
  END IF;

  IF NEW.token_decimals_evidence_id IS NULL THEN
    IF NEW.report #>> '{tokenDecimals,state}' IS NOT DISTINCT FROM 'known' THEN
      RAISE EXCEPTION 'Claim rule review decimals state conflicts';
    END IF;
  ELSE
    SELECT * INTO decimals FROM evidence WHERE id = NEW.token_decimals_evidence_id;
    IF NOT FOUND
      OR NEW.report #>> '{tokenDecimals,state}' IS DISTINCT FROM 'known'
      OR decimals.ledger <> NEW.ledger
      OR decimals.chain_id <> NEW.chain_id
      OR decimals.evidence_kind NOT IN ('CONTRACT_STATE', 'RAW_RPC_RESPONSE')
      OR decimals.locator <> 'token-decimals:' || NEW.asset_id
      OR decimals.observed_at > NEW.reviewed_at
      OR decimals.block_or_slot IS NULL
      OR decimals.finality <> 'finalized'
      OR decimals.snapshot_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM analysis_snapshots snapshot
        WHERE snapshot.id = decimals.snapshot_id
          AND snapshot.ledger = NEW.ledger
          AND snapshot.chain_id = NEW.chain_id
          AND snapshot.block_or_slot = decimals.block_or_slot
          AND snapshot.captured_at = decimals.observed_at
      )
    THEN
      RAISE EXCEPTION 'Claim rule review token-decimals Evidence conflicts';
    END IF;
  END IF;

  expected_terminal_sources := ARRAY[
    declaration.terminal_evidence_id,
    NEW.review_evidence_id
  ];
  IF NEW.token_decimals_evidence_id IS NOT NULL THEN
    expected_terminal_sources :=
      array_append(expected_terminal_sources, NEW.token_decimals_evidence_id);
  END IF;
  expected_terminal_sources := ARRAY(
    SELECT DISTINCT value FROM unnest(expected_terminal_sources) value ORDER BY value
  );
  actual_terminal_sources := ARRAY(
    SELECT source_evidence_id
    FROM evidence_edges
    WHERE derived_evidence_id = NEW.terminal_evidence_id
    ORDER BY source_evidence_id
  );
  IF actual_terminal_sources <> expected_terminal_sources
    OR EXISTS (
      SELECT 1 FROM evidence_edges WHERE derived_evidence_id = NEW.review_evidence_id
    )
  THEN
    RAISE EXCEPTION 'Claim rule review Evidence closure is incomplete';
  END IF;

  expected_source_set := ARRAY(
    SELECT DISTINCT source
    FROM evidence
    WHERE id = ANY(NEW.evidence_ids)
      AND evidence_kind NOT IN ('DERIVED_FEATURE', 'NEGATIVE_EVIDENCE')
    ORDER BY source
  );
  IF expected_source_set <> NEW.source_set THEN
    RAISE EXCEPTION 'Claim rule review source set conflicts with durable Evidence';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS claim_rule_review_report_insert_guard
ON claim_rule_review_reports;
CREATE TRIGGER claim_rule_review_report_insert_guard
BEFORE INSERT ON claim_rule_review_reports
FOR EACH ROW EXECUTE FUNCTION validate_claim_rule_review_report_insert();

CREATE OR REPLACE FUNCTION reject_claim_rule_review_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'claim_rule_review_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS claim_rule_review_report_update_guard
ON claim_rule_review_reports;
CREATE TRIGGER claim_rule_review_report_update_guard
BEFORE UPDATE ON claim_rule_review_reports
FOR EACH ROW EXECUTE FUNCTION reject_claim_rule_review_report_mutation();

DROP TRIGGER IF EXISTS claim_rule_review_report_delete_guard
ON claim_rule_review_reports;
CREATE TRIGGER claim_rule_review_report_delete_guard
BEFORE DELETE ON claim_rule_review_reports
FOR EACH ROW EXECUTE FUNCTION reject_claim_rule_review_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('028_claim_rule_review_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
