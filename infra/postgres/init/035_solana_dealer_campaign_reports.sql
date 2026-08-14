\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS solana_dealer_campaign_reports (
  id text PRIMARY KEY CHECK (id ~ '^sdc_[0-9a-f]{24}$'),
  chain_id text NOT NULL CHECK (chain_id = 'solana-mainnet'),
  mint text NOT NULL CHECK (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  snapshot_slot numeric(30, 0) NOT NULL CHECK (snapshot_slot >= 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$'),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) >= 1),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'solana-dealer-campaign-v1.0.0'),
  policy_version text NOT NULL CHECK (policy_version = 'solana-dealer-policy-v1.0.0'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solana_dealer_campaign_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS solana_dealer_campaign_reports_mint_latest_idx
  ON solana_dealer_campaign_reports (
    chain_id,
    mint,
    snapshot_slot DESC,
    captured_at DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION validate_solana_dealer_campaign_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'solana-dealer-campaign-report-v1'
    OR NEW.report ->> 'id' IS DISTINCT FROM NEW.id
    OR NEW.report ->> 'ledger' IS DISTINCT FROM 'SOLANA'
    OR NEW.report ->> 'chainId' IS DISTINCT FROM NEW.chain_id
    OR NEW.report ->> 'mint' IS DISTINCT FROM NEW.mint
    OR NEW.report #>> '{snapshot,slot}' IS DISTINCT FROM NEW.snapshot_slot::text
    OR NEW.report #>> '{snapshot,blockhash}' IS DISTINCT FROM NEW.snapshot_hash
    OR NEW.report ->> 'resultHash' IS DISTINCT FROM NEW.result_hash
    OR NEW.report ->> 'modelVersion' IS DISTINCT FROM NEW.model_version
    OR NEW.report ->> 'policyVersion' IS DISTINCT FROM NEW.policy_version
    OR (NEW.report ->> 'freshness')::timestamptz IS DISTINCT FROM NEW.captured_at
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'evidenceIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'sourceSet') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Solana dealer report conflicts with its stored identity';
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
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT item ->> 'id'
      FROM jsonb_array_elements(NEW.report -> 'evidence') item
      ORDER BY item ->> 'id'
    )
    OR NEW.source_set <> ARRAY(
      SELECT value
      FROM jsonb_array_elements_text(NEW.report -> 'sourceSet') value
      ORDER BY value
    )
    OR EXISTS (SELECT 1 FROM unnest(NEW.evidence_ids) value WHERE value = '')
    OR EXISTS (SELECT 1 FROM unnest(NEW.source_set) value WHERE value = '')
  THEN
    RAISE EXCEPTION 'Solana dealer report provenance arrays must be canonical';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.evidence_ids) item
    LEFT JOIN evidence e ON e.id = item
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Solana dealer report references missing Evidence';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS solana_dealer_campaign_report_insert_guard
ON solana_dealer_campaign_reports;
CREATE TRIGGER solana_dealer_campaign_report_insert_guard
BEFORE INSERT ON solana_dealer_campaign_reports
FOR EACH ROW EXECUTE FUNCTION validate_solana_dealer_campaign_report_insert();

CREATE OR REPLACE FUNCTION reject_solana_dealer_campaign_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'solana_dealer_campaign_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS solana_dealer_campaign_report_update_guard
ON solana_dealer_campaign_reports;
CREATE TRIGGER solana_dealer_campaign_report_update_guard
BEFORE UPDATE ON solana_dealer_campaign_reports
FOR EACH ROW EXECUTE FUNCTION reject_solana_dealer_campaign_report_mutation();

DROP TRIGGER IF EXISTS solana_dealer_campaign_report_delete_guard
ON solana_dealer_campaign_reports;
CREATE TRIGGER solana_dealer_campaign_report_delete_guard
BEFORE DELETE ON solana_dealer_campaign_reports
FOR EACH ROW EXECUTE FUNCTION reject_solana_dealer_campaign_report_mutation();

INSERT INTO schema_migrations(version)
VALUES ('035_solana_dealer_campaign_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
