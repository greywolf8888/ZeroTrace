# Final Acceptance Checklist

## 2026-08-21 当前实现候选验收

- [x] 实现 SHA `a0262f08adec9b9017e859b361b539204ac09999`：P0 算法/Unknown/fail-closed 语义与 durable worker 基础完成
- [x] 四个普通用户一级入口：工作台/查询、案件、监控与告警、数据源与系统；Developer 能力独立折叠
- [x] Tauri production Web + 打包 API sidecar；动态 loopback、每会话 token、AppData 存储、单实例和受限 capability
- [x] 本机 NSIS build、隔离安装、启动、四入口原生窗口检查和卸载通过
- [x] Chromium desktop/mobile `42/42`；coverage `1015 passed / 40 skipped`，分支 `75.02%`
- [x] Rust workspace fmt/clippy/tests、property `57/57`、forensic golden `30/30`、fault `11/11`、replay 与连续两轮 formula differential 通过
- [x] 当前 SHA 公开 BSC 双 Operator 捕获：`8 PASS / 1 UNSUPPORTED / 0 FAIL / 0 BLOCKED_EXTERNAL`
- [x] format、lint、typecheck、build、license、CycloneDX SBOM、生产依赖审计（0 vulnerabilities）通过
- [ ] 外部 PostgreSQL/ClickHouse/MinIO 当前 SHA 集成：40 tests skipped，不得计 PASS
- [ ] 任意 BSC Token creation→finalized 完整 envelope 与 provider-free bundle replay
- [ ] 50 Token 人工复核、正常协议负对照、概率校准和独立签字
- [ ] pinned archive fork V3 exact 与多 venue 共享状态全局 exact
- [ ] 固定硬件性能：`NOT_RUN`
- [ ] 24h monitor soak：`NOT_RUN`
- [ ] 完整 SHA-bound 黄金视觉状态集
- [ ] Authenticode 签名、独立清洁机、Provider Setup/vault、升级/回滚
- [ ] G14 Final Acceptance：`BLOCKED`

结论：本地工程候选成立；Combined PASS、Production Acceptance、Release 和合并条件均不成立。

最终本机 NSIS SHA-256：`CE8AB8DC8AB91D6F18443C6889CEDF0EA9D42D5F75793F7B02AC5BD1C02CC03C`；Authenticode：`NotSigned`。

## 2026-08-19 监管取证升级门禁

- [x] G01 架构边界：App.tsx / app.ts / schemas index 行数门禁与手写 web API 合同拆除
- [x] G02–G06 由新包单测与 `evals/market-structure` 黄金案件覆盖
- [x] G07 中文工作站扫描与案件导出
- [x] G08 全量 format/lint/typecheck/unit/integration/e2e/build/license/sbom：见 `docs/market-structure-upgrade/最终交付.md` 第 6–7 节命令退出码；PostgreSQL 集成 40 tests skipped、Live Smoke/覆盖率本会话未重跑已显式记录

This checklist tracks the terminal-product Definition of Done. It is intentionally not complete.

This checklist tracks the terminal-product Definition of Done. It is intentionally not complete.
Named assets are reference cases for the shared architecture. They never define a standalone
roadmap phase, shared runtime defaults, protocol constants or token-specific inference behavior.

## Current post-change gate ledger — 2026-08-15

- [x] The local read-only MCP stdio bridge exposes seven fixed analyst tools with strict argument
      validation, API-origin allowlisting, bounded GET-only transport, redirect/size/time limits,
      and no write-capable method; focused protocol coverage passed `5/5`. This is an integration
      boundary, not HTTP authentication, tenancy, Agent-console, or Production Acceptance
- [x] A fresh isolated API process returned real `/health` JSON through `zerotrace_health` with
      `readOnly=true` and explicit degraded/unconfigured state; the MCP stdio response remained a
      valid tool result and the temporary process was stopped cleanly
- [x] Control Campaign UI now has explicit Combined/Token/Funding/Settlement/Behavior layers and
      hides unrelated lanes when switching; multi-report loads show descriptive Snapshot/result-hash
      comparison without ownership inference. The updated Campaign interaction passed Chromium
      desktop/mobile `2/2`; this does not close calibrated Entity resolution or Production Acceptance
- [x] Unit suite passed `760/760` across 136 files; evaluation suite passed `1/1`; format, ESLint,
      TypeScript, package/API/web/worker build, production license allowlist, Compose config,
      CycloneDX SBOM generation, `npm audit` (`0` vulnerabilities), and `git diff --check` passed
- [x] Raydium LaunchLab now has a source-pinned clean-room partial decoder for the official
      mainnet program and pinned IDL commit; Borsh initialization/migration primitives and the
      raw 429-byte PoolState layout are bounded-decodable while historical account reads and
      real-fixture Evidence remain open, and activation is explicitly blocked until closure
- [x] A fresh real Raydium LaunchLab smoke reached finalized slot `439398289`, decoded a
      source-pinned `buy_exact_in`, read the complete 429-byte PoolState, retained 20 Evidence
      nodes, and replayed the same result hash. Later account context keeps the state
      `MIN_CONTEXT_ONLY` (`historyCoverage=0.5`, one-provider `sourceCoverage=0.5`); historical
      exactness and full activation remain open
- [x] Bitcoin missing-prevout paths preserve `Unknown(INSUFFICIENT_DATA)` for input totals,
      fee reconciliation, and graph outpoint values; no numeric zero is synthesized
- [x] The current disposable-store integration execution completed with `128/128` passed (`0`
      failed) across 8 files against isolated PostgreSQL/ClickHouse/MinIO services, including the
      NodeReal route regression
- [x] Full coverage passed `888/888` across 144 files with file-level parallelism disabled for
      deterministic shared-store scheduling: Statements `82.31%`, Branches `75.32%`, Functions
      `91.66%`, and Lines `83.84%`
- [x] The current `docker compose build api web` completed from this source checkpoint after the
      Docker Engine recovered, producing current API/Web images
- [x] A no-volume container from the current API image was smoke-tested against healthy disposable
      PostgreSQL/ClickHouse/MinIO/Valkey/NATS services: `/health/live` and `/health/ready` returned
      HTTP 200; aggregate `/health` returned HTTP 200 with explicit `DEGRADED` and `readOnly=true`
      under intentionally unconfigured optional providers
- [x] A current-source Apache AGE `1.7.0` sidecar initialized on a separate named volume; the real
      smoke command projected durable graph `eig_c718567bd03883990dc3dc02` with 2 nodes and 1 edge,
      then replayed the exact result with the same hash. An API image with `AGE_URL` reported
      `/health/ready` HTTP 200 and `graphProjection.status=UP` with backend `APACHE_AGE`
- [x] A fresh isolated Compose project `zerotrace-compose-current` started the current API/Web
      images plus PostgreSQL, ClickHouse, Valkey, NATS, and MinIO on non-conflicting ports. All
      dependencies reported healthy/running; API `/health/live`, `/health/ready`, and `/health`
      returned HTTP 200, Web `/healthz` returned HTTP 200, API reported `readOnly=true`, and live
      BSC/Blockstream providers reported `UP`
