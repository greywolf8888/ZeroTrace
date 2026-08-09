# ZeroTrace Progress Ledger

Last updated: 2026-08-10

This file reports engineering truth against the terminal architecture. “Implemented” means code and
automated tests exist in this repository. “Validated” additionally requires clean-environment and
real-provider evidence. A configured route, interface, schema, or placeholder is not counted as a
completed feature.

## Executive status

| Measure                          | Current state                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Terminal architecture completion | **15% estimated**                                                                  |
| Runnable foundation              | **Yes; clean Docker build/start verified**                                         |
| Production acceptance            | **No**                                                                             |
| Transaction mode                 | **Read-only; signing/broadcast/private-key custody forbidden**                     |
| Unit tests                       | **172 passing across 20 files**                                                    |
| Integration tests                | **25 passing across API and three real durable stores**                            |
| Real-browser E2E                 | **6 passing: Chromium desktop and Pixel 7**                                        |
| Remote CI                        | **Pass on immutable development commit `0193c95`; protected main `5f94dca`**       |
| Coverage                         | **87.87% statements / 79.36% branches / 96.88% functions / 89.22% lines**          |
| Real-chain validation            | Four-chain current state plus finalized raw-ledger ingestion passed                |
| Durable evidence/history         | Block/transaction/log/input/output/instruction provenance wired; semantics pending |

The percentage is a conservative terminal-scope estimate, not a velocity metric. Passing foundation
tests does not increase unimplemented protocol, ingestion, intelligence, or operations scope.

## Terminal-scope status matrix

The only allowed status vocabulary in this ledger is:
`IMPLEMENTED_AND_VERIFIED`, `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION`,
`PARTIALLY_IMPLEMENTED`, `BLOCKED_EXTERNAL`, and `NOT_IMPLEMENTED`.

| Architecture domain                  | Status                                      | Current boundary                                                                           |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Repository, contracts, CI foundation | `IMPLEMENTED_AND_VERIFIED`                  | clean builds, automated gates, containers, browser flows, and remote CI passed             |
| Read-only provider transport         | `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION` | retries/cache/pacing/circuit/failover tested; real outage/failover drill pending           |
| EVM current-state adapter            | `IMPLEMENTED_AND_VERIFIED`                  | Ethereum and BSC snapshot-pinned read-only smoke passed                                    |
| Bitcoin current-state adapter        | `IMPLEMENTED_AND_VERIFIED`                  | Esplora snapshot-pinned read-only smoke passed                                             |
| Solana current-state adapter         | `IMPLEMENTED_AND_VERIFIED`                  | finalized snapshot-pinned account smoke passed                                             |
| Durable ingestion and chain history  | `PARTIALLY_IMPLEMENTED`                     | finalized raw ledger records are restart-safe; traces, live/reorg/reconciliation remain    |
| Evidence graph                       | `PARTIALLY_IMPLEMENTED`                     | durable nodes/Snapshots/edges plus raw-ledger artifacts work; terminal graph is incomplete |
| Entity Resolution                    | `PARTIALLY_IMPLEMENTED`                     | conservative baseline engine only; calibration and temporal graph are absent               |
| Launchpad Intelligence               | `NOT_IMPLEMENTED`                           | registry boundaries exist, no decoder is claimed                                           |
| Realizable Value                     | `PARTIALLY_IMPLEMENTED`                     | exact constant-product kernel only; routes/tax/gas/capacity are absent                     |
| Scenario Engine                      | `PARTIALLY_IMPLEMENTED`                     | deterministic shared-pool exit race only                                                   |
| Analyst UI                           | `PARTIALLY_IMPLEMENTED`                     | search/health/evidence shell works; terminal investigation workflows are absent            |
| Production security/operations       | `PARTIALLY_IMPLEMENTED`                     | read-only/SSRF gates work; auth, tenancy, DR, load and chaos gates are absent              |

## Completed

### Repository and contracts

