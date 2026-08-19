CREATE TABLE IF NOT EXISTS zerotrace.token_flow_events
(
  schema_version LowCardinality(String),
  ledger LowCardinality(String),
  chain_id LowCardinality(String),
  token String,
  block_number UInt64,
  block_hash String,
  transaction_hash String,
  transaction_index UInt64,
  log_index UInt64,
  from_address String,
  to_address String,
  amount_raw String,
  flow_kind LowCardinality(String),
  execution LowCardinality(String),
  finality LowCardinality(String),
  evidence_id String,
  raw_artifact_ref String,
  quote_asset String,
  quote_amount_raw String,
  observed_at DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
  CONSTRAINT token_flow_evidence_id_format CHECK match(evidence_id, '^ev_[0-9a-f]{24}$')
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (ledger, toYYYYMM(observed_at))
ORDER BY (ledger, chain_id, token, block_number, transaction_hash, log_index);

CREATE TABLE IF NOT EXISTS zerotrace.wallet_asset_deltas
(
  schema_version LowCardinality(String),
  ledger LowCardinality(String),
  chain_id LowCardinality(String),
  token String,
  wallet String,
  block_number UInt64,
  block_hash String,
  transaction_hash String,
  log_index UInt64,
  delta_raw String,
  evidence_id String,
  observed_at DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (ledger, toYYYYMM(observed_at))
ORDER BY (ledger, chain_id, token, wallet, block_number, transaction_hash, log_index);

CREATE TABLE IF NOT EXISTS zerotrace.dex_trade_events
(
  schema_version LowCardinality(String),
  ledger LowCardinality(String),
  chain_id LowCardinality(String),
  token String,
  pool String,
  wallet String,
  block_number UInt64,
  block_hash String,
  transaction_hash String,
  log_index UInt64,
  side LowCardinality(String),
  token_amount_raw String,
  quote_asset String,
  quote_amount_raw String,
  evidence_id String,
  observed_at DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (ledger, toYYYYMM(observed_at))
ORDER BY (ledger, chain_id, token, pool, block_number, transaction_hash, log_index);

CREATE TABLE IF NOT EXISTS zerotrace.behavior_feature_observations
(
  schema_version LowCardinality(String),
  ledger LowCardinality(String),
  chain_id LowCardinality(String),
  token String,
  campaign_id String,
  event_id String,
  feature_kind LowCardinality(String),
  family LowCardinality(String),
  weight Float64,
  strength Float64,
  reliability Float64,
  contribution Float64,
  evidence_ids Array(String),
  block_start UInt64,
  block_end UInt64,
  observed_at DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (ledger, toYYYYMM(observed_at))
ORDER BY (ledger, chain_id, token, campaign_id, block_start, event_id, feature_kind);

CREATE TABLE IF NOT EXISTS zerotrace.cluster_position_snapshots
(
  schema_version LowCardinality(String),
  ledger LowCardinality(String),
  chain_id LowCardinality(String),
  token String,
  campaign_id String,
  cluster_version_id String,
  at_block UInt64,
  block_hash String,
  token_balance_raw String,
  external_inflow_raw String,
  external_outflow_raw String,
  mint_raw String,
  burn_raw String,
  internal_transfer_raw String,
  dex_buy_raw String,
  dex_sell_raw String,
  wallet_count UInt32,
  evidence_ids Array(String),
  payload String,
  result_hash FixedString(64),
  observed_at DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
  CONSTRAINT cluster_position_result_hash_format CHECK match(result_hash, '^[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (ledger, toYYYYMM(observed_at))
ORDER BY (ledger, chain_id, token, cluster_version_id, at_block, result_hash);

INSERT INTO zerotrace.schema_migrations (version)
VALUES ('002_control_campaign_flow');
