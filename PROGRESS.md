# ZeroTrace Progress Ledger

Last updated: 2026-08-11

This file reports engineering truth against the terminal architecture. “Implemented” means code and
automated tests exist in this repository. “Validated” additionally requires clean-environment and
real-provider evidence. A configured route, interface, schema, or placeholder is not counted as a
completed feature.

## Executive status

| Measure                          | Current state                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Terminal architecture completion | **20% estimated**                                                                                                     |
| Runnable foundation              | **Yes; clean Docker build/start verified**                                                                            |
| Production acceptance            | **No**                                                                                                                |
| Transaction mode                 | **Read-only; signing/broadcast/private-key custody forbidden**                                                        |
| Unit tests                       | **425 passing across 62 files**                                                                                       |
| Model evaluation tests           | **1 structural Entity Precision/False-Merge gate passing**                                                            |
| Integration tests                | **60 environment-free plus 23 real-storage passing; 83 with PostgreSQL, ClickHouse and object store enabled**         |
| Real-browser E2E                 | **24 passing: Chromium desktop and Pixel 7**                                                                          |
| Remote CI                        | **Pass on EVM-control commit `6f0efcf`: CI, 24 Chromium flows, production images, and CodeQL**                        |
| Coverage                         | **Current local: 82.85% statements / 76.97% branches / 91.99% functions / 83.99% lines**                              |
| Real-chain validation            | Four-chain anchors/raw ingestion, Flap history/origin, FFT market/supply and point-in-time EVM control surface passed |
| Durable evidence/history         | Raw execution/state, semantic checkpoints, Flap history/lifetime, Claim and EVM Control Surface Reports wired         |

The percentage is a conservative terminal-scope estimate, not a velocity metric. Passing foundation
tests does not increase unimplemented protocol, ingestion, intelligence, or operations scope.

## Terminal-scope status matrix

The only allowed status vocabulary in this ledger is:
`IMPLEMENTED_AND_VERIFIED`, `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION`,
`PARTIALLY_IMPLEMENTED`, `BLOCKED_EXTERNAL`, and `NOT_IMPLEMENTED`.

| Architecture domain                  | Status                                      | Current boundary                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository, contracts, CI foundation | `IMPLEMENTED_AND_VERIFIED`                  | clean builds, automated gates, containers, browser flows, and remote CI passed                                                                                                                  |
| Read-only provider transport         | `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION` | request-scoped source, cache bypass and endpoint comparison work; forced outage drill pending                                                                                                   |
| EVM current-state adapter            | `IMPLEMENTED_AND_VERIFIED`                  | parent-linked finalized/safe/latest anchors; Ethereum and BSC finalized smoke passed                                                                                                            |
| Bitcoin current-state adapter        | `IMPLEMENTED_AND_VERIFIED`                  | height/hash/previous-hash Esplora anchor; public best-chain smoke passed                                                                                                                        |
| Solana current-state adapter         | `IMPLEMENTED_AND_VERIFIED`                  | blockhash/parent-slot anchor and minimum-context account smoke passed                                                                                                                           |
| Durable ingestion and chain history  | `PARTIALLY_IMPLEMENTED`                     | raw history, anchor continuity and generic semantic checkpoints work; general scheduling and rollback/replay remain                                                                             |
| Evidence graph                       | `PARTIALLY_IMPLEMENTED`                     | durable nodes/Snapshots/anchors/alerts plus raw artifacts work; terminal graph is incomplete                                                                                                    |
| Data quality and discrepancy audits  | `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION` | typed same-Snapshot budgets and Evidence gates work; scoped Alchemy/BNB market reconciliation passed, while other domains and entity calibration remain                                         |
| Entity Resolution                    | `PARTIALLY_IMPLEMENTED`                     | conservative baseline plus exact structural Precision/False-Merge gates work; real-world calibration and temporal graph are absent                                                              |
| Control Rights                       | `PARTIALLY_IMPLEMENTED`                     | finalized ERC-1167/EIP-1967/ERC-173/registered-Safe standard surface, immutable reports and UI work; custom roles, history, recursive controllers, Bitcoin and Solana remain                    |
| Launchpad Intelligence               | `PARTIALLY_IMPLEMENTED`                     | Flap state, exact transaction decode, durable origin/history, lifetime heads/rollback and migrated Pancake V2 market inspection work; full FFT lifecycle and other platforms remain             |
| Realizable Value                     | `PARTIALLY_IMPLEMENTED`                     | constant-product/exit-race kernels, Portal preview, buy/exit scenarios and two-operator market reconciliation work; fork execution, additional routes, gas and capacity remain                  |
| Scenario Engine                      | `PARTIALLY_IMPLEMENTED`                     | deterministic shared-pool exit race only                                                                                                                                                        |
| Claim Verification                   | `PARTIALLY_IMPLEMENTED`                     | Declaration review, allocation, flow/custody, immutable reports, event promotion and bounded all-block supply continuity work; complete backfill, continuous scheduling and terminal FFT remain |
| Analyst UI                           | `PARTIALLY_IMPLEMENTED`                     | typed ledger, Evidence, health, claim/burn review, migrated-market scenarios and multi-source discrepancy panels work; terminal investigation remains incomplete                                |
| Production security/operations       | `PARTIALLY_IMPLEMENTED`                     | read-only/SSRF gates work; auth, tenancy, DR, load and chaos gates are absent                                                                                                                   |

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
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31379232227) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31379232232) passed on immutable
  claim-audit kernel commit `23b3306`: 385 tests, 83.74% statement/77.99% branch/92.22% function/
  84.78% line coverage, 10 browser flows and all six production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31382413359) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31382413410) passed on immutable
  EVM claim-observation commit `47b62e1`, including the finalized Transfer collector, strict
  official-registry Safe classification, browser flows, dependency gates and all production targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31383622159) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31383621973) passed on immutable
  claim-flow-summary commit `578c71d`, including all production targets and security analysis.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31384624840) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31384624768) passed on immutable
  same-Snapshot claim-composition commit `d6a7c1f`, including all production targets and security
  analysis.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31399771001) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31399770876) passed on immutable
  Pancake V2 exit-scenario commit `27c296d`: 404 coverage tests, 12 browser flows and all six
  production container targets.
