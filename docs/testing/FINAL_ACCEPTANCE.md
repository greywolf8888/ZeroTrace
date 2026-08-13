# Final Acceptance Checklist

This checklist tracks the terminal-product Definition of Done. It is intentionally not complete.
Named assets are reference cases for the shared architecture. They never define a standalone
roadmap phase, shared runtime defaults, protocol constants or token-specific inference behavior.

## Token History Discovery Phase 1 — 2026-08-14

- [x] Phase 1 schemas, Evidence/Snapshot provenance, bounded SQD Transfer query, checkpointed
      ingestion callback, deployment-origin boundary, exact-RPC transaction/receipt boundary,
      Action Semantics binding, immutable PostgreSQL report, paginated replay, capability registry,
      worker profile, and public endpoint configuration are implemented and covered by tests
- [x] Formatting, ESLint, TypeScript, 610 unit tests, serially replayed enabled integration/evaluation tests,
      package/worker builds, license allowlist, zero high-severity production audit findings, and
      Compose model validation passed
- [x] Public SQD, BSC, Solana, and Blockstream Esplora read-only reachability probes passed
- [x] Bounded public BSC FFT smoke through the actual Token History Discovery composition passed:
      12 finalized observations, 5 exact-RPC/Action-Semantics bindings, `1/1/1` coverage,
      terminal requested-range checkpoint, and provider-free same-hash replay in memory-only stores
- [ ] Fresh PostgreSQL/ClickHouse/MinIO token-history worker run with durable report replay
- [ ] Ethereum exact-RPC historical binding and archive-scale range acceptance
- [ ] Independent provider reconciliation, full backfill, live monitoring, alerts, export,
      calibration, remote CI/CodeQL, and production migration approval

This Phase 1 checkpoint remains `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION`. A public endpoint
health response is not a semantic history result, and an unset Ethereum runtime credential is not
treated as a numeric zero or as a successful exact-RPC path.

## Funding and Settlement Phase 2 local gate — 2026-08-14

- [x] Exact finalized EVM transaction/receipt decoder, native/ERC-20 observations, bounded graph
      engine, result hashes, replay, coverage scope, raw drilldown, and service boundary
      suppressions compile and pass deterministic tests (`7/7` focused tests)
- [x] Immutable PostgreSQL migration `033_funding_settlement_reports`, repository validation,
      latest/exact provider-free API reads, runtime health/close wiring, and storage tests (`3/3`)
- [x] API integration coverage for durable replay/unconfigured storage and full existing API file
      replay (`83/83`)
- [x] Control Campaign UI Funding/Settlement panel shows `NOT_QUERIED`, partial coverage, exact
      paths, hashes, drilldown and suppression boundaries; desktop/mobile targeted E2E `2/2`
- [x] Real BSC FFT bounded smoke produced a `PARTIAL` transaction-local report and same-hash replay;
      historical `eth_getCode` `missing trie node` stayed explicit and did not fall back to current
      code
- [x] Real Ethereum WETH one-block bounded smoke produced a `PARTIAL` transaction-local report and
      same-hash replay; exact transaction/receipt placement succeeded while origin expansion stayed
      `NOT_QUERIED`
- [ ] Fresh PostgreSQL/ClickHouse/MinIO capture and durable replay of these reports
- [ ] Range-complete historical funding/settlement coverage, official service registry attribution,
      multi-provider reconciliation, calibration, backfill, monitoring, alerts, export, remote CI,
      and production approval

This phase remains `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION`. A transaction-local edge is not a
control or ownership conclusion, and `historyCoverage=0` is a declared measured scope boundary,
not an assertion that no historical funding or settlement exists.

## Current local gate (2026-08-14)

- [x] `npm run format:check`, full ESLint, TypeScript typecheck, production build,
      production license allowlist, `npm audit --audit-level=high` (0 vulnerabilities), and SBOM
      generation