- npm workspace with pinned runtime/tooling versions and reproducible lockfile;
- authoritative Master Prompt preserved in the architecture docs;
- canonical schemas for ledger snapshots, subjects, typed knowledge values, evidence, provider
  health, label observations, entity results, control rights, launch state, RV points, and errors;
- checksum/structure-aware EVM, Bitcoin, and Solana identifier handling;
- Apache-2.0 project license, dependency-license policy, source ledger, CI, CodeQL, Dependabot, issue
  forms, PR template, contribution, security, changelog, and release guidance;
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31311814357) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31311814380) passed on immutable main
  commit `5f94dca`.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31321516761) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31321516799) passed on immutable
  development commit `235fad6` before promotion to protected `main`.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31323118898) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31323118887) passed on immutable
  development commit `0193c95` for ledger-specific raw-record ingestion.

### Read-only chain foundation

- EVM JSON-RPC adapter with snapshot, native balance, code, and audited method allowlist;
- Bitcoin Esplora adapter with tip, address, transaction, output-spend, and snapshot primitives;
- Solana JSON-RPC adapter with finalized slot/blockhash and minimum-context account reads;
- shared provider transport with hostname allowlist, DNS/IP SSRF checks, redirect denial, timeout,
  bounded exponential retries, `Retry-After`, request pacing, in-flight deduplication, TTL/LRU
  caching, circuit breaking, ordered failover, response-size bounds, and unsafe-integer
  preservation;
- safe hostname-based active-source diagnostics in health, Snapshot and Evidence metadata;
- regression tests that reject EVM and Solana broadcast methods before network access;
- Ethereum via Alchemy plus public BSC, Bitcoin, and Solana current-state smoke reads with
  snapshot-pinned Evidence. These are smoke checks, not archive-grade or cross-provider semantic
  acceptance.

### Evidence and analysis foundation

- deterministic canonical JSON hashing, independent payload hashes, and complete-observation
  content-addressed Evidence IDs that distinguish source, locator, block/slot, observation time, and
  the normalized derivation-edge set;
- immutable process-local evidence cache plus transactional, append-only PostgreSQL persistence for
  complete Snapshots, nodes, edges, idempotent writes, and restart-safe drilldown;
- application and deferred database constraints that reject inferred/negative Evidence without a
  source observation and reject mutation of Evidence, edges, or Snapshots;
- entity, RV, and scenario requests reject missing or snapshot-incompatible source Evidence with
  HTTP 422 instead of producing an ungrounded result;
- baseline evidence-weighted entity relationship model with CoinJoin, service-hub, and independence
  suppression;
- exact-integer constant-product exit quote;
- deterministic seeded shared-liquidity exit-race simulation with percentile output;
- explicit unavailable output when selling is disabled instead of a zero return.

### Finalized ingestion foundation

- clean HTTP SQD Portal adapter for finalized Ethereum, BNB Smart Chain, Bitcoin, and Solana
  datasets; no GPL Portal client package is linked into the Apache-2.0 core;
- bounded JSONL streaming with strict dataset/query fields, range and response limits, timeout,
  retry, pacing, continuation, DNS/host policy, and unsafe-integer preservation;
- content-addressed raw artifact envelopes in a versioned S3-compatible bucket with exact
  read-after-write integrity verification;
- canonical Evidence/Snapshot persistence before idempotent `ReplacingMergeTree` ClickHouse Raw
  Facts, followed by monotonic PostgreSQL checkpoint advancement;
- stable run identity, crash resume, terminal no-op replay, explicit `SOURCE_HEAD_REACHED`, and safe
  error codes;
- explicit `block-headers`, `transactions`, and `ledger-records` profiles with per-table
  `MATERIALIZED`, `NOT_QUERIED`, and `NOT_APPLICABLE` states; only materialized tables receive
  numeric counts;
- strict EVM transaction hash, Bitcoin txid, and Solana signature identities, duplicate/malformed
  rejection, provider-defined empty-table handling, and finalized-head-proven Solana skipped slots;