- [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31402343560) and
  [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31402343611) passed on immutable
  Entity Precision/Calibration evaluation commit `399d797`: 410 coverage tests, the structural
  model gate, 12 browser flows and all six production container targets.

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

### EVM control-right foundation

- finalized EIP-1898 reads compare exact contract bytecode, the ERC-1167 implementation, all three
  EIP-1967 slots, ERC-173 `owner()`, registered Safe singleton/owners/threshold state, and resolved
  runtime logic bytecode across every configured source at one common canonical block;
- exact ERC-1167 recognition requires the standard 45-byte runtime prefix/suffix and does not label
  arbitrary delegate-call code as a proxy; source disagreement fails closed before persistence;
- an SSRF-protected, bounded Sourcify V2 adapter accepts only exact verification metadata whose
  runtime bytecode equals the Snapshot-bound RPC logic bytecode; ABI mutation declarations are
  classified separately and never emitted as effective rights;
- each v1.1 result includes a complete 25-domain coverage matrix, so unqueried tax, blacklist,
  whitelist, trading, router, treasury, LP, module, guard and custom authorization surfaces remain
  typed Unknown instead of being inferred absent;
- direct rights carry controller, subject, constraints, Evidence, confidence and explicit Unknown
  `activeFrom`/`activeTo` history when validity windows have not been reconstructed;
- PostgreSQL stores immutable content-addressed reports and validates the finalized Snapshot,
  terminal Evidence identity, nested provenance and exact derivation-edge set; latest/exact/list API
  reads and the responsive Control Rights UI replay without providers;
- a live Alchemy plus BNB Chain inspection of FFT at block `115204533`, hash
  `0xf8c1476af87b6ccd90077145d72e8578664f50f0e629c115a0765ac756e64f55`, identified an
  ERC-1167 proxy whose fixed implementation is `0x024f18294970b5c76c0691b87f138a0317156422`.
  Its 19,331-byte logic hash `0xb530a7e0ff0d6ab435a5ec71f2b04092937735e23a0fb3a0746724ce9b875b4a`
  exactly matched Sourcify contract `FlapTaxTokenV3` compiled with Solidity 0.8.24. The ABI declares
  owner-transfer and migration mutation surfaces, but ERC-173 `owner()` returned the zero address,
  no direct right was emitted, and 17 of 25 coverage domains correctly remain Unknown.

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
- migration `010_flap_lifetime_reorgs` preserves rollback as an append-only invalidation of one exact
  active suffix. Canonical reads exclude invalidated descendants, retain the evidenced surviving
  predecessor, reject invalidated scan replay, and permit a new branch to append with a monotonic
  global sequence;
- `flap-lifetime-head-worker` repeatedly reconciles a common finalized BSC position across a
  configured endpoint quorum. It materializes the first exact head, proves direct or historical
  predecessor continuity with persisted Evidence, scans only the missing delta, and publishes the
  accepted latest head through provider-free API/UI. Retryable provider/storage failures defer a
  cycle; regression, disagreement and finalized reorg never advance the conflicting state. The
  rollback resolver verifies every participating endpoint newest-to-oldest, invalidates only an
  unanimously divergent suffix, and immediately re-enters safe materialization/extension. Forced
  real-reorg and independent-operator validation remain pending;
