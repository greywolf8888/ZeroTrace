\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS bitcoin_forensic_graph_reports (
  id TEXT PRIMARY KEY CHECK (id ~ '^bfg_[0-9a-f]{24}$'),
  chain_id TEXT NOT NULL CHECK (chain_id = 'bitcoin-mainnet'),
  snapshot_height NUMERIC(78, 0) NOT NULL CHECK (snapshot_height >= 0),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[0-9a-fA-F]{64}$'),
  result_hash TEXT NOT NULL CHECK (result_hash ~ '^[0-9a-fA-F]{64}$'),
  report JSONB NOT NULL,
  evidence_ids TEXT[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
  source_set TEXT[] NOT NULL CHECK (cardinality(source_set) > 0),
  model_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bitcoin_forensic_graph_report_identity CHECK (
    report->>'id' = id
    AND report->>'chainId' = chain_id
    AND report->>'resultHash' = result_hash
    AND report->'snapshotEnd'->>'height' = snapshot_height::text
    AND report->'snapshotEnd'->>'blockHash' = snapshot_hash
    AND report->>'modelVersion' = model_version
    AND report->>'policyVersion' = policy_version
  )
);

CREATE INDEX IF NOT EXISTS bitcoin_forensic_graph_reports_height_idx
  ON bitcoin_forensic_graph_reports (snapshot_height DESC, captured_at DESC);

CREATE INDEX IF NOT EXISTS bitcoin_forensic_graph_reports_roots_idx
  ON bitcoin_forensic_graph_reports USING GIN ((report->'rootTxids'));

CREATE OR REPLACE FUNCTION reject_bitcoin_forensic_graph_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'bitcoin forensic graph reports are immutable';
END;
$$;

DROP TRIGGER IF EXISTS bitcoin_forensic_graph_reports_no_update ON bitcoin_forensic_graph_reports;
CREATE TRIGGER bitcoin_forensic_graph_reports_no_update
  BEFORE UPDATE OR DELETE ON bitcoin_forensic_graph_reports
  FOR EACH ROW EXECUTE FUNCTION reject_bitcoin_forensic_graph_mutation();

CREATE OR REPLACE FUNCTION validate_bitcoin_forensic_graph_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_id TEXT;
BEGIN
  IF jsonb_typeof(NEW.report->'evidenceIds') <> 'array'
     OR NEW.report->'evidenceIds' <> to_jsonb(NEW.evidence_ids)
     OR NEW.report->'sourceSet' <> to_jsonb(NEW.source_set)
  THEN
    RAISE EXCEPTION 'bitcoin forensic graph evidence/source provenance is not canonical';
  END IF;
  FOREACH evidence_id IN ARRAY NEW.evidence_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM evidence WHERE id = evidence_id) THEN
      RAISE EXCEPTION 'bitcoin forensic graph Evidence % is missing', evidence_id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bitcoin_forensic_graph_reports_evidence_guard ON bitcoin_forensic_graph_reports;
CREATE TRIGGER bitcoin_forensic_graph_reports_evidence_guard
  BEFORE INSERT ON bitcoin_forensic_graph_reports
  FOR EACH ROW EXECUTE FUNCTION validate_bitcoin_forensic_graph_evidence();

INSERT INTO schema_migrations (version) VALUES ('036_bitcoin_forensic_graph_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
