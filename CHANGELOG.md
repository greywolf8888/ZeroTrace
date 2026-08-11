# Changelog

All notable changes to ZeroTrace will be documented here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once releases begin.

## [Unreleased]

### Added

- generic `action-semantics-v0.1.0` primitive classification for transfers, swaps, burns, mints,
  liquidity changes, LP custody, distributions and contract calls, with proof-shape gates,
  explicit `APPLIED` / `NOT_APPLIED` / `UNKNOWN` execution state, terminal Evidence and no automatic
  promotional-purpose inference;
- generic `READ_ONLY_CAPTURE` schedule/run contracts and `capture-scheduler-v0.1.0`, including
  deterministic content identity, anchored skip-missed intervals, bounded retries, typed handler
  dispatch and strict successful-result Snapshot/Evidence/coverage/freshness/source/model/confidence
  requirements;
- PostgreSQL migration `024` and repository support for exclusive worker leases, expired-lease
  recovery, append-only attempt outcomes, one-shot terminal state and completion guarded by one
  exact Snapshot, complete terminal-Evidence reachability and exact non-derived source sets;
- production Docker dependency-layer coverage for the Action Semantics and capture-scheduler
  workspaces, preventing stale install-cache behavior as those packages evolve;

- immutable `label-intelligence-v0.1.0` observation-set reports with ledger-scoped Subject identity,
  deterministic/curated/commercial/community/inference review priority, future/active/stale/expired
  states, preserved label/actor/determinism conflicts, conservative Service Hub suppression,
  PostgreSQL migration `023`, materialize/latest/exact API, durable search projection, responsive
  desktop/mobile UI, terminal Evidence and hard no-label/risk/cross-chain Entity merge rules;
- durable `global-intelligence-search-v0.1.0` exact projection across registered labels and current
  immutable report families, with PostgreSQL migration `022`, terminal Evidence, explicit
  Snapshot/confidence/freshness/Subject Registry knowledge, partial storage degradation, responsive
  desktop/mobile UI and no on-chain-nonexistence inference from an empty result;
- immutable `entity-investigation-graph-timeline-v0.1.0` reports over two to 100 durable graph
  observations, with deterministic revisions/position advances, explicit Snapshot continuity,
  typed request-scope additions/omissions, PostgreSQL source/Evidence/immutability enforcement,
  provider-free materialize/latest/exact API replay, responsive UI and hard no-relationship-end /
  no-membership-mutation boundaries;
- bounded `entity-investigation-graph-v0.1.0` materialization from exact-Snapshot durable Entity
  timelines, with strict controller/coordination separation, retained negative/service/Unknown
  observations, immutable PostgreSQL report and Evidence guards, optional transactional Apache AGE
  projection, bounded traversal, API replay and responsive Cytoscape Evidence drilldown;
- bounded, immutable `entity-timeline-v0.1.0` pairwise relationship timelines with deterministic
  same-position revisions and position advances, explicit observation gaps, Knowledge-state-safe
  probability deltas, PostgreSQL report/Evidence lineage guards, provider-free API replay, and
  responsive desktop/mobile review without automatic Entity membership changes;
- immutable content-addressed Entity relationship hypothesis reports with canonical pair and
  feature ordering, grounded Service Hub suppression, fixed model provenance, exact
  Snapshot/Evidence/derivation constraints, PostgreSQL update/delete guards, provider-free
  latest/exact API replay, a first-class responsive Entity Intelligence workspace and a hard
  `automaticOwnershipMergeAllowed=false` boundary;
- durable pension-candidate-to-market composition for migrated Flap/Pancake V2 tokens, with
  exact-integer multi-size share economics, same-Snapshot ordering, three-parent Evidence lineage,
  append-only content-addressed PostgreSQL Scenario Reports, exact/latest provider-free API/UI
  replay, explicit custody-not-burn treatment, and Unknown execution settlement;
- finalized EVM/BSC pension-wallet behavioral candidate discovery with caller-visible policy,
  exact-unit and unique-depositor signals, immutable PostgreSQL report replay, responsive Claim
  Audit UI, and a full-range FFT validation that keeps role, exit restrictions, and dividend
  execution explicitly Unknown;