- the sampled public BSC RPC rejected historical `eth_getCode` at older heights and is not treated as
  archive-capable. This does not block finalized SQD creation discovery, but archive state remains an
  explicit acceptance gap.

### Finalized ingestion foundation

- clean HTTP SQD Portal adapter for finalized Ethereum, BNB Smart Chain, Bitcoin, and Solana
  datasets; no GPL Portal client package is linked into the Apache-2.0 core;
- bounded JSONL streaming with strict dataset/query fields, range and response limits, timeout,
  retry, pacing, continuation, DNS/host policy, and unsafe-integer preservation; the clean adapter
  accepts SQD's observed `text/plain` JSONL media type without weakening JSONL validation;
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

### Claim verification foundation

- deterministic claim-declaration parser stores submitted public wording as Analyst Evidence and
  emits mandatory-human-review drafts for tax receiver, community fund, buyback burn, buyback
  liquidity, pension-vault and weekly dividend roles;
- exact percentages become basis points, while `100w`/`100万` remains 1,000,000 human token units;
  missing wallet addresses and timezone-qualified windows stay Unknown, declarations never become
  chain facts, and no draft is automatically promoted to an audit rule;
- `POST /api/v1/claims/declarations/parse` persists the Analyst Evidence and the responsive Claim
  Audit workspace exposes source/destination, allocation, pension/no-exit/cadence fields, warnings,
  readiness and Evidence ID without adding sample data to the production path;
- deterministic FFT-style percentage allocation audits compare declared Expected amounts with
  observed and coverage-complete Actual amounts using integer arithmetic;
- a versioned default policy treats up to `50` bps amount deviation as verified and up to `500` bps
  as partially verified; callers may supply stricter bounded policy values without changing the
  engine version silently;
- Evidence-linked direct and bounded multi-hop terminal actions distinguish wallet receipt from
  buyback, irreversible burn, liquidity addition, LP control, lock custody and dividend execution;
- Claim Audit v1.1 rejects mixed-asset batches, duplicate action IDs, duplicate normalized custody
  addresses, future windows/observations and non-chronological or actor-mismatched terminal paths
  before they can be credited or double-counted;
- EOA/Safe custody is never treated as an irreversible burn, controller-return paths and
  controller-withdrawable LP are explicit findings, and a movable Safe plus observed outflow can
  contradict a claimed technical no-exit guarantee;
- declared share-unit adherence and payout cadence are measured separately; incomplete windows keep
  Actual and cadence Unknown while retaining observed lower bounds. An empty observed-deposit set
  now produces `Unknown(NOT_APPLICABLE)` instead of a fabricated zero adherence ratio;
- finalized EVM claim observations now decode chunked ERC-20 Transfer logs into per-log Evidence,
  preserve block time, reject malformed, duplicate, removed, out-of-range and target-lineage
  records, and expose coverage only after the complete requested range returns. Every chunk now
  retains a source query observation, including an empty result, so zero observed transfers never
  stand without Evidence;
- strict Snapshot-pinned custody reads distinguish EOA, unsupported generic contract and
  Safe-compatible multisig. Safe version, singleton, owner count, threshold and nonce are retained;
  no Safe or EOA is treated as irreversible custody;
- deterministic same-Snapshot address-flow summaries report observed inflow/outflow lower bounds,
  counterparties, first/last observations, self-transfers, exact-unit deposits, whole shares from
  exact multiples, non-multiple amounts and share-unit adherence. Actual totals
  remain Unknown until data, history and source coverage are all complete; the summary never labels
  a counterparty as a dividend, burn, controller or entity;
- a composed EVM observer captures finalized custody first, persists it, then performs the potentially
  long Transfer scan against the identical timestamped Snapshot. It writes raw source Evidence before
  one derived terminal root, fails before scanning when custody is unavailable, and keeps composite
  historical custody coverage at zero because one point-in-time authority read is not a historical
  control proof;
- address-scoped history uses separate indexed sender/recipient topics, verifies decoded direction,
  deduplicates identical self-transfers, rejects conflicting overlaps, and gives the SQD response
  body a hard total deadline. Sparse filtered coverage is opt-in; continuous Flap readers remain
  gap-free by default. Terminal roots retain chunk query Evidence plus only relevant target flows;
- migration `011_evm_claim_reports` and the storage repository persist completed observations as
  append-only, content-addressed reports. Writes and reads require one finalized timestamped EVM
  Snapshot across the composite/custody/flow result, canonical token/subject/window identity, a
  matching canonical hash, and terminal plus nested Evidence IDs that are present in the report
  metadata. The latest/exact API and desktop/mobile UI replay PostgreSQL only and never start a
  provider call or chain action;
