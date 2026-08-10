# ZeroTrace Progress Ledger

Last updated: 2026-08-10

This file reports engineering truth against the terminal architecture. “Implemented” means code and
automated tests exist in this repository. “Validated” additionally requires clean-environment and
real-provider evidence. A configured route, interface, schema, or placeholder is not counted as a
completed feature.

## Executive status

| Measure                          | Current state                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Terminal architecture completion | **17% estimated**                                                                                               |
| Runnable foundation              | **Yes; clean Docker build/start verified**                                                                      |
| Production acceptance            | **No**                                                                                                          |
| Transaction mode                 | **Read-only; signing/broadcast/private-key custody forbidden**                                                  |
| Unit tests                       | **306 passing across 40 files**                                                                                 |
| Integration tests                | **38 environment-free plus 18 real PostgreSQL passing; latest completed remote all-store suite has 54 passing** |
| Real-browser E2E                 | **10 passing: Chromium desktop and Pixel 7**                                                                    |
| Remote CI                        | **Pass on immutable development commit `12fc47d`; protected main `3372a5a`**                                    |
| Coverage                         | **Current local: 81.92% statements / 76.06% branches / 89.51% functions / 82.84% lines**                        |
| Real-chain validation            | Four-chain anchors/raw ingestion plus named Flap history and origin replays passed                              |
| Durable evidence/history         | Raw execution/state, semantic checkpoints, Flap segments, exact lifetime and append-only finalized heads wired  |

The percentage is a conservative terminal-scope estimate, not a velocity metric. Passing foundation
tests does not increase unimplemented protocol, ingestion, intelligence, or operations scope.

## Terminal-scope status matrix

The only allowed status vocabulary in this ledger is:
`IMPLEMENTED_AND_VERIFIED`, `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION`,
`PARTIALLY_IMPLEMENTED`, `BLOCKED_EXTERNAL`, and `NOT_IMPLEMENTED`.

