\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS token_history_discovery_reports (
  id text PRIMARY KEY CHECK (id ~ '^thd_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL CHECK (ledger = 'EVM'),
  chain_id text NOT NULL CHECK (chain_id ~ '^eip155:[1-9][0-9]*$'),
  token text NOT NULL CHECK (token ~ '^0x[0-9a-fA-F]{40}$'),
  from_block numeric(30, 0) NOT NULL CHECK (from_block >= 0),
  to_block numeric(30, 0) NOT NULL CHECK (to_block >= from_block),
  status text NOT NULL CHECK (status IN ('COMPLETE', 'SOURCE_HEAD_REACHED')),
  snapshot_position numeric(30, 0) NOT NULL CHECK (snapshot_position >= 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^0x[0-9a-fA-F]{64}$'),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  relevant_transaction_hashes text[] NOT NULL,
  range_evidence_ids text[] NOT NULL CHECK (cardinality(range_evidence_ids) > 0),
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'token-history-discovery-v1.0.0'),
  policy_version text NOT NULL CHECK (policy_version = 'token-history-policy-v1.0.0'),
  freshness timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT token_history_discovery_reports_result_hash_key UNIQUE (result_hash)
);

CREATE INDEX IF NOT EXISTS token_history_discovery_reports_token_latest_idx
  ON token_history_discovery_reports (
    ledger,
    chain_id,
    token,
    to_block DESC,
    freshness DESC,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION reject_token_history_discovery_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'token_history_discovery_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS token_history_discovery_report_update_guard
ON token_history_discovery_reports;
CREATE TRIGGER token_history_discovery_report_update_guard
BEFORE UPDATE ON token_history_discovery_reports
FOR EACH ROW EXECUTE FUNCTION reject_token_history_discovery_report_mutation();

DROP TRIGGER IF EXISTS token_history_discovery_report_delete_guard
ON token_history_discovery_reports;
CREATE TRIGGER token_history_discovery_report_delete_guard
BEFORE DELETE ON token_history_discovery_reports
FOR EACH ROW EXECUTE FUNCTION reject_token_history_discovery_report_mutation();

CREATE OR REPLACE FUNCTION validate_token_history_discovery_report_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'token-history-discovery-v1'
    OR NEW.report ->> 'id' IS DISTINCT FROM NEW.id
    OR NEW.report ->> 'ledger' IS DISTINCT FROM NEW.ledger::text
    OR NEW.report ->> 'chainId' IS DISTINCT FROM NEW.chain_id
    OR NEW.report ->> 'token' IS DISTINCT FROM NEW.token
    OR NEW.report ->> 'fromBlock' IS DISTINCT FROM NEW.from_block::text
    OR NEW.report ->> 'toBlock' IS DISTINCT FROM NEW.to_block::text
    OR NEW.report ->> 'status' IS DISTINCT FROM NEW.status
    OR NEW.report #>> '{snapshot,blockNumber}' IS DISTINCT FROM NEW.snapshot_position::text
    OR NEW.report #>> '{snapshot,blockHash}' IS DISTINCT FROM NEW.snapshot_hash
    OR NEW.report ->> 'resultHash' IS DISTINCT FROM NEW.result_hash
    OR NEW.report ->> 'modelVersion' IS DISTINCT FROM NEW.model_version
    OR NEW.report ->> 'policyVersion' IS DISTINCT FROM NEW.policy_version
  THEN
    RAISE EXCEPTION 'Token History Discovery report conflicts with stored identity';
  END IF;
  IF NEW.relevant_transaction_hashes <> ARRAY(
    SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.report -> 'relevantTransactionHashes') value ORDER BY value
  )
  OR NEW.range_evidence_ids <> ARRAY(
    SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.report -> 'rangeEvidenceIds') value ORDER BY value
  )
  OR NEW.evidence_ids <> ARRAY(
    SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.report -> 'evidenceIds') value ORDER BY value
  )
  OR NEW.source_set <> ARRAY(
    SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.report -> 'sourceSet') value ORDER BY value
  )
  THEN
    RAISE EXCEPTION 'Token History Discovery provenance arrays are not canonical';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS token_history_discovery_report_insert_guard
ON token_history_discovery_reports;
CREATE TRIGGER token_history_discovery_report_insert_guard
BEFORE INSERT ON token_history_discovery_reports
FOR EACH ROW EXECUTE FUNCTION validate_token_history_discovery_report_insert();

INSERT INTO schema_migrations(version)
VALUES ('032_token_history_discovery_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