- exact-block burn model `erc20-burn-conservation-v1.0.0` binds adjacent parent/target finalized
  Snapshots, reads `totalSupply` at both positions and captures every target-block Transfer. Only
  exact `before + mint - burn = after` conservation can emit one-to-one Evidence-linked `BURN`
  actions; contradictions and conserved no-burn blocks emit no action. The read-only API and
  desktop/mobile Claim Audit UI expose the certificate and terminal Evidence;
- BSC range model `erc20-burn-candidate-discovery-v1.0.0` reuses finalized sparse SQD queries for
  both zero-address topic directions, groups non-zero burn-event blocks, retains same-block mint
  context and persists the query/log/terminal Evidence graph. Empty event results do not cover
  silent/custom supply changes, which remain `Unknown(NOT_QUERIED)` in API and responsive UI;
- promotion model `erc20-burn-candidate-promotion-v1.0.0` composes at most five durable event
  segments and refuses to advance a semantic checkpoint until every discovered candidate has an
  exact finalized-block conservation certificate. Its terminal Evidence links all discovery and
  certificate roots; replay revalidates token/range/cursor/Snapshot/Evidence identity from
  PostgreSQL without providers. Partial and corrupt states have no terminal conclusion, while
  silent/custom supply changes remain `Unknown(NOT_QUERIED)`;
- the production range path replayed FFT blocks `113485950-115154970` against finalized range-end
  hash `0x428fae3cf1516692f1a1fa9a46f2ecaeddf627e890466c82ff68367d32427ddb`. Four SQD queries completed
  with no non-zero zero-address event candidates; terminal Evidence is
  `ev_b938c11599c5735884f5e376`, while silent-supply coverage remains Unknown;
- the restart-safe promotion worker replayed that FFT range in two durable segments as scan
  `c2b6c82f-abf6-40e4-a824-4e5b86a07485`. Terminal Evidence
  `ev_a0cfab9b9947fc01565f4018` links both segment roots and the source set retains the actual BSC
  Snapshot provider plus SQD. A second run with unresolvable Provider URLs returned the same
  PostgreSQL terminal result in under two seconds. Zero candidates is scoped event truth only;
  silent-supply detection remains `Unknown(NOT_QUERIED)`;
- all-block model `erc20-supply-continuity-v1.0.0` samples EIP-1898 `totalSupply()` at the parent of
  the requested range and every finalized block inside it. Every configured source must agree on
  exact block identity, lineage, timestamp and supply before cursor advancement; any changed block
  invokes the complete exact-block mint/burn conservation certificate. Durable segments, source-
  operator attestations and the terminal result are Evidence-linked and provider-free on replay;
- the independent Alchemy plus BNB Chain live FFT scan `0ee1a747-0d83-4cad-a5ab-3aaf0e2a3981`
  passed blocks `115188144-115188147`: four transitions, five samples, initial/final atomic supply
  `1000000000000000000000000000`, zero net delta and terminal Evidence
  `ev_5074fef4eb70f879c3e2e48d`. Repeating the identical run with an intentionally invalid Alchemy
  credential returned the same scan and Evidence from PostgreSQL, proving provider-free terminal
  replay. This proves only the named range; the BNB public endpoint returned `missing trie node` on
  an older probe, so complete historical backfill still requires archive-capable independent RPCs;
- seventeen deterministic engine/summary tests plus two Schema Contract tests cover normal 20/40/40 execution,
  bounded policy validation, shortfall, fake burn custody,
  multi-hop burn, path chronology/actor integrity, mixed-asset and duplicate-observation rejection,
  removable LP/controller return, pension Safe/no-exit, incomplete coverage and invalid/unanchored
  inputs, Snapshot time bounds, case identity and no-flow Unknown behavior. Seven
  focused tests cover decoding, exact timestamp fallback, range/lineage/canonicality failures, EOA,
  Safe, generic-contract Unknown behavior, empty-range Evidence, custody-first ordering and
  fail-closed Snapshot requirements;
- a named live BSC scan from `2026-08-02T00:00:00Z` through finalized block `115107095` decoded
  13,591 FFT Transfer logs. The behavioral pension-wallet candidate
  `0x8d50a68b4f9ada119d198d6472eaf0cB6dB302d9` received 123 transfers from 109 senders,
  including 71 exact 1,000,000 FFT transfers and 176,000,010 FFT total, then sent 24,507,000 FFT
  through one dispatcher. This is single-SQD-source chain observation, not official wallet
  attribution or an independently reconciled conclusion;