| Architecture domain                  | Status                                      | Current boundary                                                                                                                                   |
| ------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository, contracts, CI foundation | `IMPLEMENTED_AND_VERIFIED`                  | clean builds, automated gates, containers, browser flows, and remote CI passed                                                                     |
| Read-only provider transport         | `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION` | request-scoped source, cache bypass and endpoint comparison work; forced outage drill pending                                                      |
| EVM current-state adapter            | `IMPLEMENTED_AND_VERIFIED`                  | parent-linked finalized/safe/latest anchors; Ethereum and BSC finalized smoke passed                                                               |
| Bitcoin current-state adapter        | `IMPLEMENTED_AND_VERIFIED`                  | height/hash/previous-hash Esplora anchor; public best-chain smoke passed                                                                           |
| Solana current-state adapter         | `IMPLEMENTED_AND_VERIFIED`                  | blockhash/parent-slot anchor and minimum-context account smoke passed                                                                              |
| Durable ingestion and chain history  | `PARTIALLY_IMPLEMENTED`                     | raw history, anchor continuity and generic semantic checkpoints work; general scheduling and rollback/replay remain                                |
| Evidence graph                       | `PARTIALLY_IMPLEMENTED`                     | durable nodes/Snapshots/anchors/alerts plus raw artifacts work; terminal graph is incomplete                                                       |
| Data quality and discrepancy audits  | `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION` | typed same-Snapshot budgets and Evidence gates work; independent real-source reconciliation and entity calibration remain                          |
| Entity Resolution                    | `PARTIALLY_IMPLEMENTED`                     | conservative baseline engine only; calibration and temporal graph are absent                                                                       |
| Launchpad Intelligence               | `PARTIALLY_IMPLEMENTED`                     | Flap state, exact transaction decode, durable origin/history and continuous accepted lifetime heads work; rollback, FFT and other platforms remain |
| Realizable Value                     | `PARTIALLY_IMPLEMENTED`                     | constant-product/exit-race kernels and Flap Portal preview work; DEX routes, fee/impact decomposition, gas and capacity remain                     |
| Scenario Engine                      | `PARTIALLY_IMPLEMENTED`                     | deterministic shared-pool exit race only                                                                                                           |
| Analyst UI                           | `PARTIALLY_IMPLEMENTED`                     | typed ledger results, Evidence and anchor Data Health work; terminal investigation is absent                                                       |
| Production security/operations       | `PARTIALLY_IMPLEMENTED`                     | read-only/SSRF gates work; auth, tenancy, DR, load and chaos gates are absent                                                                      |

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
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31325135812) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31325135794) passed on immutable
  development commit `83b5194` for finalized cross-ledger execution/state ingestion.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31326491651) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31326491643) passed on immutable
  development commit `73a1cae` for ledger-canonical current-state Snapshot anchors.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31327702718) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31327702700) passed on immutable
  development commit `6c0b7f4` for request-scoped provider provenance and dynamic-anchor cache
  bypass.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31331644908) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31331644917) passed on immutable
  development commit `fa69cc5` for Evidence-backed anchor reconciliation, continuity, durable
  alerts, Snapshot recapture, API/UI Data Health, and restart acceptance.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31335114054) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31335114055) passed on immutable
  development commit `5b77783` for typed ledger queries, strict provider records, Evidence/Unknown
  semantics, UI rendering, and Windows-owned browser-test processes.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31337044939) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31337044942) passed on immutable
  development commit `440f328` with the Flap BSC Portal-state inspector, API/UI Evidence surface,
  248 tests, 10 browser flows, dependency gates, and five production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31338076164) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31338076179) passed on immutable
  development commit `53131cc` with fixed-block Flap Portal sell previews, 253 tests, 10 browser
  flows, dependency gates, and five production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31339423268) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31339423250) passed on immutable
  development commit `7b41820` with Evidence-grounded typed discrepancy audits, 266 tests, 10
  browser flows, dependency gates, and five production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31339918653) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31339918663) passed on immutable
  development commit `fd1327a` after the Flap v5.14.16/V8Safe official-interface alignment, with
  267 tests, 10 browser flows, dependency gates, and five production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31341351857) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31341351830) passed on immutable
  development commit `1b6a40e` for exact-receipt Flap lifecycle transactions, with 275 tests, 10
  browser flows, dependency gates, and five production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31342767551) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31342767550) passed on immutable
  development commit `a52a78e` for bounded receipt-replayed Flap Portal history, with 281 tests, 10
  browser flows, dependency gates, and five production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31348886022) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31348886023) passed on immutable
  semantic-checkpoint commit `40d33e8`: 302 tests, 86.49% statement/78.28% branch/95.60% function/
  87.54% line coverage, 10 browser flows, dependency gates, and five production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31350281421) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31350281405) passed on immutable
  origin-resume commit `513c561`: 304 tests, 86.20% statement/78.20% branch/95.65% function/87.17%
  line coverage, 10 browser flows, dependency gates, and five production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31352251137) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31352251135) passed on immutable
  semantic-worker commit `768e116`: 311 tests, 85.68% statement/77.99% branch/94.77% function/86.66%
  line coverage, 10 browser flows, dependency gates, and all six production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31353275372) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31353275413) passed on immutable
  history-segment commit `213805e`: 316 tests, 85.62% statement/78.19% branch/94.80% function/86.60%
  line coverage, 10 browser flows, dependency gates, and all six production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31354381537) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31354381536) passed on immutable
  cross-range history-projection commit `8827be4`, including the real PostgreSQL interruption/replay
  boundary and all production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31356333191) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31356333186) passed on immutable
  history-worker/API/UI commit `cfce7f9`: 329 tests, 84.98% statement/77.92% branch/94.44%
  function/85.90% line coverage, 10 browser flows and all six production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31358180186) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31358180189) passed on immutable
  lifetime API/UI commit `b887be7`: 344 tests, 84.73% statement/78.09% branch/94.01% function/
  85.65% line coverage, 10 browser flows and all six production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31362400150) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31362400149) passed on immutable
  continuous lifetime-head capability commit `12fc47d`: 365 tests, 83.78% statement/77.99% branch/
  92.13% function/84.70% line coverage, 10 browser flows and all six production container targets.

### Read-only chain foundation

- EVM JSON-RPC adapter with configurable `finalized`/`safe`/`latest` snapshot tags, canonical hex
  validation, pinned native balance/code reads, and an audited method allowlist;
- Bitcoin Esplora adapter whose best-chain hash is resolved from the exact observed height, plus
  address, transaction, and output-spend primitives;
- Solana JSON-RPC adapter with finalized slot-specific `getBlock` blockhash/time and strict,
  lossless minimum-context account reads, including explicit non-existent accounts;