- [x] `npm run test:unit`: 620/620 tests across 111 files
- [x] `npm run test:integration`: 83 pass; 38 explicitly skipped because optional stores/providers
      were not enabled in this host run (these are not counted as failures)
- [x] `npm run test:evals`: 1/1 structural Entity evaluation
- [x] Serial Playwright E2E: 38/38 across Chromium desktop and Pixel 7; Flap long-value mobile
      layout regression passed in both projects (`2/2`)
- [x] Targeted Control Campaign Timeline/Evidence Line E2E: 2/2 (Chromium desktop and Pixel 7)
- [x] `docker compose config --quiet`
- [ ] `npm run test:coverage`: all 703 enabled tests completed, but the configured global
      thresholds were not met locally (Statements 77.27%, Branches 70.78%, Lines 78.56%); the
      report includes existing untested worker/storage boundaries and is not relabeled as pass
- [ ] Isolated empty PostgreSQL/ClickHouse migration bootstrap for `031_control_campaign_reports`,
      `033_funding_settlement_reports`, and `002_control_campaign_flow`: unavailable because the
      local Docker Desktop Linux engine is not running (`dockerDesktopLinuxEngine` named pipe was
      absent)
- [ ] Remote protected-branch CI/CodeQL for the current uncommitted Phase 2 changes; earlier PR #20
      runs are historical evidence for their recorded heads only

This local gate does not promote ZeroTrace to production acceptance. Full-history ingestion,
independent-provider reconciliation, effective authorization/history, intent attribution and other
unchecked terminal-scope items below remain open.

## Control Campaign P0 local gate (2026-08-13)

- [x] Token Flow, candidate discovery, cluster-position conservation, Behavior Event, Campaign and
      Forensic Evidence Line contracts compile and pass deterministic tests
- [x] Immutable PostgreSQL Control Campaign repository rejects invalid identity/provenance and
      reports storage-down explicitly; ClickHouse flow/position DDL is present
- [x] Provider-free Campaign overview/list/replay, timeline, positions, wallets, graph and
      Evidence Line API routes plus Campaign Timeline/Evidence Line UI are wired
- [x] Unconfigured storage returns `503`; backfill, monitor, alerts, stream and export retain
      explicit `501 NOT_IMPLEMENTED` boundaries
- [ ] Real finalized multi-provider token-history discovery, bounded backfill, live monitoring,
      alert delivery, export, calibration corpus, and production migration acceptance

This P0 gate is `IMPLEMENTED_PENDING_REAL_WORLD_VALIDATION`. It does not claim a production
collector, real-chain campaign detection, calibrated probability, or independent provider
qualification. Entity membership mutation, signing, broadcasting and private-key custody remain
forbidden.

## Foundation

- [x] Repository installs reproducibly from lockfile
- [x] Strict type contracts preserve Unknown/unavailable
- [x] EVM, Bitcoin, and Solana adapter boundaries exist
- [x] Current-state Snapshots use explicit EVM finality, height-pinned Bitcoin best-chain hashes,
      and slot-specific Solana blockhashes with minimum-context account reads
- [x] Dynamic anchors bypass stored response caches and query-time Evidence retains request-scoped
      endpoint provenance across concurrent failover pools
- [x] Parent-linked EVM/Bitcoin/Solana anchors, common-position endpoint reconciliation, typed
      disagreement/insufficient states, and Evidence-linked continuity alerts are implemented and
      deterministically tested
- [x] Complete Flap/Pancake V2 market, buy and exit reconciliation works across officially
      documented Alchemy and BNB Chain operators at one common finalized Snapshot
- [x] Strict EVM/Bitcoin/Solana block and transaction plus Bitcoin outpoint queries bind confirmed
      records to exact Snapshots and pending/mempool/null observations to evidenced uncertainty
- [x] Solana legacy/v0 transaction normalization resolves recorded ALT accounts, account access,
      outer/CPI paths and SOL/SPL balance effects while preserving missing recording as Unknown
