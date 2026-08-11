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
- bracketed Bitcoin address statistics plus UTXO-set reconciliation, with a content-digested mempool
  observation and conflicts preserved as `Unknown(CONFLICTING_SOURCES)`;
- observable Bitcoin spend-condition analysis for P2PKH/P2SH/SegWit/Taproot, verified P2SH/P2WSH
  reveals, legacy multisig and CLTV/CSV, while controller identity and effective RBF/CPFP policy stay
  Unknown when Esplora cannot prove them;
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
- migrated-Flap Pancake V2 market inspection that verifies pool, factory, router, pair identity,
  reserves and decimals at one Snapshot, then compares official `getAmountsOut` with a clean-room
  25 bps pool model across one to eight buy sizes;
- same-Snapshot Pancake V2 exit-size analysis that separates nominal spot value, Router gross
  output, configured sell-tax estimates and actual settlement Unknown while reporting modeled
  average exit price, price impact and shared quote-reserve consumption;
- complete multi-source Flap/Pancake V2 market, buy and exit reconciliation at one common finalized
  block, with a versioned official operator registry, exact-state zero-error checks, a 0.50%
  independent quote/RV budget, and inconclusive results when operator ownership is unverified;
- an Evidence-grounded typed discrepancy engine with exact-state checks, exact-decimal error
  budgets, warning bands, coverage gates, and explicit Unknown exclusion from numeric denominators;
- finalized multi-source EVM control-surface inspection for exact ERC-1167 runtime bytecode,
  EIP-1967 implementation/admin/beacon slots, ERC-173 `owner()`, registered Safe owners/threshold,
  recursive same-Snapshot logic bytecode, and exact Sourcify V2 source provenance, with verified
  ABI declarations kept separate from effective rights and every unresolved controller retained as
  typed Unknown;
- immutable PostgreSQL control-surface reports with Snapshot/source/terminal Evidence constraints,
  provider-free latest/exact replay, and a responsive Control Rights workspace;
- finalized one-slot Solana control-surface inspection for classic SPL Token, Token-2022 extensions
  and multisigs, plus upgradeable Program/ProgramData authority state, with a complete 38-domain
  Known/Unknown coverage matrix and immutable provider-free report replay;
- request-scoped provider provenance across failover pools, with dynamic head/tip/slot anchors
  explicitly bypassing stored TTL responses;
- common-position chain-anchor reconciliation across configured endpoints, with explicit
  agreement/disagreement/insufficient-source states, parent-link continuity checks, reorg/source
  regression alerts, and operator independence retained as Unknown until verified;
- content-addressed evidence nodes and deterministic evidence drilldown;
- baseline evidence fusion with explicit service-hub, CoinJoin, and independence suppression;
- Snapshot-bound Bitcoin transaction-entity screening that exposes common-input and bounded change
  candidates, exact fee arithmetic, address reuse, equal-output CoinJoin-like and fanout patterns,
  while BIP78/Payjoin and unqueried service attribution block every automatic ownership merge;
- an exact fixed-point Entity Resolution evaluation system with high-confidence controller and
  coordination precision gates, Service Hub/CoinJoin false-merge gates, Brier/ECE diagnostics, a
  test-only structural golden corpus, and fail-closed real-world corpus requirements;
- exact-integer constant-product exit quoting and seeded, reproducible shared-liquidity exit races;
- a Fastify API with OpenAPI, health, readiness, capability truth, and Prometheus metrics;
- a responsive React intelligence workspace that renders missing knowledge as Unknown rather than 0;
- dedicated desktop/mobile Bitcoin UTXO, transaction-entity and script-control panels that separate
  structural candidates, suppression reasons, visible conditions, hidden commitments, controller
  identity, and node-policy boundaries;
- append-only PostgreSQL Evidence/Snapshot persistence with restart-safe derivation drilldown;
- append-only PostgreSQL chain-anchor observations and Data Quality Alerts whose Evidence links are
  enforced transactionally;
- monotonic PostgreSQL semantic-scan checkpoints with canonical state hashes, cumulative Evidence
  links, exact coverage cursors, bounded chunks, idempotent resume, and immutable completion;
- immutable Flap event-history segments plus a restart-safe cross-range worker that persists each
  segment before cursor advancement and exposes provider-free paginated API/UI replay by scan ID;