- strict EVM log identities, Bitcoin block/transaction/input-output positions with coinbase nulls,
  and Solana blockhash/transaction/instruction-address paths without assuming array-index joins;
- host and container worker commands that accept only dataset/profile/from/to and expose no
  chain-write operation;
- real finalized raw-ledger ingestion and complete artifact/Evidence/fact replay on all four
  supported datasets, including EVM logs, Bitcoin inputs/outputs, and Solana instruction/CPI paths.
  This validates provider-shaped observations, not semantic transaction or protocol normalization.

### Runtime and developer experience

- Fastify API with OpenAPI UI, liveness/readiness/full health, capability truth, metrics, search,
  current subject reads, evidence drilldown, entity baseline, RV, and scenario endpoints;
- React workspace with responsive desktop/mobile layout, provider/storage status, chain search,
  Evidence, Unknown rendering, platform truth, and disabled scenario state until evidence exists;
- PostgreSQL and ClickHouse bootstrap schemas, including append-only PostgreSQL Evidence and
  ingestion-run triggers, ClickHouse Raw Fact identity/provenance, and Known/Unknown constraints;
- Compose topology for API, web, PostgreSQL, ClickHouse, Valkey, NATS, MinIO, optional Temporal, and
  optional Apache AGE;
- initialization SQL baked into small database images so clean startup also works from Windows
  Unicode workspace paths;
- multi-stage production container build, Nginx security headers, health checks, CycloneDX SBOM, and
  production dependency license/vulnerability gates.

## In development

- durable PostgreSQL repositories for subjects, analysis runs, entities, control rights, launches,
  scenarios, labels, and analyst overrides;
- EVM trace/state-diff and Solana balance/token-balance/reward expansion of finalized ingestion;
- immutable real-chain fixture corpus and cross-provider reconciliation;
- complete OpenAPI request/response schemas beyond the current endpoint metadata.

## Not implemented

### Ingestion and persistence

- continuous incremental scheduling, unfinalized/reorg handling, and provider reconciliation;
- transaction-level chain normalization, NATS events, and Temporal workflows;
- graph projection and temporal queries;
- cache invalidation and distributed quota coordination.

### EVM terminal scope

- transaction receipts, trace/state-diff ingestion, semantic event decoding, and archive-state reconstruction;
- ERC-20/721/1155, proxy, multisig, owner/role, tax-token, DEX and launchpad decoders;
- Ethereum/BSC archive-provider reconciliation and finalized-block policy;
- Flap, Moonshot, Four.meme, Pancake and other versioned platform adapters.

### Bitcoin terminal scope

- Bitcoin Core/ZMQ ingestion and independent Esplora reconciliation;
- complete UTXO flow graph, peeling/change heuristics, CoinJoin classification and calibration;
- inscription/rune semantics and exchange/service observation feeds;
- FomoWell ICP/ICRC/ckBTC canister adapter and verified deployment discovery.

### Solana terminal scope

- transaction/instruction semantic normalization, Address Lookup Tables, loaded-address resolution,
  and decoded inner-instruction effects;
- SPL Token/Token-2022 extension decoding, authorities, PDAs and multisig control;
- Pump/PumpSwap, Raydium LaunchLab, Meteora DBC, Moonshot and AMM lifecycle adapters;
- Geyser/Yellowstone or equivalent archive-grade ingestion.

### Intelligence products

- calibrated temporal entity graph and controller identity candidates;
- complete control-right extraction and revocation/validity windows;
- launch lifecycle, reserve state, migration and multi-market reconstruction;
- multi-route RV with taxes, gas, fees, price impact, execution failures and historical calibration;
- claim/timeline generation, comparison, report/export, collaboration and analyst-override UI;
- production authorization, tenancy, audit logs, retention, backup and privacy controls.

## Pending real-chain validation

