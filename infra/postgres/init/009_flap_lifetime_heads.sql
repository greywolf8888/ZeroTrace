\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS flap_lifetime_heads (
  id text PRIMARY KEY CHECK (id ~ '^flh_[0-9a-f]{24}$'),
  chain_id text NOT NULL CHECK (chain_id = 'eip155:56'),
  token text NOT NULL CHECK (token ~ '^0x[0-9a-f]{40}$'),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  scan_id uuid NOT NULL UNIQUE REFERENCES semantic_scan_runs(id) ON DELETE RESTRICT,
  head_type text NOT NULL CHECK (head_type IN ('INITIAL', 'EXTENSION')),
  predecessor_id text REFERENCES flap_lifetime_heads(id) ON DELETE RESTRICT,
  target_block numeric(30, 0) NOT NULL CHECK (target_block >= 0),
  target_hash text NOT NULL CHECK (target_hash ~ '^0x[0-9a-f]{64}$'),
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flap_lifetime_heads_sequence_key UNIQUE (chain_id, token, sequence),
  CONSTRAINT flap_lifetime_heads_target_key UNIQUE (
    chain_id, token, target_block, target_hash
  )
);

CREATE INDEX IF NOT EXISTS flap_lifetime_heads_latest_idx
  ON flap_lifetime_heads (chain_id, token, sequence DESC);
CREATE INDEX IF NOT EXISTS flap_lifetime_heads_predecessor_idx
  ON flap_lifetime_heads (predecessor_id);

CREATE OR REPLACE FUNCTION validate_flap_lifetime_head_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  scan semantic_scan_runs%ROWTYPE;
  previous flap_lifetime_heads%ROWTYPE;
  latest flap_lifetime_heads%ROWTYPE;
BEGIN
  SELECT * INTO scan FROM semantic_scan_runs WHERE id = NEW.scan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flap lifetime head scan does not exist';
  END IF;
  IF scan.status <> 'REQUESTED_RANGE_COMPLETE'
    OR scan.ledger <> 'EVM'
    OR scan.chain_id <> NEW.chain_id
    OR scan.subject <> NEW.token
    OR scan.to_block <> NEW.target_block
  THEN
    RAISE EXCEPTION 'Flap lifetime head identity conflicts with its completed scan';
  END IF;
  IF NEW.result ->> 'platform' <> 'flap'
    OR NEW.result ->> 'token' <> NEW.token
    OR NEW.result ->> 'dataset' <> 'binance-mainnet'
    OR NEW.result ->> 'targetBlock' <> NEW.target_block::text
    OR NEW.result #>> '{lifetimeCoverage,state}' <> 'known'
    OR NEW.result #>> '{lifetimeCoverage,value}' <> 'true'
    OR NEW.result #>> '{metadata,snapshot,ledger}' <> 'EVM'
    OR NEW.result #>> '{metadata,snapshot,chainId}' <> NEW.chain_id
    OR NEW.result #>> '{metadata,snapshot,blockNumber}' <> NEW.target_block::text
    OR NEW.result #>> '{metadata,snapshot,blockHash}' <> NEW.target_hash
    OR NEW.result #>> '{metadata,snapshot,finality}' <> 'finalized'
    OR NEW.result #>> '{metadata,dataCoverage}' <> '1'
    OR NEW.result #>> '{metadata,historyCoverage}' <> '1'
    OR NEW.result ->> 'terminalEvidenceId' <> NEW.terminal_evidence_id
  THEN
    RAISE EXCEPTION 'Flap lifetime result conflicts with its stored identity';
  END IF;

  SELECT * INTO latest
  FROM flap_lifetime_heads
  WHERE chain_id = NEW.chain_id AND token = NEW.token
  ORDER BY sequence DESC
  LIMIT 1;

  IF NEW.head_type = 'INITIAL' THEN
    IF scan.scan_type <> 'FLAP_LIFETIME_MATERIALIZATION'
      OR scan.source <> 'zerotrace:flap-lifetime-materialization-v1'
      OR NEW.sequence <> 0
      OR NEW.predecessor_id IS NOT NULL
      OR NEW.result ? 'predecessor'
      OR FOUND
    THEN
      RAISE EXCEPTION 'Initial Flap lifetime head must be the first materialization';
    END IF;
  ELSE
    IF scan.scan_type <> 'FLAP_LIFETIME_EXTENSION'
      OR scan.source <> 'zerotrace:flap-lifetime-extension-v1'
      OR NEW.predecessor_id IS NULL
      OR NOT NEW.result ? 'predecessor'
      OR NOT FOUND
      OR latest.id <> NEW.predecessor_id
      OR NEW.sequence <> latest.sequence + 1
    THEN
      RAISE EXCEPTION 'Flap lifetime extension must append to the current head';
    END IF;
    SELECT * INTO previous FROM flap_lifetime_heads WHERE id = NEW.predecessor_id;
    IF NOT FOUND
      OR NEW.target_block <= previous.target_block
      OR NEW.result #>> '{predecessor,scanId}' <> previous.scan_id::text
      OR NEW.result #>> '{predecessor,targetBlock}' <> previous.target_block::text
      OR NEW.result #>> '{predecessor,targetHash}' <> previous.target_hash
      OR NEW.result #>> '{predecessor,terminalEvidenceId}' <> previous.terminal_evidence_id
    THEN
      RAISE EXCEPTION 'Flap lifetime extension predecessor is inconsistent';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS flap_lifetime_head_insert_guard ON flap_lifetime_heads;
CREATE TRIGGER flap_lifetime_head_insert_guard
BEFORE INSERT ON flap_lifetime_heads
FOR EACH ROW EXECUTE FUNCTION validate_flap_lifetime_head_insert();

CREATE OR REPLACE FUNCTION reject_flap_lifetime_head_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'flap_lifetime_heads is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS flap_lifetime_head_update_guard ON flap_lifetime_heads;
CREATE TRIGGER flap_lifetime_head_update_guard
BEFORE UPDATE ON flap_lifetime_heads
FOR EACH ROW EXECUTE FUNCTION reject_flap_lifetime_head_mutation();

DROP TRIGGER IF EXISTS flap_lifetime_head_delete_guard ON flap_lifetime_heads;
CREATE TRIGGER flap_lifetime_head_delete_guard
BEFORE DELETE ON flap_lifetime_heads
FOR EACH ROW EXECUTE FUNCTION reject_flap_lifetime_head_mutation();

INSERT INTO schema_migrations(version)
VALUES ('009_flap_lifetime_heads')
ON CONFLICT (version) DO NOTHING;

COMMIT;
