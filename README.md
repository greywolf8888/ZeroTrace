<div align="center">
  <img src="apps/web/public/zerotrace-company-icon.png" width="220" alt="ZeroTrace company icon" />
  <h1>ZeroTrace</h1>
  <p><strong>Evidence-first, read-only intelligence across EVM, Bitcoin, and Solana.</strong></p>
  <p>
    Resolve control relationships, inspect launch mechanisms, and estimate realizable value
    without signing or broadcasting a transaction.
  </p>
  <p>
    <a href="https://github.com/greywolf8888/ZeroTrace/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/greywolf8888/ZeroTrace/ci.yml?branch=main&label=CI&style=flat-square"></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-2f81f7?style=flat-square"></a>
    <a href=".nvmrc"><img alt="Node" src="https://img.shields.io/badge/Node-24.11.1-5fa04e?style=flat-square"></a>
    <img alt="Read only" src="https://img.shields.io/badge/transaction%20mode-read--only-8b949e?style=flat-square">
  </p>
</div>

> [!IMPORTANT]
> ZeroTrace is under active foundation development. The repository currently provides a runnable,
> tested read-only core; it is **not yet a production-complete implementation** of the terminal
> architecture. See [PROGRESS.md](PROGRESS.md) for the exact implementation and validation state.

## What ZeroTrace is

ZeroTrace is infrastructure for answering a difficult on-chain question:

> What can a controlling entity actually control, exit, or realize at a specific ledger snapshot,
> and which evidence supports that conclusion?

The terminal architecture covers address and asset intelligence, probabilistic entity resolution,
control-right analysis, launchpad lifecycle decoding, market-state reconstruction, realizable-value
simulation, evidence drilldown, scenarios, and analyst-facing UI across EVM, Bitcoin, and Solana.

Three distinctions are structural, not cosmetic:

| Distinction                   | Why it matters                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Entity ≠ address              | Common ownership is an evidence-weighted hypothesis, never a label copy or a shared-service shortcut. |
| Book value ≠ realizable value | Balance and mark-to-market value do not describe executable exit proceeds under shared liquidity.     |
| Unknown ≠ zero                | Missing, stale, unsupported, or ambiguous data remains typed as `unknown` or `unavailable`.           |

ZeroTrace has no private-key custody, transaction signing, swap execution, or transaction-broadcast
path. That boundary is enforced in adapters and tested.

## Current working surface

The current foundation includes:

- canonical, Zod-validated schemas for snapshots, subjects, knowledge state, evidence, entities,
  control rights, launch mechanisms, provider health, and realizable value;
- checksum-aware identifier classification for EVM, Bitcoin, and Solana;
- SSRF-hardened, response-bounded, read-only adapters for EVM JSON-RPC, Bitcoin Esplora, and Solana
  JSON-RPC;
- finality-explicit current-state anchors: configurable EVM `finalized`/`safe`/`latest` block tags,
  height-pinned Bitcoin best-chain hashes, and Solana `getBlock` hashes with minimum-context account
  reads;
- typed block, transaction, and Bitcoin outpoint queries that bind confirmed records to exact
  Snapshots, bind pending/mempool observations to captured heads, and retain replayable Evidence;
- version-pinned Flap BSC Portal inspection (forward-compatible `getTokenV8Safe` with explicit
  V6/V5 fallbacks)
  that checks Portal/token bytecode at one fixed block and preserves unsupported or unqueried fields
  as typed Unknown;
- transaction-local Flap creation/configuration/migration decoding that pins the supplied receipt
  to its block, tags every configuration value as event-derived or an official documented default,
  and keeps unavailable legacy curve internals Unknown;
- bounded Flap Portal event-history scans that prefer finalized SQD address/topic discovery with a
  strict `eth_getLogs` fallback, then field-for-field RPC receipt-replay every discovered log while
  keeping token-lifetime coverage Unknown;
- bounded Flap contract-origin resolution that joins a finalized SQD create trace to the exact BSC
  receipt, `TokenCreated` event and replay Snapshot while treating an empty search range as negative
  Evidence rather than lifetime absence;