- immutable content-addressed Solana transaction semantic reports with PostgreSQL-enforced
  signature/Snapshot/Evidence lineage, idempotent writes, exact/latest provider-free replay,
  explicit provider-failure fallback provenance, responsive UI and real mainnet restart replay;
- official Codama-generated System/SPL Token/Token-2022 instruction identification plus strict core
  SOL transfer and token transfer/mint/burn asset-flow decoding, recorded owner mapping,
  failed-transaction application state, per-flow Evidence, zero-tolerance classic token
  reconciliation, and explicit Partial/Unknown boundaries for Token-2022 fees, hooks and unmodeled
  effects;
- strict Solana legacy/v0 transaction semantics with Address Lookup Table account resolution,
  fee-payer/signer/writable flags, outer and inner CPI instruction paths, exact lamport and recorded
  SPL token deltas, failed-execution preservation, per-instruction Evidence, responsive UI and a
  live public-mainnet production-path replay that retains an absent pre-token record as Unknown;
- Bitcoin transaction-level entity screening with exact fee reconciliation, common-input/address
  reuse/equal-output/fanout features, bounded script-type change candidates, pinned BIP78 Evidence,
  CoinJoin/Payjoin/service suppression, a hard no-automatic-merge policy, responsive UI and public
  Esplora validation; complete clustering and attribution remain out of scope for this slice;
- stable-tip Bitcoin address UTXO reconciliation and observable P2PKH/P2SH/SegWit/Taproot
  spend-condition analysis, including verified revealed-script commitments, legacy multisig,
  CLTV/CSV, transaction sequence signaling, Evidence-linked API results and responsive UI; effective
  RBF/CPFP policy, hidden branches and controller identity remain typed Unknown;
- finalized atomic Solana control-surface inspection for classic SPL Token mint/account/multisig,
  Token-2022 extensions and the upgradeable Program/ProgramData loader, with official generated
  decoders, a 38-domain Unknown-preserving coverage matrix, nested Evidence, immutable PostgreSQL
  reports, provider-free API replay, responsive UI and scoped public-mainnet validation;
- finalized multi-source EVM control-surface inspection for exact ERC-1167 runtime bytecode,
  EIP-1967 implementation/admin/beacon slots, ERC-173 owner, registered Safe owners/threshold,
  recursive logic bytecode and Sourcify V2 exact-source provenance, with ABI mutation declarations
  separated from effective rights, a complete Unknown-preserving coverage matrix, immutable
  PostgreSQL reports, provider-free API replay, responsive UI and scoped FFT acceptance;
- bounded restart-safe BSC ERC-20 all-block `totalSupply` continuity scanning with canonical
  EIP-1898 reads, exact multi-source state reconciliation, complete changed-block mint/burn
  certificates, official operator-independence attestations, durable Evidence/checkpoints,
  provider-free API/UI replay, Compose profile and live FFT interval validation;
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
- versioned official BSC source-operator attestations plus complete common-finalized-block
  Flap/Pancake V2 market, buy and exit reconciliation, with exact-state and 0.50% independent
  quote/RV discrepancy budgets, strict inconclusive states, API, responsive UI and browser coverage;
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
- exact fixed-point Entity Resolution evaluation with versioned controller/coordination precision,
  Service Hub/CoinJoin false-merge, Brier/ECE and minimum-corpus gates, plus a test-only structural
  golden corpus and standalone CI command;
- fail-closed Claim Audit v1.1 input isolation for single-asset batches, normalized custody and
  action identity, Snapshot time bounds, and chronological actor-bound terminal paths;
- deterministic public claim-declaration compilation for tax receiver, community fund, buyback
  burn, buyback liquidity, pension-vault and weekly dividend wording, with Analyst Evidence,
  explicit Unknown fields and mandatory human review;
- read-only claim-declaration parsing API and responsive Claim Audit workspace, including local
  dev/preview CORS coverage and explicit `403 CORS_ORIGIN_DENIED` diagnostics;
- exact finalized-block ERC-20 burn conservation with parent/target `totalSupply`, complete
  target-block mint/burn logs, one-to-one Evidence-linked actions, contradiction/no-action states,
  read-only API composition and responsive Claim Audit review;
- finalized BSC SQD zero-address Transfer candidate discovery across bounded long ranges, with
  sparse event-query Evidence, exact-block promotion targets, responsive review and explicit
  `Unknown(NOT_QUERIED)` for silent/custom supply changes;
