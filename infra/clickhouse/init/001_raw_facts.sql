CREATE DATABASE IF NOT EXISTS zerotrace;

CREATE TABLE IF NOT EXISTS zerotrace.schema_migrations
(
  version String,
  applied_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(applied_at)
ORDER BY version;

CREATE TABLE IF NOT EXISTS zerotrace.raw_chain_facts
(
  fact_id FixedString(64),
  schema_version LowCardinality(String),
  ledger LowCardinality(String),
  chain_id LowCardinality(String),
  block_or_slot UInt64,
  block_hash String,
  fact_type LowCardinality(String),
  subject String,
  provider LowCardinality(String),
  finality LowCardinality(String),
  payload String,
  payload_hash FixedString(64),
  evidence_id String,
  raw_artifact_ref String,
  observed_at DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
  CONSTRAINT fact_id_format CHECK match(fact_id, '^[0-9a-f]{64}$'),
  CONSTRAINT payload_hash_format CHECK match(payload_hash, '^[0-9a-f]{64}$'),
  CONSTRAINT evidence_id_format CHECK match(evidence_id, '^ev_[0-9a-f]{24}$'),
  CONSTRAINT artifact_ref_required CHECK startsWith(raw_artifact_ref, 's3://')
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (ledger, toYYYYMM(observed_at))
ORDER BY (ledger, chain_id, fact_type, block_or_slot, subject, fact_id);

CREATE TABLE IF NOT EXISTS zerotrace.platform_events
(
  ledger LowCardinality(String),
  chain_id LowCardinality(String),
  platform LowCardinality(String),
  platform_version String,
  asset String,
  event_type LowCardinality(String),
  block_or_slot UInt64,
  transaction_id String,
  evidence_id String,
  payload String,
  observed_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY (ledger, toYYYYMM(observed_at))
ORDER BY (platform, chain_id, asset, block_or_slot, event_type);

CREATE TABLE IF NOT EXISTS zerotrace.metric_series
(
  analysis_id UUID,
  metric LowCardinality(String),
  subject String,
  knowledge_state Enum8('KNOWN' = 1, 'UNKNOWN' = 2, 'UNAVAILABLE' = 3),
  value Nullable(Float64),
  reason LowCardinality(String),
  confidence Nullable(Float32),
  data_coverage Float32,
  snapshot_ref String,
  observed_at DateTime64(3, 'UTC'),
  CONSTRAINT known_value_consistency CHECK
    (knowledge_state = 'KNOWN' AND value IS NOT NULL)
    OR (knowledge_state != 'KNOWN' AND value IS NULL)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(observed_at)
ORDER BY (metric, subject, observed_at, analysis_id);

INSERT INTO zerotrace.schema_migrations (version)
VALUES ('001_raw_facts');
