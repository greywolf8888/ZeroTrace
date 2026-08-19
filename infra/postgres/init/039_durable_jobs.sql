\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS durable_jobs (
  id TEXT PRIMARY KEY CHECK (id ~ '^job_[0-9a-f]{24}$'),
  type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER')
  ),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  checkpoint TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_ref TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS durable_jobs_claim_idx
  ON durable_jobs (status, created_at)
  WHERE status IN ('PENDING', 'RUNNING');

INSERT INTO schema_migrations(version) VALUES ('039_durable_jobs')
ON CONFLICT DO NOTHING;

COMMIT;