- immutable, content-addressed EVM Claim Reports with strict same-Snapshot and Evidence-graph
  validation, plus provider-free latest/exact API and desktop/mobile UI replay;
- a deterministic public-statement compiler that turns tax, treasury, burn, liquidity, pension and
  dividend language into human-review drafts backed by Analyst Evidence; missing wallets, dates and
  action proof remain Unknown and declarations never become chain facts;
- finalized EVM burn certificates that compare parent/target ERC-20 `totalSupply` with every mint
  and zero-address Transfer in the target block, create Claim Audit actions only when exact
  conservation holds, and expose contradictions or no-action blocks without fabricating a burn;
- finalized BSC SQD range discovery that searches only the zero-address Transfer event surface,
  persists query/log/terminal Evidence, returns candidate blocks for exact certification, and keeps
  silent or custom supply changes explicitly Unknown;
- a restart-safe BSC burn-promotion worker that checkpoints complete event segments, certifies every
  candidate with exact-block supply conservation before cursor advancement, and exposes strict
  PostgreSQL-only API/UI replay by scan ID;
- a bounded all-block BSC supply-continuity worker that compares EIP-1898 `totalSupply` reads from
  every configured source at every finalized transition, requires exact source agreement before
  advancing, reconciles each detected change with complete same-block mint/burn events, and exposes
  provider-free PostgreSQL/API/UI replay;
- exact point-in-time Flap lifetime materialization that composes official SQD dataset-start
  metadata, a unique deployment-origin proof, and immutable origin-to-finalized-target history;
  `Known(true)` is emitted only when every child range and Snapshot agrees, with provider-free
  API/UI replay of the composite scan;
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
  EV --> CR["Control-right engine"]
  EV --> LM["Launch and market adapters"]
  ER --> RV["Realizable-value engine"]
  CR --> RV
  LM --> RV
  RV --> SC["Scenario engine"]
  EV --> UI["Analyst UI"]
  ER --> UI
  CR --> UI
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
The query API also returns strictly validated EVM/Bitcoin/Solana blocks and transactions, bracketed
Bitcoin address UTXOs, outpoints with observable script-control facts, and Bitcoin transaction-level
clustering candidates with CoinJoin/Payjoin/service suppression. Provider records remain separate
from derived Evidence; scripts, keys and common inputs are never treated as entity identity. A
common-position anchor/continuity foundation now detects deterministic source conflicts and parent
history changes without choosing a majority winner. Flap lifetime heads add deterministic
multi-source rollback/replay; general multi-chain scheduling and rollback, independent-provider and
forced-reorg validation, semantic normalization, graph projection, protocol-specific decoders, and
distributed workflows remain open work. Read
[Architecture](docs/architecture/ARCHITECTURE.md) and the authoritative
[Master Prompt](docs/architecture/ZEROTRACE_MASTER_PROMPT.md).

## Chain and platform scope