- strict EVM transaction/receipt, Bitcoin transaction/outspend, and Solana transaction reads with
  canonical identifier, placement, integer, status, and signature validation;
- read-only typed block/transaction/outpoint queries that bind confirmed facts to position-pinned
  Snapshots, bind pending/mempool observations to captured heads, and attach replayable Evidence;
- null EVM/Solana transaction responses produce raw provider observations plus derived negative
  Evidence with explicit ambiguity; they do not become absence claims or numeric zeros;
- shared provider transport with hostname allowlist, DNS/IP SSRF checks, redirect denial, timeout,
  bounded exponential retries, `Retry-After`, request pacing, in-flight deduplication, TTL/LRU
  caching, circuit breaking, ordered failover, response-size bounds, and unsafe-integer
  preservation;
- request-scoped safe endpoint IDs survive concurrent failover, dynamic Snapshot anchors bypass
  stored TTL entries, and health distinguishes cache hits/misses/bypasses;
- safe hostname-based active-source diagnostics in health, Snapshot and Evidence metadata;
- regression tests that reject EVM and Solana broadcast methods before network access;
- Ethereum via Alchemy plus public BSC, Bitcoin, and Solana current-state smoke reads with
  ledger-canonical Snapshot anchors and snapshot-pinned Evidence. These are smoke checks, not
  archive-grade, forced-reorg, or cross-provider semantic acceptance.
- query-time Snapshot `providerVersions`, Evidence source, payload hash, and metadata `sourceSet`
  bind the actual endpoints used for anchor and state calls rather than a shared last-completed
  endpoint value;

### Anchor reconciliation and continuity foundation

- ledger-specific EVM, Bitcoin, and Solana anchor reads retain block/slot hash, parent identity,
  finality, source, replay Snapshot, raw payload hash, and Evidence;
- each configured endpoint is observed separately, faster heads are re-read at the minimum common
  position, and ordinary head skew cannot become a false disagreement;
- two sources are required by default; agreement requires one complete identity group, while any
  conflict produces `DISAGREEMENT`, an Unknown canonical anchor, and a CRITICAL Evidence-linked
  alert rather than a majority winner;
- single/failed sources remain `INSUFFICIENT_SOURCES`/`UNAVAILABLE`; endpoint operator independence
  remains `Unknown(NOT_QUERIED)` and is never inferred from hostnames;
- continuity covers first observation, unchanged/direct extension, historical gap verification,
  detected reorg, source regression, and unavailable checks, with prior/current/check Evidence;
- PostgreSQL persists append-only anchors and alerts, enforces alert Evidence edges, survives
  repository restart, and passed the complete 37-test API/durable integration suite;
- Snapshot observation identity includes capture time, so a later read of the same anchor/config is
  replayable instead of conflicting; a production API container restart retained four chain results,
  `UP` Data Quality storage, and no `SNAPSHOT_CONFLICT`;
- the API, capability ledger, health response, and Data Health UI expose per-chain status, coverage,
  common position, canonical/Unknown state, continuity, alerts, Evidence count, and durability;
- a live read observed single-source Ethereum `25719261`, Bitcoin `961762`, and Solana `438251403`
  as insufficient, while two BSC endpoints agreed at common position `114979794`. A second same-
  process observation agreed at BSC `114979862` and historically rechecked both earlier heads;
  Ethereum and Bitcoin were unchanged, while the second Solana observation became unavailable.
  These are endpoint-level observations, not independent-provider or forced-reorg acceptance.

### Evidence and analysis foundation

- deterministic canonical JSON hashing, independent payload hashes, and complete-observation
  content-addressed Evidence IDs that distinguish source, locator, block/slot, observation time, and
  the normalized derivation-edge set;
- immutable process-local evidence cache plus transactional, append-only PostgreSQL persistence for
  complete Snapshots, nodes, edges, idempotent writes, and restart-safe drilldown;
- application and deferred database constraints that reject inferred/negative Evidence without a
  source observation and reject mutation of Evidence, edges, or Snapshots;
- generic PostgreSQL semantic-scan checkpoints bind immutable scan identity, hash-verified JSON
  state, cumulative canonical Evidence IDs and exact next-block coverage; stale writers, gaps,
  oversized chunks, rollback, terminal mutation and deletion fail closed, while exact retries and
  repository restarts resume idempotently;