- fixed-block Flap `previewSell` quotes whose provider-returned atomic proceeds and derivation
  Evidence remain separate from unqueried nominal price, fee breakdown and price impact;
- an Evidence-grounded typed discrepancy engine with exact-state checks, exact-decimal error
  budgets, warning bands, coverage gates, and explicit Unknown exclusion from numeric denominators;
- request-scoped provider provenance across failover pools, with dynamic head/tip/slot anchors
  explicitly bypassing stored TTL responses;
- common-position chain-anchor reconciliation across configured endpoints, with explicit
  agreement/disagreement/insufficient-source states, parent-link continuity checks, reorg/source
  regression alerts, and operator independence retained as Unknown until verified;
- content-addressed evidence nodes and deterministic evidence drilldown;
- baseline evidence fusion with explicit service-hub, CoinJoin, and independence suppression;
- exact-integer constant-product exit quoting and seeded, reproducible shared-liquidity exit races;
- a Fastify API with OpenAPI, health, readiness, capability truth, and Prometheus metrics;
- a responsive React intelligence workspace that renders missing knowledge as Unknown rather than 0;
- append-only PostgreSQL Evidence/Snapshot persistence with restart-safe derivation drilldown;
- append-only PostgreSQL chain-anchor observations and Data Quality Alerts whose Evidence links are
  enforced transactionally;
- monotonic PostgreSQL semantic-scan checkpoints with canonical state hashes, cumulative Evidence
  links, exact coverage cursors, bounded chunks, idempotent resume, and immutable completion;
- restart-safe SQD finalized block/transaction ingestion plus EVM logs/traces/state diffs, Bitcoin
  inputs/outputs, and Solana instructions/logs/balances/token balances/rewards;
- content-addressed, versioned raw artifacts, append-only Evidence/Snapshots, monotonic ingestion
  checkpoints, and idempotent ClickHouse Raw Facts;
- PostgreSQL, ClickHouse, and object-store initialization, plus Docker Compose for the local
  platform.

Unimplemented API domains return `501 CAPABILITY_NOT_IMPLEMENTED` with typed Unknown metadata.
They never return plausible-looking placeholder facts.

## Architecture

```mermaid
flowchart LR
  Q["Identifier or investigation"] --> G["API and query planner"]
  G --> I["Identifier normalization"]
  G --> C["Chain adapters"]
  C --> EVM["EVM JSON-RPC"]
  C --> BTC["Bitcoin Esplora / Core"]
  C --> SOL["Solana JSON-RPC"]
  C --> DQ["Common-position anchor reconciliation"]
  SQD["SQD finalized streams"] --> W["Read-only ingest worker"]
  EVM --> F["Canonical facts"]
  BTC --> F
  SOL --> F
  F --> EV["Evidence ledger"]
  DQ --> EV
  EV --> ER["Entity resolution"]
  EV --> LM["Launch and market adapters"]
  ER --> RV["Realizable-value engine"]
  LM --> RV
  RV --> SC["Scenario engine"]
  EV --> UI["Analyst UI"]
  ER --> UI
  RV --> UI
  SC --> UI
  DB[("PostgreSQL")]
  CH[("ClickHouse")]
  OBJ[("Object storage")]
  W -->|"canonical raw facts"| CH
  W -->|"Evidence and checkpoints"| DB
  W -->|"content-addressed raw artifacts"| OBJ
  EV -->|"snapshots, nodes, edges"| DB
  DQ -->|"anchors and alerts"| DB
  DQ --> UI
```

The finalized raw-ledger path is wired end to end for blocks, transactions, EVM logs/traces/state
diffs, Bitcoin inputs/outputs, and Solana instructions/logs/native balances/token balances/rewards.
The query API also returns strictly validated EVM/Bitcoin/Solana blocks and transactions plus Bitcoin
outpoints with Snapshot and Evidence metadata. These remain provider-shaped observations, not
semantic transfers or protocol events. A
common-position anchor/continuity foundation now detects deterministic source conflicts and parent
history changes without choosing a majority winner. Continuous scheduling, rollback/replay,
independent-provider and forced-reorg validation, semantic normalization, graph projection,
protocol-specific decoders, and distributed workflows remain open work. Read
[Architecture](docs/architecture/ARCHITECTURE.md) and the authoritative
[Master Prompt](docs/architecture/ZEROTRACE_MASTER_PROMPT.md).

