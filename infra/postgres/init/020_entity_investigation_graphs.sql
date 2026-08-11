\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS entity_investigation_graph_reports (
  id text PRIMARY KEY CHECK (id ~ '^eig_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (chain_id <> ''),
  as_of_position numeric(30, 0) NOT NULL CHECK (as_of_position >= 0),
  as_of_hash text NOT NULL CHECK (as_of_hash <> ''),
  timeline_set_hash char(64) NOT NULL CHECK (timeline_set_hash ~ '^[0-9a-f]{64}$'),
  result_hash char(64) NOT NULL UNIQUE CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  timeline_ids text[] NOT NULL CHECK (cardinality(timeline_ids) BETWEEN 1 AND 250),
  subject_ids text[] NOT NULL CHECK (cardinality(subject_ids) BETWEEN 2 AND 500),
  edge_ids text[] NOT NULL CHECK (cardinality(edge_ids) BETWEEN 0 AND 250),
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) BETWEEN 2 AND 251),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (model_version = 'entity-investigation-graph-v0.1.0'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entity_investigation_graph_latest_idx
  ON entity_investigation_graph_reports (
    ledger, chain_id, as_of_position DESC, captured_at DESC, created_at DESC, id DESC
  );

CREATE INDEX IF NOT EXISTS entity_investigation_graph_subjects_idx
  ON entity_investigation_graph_reports USING gin (subject_ids);

CREATE OR REPLACE FUNCTION validate_entity_investigation_graph_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  terminal evidence%ROWTYPE;
  snapshot jsonb;
  expected_position text;
  expected_hash text;
  expected_finality text;
  expected_locator text;
  parent_evidence_ids text[];
BEGIN
  IF NEW.report ->> 'schemaVersion' IS DISTINCT FROM 'entity-investigation-graph-report-v1'
    OR NEW.report ->> 'sourceOfTruth' IS DISTINCT FROM 'DURABLE_ENTITY_RELATIONSHIP_TIMELINES'
    OR (NEW.report ->> 'automaticOwnershipMergeAllowed')::boolean IS DISTINCT FROM false
    OR NEW.report #>> '{graph,request,ledger}' IS DISTINCT FROM NEW.ledger::text
    OR NEW.report #>> '{graph,request,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{graph,request,timelineSetHash}' IS DISTINCT FROM NEW.timeline_set_hash
    OR NEW.report #>> '{graph,metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR (NEW.report #>> '{graph,summary,rawTransferEdgesCopied}')::boolean IS DISTINCT FROM false
    OR (NEW.report #>> '{graph,summary,completeRequestedTimelineSet}')::boolean IS DISTINCT FROM true
    OR jsonb_typeof(NEW.report #> '{graph,nodes}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report #> '{graph,nodes}') < 2
    OR jsonb_typeof(NEW.report #> '{graph,observations}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report #> '{graph,observations}') < 1
    OR jsonb_typeof(NEW.report #> '{graph,edges}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report #> '{graph,investigationComponents}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Entity investigation graph conflicts with its stored identity';
  END IF;

  snapshot := NEW.report #> '{graph,metadata,snapshot}';
  CASE NEW.ledger
    WHEN 'EVM' THEN
      expected_position := snapshot ->> 'blockNumber';
      expected_hash := snapshot ->> 'blockHash';
      expected_finality := snapshot ->> 'finality';
    WHEN 'BITCOIN' THEN
      expected_position := snapshot ->> 'height';
      expected_hash := snapshot ->> 'blockHash';
      expected_finality := snapshot ->> 'finality';
    WHEN 'SOLANA' THEN
      expected_position := snapshot ->> 'slot';
      expected_hash := snapshot ->> 'blockhash';
      expected_finality := snapshot ->> 'commitment';
  END CASE;
  IF expected_position IS DISTINCT FROM NEW.as_of_position::text
    OR expected_hash IS DISTINCT FROM NEW.as_of_hash
    OR (snapshot ->> 'capturedAt')::timestamptz IS DISTINCT FROM NEW.captured_at
  THEN
    RAISE EXCEPTION 'Entity investigation graph Snapshot conflicts with stored identity';
  END IF;

  parent_evidence_ids := ARRAY(
    SELECT DISTINCT observation ->> 'terminalEvidenceId'
    FROM jsonb_array_elements(NEW.report #> '{graph,observations}') observation
    ORDER BY observation ->> 'terminalEvidenceId'
  );

  IF NEW.timeline_ids <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.timeline_ids) value ORDER BY value)
    OR NEW.subject_ids <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.subject_ids) value ORDER BY value)
    OR NEW.edge_ids <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.edge_ids) value ORDER BY value)
    OR NEW.evidence_ids <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value)
    OR NEW.source_set <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value)
    OR NEW.timeline_ids <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{graph,request,timelineIds}') value
      ORDER BY value
    )
    OR NEW.subject_ids <> ARRAY(
      SELECT DISTINCT node ->> 'subjectId'
      FROM jsonb_array_elements(NEW.report #> '{graph,nodes}') node
      ORDER BY node ->> 'subjectId'
    )
    OR NEW.edge_ids <> ARRAY(
      SELECT DISTINCT edge ->> 'id'
      FROM jsonb_array_elements(NEW.report #> '{graph,edges}') edge
      ORDER BY edge ->> 'id'
    )
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT item ->> 'id'
      FROM jsonb_array_elements(NEW.report -> 'evidence') item
      ORDER BY item ->> 'id'
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{graph,metadata,sourceSet}') value
      ORDER BY value
    )
    OR NEW.report #> '{graph,metadata,evidenceIds}' IS DISTINCT FROM to_jsonb(parent_evidence_ids)
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'Entity investigation graph provenance arrays must be canonical and complete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{graph,observations}') observation
    LEFT JOIN entity_relationship_timeline_reports timeline
      ON timeline.id = observation ->> 'timelineId'
    WHERE timeline.id IS NULL
      OR timeline.ledger <> NEW.ledger
      OR timeline.chain_id <> NEW.chain_id
      OR timeline.result_hash <> observation ->> 'timelineResultHash'
      OR timeline.terminal_evidence_id <> observation ->> 'terminalEvidenceId'
      OR timeline.subject_a <> observation ->> 'subjectA'
      OR timeline.subject_b <> observation ->> 'subjectB'
      OR timeline.from_position::text <> observation ->> 'fromPosition'
      OR timeline.to_position::text <> observation ->> 'toPosition'
      OR timeline.report #> '{timeline,metadata,snapshot}' IS DISTINCT FROM snapshot
      OR timeline.report #>> '{timeline,summary,currentClassification}' <> observation ->> 'classification'
      OR timeline.report #> '{timeline,summary,currentSameControllerProbability}'
        IS DISTINCT FROM observation -> 'sameControllerProbability'
      OR timeline.report #> '{timeline,summary,currentCoordinationProbability}'
        IS DISTINCT FROM observation -> 'coordinationProbability'
      OR timeline.report #> '{timeline,summary,currentIndependenceProbability}'
        IS DISTINCT FROM observation -> 'independenceProbability'
  ) THEN
    RAISE EXCEPTION 'Entity investigation graph observation conflicts with a durable timeline';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{graph,edges}') edge
    WHERE (edge ->> 'automaticOwnershipPropagationAllowed')::boolean IS DISTINCT FROM false
      OR edge ->> 'relation' NOT IN ('SAME_CONTROLLER', 'COORDINATED_WITH')
      OR (
        edge ->> 'relation' = 'SAME_CONTROLLER'
        AND edge ->> 'classification' NOT IN (
          'CONFIRMED_SAME_CONTROLLER',
          'HIGHLY_PROBABLE_SAME_CONTROLLER',
          'PROBABLE_SAME_CONTROLLER'
        )
      )
      OR (
        edge ->> 'relation' = 'COORDINATED_WITH'
        AND edge ->> 'classification' IS DISTINCT FROM 'COORDINATED_BUT_INDEPENDENT'
      )
  ) THEN
    RAISE EXCEPTION 'Entity investigation graph edge violates propagation boundaries';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{graph,observations}') observation
    LEFT JOIN jsonb_array_elements(NEW.report #> '{graph,edges}') edge
      ON edge ->> 'timelineId' = observation ->> 'timelineId'
    WHERE (
        observation ->> 'projectionState' = 'PROJECTED'
        AND (
          edge IS NULL
          OR observation #>> '{projectedEdgeId,state}' IS DISTINCT FROM 'known'
          OR observation #>> '{projectedEdgeId,value}' IS DISTINCT FROM edge ->> 'id'
          OR observation ->> 'subjectA' IS DISTINCT FROM edge ->> 'subjectA'
          OR observation ->> 'subjectB' IS DISTINCT FROM edge ->> 'subjectB'
          OR observation ->> 'classification' IS DISTINCT FROM edge ->> 'classification'
          OR observation -> 'sameControllerProbability'
            IS DISTINCT FROM edge -> 'sameControllerProbability'
          OR observation -> 'coordinationProbability'
            IS DISTINCT FROM edge -> 'coordinationProbability'
          OR observation -> 'independenceProbability'
            IS DISTINCT FROM edge -> 'independenceProbability'
          OR observation ->> 'terminalEvidenceId' IS DISTINCT FROM edge ->> 'terminalEvidenceId'
          OR observation ->> 'toPosition' IS DISTINCT FROM edge ->> 'validToPosition'
          OR (edge ->> 'validFromPosition')::numeric < (observation ->> 'fromPosition')::numeric
        )
      )
      OR (
        observation ->> 'projectionState' <> 'PROJECTED'
        AND edge IS NOT NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{graph,edges}') edge
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.report #> '{graph,observations}') observation
      WHERE observation ->> 'timelineId' = edge ->> 'timelineId'
        AND observation ->> 'projectionState' = 'PROJECTED'
        AND observation #>> '{projectedEdgeId,state}' = 'known'
        AND observation #>> '{projectedEdgeId,value}' = edge ->> 'id'
    )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{graph,edges}') edge
    JOIN jsonb_array_elements(NEW.report #> '{graph,nodes}') node
      ON node ->> 'id' IN (edge ->> 'sourceNodeId', edge ->> 'targetNodeId')
    WHERE (
        node #>> '{serviceInfrastructure,state}' = 'known'
        AND (node #>> '{serviceInfrastructure,value}')::boolean
      ) OR (
        node #>> '{serviceInfrastructure,state}' = 'unknown'
        AND node #>> '{serviceInfrastructure,reason}' = 'CONFLICTING_SOURCES'
      )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{graph,edges}') edge
    LEFT JOIN jsonb_array_elements(NEW.report #> '{graph,nodes}') source_node
      ON source_node ->> 'id' = edge ->> 'sourceNodeId'
    LEFT JOIN jsonb_array_elements(NEW.report #> '{graph,nodes}') target_node
      ON target_node ->> 'id' = edge ->> 'targetNodeId'
    LEFT JOIN entity_relationship_timeline_reports timeline
      ON timeline.id = edge ->> 'timelineId'
    WHERE source_node ->> 'subjectId' IS DISTINCT FROM edge ->> 'subjectA'
      OR target_node ->> 'subjectId' IS DISTINCT FROM edge ->> 'subjectB'
      OR timeline.id IS NULL
      OR timeline.report #>> '{timeline,summary,observationCount}'
        IS DISTINCT FROM edge ->> 'observationCount'
      OR timeline.report #>> '{timeline,summary,classificationChangeCount}'
        IS DISTINCT FROM edge ->> 'classificationChangeCount'
      OR timeline.report #> '{timeline,summary,chainObservationContinuity}'
        IS DISTINCT FROM edge -> 'temporalContinuity'
  ) THEN
    RAISE EXCEPTION 'Entity investigation graph observations, edges, and service suppression disagree';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report -> 'evidence') item
    LEFT JOIN evidence e ON e.id = item ->> 'id'
    WHERE e.id IS NULL
      OR item ->> 'ledger' IS DISTINCT FROM e.ledger::text
      OR item ->> 'chainId' IS DISTINCT FROM e.chain_id
      OR item ->> 'kind' IS DISTINCT FROM e.evidence_kind
      OR item ->> 'source' IS DISTINCT FROM e.source
      OR item ->> 'locator' IS DISTINCT FROM e.locator
      OR item ->> 'sourceUri' IS DISTINCT FROM e.source_uri
      OR item ->> 'payloadHash' IS DISTINCT FROM e.payload_hash
      OR (item ->> 'observedAt')::timestamptz IS DISTINCT FROM e.observed_at
      OR item ->> 'blockOrSlot' IS DISTINCT FROM e.block_or_slot::text
      OR item ->> 'finality' IS DISTINCT FROM e.finality
      OR item ->> 'summary' IS DISTINCT FROM e.summary
      OR item ->> 'rawArtifactRef' IS DISTINCT FROM e.raw_artifact_ref
  ) THEN
    RAISE EXCEPTION 'Entity investigation graph Evidence payload conflicts with durable Evidence';
  END IF;

  expected_locator := 'entity-investigation-graph:' || NEW.ledger::text || ':' || NEW.chain_id || ':'
    || NEW.as_of_position::text || ':' || NEW.timeline_set_hash;
  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  IF NOT FOUND
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:entity-investigation-graph-v0.1.0'
    OR terminal.locator <> expected_locator
    OR terminal.block_or_slot::text <> expected_position
    OR terminal.finality <> expected_finality
  THEN
    RAISE EXCEPTION 'Entity investigation graph terminal Evidence conflicts with report identity';
  END IF;

  IF (SELECT count(*) FROM evidence_edges WHERE derived_evidence_id = NEW.terminal_evidence_id)
      <> cardinality(parent_evidence_ids)
    OR EXISTS (
      SELECT 1 FROM unnest(parent_evidence_ids) source_id
      WHERE NOT EXISTS (
        SELECT 1 FROM evidence_edges edge
        WHERE edge.derived_evidence_id = NEW.terminal_evidence_id
          AND edge.source_evidence_id = source_id
      )
    )
  THEN
    RAISE EXCEPTION 'Entity investigation graph terminal Evidence parents are incomplete';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS entity_investigation_graph_insert_guard
ON entity_investigation_graph_reports;
CREATE TRIGGER entity_investigation_graph_insert_guard
BEFORE INSERT ON entity_investigation_graph_reports
FOR EACH ROW EXECUTE FUNCTION validate_entity_investigation_graph_insert();

CREATE OR REPLACE FUNCTION reject_entity_investigation_graph_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'entity_investigation_graph_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS entity_investigation_graph_update_guard
ON entity_investigation_graph_reports;
CREATE TRIGGER entity_investigation_graph_update_guard
BEFORE UPDATE ON entity_investigation_graph_reports
FOR EACH ROW EXECUTE FUNCTION reject_entity_investigation_graph_mutation();

DROP TRIGGER IF EXISTS entity_investigation_graph_delete_guard
ON entity_investigation_graph_reports;
CREATE TRIGGER entity_investigation_graph_delete_guard
BEFORE DELETE ON entity_investigation_graph_reports
FOR EACH ROW EXECUTE FUNCTION reject_entity_investigation_graph_mutation();

INSERT INTO schema_migrations(version)
VALUES ('020_entity_investigation_graphs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
