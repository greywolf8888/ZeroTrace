\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE durable_jobs
  ADD COLUMN IF NOT EXISTS fencing_token BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS durable_jobs_fencing_idx
  ON durable_jobs (id, fencing_token);

INSERT INTO schema_migrations(version) VALUES ('040_fencing_tokens')
ON CONFLICT DO NOTHING;

COMMIT;
