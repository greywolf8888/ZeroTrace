\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS flap_lifetime_head_invalidations (
  id text PRIMARY KEY CHECK (id ~ '^fli_[0-9a-f]{24}$'),
  chain_id text NOT NULL CHECK (chain_id = 'eip155:56'),
  token text NOT NULL CHECK (token ~ '^0x[0-9a-f]{40}$'),
  event_sequence bigint NOT NULL CHECK (event_sequence >= 0),
  invalidated_from_head_id text NOT NULL
    REFERENCES flap_lifetime_heads(id) ON DELETE RESTRICT,
  invalidated_through_head_id text NOT NULL
    REFERENCES flap_lifetime_heads(id) ON DELETE RESTRICT,
  rollback_to_head_id text REFERENCES flap_lifetime_heads(id) ON DELETE RESTRICT,
  alert_id text NOT NULL REFERENCES data_quality_alerts(id) ON DELETE RESTRICT,
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flap_lifetime_head_invalidations_sequence_key
    UNIQUE (chain_id, token, event_sequence),
  CONSTRAINT flap_lifetime_head_invalidations_from_key
    UNIQUE (invalidated_from_head_id)
);

CREATE INDEX IF NOT EXISTS flap_lifetime_head_invalidations_token_idx
  ON flap_lifetime_head_invalidations (chain_id, token, event_sequence DESC);
CREATE INDEX IF NOT EXISTS flap_lifetime_head_invalidations_through_idx
  ON flap_lifetime_head_invalidations (invalidated_through_head_id);

CREATE OR REPLACE FUNCTION validate_flap_lifetime_head_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  scan semantic_scan_runs%ROWTYPE;
  previous flap_lifetime_heads%ROWTYPE;
  latest flap_lifetime_heads%ROWTYPE;
  active_found boolean;
  next_sequence bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.chain_id || ':' || NEW.token, 0));

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

  WITH RECURSIVE invalidated(id) AS (
    SELECT invalidated_from_head_id
    FROM flap_lifetime_head_invalidations
    WHERE chain_id = NEW.chain_id AND token = NEW.token
    UNION
    SELECT head.id
    FROM flap_lifetime_heads head
    JOIN invalidated ON head.predecessor_id = invalidated.id
    WHERE head.chain_id = NEW.chain_id AND head.token = NEW.token
  )
  SELECT head.* INTO latest
  FROM flap_lifetime_heads head
  WHERE head.chain_id = NEW.chain_id
    AND head.token = NEW.token
    AND NOT EXISTS (SELECT 1 FROM invalidated WHERE invalidated.id = head.id)
  ORDER BY head.sequence DESC
  LIMIT 1;
  active_found := FOUND;

  SELECT COALESCE(MAX(sequence), -1) + 1 INTO next_sequence
  FROM flap_lifetime_heads
  WHERE chain_id = NEW.chain_id AND token = NEW.token;

  IF NEW.head_type = 'INITIAL' THEN
    IF scan.scan_type <> 'FLAP_LIFETIME_MATERIALIZATION'
      OR scan.source <> 'zerotrace:flap-lifetime-materialization-v1'
      OR NEW.sequence <> next_sequence
      OR NEW.predecessor_id IS NOT NULL
      OR NEW.result ? 'predecessor'
      OR active_found
    THEN
      RAISE EXCEPTION 'Initial Flap lifetime head requires an empty active lineage';
    END IF;
  ELSE
    IF scan.scan_type <> 'FLAP_LIFETIME_EXTENSION'
      OR scan.source <> 'zerotrace:flap-lifetime-extension-v1'
      OR NEW.predecessor_id IS NULL
      OR NOT NEW.result ? 'predecessor'
      OR NOT active_found
      OR latest.id <> NEW.predecessor_id
      OR NEW.sequence <> next_sequence
    THEN
      RAISE EXCEPTION 'Flap lifetime extension must append to the active head';
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

