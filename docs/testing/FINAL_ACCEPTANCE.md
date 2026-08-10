# Final Acceptance Checklist

This checklist tracks the terminal-product Definition of Done. It is intentionally not complete.

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
- [x] Strict EVM/Bitcoin/Solana block and transaction plus Bitcoin outpoint queries bind confirmed
      records to exact Snapshots and pending/mempool/null observations to evidenced uncertainty
- [x] Signing, broadcast, swap, and private-key paths are forbidden
- [x] API, UI, infrastructure schema, health, and test foundation exist
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
- [ ] Finality-aware historical ingestion on all three ledgers
- [x] Deterministic common-position disagreement, source-failure, continuity, and reorg-detection tests
- [x] Deterministic Flap accepted-lineage rollback/replay with append-only invalidation and no
      majority branch selection
- [ ] Forced real reorg and independently operated provider acceptance
- [ ] Temporal graph projection and rebuild

## Intelligence

- [x] Baseline evidence fusion with critical suppression cases
- [ ] Calibrated entity-resolution model and labeled evaluation corpus
- [ ] Controller/control-right extraction across terminal scope
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
- [x] Deterministic FFT-style claim-allocation and terminal-action kernel with fake-burn,
      removable-LP, controller-return, multi-hop and incomplete-coverage tests
- [x] Claim Audit v1.1 fail-closed single-asset, duplicate-observation, Snapshot-time and
      chronological actor/path integrity gates
- [x] Deterministic public claim-declaration compiler with Analyst Evidence, exact basis points,
      pension share-unit/no-exit/cadence extraction, explicit Unknown fields and mandatory human review
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
- [x] Same-Snapshot migrated-Flap Pancake V2 pool/factory/router verification, reserve spot,
      multi-size buy scenarios and automatic 0.10% Router/model arithmetic checks, including one
      named FFT point-in-time run
- [x] Same-Snapshot Pancake V2 nominal/gross/configured-tax exit-size scenarios with price impact,
      quote-reserve consumption, automatic Router/model checks and one named FFT partial-RV run
- [x] Exact Entity Precision/False-Merge evaluator plus a test-only structural golden corpus covering
      high-confidence same-controller, coordination, independence, Service Hub, CoinJoin and abstention
- [x] Exact finalized-block ERC-20 burn action derivation with adjacent `totalSupply`, complete
      mint/burn Transfer conservation, contradiction/no-action states, Evidence replay, API/UI and
      one named FFT Alchemy no-action certificate
- [x] Finalized BSC SQD long-range zero-address Transfer candidate discovery with bounded sparse
      queries, terminal Evidence, responsive API/UI and silent-supply state retained as Unknown
- [ ] Automated durable candidate promotion/capture scheduling, silent-supply discovery,
      reviewed-draft promotion,
      independent-source reconciliation, complete Claim Audit and terminal named FFT conclusion
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
- [x] Responsive exact-block burn certificate review on desktop/mobile with status, supply/event
      arithmetic, generated actions and terminal Evidence
- [x] Responsive burn-candidate range review with event scope, candidate blocks, terminal Evidence
      and explicit silent-supply Unknown on desktop/mobile
- [ ] Complete search, entity graph, timeline, comparison, scenario and export workflows
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
- [ ] Ethereum archive/current-state fixture suite
- [ ] BNB Smart Chain archive/current-state fixture suite
- [ ] Bitcoin Core plus Esplora fixture suite
- [ ] Solana archive plus dedicated RPC fixture suite
- [ ] Named launch/migration fixtures for every declared platform/version
- [x] Named FFT migrated Pancake V2 point-in-time market plus buy/exit-size arithmetic fixtures
- [ ] RV reconciliation against historical executable quotes
- [ ] Run the registered
      [Flap/BSC FFT terminal acceptance](FLAP_FFT_ACCEPTANCE.md) for
      `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`, including entity, market, RV, Evidence replay,
      typed error budgets, and automatic multi-source discrepancy checks

Until every applicable item for a release claim is checked with attached evidence, ZeroTrace must not
be described as terminal-complete or production-approved.

The unchecked historical-ingestion item is intentionally broader than the completed finalized raw
ledger path: semantic transaction/protocol normalization, continuous operation, reorg policy,
archive-scale backfill, and independent-provider reconciliation remain required.