| Domain             | Terminal scope                                                                                | Current repository state                                                                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVM                | Ethereum-compatible state, traces, token flows, proxies, multisigs, launchpads, DEX liquidity | Snapshot-bound queries, finalized raw execution/state, strict ERC-1167/EIP-1967/ERC-173/registered-Safe reads, recursive logic-code hashing, and Sourcify V2 exact-source binding; effective custom-role controllers, validity history and archive/semantic validation pending                                            |
| Bitcoin            | UTXO history, spend graph, CoinJoin-aware entity evidence, inscriptions/runes where relevant  | Snapshot-bound block/address/transaction/outpoint reads, standard-script control and conservative common-input/change candidates with CoinJoin/Payjoin/fanout suppression; Core policy, complete graph/history, calibrated classification and asset protocols pending                                                     |
| Solana             | Accounts, Token/Token-2022, instruction/CPI history, authorities, PDAs, launchpads and AMMs   | Snapshot-bound queries/raw execution plus finalized atomic SPL Token/Token-2022/multisig/upgradeable-loader authority reports; PDA/Squads recursion, authority history, IDL/build provenance, other loaders and archive semantics pending                                                                                 |
| Entity Resolution  | controller, coordination, and independence probabilities with evidence                        | Deterministic baseline plus executable structural Precision/False-Merge gate implemented; temporal graph and Snapshot/Evidence-backed real-world calibration corpus pending                                                                                                                                               |
| Control Rights     | point-in-time and historical authority, proxy, multisig, role and revocation facts            | Immutable EVM standard/source and Solana token/loader point-in-time reads plus desktop/mobile replay implemented; effective custom roles, controller history/recursion, Bitcoin custody and Solana PDA/Squads depth pending                                                                                               |
| Launchpad          | Flap, Pump/PumpSwap, Raydium LaunchLab, Meteora DBC, Moonshot, Four.meme, FomoWell            | Flap state, exact transaction decode, durable origin/history, accepted heads/rollback, provider-free replay, and Pancake V2 migrated-market inspection work; forced real reorg, terminal FFT and other adapters pending                                                                                                   |
| Realizable Value   | exact route quotes, tax/fee/gas, impact, capacity, shared-liquidity exit order                | Constant-product/exit-race kernels, Flap Portal preview, and verified Pancake V2 buy/exit-size models work; pinned-fork execution, additional routes, gas, executable capacity and multi-route RV remain                                                                                                                  |
| Claim Verification | public tax/burn/LP/treasury/pension claims compared with replayable chain actions             | Evidence-bound statement compiler, allocation/action kernel, Transfer/Safe observation, event-candidate promotion, bounded all-block supply continuity, live FFT observations and Claim Report replay work; complete historical backfill, continuous scheduling, official attribution and terminal FFT acceptance pending |
| Evidence           | immutable provenance, source snapshot, derivation graph, confidence and coverage              | Durable Snapshot/node/edge graph plus versioned raw artifacts for every implemented ingestion record                                                                                                                                                                                                                      |

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

To prove ERC-20 supply continuity over one explicit BSC range, configure two independently operated
archive-capable RPC endpoints and run the isolated one-shot profile:

```bash
docker compose --profile supply-continuity run --rm supply-continuity-worker \
  --token 0x0000000000000000000000000000000000000000 \
  --from 100000000 --to 100000127 --segment-size 128
```

The worker samples `block - 1` plus every block in the requested inclusive range. A verified result
requires exact block/hash/state agreement and two operators recognized by the versioned official
registry. Any source conflict fails before checkpoint advancement; an event-unexplained state
change is retained as an explicit contradiction and never becomes a burn action. A completed scan replays without RPC/SQD access at
`GET /api/v1/claims/EVM/<token>/supply-continuity/<scan-id>`. Completion covers only the requested
range; it is not lifetime proof or evidence that a publicity-named custody wallet is a burn.

Wide Flap contract-origin scans use a separate durable one-shot worker. Every completed SQD chunk is
committed to PostgreSQL with its Snapshot and Evidence IDs, so the identical command resumes at the
next uncommitted block and a completed command replays without provider access:

```bash
docker compose --profile semantic run --rm flap-origin-worker \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 999999 --chunk-size 1000000
```

Replace the zero address and range with an explicitly selected token and finalized inclusive range.
This establishes only origin coverage inside that range. It does not claim lifetime event coverage,
continuous scheduling, or a complete launch/market/RV conclusion.

Wide Flap event-history scans use the same semantic profile but persist one immutable bounded result
per segment before advancing the durable cursor:

```bash
docker compose --profile semantic run --rm flap-history-worker \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 99999 --segment-size 50000 --chunk-size 10000
```

The credential-free terminal summary contains a scan ID. After the API is running, replay stored
pages without provider access at
`GET /api/v1/launches/EVM/<token>/history/projections/<scan-id>?chainId=eip155:56&platform=flap` or
paste that ID into the analyst UI. Requested-range completion never changes lifetime coverage from
Unknown.

To compose dataset-start origin proof and complete supported Portal history at one finalized BSC
Snapshot, run the lifetime materializer:

```bash
docker compose --profile semantic run --rm flap-lifetime-worker \
  --token 0x0000000000000000000000000000000000000000
```

The default captures the current finalized head. Supply `--target <block>` for an exact rerun; the
worker first proves that the requested block is not above the current finalized head. Its scan ID
can be replayed without provider access at
`GET /api/v1/launches/EVM/<token>/history/lifetime/materializations/<scan-id>?chainId=eip155:56&platform=flap`
or in the analyst UI. A missing or ambiguous origin remains Unknown; a partial or Snapshot-conflicting
child result fails closed. This is a point-in-time proof, not a continuous scheduler.