- [x] After the Campaign layer change, the rebuilt API/Web images repeated the isolated Compose
      startup gate: API liveness/readiness/aggregate health and Web `/healthz` returned HTTP 200,
      aggregate health was `UP` with `readOnly=true`, BSC/Blockstream were `UP`, and the project
      was stopped without removing its named volumes
- [ ] Default root Compose host-port deployment remains an environment gate because unrelated local
      services own `5432`/`6379`; no volume was deleted or reset and this does not invalidate the
      isolated project acceptance above
- [x] `RawArtifactStore` health probes are bounded and its dedicated HTTP(S) keep-alive agent is
      closed by API/worker teardown; focused storage and full coverage regressions passed
- [x] The BNB Chain official [JSON-RPC endpoint documentation](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/)
      lists NodeReal's keyless BSC endpoint; manual read-only chain-id and target-block checks agreed
      with BNB Chain at block `115956636`. A clean process-local API then ran the actual FFT
      `/api/v1/rv/flap-pancake-v2-reconciliation` route with BNB Chain + NodeReal, selected finalized
      block `116005076`, and returned `200/PASS`, `VERIFIED_INDEPENDENT`, two operators, and zero
      failed/inconclusive audit checks (terminal Evidence `ev_241d928b691c0161a82c7b11`)
- [x] Clean PostgreSQL-backed execution of the same FFT route selected finalized block `116009420`,
      returned `200/PASS`, `VERIFIED_INDEPENDENT`, two operators, and zero failed/inconclusive audit
      checks (terminal Evidence `ev_441a017ac39b96ada5f1cca6`); after API close/recreate, the Evidence
      drilldown replay returned HTTP 200 with 82 nodes and retained the terminal node
- [x] The durable Token History worker completed an explicit empty-range negative observation for
      FFT over `115956000–115956636` (`cpr_0fbda2c936a4bca83c824989`, terminal Evidence
      `ev_6d862f962f40d68bba51f6b0`) without materializing a Campaign from no flow
- [x] A real-flow bounded backfill over `113416949–113417950` completed as run
      `cpr_11a0afc0e7709e7b6a2a856c`, Token History `thd_f43b5818d37310944298a57c`,
      Funding/Settlement `fsr_d39fc1c0fa7ba831f03cfa4a`, Campaign
      `cc_de3cff0e52d827b72b4a2058`, and terminal Evidence `ev_46624f675aaa8380cd334df3`; the
      capture reported `1/1` coverage/confidence, Campaign `data/source/history=1/1/1`, 19
      Evidence IDs, and `UNCALIBRATED` confidence remained explicit
- [x] After API close/recreate, Campaign and Funding/Settlement reads returned HTTP 200 and the
      terminal Evidence drilldown returned 88 nodes with the terminal present; the durable
      backfill schedule replay returned `COMPLETED` with a `SUCCEEDED` run and the same result
      reference
- [x] `CAPTURE_WORKER_SCHEDULE_ID` is a strictly validated optional operator selector; default
      queue ordering is unchanged and focused scheduler/config tests passed `17/17`
- [x] Bounded strict multi-provider Token History/Campaign capture passed through the compiled
      worker with `TOKEN_HISTORY_REQUIRE_INDEPENDENT_RPC=true`: schedule
      `cps_7ed96d129818629d8d75fa97`, run `cpr_9b853d0446eaf7c31a589686`, Token History
      `thd_83a44329e7ffbacc8b7f41cd`, and Campaign `cc_cb780760c06718c92ec033b8` completed for
      FFT over `113416952–113417953`; 12 observations agreed across BNB Chain and NodeReal, with
      source-reconciliation and per-provider-attestation Evidence retained
- [x] Token Live Capture heartbeats now retain every provider ID from the finalized Snapshot and
      commit those IDs into heartbeat Evidence; focused monitor-handler regression passed `6/6`,
      including durable-cursor continuation and fail-closed finalized-cursor reorg detection
- [x] A process-local real-provider heartbeat for FFT used BNB Chain + NodeReal, reached finalized
      block `116030074`, and retained both RPC IDs in the returned source set with heartbeat Evidence
      `ev_27af40e985384c59bfb655c9`; this did not touch durable storage or enter a backfill path
- [x] The durable heartbeat terminal now closes its Evidence provenance correctly: clean monitor
      schedule `cps_d32faa0c70d0e81e0e05affb`, run `cpr_28a4744752cb4c8ea6518cfc`, recovered
      `LEASE_EXPIRED` → `SUCCEEDED`, and terminal Evidence `ev_e67e423cb2f77ae4ee7b397e` retained
      both strict BNB Chain/NodeReal provider observations; focused handler regression passed `6/6`
- [x] A fresh clean-store strict capture for FFT over `113416949–113417951` completed as schedule
      `cps_be59eeba3e2de7c08c3c9050`, run `cpr_22b096d9c7c66ddc0436201b`, Token History
      `thd_fbca531453dd3db2cf43e392`, and Campaign `cc_3c7b119ee7df0964578cb7ef`; Campaign was
      `CLOSED`/`SETTLEMENT`, coverage/confidence `1/1`, and five durable Alerts were returned
      (`2 CRITICAL`, `3 INFO`) with both RPC IDs and SQD retained in the source set
- [x] After API restart, the fresh Campaign GET, five-alert GET, SSE (`1` campaign + `5` alert +
      `1` complete event), Case read, and Case export all returned HTTP 200; the Case Bundle retained
      `38` Evidence nodes, `17` Snapshots, and `13` raw artifacts
- [x] Current Web visual follow-up passed at 1440x1000 and 390x844; long direct-code Campaign values
      wrap, medium desktop detail columns collapse safely, mobile root overflow is false, and the
      browser reported zero errors or warnings
- [ ] Archive-grade/full-range history reconciliation and Production Acceptance remain open;
      the bounded strict run does not prove operator independence, full dataset origin,
      long-running reorg/outage behavior, calibrated inference, or production migration approval
- [x] Current Playwright Chromium desktop/mobile dashboard execution passed `40/40`
- [x] 2026-08-19 forensic workstation Playwright Chromium desktop/mobile passed `42/42`; command and skips are in `docs/market-structure-upgrade/最终交付.md`
- [x] Windows-wrapper E2E rerun after the narrow-screen navigation change passed `40/40`
- [x] A fresh API process using only the public BSC RPC reported provider `UP`; browser Inspect
      of FFT rendered the contract, versioned Flap state, Snapshot and Evidence, then replayed
      lifetime scan `d2af31c5-7435-4e38-8d6d-dc84968b8d28` with `Verified hint only · full dataset
incomplete`; at 390×844 the complete result had no root overflow and the primary nav remained
      intentionally scrollable, with zero browser console errors or warnings
- [x] A fresh bounded SQD origin-worker smoke for FFT `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`
      over finalized BSC blocks `113416949–113417949` completed in two 1,000-block chunks with
      requested-range coverage `1`, terminal Evidence `ev_0fe0188838a1b04a41bf510b`, and an exact
      finalized Snapshot at block `113417949`; `originState=unknown` is correct because the range
      excludes the verified deployment origin at `112625803`