- the composed observer subsequently passed a live single-source run at finalized Snapshot block
  `115117033`, hash `0x70d237c08125931915cde4a775ca8e4830044003068bbfa17af3f0756e4ad700`.
  At that same Snapshot the candidate was Safe 1.3.0, 4-of-6, nonce 11 and movable; the bounded
  2 August window observed 176,000,010 FFT inflow across 123 transfers and 24,507,000 FFT outflow
  across 10 transfers. Composite `historyCoverage` remains zero and source coverage `0.5`, so
  technical custody and observed flows are accepted while official wallet attribution, Actual
  totals, dividend/action meaning, automated durable capture, full sell/execution RV and terminal
  FFT acceptance remain pending. A post-run indexed-scan optimization passes deterministic tests; its live rerun
  exceeded the current outer execution window and is not claimed as accepted.

### Entity Resolution precision and calibration gates

- a reusable, versioned evaluator now measures controller and coordination precision, Service Hub
  and CoinJoin false merges, independent-axis Brier score and expected calibration error with
  millionth-scale fixed-point probabilities and exact integer gate comparisons;
- the default policy matches the terminal acceptance contract: high-confidence controller
  precision `>= 0.98`, coordination precision `>= 0.95`, Service Hub false merges `<= 0.001`, and
  CoinJoin false merges exactly zero. A real-world calibration corpus additionally requires at
  least 100 Snapshot/Evidence-backed labels per probability axis, Brier `<= 0.15`, and ECE
  `<= 0.05`;
- absent selections, labels or probability denominators return `INSUFFICIENT_DATA`; Unknown cases
  are counted as abstentions and are never coerced to zero or silently excluded from coverage;
- the test-only `entity-structural-golden-v1` corpus covers deterministic control, coordinated but
  independent behavior, independent histories, labeled and path-based Service Hub suppression,
  CoinJoin suppression, and evidence-absent abstention. Its immutable corpus hash is
  `3ca725adc8414280f381426a88c86e659d3ef7f5ec1fb1712621cc28c1f77e63`;
- `npm run eval:entity` passes all four structural gates: controller and coordination precision are
  `1`, Service Hub and CoinJoin false-merge rates are `0`, six of seven cases have complete
  probability outputs, and the unsupported case remains an explicit abstention;
- structural Brier/ECE values are emitted only as `DIAGNOSTIC_ONLY`. They do not satisfy the real
  calibration checkbox; a source-backed real corpus and temporal feature graph remain pending.

### Flap migrated DEX market and buy scenarios

- the production adapter now composes Flap inspection with PancakeSwap V2 pool/factory/router reads
  at one finalized BSC Snapshot. It verifies bytecode, pair/factory/router identity, token ordering,
  decimals and positive reserves before deriving a price or quote;
- one to eight quote-asset inputs use exact integer arithmetic with the documented 25 bps V2 fee and
  are automatically checked against the official Router `getAmountsOut` result under the versioned
  10 bps deterministic error budget. Gross output, Flap-configured buy-tax estimate and unobserved
  actual execution-net output remain separate Knowledge values;
- the API and responsive UI expose reserve spot, raw reserves, Router gross output, configured-tax
  estimate, average price, modeled post-buy spot/impact, validation status and complete Evidence
  drilldown. Primary-market tokens do not enter the DEX path, and zero reserve cannot become a fake
  zero price;
- a named live FFT run captured finalized BSC block `115131838`, hash
  `0x04d1d1986cc969ac95e1acd6f3bae677a7934fff10758a628207e5e0c1ae22ef`, at
  `2026-08-10T13:51:07.000Z`. The verified pool was
  `0xe374af9818c4359374996f86a734fc39eb04d949` against BSC USDT, with
  `74,891,827.839354821963347306` FFT and `30,143.481700747512234533` USDT reserves and a
  reserve spot of `0.000402493604047242` USDT/FFT;
- for 100, 1,000 and 10,000 USDT, the Router and deterministic gross FFT outputs matched exactly
  (`0` bps error): `247012.617596385988641107`, `2398915.968277365381597299`, and
  `18620993.39326804405720477`. Applying the Flap-reported 300 bps buy-tax configuration produces
  estimates of `239602.239068494408981873`, `2326948.48922904442014938`, and
  `18062363.591470002735488626` FFT, not observed execution receipts;
- terminal Evidence `ev_c1d282e77439383f0b8495b2` closes a 21-node drilldown. Source coverage is
  `0.5` because the run used one live chain operator plus official documentation; actual
  execution-net remains `Unknown(NOT_QUERIED)`. Pension-wallet transfer is explicitly treated as
  movable custody rather than burn, so no extra price adjustment is claimed. Pinned-fork execution,
  transfer-tax/swapback behavior, sell capacity, gas, independent-provider reconciliation and
  terminal FFT acceptance remain pending.

### Flap migrated DEX exit and realizable-value scenarios

- the same market certificate now supports one to eight token-to-quote exit sizes. Each point keeps
  marginal-price nominal value, official Router gross output, configured sell-tax pool estimate and
  unobserved execution settlement as four distinct fields;
