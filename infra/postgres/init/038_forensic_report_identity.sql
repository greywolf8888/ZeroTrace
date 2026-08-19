\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE forensic_reports
  DROP CONSTRAINT IF EXISTS forensic_reports_identity;

ALTER TABLE forensic_reports
  ADD CONSTRAINT forensic_reports_identity CHECK (payload->>'id' = id);

INSERT INTO schema_migrations (version) VALUES ('038_forensic_report_identity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
