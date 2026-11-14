# ZeroTrace engineering rules

The repository's `docs/architecture/ARCHITECTURE.md` and the ZeroTrace Master Prompt are authoritative for product boundaries. Changes must preserve EVM, Bitcoin, Solana, Entity Resolution, Launchpad Intelligence, Realizable Value, Evidence, Scenario, and UI as first-class architecture domains even when delivery proceeds in dependency order.

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

Run the smallest relevant test after each module change. Before handing off, run formatting, lint, typecheck, unit, integration, build, license, Rust workspace tests, and every executable E2E check. Record unavailable external validation honestly in `PROGRESS.md`, `docs/testing/FINAL_ACCEPTANCE.md`, and `docs/terminal-market-structure/`.

## Terminal market-structure overlay

Read and obey the terminal market-structure prompt package. The repository, current chain data, tests and evidence are authoritative; chat history is not.

Working language: all user-facing UI, reports, analyst logs, documentation and final delivery use Simplified Chinese. Protocol names, addresses, hashes and standard acronyms may retain original form, but require Chinese labels or tooltips. Code identifiers may remain English.

Additional invariants:

1. Evidence score is not calibrated probability.
2. CEX/Bridge/Privacy boundary is not confirmed realization.
3. Current state is not historical state.
4. A route, schema, fixture, UI card or passing unit test is not a completed capability.
5. Formal forensic mode fails closed if durable storage, raw artifacts, source verification or replay is unavailable.
6. No capability is complete until its named real-chain gate passes.

Git: start from current protected `main`; use one short-lived branch `agent/terminal-market-structure-v1`; commit by coherent gate; do not force-push or alter old evidence; do not merge until all terminal gates pass.

## V11 execution overlay

- Modify the existing system. Data fees, simulated capital, labels, and task status must continue to use the existing authorities; do not create parallel production systems of record.
- After a coherent functional batch, run the smallest effective check. Money, permission, pagination, and idempotency changes require immediate focused verification. Consolidate duplicate commands without removing acceptance coverage.
- Do not execute supervisors from retired packages or inherit their PASS results. Current source, dependencies, environment, and real run records outrank historical reports.
- The default data-procurement budget is zero. Credentials do not imply permission to pay. Until xapid's service identity is verified, do not guess its endpoint, authentication, or price, and do not dispatch requests to it.
- Keep hard boundaries centralized and read task-specific references only when their batch starts. A failure must change the diagnostic path; an external blocker must not stop independent work.
- Real wallets remain read-only. Conditional simulation has no fixed pre-start waiting period or daily trade-count limit.
- User-facing UI and documentation use Simplified Chinese. Source identifiers and standard protocol names may remain English.

## 2026-11-14 仓库与协作治理

- ZeroTrace 只有 main 一条长期项目主线。Arc/BundleMark 是活动任务，保留于 agent/arc-task-ledger-v1；不是 ZeroTrace 主项目或全产品验收证明。
- 原短期 terminal 分支规则是功能批次约定，不能再制造第二条长期项目主线。短期开发分支在实际完成后回并并清理；两条旧活动来源仍待管理权限清理。
- 用户本轮明确授权仓库内容整合；该组织性合并不代表旧终端门禁通过，不改写原始证据。
- 协作者权限只配置于 greywolf8888/ZeroTrace，不共享所有者账户凭据，不操作其他项目仓库。本轮邀请尚未发送，权限实际状态以 GitHub 为准。
