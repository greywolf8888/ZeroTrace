# ZeroTrace engineering rules

The repository's `ARCHITECTURE.md` and the ZeroTrace Master Prompt are authoritative for product boundaries. Changes must preserve EVM, Bitcoin, Solana, Entity Resolution, Launchpad Intelligence, Realizable Value, Evidence, Scenario, and UI as first-class architecture domains even when delivery proceeds in dependency order.

## Non-negotiable invariants

- ZeroTrace is read-only. Never add private-key custody, signing, approvals, swaps, transaction broadcasting, or automatic fund movement.
- Every inferred result must carry Evidence, a replayable Snapshot, coverage, freshness, source set, model version, and confidence.
- Unknown, unavailable, stale, and provider-down are distinct states. Never coerce any of them to numeric zero.
- Address, account, wallet, cluster, entity, coordination group, label observation, inference, and fact are distinct concepts.
- Labels do not directly merge entities. Risk labels never imply common control. Service hubs suppress ownership propagation.
- Production paths may not use fixtures or mocks. Fixtures belong under test-only paths.
- Protocol parameters, program IDs, contract addresses, fees, and thresholds must be discovered from official sources or chain state, versioned, and never silently hard-coded.
- GPL, AGPL, FSL, and other non-permissive code must not be copied into the permissively licensed core. Use an isolated sidecar or a clean interface and document the boundary.

## Required checks

Run the smallest relevant test after each module change. Before handing off, run formatting, lint, typecheck, unit, integration, build, license, and every executable E2E check. Record unavailable external validation honestly in `PROGRESS.md` and `docs/testing/FINAL_ACCEPTANCE.md`.
