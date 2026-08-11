\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'zerotrace_investigation') THEN
    PERFORM create_graph('zerotrace_investigation');
  END IF;
END
$block$;

CREATE TABLE IF NOT EXISTS public.zerotrace_graph_projection_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zerotrace_graph_projection_registry (
  graph_report_id text PRIMARY KEY CHECK (graph_report_id ~ '^eig_[0-9a-f]{24}$'),
  result_hash char(64) NOT NULL UNIQUE CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  node_count integer NOT NULL CHECK (node_count BETWEEN 2 AND 500),
  edge_count integer NOT NULL CHECK (edge_count BETWEEN 0 AND 250),
  projected_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.reject_zerotrace_graph_projection_registry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'zerotrace_graph_projection_registry is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS zerotrace_graph_projection_registry_update_guard
ON public.zerotrace_graph_projection_registry;
CREATE TRIGGER zerotrace_graph_projection_registry_update_guard
BEFORE UPDATE ON public.zerotrace_graph_projection_registry
FOR EACH ROW EXECUTE FUNCTION public.reject_zerotrace_graph_projection_registry_mutation();

DROP TRIGGER IF EXISTS zerotrace_graph_projection_registry_delete_guard
ON public.zerotrace_graph_projection_registry;
CREATE TRIGGER zerotrace_graph_projection_registry_delete_guard
BEFORE DELETE ON public.zerotrace_graph_projection_registry
FOR EACH ROW EXECUTE FUNCTION public.reject_zerotrace_graph_projection_registry_mutation();

INSERT INTO public.zerotrace_graph_projection_migrations(version)
VALUES ('001_investigation_graph_projection')
ON CONFLICT (version) DO NOTHING;