- [ ] These checks do not constitute Production Acceptance. Lifetime archive history,
      independent-provider reconciliation, long-running finalized-reorg/provider-outage soak,
      alert calibration, remote CI/CodeQL, operational controls, and production migration approval
      remain open

## Solana dealer bounded-history recovery — 2026-08-15

- [x] SQD ledger-record reads now use bounded contiguous 16-slot windows for dealer captures;
      the API also raises the Solana response budget only within an explicit bounded limit after a
      real busy-slot response exceeded the generic 8 MiB JSONL line limit
- [x] Pump mint `EbudBPrWzLXLkkc3NrteDBvYDnyb9Pw7zCua36rnpump` over finalized slots
      `439138672–439138804` completed durably as `sdc_c9a09033ac08dca34a18f228`, `PARTIAL`, with
      28 candidates, 4 holders, 29 token-flow edges, `truncated=false`, and
      `data/source/history=1/1/0`; result hash is
      `3c3fa7b31cc1f3847461940a2e4dd087517c7a28bc14d2cca79571f1e0cd66e1`
- [x] The focused dealer regression passed `10/10`, including three-window aggregation and
      fail-closed source cursor validation
- [ ] Two holder opening balances remain Unknown; full Solana archive history, funding/settlement
      windows, independent RPC reconciliation, PDA/Squads recursion, and production acceptance
      remain open

## Bitcoin forensic graph live smoke — 2026-08-15

- [x] Public Blockstream Esplora captured confirmed transaction
      `074b02b446a3d55b26c33582f7a1b44691cd94ae87f50f430288b3213fea596a` at height `576833`;
      live report `bfg_885d6729a6954592ddbd1a90` contained 597 nodes and 699 edges with result hash
      `d85e27298b43800ac80addc92e5180eb3a1663fc55d43ac249094f7315c93cb1`
- [x] The report retained `COINJOIN_EQUAL_OUTPUT_PATTERN`, `PAYJOIN_NOT_EXCLUDABLE`, and
      `SERVICE_ATTRIBUTION_UNQUERIED`; provider health was `UP`, circuit `CLOSED`, and transport
      attempts were 16/16 successful. Automatic ownership merge remained disabled
- [x] Frozen provider-free replay was deterministic across two runs; the replay hash was
      `cb7762c668b880606bf99e07f61851713eaa41b5ae9c1f88b047fb5c0d1e72e6`
- [x] The configured API then captured the same transaction durably as
      `bfg_13284efe37c91a1ce430501e` with 597 nodes, 699 edges, and result hash
      `18e2eeed0006de1ecf6ee1b2112d30dce3ae0c727c5e6bd6de1d587ec0eb4456`; exact GET replayed the
      stored report with the identical hash
- [ ] Bitcoin Core/archive/policy reconciliation and calibrated ownership inference remain open;
      this smoke does not promote CoinJoin or service attribution into facts

## FFT verified-hint lifetime materialization and adaptive history recovery — 2026-08-15

- [x] Parent lifetime checkpoint `d2af31c5-7435-4e38-8d6d-dc84968b8d28` and history child
      `119b74d1-62d8-4607-bade-d0262e1c8219` reached `REQUESTED_RANGE_COMPLETE` for finalized
      target block `115956636`, hash
      `0x641aae147f3ab1d02a4d85081b2f38a61c0d7c33683d19f5eccef20da6215833`; the child contains
      667 immutable 5,000-block segments and requested-range coverage `1`
- [x] The origin hint child `cb35a3fd-3c0d-4c1a-8f63-7d1c84f7dc87` verified the exact
      deployment origin at BSC block `112625803`, including transaction
      `0x708256a1ad8c4f4ab8aefd021b4676fda9579eb61846f4957895fc8432467a63`; the parent records
      `originSearchMode=VERIFIED_HINT`, terminal Evidence
      `ev_89ee9443007b3113dccb9dc1`, and `data/source/history=1/1/1`
- [x] The 5,000-block dense-window failure was reproduced and repaired: both platform and SQD
      log-result-limit errors now trigger bounded recursive subrange splitting, range Evidence is
      buffered until a subrange succeeds, and the original 25,000-log safety bound is retained
- [x] An exact second lifetime invocation returned the same scan ID, terminal Evidence, target
      Snapshot, and checkpoint state hash
      `7c1fb055b8253ad0d31a532719a0832c6f1a715dcda03b04e78a8c5aec6d77ff`
- [x] SQD contract-creation reads now use at most four bounded concurrent windows and merge only
      after strict range ordering; the focused SQD suite passed `34/34`, while the public Portal
      measurement showed no throughput gain because responses were serialized
- [ ] Full SQD dataset-start origin search was not completed; the result remains explicitly
      `lifetimeCoverage=Unknown(INSUFFICIENT_DATA)` under the verified-hint boundary and cannot
      be promoted to Known lifetime or Production Acceptance
- [ ] A current no-hint retry against public SQD `binance-mainnet` target block `116040177` reached
      durable origin cursor `7000000` from dataset start, then was stopped with explicit
      `OPERATOR_STOPPED_RATE_BUDGET`. No creation was selected and no terminal result was emitted;
      the parent/origin checkpoints remain resumable. Public Portal worker-range continuation and
      rate limits make this an incomplete external scan, not a full-origin pass

## Raydium LaunchLab live smoke and historical-boundary acceptance — 2026-08-15

- [x] The source-pinned read-only decoder recognized finalized transaction
      `4WERw7UQns3xoLyxk13Y1txCMa1fpB8C3F33rtZAhmvdjX4gCgiRc8UVkRfk6QjXBDLeqE4vy18imW1gDkWaWi4S`
      at Solana slot `439296420`, verified program
      `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`, and decoded `sell_exact_in` with complete
      argument/account coverage while retaining three trailing-account warnings
- [x] PoolState account `BEEmWVXzewWvYaD52iP5TGKY5ofA89Vq3fKHV5ut4izh` matched the pinned owner,
      discriminator, and expected 429-byte layout; all declared fields decoded and the decoder
      replay produced the same result hash
- [x] The public finalized RPC was healthy and the program account was executable; all smoke
      Evidence was Snapshot-bound and the inspection was read-only
- [ ] The PoolState context was slot `439298807`, later than requested slot `439296420`, so the
      result is correctly `MIN_CONTEXT_ONLY` with `historyCoverage=0.5`; historical exact account
      reads, durable fixture Evidence, remaining-account closure, and activation remain open

## Historical full local regression gates — 2026-08-15 (before the latest post-change rerun)

- [x] Unit suite passed `726/726` across 131 files; integration suite passed `126/126` against
      isolated PostgreSQL/ClickHouse/MinIO acceptance services; evaluation suite passed `1/1`
- [x] Full coverage passed `852/852` across 139 files: Statements `81.96%`, Branches `75.12%`,
      Functions `91.61%`, and Lines `83.52%`
- [x] Formatting, ESLint, TypeScript, package/API/web/worker build, license allowlist,
      `npm audit` (`0` vulnerabilities), Compose config validation, and CycloneDX SBOM generation
      passed