- restart-safe BSC burn-candidate promotion across bounded durable segments, with exact-block
  supply-conservation certificates before cursor advancement, strict checkpoint replay validation,
  read-only worker/Compose entrypoints, and PostgreSQL-only API/UI replay by scan ID;
- Fastify API with OpenAPI, health, capability truth, metrics, and analysis endpoints;
- Snapshot/Evidence-backed ledger query API with pending, mempool, null, and unavailable observations
  kept distinct from confirmed facts;
- responsive React analyst workspace with typed ledger results and explicit Unknown states;
- version-pinned, fixed-block Flap BSC Portal inspection with V8Safe/V6/V5 decoding, bytecode provenance,
  negative Evidence for non-contract subjects, forward-compatible enum Unknown states, and a
  read-only launch-mechanism UI;
- fixed-block Flap `previewSell` realizable-value observations with source-linked raw/derived
  Evidence, explicit blocked/unsupported states, and an atomic-unit analyst UI;
- same-Snapshot migrated-Flap Pancake V2 market verification and multi-size buy scenarios with
  official Router cross-checks, automatic 0.10% deterministic error checks, configured-tax versus
  actual-execution separation, Evidence drilldown, and responsive UI;
- multi-size Pancake V2 exit scenarios that separate nominal spot value, Router gross output,
  configured sell-tax estimates and unqueried execution settlement, with modeled average exit,
  price impact, quote-reserve consumption, automatic checks and Evidence-backed UI;
- exact-receipt Flap `TokenCreated`, configuration, staging and migration event decoding with
  source-tagged official defaults, future-enum Unknown states, replay Evidence, API, and responsive UI;
- bounded, chunked Flap Portal event-log discovery with strict log validation, exact receipt replay,
  requested-range versus lifetime coverage, bounded negative Evidence, API, and responsive UI;
- finalized SQD BSC address/topic log discovery as the preferred Flap range source, with parent
  continuity, source-head and filter validation plus field-for-field BSC RPC receipt replay;
- sparse finalized SQD EVM contract-creation discovery with dataset/source-head bounds and strict
  trace validation, plus bounded Flap origin proof joined to the exact BSC receipt, `TokenCreated`
  event, Snapshot, Evidence graph, capability status, and API;
- explicit creation-range completion metadata and multi-response/multi-chunk origin scanning, with
  duplicate, incomplete continuation, chunk-count and synchronous API range limits that fail closed;
- durable generic PostgreSQL semantic-scan checkpoints with immutable identity, canonical state
  hashes, cumulative Evidence IDs, bounded contiguous cursor advancement, idempotent restart, and
  append-preserving terminal history;
- restart-safe Flap origin execution that persists each exact completed chunk, resumes after a safe
  provider/storage failure, atomically stores the terminal Evidence result, fails readiness when the
  checkpoint schema is unavailable, and performs no provider call or Evidence write on terminal replay;
- read-only host and Compose Flap origin worker entrypoints for wide bounded scans, with durable
  storage preflight, exact-identity resume, credential-free summaries, and safe failure codes;
- immutable PostgreSQL Flap history segments with bounded scan-cursor alignment, canonical
  provenance arrays, content hashes, idempotent replay, pagination, health, and mutation guards;
- restart-safe cross-range Flap history projection with immutable segment-before-cursor ordering,
  cursor-adjacent pending-segment adoption, strict identity revalidation, terminal Evidence, and
  provider-free terminal replay;
- a read-only Flap event-history worker with storage preflight, safe resumable configuration and a
  credential-free scan ID, plus an opt-in Compose service;
- token- and scan-bound paginated projection replay through the API and analyst UI, with strict
  stored Snapshot/Evidence/result validation and no provider call on the replay path;
- exact point-in-time Flap lifetime materialization that composes official SQD dataset-start origin
  proof with immutable origin-to-finalized-target history, preserves absent origin as Unknown,
  rejects child Snapshot/coverage conflicts, and resumes advance-before-finish without repeating
  child work;
- a read-only `flap:lifetime` host/Compose worker plus token-bound provider-free API and analyst UI
  replay of composite progress, origin/history child scan IDs and terminal Evidence;