## Chain and platform scope

| Domain            | Terminal scope                                                                                | Current repository state                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVM               | Ethereum-compatible state, traces, token flows, proxies, multisigs, launchpads, DEX liquidity | Snapshot-bound block/transaction queries, anchor reconciliation and finalized raw execution/state; archive/semantic validation pending                                                    |
| Bitcoin           | UTXO history, spend graph, CoinJoin-aware entity evidence, inscriptions/runes where relevant  | Snapshot-bound block/transaction/outpoint queries, continuity checks and finalized raw transactions/I/O; Core/spend semantics pending                                                     |
| Solana            | Accounts, Token/Token-2022, instruction/CPI history, authorities, PDAs, launchpads and AMMs   | Snapshot-bound block/transaction queries, anchor continuity and finalized raw execution/balances; archive/semantic decoding pending                                                       |
| Entity Resolution | controller, coordination, and independence probabilities with evidence                        | Deterministic baseline implemented; temporal graph and calibration pending                                                                                                                |
| Launchpad         | Flap, Pump/PumpSwap, Raydium LaunchLab, Meteora DBC, Moonshot, Four.meme, FomoWell            | Flap current state, supplied transaction decoding, bounded SQD/RPC history and bounded creation-origin proof work; continuous lifetime history, FFT validation and other adapters pending |
| Realizable Value  | exact route quotes, tax/fee/gas, impact, capacity, shared-liquidity exit order                | Constant-product/exit-race kernels plus Flap Portal sell preview work; DEX routing, decomposition, gas and capacity pending                                                               |
| Evidence          | immutable provenance, source snapshot, derivation graph, confidence and coverage              | Durable Snapshot/node/edge graph plus versioned raw artifacts for every implemented ingestion record                                                                                      |

Platform status is also available at `GET /api/v1/platforms`. GMGN is treated only as an optional
execution/label observation source; it is not a launchpad and can never merge entities by itself.

## Quick start

### Docker Compose

Prerequisites: Docker Engine with Compose v2.

```bash
git clone git@github.com:greywolf8888/ZeroTrace.git
cd ZeroTrace
cp .env.example .env
docker compose up --build
```

Open:

