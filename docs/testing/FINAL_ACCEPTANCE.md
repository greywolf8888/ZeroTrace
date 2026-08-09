# Final Acceptance Checklist

This checklist tracks the terminal-product Definition of Done. It is intentionally not complete.

## Foundation

- [x] Repository installs reproducibly from lockfile
- [x] Strict type contracts preserve Unknown/unavailable
- [x] EVM, Bitcoin, and Solana adapter boundaries exist
- [x] Current-state Snapshots use explicit EVM finality, height-pinned Bitcoin best-chain hashes,
      and slot-specific Solana blockhashes with minimum-context account reads
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

## Evidence and data

- [x] Content-addressed evidence primitive and derivation traversal
- [x] Durable append-only Snapshot, Evidence-node, and derivation-edge repository
- [x] Restart-safe Evidence drilldown and real PostgreSQL constraint tests
- [x] Content-addressed, versioned raw payload repository for implemented ingestion records
- [x] Finalized block-header ingestion on EVM, Bitcoin, and Solana with restart-safe checkpoints
- [x] Finalized provider-shaped raw-transaction ingestion on EVM, Bitcoin, and Solana
- [x] Finalized EVM logs, Bitcoin inputs/outputs, and Solana instruction/CPI raw records
- [x] Finalized EVM trace/state-diff and Solana log/balance/token-balance/reward raw records
- [ ] Finality-aware historical ingestion on all three ledgers
- [ ] Reorg/replay and cross-provider reconciliation tests
- [ ] Temporal graph projection and rebuild

## Intelligence

- [x] Baseline evidence fusion with critical suppression cases
- [ ] Calibrated entity-resolution model and labeled evaluation corpus
- [ ] Controller/control-right extraction across terminal scope
- [ ] Versioned launchpad and market lifecycle adapters
- [x] Constant-product and shared-liquidity scenario kernels
- [ ] Complete multi-route realizable value with taxes, fees, gas and execution failures

## Product

- [x] Responsive no-fake-data analyst shell
- [x] Provider health, read-only state, Unknown state, and evidence surface
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
- [ ] RV reconciliation against historical executable quotes

Until every applicable item for a release claim is checked with attached evidence, ZeroTrace must not
be described as terminal-complete or production-approved.

The unchecked historical-ingestion item is intentionally broader than the completed finalized raw
ledger path: semantic transaction/protocol normalization, continuous operation, reorg policy,
archive-scale backfill, and independent-provider reconciliation remain required.