To maintain an append-only accepted head after that baseline, configure at least two distinct BSC
RPC URLs and run the continuous worker:

```bash
docker compose --profile semantic up --build flap-lifetime-head-worker
```

Each cycle reconciles a common finalized target, accepts the first exact materialization, then scans
only `(previous target + 1) → new target`. Direct-parent or historical predecessor continuity must be
Evidence-proven by the configured quorum before an extension is stored. Provider disagreement,
regression, incomplete delta history, or a finalized hash conflict cannot advance the head. The
latest accepted state is provider-free at
`GET /api/v1/launches/EVM/<token>/history/lifetime/heads/latest?chainId=eip155:56&platform=flap`
and in the analyst UI. When every participating endpoint agrees that an accepted historical suffix
changed, the worker appends an Evidence-backed invalidation, rolls canonical state back to the newest
verified ancestor, and immediately re-enters materialization/extension. Any unavailable or
disagreeing source defers recovery without choosing a majority. Forced real-reorg and independent-
operator acceptance remain pending.

For a Flap token that has migrated to PancakeSwap V2, the read-only market endpoint verifies the
documented BSC factory and router, pool identity, reserves, decimals, and bytecode at the inspection
Snapshot before quoting one to eight buy sizes:

```bash
curl -sS -X POST http://localhost:8080/api/v1/rv/flap-pancake-v2-buy-scenarios \
  -H 'content-type: application/json' \
  -d '{"chainId":"eip155:56","token":"0xdcfb441a1f38802820a4e7b4cc8aab37833c7777","quoteInputs":["100","1000","10000"]}'
```

The response keeps reserve spot, official Router gross output, the configured-tax estimate, and
actual execution-net output separate. It automatically checks the clean-room pool calculation
against `getAmountsOut` with a `10` bps deterministic budget. Actual tax/swapback execution remains
Unknown until a pinned-fork execution probe exists, and a transfer to a movable pension wallet is
custody—not a supply burn or an extra price effect.

Use the companion sell endpoint to compare one-share and multi-share-sized exits without treating
`balance × spot` as realizable value:

```bash
curl -sS -X POST http://localhost:8080/api/v1/rv/flap-pancake-v2-sell-scenarios \
  -H 'content-type: application/json' \
  -d '{"chainId":"eip155:56","token":"0xdcfb441a1f38802820a4e7b4cc8aab37833c7777","tokenInputs":["1000000","5000000","10000000"]}'
```

The configured-tax result is a deterministic pool estimate, not an execution claim. Actual wallet
settlement and executable capacity remain Unknown until a pinned-fork swap tests tax, swapback,
max-sell, blacklist, gas and revert behavior.

Use the multi-source endpoint to rerun the complete market plus both scenario families through every
configured BSC adapter at one automatically reconciled finalized block:

```bash
curl -sS -X POST http://localhost:8080/api/v1/rv/flap-pancake-v2-reconciliation \
  -H 'content-type: application/json' \
  -d '{"chainId":"eip155:56","token":"0xdcfb441a1f38802820a4e7b4cc8aab37833c7777","quoteInputs":["100","1000","10000"],"tokenInputs":["1000000","5000000","10000000"]}'
```

The result is `PASS` only when the block/hash anchors agree, every exact identity/state field agrees,
the bounded quote/RV checks pass, and official endpoint documentation resolves at least two distinct
operators. Two BNB Chain public hostnames therefore remain `SAME_OPERATOR`/`INCONCLUSIVE`; configure
the documented Alchemy BSC URL template plus a BNB Chain endpoint to exercise the verified-
independence gate. Credentials are expanded locally and never appear in source IDs or Evidence.

Inspect the point-in-time EVM standard control surface and persist its replayable report with:

```bash
curl -sS -X POST \
  http://localhost:8080/api/v1/control-rights/EVM/0xdcfb441a1f38802820a4e7b4cc8aab37833c7777/inspect \
  -H 'content-type: application/json' \
  -d '{"chainId":"eip155:56"}'
```