- average configured-tax exit price, modeled post-sell spot, price impact and shared quote-reserve
  consumption are explicit. A Router/formula error above 10 bps withholds configured-tax estimates,
  while actual settlement and execution capacity remain Unknown until a pinned fork tests max-sell,
  blacklist/whitelist, dynamic tax, exemptions, swapback, gas and reverts;
- desktop/mobile UI and API tests cover the complete distinction, Evidence drilldown, provider
  unavailability, 100% configured tax and an intentionally conflicting Router quote;
- a named live FFT run captured finalized BSC block `115137197`, hash
  `0x600b38f896ddc58ceac21169a1c285aef495bce92bbbb67b80249a86c672db75`, at
  `2026-08-10T14:31:19.000Z`. The pool held `74,586,827.793161266597497691` FFT and
  `30,267.053563947710181207` USDT; reserve spot was `0.000405796230507108` USDT/FFT and
  Flap inspection reported a configured 300 bps sell tax;
- for 1,000,000 / 5,000,000 / 10,000,000 FFT, nominal spot values were
  `405.796230507108956541` / `2028.981152535544782706` / `4057.962305071089565413` USDT.
  Router gross outputs were `399.439762336147983189` / `1897.055669041575774379` /
  `3570.332704241699971628` USDT. Configured-tax pool estimates were
  `387.610030249454467789` / `1843.610572166868587816` / `3475.522007411636832561` USDT;
- all three Router/model gross checks matched at atomic precision (`0` bps error). Terminal Evidence
  `ev_9627b639672d93ae97fef938` closes 23 nodes. Data/source/history/simulation coverage is
  `0.9/0.5/0/0.5`; confidence is `0.94`. Actual settlement and executable capacity remain
  `Unknown(NOT_QUERIED)`, so these values are not presented as completed trades or terminal RV.

### Independent Flap/Pancake V2 market and RV reconciliation

- `source-operator-registry-v1` records official hostname/operator attestations for Alchemy BSC and
  BNB Chain. The registry root, each matched official document and the independence decision are
  immutable Evidence; an unregistered hostname remains Unknown and two BNB Chain endpoints remain
  `SAME_OPERATOR`, never a false independent pass;
- the API selects one common finalized BSC block through anchor reconciliation, then reruns the
  complete Flap/Pancake V2 market plus all requested buy and exit points through every source.
  Identity, bytecode-derived configuration, assets, decimals, reserves, spot, fees and taxes require
  zero mismatch. Independent Router quote/RV observations pass at `<=0.50%`, warn through `1.00%`
  and fail above the typed budget;
- a `PASS` requires both a passing discrepancy audit and at least two officially documented
  operators. Anchor disagreement returns HTTP 409 before market reads; insufficient adapters return
  HTTP 503; same-operator or unresolved ownership produces `INCONCLUSIVE` with coverage `0.5`;
- API integration tests cover verified independence, same-operator endpoints, fully unregistered
  operators with registry-root drilldown, exact reserve conflict and anchor disagreement. The
  responsive analyst panel passed Chromium desktop and Pixel 7 E2E with no page overflow;
- a live read-only FFT run at finalized BSC block `115179695`, hash
  `0x7054294e11db4811df556d2c85835420181b670cf8049e024a161ea67905af89`, compared
  `bnb-mainnet.g.alchemy.com` (`alchemy`) with `bsc-dataseed.bnbchain.org` (`bnb-chain`). All `37/37`
  checks passed with zero warnings, failures, inconclusive checks or coverage gaps. The pool held
  `73,660,551.823833706703241137` FFT and `30,650.325089732606316067` USDT; reserve spot was
  `0.00041610230076793` USDT/FFT;
- at that Snapshot, 100 / 1,000 / 10,000 USDT produced Router gross outputs of
  `238947.060226229359049905` / `2321688.780696396579854181` /
  `18086353.840118338881877371` FFT. The configured 300 bps tax estimates were
  `231778.648419442478278407` / `2252038.117275504682458555` /
  `17543763.224914788715421049` FFT. These are modeled pool outputs, not observed wallet receipts;
- 1,000,000 / 5,000,000 / 10,000,000 FFT had nominal spot values of
  `416.102300767930795232` / `2080.511503839653976161` / `4161.023007679307952322` USDT,
  Router gross outputs of `409.516435670612827086` / `1943.703535434754583708` /
  `3655.58648329449500842` USDT, and configured-tax estimates of
  `397.390227530496510151` / `1888.986155432972203033` / `3558.651829953946931547` USDT;
