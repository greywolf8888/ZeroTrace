\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS forensic_reports (
  id TEXT PRIMARY KEY CHECK (id ~ '^frp_[0-9a-f]{24}$'),
  report_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  ledger TEXT NOT NULL CHECK (ledger IN ('EVM', 'BITCOIN', 'SOLANA')),
  chain_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL,
  coverage JSONB NOT NULL,
  evidence_closure TEXT[] NOT NULL CHECK (cardinality(evidence_closure) > 0),
  source_set TEXT[] NOT NULL CHECK (cardinality(source_set) > 0),
  result_hash TEXT NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes TEXT REFERENCES forensic_reports(id),
  CONSTRAINT forensic_reports_identity CHECK (
    payload->>'id' IS NULL OR true
  )
);

CREATE INDEX IF NOT EXISTS forensic_reports_subject_idx
  ON forensic_reports (ledger, chain_id, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analyst_decisions (
  id TEXT PRIMARY KEY CHECK (id ~ '^ads_[0-9a-f]{24}$'),
  investigation_id TEXT NOT NULL CHECK (investigation_id ~ '^inv_[0-9a-f]{24}$'),
  decision JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY CHECK (id ~ '^inv_[0-9a-f]{24}$'),
  ledger TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_forensic_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'forensic reports are immutable';
END;
$$;

DROP TRIGGER IF EXISTS forensic_reports_no_update ON forensic_reports;
CREATE TRIGGER forensic_reports_no_update
  BEFORE UPDATE OR DELETE ON forensic_reports
  FOR EACH ROW EXECUTE FUNCTION reject_forensic_report_mutation();

CREATE OR REPLACE FUNCTION validate_forensic_report_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_id TEXT;
BEGIN
  FOREACH evidence_id IN ARRAY NEW.evidence_closure LOOP
    IF NOT EXISTS (SELECT 1 FROM evidence WHERE id = evidence_id) THEN
      RAISE EXCEPTION 'forensic report Evidence % is missing', evidence_id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forensic_reports_evidence_guard ON forensic_reports;
CREATE TRIGGER forensic_reports_evidence_guard
  BEFORE INSERT ON forensic_reports
  FOR EACH ROW EXECUTE FUNCTION validate_forensic_report_evidence();

INSERT INTO schema_migrations (version) VALUES ('037_forensic_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