| Validation             | Requirement                                                                          | Status                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| EVM current state      | Named Ethereum and BSC snapshot-pinned current-state reads                           | Alchemy/public BSC smoke passed; archive validation pending              |
| Bitcoin current state  | Named immutable fixtures reconciled against self-hosted Core and Esplora             | Public Esplora live smoke passed; reconciliation pending                 |
| Solana current state   | Named immutable fixtures reconciled against dedicated RPC/archive history            | Public finalized account smoke passed; archive pending                   |
| Entity baseline        | Labeled independent, coordinated, service-hub, and CoinJoin fixtures                 | Pending                                                                  |
| Launchpad decoders     | Versioned deployments and named launch/migration transactions per platform           | Not implemented                                                          |
| RV                     | Historic pool snapshots and executable quote reconciliation                          | Kernel only; pending                                                     |
| Provider resilience    | timeout, quota, malformed data, fork/reorg, and cross-provider disagreement          | Unit coverage plus four-chain happy path; outage/failover drill pending  |
| Finalized block ingest | Replayable EVM/BTC/Solana ranges across object, Evidence, fact and checkpoint stores | Four SQD datasets passed; archive reconciliation pending                 |
| Raw transaction ingest | Named immutable EVM/BTC/Solana transactions persist and replay across all stores     | Ethereum 1, BSC 7, Bitcoin 2, Solana 1 passed; semantic decoding pending |
| Raw ledger records     | EVM logs, BTC inputs/outputs, and Solana instruction paths replay across all stores  | Ethereum/BSC log, BTC I/O, and Solana instruction probes passed          |

Public BSC, Bitcoin, and Solana endpoints in `.env.example` are development fallbacks. Rate-limited responses do not count
as chain-validation failures, and a successful health probe alone does not validate semantic
correctness. Exact local smoke observations and limitations are in
[the validation record](docs/testing/VALIDATION_RECORD.md).

## Test and verification record

| Check                          | Latest result                             | Scope                                                                                            |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Reproducible install/build     | Pass                                      | locked npm install in production container; all packages/API/web                                 |
| Unit tests                     | 172 pass                                  | 20 files across schemas, adapters, ingestion, storage, worker and API runtime                    |
| Integration tests              | 25 pass                                   | API plus real PostgreSQL, ClickHouse, and versioned object storage                               |
| Repeat-run integration         | Pass twice consecutively                  | isolated identities prevent stale-volume false positives                                         |
| Coverage gate                  | Pass                                      | 87.87% statements, 79.36% branches, 96.88% functions, 89.22% lines                               |
| Chromium E2E                   | 6 pass                                    | three flows each on desktop and Pixel 7                                                          |
| Formatting / ESLint / types    | Pass                                      | full repository                                                                                  |
| Dependency vulnerability audit | Pass                                      | 0 vulnerabilities across the complete npm dependency graph                                       |
| Dependency license allowlist   | Pass                                      | production dependency graph                                                                      |
| CycloneDX SBOM                 | Pass                                      | npm dependency graph                                                                             |
| Compose model                  | Pass                                      | rendered default topology                                                                        |
| Docker image build/start       | Pass                                      | API, web, ingest worker, PostgreSQL, ClickHouse, Valkey, NATS, MinIO                             |
| Database bootstrap             | Pass                                      | PostgreSQL 001–004/triggers and ClickHouse Raw Fact schema/migration                             |
| Runtime/browser smoke          | Pass                                      | API/web health, proxy, security headers, desktop/mobile render                                   |
| Public chain smoke             | Pass for bounded current/raw-ledger scope | four current-state reads plus four finalized ledger-record pipelines; full archive scope pending |
| Remote CI                      | Pass                                      | CI and CodeQL on immutable development commit `0193c95`; protected main remains `5f94dca`        |

The record is updated only after commands complete. Detailed commands and acceptance criteria are in
[Testing](docs/testing/TESTING.md) and [Final acceptance](docs/testing/FINAL_ACCEPTANCE.md).
