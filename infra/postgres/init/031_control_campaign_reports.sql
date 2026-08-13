\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS control_campaign_reports (
  id text PRIMARY KEY CHECK (id ~ '^cc_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (chain_id <> ''),
  token text NOT NULL CHECK (token <> ''),
  snapshot_position numeric(30, 0) NOT NULL CHECK (snapshot_position >= 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash <> ''),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  bundle jsonb NOT NULL CHECK (jsonb_typeof(bundle) = 'object'),
  evidence_ids text[] NOT NULL,
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'campaign-v1.0.0'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_campaign_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS control_campaign_reports_token_latest_idx
  ON control_campaign_reports (
    ledger,
    chain_id,
    token,
    snapshot_position DESC,
    captured_at DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION reject_control_campaign_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'control_campaign_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS control_campaign_report_update_guard
ON control_campaign_reports;
CREATE TRIGGER control_campaign_report_update_guard
BEFORE UPDATE ON control_campaign_reports
FOR EACH ROW EXECUTE FUNCTION reject_control_campaign_report_mutation();

DROP TRIGGER IF EXISTS control_campaign_report_delete_guard
ON control_campaign_reports;
CREATE TRIGGER control_campaign_report_delete_guard
BEFORE DELETE ON control_campaign_reports
FOR EACH ROW EXECUTE FUNCTION reject_control_campaign_report_mutation();

CREATE OR REPLACE FUNCTION validate_control_campaign_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  expected_position text;
  expected_hash text;
BEGIN
  CASE NEW.ledger
    WHEN 'EVM' THEN
      expected_position := NEW.bundle #>> '{campaign,snapshotEnd,blockNumber}';
      expected_hash := NEW.bundle #>> '{campaign,snapshotEnd,blockHash}';
    WHEN 'BITCOIN' THEN
      expected_position := NEW.bundle #>> '{campaign,snapshotEnd,height}';
      expected_hash := NEW.bundle #>> '{campaign,snapshotEnd,blockHash}';
    WHEN 'SOLANA' THEN
      expected_position := NEW.bundle #>> '{campaign,snapshotEnd,slot}';
      expected_hash := NEW.bundle #>> '{campaign,snapshotEnd,blockhash}';
  END CASE;
  IF NEW.bundle ->> 'schemaVersion' IS DISTINCT FROM 'control-campaign-bundle-v1'
    OR NEW.bundle #>> '{campaign,id}' IS DISTINCT FROM NEW.id
    OR NEW.bundle #>> '{campaign,ledger}' IS DISTINCT FROM NEW.ledger::text
    OR NEW.bundle #>> '{campaign,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.bundle #>> '{campaign,token}' IS DISTINCT FROM NEW.token
    OR NEW.bundle #>> '{campaign,ruleVersion}' IS DISTINCT FROM NEW.model_version
    OR NEW.bundle #>> '{campaign,automaticOwnershipMergeAllowed}' IS DISTINCT FROM 'false'
    OR NEW.bundle #>> '{campaign,automaticEntityMembershipMutationAllowed}' IS DISTINCT FROM 'false'
    OR expected_position IS DISTINCT FROM NEW.snapshot_position::text
    OR expected_hash IS DISTINCT FROM NEW.snapshot_hash
    OR NEW.bundle ->> 'resultHash' IS DISTINCT FROM NEW.result_hash
    OR jsonb_typeof(NEW.bundle -> 'campaign') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.bundle -> 'evidenceLine') IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'Control Campaign bundle conflicts with stored identity';
  END IF;
  IF NEW.evidence_ids <> ARRAY(
    SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.bundle #> '{campaign,metadata,evidenceIds}') value ORDER BY value
  )
  OR NEW.source_set <> ARRAY(
    SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.bundle #> '{campaign,metadata,sourceSet}') value ORDER BY value
  )
  THEN
    RAISE EXCEPTION 'Control Campaign provenance arrays are not canonical';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS control_campaign_report_insert_guard
ON control_campaign_reports;
CREATE TRIGGER control_campaign_report_insert_guard
BEFORE INSERT ON control_campaign_reports
FOR EACH ROW EXECUTE FUNCTION validate_control_campaign_report_insert();

INSERT INTO schema_migrations(version)
VALUES ('031_control_campaign_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