- [x] Signing, broadcast, swap, and private-key paths are forbidden
- [x] API, UI, infrastructure schema, health, and test foundation exist
- [x] Declaration drafts can be edited into immutable Expected Claim rules with per-field origins,
      finalized token-decimals Evidence, durable exact/latest replay, and explicit Unknown claim
      truth/reviewer authority/chain confidence
- [x] Clean Docker build, database initialization, and runtime smoke check recorded
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31311814357) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31311814380) pass on immutable main
      commit `5f94dca`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31321516761) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31321516799) pass on immutable
      development commit `235fad6`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31325135812) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31325135794) pass on immutable
      execution/state development commit `83b5194`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31326491651) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31326491643) pass on immutable
      current-state Snapshot development commit `73a1cae`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31327702718) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31327702700) pass on immutable
      request-scoped provider-provenance development commit `6c0b7f4`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31331644908) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31331644917) pass on immutable
      anchor-reconciliation and restart-acceptance development commit `fa69cc5`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31335114054) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31335114055) pass on immutable
      typed-ledger-query development commit `5b77783`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31339918653) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31339918663) pass on immutable
      Flap v5.14.16/V8Safe interface-alignment commit `fd1327a`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31341351857) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31341351830) pass on immutable
      exact-receipt Flap event commit `1b6a40e`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31342767551) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31342767550) pass on immutable
      bounded Flap history commit `a52a78e`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31354381537) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31354381536) pass on immutable
      restart-safe cross-range Flap projection commit `8827be4`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31356333191) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31356333186) pass on immutable
      Flap history-worker/API/UI commit `cfce7f9`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31362400150) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31362400149) pass on immutable
      continuous Flap lifetime-head capability commit `12fc47d`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31379232227) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31379232232) pass on immutable
      claim-audit kernel commit `23b3306`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31396779069) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31396779896) pass on immutable
      Flap/Pancake V2 market-scenario commit `07b3478`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31399771001) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31399770876) pass on immutable
      Pancake V2 exit-scenario commit `27c296d`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31402343560) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31402343611) pass on immutable
      Entity Precision/Calibration evaluation commit `399d797`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31403902953) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31403907558) pass on immutable
      Claim Audit input-integrity commit `c80d906`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31408082373) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31408085955) pass on immutable
      claim-declaration review commit `e1294c4`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31413974058) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31413973830) pass on immutable
      burn-certificate commit `8fcef01`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31417036285) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31417036283) pass on immutable
      burn-candidate discovery commit `af8fee3`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31423240433) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31423240366) pass on immutable
      durable burn-promotion commit `9a9f45e`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31427784207) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31427784193) pass on immutable
      independent BSC market/RV reconciliation commit `e6087c4`
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31543286842) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31543286847) pass on immutable
      protected-main Action Semantics squash commit `e7f1383`, including 654 disposable-store tests,
      36 Chromium flows and all six production container targets
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31547375160) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31547375237) pass on immutable PR
      #18 code commit `9d608f5`, including 676 disposable-store tests, all 36 browser flows and all
      six production container targets before the later queue-isolation correction
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31548486491) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31548486484) pass on exact
      protected-main multi-chain Action capture squash commit `6f209a5`, including the worker-kind
      lease isolation fix, 676 disposable-store tests, 36 browser flows and six container targets
- [x] [CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31555237066) and
      [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31555237043) pass on immutable
      reviewed-ClaimRule report commit `78e6d01`, including 696 disposable-store tests, finalized
      ERC-20 decimals Evidence, migrations through `028`, all 36 browser flows and six container
      targets

## Evidence and data

- [x] Content-addressed evidence primitive and derivation traversal
- [x] Durable append-only Snapshot, Evidence-node, and derivation-edge repository
- [x] Restart-safe Evidence drilldown and real PostgreSQL constraint tests
- [x] Durable generic semantic-scan checkpoints with hash-verified state, cumulative Evidence IDs,
      bounded contiguous advancement, restart/idempotency tests, and immutable terminal history
