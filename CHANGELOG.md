# Changelog

All notable changes to ZeroTrace will be documented here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once releases begin.

## [Unreleased]

### Added

- runnable npm workspace for API, web, and domain packages;
- canonical multi-ledger snapshot, knowledge, evidence, entity, control, launch, and RV schemas;
- checksum-aware EVM, Bitcoin, and Solana identifier parsing;
- strict Solana signature recognition plus typed EVM/Bitcoin/Solana block and transaction and Bitcoin
  outpoint query contracts;
- hardened read-only provider transport and current-state adapters;
- ledger-canonical current-state snapshots with explicit EVM finality tags, height-pinned Bitcoin
  best-chain hashes, Solana `getBlock` anchors, strict lossless account parsing, and legacy Snapshot
  read compatibility;
- bounded provider retry, `Retry-After`, pacing, TTL/LRU cache, circuit breaker, failover, and health
  diagnostics;
- request-scoped endpoint provenance and explicit cache bypass for dynamic EVM, Bitcoin, and Solana
  Snapshot anchors, including visible bypass counters;
- parent-linked EVM, Bitcoin, and Solana anchors plus common-position, multi-endpoint reconciliation
  with explicit agreement, disagreement, insufficient-source, and unavailable states;
- per-source continuity checks for unchanged/direct extensions, historical gaps, detected reorgs,
  source regression, and unavailable verification, without majority truth selection;
- Evidence-linked, append-only PostgreSQL chain-anchor observations and Data Quality Alerts, with
  restart-safe latest-head reads and deferred Evidence constraints;
- capture-time-aware Snapshot observation identity, allowing repeat reads of one immutable anchor
  after process restart without collapsing distinct replay points;
- ordered Ethereum/BSC/Bitcoin/Solana provider pools and safe hostname-based Evidence source IDs;
- immutable process-local evidence graph plus append-only PostgreSQL Evidence/Snapshot repository;
- transactionally persisted derivation edges, restart-safe drilldown, storage health/readiness, and
  real PostgreSQL integration coverage in CI;
- deterministic entity-evidence baseline, constant-product quote, and exit-race simulation;
- Fastify API with OpenAPI, health, capability truth, metrics, and analysis endpoints;
- Snapshot/Evidence-backed ledger query API with pending, mempool, null, and unavailable observations
  kept distinct from confirmed facts;
- responsive React analyst workspace with typed ledger results and explicit Unknown states;
- version-pinned, fixed-block Flap BSC Portal inspection with V6/V5 decoding, bytecode provenance,
  negative Evidence for non-contract subjects, forward-compatible enum Unknown states, and a
  read-only launch-mechanism UI;
- fixed-block Flap `previewSell` realizable-value observations with source-linked raw/derived
  Evidence, explicit blocked/unsupported states, and an atomic-unit analyst UI;
- Evidence-grounded same-Snapshot discrepancy audits with exact-state/conservation checks,
  exact-decimal error budgets, warning bands, coverage gates, derived Evidence, and Unknown values
  excluded from numeric denominators;
- supplied company icon integrated into the GitHub README, web header, hero, and favicon;
- PostgreSQL and ClickHouse initialization schemas;
- bounded, restart-safe SQD finalized block/transaction ingestion plus EVM logs/traces/state diffs,
  Bitcoin inputs/outputs, and Solana instructions/logs/balances/token balances/rewards;
- content-addressed versioned raw-artifact storage, Evidence-linked ClickHouse Raw Facts, and
  monotonic PostgreSQL ingestion checkpoints;
- read-only host and Compose ingestion-worker entrypoints with storage preflight and terminal replay
  protection;
- API and UI health visibility for Raw Facts, checkpoints, and raw artifacts;
- API and Data Health UI visibility for anchor reconciliation, source/continuity coverage,
  operator-independence Unknown state, alerts, Evidence counts, and data-quality storage durability;
- safe, actionable worker failure codes that preserve the underlying provider/storage category
  without exposing error text, URL paths, or credentials;
- repeat-run-safe integration coverage against real PostgreSQL, ClickHouse, and MinIO services;
- deterministic Windows browser-test launcher with isolated provider/storage configuration and owned
  API/web process teardown;
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
  are persisted and strict raw ledger queries are exposed; Flap BSC current Portal state is decoded,
  but semantic event history, configuration, migration, other launchpads, and market reconstruction
  are not implemented;
- common-position endpoint reconciliation and reorg detection are implemented, but continuous
  scheduling, automatic rollback/replay, and independently operated provider acceptance are not;
- entity resolution is an uncalibrated baseline;
- Ethereum, BSC, Bitcoin, and Solana current-state smoke checks pass; archive history, forced
  real-provider failover, load, reorg, provider reconciliation, and production deployment validation
  remain open.

[Unreleased]: https://github.com/greywolf8888/ZeroTrace/commits/main
