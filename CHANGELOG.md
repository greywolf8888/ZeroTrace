# Changelog

All notable changes to ZeroTrace will be documented here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once releases begin.

## [Unreleased]

### Added

- runnable npm workspace for API, web, and domain packages;
- canonical multi-ledger snapshot, knowledge, evidence, entity, control, launch, and RV schemas;
- checksum-aware EVM, Bitcoin, and Solana identifier parsing;
- hardened read-only provider transport and current-state adapters;
- ledger-canonical current-state snapshots with explicit EVM finality tags, height-pinned Bitcoin
  best-chain hashes, Solana `getBlock` anchors, strict lossless account parsing, and legacy Snapshot
  read compatibility;
- bounded provider retry, `Retry-After`, pacing, TTL/LRU cache, circuit breaker, failover, and health
  diagnostics;
- ordered Ethereum/BSC/Bitcoin/Solana provider pools and safe hostname-based Evidence source IDs;
- immutable process-local evidence graph plus append-only PostgreSQL Evidence/Snapshot repository;
- transactionally persisted derivation edges, restart-safe drilldown, storage health/readiness, and
  real PostgreSQL integration coverage in CI;
- deterministic entity-evidence baseline, constant-product quote, and exit-race simulation;
- Fastify API with OpenAPI, health, capability truth, metrics, and analysis endpoints;
- responsive React analyst workspace with explicit Unknown states;
- supplied company icon integrated into the GitHub README, web header, hero, and favicon;
- PostgreSQL and ClickHouse initialization schemas;
- bounded, restart-safe SQD finalized block/transaction ingestion plus EVM logs/traces/state diffs,
  Bitcoin inputs/outputs, and Solana instructions/logs/balances/token balances/rewards;
- content-addressed versioned raw-artifact storage, Evidence-linked ClickHouse Raw Facts, and
  monotonic PostgreSQL ingestion checkpoints;
- read-only host and Compose ingestion-worker entrypoints with storage preflight and terminal replay
  protection;
- API and UI health visibility for Raw Facts, checkpoints, and raw artifacts;
- safe, actionable worker failure codes that preserve the underlying provider/storage category
  without exposing error text, URL paths, or credentials;
- repeat-run-safe integration coverage against real PostgreSQL, ClickHouse, and MinIO services;
- explicit block-header/transaction profiles, strict per-ledger transaction identities, and
  finalized-head-proven Solana skipped-slot handling;
- explicit `ledger-records` profile with strict EVM log/trace/state-key, Bitcoin source-position, and
  Solana instruction/log/account/reward identities plus per-table
  materialized/not-queried/not-applicable coverage;
- Docker Compose topology and multi-stage production images;
- database initialization images that work from Windows Unicode workspace paths;
- repository governance, dependency policy, CI, test, deployment, and release documentation.

### Security

- explicit rejection of EVM and Solana broadcast methods;
- provider URL allowlist, SSRF defenses, redirect denial, bounded responses, timeout/rate controls,
  and unsafe-integer preservation;
- read-only product boundary documented across API, UI, tests, and security policy.
- evidence/snapshot grounding enforced before entity, RV, or scenario derivation.
- Evidence IDs hash the complete observation identity so identical payloads from different sources,
  locations, snapshots, or times cannot collide.
- Evidence IDs bind the normalized derivation-edge set; application and deferred database checks
  reject inferred Evidence without source observations.
- configured durable-storage failure is fail-closed and cannot silently degrade writes to memory.
- immutable-SHA GitHub Actions, production dependency audit, and pruned API runtime image.

### Known limitations

- finalized provider-shaped EVM execution/state, Bitcoin UTXO, and Solana execution/balance records
  are persisted, but semantic transaction/event normalization and protocol-specific
  launchpad/market decoding are not implemented;
- continuous scheduling, unfinalized/reorg handling, and cross-provider reconciliation are not
  implemented;
- entity resolution is an uncalibrated baseline;
- Ethereum, BSC, Bitcoin, and Solana current-state smoke checks pass; archive history, forced
  real-provider failover, load, reorg, provider reconciliation, and production deployment validation
  remain open.

[Unreleased]: https://github.com/greywolf8888/ZeroTrace/commits/main
