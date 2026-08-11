\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION validate_evm_control_source_provenance_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.model_version <> 'evm-control-surface-v1.1.0' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.report -> 'logicCode') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.report -> 'verifiedSource') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.report -> 'declaredCapabilities') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'EVM control source provenance fields are required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report -> 'declaredCapabilities') capability,
         jsonb_array_elements_text(capability -> 'evidenceIds') evidence_id
    WHERE NOT evidence_id = ANY(NEW.evidence_ids)
  ) THEN
    RAISE EXCEPTION 'EVM declared capability references missing provenance';
  END IF;

  IF NEW.report #>> '{logicCode,state}' = 'known'
    AND NEW.report #>> '{verifiedSource,state}' = 'known'
    AND (
      NEW.report #>> '{logicCode,value,address}' IS DISTINCT FROM
        NEW.report #>> '{verifiedSource,value,address}'
      OR NEW.report #>> '{logicCode,value,runtimeBytecodeHash}' IS DISTINCT FROM
        NEW.report #>> '{verifiedSource,value,runtimeBytecodeHash}'
      OR NEW.report #>> '{logicCode,value,runtimeBytecodeBytes}' IS DISTINCT FROM
        NEW.report #>> '{verifiedSource,value,runtimeBytecodeBytes}'
      OR NOT (NEW.report #>> '{verifiedSource,value,sourceId}') = ANY(NEW.source_set)
    )
  THEN
    RAISE EXCEPTION 'EVM verified source conflicts with Snapshot-bound logic code';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS evm_control_source_provenance_insert_guard
ON evm_control_surface_reports;
CREATE TRIGGER evm_control_source_provenance_insert_guard
BEFORE INSERT ON evm_control_surface_reports
FOR EACH ROW EXECUTE FUNCTION validate_evm_control_source_provenance_insert();

INSERT INTO schema_migrations(version)
VALUES ('013_evm_control_source_provenance')
ON CONFLICT (version) DO NOTHING;

COMMIT;
