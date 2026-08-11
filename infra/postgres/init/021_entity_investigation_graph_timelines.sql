\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS entity_investigation_graph_timeline_reports (
  id text PRIMARY KEY CHECK (id ~ '^eit_[0-9a-f]{24}$'),
  ledger ledger_kind NOT NULL,
  chain_id text NOT NULL CHECK (chain_id <> ''),
  from_position numeric(30, 0) NOT NULL CHECK (from_position >= 0),
  to_position numeric(30, 0) NOT NULL CHECK (to_position >= from_position),
  graph_set_hash char(64) NOT NULL CHECK (graph_set_hash ~ '^[0-9a-f]{64}$'),
  result_hash char(64) NOT NULL UNIQUE CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  terminal_evidence_id text NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  graph_ids text[] NOT NULL CHECK (cardinality(graph_ids) BETWEEN 2 AND 100),
  subject_ids text[] NOT NULL CHECK (cardinality(subject_ids) BETWEEN 2 AND 500),
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) BETWEEN 3 AND 101),
  source_set text[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version text NOT NULL CHECK (
    model_version = 'entity-investigation-graph-timeline-v0.1.0'
  ),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entity_investigation_graph_timeline_latest_idx
  ON entity_investigation_graph_timeline_reports (
    ledger, chain_id, to_position DESC, captured_at DESC, created_at DESC, id DESC
  );

CREATE INDEX IF NOT EXISTS entity_investigation_graph_timeline_subjects_idx
  ON entity_investigation_graph_timeline_reports USING gin (subject_ids);

CREATE OR REPLACE FUNCTION validate_entity_investigation_graph_timeline_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  terminal evidence%ROWTYPE;
  latest_snapshot jsonb;
  expected_position text;
  expected_finality text;
  expected_locator text;
  parent_evidence_ids text[];
BEGIN
  IF NEW.report ->> 'schemaVersion' IS DISTINCT FROM
      'entity-investigation-graph-timeline-report-v1'
    OR NEW.report ->> 'sourceOfTruth' IS DISTINCT FROM
      'DURABLE_ENTITY_INVESTIGATION_GRAPHS'
    OR (NEW.report ->> 'automaticOwnershipMergeAllowed')::boolean IS DISTINCT FROM false
    OR (NEW.report ->> 'automaticEntityMembershipMutationAllowed')::boolean IS DISTINCT FROM false
    OR (NEW.report ->> 'relationshipTerminationInferenceAllowed')::boolean IS DISTINCT FROM false
    OR NEW.report #>> '{timeline,request,ledger}' IS DISTINCT FROM NEW.ledger::text
    OR NEW.report #>> '{timeline,request,chainId}' IS DISTINCT FROM NEW.chain_id
    OR NEW.report #>> '{timeline,request,fromPosition}' IS DISTINCT FROM NEW.from_position::text
    OR NEW.report #>> '{timeline,request,toPosition}' IS DISTINCT FROM NEW.to_position::text
    OR NEW.report #>> '{timeline,request,graphSetHash}' IS DISTINCT FROM NEW.graph_set_hash
    OR NEW.report #>> '{timeline,metadata,modelVersion}' IS DISTINCT FROM NEW.model_version
    OR NEW.report ->> 'terminalEvidenceId' IS DISTINCT FROM NEW.terminal_evidence_id
    OR (NEW.report #>> '{timeline,summary,completeRequestedGraphSet}')::boolean
      IS DISTINCT FROM true
    OR (NEW.report #>> '{timeline,summary,rawTransferEdgesCopied}')::boolean
      IS DISTINCT FROM false
    OR (NEW.report #>> '{timeline,summary,absenceEstablishesRelationshipTermination}')::boolean
      IS DISTINCT FROM false
    OR (NEW.report #>> '{timeline,summary,automaticEntityMembershipMutationAllowed}')::boolean
      IS DISTINCT FROM false
    OR jsonb_typeof(NEW.report #> '{timeline,observations}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report #> '{timeline,observations}') < 2
    OR jsonb_typeof(NEW.report #> '{timeline,transitions}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.report #> '{timeline,transitions}') < 1
    OR jsonb_typeof(NEW.report -> 'evidence') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Entity investigation graph timeline conflicts with its stored identity';
  END IF;

  latest_snapshot := NEW.report #> '{timeline,metadata,snapshot}';
  CASE NEW.ledger
    WHEN 'EVM' THEN
      expected_position := latest_snapshot ->> 'blockNumber';
      expected_finality := latest_snapshot ->> 'finality';
    WHEN 'BITCOIN' THEN
      expected_position := latest_snapshot ->> 'height';
      expected_finality := latest_snapshot ->> 'finality';
    WHEN 'SOLANA' THEN
      expected_position := latest_snapshot ->> 'slot';
      expected_finality := latest_snapshot ->> 'commitment';
  END CASE;
  IF expected_position IS DISTINCT FROM NEW.to_position::text
    OR (latest_snapshot ->> 'capturedAt')::timestamptz IS DISTINCT FROM NEW.captured_at
  THEN
    RAISE EXCEPTION 'Entity investigation graph timeline latest Snapshot conflicts with stored identity';
  END IF;

  parent_evidence_ids := ARRAY(
    SELECT DISTINCT observation ->> 'terminalEvidenceId'
    FROM jsonb_array_elements(NEW.report #> '{timeline,observations}') observation
    ORDER BY observation ->> 'terminalEvidenceId'
  );

  IF cardinality(NEW.graph_ids) <> cardinality(ARRAY(SELECT DISTINCT value FROM unnest(NEW.graph_ids) value))
    OR NEW.graph_ids <> ARRAY(
      SELECT value
      FROM jsonb_array_elements_text(NEW.report #> '{timeline,request,graphIds}')
        WITH ORDINALITY requested(value, ordinal)
      ORDER BY ordinal
    )
    OR NEW.subject_ids <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.subject_ids) value ORDER BY value)
    OR NEW.evidence_ids <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.evidence_ids) value ORDER BY value)
    OR NEW.source_set <> ARRAY(SELECT DISTINCT value FROM unnest(NEW.source_set) value ORDER BY value)
    OR NEW.subject_ids <> ARRAY(
      SELECT DISTINCT subject_id
      FROM jsonb_array_elements(NEW.report #> '{timeline,observations}') observation
      CROSS JOIN LATERAL jsonb_array_elements_text(observation -> 'subjectIds') subject_id
      ORDER BY subject_id
    )
    OR NEW.evidence_ids <> ARRAY(
      SELECT DISTINCT item ->> 'id'
      FROM jsonb_array_elements(NEW.report -> 'evidence') item
      ORDER BY item ->> 'id'
    )
    OR NEW.source_set <> ARRAY(
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(NEW.report #> '{timeline,metadata,sourceSet}') value
      ORDER BY value
    )
    OR NEW.report #> '{timeline,metadata,evidenceIds}' IS DISTINCT FROM to_jsonb(parent_evidence_ids)
    OR NOT NEW.terminal_evidence_id = ANY(NEW.evidence_ids)
  THEN
    RAISE EXCEPTION 'Entity investigation graph timeline provenance arrays are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{timeline,observations}') observation
    LEFT JOIN entity_investigation_graph_reports graph
      ON graph.id = observation ->> 'graphId'
    WHERE graph.id IS NULL
      OR graph.ledger <> NEW.ledger
      OR graph.chain_id <> NEW.chain_id
      OR graph.result_hash <> observation ->> 'resultHash'
      OR graph.timeline_set_hash <> observation ->> 'timelineSetHash'
      OR graph.terminal_evidence_id <> observation ->> 'terminalEvidenceId'
      OR graph.report #> '{graph,metadata}' IS DISTINCT FROM observation -> 'metadata'
      OR observation -> 'subjectIds' IS DISTINCT FROM to_jsonb(graph.subject_ids)
      OR jsonb_array_length(observation -> 'pairs') < 1
      OR jsonb_array_length(observation -> 'pairs') <>
        jsonb_array_length(graph.report #> '{graph,observations}')
  ) THEN
    RAISE EXCEPTION 'Entity investigation graph timeline observation conflicts with a durable graph';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{timeline,observations}') observation
    JOIN entity_investigation_graph_reports graph ON graph.id = observation ->> 'graphId'
    CROSS JOIN LATERAL jsonb_array_elements(observation -> 'pairs') pair
    LEFT JOIN LATERAL (
      SELECT graph_observation
      FROM jsonb_array_elements(graph.report #> '{graph,observations}') graph_observation
      WHERE graph_observation ->> 'subjectA' = pair ->> 'subjectA'
        AND graph_observation ->> 'subjectB' = pair ->> 'subjectB'
      LIMIT 1
    ) matched ON true
    LEFT JOIN LATERAL (
      SELECT edge
      FROM jsonb_array_elements(graph.report #> '{graph,edges}') edge
      WHERE edge ->> 'timelineId' = matched.graph_observation ->> 'timelineId'
      LIMIT 1
    ) projected ON true
    WHERE matched.graph_observation IS NULL
      OR pair #>> '{state,timelineId}' IS DISTINCT FROM matched.graph_observation ->> 'timelineId'
      OR pair #>> '{state,classification}' IS DISTINCT FROM matched.graph_observation ->> 'classification'
      OR pair #> '{state,sameControllerProbability}'
        IS DISTINCT FROM matched.graph_observation -> 'sameControllerProbability'
      OR pair #> '{state,coordinationProbability}'
        IS DISTINCT FROM matched.graph_observation -> 'coordinationProbability'
      OR pair #> '{state,independenceProbability}'
        IS DISTINCT FROM matched.graph_observation -> 'independenceProbability'
      OR pair #>> '{state,serviceSuppressionApplied}'
        IS DISTINCT FROM matched.graph_observation ->> 'serviceSuppressionApplied'
      OR pair #>> '{state,projectionState}'
        IS DISTINCT FROM matched.graph_observation ->> 'projectionState'
      OR pair #>> '{state,terminalEvidenceId}'
        IS DISTINCT FROM matched.graph_observation ->> 'terminalEvidenceId'
      OR pair #>> '{state,relation,state}' IS DISTINCT FROM 'known'
      OR (
        matched.graph_observation ->> 'projectionState' = 'PROJECTED'
        AND pair #>> '{state,relation,value}' IS DISTINCT FROM projected.edge ->> 'relation'
      )
      OR (
        matched.graph_observation ->> 'projectionState' <> 'PROJECTED'
        AND pair #> '{state,relation,value}' IS DISTINCT FROM 'null'::jsonb
      )
      OR (pair #>> '{state,automaticOwnershipPropagationAllowed}')::boolean IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'Entity investigation graph timeline pair state conflicts with its durable graph';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.report #> '{timeline,observations}') observation
    JOIN entity_investigation_graph_reports graph ON graph.id = observation ->> 'graphId'
    WHERE jsonb_array_length(observation -> 'pairs') <> (
        SELECT count(DISTINCT (pair ->> 'subjectA', pair ->> 'subjectB'))
        FROM jsonb_array_elements(observation -> 'pairs') pair
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(graph.report #> '{graph,observations}') graph_observation
        WHERE NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(observation -> 'pairs') pair
          WHERE pair ->> 'subjectA' = graph_observation ->> 'subjectA'
            AND pair ->> 'subjectB' = graph_observation ->> 'subjectB'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Entity investigation graph timeline observation pair set is incomplete';
  END IF;

  IF jsonb_array_length(NEW.report #> '{timeline,transitions}') <>
      jsonb_array_length(NEW.report #> '{timeline,observations}') - 1
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.report #> '{timeline,transitions}')
        WITH ORDINALITY transition(value, ordinal)
      JOIN LATERAL (
        SELECT value AS before
        FROM jsonb_array_elements(NEW.report #> '{timeline,observations}')
          WITH ORDINALITY item(value, ordinal)
        WHERE item.ordinal = transition.ordinal
      ) previous ON true
      JOIN LATERAL (
        SELECT value AS after
        FROM jsonb_array_elements(NEW.report #> '{timeline,observations}')
          WITH ORDINALITY item(value, ordinal)
        WHERE item.ordinal = transition.ordinal + 1
      ) following ON true
      WHERE transition.value ->> 'fromGraphId' IS DISTINCT FROM previous.before ->> 'graphId'
        OR transition.value ->> 'toGraphId' IS DISTINCT FROM following.after ->> 'graphId'
        OR transition.value -> 'evidenceIds' IS DISTINCT FROM to_jsonb(ARRAY(
          SELECT value FROM unnest(ARRAY[
            previous.before ->> 'terminalEvidenceId',
            following.after ->> 'terminalEvidenceId'
          ]) value ORDER BY value
        ))
        OR (transition.value ->> 'omittedSubjectsEstablishExit')::boolean IS DISTINCT FROM false
        OR (transition.value ->> 'omittedPairsEstablishRelationshipEnd')::boolean IS DISTINCT FROM false
        OR (transition.value ->> 'automaticEntityMembershipMutationAllowed')::boolean IS DISTINCT FROM false
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.report #> '{timeline,transitions}') transition
      CROSS JOIN LATERAL jsonb_array_elements(transition -> 'pairChanges') change
      WHERE (change ->> 'relationshipStartEstablished')::boolean IS DISTINCT FROM false
        OR (change ->> 'relationshipEndEstablished')::boolean IS DISTINCT FROM false
        OR (change ->> 'automaticEntityMembershipMutationAllowed')::boolean IS DISTINCT FROM false
        OR (
          change #>> '{before,state}' <> 'known'
          AND change #>> '{before,reason}' IS DISTINCT FROM 'NOT_QUERIED'
        )
        OR (
          change #>> '{after,state}' <> 'known'
          AND change #>> '{after,reason}' IS DISTINCT FROM 'NOT_QUERIED'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.report #> '{timeline,transitions}')
        WITH ORDINALITY transition(value, ordinal)
      JOIN LATERAL (
        SELECT value AS before
        FROM jsonb_array_elements(NEW.report #> '{timeline,observations}')
          WITH ORDINALITY item(value, ordinal)
        WHERE item.ordinal = transition.ordinal
      ) previous ON true
      JOIN LATERAL (
        SELECT value AS after
        FROM jsonb_array_elements(NEW.report #> '{timeline,observations}')
          WITH ORDINALITY item(value, ordinal)
        WHERE item.ordinal = transition.ordinal + 1
      ) following ON true
      JOIN LATERAL (
        SELECT
          count(*) AS pair_count,
          count(*) FILTER (
            WHERE before_pair IS DISTINCT FROM after_pair
          ) AS changed_pair_count,
          COALESCE(
            jsonb_agg(
              jsonb_build_object('subjectA', subject_a, 'subjectB', subject_b)
              ORDER BY subject_a, subject_b
            ) FILTER (WHERE before_pair IS DISTINCT FROM after_pair),
            '[]'::jsonb
          ) AS changed_pair_keys
        FROM (
          SELECT
            COALESCE(before_item.pair ->> 'subjectA', after_item.pair ->> 'subjectA') AS subject_a,
            COALESCE(before_item.pair ->> 'subjectB', after_item.pair ->> 'subjectB') AS subject_b,
            before_item.pair AS before_pair,
            after_item.pair AS after_pair
          FROM jsonb_array_elements(previous.before -> 'pairs') before_item(pair)
          FULL JOIN jsonb_array_elements(following.after -> 'pairs') after_item(pair)
            ON before_item.pair ->> 'subjectA' = after_item.pair ->> 'subjectA'
            AND before_item.pair ->> 'subjectB' = after_item.pair ->> 'subjectB'
        ) pair_universe
      ) expected ON true
      WHERE jsonb_array_length(transition.value -> 'pairChanges') <> expected.changed_pair_count
        OR (transition.value ->> 'unchangedPairCount')::integer <>
          expected.pair_count - expected.changed_pair_count
        OR (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'subjectA', change ->> 'subjectA',
                'subjectB', change ->> 'subjectB'
              ) ORDER BY ordinal
            ),
            '[]'::jsonb
          )
          FROM jsonb_array_elements(transition.value -> 'pairChanges')
            WITH ORDINALITY listed(change, ordinal)
        ) IS DISTINCT FROM expected.changed_pair_keys
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(transition.value -> 'pairChanges') change
          LEFT JOIN LATERAL (
            SELECT pair
            FROM jsonb_array_elements(previous.before -> 'pairs') pair
            WHERE pair ->> 'subjectA' = change ->> 'subjectA'
              AND pair ->> 'subjectB' = change ->> 'subjectB'
            LIMIT 1
          ) before_match ON true
          LEFT JOIN LATERAL (
            SELECT pair
            FROM jsonb_array_elements(following.after -> 'pairs') pair
            WHERE pair ->> 'subjectA' = change ->> 'subjectA'
              AND pair ->> 'subjectB' = change ->> 'subjectB'
            LIMIT 1
          ) after_match ON true
          WHERE change -> 'before' IS DISTINCT FROM CASE
              WHEN before_match.pair IS NULL THEN jsonb_build_object(
                'state', 'unknown',
                'reason', 'NOT_QUERIED',
                'detail',
                  'This pair was not included in the earlier requested investigation graph.'
              )
              ELSE jsonb_build_object('state', 'known', 'value', before_match.pair -> 'state')
            END
            OR change -> 'after' IS DISTINCT FROM CASE
              WHEN after_match.pair IS NULL THEN jsonb_build_object(
                'state', 'unknown',
                'reason', 'NOT_QUERIED',
                'detail',
                  'This pair was not included in the later requested investigation graph.'
              )
              ELSE jsonb_build_object('state', 'known', 'value', after_match.pair -> 'state')
            END
            OR change ->> 'kind' IS DISTINCT FROM CASE
              WHEN before_match.pair IS NULL THEN 'ADDED_TO_REQUESTED_GRAPH'
              WHEN after_match.pair IS NULL THEN 'OMITTED_FROM_REQUESTED_GRAPH'
              WHEN before_match.pair #> '{state,projectionState}' IS DISTINCT FROM
                after_match.pair #> '{state,projectionState}' THEN 'PROJECTION_CHANGED'
              WHEN before_match.pair #> '{state,relation}' IS DISTINCT FROM
                after_match.pair #> '{state,relation}' THEN 'RELATION_CHANGED'
              WHEN before_match.pair #> '{state,classification}' IS DISTINCT FROM
                after_match.pair #> '{state,classification}' THEN 'CLASSIFICATION_CHANGED'
              WHEN before_match.pair #> '{state,serviceSuppressionApplied}' IS DISTINCT FROM
                after_match.pair #> '{state,serviceSuppressionApplied}'
                THEN 'SERVICE_SUPPRESSION_CHANGED'
              WHEN before_match.pair #> '{state,sameControllerProbability}' IS DISTINCT FROM
                after_match.pair #> '{state,sameControllerProbability}'
                OR before_match.pair #> '{state,coordinationProbability}' IS DISTINCT FROM
                  after_match.pair #> '{state,coordinationProbability}'
                OR before_match.pair #> '{state,independenceProbability}' IS DISTINCT FROM
                  after_match.pair #> '{state,independenceProbability}'
                THEN 'PROBABILITY_CHANGED'
              WHEN before_match.pair #> '{state,timelineId}' IS DISTINCT FROM
                after_match.pair #> '{state,timelineId}'
                OR before_match.pair #> '{state,terminalEvidenceId}' IS DISTINCT FROM
                  after_match.pair #> '{state,terminalEvidenceId}'
                THEN 'EVIDENCE_REFRESHED'
              ELSE NULL
            END
            OR change -> 'evidenceIds' IS DISTINCT FROM to_jsonb(ARRAY(
              SELECT DISTINCT evidence_id
              FROM unnest(ARRAY[
                before_match.pair #>> '{state,terminalEvidenceId}',
                after_match.pair #>> '{state,terminalEvidenceId}'
              ]) evidence_id
              WHERE evidence_id IS NOT NULL
              ORDER BY evidence_id
            ))
        )
    )
  THEN
    RAISE EXCEPTION 'Entity investigation graph timeline transition violates temporal boundaries';
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
    RAISE EXCEPTION 'Entity investigation graph timeline Evidence conflicts with durable Evidence';
  END IF;

  expected_locator := 'entity-investigation-graph-timeline:' || NEW.ledger::text || ':'
    || NEW.chain_id || ':' || NEW.from_position::text || '-' || NEW.to_position::text || ':'
    || NEW.graph_set_hash;
  SELECT * INTO terminal FROM evidence WHERE id = NEW.terminal_evidence_id;
  IF NOT FOUND
    OR terminal.evidence_kind <> 'DERIVED_FEATURE'
    OR terminal.source <> 'zerotrace:entity-investigation-graph-timeline-v0.1.0'
    OR terminal.locator <> expected_locator
    OR terminal.block_or_slot::text <> expected_position
    OR terminal.finality <> expected_finality
  THEN
    RAISE EXCEPTION 'Entity investigation graph timeline terminal Evidence conflicts with report';
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
    RAISE EXCEPTION 'Entity investigation graph timeline terminal Evidence parents are incomplete';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS entity_investigation_graph_timeline_insert_guard
ON entity_investigation_graph_timeline_reports;
CREATE TRIGGER entity_investigation_graph_timeline_insert_guard
BEFORE INSERT ON entity_investigation_graph_timeline_reports
FOR EACH ROW EXECUTE FUNCTION validate_entity_investigation_graph_timeline_insert();

CREATE OR REPLACE FUNCTION reject_entity_investigation_graph_timeline_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'entity_investigation_graph_timeline_reports is immutable; mutation is forbidden';
END
$function$;

DROP TRIGGER IF EXISTS entity_investigation_graph_timeline_update_guard
ON entity_investigation_graph_timeline_reports;
CREATE TRIGGER entity_investigation_graph_timeline_update_guard
BEFORE UPDATE ON entity_investigation_graph_timeline_reports
FOR EACH ROW EXECUTE FUNCTION reject_entity_investigation_graph_timeline_mutation();

DROP TRIGGER IF EXISTS entity_investigation_graph_timeline_delete_guard
ON entity_investigation_graph_timeline_reports;
CREATE TRIGGER entity_investigation_graph_timeline_delete_guard
BEFORE DELETE ON entity_investigation_graph_timeline_reports
FOR EACH ROW EXECUTE FUNCTION reject_entity_investigation_graph_timeline_mutation();

INSERT INTO schema_migrations(version)
VALUES ('021_entity_investigation_graph_timelines')
ON CONFLICT (version) DO NOTHING;

COMMIT;
