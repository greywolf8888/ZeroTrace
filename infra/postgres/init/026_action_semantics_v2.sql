\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE action_semantics_reports
  DROP CONSTRAINT IF EXISTS action_semantics_reports_model_version_check,
  DROP CONSTRAINT IF EXISTS action_semantics_reports_model_version_supported;

ALTER TABLE action_semantics_reports
  ADD CONSTRAINT action_semantics_reports_model_version_supported
  CHECK (model_version IN ('action-semantics-v0.1.0', 'action-semantics-v0.2.0'));

DO $migration$
DECLARE
  current_definition text;
  upgraded_definition text;
  old_fragment constant text :=
    'terminal.source <> ''zerotrace:action-semantics-v0.1.0''';
  new_fragment constant text :=
    'terminal.source <> (''zerotrace:'' || NEW.model_version)';
BEGIN
  SELECT pg_get_functiondef('validate_action_semantics_report_insert()'::regprocedure)
  INTO current_definition;

  IF strpos(current_definition, old_fragment) > 0 THEN
    upgraded_definition := replace(current_definition, old_fragment, new_fragment);
    EXECUTE upgraded_definition;
  ELSIF strpos(current_definition, new_fragment) = 0 THEN
    RAISE EXCEPTION 'Action Semantics insert guard has an unknown terminal-source rule';
  END IF;
END
$migration$;

INSERT INTO schema_migrations(version)
VALUES ('026_action_semantics_v2')
ON CONFLICT (version) DO NOTHING;

COMMIT;