- entity, RV, and scenario requests reject missing or snapshot-incompatible source Evidence with
  HTTP 422 instead of producing an ungrounded result;
- baseline evidence-weighted entity relationship model with CoinJoin, service-hub, and independence
  suppression;
- exact-integer constant-product exit quote;
- deterministic seeded shared-liquidity exit-race simulation with percentile output;
- explicit unavailable output when selling is disabled instead of a zero return.
- same-Snapshot typed discrepancy audits for exact identity/state, conservation, deterministic
  derived values, independent quote/RV, holder/entity aggregates, freshness, and API/UI parity;
- exact-decimal arithmetic enforces zero mismatch for exact state/conservation, `0.10%` derived and
  aggregate budgets, and `0.50%` pass/`1.00%` warning quote/RV bands without floating-point drift;
- missing or Snapshot-incompatible Evidence is rejected, Unknown/unavailable values and zero
  references are excluded from numeric denominators, insufficient coverage is inconclusive, and
  independent quote/RV scoring requires positively verified source independence;
- every non-empty API audit writes derived Evidence linked to its source and explanation Evidence;
  every returned discrepancy directly references the derived audit Evidence.

### Flap BSC inspection foundation

- official BSC Portal v5.14.16 deployment and inspected interface revision are explicit source
  observations rather than silent constants;
- fixed-block Portal/token bytecode reads and versioned `getTokenV8Safe`/V6/V5 calls retain raw
  Evidence and produce one source-linked derived launch Snapshot;
- lifecycle, reserves, curve parameters, supply/progress, quote asset, tax and pool fields are
  normalized without converting future enums or unqueried configuration/rights into facts;
- missing token bytecode produces negative Evidence and `platformMatch=false` instead of a fake
  launch; malformed responses fail rather than silently falling back;
- the typed API and desktop/mobile UI expose replay metadata, Evidence and Unknown sell-capacity/LP
  fields. This slice has deterministic tests but no named real-chain acceptance yet.
- fixed-block `previewSell` returns the exact Portal `uint256` proceeds as a Known atomic value only
  after a successful read; buy-only, killed, staged, migrated, unsupported and excessive-input
  states remain unavailable/Unknown and never become zero;
- the quote API/UI retains raw call and derived Evidence while nominal price, decimals-normalized
  average price, independent impact, fee decomposition, gas and capacity stay Unknown.
- caller-supplied Flap creation, staging and migration transaction hashes are rebound to their exact
  block/hash Snapshot; strict Portal receipt logs decode into raw receipt/log and derived Evidence;
- optional same-transaction configuration is tagged as `EVENT` or `OFFICIAL_DEFAULT`; missing
  legacy curve address/V2 reserve fields and future enum values remain Unknown rather than zero;
- `TokenCreated`, `FlapTokenStaged`, curve/threshold/quote/migrator/version/tax/DEX/extension
  configuration, `LaunchedToDEX`, and `TokenPoolInfoUpdated` have deterministic schema, adapter,
  API, Evidence drilldown, and desktop/mobile UI coverage;
- this transaction-local slice explicitly reports zero history coverage. Automatic transaction
  discovery, complete cross-transaction lifecycle, and named real-chain acceptance remain pending.
- bounded Portal history scans validate and chunk strict `eth_getLogs` ranges, decode the
  non-indexed token field, and exact-receipt replay every candidate before producing chronology;
- requested-range coverage can become 100% only after every chunk and receipt succeeds, while
  token-lifetime coverage and terminal history coverage remain Unknown/zero until deployment-origin
  indexing is continuous; empty ranges create bounded negative Evidence, not lifetime absence.
- when SQD BSC is configured, finalized `binance-mainnet` address/topic-filtered logs are preferred
  for bounded discovery; dataset-start, source-head, parent continuity, filter integrity and result
  bounds fail closed, while BSC RPC field-for-field replays every discovered log, receipt and block.
  Strict RPC log discovery remains the documented fallback when SQD is unavailable or unconfigured;
- project code replayed named non-FFT Flap transaction
  `0x53614caf06221b2dadee950b588ca0bad466f73e04a40c6392780f9459630459` for token
  `0xb81252503501f366b5dfb8c89fff85076d2f8888` at block `98759976`: SQD range discovery plus RPC
  receipt replay produced creation/configuration chronology, 100% requested-range coverage and 12
  Evidence nodes. Lifetime coverage and terminal history coverage correctly remained Unknown/zero.