- [x] Same-anchor Snapshot recapture across repository and production API restart without identity
      collision
- [x] Content-addressed, versioned raw payload repository for implemented ingestion records
- [x] Finalized block-header ingestion on EVM, Bitcoin, and Solana with restart-safe checkpoints
- [x] Finalized provider-shaped raw-transaction ingestion on EVM, Bitcoin, and Solana
- [x] Finalized EVM logs, Bitcoin inputs/outputs, and Solana instruction/CPI raw records
- [x] Finalized EVM trace/state-diff and Solana log/balance/token-balance/reward raw records
- [x] Official System/SPL Token/Token-2022 instruction identification, strict core asset-flow
      decoding, owner/account separation, per-flow Evidence, and zero-tolerance token reconciliation
- [x] Content-addressed Solana transaction semantic reports with exact/latest provider-free replay,
      append-only database guards and explicit provider-failure fallback provenance
- [x] Content-addressed Entity relationship hypothesis reports with exact durable Evidence payload,
      Snapshot and terminal-parent validation, append-only database guards, latest/exact
      provider-free replay and `automaticOwnershipMergeAllowed=false`
- [x] Bounded content-addressed pairwise Entity timelines with deterministic revisions/position
      advances, explicit gaps, Knowledge-state-safe probability deltas, complete report-terminal
      Evidence lineage, append-only guards and provider-free materialize/latest/exact replay
- [ ] Continuous Solana semantic history projection plus platform/program-specific instruction and event decoding
- [ ] Finality-aware historical ingestion on all three ledgers
- [x] Deterministic common-position disagreement, source-failure, continuity, and reorg-detection tests
- [x] Deterministic Flap accepted-lineage rollback/replay with append-only invalidation and no
      majority branch selection
- [ ] Forced real reorg and independently operated provider acceptance
- [x] Bounded exact-Snapshot investigation graph materialization, immutable PostgreSQL replay,
      optional AGE projection/replay validation and depth/node-bounded traversal
- [x] Bounded immutable cross-Snapshot investigation-graph timelines with revision/position
      transitions, explicit continuity, typed request-scope deltas, terminal Evidence,
      provider-free API/UI replay and no relationship-end or membership inference
- [ ] Continuous temporal graph extraction, protocol-scale rebuild/traversal and authenticated
      analyst-override validation

## Intelligence

- [x] Baseline evidence fusion with critical suppression cases
- [x] Canonical pairwise Entity hypothesis persistence rejects duplicate features, ungrounded service
      flags and label-driven merge hints; fixed-version results replay without providers and expose
      controller, coordination and independence separately
- [x] Ledger-scoped Label Intelligence core with source-priority review ordering, explicit temporal
      states, preserved value/actor/determinism conflicts, Evidence-grounded Service Hub suppression
      and hard no-label/risk/cross-chain Entity merge rules
- [x] Immutable PostgreSQL Label Snapshots/reports with exact Subject/observation/Evidence binding,
      update/delete guards, materialize/latest/exact API and search projection
- [ ] Durable GraphSense/official/commercial/community label-source adapters, scheduler handlers,
      license/term enforcement, complete Subject Registry coverage and real cross-source conflict corpus
- [ ] Calibrated entity-resolution model and labeled evaluation corpus
- [ ] Controller/control-right extraction across terminal scope
  - [x] Finalized EVM ERC-1167/EIP-1967/ERC-173/registered-Safe standard surface with complete
        coverage, immutable Evidence-bound report replay, API/UI, deterministic tests and scoped
        independent-source FFT acceptance
  - [x] Same-Snapshot recursive EVM logic bytecode plus exact Sourcify V2 provenance, with verified
        ABI declarations separated from effective rights and legacy report replay retained
  - [x] Finalized one-slot Solana SPL Token/Token-2022/multisig/upgradeable-loader control surface,
        immutable Evidence-bound reports, API/UI, deterministic tests and scoped mainnet validation
  - [ ] Effective custom EVM authorization/history and controller recursion, Bitcoin custody semantics,
        Solana PDA/Squads/history/build provenance and cross-ledger temporal validity