- the acceptance run was repeated with PostgreSQL Evidence persistence at block `115180163`, hash
  `0xb834c88b35c1a92dfe5d9c69af079825aa78832b048d591af96bc5d429df0279`. It again passed
  `37/37`; terminal Evidence `ev_fde8795ff3b8bf6671535f21`, independence Evidence
  `ev_e540983d3bd41ef0a3370c8b` and registry Evidence `ev_b8f129251ea6679da7b83f1b` formed a
  91-node drilldown that replayed after stopping the provider-configured API and starting a new
  provider-free process against PostgreSQL;
- execution-net buy receipt, execution-net sell settlement, gas, reverts, dynamic token tax,
  max-sell and executable capacity remain `Unknown(NOT_QUERIED)`. This closes the scoped independent
  market/RV source gate, not the full FFT terminal acceptance.

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

- durable PostgreSQL repositories for subjects, analysis results, entities, generic temporal
  control-right projections beyond the immutable EVM surface report, launches, scenarios, labels,
  and analyst overrides;
- live/unfinalized policy plus forced real-provider rollback/replay drills;
- immutable real-chain fixture corpus and independently operated reconciliation beyond the scoped
  BSC market/RV path;
- Snapshot/Evidence-backed real-world entity corpus with at least 100 labels per axis for Brier/ECE
  calibration;
- independent-operator validation and archive-grade real-chain acceptance for the repeated Flap
  finalized-head scheduler;
- complete deployment-to-head supply-continuity backfill plus continuous finalized-head scheduling
  across independently operated archive-capable providers;
- complete OpenAPI request/response schemas beyond the current endpoint metadata.

## Not implemented

### Ingestion and persistence

- general multi-chain continuous scheduling, unfinalized handling, and automatic reorg rollback/replay;
- transaction-level chain normalization, NATS events, and Temporal workflows;
- graph projection and temporal queries;
- cache invalidation and distributed quota coordination.

### EVM terminal scope

- semantic receipt/event/call/state-change normalization and archive-state reconstruction;
- ERC-20 semantics beyond Transfer, ERC-721/1155, custom/UUPS proxy authorization, owner/role
  history, recursive implementation controllers, general tax-token and DEX decoders;
- Ethereum/BSC archive-provider reconciliation beyond the bounded live supply slice and a complete
  finalized-block/history policy;
- Moonshot, Four.meme, additional Pancake routes and other versioned platform adapters.

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
- complete launch lifecycle, migration history and multi-market reconstruction beyond the initial
  Flap/Pancake V2 point-in-time slice;
- multi-route sell RV beyond the initial Pancake V2 route, with fork-observed taxes, gas, capacity,
  execution failures and historical calibration;
- reviewed-draft promotion, continuous candidate-capture scheduling beyond the restart-safe worker,
  complete historical supply coverage, independent claim-flow and non-market reconciliation, complete Claim
  Audit, timeline generation, comparison/export, collaboration and analyst overrides;
- production authorization, tenancy, audit logs, retention, backup and privacy controls.

## Pending real-chain validation

| Validation             | Requirement                                                                                                               | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVM current state      | Named Ethereum and BSC snapshot-pinned current-state reads                                                                | Parent-linked finalized Alchemy/BSC reads passed; BSC endpoint agreement passed, operator independence/archive pending                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Bitcoin current state  | Named immutable fixtures reconciled against self-hosted Core and Esplora                                                  | Height/hash/previous-hash public Esplora read passed; Core reconciliation pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Solana current state   | Named immutable fixtures reconciled against dedicated RPC/archive history                                                 | Finalized blockhash/parent-slot and account smoke passed; second continuity probe unavailable, archive pending                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Entity baseline        | Labeled independent, coordinated, service-hub, and CoinJoin fixtures                                                      | Test-only structural golden passes exact Precision/False-Merge gates; Snapshot/Evidence-backed real-world labels and calibration remain pending                                                                                                                                                                                                                                                                                                                                                                                                             |
| EVM control rights     | Independent standard/source reads plus effective custom-role/history/controller reconstruction                            | Alchemy and BNB Chain agreed on FFT proxy and implementation logic at one finalized Snapshot; Sourcify V2 exact-matched `FlapTaxTokenV3`, and the UI separates declared owner/migration functions from current rights. Effective custom token controllers, role/event history, authorization reachability and non-EVM surfaces remain pending                                                                                                                                                                                                               |
| Launchpad decoders     | Versioned deployments and named launch/migration transactions per platform                                                | A named non-FFT Flap creation/configuration transaction and the named FFT migrated Pancake V2 point-in-time market passed; complete FFT migration history, forced real reorg and other platforms remain pending                                                                                                                                                                                                                                                                                                                                             |
| Flap FFT terminal run  | BSC token `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`: mechanism, entity, market, RV, Evidence and automatic error audit | Transfer/Safe, buy/exit, durable burn promotion, 37-check market/RV reconciliation, four-transition supply continuity, and scoped EVM proxy/source control passed. FFT is an ERC-1167 proxy with exact-verified `FlapTaxTokenV3` logic and zero-valued ERC-173 owner; declared owner/migration functions are not treated as current rights, and 17 authorization/control domains remain Unknown. Official wallet attribution, effective authorization/history, full-history supply, fork settlement and entity calibration still gate a terminal conclusion |
| RV                     | Historic pool snapshots and executable quote reconciliation                                                               | Deterministic kernels, Portal preview, named FFT buy/exit Router/model checks and two-operator same-block reconciliation pass; actual fork settlement, additional routes, gas/executable capacity and history remain pending                                                                                                                                                                                                                                                                                                                                |
| Provider resilience    | timeout, quota, malformed data, fork/reorg, and cross-provider disagreement                                               | Deterministic disagreement/rollback tests, live common-position BSC continuity and scoped Alchemy/BNB market reconciliation passed; forced real reorg/outage and archive-grade acceptance remain pending                                                                                                                                                                                                                                                                                                                                                    |
| Finalized block ingest | Replayable EVM/BTC/Solana ranges across object, Evidence, fact and checkpoint stores                                      | Four SQD datasets passed; archive reconciliation pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Raw transaction ingest | Named immutable EVM/BTC/Solana transactions persist and replay across all stores                                          | Ethereum 1, BSC 7, Bitcoin 2, Solana 1 passed; semantic decoding pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Raw ledger records     | EVM execution/state, BTC I/O, and Solana execution/balance records replay across stores                                   | Ethereum/BSC traces+diffs, BTC I/O, and all named Solana tables passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Public BSC, Bitcoin, and Solana endpoints in `.env.example` are development fallbacks. Rate-limited responses do not count
as chain-validation failures, and a successful health probe alone does not validate semantic
correctness. Exact local smoke observations and limitations are in
[the validation record](docs/testing/VALIDATION_RECORD.md).

