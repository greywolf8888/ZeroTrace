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
- content-addressed evidence nodes and deterministic evidence drilldown;
- baseline evidence fusion with explicit service-hub, CoinJoin, and independence suppression;
- exact-integer constant-product exit quoting and seeded, reproducible shared-liquidity exit races;
- a Fastify API with OpenAPI, health, readiness, capability truth, and Prometheus metrics;
- a responsive React intelligence workspace that renders missing knowledge as Unknown rather than 0;
- append-only PostgreSQL Evidence/Snapshot persistence with restart-safe derivation drilldown;
- restart-safe SQD finalized block-header ingestion for Ethereum, BNB Smart Chain, Bitcoin, and
  Solana;
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
  SQD["SQD finalized streams"] --> W["Read-only ingest worker"]
  EVM --> F["Canonical facts"]
  BTC --> F
  SOL --> F
  F --> EV["Evidence ledger"]
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
```

The finalized block-header path is wired end to end; it does not yet normalize transactions, logs,
traces, Bitcoin inputs/outputs, or Solana instructions. Continuous scheduling, reorg/reconciliation,
graph projection, protocol-specific decoders, and distributed workflows remain open work. Read
[Architecture](docs/architecture/ARCHITECTURE.md) and the authoritative
[Master Prompt](docs/architecture/ZEROTRACE_MASTER_PROMPT.md).

## Chain and platform scope

| Domain            | Terminal scope                                                                                | Current repository state                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| EVM               | Ethereum-compatible state, traces, token flows, proxies, multisigs, launchpads, DEX liquidity | Current-state RPC plus finalized Ethereum/BSC block headers; transaction/protocol decoding pending |
| Bitcoin           | UTXO history, spend graph, CoinJoin-aware entity evidence, inscriptions/runes where relevant  | Esplora current state plus finalized block headers; input/output history pending                   |
| Solana            | Accounts, Token/Token-2022, instruction/CPI history, authorities, PDAs, launchpads and AMMs   | Current account snapshots plus finalized slot headers; instruction decoding pending                |
| Entity Resolution | controller, coordination, and independence probabilities with evidence                        | Deterministic baseline implemented; temporal graph and calibration pending                         |
| Launchpad         | Flap, Pump/PumpSwap, Raydium LaunchLab, Meteora DBC, Moonshot, Four.meme, FomoWell            | Registry and generic detector only; official decoders require real-chain validation                |
| Realizable Value  | exact route quotes, tax/fee/gas, impact, capacity, shared-liquidity exit order                | Constant-product and exit-race kernel implemented; routing/tax/gas adapters pending                |
| Evidence          | immutable provenance, source snapshot, derivation graph, confidence and coverage              | Durable Snapshot/node/edge graph plus versioned raw artifacts for ingested headers                 |

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
  --dataset ethereum-mainnet --from 0 --to 100
```

Supported dataset names are `ethereum-mainnet`, `binance-mainnet`, `bitcoin-mainnet`, and
`solana-mainnet`. The worker accepts bounded finalized ranges only; it has no signing or broadcast
interface.
Temporal is opt-in with `docker compose --profile full up --build`; Apache AGE is opt-in with
`--profile graph`.

Public BNB Smart Chain, Bitcoin, and Solana endpoints are development fallbacks and can be
rate-limited. Ethereum remains unconfigured until a local Alchemy key or another read-only RPC is
provided. Configure dedicated, redundant endpoints before production validation.

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
- exposes safe hostname-based route and resilience diagnostics without exposing URL paths or keys;
- imposes timeout and response-size limits;
- preserves unsafe JSON integer tokens as strings;
- allows only audited read methods and rejects transaction broadcasting.

Never commit API keys. Provider absence is a supported degraded state, not a startup failure.
`POSTGRES_URL` is optional only for explicit ephemeral development; Docker Compose configures it and
persists Evidence, Snapshots, and derivation edges in PostgreSQL.

## Repository layout

```text
apps/
  api/                  Fastify API, OpenAPI, health and metrics
  web/                  React analyst workspace
packages/
  chain-adapters/       Hardened EVM, Bitcoin and Solana reads
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
- [ ] Expand ingestion to transactions/logs/traces/inputs/outputs/instructions and add continuous,
      reorg-aware reconciliation
- [ ] Add versioned Flap, Pump/PumpSwap, Raydium, Meteora, Moonshot, Four.meme and FomoWell decoders
- [ ] Build temporal entity graph, calibration datasets, analyst overrides and auditable recomputation
- [ ] Add control-right extraction for proxies, multisigs, EVM ownership, Solana authorities and PDAs
- [ ] Reconstruct launch/market lifecycle and multi-route realizable value with fees, tax, gas and capacity
- [ ] Complete search, timeline, evidence graph, comparison, scenario and export workflows in the UI
- [ ] Run archive-grade, multi-provider, real-chain fixtures and production load/failure testing

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