- [ ] Versioned launchpad and market lifecycle adapters
  - [x] Deterministic Flap BSC fixed-block Portal V8Safe/V6/V5 inspection, negative Evidence, API and UI
  - [x] Deterministic caller-supplied Flap creation/configuration/migration transaction decoding,
        default provenance, Evidence drilldown, and desktop/mobile UI
  - [x] Bounded chunked Flap Portal-log discovery, exact receipt replay, range/lifetime coverage
        separation, negative Evidence, API and desktop/mobile UI
  - [x] Finalized SQD filtered discovery plus exact BSC RPC replay for one named non-FFT
        creation/configuration fixture
  - [x] Sparse finalized SQD create-trace decoding and bounded origin-to-exact-receipt proof with
        deterministic positive, negative, ambiguity and mismatch coverage
  - [x] Multi-response SQD continuation metadata and deterministic multi-chunk origin coverage
  - [x] Generic durable semantic-scan checkpoint storage
  - [x] Immutable Evidence-backed Flap bounded-history segment projection and pagination storage
  - [x] Restart-safe cross-range Flap history projection with segment-before-cursor persistence,
        pending-segment adoption, terminal Evidence and provider-free terminal replay
  - [x] Restart-safe Flap origin API binding with chunk resume, atomic terminal result and provider-free terminal replay
  - [x] One-shot deployment-origin worker with storage preflight, bounded chunk resume and safe output
  - [x] One-shot event-history projection worker with storage preflight, immutable segment resume,
        provider-free paginated API replay, health gating, Compose and desktop/mobile UI boundary
  - [x] Exact point-in-time lifetime materialization from official SQD dataset start through one
        finalized target, with origin/history child scan linkage, restart-safe composite checkpoint,
        provider-free API/UI replay and strict Known/Unknown/Snapshot gates
  - [x] Continuous deployment-origin-to-finalized-head scheduler with multi-endpoint finalized
        reconciliation, append-only INITIAL/EXTENSION heads, exact delta projection, provider-free
        latest replay and fail-closed reorg/regression guards
  - [x] Deterministic all-source finalized-reorg rollback to the newest verified ancestor, immutable
        suffix invalidation and immediate safe replay
  - [x] Named FFT migrated Pancake V2 point-in-time buy/exit-size market fixtures
  - [ ] Complete FFT migration fixture, forced reorg drill, lifecycle and sell/execution RV linkage
  - [ ] Pump/PumpSwap, Raydium LaunchLab, Meteora DBC, Moonshot, Four.meme and FomoWell adapters
- [x] Constant-product and shared-liquidity scenario kernels
- [x] Deterministic Flap fixed-block `previewSell` quote and blocked/Unknown/no-fake-zero tests
- [x] Evidence-grounded same-Snapshot typed discrepancy engine with exact-state, conservation,
      derived, quote/RV, aggregate, freshness and API/UI classes
- [x] Exact-decimal class budgets, warning bands, zero-reference handling, coverage gates, missing
      Evidence rejection and Unknown exclusion from numeric denominators
- [x] Deterministic policy-shaped claim-allocation and terminal-action kernel with fake-burn,
      removable-LP, controller-return, multi-hop and incomplete-coverage tests
- [x] Claim Audit v1.1 fail-closed single-asset, duplicate-observation, Snapshot-time and
      chronological actor/path integrity gates
- [x] Deterministic public claim-declaration compiler with Analyst Evidence, exact basis points,
      pension share-unit/no-exit/cadence extraction, explicit Unknown fields and mandatory human review