CREATE OR REPLACE FUNCTION validate_flap_lifetime_head_invalidation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  latest flap_lifetime_heads%ROWTYPE;
  invalidated_from flap_lifetime_heads%ROWTYPE;
  rollback_to flap_lifetime_heads%ROWTYPE;
  active_found boolean;
  expected_ids text[];
  result_ids text[];
  next_event_sequence bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.chain_id || ':' || NEW.token, 0));

  WITH RECURSIVE invalidated(id) AS (
    SELECT invalidated_from_head_id
    FROM flap_lifetime_head_invalidations
    WHERE chain_id = NEW.chain_id AND token = NEW.token
    UNION
    SELECT head.id
    FROM flap_lifetime_heads head
    JOIN invalidated ON head.predecessor_id = invalidated.id
    WHERE head.chain_id = NEW.chain_id AND head.token = NEW.token
  )
  SELECT head.* INTO latest
  FROM flap_lifetime_heads head
  WHERE head.chain_id = NEW.chain_id
    AND head.token = NEW.token
    AND NOT EXISTS (SELECT 1 FROM invalidated WHERE invalidated.id = head.id)
  ORDER BY head.sequence DESC
  LIMIT 1;
  active_found := FOUND;
  IF NOT active_found OR latest.id <> NEW.invalidated_through_head_id THEN
    RAISE EXCEPTION 'Flap lifetime invalidation must end at the active head';
  END IF;

  SELECT * INTO invalidated_from
  FROM flap_lifetime_heads
  WHERE id = NEW.invalidated_from_head_id
    AND chain_id = NEW.chain_id
    AND token = NEW.token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flap lifetime invalidation start does not exist';
  END IF;

  WITH RECURSIVE active_lineage AS (
    SELECT head.*
    FROM flap_lifetime_heads head
    WHERE head.id = latest.id
    UNION ALL
    SELECT parent.*
    FROM flap_lifetime_heads parent
    JOIN active_lineage child ON child.predecessor_id = parent.id
  )
  SELECT array_agg(id ORDER BY sequence ASC) INTO expected_ids
  FROM active_lineage
  WHERE sequence >= invalidated_from.sequence;

  SELECT array_agg(item ->> 'headId' ORDER BY ordinal) INTO result_ids
  FROM jsonb_array_elements(NEW.result -> 'invalidatedHeads') WITH ORDINALITY AS refs(item, ordinal);

  IF expected_ids IS NULL
    OR expected_ids[1] <> NEW.invalidated_from_head_id
    OR expected_ids[array_length(expected_ids, 1)] <> NEW.invalidated_through_head_id
    OR result_ids IS DISTINCT FROM expected_ids
  THEN
    RAISE EXCEPTION 'Flap lifetime invalidation suffix is not the active lineage';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.result -> 'invalidatedHeads') AS refs(item)
    LEFT JOIN flap_lifetime_heads head ON head.id = refs.item ->> 'headId'
    WHERE head.id IS NULL
      OR refs.item ->> 'scanId' <> head.scan_id::text
      OR refs.item ->> 'targetBlock' <> head.target_block::text
      OR refs.item ->> 'targetHash' <> head.target_hash
      OR refs.item ->> 'terminalEvidenceId' <> head.terminal_evidence_id
  ) THEN
    RAISE EXCEPTION 'Flap lifetime invalidation head reference is inconsistent';
  END IF;

  IF invalidated_from.predecessor_id IS NULL THEN
    IF NEW.rollback_to_head_id IS NOT NULL
      OR jsonb_typeof(NEW.result -> 'rollbackTo') IS DISTINCT FROM 'null'
    THEN
      RAISE EXCEPTION 'Flap lifetime invalidation rollback predecessor is inconsistent';
    END IF;
  ELSE
    SELECT * INTO rollback_to FROM flap_lifetime_heads WHERE id = invalidated_from.predecessor_id;
    IF NOT FOUND
      OR NEW.rollback_to_head_id <> rollback_to.id
      OR NEW.result #>> '{rollbackTo,headId}' <> rollback_to.id
      OR NEW.result #>> '{rollbackTo,scanId}' <> rollback_to.scan_id::text
      OR NEW.result #>> '{rollbackTo,targetBlock}' <> rollback_to.target_block::text
      OR NEW.result #>> '{rollbackTo,targetHash}' <> rollback_to.target_hash
      OR NEW.result #>> '{rollbackTo,terminalEvidenceId}' <> rollback_to.terminal_evidence_id
    THEN
      RAISE EXCEPTION 'Flap lifetime invalidation rollback predecessor is inconsistent';
    END IF;
  END IF;

  SELECT COALESCE(MAX(event_sequence), -1) + 1 INTO next_event_sequence
  FROM flap_lifetime_head_invalidations
  WHERE chain_id = NEW.chain_id AND token = NEW.token;

  IF NEW.event_sequence <> next_event_sequence
    OR NEW.result ->> 'chainId' <> NEW.chain_id
    OR NEW.result ->> 'token' <> NEW.token
    OR NEW.result ->> 'reason' <> 'FINALIZED_REORG'
    OR NEW.result ->> 'alertId' <> NEW.alert_id
    OR NEW.result ->> 'terminalEvidenceId' <> NEW.terminal_evidence_id
    OR NEW.result #>> '{metadata,snapshot,ledger}' <> 'EVM'
    OR NEW.result #>> '{metadata,snapshot,chainId}' <> NEW.chain_id
    OR NEW.result #>> '{metadata,snapshot,blockNumber}' <>
      (NEW.result #>> '{observedTarget,blockNumber}')
    OR NEW.result #>> '{metadata,snapshot,blockHash}' <>
      (NEW.result #>> '{observedTarget,blockHash}')
    OR NEW.result #>> '{metadata,snapshot,finality}' <> 'finalized'
    OR NEW.result #>> '{lineageCoverage}' <> '1'
    OR NEW.result #>> '{metadata,dataCoverage}' <> '1'
    OR NEW.result #>> '{metadata,sourceCoverage}' <> '1'
    OR NEW.result #>> '{metadata,historyCoverage}' <> '1'
    OR NEW.result #>> '{metadata,simulationCoverage}' <> '0'
    OR NOT ((NEW.result #> '{metadata,evidenceIds}') ? NEW.terminal_evidence_id)
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.result -> 'invalidatedHeads') AS refs(item)
      WHERE NOT (
        (NEW.result #> '{metadata,evidenceIds}') ? (refs.item ->> 'terminalEvidenceId')
      )
    )
    OR (
      NEW.rollback_to_head_id IS NOT NULL
      AND NOT (
        (NEW.result #> '{metadata,evidenceIds}') ?
        (NEW.result #>> '{rollbackTo,terminalEvidenceId}')
      )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.result -> 'evidence') AS item
      WHERE item ->> 'id' = NEW.terminal_evidence_id
    )
  THEN
    RAISE EXCEPTION 'Flap lifetime invalidation result conflicts with its stored identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM data_quality_alerts alert
    WHERE alert.id = NEW.alert_id
      AND alert.alert_kind = 'REORG_DETECTED'
      AND alert.severity = 'CRITICAL'
      AND alert.ledger = 'EVM'
      AND alert.chain_id = NEW.chain_id
      AND alert.details ->> 'token' = NEW.token
  ) OR NOT EXISTS (
    SELECT 1
    FROM evidence item
    WHERE item.id = NEW.terminal_evidence_id
      AND item.ledger = 'EVM'
      AND item.chain_id = NEW.chain_id
      AND item.evidence_kind = 'DERIVED_FEATURE'
      AND item.source = 'zerotrace:flap-lifetime-rollback-v1'
      AND item.finality = 'finalized'
  ) THEN
    RAISE EXCEPTION 'Flap lifetime invalidation Evidence or alert is inconsistent';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS flap_lifetime_head_invalidation_insert_guard
  ON flap_lifetime_head_invalidations;
CREATE TRIGGER flap_lifetime_head_invalidation_insert_guard
BEFORE INSERT ON flap_lifetime_head_invalidations
FOR EACH ROW EXECUTE FUNCTION validate_flap_lifetime_head_invalidation_insert();

DROP TRIGGER IF EXISTS flap_lifetime_head_invalidation_update_guard
  ON flap_lifetime_head_invalidations;
CREATE TRIGGER flap_lifetime_head_invalidation_update_guard
BEFORE UPDATE ON flap_lifetime_head_invalidations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

DROP TRIGGER IF EXISTS flap_lifetime_head_invalidation_delete_guard
  ON flap_lifetime_head_invalidations;
CREATE TRIGGER flap_lifetime_head_invalidation_delete_guard
BEFORE DELETE ON flap_lifetime_head_invalidations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

INSERT INTO schema_migrations(version)
VALUES ('010_flap_lifetime_reorgs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
