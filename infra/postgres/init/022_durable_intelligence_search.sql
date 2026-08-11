\set ON_ERROR_STOP on

BEGIN;

CREATE INDEX IF NOT EXISTS subjects_search_identifier_idx
  ON subjects (ledger, chain_id, normalized_identifier);

CREATE INDEX IF NOT EXISTS subjects_search_evm_identifier_idx
  ON subjects (chain_id, lower(normalized_identifier))
  WHERE ledger = 'EVM';

CREATE INDEX IF NOT EXISTS label_observations_search_label_idx
  ON label_observations (lower(label), observed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS label_observations_search_category_idx
  ON label_observations (lower(category), observed_at DESC, id DESC);

CREATE OR REPLACE VIEW durable_intelligence_search_documents_v1 (
  document_key,
  ledger,
  chain_id,
  subject_type,
  normalized_identifier,
  record_type,
  record_id,
  role,
  snapshot_position,
  snapshot_hash,
  terminal_evidence_id,
  source_set,
  model_version,
  confidence,
  captured_at,
  label_id,
  label_text,
  label_category,
  created_at
) AS
SELECT
  'label:' || label.id::text,
  subject.ledger,
  subject.chain_id,
  subject.subject_type::text,
  subject.normalized_identifier,
  'LABEL_OBSERVATION',
  label.id::text,
  'SUBJECT',
  evidence.block_or_slot,
  snapshot.block_hash,
  label.evidence_id,
  jsonb_build_array(label.source),
  'label-observation-v1',
  label.source_confidence,
  label.observed_at,
  label.id,
  label.label,
  label.category,
  label.created_at
FROM label_observations label
JOIN subjects subject ON subject.id = label.subject_id
JOIN evidence ON evidence.id = label.evidence_id
LEFT JOIN analysis_snapshots snapshot ON snapshot.id = evidence.snapshot_id

UNION ALL

SELECT
  report.id || ':TOKEN',
  'EVM'::ledger_kind,
  report.chain_id,
  'TOKEN',
  report.token_address,
  'EVM_CLAIM_REPORT',
  report.id,
  'TOKEN',
  report.snapshot_block,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM evm_claim_reports report

UNION ALL

SELECT
  report.id || ':CLAIM_SUBJECT',
  'EVM'::ledger_kind,
  report.chain_id,
  'ADDRESS',
  report.subject_address,
  'EVM_CLAIM_REPORT',
  report.id,
  'CLAIM_SUBJECT',
  report.snapshot_block,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM evm_claim_reports report

UNION ALL

SELECT
  report.id || ':CONTROL_SUBJECT',
  'EVM'::ledger_kind,
  report.chain_id,
  'CONTRACT',
  report.subject_address,
  'EVM_CONTROL_SURFACE',
  report.id,
  'CONTROL_SUBJECT',
  report.snapshot_block,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM evm_control_surface_reports report

UNION ALL

SELECT
  report.id || ':CONTROL_SUBJECT',
  'SOLANA'::ledger_kind,
  report.chain_id,
  CASE
    WHEN report.report #>> '{accountKind,value}' IS NULL THEN 'UNKNOWN'
    WHEN report.report #>> '{accountKind,value}' = 'MINT' THEN 'TOKEN'
    WHEN report.report #>> '{accountKind,value}' IN ('PROGRAM', 'PROGRAM_DATA') THEN 'PROGRAM'
    ELSE 'ACCOUNT'
  END,
  report.subject_address,
  'SOLANA_CONTROL_SURFACE',
  report.id,
  'CONTROL_SUBJECT',
  report.snapshot_slot,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM solana_control_surface_reports report

UNION ALL

SELECT
  report.id || ':TRANSACTION',
  'SOLANA'::ledger_kind,
  report.chain_id,
  'TRANSACTION',
  report.signature,
  'SOLANA_TRANSACTION',
  report.id,
  'TRANSACTION',
  report.snapshot_slot,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM solana_transaction_reports report

UNION ALL

SELECT
  report.id || ':TOKEN',
  'EVM'::ledger_kind,
  report.chain_id,
  'TOKEN',
  report.token_address,
  'EVM_PENSION_CANDIDATE',
  report.id,
  'TOKEN',
  report.to_block,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM evm_pension_candidate_reports report

UNION ALL

SELECT
  report.id || ':TOKEN',
  'EVM'::ledger_kind,
  report.chain_id,
  'TOKEN',
  report.token_address,
  'FLAP_PENSION_ENTRY',
  report.id,
  'TOKEN',
  report.block_number,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM flap_pension_entry_reports report

UNION ALL

SELECT
  report.id || ':PENSION_WALLET',
  'EVM'::ledger_kind,
  report.chain_id,
  'ADDRESS',
  report.pension_wallet,
  'FLAP_PENSION_ENTRY',
  report.id,
  'PENSION_WALLET',
  report.block_number,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM flap_pension_entry_reports report

UNION ALL

SELECT
  report.id || ':SUBJECT_A',
  report.ledger,
  report.chain_id,
  'UNKNOWN',
  report.subject_a,
  'ENTITY_RELATIONSHIP',
  report.id,
  'SUBJECT_A',
  report.snapshot_position,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{result,metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM entity_relationship_reports report

UNION ALL

SELECT
  report.id || ':SUBJECT_B',
  report.ledger,
  report.chain_id,
  'UNKNOWN',
  report.subject_b,
  'ENTITY_RELATIONSHIP',
  report.id,
  'SUBJECT_B',
  report.snapshot_position,
  report.snapshot_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{result,metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM entity_relationship_reports report

UNION ALL

SELECT
  report.id || ':SUBJECT_A',
  report.ledger,
  report.chain_id,
  'UNKNOWN',
  report.subject_a,
  'ENTITY_RELATIONSHIP_TIMELINE',
  report.id,
  'SUBJECT_A',
  report.to_position,
  COALESCE(
    report.report #>> '{timeline,metadata,snapshot,blockHash}',
    report.report #>> '{timeline,metadata,snapshot,blockhash}'
  ),
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{timeline,metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM entity_relationship_timeline_reports report

UNION ALL

SELECT
  report.id || ':SUBJECT_B',
  report.ledger,
  report.chain_id,
  'UNKNOWN',
  report.subject_b,
  'ENTITY_RELATIONSHIP_TIMELINE',
  report.id,
  'SUBJECT_B',
  report.to_position,
  COALESCE(
    report.report #>> '{timeline,metadata,snapshot,blockHash}',
    report.report #>> '{timeline,metadata,snapshot,blockhash}'
  ),
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{timeline,metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM entity_relationship_timeline_reports report

UNION ALL

SELECT
  report.id || ':SUBJECT:' || subject_id,
  report.ledger,
  report.chain_id,
  'UNKNOWN',
  subject_id,
  'ENTITY_INVESTIGATION_GRAPH',
  report.id,
  'GRAPH_SUBJECT',
  report.as_of_position,
  report.as_of_hash,
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{graph,metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM entity_investigation_graph_reports report
CROSS JOIN LATERAL unnest(report.subject_ids) subject_id

UNION ALL

SELECT
  report.id || ':SUBJECT:' || subject_id,
  report.ledger,
  report.chain_id,
  'UNKNOWN',
  subject_id,
  'ENTITY_INVESTIGATION_GRAPH_TIMELINE',
  report.id,
  'GRAPH_SUBJECT',
  report.to_position,
  COALESCE(
    report.report #>> '{timeline,metadata,snapshot,blockHash}',
    report.report #>> '{timeline,metadata,snapshot,blockhash}'
  ),
  report.terminal_evidence_id,
  to_jsonb(report.source_set),
  report.model_version,
  (report.report #>> '{timeline,metadata,confidence}')::numeric,
  report.captured_at,
  NULL::uuid,
  NULL::text,
  NULL::text,
  report.created_at
FROM entity_investigation_graph_timeline_reports report
CROSS JOIN LATERAL unnest(report.subject_ids) subject_id;

INSERT INTO schema_migrations(version)
VALUES ('022_durable_intelligence_search')
ON CONFLICT (version) DO NOTHING;

COMMIT;