- [x] Chromium desktop/mobile E2E passed `38/38`; Windows-wrapper E2E passed `38/38`
- [x] The focused storage health regression passed `3/3` after local MinIO recovered from a
      transient drive-offline event; the transient infrastructure failure remains documented as
      such
- [ ] These gates do not constitute Production Acceptance. Lifetime archive history,
      independent-provider reconciliation, long-running finalized-reorg/provider-outage soak,
      alert calibration, Apache AGE projection validation, remote CI/CodeQL, operational controls,
      and production migration approval remain open

## FFT exact-binding recovery and canonicalization acceptance — 2026-08-15

- [x] The immutable negative Token History report `thd_4896577ddd6379af0ca21d38` was preserved;
      its six `UNAVAILABLE(EXACT_RPC_CONFLICT:ERROR)` bindings were not overwritten
- [x] Recovery revision `thd_a25f1e2fcb5880a32afb4354` rebound all six exact observations, and the
      canonicalized retry produced `thd_7bfa3f58b90b39f103c6c79b` with 12 observations, 6/6
      `BOUND` bindings, `1/1/1` coverage, final Snapshot `113417949`, and result hash
      `b20c94da4cf34eba0ea50a37200baa21c55ef22a2dedc401528053ac84977ecc`
- [x] Durable read-only capture `cpr_45dae874f2ae81c9223eb148` (schedule
      `cps_5518ecae25b1142b0d66bc69`) succeeded on attempt 1 with 67 Evidence IDs, terminal
      Evidence `ev_da83dc994e01ba0d6465f774`, and coverage/confidence `1/1`
- [x] Funding/Settlement `fsr_09af3097b288d14aaecc465e` is `COMPLETE` with `BOUNDED_RANGE`
      scope, 5 funding edges and 5 settlement edges; Campaign `cc_a85a9c7caaa55529d673711c`
      replayed through the result reference
      `control-campaign:cc_a85a9c7caaa55529d673711c#sha256=dc8f0b94884ff786186f1ea44402cd509ba842033077da17d81a99c3cab81037`
- [x] Mixed-case EVM token parameters now canonicalize once at the worker boundary before target,
      Token History, Funding/Settlement, historical expansion, and live-capture evidence use;
      the prior uppercase failure remains immutable scheduler history
- [ ] Lifetime archive history, independent-provider qualification, long-running monitor/reorg/
      outage delivery, calibration, Apache AGE projection, remote CI/CodeQL, operational controls,
      and Production Acceptance remain open

This is a successful bounded real-provider recovery and end-to-end target run. It is not a
terminal-product or production-approval claim.

## Real monitor, alert replay, and outage recovery — 2026-08-15

- [x] Durable Token Live Capture schedule `cps_9b057eed93189e616ddcc60e` captured finalized BSC
      window `113417951–113418950` as run `cpr_5321d964baedf8904e2d13de`; attempt 1 succeeded
      with `coverage=1`, `confidence=1`, 52 Evidence IDs, terminal Evidence
      `ev_4fa800d834664fccaec8e941`, and Campaign `cc_59540f3585b8d7e09d9f87a`
- [x] Token History `thd_ad67bc13be0d184f1f461ec2` retained 7 observations and `1/1/1` coverage;
      three durable Evidence-bound alerts were persisted:
      `fca_44490a0818f5fbd5a949ac91`, `fca_4ba0d390aaaf052611d6712c`, and
      `fca_aecc3d73ec82bb31bc89baa9`
- [x] PostgreSQL-backed monitor and alert routes returned HTTP 200; Campaign SSE replay returned
      HTTP 200 with `campaign`, `alert`, and `complete` events and no provider call
- [x] Immediate second worker invocation claimed 0 runs before the interval's next occurrence,
      preserving no-duplicate finalized-window and alert behavior
- [x] Outage drill run `cpr_bd0953d185d5adbc0930b452` recorded retryable attempt-1
      `HTTP_ERROR` / `Provider hostname could not be resolved`, then succeeded on attempt 2 after
      restoring public BSC RPC with an explicit empty-range Token History result and `1/1`
      coverage/confidence
- [ ] Multi-day soak, forced finalized reorg, independent-provider qualification, calibrated alert
      precision, and Production Acceptance remain open

This is bounded real monitor/outage evidence. It does not establish long-running operational or
production acceptance.

## Real Solana dealer capture and Evidence provenance — 2026-08-15

- [x] The repaired Solana dealer API captured Pump mint
      `EbudBPrWzLXLkkc3NrteDBvYDnyb9Pw7zCua36rnpump` at finalized slot `439138804` and returned
      HTTP 200 with `durable=true`, report `sdc_9e7a7727e8c761f65310b836`, `PARTIAL` status,
      one candidate, two holders, one token-flow edge, and 31 Evidence IDs
- [x] The range summary is now a `DERIVED_FEATURE` with its block Evidence parents and its source
      IDs included in the content-addressed Evidence ID; the unit fixture uses the real
      `EvidenceLedger` provenance validator
- [x] Durable report hash is
      `ae1d86eab71b348b65256ead1b423757544a9581ffa73df5210a76b2f5325c79`; coverage is
      `data/source/history=1/1/0`, so missing lifetime opening balances, SOL funding, settlement,
      and Campaign inference remain explicit Unknown
- [x] Provider-free exact report GET returned HTTP 200 with `replayed=true` and the same result hash
- [ ] Full Solana dealer archive history, multi-window trading/settlement, independent RPC
      reconciliation, PDA/Squads recursion, and Production Acceptance remain open

This is a real durable Solana token-flow and holder-boundary validation, not a complete dealer
Campaign claim.

## Earlier local acceptance hardening and sparse-origin continuation — 2026-08-14

- [x] `npm run format:check`, ESLint, `npm run typecheck`, production build, production license
      allowlist, `npm audit --audit-level=high` with 0 vulnerabilities, CycloneDX SBOM, and
      `git diff --check` passed
- [x] `npm run test:unit`: 722/722 tests across 131 files; `npm run test:integration`: 126/126;
      `npm run test:evals`: 1/1
- [x] `npm run test:coverage`: 848/848 tests; Statements 81.99%, Branches 75.15%, Functions
      91.63%, Lines 83.53%; configured global thresholds passed with isolated PostgreSQL/ClickHouse/
      MinIO variables configured
- [x] Playwright Chromium desktop/mobile E2E 38/38 and Windows-wrapper E2E 38/38
- [x] Fresh PostgreSQL/ClickHouse/MinIO durable Token History run for BSC FFT
      `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`, blocks `113485950–113495949`, completed as
      `SUCCEEDED`; it stored 10,029 Raw Facts, 10,047 Evidence nodes, Action Semantics 5, Token
      History 1, Funding/Settlement 1, Control Campaign 1, and 4 alerts
- [x] Durable result retained terminal Evidence `ev_313145f71268bbc8df65cfc5`, `49/49` Evidence
      closure, canonical `eip155:56` facts, two-provider source set, and a provider-free replay
      invocation claimed 0 additional runs