- typed incremental Flap lifetime extensions that scan only the predecessor-to-target delta and
  require a Known Evidence-backed continuity proof;
- immutable PostgreSQL `flap_lifetime_heads` INITIAL/EXTENSION chains with completed-scan,
  predecessor, sequence, Snapshot/result hash, terminal Evidence and mutation guards;
- append-only Flap lifetime-head invalidations with exact active-suffix validation, surviving
  predecessor selection, immutable reorg Evidence, canonical-lineage reads and safe branch replay;
- a continuous read-only Flap lifetime-head worker with multi-RPC common-position reconciliation,
  direct/historical predecessor verification, retryable deferral, and finalized-reorg detection,
  Compose/host entrypoints, and credential-free cycle summaries;
- an all-source Flap rollback resolver that verifies the active lineage newest-to-oldest, refuses
  unavailable or disagreeing history, appends one Evidence-backed invalidation, and immediately
  re-enters safe materialization/extension from the surviving ancestor;
- provider-free latest accepted Flap lifetime-head API and desktop/mobile UI replay with sequence,
  continuity, target and terminal Evidence visibility;
- Evidence-grounded same-Snapshot discrepancy audits with exact-state/conservation checks,
  exact-decimal error budgets, warning bands, coverage gates, derived Evidence, and Unknown values
  excluded from numeric denominators;
- deterministic claim-allocation and terminal-action audits with versioned error budgets, movable
  custody, multi-hop action, share-unit, cadence, and incomplete-coverage semantics;
- finalized, range-bounded EVM ERC-20 Transfer Evidence plus strict Snapshot-pinned
  EOA/Safe/generic-contract custody observations, with no signing or chain-write path;
- deterministic Snapshot-bounded claim-address flow summaries with observed-versus-actual totals,
  counterparty ranking, self-transfer isolation, share-unit checks, and Unknown instead of a fake
  zero ratio when no deposits are observed;
- custody-first same-Snapshot EVM claim-address orchestration with canonical source/derived Evidence,
  plus explicit provider-observation Evidence for every scanned Transfer range including empty results;
- address-indexed EVM claim scans with strict cross-direction deduplication, bounded terminal Evidence
  roots, hard SQD response-body deadlines and explicit sparse-filter coverage that leaves continuous
  all-block Flap scanning unchanged by default;
- richer pension-share observations for exact-unit deposits, exact-multiple whole shares and
  non-multiple amounts without promoting observed values to coverage-complete Actual values;
- content-addressed, append-only PostgreSQL EVM Claim Reports with same-Snapshot/nested-Evidence
  validation and provider-free latest/exact API plus desktop/mobile UI replay;
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

### Changed

- Dependabot ecosystem metadata remains registered, but automatic update PR branches are disabled
  under the single-main policy; dependency alerts and CI audit findings are reviewed and delivered
  through the one short-lived protected batch branch.

### Fixed

- bounded ClickHouse `FINAL` query and merge threads for local/CI Raw Fact replay so small durable
  range checks do not exhaust the default container memory budget on high-core hosts;
- readiness now remains HTTP-ready for provider-free report replay when optional upstream providers
  are unavailable, while retaining a `DEGRADED` payload and continuing to fail closed when durable
  request-serving storage is down.

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
  are persisted and strict raw ledger queries are exposed; Flap BSC current Portal state and a
  caller-supplied event transaction, restart-safe bounded event-range projections with worker/API/UI
  replay, bounded creation-origin proofs, one-Snapshot lifetime materialization, and incremental
  accepted finalized heads and initial migrated Pancake V2 point-in-time buy/exit-size markets are
  decoded, but complete lifecycle reconstruction, other launchpads, multi-route/fork sell execution,
  transfer-tax settlement, gas and executable capacity are not implemented;
- common-position endpoint reconciliation, Flap finalized-head scheduling and deterministic
  rollback/replay are implemented, but forced real-reorg and independently operated provider
  acceptance are not;
- entity resolution is an uncalibrated baseline;
- Ethereum, BSC, Bitcoin, and Solana current-state smoke checks pass; archive history, forced
  real-provider failover, load, reorg, provider reconciliation, and production deployment validation
  remain open.

[Unreleased]: https://github.com/greywolf8888/ZeroTrace/commits/main