- [x] Exact source-document Snapshot, direct terminal Evidence, immutable `cdr_...` declaration
      reports, provider-free exact/latest API replay and visible Unknown source/chain coverage
- [ ] Independent declaration-source capture, source authenticity review, non-EVM normalization and
      deterministic Expected-versus-Actual promotion from reviewed drafts
- [x] Finalized range-bounded EVM ERC-20 Transfer Evidence and EOA/Safe/generic-contract custody
      observation, including one named FFT single-source window
- [x] Deterministic Snapshot-time-bounded address-flow aggregation with observed lower bounds,
      coverage-gated Actual values and no-flow `Unknown(NOT_APPLICABLE)` share adherence
- [x] Custody-first same-Snapshot EVM composition with persisted source/terminal Evidence and
      provider-observation Evidence for empty or non-empty Transfer query chunks
- [x] Strict target-indexed `from`/`to` collection, self-transfer deduplication, hard SQD body
      deadlines, bounded terminal Evidence roots and richer exact-unit/share observations
- [x] Content-addressed append-only Claim Report repository and provider-free latest/exact API/UI
      replay with same-Snapshot, canonical-hash and nested-Evidence validation
- [x] Versioned token-wide pension behavior discovery with caller-supplied atomic share unit,
      exact deposit/depositor thresholds, complete finalized SQD Transfer coverage, immutable
      PostgreSQL report/replay and invariant Unknown role/no-exit/dividend semantics
- [x] Same-Snapshot migrated-Flap Pancake V2 pool/factory/router verification, reserve spot,
      multi-size buy scenarios and automatic 0.10% Router/model arithmetic checks, including one
      named FFT point-in-time run
- [x] Durable pension-candidate-to-market composition with same-or-later finalized Snapshot binding,
      exact multi-size share/cost arithmetic, three-parent Evidence root, custody-not-burn semantics,
      API/UI coverage and a five-size live FFT fixed-block validation
- [x] Same-Snapshot Pancake V2 nominal/gross/configured-tax exit-size scenarios with price impact,
      quote-reserve consumption, automatic Router/model checks and one named FFT partial-RV run
- [x] Versioned BSC source-operator registry, official-document attestations, exact-state zero-error
      checks, 0.50% independent quote/RV budgets, API/UI and provider-free Evidence replay
- [x] Exact Entity Precision/False-Merge evaluator plus a test-only structural golden corpus covering
      high-confidence same-controller, coordination, independence, Service Hub, CoinJoin and abstention
- [x] Snapshot/Evidence-bound Bitcoin transaction common-input/change candidates with exact fee
      reconciliation, BIP78 Payjoin warning, CoinJoin/fanout/incomplete-context suppression, no
      automatic ownership merge, responsive UI and two public Esplora production-path observations
- [x] Exact finalized-block ERC-20 burn action derivation with adjacent `totalSupply`, complete
      mint/burn Transfer conservation, contradiction/no-action states, Evidence replay, API/UI and
      one named FFT Alchemy no-action certificate
- [x] Generic proof-gated Action Semantics for transfer, swap, mint/burn, liquidity, LP custody,
      distribution and contract-call primitives, with explicit failed/Unknown execution and no
      automatic promotional-purpose inference
- [x] Immutable content-addressed Action Semantics persistence with migration `025`, canonical
      EVM/Bitcoin/Solana transaction lookup, exact Snapshot/Evidence closure and provider-free
      latest/exact replay; no public proof-assertion write path
- [x] Production generic finalized-transaction Action adapter for EVM logs/traces/state diffs,
      Bitcoin input/output conservation and Solana instruction/balance facts, bound to migration
      `026`, completed-ingestion proof, durable schedules, worker leases and Compose
- [x] Finalized BSC SQD long-range zero-address Transfer candidate discovery with bounded sparse
      queries, terminal Evidence, responsive API/UI and silent-supply state retained as Unknown
- [x] Restart-safe bounded burn-candidate promotion with exact-block certificates before cursor
      advancement, terminal Evidence, provider-free API/UI replay and corrupt-state rejection