- [x] Sparse Token History regression: Portal origin queries are windowed, requested-range coverage
      has its own Evidence/Snapshot, and a no-event final block remains exact-Snapshot anchored;
      the focused SQD/Token History suite passed 37/37
- [x] Durable one-block deployment-origin run for the same FFT token (`112625803`) completed as
      `SUCCEEDED` in `cpr_67fe3afcb2449ebc5339bede`; report `thd_4ae3e83cf53b1f0997578900` resolved
      the SQD creator/transaction and retained `1/1/1` requested-range coverage with 11/11 History
      Evidence closure
- [x] Durable History/Campaign rereads retained their result hashes; the second worker invocation
      claimed 0 runs. UI state styling now distinguishes stale/provider-down/unavailable/not-queried
      states and restores missing theme borders
- [x] Durable Token Live Capture empty-range handling now completes a finalized range with no token
      observations as a derived `NO_TOKEN_FLOW_OBSERVATIONS` Evidence result instead of retrying
      `NO_CANDIDATE_WALLETS`; monitor `cps_5e137cd0af1f29410db64a0b` completed interval run
      `cpr_f2fa7a8064fc783fb60847fd` at block `115850017`, then
      `cpr_557ad3ef8441a7f8da0a3daf` at block `115850018`, both with `coverage=1` and `confidence=1`
- [x] Candidate-scoped Funding/Settlement expansion now queries finalized SQD parent transactions
      and EVM call traces only for selected focus wallets, validates each parent/trace relationship
      against an exact BSC Snapshot, and persists successful non-zero native transfers only after
      status/address/value checks
- [x] Fresh public-provider BSC FFT run `cpr_6710455c95c6bb50d4496781` over
      `113485953–113495946` succeeded after durable retry handling, stored 8 candidate transaction
      and 8 candidate trace Evidence nodes in its 66-node terminal closure, and replayed the latest
      Funding/Settlement report `fsr_000a27003a2d60c704482d06` with the same result hash
- [x] Candidate expansion retained the bounded negative result explicitly: all 8 observed call
      trace values were `0x0`, so no native funding edge was invented; the report remains
      `TRANSACTION_LOCAL` with `historyCoverage=0`
- [x] Candidate-scoped finalized Transfer-log expansion completed on the new BSC range
      `113485956–113495943` in `cpr_b9da7041ca060623003a3c6f`; the capture retained 40 LOG, 8 TRACE,
      and 13 TRANSACTION Evidence nodes, including 28 SQD candidate LOG nodes
- [x] The same run produced Token History `thd_0ba39221dd3551102241e538` with `1/1/1` requested-range
      coverage and Funding/Settlement `fsr_434fcce05ac69af9f1a03c41` with `COMPLETE`,
      `BOUNDED_RANGE`, `historyCoverage=1`, 8 funding edges, and 1 settlement edge; exact report
      replay returned the same result hash
- [x] Durable Forensic Case export returned HTTP 200 with attachment headers for
      `fcb_cc_cbc5882e38541d136e76b491`; the bundle contained six Evidence closure nodes and three
      raw-artifact references, and offline verification returned `valid=true`
- [x] Bounded OS-level worker termination and durable lease recovery completed on
      `cpr_291f1385974bea974361c984`: attempt 1 was `LEASE_EXPIRED`, a new worker persisted
      `RETRY_WAIT`, and attempt 2 succeeded with `coverage=1`; mid-range checkpoint continuation
      remains distinct and unmeasured
- [ ] Archive-scale lifetime history, mid-range checkpoint continuation, independent-provider
      reconciliation, long-running monitor/reorg/outage delivery, calibration, remote CI/CodeQL,
      operational controls, Apache AGE projection validation, and production migration approval
      remain open

This checkpoint is a successful bounded durable validation, not terminal-product or production
acceptance. The earlier native-only checkpoint retained `coverage=0` and `confidence=0` for its
partial historical funding/settlement boundary; the later Transfer-log continuation reached
`coverage=1` for its bounded requested range. Neither result establishes lifetime history or
calibrated ownership confidence.

## Latest exact-range runtime and UI acceptance — 2026-08-14

- [x] Real public-provider BSC worker run for FFT
      `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`, range `113416950–113417450`, completed in one
      attempt as `cpr_69bcd768ac5a11f79eac968e`; the run took approximately 43 seconds after the
      graph traversal indexing repair and reached requested-range coverage `1`
- [x] Durable reports are present for ingestion `9336ae48-14df-41ec-8a5d-eb5e9eeac576`, Token
      History `thd_aa568929752934249b18c3a0`, Funding/Settlement
      `fsr_69562d9d17d47902a454afa8`, and Campaign `cc_7c24b67a08160c98321e311f`; the capture
      retained 46 Evidence IDs and final Snapshot block `113417450`
- [x] Provider-free Campaign replay returned the same result hash; exact range replay returned
      the matching Funding/Settlement report, while a non-matching range remained
      `Unknown(NOT_QUERIED)` rather than falling back to the latest token report
- [x] Provider-free Forensic Case export returned 18 Evidence closures, 8 Snapshots, and 7 raw
      artifacts; manifest hash `1fd5549f109a4a1dadd56536a22d289a3eca18d6a021b55920dd84b800c870f4`
      and offline `verifyForensicCaseBundle` returned `valid=true`; alert replay returned 2 alerts
- [x] Real API-backed desktop/mobile browser audit selected the same Campaign, displayed its exact
      `113416950–113417450` Funding/Settlement report, replayed/exported the stored bundle, and
      passed the 390px no-horizontal-overflow check
- [x] Full current gates passed: unit `725/725`, integration `126/126`, evaluation `1/1`,
      coverage `851/851` at Statements `82.00%`, Branches `75.12%`, Functions `91.63%`, Lines
      `83.55%`; format, lint, typecheck, build, license, audit (`0` vulnerabilities), Compose,
      SBOM, Chromium desktop/mobile E2E `38/38`, and Windows-wrapper E2E `38/38`
- [x] The earlier non-empty performance run `cpr_3de02146b1ee64cb1d09f498` remains immutable
      failed history after explicit termination and terminal `CAPTURE_LEASE_EXPIRED`; indexed
      graph traversal removed the O(n²) report-stage stall without relabeling that failure
- [ ] Lifetime archive history, mid-range checkpoint continuation, independent-provider
      reconciliation, long-running monitor/reorg/outage delivery, calibration, Apache AGE
      projection validation, remote CI/CodeQL, operational controls, and production migration
      approval remain open

This is a bounded real-provider/runtime/UI acceptance result. It does not promote the token's
lifetime history, ownership, or Campaign confidence to calibrated Production Acceptance.

## Latest mid-range checkpoint recovery evidence — 2026-08-14

- [x] A real process-kill drill for FFT
      `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777` over blocks `113417951–113419950` reached
      durable ingestion cursor `113418951` before termination, then resumed to
      `113419951` after lease expiry and retry delay without replaying the committed prefix
- [x] Token History report `thd_46beba0e5be5e4603e3e4184` completed with
      `historyCoverage=1`, `dataCoverage=1`, `sourceCoverage=1`, final Snapshot `113419950`,
      170 observations, 3 range Evidence IDs, and result hash
      `9b1ec586c1aa949acee2bf12295869fe9293cd63d0ddb736814adf798d6b8443`
