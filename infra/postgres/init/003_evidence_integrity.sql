\set ON_ERROR_STOP on

BEGIN;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'evidence_id_format'
      AND conrelid = 'evidence'::regclass
  ) THEN
    ALTER TABLE evidence
      ADD CONSTRAINT evidence_id_format CHECK (id ~ '^ev_[0-9a-f]{24}$');
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION validate_evidence_edge_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  derived_kind text;
  derived_xmin text;
BEGIN
  SELECT evidence_kind, xmin::text
  INTO derived_kind, derived_xmin
  FROM evidence
  WHERE id = NEW.derived_evidence_id;

  IF derived_kind NOT IN ('DERIVED_FEATURE', 'NEGATIVE_EVIDENCE', 'ANALYST_OBSERVATION') THEN
    RAISE EXCEPTION 'Evidence kind % may not derive from another observation', derived_kind;
  END IF;

  IF derived_xmin <> pg_current_xact_id()::text THEN
    RAISE EXCEPTION 'Evidence derivation edges must be committed atomically with the derived observation';
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestry(id, path) AS (
      SELECT NEW.source_evidence_id, ARRAY[NEW.source_evidence_id]::text[]
      UNION ALL
      SELECT edge.source_evidence_id, ancestry.path || edge.source_evidence_id
      FROM ancestry
      JOIN evidence_edges edge ON edge.derived_evidence_id = ancestry.id
      WHERE NOT edge.source_evidence_id = ANY(ancestry.path)
    )
    SELECT 1
    FROM ancestry
    WHERE id = NEW.derived_evidence_id
  ) THEN
    RAISE EXCEPTION 'Evidence derivation cycle is forbidden';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS evidence_edge_validate ON evidence_edges;
CREATE TRIGGER evidence_edge_validate
BEFORE INSERT ON evidence_edges
FOR EACH ROW EXECUTE FUNCTION validate_evidence_edge_insert();

DROP TRIGGER IF EXISTS evidence_edge_append_only ON evidence_edges;
CREATE TRIGGER evidence_edge_append_only
BEFORE UPDATE OR DELETE ON evidence_edges
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM evidence derived
    WHERE derived.evidence_kind IN ('DERIVED_FEATURE', 'NEGATIVE_EVIDENCE')
      AND NOT EXISTS (
        SELECT 1
        FROM evidence_edges edge
        WHERE edge.derived_evidence_id = derived.id
      )
  ) THEN
    RAISE EXCEPTION 'Existing inferred Evidence without source observations blocks migration';
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION validate_inferred_evidence_sources()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.evidence_kind IN ('DERIVED_FEATURE', 'NEGATIVE_EVIDENCE')
    AND NOT EXISTS (
      SELECT 1
      FROM evidence_edges
      WHERE derived_evidence_id = NEW.id
    )
  THEN
    RAISE EXCEPTION '% must link to at least one source observation', NEW.evidence_kind;
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS evidence_sources_required ON evidence;
CREATE CONSTRAINT TRIGGER evidence_sources_required
AFTER INSERT ON evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_inferred_evidence_sources();

INSERT INTO schema_migrations(version)
VALUES ('003_evidence_integrity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