- sparse finalized SQD `createResultAddress` discovery now joins a contract creation trace to its
  parent transaction and exact BSC receipt/Snapshot. The named non-FFT token above passed with the
  official Portal as contract creator, trace path `[0,0,0,1]`, 100% one-block range coverage and a
  13-node Evidence drilldown. Lifetime/history coverage correctly remained Unknown/zero;
- logical origin scans can now cross multiple bounded chunks, and every source observation exposes
  requested/next positions, finalized head, response-block count and request count. A live scan of
  BSC blocks `0-999999` required 14 SQD responses and 268 continuation headers, found no creation,
  and accepted the chunk only at `nextBlock=1000000`; this is bounded negative Evidence, not a
  global absence claim;
- when PostgreSQL is configured, the origin API persists each completed chunk with its exact upper
  Snapshot, accumulated creations, source set and Evidence IDs. A deterministic interrupted scan
  resumed from the next block, atomically stored its terminal result, and a third replay made no
  SQD/BSC RPC call or Evidence write; readiness fails if migration `007` is unavailable;
- a separate read-only `semantic-worker` now runs ranges wider than the synchronous API cap as
  bounded chunks. Host and Compose entrypoints preflight Evidence plus migration `007`, resume only
  the exact token/range/chunk identity, and emit a credential-free terminal summary. It is one-shot,
  not continuous scheduling or lifetime event-history projection;
- migration `008` and a dedicated repository now persist each bounded Flap history result as an
  immutable, content-hashed segment linked to its semantic scan and terminal Evidence. Database
  guards require the segment to begin at the live cursor, cover exactly one configured chunk, retain
  canonical existing Evidence/source sets, and reject update/delete. Pagination and exact idempotent
  replay work;
- a restart-safe cross-range runner now executes the existing bounded scanner one immutable segment
  at a time, advances the semantic cursor only after segment persistence, and adopts exactly one
  cursor-adjacent pending segment after an interrupted advance without re-reading providers. It
  produces one terminal Evidence root plus a typed projection summary while requested-range coverage
  is complete and token-lifetime coverage remains Unknown;
- a second read-only `semantic-worker` entrypoint now runs the projection with Evidence/checkpoint/
  projection preflight and emits a credential-free scan ID. The API verifies that ID against the
  exact token, chain, source, scan type, stored segment hashes, Snapshot/Evidence and terminal result,
  then returns bounded pages without provider access. The desktop/mobile UI replays those immutable
  pages and keeps requested-range progress separate from Unknown lifetime coverage. Compose exposes
  this as the opt-in one-shot `flap-history-worker`;
- an exact point-in-time `flap:lifetime` composition now reads official SQD dataset-start metadata,
  binds one finalized BSC target, requires origin search from dataset start through that target, and
  projects immutable supported Portal history from the evidenced creation block through the same
  Snapshot. Only the complete conjunction emits Known lifetime coverage and `historyCoverage=1`;
  no unique origin remains Unknown, while incomplete or conflicting children fail closed. The
  composite checkpoint recovers after advance-before-finish without repeating child work;
- the lifetime worker preflights Evidence/checkpoint/projection storage, captures or validates the
  finalized target and emits composite plus child scan IDs without credentials. A token-bound API
  and desktop/mobile UI replay the stored composite result and terminal Evidence root without SQD
  or RPC access. Compose exposes `flap-lifetime-worker`;
- migration `009_flap_lifetime_heads` and its repository now preserve one immutable INITIAL→EXTENSION
  chain per token. Database guards require completed semantic scans, exact token/target/Snapshot/
  terminal-Evidence identity, current-predecessor linkage and monotonically increasing sequence;
- `flap-lifetime-head-worker` repeatedly reconciles a common finalized BSC position across a
  configured endpoint quorum. It materializes the first exact head, proves direct or historical
  predecessor continuity with persisted Evidence, scans only the missing delta, and publishes the
  accepted latest head through provider-free API/UI. Retryable provider/storage failures defer a
  cycle; regression, disagreement and finalized reorg never advance state. Automatic rollback/replay
  and independent-operator validation remain pending;