- [x] Attempt history was preserved as `LEASE_EXPIRED` → retryable `NO_CANDIDATE_WALLETS` →
      terminal `NO_CANDIDATE_WALLETS`; exact-RPC errors remained explicit and no Campaign or
      confidence value was fabricated
- [ ] End-to-end mid-range Campaign continuation remains open because the public BSC endpoint
      returned seven exact-RPC errors; an independent archive-capable RPC must be qualified
- [x] Control comparison range `113416949–113417449` completed as
      `cpr_5849112c25ffdda4660a564b` with Campaign `cc_0a80a2ac4ef4863c0e715998`, Token History
      `thd_c9d8f0f331a95be0be4e1c2b`, 7 observations, 46 capture Evidence IDs, and result hash
      `952a44b75c8e47c185223ff0fcf8eff23dcd082b6a7ccf3ccffc75759a04021f`; the interrupted
      `cpr_332e7e49388f94e9856e276b` remains a separate provider-boundary failure

## Durable child-report interruption and idempotent recovery — 2026-08-14

- [x] Real BSC run `cpr_adc436a4f50877a19a786f3b` over `113418001–113420000` was interrupted after
      Token History `thd_994819fe2317a1637a240b80` and Funding/Settlement
      `fsr_dab67da14cc383ce80f4ff4e` were durable `COMPLETE` while the Campaign run remained
      `LEASED`
- [x] Natural lease recovery recorded attempt `LEASE_EXPIRED`; attempt 2 reused the exact-range
      Funding/Settlement report and completed Campaign `cc_5181df03a3ab8d47432d33ff` as
      `SUCCEEDED`, with 75 Evidence IDs, terminal Evidence `ev_3774c1ed3a4106980bb79724`,
      and capture coverage/confidence `1/1`
- [x] Result reference
      `control-campaign:cc_5181df03a3ab8d47432d33ff#sha256=56db92f5f0d255742e6619c74eb84dc93603874eea61dd2d50011f43ab8a60c2`
      matched durable Campaign state; no `FUNDING_SETTLEMENT_REPORT_CONFLICT` occurred on retry
- [ ] End-to-end mid-range Campaign continuation remains open; the 5,000-block and newer
      interruption histories with exact-RPC `UNKNOWN`/provider-boundary observations remain
      recorded failures

This closes durable child-report retry idempotency, not the broader mid-range checkpoint,
lifetime-history, independent-provider, calibration, or Production Acceptance gates.

## Token History Discovery Phase 1 — 2026-08-14

- [x] Phase 1 schemas, Evidence/Snapshot provenance, bounded SQD Transfer query, checkpointed
      ingestion callback, deployment-origin boundary, exact-RPC transaction/receipt boundary,
      Action Semantics binding, immutable PostgreSQL report, paginated replay, capability registry,
      worker profile, and public endpoint configuration are implemented and covered by tests
- [x] Formatting, ESLint, TypeScript, 660 unit tests, serially replayed enabled integration/evaluation tests,
      package/worker builds, license allowlist, zero high-severity production audit findings, and
      Compose model validation passed
- [x] Public SQD, BSC, Solana, and Blockstream Esplora read-only reachability probes passed
- [x] Bounded public BSC FFT smoke through the actual Token History Discovery composition passed:
      12 finalized observations, 5 exact-RPC/Action-Semantics bindings, `1/1/1` coverage,
      terminal requested-range checkpoint, and provider-free same-hash replay in memory-only stores
- [x] Fresh PostgreSQL/ClickHouse/MinIO token-history worker run with durable report replay for
      the bounded BSC FFT range; the second scheduler invocation claimed 0 runs
- [ ] Ethereum exact-RPC historical binding, lifetime archive completeness, and independent archive
      provider reconciliation
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
      replay (`85/85`)
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

## Provider-backed Control Campaign Phase 3 — 2026-08-14

- [x] Shared provider composition connects Token History observations to Token Flow, candidate,
      conserved Cluster Position, Behavior Event, Campaign, derived Evidence, and Forensic Evidence
      Line output; opening-balance gaps remain explicit and do not become zero balances
- [x] Shared exact-receipt Funding/Settlement provider helper is used by the live smoke and the
      finalized ingest worker; worker wiring persists Funding/Settlement and immutable Campaign
      reports when durable dependencies are available
- [x] Real BSC FFT smoke produced Token History `thd_5ef5001212f0b4c8409bfc7c`, Funding/Settlement
      `fsr_a3d4fdad3dd130e1bc8077f5`, and Campaign `cc_89ef265544cf3687b7633444`; Campaign and
      Funding/Settlement replay hashes matched their original runs
- [x] Legacy EVM source chain identity (`56`) is normalized to canonical `eip155:56` for derived
      Campaign snapshots without changing source Evidence IDs; targeted reconstruction test `1/1`
      covers this boundary
- [x] Campaign UI now shows source/history coverage and conserved position snapshots with explicit
      Unknown treatment for incomplete coverage
- [x] Fresh PostgreSQL/ClickHouse/MinIO worker capture and provider-free durable replay of the
      bounded FFT Campaign and Funding/Settlement reports
- [ ] Range-complete historical funding/settlement, independent provider reconciliation, service
      registry qualification, calibration, live monitoring, alert delivery, export, and production
      approval

## Forensic Case Bundle export closure — 2026-08-14

- [x] Canonical `forensic-case-bundle-v1` builder and offline verifier preserve Campaign identity,
      transitive Evidence closure, full Snapshots, raw-artifact references/hashes, source/model/
      policy registries, manifest hash, result hash, and typed incomplete/conflict errors
- [x] Provider-free API export/read routes are implemented for Control Campaigns and Forensic Cases;
      incomplete Evidence closure returns `422`, while unavailable durable Campaign storage remains
      `503`; no fixture or synthetic empty bundle is returned
- [x] Campaign UI downloads the JSON Case Bundle and displays case, closure, Snapshot, raw-artifact,
      and manifest counts; targeted desktop/Pixel 7 browser flow passed `2/2`
- [x] Core Case Bundle tests passed `3/3`; API integration replay passed `85/85`
- [x] Fresh real BSC FFT smoke produced Case `fcb_cc_89ef265544cf3687b7633444`, manifest hash
      `c2f152fb3bd90120a4340443ce8ac18112780d239c04816ecc7e4ccc3238b06a`, result hash
      `b85017621c05c9af69854755057f4efd13c648a6ee125a587b3f311d6480e8a5`, `10041` Evidence,
      `10011` Snapshots, `10005` raw-artifact references, and offline verification `true`
- [ ] Durable clean-store Campaign/Evidence export and restart/replay acceptance; live monitoring,
      alerts, calibration, and production approval remain open

This slice is implemented and real-provider exercised, but the smoke uses in-memory stores. It is
not durable production acceptance and does not unlock clean-store replay, live monitor, or alert
acceptance.

## BSC archive-range decomposition and durable replay closure — 2026-08-14

