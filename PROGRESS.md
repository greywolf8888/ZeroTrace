# ZeroTrace Progress Ledger

Last updated: 2026-08-09

This file reports engineering truth against the terminal architecture. “Implemented” means code and
automated tests exist in this repository. “Validated” additionally requires clean-environment and
real-provider evidence. A configured route, interface, schema, or placeholder is not counted as a
completed feature.

## Executive status

| Measure                          | Current state                                                                |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Terminal architecture completion | **12% estimated**                                                            |
| Runnable foundation              | **Yes; clean Docker build/start verified**                                   |
| Production acceptance            | **No**                                                                       |
| Transaction mode                 | **Read-only; signing/broadcast/private-key custody forbidden**               |
| Unit tests                       | **84 passing across 12 files**                                               |
| API integration tests            | **12 passing**                                                               |
| Real-browser E2E                 | **6 passing: Chromium desktop and Pixel 7**                                  |
| Remote CI                        | **Pass on immutable main commit `5f94dca`**                                  |
| Coverage                         | **95.41% statements / 82% branches / 99.29% functions / 96.36% lines**       |
| Real-chain validation            | Public Bitcoin/Solana current-state smoke passed; EVM and archive gates open |
| Durable evidence/history         | Not wired                                                                    |

The percentage is a conservative terminal-scope estimate, not a velocity metric. Passing foundation
tests does not increase unimplemented protocol, ingestion, intelligence, or operations scope.

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

### Read-only chain foundation

- EVM JSON-RPC adapter with snapshot, native balance, code, and audited method allowlist;
- Bitcoin Esplora adapter with tip, address, transaction, output-spend, and snapshot primitives;
- Solana JSON-RPC adapter with finalized slot/blockhash and minimum-context account reads;
- shared provider transport with hostname allowlist, DNS/IP SSRF checks, redirect denial, timeout,
  rate limiting, response-size bounds, and unsafe-integer preservation;
- regression tests that reject EVM and Solana broadcast methods before network access;
- public Bitcoin and Solana current-state smoke reads with snapshot-pinned Evidence. These are smoke
  checks, not archive-grade or cross-provider semantic acceptance.

### Evidence and analysis foundation

- deterministic canonical JSON hashing and content-addressed evidence;
- immutable process-local evidence ledger with derivation edges and drilldown;
- entity, RV, and scenario requests reject missing or snapshot-incompatible source Evidence with
  HTTP 422 instead of producing an ungrounded result;
- baseline evidence-weighted entity relationship model with CoinJoin, service-hub, and independence
  suppression;
- exact-integer constant-product exit quote;
- deterministic seeded shared-liquidity exit-race simulation with percentile output;
- explicit unavailable output when selling is disabled instead of a zero return.

### Runtime and developer experience

- Fastify API with OpenAPI UI, liveness/readiness/full health, capability truth, metrics, search,
  current subject reads, evidence drilldown, entity baseline, RV, and scenario endpoints;
- React workspace with responsive desktop/mobile layout, provider status, chain search, Evidence,
  Unknown rendering, platform truth, and disabled scenario state until evidence exists;
- PostgreSQL and ClickHouse bootstrap schemas, including append-only PostgreSQL Evidence triggers and
  ClickHouse Known/Unknown consistency constraints;
- Compose topology for API, web, PostgreSQL, ClickHouse, Valkey, NATS, MinIO, optional Temporal, and
  optional Apache AGE;
- initialization SQL baked into small database images so clean startup also works from Windows
  Unicode workspace paths;
- multi-stage production container build, Nginx security headers, health checks, CycloneDX SBOM, and
  production dependency license/vulnerability gates.

## In development

- durable PostgreSQL repositories for evidence, snapshots, subjects, analysis runs, and overrides;
- raw-fact ingestion into ClickHouse and immutable object payload storage;
- immutable real-chain fixture corpus and cross-provider reconciliation;
- complete OpenAPI request/response schemas beyond the current endpoint metadata.

## Not implemented

### Ingestion and persistence