- the sampled public BSC RPC rejected historical `eth_getCode` at older heights and is not treated as
  archive-capable. This does not block finalized SQD creation discovery, but archive state remains an
  explicit acceptance gap.

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
- strict EVM log/trace/state-key identities, Bitcoin block/transaction/input-output positions with
  coinbase nulls, and Solana instruction/log/account/reward identities without assuming array-index
  joins or coercing one-sided token records to zero;
- host and container worker commands that accept only dataset/profile/from/to and expose no
  chain-write operation;
- real finalized raw-ledger ingestion and complete artifact/Evidence/fact replay on all four
  supported datasets, including EVM execution/state, Bitcoin UTXO, and Solana execution/balance
  records. This validates provider-shaped observations, not semantic transaction or protocol
  normalization.

### Runtime and developer experience

- Fastify API with OpenAPI UI, liveness/readiness/full health, capability truth, metrics, search,
  current subject reads, typed ledger records, anchor data quality, evidence drilldown, entity
  baseline, RV, and scenario endpoints;
- React workspace with responsive desktop/mobile layout, provider/storage status, typed block,
  transaction and outpoint results, anchor reconciliation/continuity, Evidence, Unknown rendering,
  platform truth, and disabled scenario state until evidence exists;
- PostgreSQL and ClickHouse bootstrap schemas, including append-only PostgreSQL Evidence,
  anchor/alert/ingestion-run and semantic-scan triggers, ClickHouse Raw Fact identity/provenance,
  and Known/Unknown constraints;
- Compose topology for API, web, PostgreSQL, ClickHouse, Valkey, NATS, MinIO, optional Temporal, and
  optional Apache AGE;
- initialization SQL baked into small database images so clean startup also works from Windows
  Unicode workspace paths;
- an owned-process Windows E2E launcher that isolates provider/storage variables and deterministically
  tears down only the API/web processes it starts;
- multi-stage production container build, Nginx security headers, health checks, CycloneDX SBOM, and
  production dependency license/vulnerability gates.

## In development

- durable PostgreSQL repositories for subjects, analysis results, entities, control rights,
  launches, scenarios, labels, and analyst overrides;
- automatic rollback/replay and live/unfinalized policy for detected fork changes;
- immutable real-chain fixture corpus and independently operated provider reconciliation;
- real-source discrepancy reconciliation and a labeled entity-probability corpus for Brier/ECE
  calibration;
- independent-operator validation and archive-grade real-chain acceptance for the repeated Flap
  finalized-head scheduler;
- complete OpenAPI request/response schemas beyond the current endpoint metadata.

## Not implemented

### Ingestion and persistence

- general multi-chain continuous scheduling, unfinalized handling, and automatic reorg rollback/replay;
- transaction-level chain normalization, NATS events, and Temporal workflows;
- graph projection and temporal queries;
- cache invalidation and distributed quota coordination.

### EVM terminal scope

- semantic receipt/event/call/state-change normalization and archive-state reconstruction;
- ERC-20/721/1155, proxy, multisig, owner/role, general tax-token and DEX decoders;
- Ethereum/BSC archive-provider reconciliation and finalized-block policy;
- automatic Flap reorg rollback/replay plus Moonshot, Four.meme, Pancake and other versioned
  platform adapters.

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