- [x] The real FFT token `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777` completed a contiguous
      bounded union over BSC blocks `113395944–113495943`: `100000/100000` blocks, no gaps, and
      `62` successful capture runs with `coverage=1`
- [x] Coarse single-range/10k/2k attempts remain explicitly failed or
      `ARCHIVE_RANGE_DECOMPOSED`; dense ranges were deterministically reduced to 500-block
      schedules, and partial Evidence was never promoted into a completed report
- [x] All `62` successful result references replayed to durable PostgreSQL reports with matching
      SHA-256 hashes (`26` Control Campaign and `36` empty-range Token History results); terminal
      Evidence and full closure membership were verified, then a new worker invocation claimed `0`
- [x] Real retry drill `cpr_dcb3eec655e2e32f6801eb74` recovered from retryable ClickHouse form-field
      overflow on attempt 1 and succeeded on attempt 2 with `coverage=1`, matching Campaign hash,
      `11,759` closure Evidence IDs, and zero missing Evidence
- [x] Real process-level interruption drill `cpr_291f1385974bea974361c984` recovered after the
      first worker was terminated: durable attempt history is `LEASE_EXPIRED` → `SUCCEEDED`,
      final `coverage=1`, result `thd_41f41c8eb868f68ce1e74e40`, and terminal closure is complete
- [x] Non-empty durable replay now filters shared Raw Facts by the requested Token and generic
      `evm-log:*` Evidence provenance; focused ingestion/Token History regression tests passed
      `21/21`. The earlier `cpr_5de47121ea35743df1e35c3d` remains immutable failed history after
      exposing the mixed-token/candidate replay defect and is not relabeled as success
- [x] A subsequent real bounded retry run `cpr_2a2de9522e889894d2eb20df` completed attempt 2 as
      `SUCCEEDED` with `coverage=1`, result reference
      `control-campaign:cc_713a3d1617f8aa807e92784b#sha256=f4881fa607242bccb3acdce70dd049903a352ae0e57a48ccf654b9d2b02a0f40`,
      and `12,000/12,000` capture Evidence closure; its attempt 1 was a later `HTTP_ERROR`, not
      an interrupted mid-range checkpoint
- [x] Live public BSC anchor probe reached `AGREEMENT` at finalized block `115888028` across two
      BNB Chain endpoints with `2/2` observations; source-operator independence remains explicitly
      Unknown because both endpoints are same-operator and registry independence was not queried
- [x] Long-running capture lease renewal and ClickHouse lightweight-key pagination were exercised
      against the real PostgreSQL/ClickHouse/MinIO stack; a post-restart live range read succeeded
      without deleting durable data
- [ ] Mid-range checkpoint continuation, lifetime token history, independent-provider
      reconciliation, archive-provider qualification, monitoring/alerts, calibration, and
      production migration approval remain open

This closes one bounded archive-range acceptance target. It does not promote the token's lifetime
history, ownership, or Campaign conclusions to production or calibrated truth.

## Token History backfill scheduling closure — 2026-08-14

- [x] `TOKEN_HISTORY_BACKFILL` is now a bounded, idempotent one-shot schedule with durable
      PostgreSQL schedule/run list and replay routes; first enqueue is `202`, same canonical range
      replay is `200`, and unsupported chain/range/storage states are typed rather than silently
      converted to an empty result
- [x] The semantic worker binds the schedule to finalized SQD plus exact read-only EVM RPC and
      persists restart-safe checkpoints, Raw Facts, raw artifacts, Evidence, Token History,
      Funding/Settlement, Control Campaign, derived Evidence, and terminal capture metadata
- [x] Worker/config/handler, scheduler identity, storage query, and API tests passed in the focused
      serial run; no private key, signing, broadcast, fixture, or mock entered the production path
- [x] Clean PostgreSQL/ClickHouse/MinIO execution and provider-free replay completed for the
      bounded range; the first memory-limited attempt is retained as a historical failure and was
      followed by a successful batched run
- [x] Bounded BSC archive-range union acceptance is recorded above
- [ ] Interrupted/resumed-run semantics, lifetime archive completeness, independent source
      reconciliation, and production migration approval remain open

The worker's capture `confidence` is the bounded technical completeness of the capture result. The
provider-backed Campaign remains `UNCALIBRATED`; no Campaign probability is inferred from this
field.

## Incremental monitor, alert, and replay-stream Phase 4 slice — 2026-08-14

- [x] `TOKEN_LIVE_CAPTURE` interval schedules are idempotent across enqueue timestamps, exposed by
      both the legacy token monitor route and the target-package monitor/read routes, and preserve
      explicit target, range, interval, retry, and next-run state
- [x] The worker requires durable schedule history, reads finalized EVM heads, advances from the
      prior successful Snapshot, checks the prior finalized block hash, captures only a bounded new
      range, and fails closed on cursor/reorg disagreement or unsafe numeric ranges
- [x] Immutable `forensic-campaign-alert-v1` records, PostgreSQL migration `034_control_campaign_alerts`,
      append-only guards, deferred Evidence linkage, severity/classification/suppression metadata,
      and runtime health/close wiring are implemented
- [x] JSON alert replay and finite provider-free SSE (`campaign` → `alert*` → `complete`) are
      implemented; the Campaign UI displays alert severity/Evidence and monitor status without
      suggesting probability, ownership, signing, or broadcast
- [x] Focused serial API/scheduler/storage/worker validation passed `101/101`; the updated
      Campaign browser flow passed Chromium desktop and Pixel 7 `2/2`; production build passed
- [x] The latest real BSC FFT smoke for `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777` over
      `113485950–113495949` remained `COMPLETE` with 12 observations, 10,029 Raw Facts, 10,041
      Evidence, same-hash replay, four derived alerts including one `CRITICAL` alert, and an
      offline-verified Case Bundle `fcb_cc_0d408b71b4990acd0ddb97cd`
- [x] Clean PostgreSQL/ClickHouse/MinIO bounded capture and provider-free replay completed for the
      named FFT range; durable alert rows and terminal Evidence were persisted
- [ ] Interrupted-run replay, long-running real monitor progression, forced reorg/outage delivery,
      restart-persistent alerts, calibration, and production migration approval remain open

## Current local gate (2026-08-14)

- [x] `npm run format:check`, full ESLint, TypeScript typecheck, production build,
      production license allowlist, `npm audit --audit-level=high` (0 vulnerabilities), and SBOM
      generation
- [x] `npm run test:unit`: 725/725 tests across 131 files
- [x] `npm run test:integration`: 126/126 against the configured isolated PostgreSQL/ClickHouse/
      MinIO acceptance services; Apache AGE projection remains an explicit unmeasured gate
- [x] `npm run test:evals`: 1/1 structural Entity evaluation
- [x] Serial Playwright E2E: 38/38 across Chromium desktop and Pixel 7; Flap long-value mobile
      layout regression passed in both projects (`2/2`)