The report covers exact ERC-1167/EIP-1967/ERC-173 and registered-Safe observations. It never treats
a zero owner or missing standard slot as proof that custom tax, role, treasury, LP, upgrade or
historical control is absent. When `SOURCIFY_V2_URL` is configured, source metadata is accepted only
when its exact runtime bytecode equals the logic bytecode returned by every RPC operator at the
selected finalized Snapshot. Matching ABI mutation functions are labeled `DECLARED_ONLY`; they do
not become current rights without controller Evidence. Once captured, latest/exact report routes and
the Control Rights UI replay PostgreSQL without contacting a provider.

Inspect the current finalized Solana account-set control surface with:

```bash
curl -sS -X POST \
  http://localhost:8080/api/v1/control-rights/SOLANA/So11111111111111111111111111111111111111112/inspect \
  -H 'content-type: application/json' \
  -d '{"chainId":"solana:mainnet"}'
```

The Solana path atomically re-reads the subject and discovered control accounts at one finalized
slot, decodes classic SPL Token, Token-2022 and upgradeable-loader state, and persists nested
Evidence. Public JSON-RPC does not provide arbitrary historical account state, so this endpoint
rejects a caller-supplied historical slot instead of pretending the current account state existed
there. Exact and latest persisted report routes remain provider-free.

Temporal is opt-in with `docker compose --profile full up --build`; Apache AGE is opt-in with
`--profile graph`.

Public BNB Smart Chain, Bitcoin, and Solana endpoints are development fallbacks and can be
rate-limited. Ethereum remains unconfigured until a local Alchemy key or another read-only RPC is
provided. The example config supplies two BSC endpoints for endpoint-level comparison; ZeroTrace
does not infer operator independence from hostnames. The market/RV reconciler can verify the
documented Alchemy and BNB Chain operators, but archive-grade retention, forced-reorg operation and
other network/provider combinations still require production validation.

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

After starting PostgreSQL and setting `POSTGRES_URL`, the same durable Flap origin worker can run on
the host:

```bash
npm run flap:origin -- \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 999999 --chunk-size 1000000
```

For durable segmented event-history projection:

```bash
npm run flap:history -- \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 99999 --segment-size 50000 --chunk-size 10000
```

For exact point-in-time lifetime materialization:

```bash
npm run flap:lifetime -- \
  --token 0x0000000000000000000000000000000000000000
```

For continuous finalized-head maintenance:

