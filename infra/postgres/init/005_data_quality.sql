\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS chain_anchor_observations (
  id text PRIMARY KEY CHECK (id ~ '^anchor_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL,
  source text NOT NULL,
  observation_role text NOT NULL
    CHECK (observation_role IN ('HEAD', 'COMPARISON', 'CONTINUITY_CHECK')),
  position numeric(30, 0) NOT NULL CHECK (position >= 0),
  block_hash text NOT NULL,
  parent_position numeric(30, 0) CHECK (parent_position >= 0),
  parent_hash text,
  finality text NOT NULL,
  observed_at timestamptz NOT NULL,
  evidence_id text NOT NULL REFERENCES evidence(id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (parent_position IS NULL AND parent_hash IS NULL)
    OR (parent_position IS NOT NULL AND parent_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS chain_anchor_latest_head_idx
  ON chain_anchor_observations (ledger, chain_id, source, observed_at DESC)
  WHERE observation_role = 'HEAD';
CREATE INDEX IF NOT EXISTS chain_anchor_position_idx
  ON chain_anchor_observations (ledger, chain_id, position, block_hash);

CREATE TABLE IF NOT EXISTS data_quality_alerts (
  id text PRIMARY KEY CHECK (id ~ '^dqa_[0-9a-f]{24}$'),
  alert_kind text NOT NULL
    CHECK (alert_kind IN ('CROSS_SOURCE_DISAGREEMENT', 'REORG_DETECTED', 'SOURCE_REGRESSION')),
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL,
  position numeric(30, 0) CHECK (position >= 0),
  summary text NOT NULL,
  details jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  model_version text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_quality_alert_evidence (
  alert_id text NOT NULL REFERENCES data_quality_alerts(id),
  evidence_id text NOT NULL REFERENCES evidence(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS data_quality_alert_chain_time_idx
  ON data_quality_alerts (ledger, chain_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS data_quality_alert_evidence_id_idx
  ON data_quality_alert_evidence (evidence_id);

DROP TRIGGER IF EXISTS chain_anchor_append_only ON chain_anchor_observations;
CREATE TRIGGER chain_anchor_append_only
BEFORE UPDATE OR DELETE ON chain_anchor_observations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

DROP TRIGGER IF EXISTS data_quality_alert_append_only ON data_quality_alerts;
CREATE TRIGGER data_quality_alert_append_only
BEFORE UPDATE OR DELETE ON data_quality_alerts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

DROP TRIGGER IF EXISTS data_quality_alert_evidence_append_only ON data_quality_alert_evidence;
CREATE TRIGGER data_quality_alert_evidence_append_only
BEFORE UPDATE OR DELETE ON data_quality_alert_evidence
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE OR REPLACE FUNCTION validate_data_quality_alert_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM data_quality_alert_evidence edge
    WHERE edge.alert_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Data Quality Alert must link to at least one Evidence node';
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS data_quality_alert_evidence_required ON data_quality_alerts;
CREATE CONSTRAINT TRIGGER data_quality_alert_evidence_required
AFTER INSERT ON data_quality_alerts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_data_quality_alert_evidence();

INSERT INTO schema_migrations(version)
VALUES ('005_data_quality')
ON CONFLICT (version) DO NOTHING;

COMMIT;