- analyst UI: [http://localhost:5173](http://localhost:5173)
- API health: [http://localhost:8080/health](http://localhost:8080/health)
- OpenAPI UI: [http://localhost:8080/docs](http://localhost:8080/docs)
- Prometheus metrics: [http://localhost:8080/metrics](http://localhost:8080/metrics)

The default Compose stack starts PostgreSQL, ClickHouse, Valkey, NATS, MinIO, API, and web UI. The
API requires PostgreSQL for durable Evidence/Snapshot writes and exposes that state in readiness and
the Data Health screen. Historical ingestion is an explicit read-only worker invocation:

```bash
docker compose --profile ingest run --rm ingest-worker \
  --dataset ethereum-mainnet --profile ledger-records --from 0 --to 100
```

Supported dataset names are `ethereum-mainnet`, `binance-mainnet`, `bitcoin-mainnet`, and
`solana-mainnet`. Profiles are `block-headers` (the conservative default), `transactions`, and
`ledger-records`. The last profile adds EVM logs/traces/state diffs, Bitcoin inputs/outputs, or
Solana instructions/logs/native balances/token balances/rewards as applicable. Every output reports
`MATERIALIZED`, `NOT_QUERIED`, or `NOT_APPLICABLE`; only materialized tables receive numeric counts.
The worker accepts bounded finalized ranges only, claims no protocol decoding, and has no signing or
broadcast interface.
Temporal is opt-in with `docker compose --profile full up --build`; Apache AGE is opt-in with
`--profile graph`.

Public BNB Smart Chain, Bitcoin, and Solana endpoints are development fallbacks and can be
rate-limited. Ethereum remains unconfigured until a local Alchemy key or another read-only RPC is
provided. The example config supplies two BSC endpoints for endpoint-level comparison; ZeroTrace
does not infer operator independence from hostnames. Configure dedicated, independently operated
archive-grade endpoints before production validation.

### Local development

Prerequisites: Node.js 24.11.1 and npm 11+.

```bash
cp .env.example .env
npm ci
npm run dev
```

The web application runs on port `5173` and the API on `8080`. With the example's blank
`POSTGRES_URL`, Evidence is explicitly process-local. For durable host-side development, start
PostgreSQL and set `POSTGRES_URL=postgresql://zerotrace:zerotrace@localhost:5432/zerotrace` before
starting the API. Production/Compose paths do not silently fall back when configured storage fails.

After starting PostgreSQL, ClickHouse, and MinIO, a host-side finalized range can be ingested with:

```bash
npm run ingest -- --dataset bitcoin-mainnet --from 0 --to 100
```

Typed read-only ledger records are available without any signing path:

```text
GET /api/v1/ledger/EVM/TRANSACTION/<hash>?chainId=eip155:1
GET /api/v1/ledger/BITCOIN/OUTPOINT/<txid>:<vout>
GET /api/v1/ledger/SOLANA/TRANSACTION/<signature>
```

Every successful result includes a ledger Snapshot, coverage/freshness/source/model/confidence
metadata, and Evidence IDs. A null provider result remains an evidenced Unknown rather than becoming
a synthetic zero or a claim that the record does not exist.

## Verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run test:e2e
npm run license:check
npm run audit
npm run sbom
npm run health
```

`npm run test:e2e` launches the built API and web application and drives a real Chromium browser.
On Windows, `npm run test:e2e:windows` uses an owned-process launcher so teardown does not depend on
shell process-tree behavior.
`npm run health` expects the API at `http://localhost:8080` unless `HEALTH_URL` is set.

See [Development](docs/DEVELOPMENT.md), [Testing](docs/testing/TESTING.md), the latest
[validation record](docs/testing/VALIDATION_RECORD.md), and [Deployment](docs/DEPLOYMENT.md) for
clean-environment instructions and evidence.

## Configuration

Copy [`.env.example`](.env.example) and edit only the providers you trust. The adapter transport:

- accepts HTTPS provider URLs by default;
- requires an explicit hostname allowlist;
- rejects URL credentials, redirects, traversal, and private or reserved destinations;
- applies bounded exponential retries, `Retry-After`, per-endpoint pacing, TTL/LRU caching,
  in-flight request deduplication, circuit breaking, and ordered failover;
- returns the safe endpoint ID that produced each observation; Snapshot anchors bypass stored TTL
  cache entries while immutable/pinned reads may still use bounded caching;
- exposes safe hostname-based route and resilience diagnostics without exposing URL paths or keys;
- lowers healthy provider heads to their common block/slot before comparison; `*_URLS` entries are
  counted as endpoint observations, while source/operator independence remains explicitly Unknown;
- imposes timeout and response-size limits;
- preserves unsafe JSON integer tokens as strings;
- allows only audited read methods and rejects transaction broadcasting.

Never commit API keys. Provider absence is a supported degraded state, not a startup failure.
`POSTGRES_URL` is optional only for explicit ephemeral development; Docker Compose configures it and
persists Evidence, Snapshots, and derivation edges in PostgreSQL.
EVM snapshot tags default to `finalized`; reducing either network to `safe` or `latest` is an
explicit per-network configuration choice and remains visible in Snapshot and Evidence metadata.
`DATA_QUALITY_MIN_SOURCES` defaults to `2` and cannot be reduced below two. One healthy endpoint is
useful for observation, but it can only produce `INSUFFICIENT_SOURCES`, never agreement.

## Repository layout

```text
apps/
  api/                  Fastify API, OpenAPI, health and metrics
  web/                  React analyst workspace
packages/
  chain-adapters/       Hardened EVM, Bitcoin and Solana reads
  data-quality/         Anchor reconciliation, continuity and Evidence-linked alerts
  entity-engine/        Evidence-weighted relationship inference
  evidence/             Content-addressed evidence graph
  identifiers/          Chain-aware identifier parsing
  ingestion/            Restart-safe finalized ingestion pipeline
  platform-adapters/    Platform registry and detection boundary
  rv/                   Realizable-value and exit-race kernels
  schemas/              Canonical contracts and knowledge states
  storage/              PostgreSQL, ClickHouse and object-artifact repositories
services/
  ingest-worker/        Bounded finalized-range worker CLI
infra/
  postgres/init/        Relational/evidence schema
  clickhouse/init/      Raw fact and metric schema
docs/                   Architecture, operations, research and tests
tests/                  Cross-package integration and browser tests
```

## Engineering roadmap

This roadmap describes implementation progress rather than product marketing phases.

- [x] Monorepo, canonical contracts, read-only transports, API/UI shell, local infrastructure
- [x] Evidence primitives, identifier validation, baseline entity fusion, deterministic RV kernel
- [x] Wire append-only PostgreSQL Evidence/Snapshot persistence and restart-safe drilldown
- [x] Wire ClickHouse Raw Facts and content-addressed, versioned object payload storage
- [x] Implement restart-safe SQD finalized block-header ingestion across all three ledger families
- [x] Add restart-safe provider-shaped raw-transaction ingestion across all three ledger families
- [x] Add finalized EVM logs, Bitcoin inputs/outputs, and Solana instruction/CPI raw records
- [x] Add EVM trace/state-diff and Solana log/balance/token-balance/reward raw records
- [x] Make current-state EVM/BTC/Solana snapshot anchors finality-explicit and ledger-canonical
- [x] Add common-position endpoint anchor reconciliation and parent-history continuity detection
- [x] Add Snapshot- and Evidence-backed block/transaction/outpoint query contracts and UI rendering
- [x] Add version-pinned Flap BSC Portal-state inspection with Evidence/Unknown UI rendering
- [x] Add fixed-block Flap Portal sell previews with provider Evidence and no-fake-zero UI states
- [x] Add exact-receipt Flap creation/configuration/migration event decoding with default provenance
- [x] Add bounded Flap Portal discovery through finalized SQD/RPC log sources with exact log/receipt replay
- [x] Add bounded finalized SQD contract-origin proof with exact Flap receipt/Snapshot replay
- [x] Add durable generic semantic-scan state and contiguous coverage checkpoints
- [x] Bind the Flap origin API to restart-safe chunk progress and terminal-result replay
- [x] Add same-Snapshot typed discrepancy audits with Evidence validation and per-class error budgets
- [ ] Add continuous scheduling, live/unfinalized handling, rollback/replay and independent-provider validation
- [ ] Add a dedicated deployment-origin scheduler and bind Flap event-history projection to durable checkpoints
- [ ] Add Pump/PumpSwap, Raydium, Meteora, Moonshot, Four.meme and FomoWell decoders
- [ ] Build temporal entity graph, calibration datasets, analyst overrides and auditable recomputation
- [ ] Add control-right extraction for proxies, multisigs, EVM ownership, Solana authorities and PDAs
- [ ] Reconstruct launch/market lifecycle and multi-route realizable value with fees, tax, gas and capacity
- [ ] Complete search, timeline, evidence graph, comparison, scenario and export workflows in the UI
- [ ] Run archive-grade, multi-provider, real-chain fixtures and production load/failure testing

The named terminal real-chain acceptance target is Flap/BSC token FFT at
`0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`; its error budget and automatic discrepancy rules are
defined in [the FFT acceptance specification](docs/testing/FLAP_FFT_ACCEPTANCE.md). Registration of
that target is not a claim that the unfinished Flap/entity/RV stack has already analyzed it.

Exact percentages, test counts, and external validation gates live in [PROGRESS.md](PROGRESS.md).

## Responsible use

ZeroTrace produces probabilistic intelligence, not attribution certainty or financial advice.
Conclusions must retain source, snapshot, confidence, coverage, model version, and evidence IDs.
Labels are observations with provenance and validity intervals; they are never identity truth.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md). Please read
[CONTRIBUTING.md](CONTRIBUTING.md) before proposing protocol adapters or inference changes.

## License

ZeroTrace core is licensed under [Apache License 2.0](LICENSE). External SDKs and sidecars can impose
different obligations; the repository records each evaluated dependency and its integration boundary
in [Third-party dependencies](docs/research/THIRD_PARTY_DEPENDENCIES.md).
