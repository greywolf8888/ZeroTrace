BEGIN;

CREATE TABLE IF NOT EXISTS paper_review_reports (
  id text PRIMARY KEY CHECK (id ~ '^prv_[0-9a-f]{24}$'),
  experiment_id text NOT NULL REFERENCES paper_experiments(id) ON DELETE RESTRICT,
  snapshot_id text NOT NULL CHECK (snapshot_id ~ '^psn_[0-9a-f]{24}$'),
  report_hash text NOT NULL CHECK (report_hash ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL,
  as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((report ->> 'id') = id),
  CHECK ((report ->> 'experimentId') = experiment_id),
  CHECK ((report -> 'snapshot' ->> 'id') = snapshot_id)
);

CREATE INDEX IF NOT EXISTS paper_review_reports_experiment_idx
  ON paper_review_reports (experiment_id, as_of DESC, id ASC);

DROP TRIGGER IF EXISTS paper_reviews_append_only ON paper_review_reports;
CREATE TRIGGER paper_reviews_append_only
BEFORE UPDATE OR DELETE ON paper_review_reports
FOR EACH ROW EXECUTE FUNCTION reject_paper_audit_mutation();

INSERT INTO schema_migrations(version) VALUES ('043_paper_reviews')
ON CONFLICT (version) DO NOTHING;

COMMIT;