```bash
npm run flap:lifetime:heads -- \
  --token 0x0000000000000000000000000000000000000000 \
  --interval-ms 60000
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
npm run eval:entity
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
  semantic-worker/      Durable Flap, ERC-20 burn-promotion and supply-continuity worker CLIs
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
- [x] Add exact Entity Precision/False-Merge gates, Brier/ECE evaluation, and a test-only structural golden corpus
- [x] Wire append-only PostgreSQL Evidence/Snapshot persistence and restart-safe drilldown
- [x] Wire ClickHouse Raw Facts and content-addressed, versioned object payload storage
- [x] Implement restart-safe SQD finalized block-header ingestion across all three ledger families
- [x] Add restart-safe provider-shaped raw-transaction ingestion across all three ledger families
- [x] Add finalized EVM logs, Bitcoin inputs/outputs, and Solana instruction/CPI raw records
- [x] Add EVM trace/state-diff and Solana log/balance/token-balance/reward raw records
- [x] Make current-state EVM/BTC/Solana snapshot anchors finality-explicit and ledger-canonical
- [x] Add common-position endpoint anchor reconciliation and parent-history continuity detection
- [x] Add Snapshot- and Evidence-backed block/transaction/outpoint query contracts and UI rendering
- [x] Add Bitcoin transaction common-input/change candidates with CoinJoin/Payjoin/service suppression and no automatic entity merge
- [x] Add version-pinned Flap BSC Portal-state inspection with Evidence/Unknown UI rendering
- [x] Add fixed-block Flap Portal sell previews with provider Evidence and no-fake-zero UI states
- [x] Add exact-receipt Flap creation/configuration/migration event decoding with default provenance
- [x] Add bounded Flap Portal discovery through finalized SQD/RPC log sources with exact log/receipt replay
- [x] Add bounded finalized SQD contract-origin proof with exact Flap receipt/Snapshot replay
- [x] Add durable generic semantic-scan state and contiguous coverage checkpoints
- [x] Add immutable, Evidence-backed Flap history segment projection storage
- [x] Add restart-safe cross-range Flap event-history projection over immutable segments
- [x] Bind Flap event-history projection to a read-only worker, paginated API, health, Compose and UI
- [x] Bind the Flap origin API to restart-safe chunk progress and terminal-result replay
- [x] Add a one-shot deployment-origin worker with durable chunk resume and safe terminal replay
- [x] Add exact point-in-time dataset-start-to-finalized-head lifetime materialization and replay
- [x] Add multi-RPC finalized-head scheduling with Evidence-proven incremental deltas and latest-head UI
- [x] Add append-only multi-source Flap finalized-reorg rollback with safe branch replay
- [x] Add same-Snapshot typed discrepancy audits with Evidence validation and per-class error budgets
- [x] Add Snapshot/Evidence-gated claim-allocation and terminal-action audit kernels
- [x] Add Evidence-bound tax/treasury/burn/liquidity/pension/dividend statement compilation and human-review UI
- [x] Add finalized target-indexed EVM Transfer/custody observation and live same-Snapshot FFT address-flow composition
- [x] Add exact-block ERC-20 total-supply/mint-burn conservation, Evidence replay, API and responsive Claim Audit UI
- [x] Add BSC SQD long-range zero-address burn-candidate discovery with explicit silent-supply Unknown
- [x] Add restart-safe burn-candidate promotion, exact-block certificates and provider-free API/UI replay
- [x] Add bounded multi-source all-block ERC-20 supply continuity with change certificates and provider-free replay
- [x] Add same-Snapshot Pancake V2 spot plus multi-size Flap buy/exit scenarios with automatic 0.10% arithmetic checks
- [x] Add complete common-finalized-block Flap/Pancake V2 multi-source reconciliation with official operator attestations and typed 0%/0.50% budgets
- [ ] Add live/unfinalized policy, archive-grade coverage and forced real-reorg drills across independent operators
- [ ] Add Pump/PumpSwap, Raydium, Meteora, Moonshot, Four.meme and FomoWell decoders
- [ ] Build temporal entity graph, real-world calibration datasets, analyst overrides and auditable recomputation
- [x] Add finalized ERC-1167/EIP-1967/ERC-173/registered-Safe EVM control-surface reports and UI
- [x] Bind recursive EVM logic bytecode to exact Sourcify V2 metadata and separate declared mutation surfaces from effective rights
- [x] Add finalized one-slot SPL Token/Token-2022/multisig/upgradeable-loader authority reports and UI
- [ ] Extend control rights to effective custom EVM roles/history and controller recursion, Bitcoin custody, and Solana PDA/Squads/history/build provenance
- [ ] Complete launch/market lifecycle plus multi-route sell RV, tax execution, gas, capacity and fork settlement
- [x] Bind same-Snapshot claim-address observations to immutable, provider-free API/UI report replay
- [ ] Backfill complete supply history and add continuous capture scheduling, reviewed-draft promotion and terminal FFT audit
- [ ] Complete search, timeline, evidence graph, comparison, scenario and export workflows in the UI
- [ ] Run archive-grade, multi-provider, real-chain fixtures and production load/failure testing

The named terminal real-chain acceptance target is Flap/BSC token FFT at
`0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`; its error budget and automatic discrepancy rules are
defined in [the FFT acceptance specification](docs/testing/FLAP_FFT_ACCEPTANCE.md). Named
same-Snapshot Pancake V2 buy/exit-size slices now pass their deterministic arithmetic checks; this is
not a terminal FFT conclusion. Live Alchemy + BNB Chain runs pass the independent-source market/RV
gate and identify the FFT token as an ERC-1167 proxy with a fixed implementation and zero-valued
ERC-173 owner. The implementation logic is an exact Sourcify match for `FlapTaxTokenV3`; its ABI
declares owner-transfer and migration mutations, but their current reachability and controllers are
not inferred from declaration alone. Tax, blacklist, treasury, LP and historical authorization
remain Unknown, while fork settlement, multi-route RV, real-world entity calibration and
claim-action gates remain open.

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
