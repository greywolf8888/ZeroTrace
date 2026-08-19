\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS control_campaign_alerts (
  id text PRIMARY KEY CHECK (id ~ '^fca_[0-9a-f]{24}$'),
  campaign_id text NOT NULL REFERENCES control_campaign_reports(id) ON DELETE RESTRICT,
  behavior_event_id text NOT NULL CHECK (behavior_event_id ~ '^be_[0-9a-f]{24}$'),
  severity text NOT NULL CHECK (severity IN ('INFO', 'WATCH', 'HIGH', 'CRITICAL')),
  classification text NOT NULL,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  confidence jsonb NOT NULL CHECK (jsonb_typeof(confidence) = 'object'),
  suppression_applied text[] NOT NULL,
  details jsonb NOT NULL,
  model_version text NOT NULL,
  created_at timestamptz NOT NULL,
  result_hash char(64) NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (campaign_id, behavior_event_id, result_hash)
);

CREATE TABLE IF NOT EXISTS control_campaign_alert_evidence (
  alert_id text NOT NULL REFERENCES control_campaign_alerts(id) ON DELETE RESTRICT,
  evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS control_campaign_alert_campaign_time_idx
  ON control_campaign_alerts (campaign_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS control_campaign_alert_evidence_id_idx
  ON control_campaign_alert_evidence (evidence_id);

DROP TRIGGER IF EXISTS control_campaign_alert_append_only ON control_campaign_alerts;
CREATE TRIGGER control_campaign_alert_append_only
BEFORE UPDATE OR DELETE ON control_campaign_alerts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

DROP TRIGGER IF EXISTS control_campaign_alert_evidence_append_only ON control_campaign_alert_evidence;
CREATE TRIGGER control_campaign_alert_evidence_append_only
BEFORE UPDATE OR DELETE ON control_campaign_alert_evidence
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE OR REPLACE FUNCTION validate_control_campaign_alert_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM control_campaign_alert_evidence edge
    WHERE edge.alert_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Control Campaign Alert must link to at least one Evidence node';
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS control_campaign_alert_evidence_required ON control_campaign_alerts;
CREATE CONSTRAINT TRIGGER control_campaign_alert_evidence_required
AFTER INSERT ON control_campaign_alerts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_control_campaign_alert_evidence();

INSERT INTO schema_migrations(version)
VALUES ('034_control_campaign_alerts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