- [x] Bounded all-block supply-continuity scanning with EIP-1898 canonical reads, exact multi-source
      reconciliation, changed-block certificates, operator gate, provider-free replay and a named
      independent-source FFT interval
- [x] Add the generic read-only durable schedule/run/lease state machine with deterministic
      occurrence identity, bounded retries, expired-lease recovery, immutable attempts and
      Evidence/Snapshot-gated completion
- [ ] Bind remaining capture kinds to Temporal Schedules/Workflows and NATS JetStream; complete
      continuous historical backfill, reviewed-draft promotion and independent claim-flow
      reconciliation
- [ ] Snapshot/Evidence-backed real-world Entity corpus with at least 100 labels per probability
      axis, Brier score `<= 0.15` and ECE `<= 0.05`
- [ ] Complete multi-route realizable value with taxes, fees, gas and execution failures

## Product

- [x] Responsive no-fake-data analyst shell
- [x] Provider health, read-only state, Unknown state, and evidence surface
- [x] Flap scan-ID replay surface for immutable paginated history segments, with unavailable storage
      rendered explicitly and no provider-triggering path
- [x] Flap lifetime scan-ID replay surface with origin/history child provenance, exact finalized
      target, terminal Evidence root, explicit running/Unknown states and corrupt-result rejection
- [x] Latest accepted Flap lifetime-head replay with sequence, predecessor/continuity, target and
      terminal Evidence in API plus desktop/mobile UI
- [x] Responsive Claim Audit declaration review with no production fixtures, warnings, draft
      readiness, human-review gate and Unknown pension-address rendering
- [x] Responsive pension behavior discovery/latest replay with explicit caller-supplied policy,
      candidate flow/share metrics, durable provenance and no identity promotion on desktop/mobile
- [x] Responsive candidate-bound pension-entry economics with multi-size share/cost output,
      immutable report/Snapshot/Evidence provenance, custody-not-burn and execution Unknown
- [x] Append-only content-addressed pension-entry Scenario Reports with fail-closed persistence,
      exact/latest provider-free API replay and desktop/mobile replay state
- [x] Responsive Entity Intelligence latest/exact replay with Snapshot/result identity, canonical
      features, complete Evidence, Service Hub suppression and no automatic ownership merge on
      desktop/mobile
- [x] Responsive Label Intelligence capture/latest replay with temporal counts, preserved conflicts,
      coverage Knowledge, Service Hub suppression, source/license provenance and Evidence on
      desktop/mobile
- [x] Responsive Entity timeline materialization/latest/exact replay with explicit revisions,
      unobserved-position gaps, probability-delta knowledge states and no automatic merge on
      desktop/mobile
- [x] Responsive exact-block burn certificate review on desktop/mobile with status, supply/event
      arithmetic, generated actions and terminal Evidence
- [x] Responsive burn-candidate range review with event scope, candidate blocks, terminal Evidence
      and explicit silent-supply Unknown on desktop/mobile
- [x] Responsive durable burn-promotion replay with exact progress, certificate counts, terminal
      Evidence, partial-result suppression and silent-supply Unknown on desktop/mobile
- [x] Responsive all-block supply-continuity replay with exact range/sample/change counts,
      independent-operator attestations, terminal Evidence and no range overclaim on desktop/mobile
- [x] Responsive bounded Controller Graph with distinct controller/coordination edges, retained
      no-edge decisions and Evidence drilldown on desktop/mobile
- [x] Responsive immutable graph-timeline materialization/latest/exact replay with continuity,
      request-scope pair changes, Evidence drilldown and no inferred relationship end on desktop/mobile
- [x] Responsive durable exact search with terminal Evidence, explicit missing registry knowledge,
      storage degradation and no on-chain-nonexistence inference on desktop/mobile
- [ ] Extend global search indexing; complete temporal traversal, comparison, general scenario and
      export workflows