- [x] Windows wrapper E2E (`npm run test:e2e:windows`): 38/38 across Chromium desktop and Pixel 7
- [x] Targeted Control Campaign Timeline/Evidence/Alert/Monitor E2E: 2/2 (Chromium desktop and Pixel 7)
- [x] Phase 3 targeted provider tests: Campaign reconstruction `1/1` and Funding/Settlement
      composition `3/3`; campaign, funding/worker package builds, and web production build passed
- [x] Phase 4 monitor/alert focused tests passed `101/101`; real FFT smoke derived four
      Evidence-bound alerts and the finite SSE/API replay contract passed integration coverage
- [x] `docker compose config --quiet`
- [x] `npm run test:coverage`: 851/851 tests completed with configured thresholds passing
      (Statements 82.01%, Branches 75.14%, Functions 91.63%, Lines 83.56%)
- [x] Isolated acceptance PostgreSQL/ClickHouse/MinIO bootstrap and migrations through PostgreSQL
      `036`, plus ClickHouse raw/control-flow DDL; Apache AGE projection was not measured because
      the acceptance PostgreSQL service lacks the extension
- [x] Real durable FFT worker completion for the latest bounded range: run
      `cpr_69bcd768ac5a11f79eac968e` is `SUCCEEDED`, with 46 capture Evidence IDs and final
      Snapshot block `113417450`; exact Campaign-range Funding/Settlement replay was verified
- [x] Bounded BSC archive-range union and provider-free replay closure are recorded above
- [ ] Lifetime archive/interrupted-run acceptance and production migration approval remain open
- [ ] Remote protected-branch CI/CodeQL for the current uncommitted Phase 4 changes; earlier PR #20
      runs are historical evidence for their recorded heads only

This local gate does not promote ZeroTrace to production acceptance. Full-history ingestion,
independent-provider reconciliation, effective authorization/history, intent attribution and other
unchecked terminal-scope items below remain open.

## Solana dealer, Bitcoin forensic graph, and launchpad registry slice — 2026-08-14

- [x] Provider-backed Solana dealer reconstruction carries exact Snapshot/Evidence/coverage
      metadata and exposes off-curve PDA owner suppression as `pdaSuppressedOwnerIds`; focused
      reconstruction tests passed `2/2`
- [x] Bounded Bitcoin forensic graph builder, immutable PostgreSQL migration `036`, repository,
      API routes, CoinJoin/PayJoin/service/incomplete-context suppression ledger, and no automatic
      ownership merge; focused graph/storage/API tests passed `6/6`
- [x] Versioned read-only launchpad provenance registry and decoder activation policy cover Flap,
      Pump/PumpSwap, Raydium LaunchLab, Meteora DBC, Moonshot/Moonit, Four.meme and FomoWell;
      Pump and PumpSwap have pinned `READY_READ_ONLY` versions with four-node real-provider
      provenance graphs, while Raydium has a source-pinned partial clean-room decoder and the
      remaining activation gates stay blocked; registry/index focused tests passed `33/33`
- [x] Pump/PumpSwap clean-room decoder pins the official source commit and IDL hashes, matches
      only official program IDs/discriminators, preserves incomplete layouts as warnings, emits
      Evidence/Snapshot-bound `launchpadObservations`, and renders the result in the Solana UI
- [x] Public finalized Solana live smoke captured Pump `buy` signature
      `3QTGbxYPzDg4WDS57MCivWpEJMsyRZmkMR6EsfTm9PjRFt3KpMrXuDfsarc2Z38uSPJH73DHRCDnxXrU9nNjrEec`
      at slot `439138804`; account/argument coverage was `1/1`, decoder replay was same-hash,
      and executable program identity was observed at a minimum-context-safe RPC response
- [x] Public Blockstream Esplora live smoke captured confirmed transaction
      `5a05b95e120e23efba087251dc612b053129d808f7f3f82e50b696f0cb139d10` at best-chain height
      `962362`, producing report `bfg_0b91cbdc32b7844e82bb36ca` with 9 nodes, 10 edges, 3 Evidence
      nodes, provider `UP`, and a frozen Snapshot replay with `sameHash=true`
- [x] A fresh provider-backed BSC FFT replay over `113485950–113495949` produced 12 finalized
      observations, 5 exact bindings, `1/1/1` Token History coverage, same-hash Campaign and
      offline-verified Case Bundle replay. The latest run kept report
      `thd_5ef5001212f0b4c8409bfc7c` with result hash
      `548205baa794840755cd69db017356daf70dbf824eb995fe75289c023573fb67`; Funding/Settlement
      remained `PARTIAL` `1/1/0` history coverage because historical `eth_getCode` returned
      `missing trie node`
- [ ] Real Solana dealer archive validation, Bitcoin Core/archive reconciliation, remaining named
      launchpad/migration fixtures, and durable clean-store replay

This slice is implemented and tested locally, but it does not satisfy the external archive,
license, historical-fixture, calibration, or durable-store gates required for production approval.

## Control Campaign P0 local gate (2026-08-13)

- [x] Token Flow, candidate discovery, cluster-position conservation, Behavior Event, Campaign and
      Forensic Evidence Line contracts compile and pass deterministic tests
- [x] Immutable PostgreSQL Control Campaign repository rejects invalid identity/provenance and
      reports storage-down explicitly; ClickHouse flow/position DDL is present
- [x] Provider-free Campaign overview/list/replay, timeline, positions, wallets, graph and
      Evidence Line API routes plus Campaign Timeline/Evidence Line UI are wired
- [x] Unconfigured scheduler/report storage returns `503`; bounded backfill enqueue/replay is
      implemented while monitor, alerts, stream and calibrated attribution retain explicit
      boundaries
- [ ] Real finalized multi-provider token-history discovery and bounded backfill execution in a
      clean store, live monitoring, alert delivery, export acceptance, calibration corpus, and
      production migration acceptance

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
  - [x] Bounded Bitcoin forensic UTXO graph, suppression ledger, no-ownership-merge boundary, and
        public Esplora live capture/replay; Bitcoin Core/archive reconciliation remains open
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
  - [x] Versioned read-only launchpad provenance registry, official source ledger, license-boundary
        policy, generic unknown-mechanism detection, API/UI display, and decoder activation gate
  - [ ] Complete FFT migration fixture, forced reorg drill, lifecycle and sell/execution RV linkage
  - [x] Pump/PumpSwap official-version read-only decoder, executable program identity, four-node
        provenance graph, finalized mainnet provider capture, and API/UI observation display
- [x] Raydium LaunchLab source-pinned partial clean-room discriminator/account/Borsh decoder,
      including Token-2022 initialization, migration arguments, and the raw PoolState layout,
      API/UI observation wiring, and explicit blocked activation policy
- [ ] Raydium LaunchLab historical pool-state reads/remaining-account completion and real finalized Evidence closure;
      Meteora DBC, Moonshot, Four.meme and FomoWell adapters
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
- [x] Responsive Bitcoin forensic graph and Solana dealer evidence panels show coverage, Snapshot,
      suppression boundaries, PDA exclusions, graph edges, Evidence and result hashes without
      presenting ownership conclusions
- [x] Responsive launchpad platform cards expose official-source provenance and pinned-version
      state; unpinned named platforms remain visibly blocked rather than appearing supported
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