| Validation             | Requirement                                                                                                               | Status                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EVM current state      | Named Ethereum and BSC snapshot-pinned current-state reads                                                                | Parent-linked finalized Alchemy/BSC reads passed; BSC endpoint agreement passed, operator independence/archive pending                                                                     |
| Bitcoin current state  | Named immutable fixtures reconciled against self-hosted Core and Esplora                                                  | Height/hash/previous-hash public Esplora read passed; Core reconciliation pending                                                                                                          |
| Solana current state   | Named immutable fixtures reconciled against dedicated RPC/archive history                                                 | Finalized blockhash/parent-slot and account smoke passed; second continuity probe unavailable, archive pending                                                                             |
| Entity baseline        | Labeled independent, coordinated, service-hub, and CoinJoin fixtures                                                      | Pending                                                                                                                                                                                    |
| Launchpad decoders     | Versioned deployments and named launch/migration transactions per platform                                                | A named non-FFT Flap creation/configuration transaction passed; continuous accepted-head mechanics are deterministic-only, while FFT/migration fixtures and other platforms remain pending |
| Flap FFT terminal run  | BSC token `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`: mechanism, entity, market, RV, Evidence and automatic error audit | Exact lifetime-head and discrepancy cores exist; named FFT chain validation, market routes, entity calibration and complete RV still gate any conclusion                                   |
| RV                     | Historic pool snapshots and executable quote reconciliation                                                               | Deterministic kernels plus Flap fixed-block Portal preview pass tests; independent quotes, DEX routes, fee/impact/gas/capacity and history pending                                         |
| Provider resilience    | timeout, quota, malformed data, fork/reorg, and cross-provider disagreement                                               | Deterministic disagreement/reorg tests and live common-position BSC continuity passed; forced real reorg/outage and independent operators pending                                          |
| Finalized block ingest | Replayable EVM/BTC/Solana ranges across object, Evidence, fact and checkpoint stores                                      | Four SQD datasets passed; archive reconciliation pending                                                                                                                                   |
| Raw transaction ingest | Named immutable EVM/BTC/Solana transactions persist and replay across all stores                                          | Ethereum 1, BSC 7, Bitcoin 2, Solana 1 passed; semantic decoding pending                                                                                                                   |
| Raw ledger records     | EVM execution/state, BTC I/O, and Solana execution/balance records replay across stores                                   | Ethereum/BSC traces+diffs, BTC I/O, and all named Solana tables passed                                                                                                                     |

Public BSC, Bitcoin, and Solana endpoints in `.env.example` are development fallbacks. Rate-limited responses do not count
as chain-validation failures, and a successful health probe alone does not validate semantic
correctness. Exact local smoke observations and limitations are in
[the validation record](docs/testing/VALIDATION_RECORD.md).

## Test and verification record

| Check                          | Latest result                                                             | Scope                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Reproducible install/build     | Pass                                                                      | locked npm install in production container; all packages/API/web                                                                |
| Unit tests                     | 306 pass                                                                  | 40 files across schemas, adapters, data quality, ingestion, storage, workers and API runtime                                    |
| Integration tests              | 38 environment-free; 18 real PostgreSQL pass; 54 latest completed CI pass | lifetime/head/projection checkpoint guards and corrupt-state rejection are deterministic; prior all-store suite passes          |
| Restart regression             | Pass                                                                      | same-anchor recapture persists across repository/API restart without Snapshot collision                                         |
| Coverage gate                  | Pass                                                                      | current local: 81.92% statements, 76.06% branches, 89.51% functions, 82.84% lines on 344 tests; 21 opt-in durable tests skipped |
| Chromium E2E                   | 10 pass                                                                   | desktop and Pixel 7 include projection paging, exact/latest lifetime replay, Unknown and storage-failure rendering              |
| Formatting / ESLint / types    | Pass                                                                      | full repository                                                                                                                 |
| Dependency vulnerability audit | Pass                                                                      | 0 vulnerabilities across the complete npm dependency graph                                                                      |
| Dependency license allowlist   | Pass                                                                      | production dependency graph                                                                                                     |
| CycloneDX SBOM                 | Pass                                                                      | npm dependency graph                                                                                                            |
| Compose model                  | Pass                                                                      | rendered default topology                                                                                                       |
| Docker image build/start       | Pass                                                                      | API, web, ingest worker, semantic worker, PostgreSQL, ClickHouse; service images also validated by Compose                      |
| Database bootstrap             | Pass                                                                      | PostgreSQL 001–009/triggers and ClickHouse Raw Fact schema/migration                                                            |
| Runtime/browser smoke          | Pass                                                                      | API/web health, proxy, security headers, desktop/mobile render                                                                  |
| Public chain smoke             | Pass for bounded current/raw-ledger scope                                 | four parent-linked anchors, BSC endpoint agreement/continuity and four finalized pipelines; independent/archive scope pending   |
| Remote CI                      | Pass                                                                      | CI/CodeQL pass on immutable `12fc47d`: 365 tests, 10 Chromium flows and six production container targets                        |

The record is updated only after commands complete. Detailed commands and acceptance criteria are in
[Testing](docs/testing/TESTING.md) and [Final acceptance](docs/testing/FINAL_ACCEPTANCE.md).
The registered FFT/Flap error budgets and automatic discrepancy rules are in
[Flap FFT terminal acceptance](docs/testing/FLAP_FFT_ACCEPTANCE.md).
