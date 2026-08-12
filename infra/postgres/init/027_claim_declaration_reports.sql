\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS claim_declaration_reports (
  id text PRIMARY KEY CHECK (id ~ '^cdr_[0-9a-f]{24}$'),
  source_snapshot_id text NOT NULL CHECK (source_snapshot_id ~ '^csd_[0-9a-f]{24}$'),
  document_hash char(64) NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (length(chain_id) BETWEEN 1 AND 128),
  asset_id text NOT NULL CHECK (length(asset_id) BETWEEN 1 AND 512),
  result_hash char(64) NOT NULL UNIQUE CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  source_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) = 2),
  source_set text[] NOT NULL CHECK (cardinality(source_set) = 1),
  model_version text NOT NULL CHECK (length(model_version) BETWEEN 1 AND 160),
  freshness timestamptz NOT NULL,
  field_extraction_coverage double precision
    CHECK (field_extraction_coverage BETWEEN 0 AND 1),
  extraction_confidence double precision
    CHECK (extraction_confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_declaration_reports_evm_asset_check CHECK (
    ledger = 'EVM'
    AND asset_id ~ '^eip155:[1-9][0-9]*:erc20:0x[0-9a-f]{40}$'
    AND asset_id LIKE chain_id || ':%'
  )
);

CREATE INDEX IF NOT EXISTS claim_declaration_reports_asset_latest_idx
  ON claim_declaration_reports (asset_id, freshness DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS claim_declaration_reports_document_idx
  ON claim_declaration_reports (document_hash, asset_id, freshness DESC, id DESC);

CREATE OR REPLACE FUNCTION validate_claim_declaration_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_observation evidence%ROWTYPE;
  terminal evidence%ROWTYPE;
  expected_id text;
  expected_terminal_locator text;
BEGIN
  IF jsonb_typeof(NEW.report -> 'sourceSnapshot') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.report -> 'terminalEvidence') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.report -> 'evidenceIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'sourceSet') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'drafts') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'warnings') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'unmatchedAddresses') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Claim declaration report structure is incomplete';
  END IF;

  expected_id := 'cdr_' || substr(
    encode(
      digest(
        convert_to(
          '{"resultHash":"' || NEW.result_hash ||
            '","schema":"zerotrace-claim-declaration-report-v1"}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    1,
    24
  );
  expected_terminal_locator :=
    'claim-declaration-report:' || NEW.id || ':' || NEW.result_hash;

  IF NEW.id IS DISTINCT FROM expected_id
    OR NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'claim-declaration-report-v1'
    OR NEW.report ->> 'id' IS DISTINCT FROM NEW.id
    OR NEW.report ->> 'resultHash' IS DISTINCT FROM NEW.result_hash
    OR NEW.report ->> 'documentHash' IS DISTINCT FROM NEW.document_hash
    OR NEW.report #>> '{sourceSnapshot,id}' IS DISTINCT FROM NEW.source_snapshot_id
    OR NEW.source_snapshot_id IS DISTINCT FROM 'csd_' || substr(NEW.document_hash, 1, 24)
    OR NEW.report #>> '{sourceSnapshot,schemaVersion}'
      IS DISTINCT FROM 'claim-source-document-snapshot-v1'
    OR NEW.report #>> '{sourceSnapshot,documentHash}' IS DISTINCT FROM NEW.document_hash
    OR NEW.report #>> '{sourceSnapshot,contentHash}' IS DISTINCT FROM NEW.content_hash
    OR coalesce(length(NEW.report #>> '{sourceSnapshot,content}'), 0) = 0
    OR NEW.report #>> '{sourceSnapshot,capturedAt}' IS NULL
    OR (NEW.report #>> '{sourceSnapshot,capturedAt}')::timestamptz IS DISTINCT FROM NEW.freshness
    OR NEW.report #>> '{sourceSnapshot,offsetEncoding}' IS DISTINCT FROM 'UTF16_CODE_UNITS'
    OR NEW.report ->> 'assetId' IS DISTINCT FROM NEW.asset_id
    OR NEW.report ->> 'modelVersion' IS DISTINCT FROM NEW.model_version
    OR NEW.report ->> 'parserVersion' IS DISTINCT FROM NEW.model_version
    OR (NEW.report ->> 'freshness')::timestamptz IS DISTINCT FROM NEW.freshness
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR NEW.report #>> '{coverage,documentCapture}' IS DISTINCT FROM '1'
    OR NEW.report #>> '{coverage,chainVerification,state}' IS DISTINCT FROM 'unknown'
    OR NEW.report #>> '{coverage,chainVerification,reason}' IS DISTINCT FROM 'NOT_QUERIED'
  THEN
    RAISE EXCEPTION 'Claim declaration report conflicts with its stored identity';
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
    OR NOT NEW.source_evidence_id = ANY(NEW.evidence_ids)
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
    OR NEW.source_set[1] IS DISTINCT FROM NEW.report #>> '{sourceSnapshot,source}'
  THEN
    RAISE EXCEPTION 'Claim declaration provenance arrays are not canonical';
  END IF;

  IF NEW.field_extraction_coverage IS DISTINCT FROM (CASE
      WHEN (NEW.report #>> '{coverage,fieldExtraction,state}') = 'known'
      THEN (NEW.report #>> '{coverage,fieldExtraction,value}')::double precision
      ELSE NULL
    END)
    OR NEW.extraction_confidence IS DISTINCT FROM (CASE
      WHEN (NEW.report #>> '{extractionConfidence,state}') = 'known'
      THEN (NEW.report #>> '{extractionConfidence,value}')::double precision
      ELSE NULL
    END)
  THEN
    RAISE EXCEPTION 'Claim declaration coverage metadata conflicts';
  END IF;

  SELECT * INTO source_observation FROM evidence WHERE id = NEW.source_evidence_id;
  IF NOT FOUND
    OR source_observation.ledger <> NEW.ledger
    OR source_observation.chain_id <> NEW.chain_id
    OR source_observation.evidence_kind <> 'ANALYST_OBSERVATION'
    OR source_observation.source <> NEW.source_set[1]
    OR source_observation.source_uri IS DISTINCT FROM NEW.report #>> '{sourceSnapshot,sourceUri}'
    OR source_observation.locator <> 'claim-declaration:' || NEW.document_hash
    OR source_observation.observed_at <> NEW.freshness
    OR source_observation.snapshot_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Claim declaration source Evidence conflicts with source Snapshot';
  END IF;

  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  IF NOT FOUND
    OR terminal.ledger <> NEW.ledger
    OR terminal.chain_id <> NEW.chain_id
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:' || NEW.model_version
    OR terminal.locator <> expected_terminal_locator
    OR terminal.observed_at <> NEW.freshness
    OR terminal.snapshot_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Claim declaration terminal Evidence conflicts with report';
  END IF;

  IF ARRAY(
      SELECT source_evidence_id
      FROM evidence_edges
      WHERE derived_evidence_id = NEW.terminal_evidence_id
      ORDER BY source_evidence_id
    ) <> ARRAY[NEW.source_evidence_id]
    OR EXISTS (
      SELECT 1 FROM evidence_edges WHERE derived_evidence_id = NEW.source_evidence_id
    )
  THEN
    RAISE EXCEPTION 'Claim declaration Evidence closure is incomplete';
  END IF;

  IF NEW.report #>> '{evidence,id}' IS DISTINCT FROM NEW.source_evidence_id
    OR NEW.report #>> '{terminalEvidence,id}' IS DISTINCT FROM NEW.terminal_evidence_id
    OR NEW.report #>> '{evidence,ledger}' IS DISTINCT FROM source_observation.ledger::text
    OR NEW.report #>> '{evidence,chainId}' IS DISTINCT FROM source_observation.chain_id
    OR NEW.report #>> '{evidence,kind}' IS DISTINCT FROM source_observation.evidence_kind
    OR NEW.report #>> '{evidence,source}' IS DISTINCT FROM source_observation.source
    OR NEW.report #>> '{evidence,locator}' IS DISTINCT FROM source_observation.locator
    OR NEW.report #>> '{evidence,sourceUri}' IS DISTINCT FROM source_observation.source_uri
    OR NEW.report #>> '{evidence,payloadHash}' IS DISTINCT FROM source_observation.payload_hash
    OR (NEW.report #>> '{evidence,observedAt}')::timestamptz
      IS DISTINCT FROM source_observation.observed_at
    OR NEW.report #>> '{evidence,blockOrSlot}' IS DISTINCT FROM source_observation.block_or_slot::text
    OR NEW.report #>> '{evidence,finality}' IS DISTINCT FROM source_observation.finality
    OR NEW.report #>> '{evidence,summary}' IS DISTINCT FROM source_observation.summary
    OR NEW.report #>> '{evidence,rawArtifactRef}'
      IS DISTINCT FROM source_observation.raw_artifact_ref
    OR NEW.report #>> '{terminalEvidence,ledger}' IS DISTINCT FROM terminal.ledger::text
    OR NEW.report #>> '{terminalEvidence,chainId}' IS DISTINCT FROM terminal.chain_id
    OR NEW.report #>> '{terminalEvidence,kind}' IS DISTINCT FROM terminal.evidence_kind
    OR NEW.report #>> '{terminalEvidence,source}' IS DISTINCT FROM terminal.source
    OR NEW.report #>> '{terminalEvidence,locator}' IS DISTINCT FROM terminal.locator
    OR NEW.report #>> '{terminalEvidence,sourceUri}' IS DISTINCT FROM terminal.source_uri
    OR NEW.report #>> '{terminalEvidence,payloadHash}' IS DISTINCT FROM terminal.payload_hash
    OR (NEW.report #>> '{terminalEvidence,observedAt}')::timestamptz
      IS DISTINCT FROM terminal.observed_at
    OR NEW.report #>> '{terminalEvidence,blockOrSlot}' IS DISTINCT FROM terminal.block_or_slot::text
    OR NEW.report #>> '{terminalEvidence,finality}' IS DISTINCT FROM terminal.finality
    OR NEW.report #>> '{terminalEvidence,summary}' IS DISTINCT FROM terminal.summary
    OR NEW.report #>> '{terminalEvidence,rawArtifactRef}' IS DISTINCT FROM terminal.raw_artifact_ref
  THEN
    RAISE EXCEPTION 'Claim declaration embedded Evidence conflicts with durable Evidence';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS claim_declaration_report_insert_guard
ON claim_declaration_reports;
CREATE TRIGGER claim_declaration_report_insert_guard
BEFORE INSERT ON claim_declaration_reports
FOR EACH ROW EXECUTE FUNCTION validate_claim_declaration_report_insert();

CREATE OR REPLACE FUNCTION reject_claim_declaration_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'claim_declaration_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS claim_declaration_report_update_guard
ON claim_declaration_reports;
CREATE TRIGGER claim_declaration_report_update_guard
BEFORE UPDATE ON claim_declaration_reports
FOR EACH ROW EXECUTE FUNCTION reject_claim_declaration_report_mutation();

DROP TRIGGER IF EXISTS claim_declaration_report_delete_guard
ON claim_declaration_reports;
CREATE TRIGGER claim_declaration_report_delete_guard
BEFORE DELETE ON claim_declaration_reports
FOR EACH ROW EXECUTE FUNCTION reject_claim_declaration_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('027_claim_declaration_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