## Test and verification record

| Check                          | Latest result                                 | Scope                                                                                                                                  |
| ------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Reproducible install/build     | Pass                                          | locked npm install in production container; all packages/API/web                                                                       |
| Unit tests                     | 425 pass                                      | 62 files across schemas, adapters, claim auditing, data quality, ingestion, storage, workers and API runtime                           |
| Integration tests              | 60 environment-free plus 23 real-storage pass | 83 total with PostgreSQL, ClickHouse and object store; immutable control-surface, supply replay and multi-source market/RV guards pass |
| Model evaluation tests         | 1 pass                                        | structural Entity controller/coordination precision plus Service Hub/CoinJoin false-merge gate                                         |
| Restart regression             | Pass                                          | same-anchor recapture persists across repository/API restart without Snapshot collision                                                |
| Coverage gate                  | Pass                                          | current local: 82.85% statements, 76.97% branches, 91.99% functions, 83.99% lines on 485 tests; 23 opt-in durable tests skipped        |
| Chromium E2E                   | 24 pass                                       | desktop and Pixel 7 include EVM Control Rights, supply continuity, multi-source market/RV, burn, Claim Declaration/Report and Unknown  |
| Formatting / ESLint / types    | Pass                                          | full repository                                                                                                                        |
| Dependency vulnerability audit | Pass                                          | 0 vulnerabilities across the complete npm dependency graph                                                                             |
| Dependency license allowlist   | Pass                                          | production dependency graph                                                                                                            |
| CycloneDX SBOM                 | Pass                                          | npm dependency graph                                                                                                                   |
| Compose model                  | Pass                                          | rendered default topology                                                                                                              |
| Docker image build/start       | Pass                                          | API, web and all ingest/semantic worker production targets built; rebuilt API/Web are healthy and read-only                            |
| Database bootstrap             | Pass                                          | fresh bootstrap passed; current persistent Compose volume was upgraded non-destructively through migration 013                         |
| Runtime/browser smoke          | Pass                                          | rebuilt keyless API/Web healthy; immutable FFT control report/result hash/terminal Evidence replay passed                              |
| Public chain smoke             | Pass for bounded current/raw-ledger scope     | four anchors/pipelines plus scoped Alchemy/BNB market reconciliation passed; archive/forced-reorg scope pending                        |
| Remote CI                      | Pass on EVM-control commit `6f0efcf`          | CI/CodeQL green; full matrix, structural model gate, 24 Chromium flows and all six production targets                                  |

The record is updated only after commands complete. Detailed commands and acceptance criteria are in
[Testing](docs/testing/TESTING.md) and [Final acceptance](docs/testing/FINAL_ACCEPTANCE.md).
The registered FFT/Flap error budgets and automatic discrepancy rules are in
[Flap FFT terminal acceptance](docs/testing/FLAP_FFT_ACCEPTANCE.md).