- [ ] Authentication, tenancy, analyst overrides and audit log
- [ ] Accessibility, localization, load and cross-browser acceptance

## Operations and security

- [x] Environment example, Compose, initialization schemas and health checks
- [x] Restart-safe bounded worker with PostgreSQL/ClickHouse/object-store preflight
- [x] Dependency/source/license ledger
- [ ] Managed secrets, TLS, network policy and least privilege
- [ ] Backups, restore drill, retention and disaster recovery
- [ ] Image digest/signature/SBOM/vulnerability release evidence
- [ ] SLOs, alerts, incident response and capacity validation

## Real-chain acceptance

- [x] Named finalized raw-transaction capture and terminal replay on four SQD datasets
- [x] Named finalized ledger-record capture, three-store reverse read, and terminal replay on four SQD datasets
- [x] Named EVM execution/state and Solana balance-table capture with integrity-checked artifact replay
- [x] Scoped finalized Solana control-surface validation for classic SPL mint, Token-2022 mint and
      Token-2022 upgradeable Program/ProgramData, followed by provider-free PostgreSQL replay
- [x] Scoped public-mainnet Solana v0 production-path replay with six lookup tables, 43 loaded
      accounts, 26 CPI instructions, exact recorded token deltas and one one-sided Unknown delta
- [x] Scoped public-mainnet Solana core-flow replay with 20/20 official instructions identified,
      9/9 supported flow candidates decoded, 43-node Evidence graph, and conservative Partial token
      reconciliation where Token-2022 extension and close-account effects remained unmodeled
- [x] The same finalized Solana transaction persisted as immutable report
      `str_2401beff4b82308e93ccd9d6` and replayed with identical report/result/Snapshot after API
      restart and deliberate provider unavailability; explicit latest and exact-ID reads matched
- [x] Scoped public Esplora Bitcoin address/UTXO and P2WPKH/P2TR outpoint validation through the
      production API path with Snapshot and Evidence; Core policy/archive reconciliation remains open
- [ ] Ethereum archive/current-state fixture suite
- [ ] BNB Smart Chain archive/current-state fixture suite
- [ ] Bitcoin Core plus Esplora archive/policy reconciliation fixture suite
- [ ] Solana archive plus dedicated independent-RPC fixture suite and platform/program-specific instruction decoding
- [ ] Named launch/migration fixtures for every declared platform/version
- [x] Named FFT migrated Pancake V2 point-in-time market plus buy/exit-size arithmetic fixtures
- [x] Named live FFT Alchemy + BNB Chain common-finalized-block market/RV reconciliation: 37/37
      checks passed and the 91-node terminal Evidence graph replayed from PostgreSQL after restart
- [x] Named FFT pension behavior scan from block `113485950` through `115257276`: 14,020 Transfers,
      one policy-matching address, immutable report `pcr_ff8cd2b24f23d71758cf3e63`, identical
      provider-free latest/exact replay, and explicit Unknown official role/no-exit/dividend meaning
- [x] Named FFT fixed-block pension-entry model for quote inputs `100/500/1000/5000/10000`, bound to
      the durable report and one candidate; exact repeated economics and the 10 bps Router/model gate
      passed while actual buy-plus-transfer settlement remained Unknown
- [ ] RV reconciliation against historical executable quotes
- [ ] Run the registered
      [Flap/BSC FFT reference acceptance case](FLAP_FFT_ACCEPTANCE.md) for
      `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`, including entity, market, RV, Evidence replay,
      typed error budgets, and automatic multi-source discrepancy checks

Until every applicable item for a release claim is checked with attached evidence, ZeroTrace must not
be described as terminal-complete or production-approved.

The unchecked historical-ingestion item is intentionally broader than the completed finalized raw
ledger path: semantic transaction/protocol normalization, continuous operation, reorg policy,
archive-scale backfill, and independent-provider reconciliation remain required.