- finalized historical backfill, incremental ingestion, reorg handling, and provider reconciliation;
- ClickHouse writer, object-payload storage, NATS events, and Temporal workflows;
- graph projection and temporal queries;
- cache invalidation and distributed quota coordination.

### EVM terminal scope

- transaction receipts/log/trace ingestion and archive-state reconstruction;
- ERC-20/721/1155, proxy, multisig, owner/role, tax-token, DEX and launchpad decoders;
- Ethereum/BSC production provider redundancy and finalized-block policy;
- Flap, Moonshot, Four.meme, Pancake and other versioned platform adapters.

### Bitcoin terminal scope

- Bitcoin Core/ZMQ ingestion and independent Esplora reconciliation;
- complete UTXO flow graph, peeling/change heuristics, CoinJoin classification and calibration;
- inscription/rune semantics and exchange/service observation feeds;
- FomoWell ICP/ICRC/ckBTC canister adapter and verified deployment discovery.

### Solana terminal scope

- transaction/instruction/CPI history, Address Lookup Tables, loaded addresses and inner instructions;
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

| Validation            | Requirement                                                                 | Status                                                   |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| EVM current state     | Dedicated archive-capable Ethereum and BSC read-only RPC URLs               | External providers required                              |
| Bitcoin current state | Named immutable fixtures reconciled against self-hosted Core and Esplora    | Public Esplora live smoke passed; reconciliation pending |
| Solana current state  | Named immutable fixtures reconciled against dedicated RPC/archive history   | Public finalized account smoke passed; archive pending   |
| Entity baseline       | Labeled independent, coordinated, service-hub, and CoinJoin fixtures        | Pending                                                  |
| Launchpad decoders    | Versioned deployments and named launch/migration transactions per platform  | Not implemented                                          |
| RV                    | Historic pool snapshots and executable quote reconciliation                 | Kernel only; pending                                     |
| Provider resilience   | timeout, quota, malformed data, fork/reorg, and cross-provider disagreement | Strong unit coverage; multi-provider validation pending  |

Public endpoints in `.env.example` are development fallbacks. Rate-limited responses do not count
as chain-validation failures, and a successful health probe alone does not validate semantic
correctness. Exact local smoke observations and limitations are in
[the validation record](docs/testing/VALIDATION_RECORD.md).

## Test and verification record

| Check                          | Latest result | Scope                                                                      |
| ------------------------------ | ------------- | -------------------------------------------------------------------------- |
| Reproducible install/build     | Pass          | locked npm install in production container; all packages/API/web           |
| Unit tests                     | 84 pass       | 12 files across schemas, adapters, evidence, entity, platform, RV, runtime |
| API integration                | 12 pass       | health, contracts, grounding, Evidence, boundaries, metrics                |
| Coverage gate                  | Pass          | 95.41% statements, 82% branches, 99.29% functions, 96.36% lines            |
| Chromium E2E                   | 6 pass        | three flows each on desktop and Pixel 7                                    |
| Formatting / ESLint / types    | Pass          | full repository                                                            |
| Dependency vulnerability audit | Pass          | 0 vulnerabilities across the complete npm dependency graph                 |
| Dependency license allowlist   | Pass          | production dependency graph                                                |
| CycloneDX SBOM                 | Pass          | npm dependency graph                                                       |
| Compose model                  | Pass          | rendered default topology                                                  |
| Docker image build/start       | Pass          | API, web, PostgreSQL, ClickHouse, Valkey, NATS, MinIO                      |
| Database bootstrap             | Pass          | PostgreSQL migrations/triggers and three ClickHouse tables/constraint      |
| Runtime/browser smoke          | Pass          | API/web health, proxy, security headers, desktop/mobile render             |
| Public chain smoke             | Partial pass  | Bitcoin/Solana current-state Evidence; EVM unconfigured                    |
| Remote CI                      | Pass          | CI and CodeQL on immutable main commit `5f94dca` (linked above)            |

The record is updated only after commands complete. Detailed commands and acceptance criteria are in
[Testing](docs/testing/TESTING.md) and [Final acceptance](docs/testing/FINAL_ACCEPTANCE.md).
