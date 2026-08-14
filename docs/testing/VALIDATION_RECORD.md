# Local Validation Record — 2026-08-14

This record captures the latest local acceptance run. It is evidence for the runnable foundation,
not a terminal-product or production-deployment approval.

## Local acceptance hardening and durable worker attempt — 2026-08-14

- The final local gate passed formatting, ESLint, TypeScript typecheck, package/API/web/worker
  builds, production license allowlist, `npm audit --audit-level=high` with zero vulnerabilities,
  SBOM generation, and `git diff --check`.
- `npm run test:unit` passed `700/700` tests across `130` files; `npm run test:integration` passed
  `125/125` against isolated PostgreSQL, ClickHouse, MinIO, and Apache AGE acceptance services
  after migrations through PostgreSQL `036`; `npm run test:evals` passed `1/1`.
- `npm run test:coverage` passed `825/825` tests with Statements `81.87%`, Branches `75.00%`,
  Functions `91.71%`, and Lines `83.40%`, meeting the configured global thresholds.
- Rebuilt Playwright Chromium desktop/mobile E2E passed `38/38`; the Windows wrapper repeated
  `38/38`. The generated build artifacts stayed under their configured output directories.
- A fresh isolated acceptance Compose project initialized PostgreSQL/ClickHouse/MinIO/AGE and the
  full integration suite replayed successfully. A real public-provider FFT durable Token History
  schedule/run then reached ClickHouse ingestion/query but failed closed after retry at
  `MEMORY_LIMIT_EXCEEDED` / OvercommitTracker. The run is `FAILED_TERMINAL`; no durable report was
  promoted or relabeled as success. The in-memory real-provider smoke and provider-free same-hash
  replay remain bounded evidence only.
- The failed durable run is an infrastructure-capacity gate, not evidence of a semantic zero or a
  successful production capture. Durable completion, restart replay, archive-scale history,
  multi-provider reconciliation, calibration, alerts/export, and production approval remain open.

## Token History Discovery Phase 1 validation — 2026-08-14

This checkpoint covers the implemented read-only Phase 1 path. It is not production qualification.

- `npm run format:check`, full ESLint, full TypeScript typecheck, package/worker builds, the
  production license allowlist, `npm audit --omit=dev --audit-level=high`, and
  `docker compose config --quiet` passed; the audit reported zero high-severity production
  vulnerabilities;
- `npm run test:unit` passed `610/610` tests across `109` files;
- the parallel `npm run test:integration` invocation had one API-contract setup timeout; a bounded
  serial Vitest replay passed `81/81` enabled cases, with `38` explicit optional-store/provider skips;
  `npm run test:evals` passed `1/1` structural Entity evaluation;
- focused Phase 1 tests passed `65/65` cases across SQD transport, capability declarations, token
  history, immutable report storage, ClickHouse range pagination, and worker configuration;
- public read-only endpoint probes returned `SQD=200`, `BSC eth_chainId=0x38`,
  `Solana getHealth=ok`, and `Blockstream Esplora tip height=962307`. These are reachability and
  protocol-shape smoke observations, not semantic history acceptance;
- the current process had no `ALCHEMY_API_KEY`, `ETH_RPC_URL`, `BSC_RPC_URL`, `SQD_PORTAL_URL`,
  `SOLANA_RPC_URL`, or `BTC_ESPLORA_URL` variables. The key was not written to the repository or
  printed. Therefore Ethereum exact-RPC token history is `NOT_MEASURED` in this checkpoint;
- the worker now fails closed unless the token-history discovery report and Action Semantics
  PostgreSQL migrations are healthy. A fresh durable token-history range, exact-RPC binding on
  Ethereum, archive-scale backfill, provider reconciliation, live monitoring, alerts, export,
  calibration, and remote CI/CodeQL remain open acceptance gates.
- a real BSC worker invocation against the existing PostgreSQL/ClickHouse/MinIO stack reached the
  durable preflight but failed closed with ClickHouse error `241 MEMORY_LIMIT_EXCEEDED` under the
  existing roughly `800 MiB` server limit; it emitted no report and no result was promoted. A
  separate clean-store Compose attempt was stopped after BuildKit wedged the Docker Desktop Linux
  backend, so clean-store token-history acceptance remains `NOT_MEASURED` rather than `PASS`.
- a fresh bounded live smoke through the actual Token History Discovery composition used FFT
  `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777` over BSC blocks `113485950–113495949`. It produced
  12 finalized observations, 5 exact-RPC-and-Action-Semantics-bound transactions, a terminal
  `REQUESTED_RANGE_COMPLETE` checkpoint, `1/1/1` data/source/history coverage, 10,029 Raw Facts,
  and 10,029 Evidence records. SQD completed in 3 requests with 0 retries; exact BSC RPC was
  `UP`, `CLOSED`, and 12/12 successful attempts. The report replay returned the same result hash
  without providers (`thd_5ef5001212f0b4c8409bfc7c`, result hash
  `d8d35b8a10317c3de5756c524db296a9b609cd535e632706990823f30deaede9`). This smoke used
  in-memory stores only, so it is not durable production
  acceptance; deployment origin correctly remained `Unknown/NOT_QUERIED` because the requested
  range does not prove token lifetime.
- the real ZeroTrace UI path `Trace → Inspect` against the same FFT address returned a live BSC
  Snapshot, contract classification, versioned Flap state, and Evidence. At 390px, long addresses
  and atomic values now wrap inside `.fact-row`; the regression ran on Chromium desktop and Pixel
  7 (`2/2`). The full serial browser suite passed `38/38`.

## Funding and Settlement Phase 2 validation — 2026-08-14

This checkpoint records the bounded evidence layer and real public-chain smokes. It is not durable
production acceptance.

- The engine passed `7/7` focused tests, including transaction/receipt identity rejection,
  failed/provisional `UNKNOWN` status, service-boundary suppression, bounded hop limits, and
  endpoint-convergence suppression. Storage passed `3/3`; API integration passed `83/83`; the
  Campaign plus Funding/Settlement UI route passed Chromium desktop and Pixel 7 `2/2`.
- BSC FFT `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`, blocks `113485950–113495949`, produced
  report `fsr_d53d644a6be1844432e03b65`, result hash
  `dc4c244a395b634fc07bde3f00f8b8bc726f8e3fde83d06fe84c805c84795e1c`, status `PARTIAL`, scope
  `TRANSACTION_LOCAL`, coverage `1/1/0`, two funding edges, one sell-proceeds settlement edge,
  and provider-free same-hash replay. Historical BSC code probes returned `missing trie node`;
  four exact transaction senders were used as the explicitly labeled focus fallback. Current code
  was not substituted.
- Ethereum WETH `0xc02aa39b223fe8d0a0e5c4f27ead9083c756cc2`, block `25748600`, produced report
  `fsr_1c1a7d6564b8d2a3e71b8887`, result hash
  `c09432ddafcf97969d252c2939a585f188d8ba8a297577cd99941d2522b8d4ea`, status `PARTIAL`, scope
  `TRANSACTION_LOCAL`, coverage `1/1/0`, one funding edge, one sell-proceeds settlement edge,
  and provider-free same-hash replay. Exact transaction/receipt binding succeeded; historical
  origin/code expansion was explicitly `NOT_QUERIED`.
- Both reports were generated from bounded in-memory smoke composition with S3-shaped raw artifact
  references. They were not written through a fresh PostgreSQL/ClickHouse/MinIO production run.
  No report is promoted to range-complete history, entity ownership, calibrated probability,
  service attribution, or live monitoring acceptance.
- The full coverage command completed all `703` enabled tests and `38` skips, but the configured
  global threshold was not met locally: Statements `77.27%`, Branches `70.78%`, Lines `78.56%`.
  Existing low-covered worker/storage boundary files account for most of the gap; this result is
  recorded as a failed gate rather than weakened or relabeled. SBOM generation passed. Docker
  daemon validation remained unavailable because `dockerDesktopLinuxEngine` was not running.

## Provider-backed Control Campaign Phase 3 validation — 2026-08-14

This checkpoint records the current provider composition and UI regression. It is not durable
production acceptance.

- `npm run test:unit` passed `635/635` tests across `117` files. The Phase 3 targeted provider
  tests passed `4/4`: Campaign reconstruction `1/1` and shared Funding/Settlement composition
  `3/3`; the focused backfill checks passed `100/100`.
- Full TypeScript typecheck, production build, formatting, ESLint, license allowlist, audit with
  zero vulnerabilities, SBOM generation, and `git diff --check` passed. The production E2E run
  rebuilt the app and passed `38/38` across Chromium desktop and Pixel 7, including the Control
  Campaign Timeline/Evidence Line flow. The Windows wrapper (`npm run test:e2e:windows`) repeated
  the same `38/38` result.
- A fresh real BSC FFT smoke over blocks `113485950–113495949` produced Token History
  `thd_5ef5001212f0b4c8409bfc7c` with latest run hash
  `0fdd7d8b0e32a2bef9cfd35573bfbfc6f1422de2935c210e409821d345a9f72a`, Funding/Settlement
  `fsr_a3d4fdad3dd130e1bc8077f5` with hash
  `e8f6bd68b7c584750814f28e610316c053630b3900ec88c7ea5b774958183d22`, and Campaign
  `cc_89ef265544cf3687b7633444` with bundle hash
  `2f126ea842f1136fe1e0bcf54fe8ef95f699604de8c4c998a19b656a8b65b271`. Funding/Settlement and
  Campaign provider-free replay hashes matched their original runs.
- The real smoke remained bounded and in-memory: Token History coverage was `1/1/1`; the
  Funding/Settlement report was `PARTIAL`, `TRANSACTION_LOCAL`, coverage `1/1/0`, with two
  funding edges and one sell-proceeds settlement edge; the Campaign remained `UNCALIBRATED`,
  selected five wallets, and reported five opening-balance-unknown wallets. Historical BSC code
  probes returned `missing trie node`; transaction-sender fallback stayed explicitly labeled and
  current code was not substituted.
- `npm run test:coverage` completed all `707` enabled tests with `38` explicit skips, but failed
  the configured global thresholds at Statements `77.32%`, Branches `70.88%`, Functions `87.76%`,
  and Lines `78.62%`. Low-covered worker/storage boundaries remain the primary gap; this is
  recorded as a failed gate, not relabeled as acceptance.
- Fresh PostgreSQL/ClickHouse/MinIO worker capture and durable replay remain `NOT_MEASURED`;
  clean migration bootstrap is unavailable because the local Docker Desktop Linux engine named
  pipe is absent. Archive-scale history, independent provider reconciliation, service-registry
  qualification, calibration, live monitoring, alerts, export, remote CI/CodeQL, and production
  approval remain open.

## Forensic Case Bundle export closure — 2026-08-14

- The provider-free Case Bundle builder and verifier passed `3/3` focused tests. It validates the
  stored Control Campaign, walks every referenced Evidence source, rejects missing closure,
  conflicting payloads, and cycles, and emits full Snapshot/artifact/source/model/policy registries
  with manifest and result hashes. Same chain-anchor Snapshots with different capture metadata are
  preserved separately by full Snapshot hash rather than overwritten.
- API integration replay passed `85/85` after adding Control Campaign export and
  `/api/v1/forensics/cases` create/read/export routes. A missing durable Campaign remains `503`;
  incomplete Evidence closure is `422`; no fixture or synthetic empty case is returned.
- The Campaign UI downloads the JSON bundle and shows the Case ID, Evidence/Snapshot/raw-artifact
  counts and closure state. The targeted desktop/Pixel 7 flow passed `2/2`.
- A fresh real BSC FFT smoke over `113485950–113495949` produced Case
  `fcb_cc_89ef265544cf3687b7633444`, manifest hash
  `c2f152fb3bd90120a4340443ce8ac18112780d239c04816ecc7e4ccc3238b06a`, result hash
  `b85017621c05c9af69854755057f4efd13c648a6ee125a587b3f311d6480e8a5`, with `10041` Evidence,
  `10011` Snapshots, `10005` raw-artifact references, and offline verification `true`.
- The smoke is real-provider but in-memory. Durable clean-store export/replay, backfill execution,
  monitoring, alerts, calibration, and production acceptance remain `NOT_MEASURED`/open; this
  slice does not unlock clean-store production acceptance.

## Token History backfill scheduling and handler binding — 2026-08-14

- The API now validates bounded Ethereum/BSC ranges and exposes both the legacy-compatible
  `/api/v1/control/tokens/:chainId/:token/backfill` route and the target-package
  `/api/v1/control-campaigns/EVM/:chainId/:token/backfills` alias. The first canonical request is
  `202`, repeated range requests replay the same one-shot schedule with `200`, and GET routes
  replay schedule/run state without contacting providers.
- The scheduler identity for one-shot `TOKEN_HISTORY_BACKFILL` excludes enqueue time while retaining
  the actual trigger in the immutable definition, closing the concurrent-request duplicate window.
  The storage repository now lists schedules by target/kind and runs by schedule ID.
- The semantic worker's production handler validates target/parameter identity, requires durable
  PostgreSQL/ClickHouse/versioned object storage, selects Ethereum/BSC read-only RPC by dataset,
  executes `TokenHistoryDiscovery`, hydrates/persists Evidence closure, derives Funding/Settlement
  and Control Campaign reports, and commits a terminal Evidence-bound capture result through the
  existing lease/retry state machine. Provider failures, missing historical state, Evidence gaps,
  and fact-budget overflow remain typed failures; no zeros or synthetic reports are used.
- Focused serial validation passed `100/100` across the API, capture scheduler, storage query,
  worker configuration, and worker handler tests; `npx tsc -b --pretty false` passed. A real durable
  worker execution was not promoted because the local Docker Desktop Linux engine is unavailable;
  the existing real BSC smoke remains an in-memory provider exercise.

## Incremental monitor, alert, and replay-stream validation — 2026-08-14

- Focused serial API/scheduler/alert-storage/live-handler validation passed `101/101`: API monitor
  enqueue/replay/read, JSON alert replay, finite SSE framing, interval identity stability, alert
  repository conflict/round-trip checks, and the worker's durable-schedule requirement are covered.
- The API build and production web build passed. The Campaign UI now calls the provider-free alert
  route when a report is selected, renders severity/Evidence/suppression state, and exposes a
  finalized incremental monitor action. The updated Chromium desktop and Pixel 7 flow passed `2/2`.
- The live monitor's production handler remains read-only and fails closed on missing durable
  schedule history, unsafe numeric ranges, finalized cursor regression, or block-hash mismatch.
  It does not use current state as a substitute for unavailable historical state.
- A fresh real BSC FFT smoke for `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777` over
  `113485950–113495949` produced `thd_5ef5001212f0b4c8409bfc7c`, 12 observations, 10,029 Raw
  Facts, 10,041 Evidence, same-hash replay, four derived Evidence-bound alerts, and offline Case
  Bundle verification (`fcb_cc_1eaa01396441cbf9e846edfd`). It used in-memory stores and therefore
  does not establish durable monitor/alert persistence or restart acceptance.
- The final host gates recorded `639/639` unit tests across 118 files, `87` enabled integration
  tests with `38` explicit skips, `1/1` eval, full rebuilt Playwright `38/38` and Windows-wrapper
  `38/38`, plus format/lint/typecheck/build/license/audit/SBOM/Compose checks. Coverage completed
  `726` enabled tests with `38` skips but remained below thresholds at `76.48%` statements,
  `70.25%` branches, `86.87%` functions, and `77.86%` lines.
- Clean PostgreSQL/ClickHouse/MinIO persistence, long-running monitor progression, forced reorg and
  provider-outage delivery, alert restart/replay, calibration, and migration acceptance are
  `NOT_MEASURED`; Docker Desktop's Linux engine is unavailable on this host.

## Control Campaign P0 checkpoint validation — 2026-08-13

This checkpoint records the first read-only Control Campaign implementation before continuing to
provider-backed Token History Discovery. It is a local implementation gate, not production
qualification.

- P0 contracts and engines passed the repository test suite: `599/599` unit tests across `106`
  files, `81` integration tests with `38` explicit optional-store/provider skips, and `1/1` model
  evaluation;
- formatting, ESLint, TypeScript, production build, production license allowlist and
  `npm audit --audit-level=high` passed with `0` high-severity vulnerabilities;
- the new Campaign Timeline/Evidence Line UI passed Chromium desktop and Pixel 7 targeted E2E
  `2/2`; the latest fully-parallel host run was `33/38` because five pre-existing views timed out
  under load, and serial replay of those eight views passed `8/8`;
- `git diff --check` passed and no credential-shaped secret was found in the P0 diff; phrases such
  as `private-key custody` are architectural prohibitions, not credentials;
- `docker compose config --quiet` passed, but empty-database bootstrap for PostgreSQL migration
  `031_control_campaign_reports.sql` and ClickHouse migration `002_control_campaign_flow.sql`
  remained unavailable because the local Docker Desktop Linux engine named pipe was absent;
- provider-backed historical discovery, real finalized-chain campaign capture, calibration and
  remote CI/CodeQL for this uncommitted checkpoint remain open gates.

## Environment

| Component      | Version / context                                  |
| -------------- | -------------------------------------------------- |
| Host           | Windows, workspace path containing Unicode         |
| Node.js        | 24.11.1                                            |
| npm            | 11.6.2                                             |
| Docker Engine  | 29.2.1                                             |
| Docker Compose | 5.1.0                                              |
| Browser        | Playwright Chromium 151, desktop and Pixel 7 modes |

The validation stack used alternate host ports to avoid unrelated local services: API `18080`, web
`15173`, PostgreSQL `15432`, ClickHouse `18123`, Valkey `16379`, NATS `14222/18222`, and MinIO
`19000/19001`. Container-internal ports remain the documented defaults.

## Clean container and database result

- API, web, PostgreSQL, ClickHouse, Valkey, NATS, and MinIO reached running state;
- API, web, PostgreSQL, ClickHouse, and Valkey health checks reported healthy;
- the production-pruned API image measured `75,905,711` bytes and the web image measured
  `26,257,140` bytes in this Docker Engine;
- `vitest` and `pino-pretty` were absent from the API image; npm retained `typescript` as an optional
  peer in the pinned `viem`/`abitype` graph;
- in the original full-stack run, PostgreSQL applied `001_core` and `002_indexes`, created the six
  representative core tables checked by the run, and installed four append-only triggers;
- ClickHouse created `raw_chain_facts`, `platform_events`, and `metric_series`; `CHECK TABLE` passed
  and `metric_series` retained its Known/value consistency constraint;
- a transactional mutation probe was rejected by PostgreSQL's Evidence trigger and rolled back with
  zero rows persisted;
- an `UNKNOWN` metric carrying a numeric value was rejected by ClickHouse with
  `VIOLATED_CONSTRAINT` and zero probe rows persisted;
- the web proxy returned API health, and the web response included CSP, frame denial, referrer, and
  content-type hardening headers.

Database initialization SQL is copied into dedicated image stages. This avoided a reproduced Docker
Desktop bind-mount stall caused by the Unicode workspace path.

## Public-chain smoke observations

The host network uses an interception proxy that maps public names to the reserved `198.18.0.0/15`
range. With the secure default `ALLOW_PRIVATE_PROVIDER_URLS=false`, ZeroTrace correctly returned
`PRIVATE_NETWORK_BLOCKED`. For this local smoke only, the explicit opt-in was enabled while the exact
hostname allowlist, HTTPS restriction, redirect denial, and read-only method allowlists remained in
force.

### Bitcoin mainnet

- provider: Blockstream Esplora;
- snapshot height: `961647`;
- block hash: `00000000000000000000c77603e60771be65dc27421aebff0b7a66edd29703d7`;
- subject: `bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4`;
- normalized facts: confirmed balance `0` sats, mempool delta `0` sats, transaction count `166`;
- Evidence ID: `ev_bd75318d39376f50da863a0f`;
- consistency marker: `BEST_EFFORT_ESPLORA_TIP`.

The zero balances above are provider-returned Known values at the recorded snapshot, not a fallback
for unavailable data.

### Solana mainnet

- provider: official public Solana JSON-RPC;
- commitment: `finalized`;
- snapshot slot: `438084246`;
- blockhash: `7HuThTxhLV7dgzcqVL1iAQeaFqyuk259Mjf4AUyk1EL8`;
- subject: system program `11111111111111111111111111111111`;
- normalized facts: account exists, `1` lamport, executable, owner
  `NativeLoader1111111111111111111111111111111`;
- Evidence ID: `ev_6d7be195e513ed7b3d264a62`.

### Initial smoke boundaries

- Ethereum and BNB Smart Chain remained `UNCONFIGURED` in this initial smoke. A later follow-up is
  recorded below.
- The two observations are floating-head smoke checks. They are not immutable fixture suites, archive
  validation, independent provider reconciliation, reorg tests, or protocol-decoder acceptance.
- this initial smoke predated repository wiring, so those two observations were intentionally
  process-local. Current Compose runs persist new observations as described in the follow-up below.

## Four-chain provider follow-up

After the resilient transport and safe hostname-based source IDs were wired, the same API process
completed snapshot-pinned subject reads on all four configured networks. The supplied Ethereum key
was injected only into the test process, was not printed, and was removed from that process after the
run. It was not written to the repository.

| Chain           | Safe source ID                           | Snapshot head | Snapshot hash                                                        | Evidence ID                   |
| --------------- | ---------------------------------------- | ------------- | -------------------------------------------------------------------- | ----------------------------- |
| Ethereum        | `ethereum-rpc@eth-mainnet.g.alchemy.com` | `25717412`    | `0x57ac811472c6b3592809e17b60479951224ee71462b86c09185c592ff085ed8d` | `ev_fcddbf315c8dcb12cd8f981b` |
| BNB Smart Chain | `bsc-rpc@bsc-dataseed.bnbchain.org#1`    | `114928609`   | `0xd0ac31a0fe4489e44b79dc39e32aba3377a806a700650929381783c02f00ef38` | `ev_75d3538400d4f07a48ce3756` |
| Bitcoin         | `bitcoin-esplora@blockstream.info`       | `961727`      | `00000000000000000000b79b7b22483afc3b9c8ba10860a468d7cfe2b12615ba`   | `ev_9d74234ba23dac03a7679fae` |
| Solana          | `solana-rpc@api.mainnet.solana.com`      | `438197081`   | `FMw2JVJwE5GAxTrGVBXFsP9QzRk57AkaswxRLjUjQn7r`                       | `ev_6ecb9cd4d7f3dbf415c59779` |

All four subject requests returned HTTP 200 and Known facts rather than converting provider state to
zero. The Ethereum and BSC subject was the zero address and returned the provider-reported native
balance plus `EOA`; Bitcoin returned confirmed/mempool balances and transaction count; Solana
returned the System Program account state. Snapshot capture times ranged from
`2026-08-09T12:26:26.144Z` to `2026-08-09T12:26:34.605Z`.

This validates the current-state happy path and Evidence construction only. It does not validate
archive history, a forced real-provider failover, cross-provider semantic agreement, reorg/finality
handling, or any launchpad decoder. The local interception-proxy exception described above remained
necessary for this host.

## Current-state Snapshot anchor correction

On 2026-08-10 the adapter contracts were corrected and re-probed against all four live networks:

| Chain           | Anchor contract                                    | Observed position | Result                                                                                |
| --------------- | -------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| Ethereum        | `eth_getBlockByNumber("finalized", false)`         | `25718782`        | canonical block hash/timestamp and pinned balance/code accepted                       |
| BNB Smart Chain | `eth_getBlockByNumber("finalized", false)`         | `114967284`       | canonical block hash/timestamp and pinned zero-address balance accepted               |
| Bitcoin         | tip height followed by `/block-height/:height`     | `961756`          | same-height best-chain hash accepted                                                  |
| Solana          | finalized `getSlot`, then slot-specific `getBlock` | `438238158`       | real blockhash/timestamp accepted; System Program context `438238160` met the minimum |

The Solana Snapshot now uses the blockhash returned for the selected slot, not the unrelated recent
transaction blockhash returned by `getLatestBlockhash`. Bitcoin no longer samples tip height and tip
hash independently. EVM Snapshot metadata records the configured finality tag, and malformed or
non-canonical quantities/data fail closed. The Solana account probe also confirmed lossless account
quantities and an explicit distinction between `value: null` and a malformed/missing value.

The Ethereum credential was injected only into the probe process and was neither printed nor written
to disk. These are public current-head smoke observations, not immutable archive fixtures,
independent-provider reconciliation, forced-reorg acceptance, or proof that Esplora address
aggregates are historical-state pinned.

## Durable Evidence repository follow-up

A separate disposable Compose project built a fresh `postgres:17.10-alpine` target, applied
`001_core`, `002_indexes`, and `003_evidence_integrity`, ran the real node-postgres repository tests,
and then removed its container, network, and named volume. All four integration cases passed:

- schema/migration-aware storage health returned `POSTGRES`, `UP`, and `durable: true`;
- a Snapshot-bound raw observation was written, read, and idempotently re-written without mutation;
- a derived node and its source edge survived pool shutdown/restart and complete drilldown replay;
- SQL rejected Evidence mutation, edge mutation, raw-fact derivation, post-commit edge-set expansion,
  and inferred Evidence with no source observation.

A subsequent default-topology smoke built the current API, web, and PostgreSQL images, started a
fresh PostgreSQL/ClickHouse/Valkey/API/web dependency chain, and verified:

- API liveness returned `UP` with `readOnly: true`;
- storage health returned `POSTGRES`, `UP`, and `durable: true`;
- the capability ledger reported `evidence-ledger: IMPLEMENTED_DURABLE`;
- the Nginx web health endpoint returned HTTP 200;
- the full API health was `DEGRADED` because no public provider became healthy in that isolated
  container run, not because of storage. The earlier host-side four-chain smoke remains the current
  provider validation evidence.

The current production-pruned images measured `76,080,966` bytes for API and `27,798,914` bytes for
web on this Docker Engine. The disposable runtime containers, networks, and volumes were removed
after assertions.

The application layer separately rejects a source Snapshot whose block hash or other canonical
Snapshot content differs even when its block number matches. These tests validate local persistence
and integrity behavior, not managed-database failover, backup/restore, encryption, retention, or
production migration operations.

## Finalized ingestion and three-store follow-up

A fresh disposable `zerotrace-ingestion-test` Compose project applied PostgreSQL migration
`004_ingestion_checkpoints`, initialized the ClickHouse Raw Fact migration, and enabled object-bucket
versioning. The storage integration suite verified the required commit order (artifact → Evidence and
Snapshot → Raw Fact → checkpoint), exact artifact replay, idempotent Raw Facts, monotonic resume, and
terminal-run immutability. The complete integration suite then passed twice consecutively against
the same disposable services, confirming stale rows do not create false pass/fail results.

The clean HTTP SQD adapter read finalized data for each supported dataset and the complete pipeline
persisted and replayed one canonical block/slot through real PostgreSQL, ClickHouse, and MinIO:

A later filtered BNB Smart Chain production probe received a successful SQD finalized stream as
newline-delimited JSON with `Content-Type: text/plain`. The adapter now accepts that provider-observed
media type while retaining the same bounded UTF-8 decoder, strict per-line JSON/object validation,
range checks, continuity checks, and non-retryable malformed-Evidence behavior. Unit coverage proves
both valid `text/plain; charset=utf-8` JSONL acceptance and malformed `text/plain` rejection.

| Dataset            | Position | Evidence ID                   | Raw Fact ID                                                        |
| ------------------ | -------: | ----------------------------- | ------------------------------------------------------------------ |
| `ethereum-mainnet` |        0 | `ev_2267648e57999ea5a34df53a` | `05c0c4f8a0688a64b5052470798de63fa06aa62b88091eb3060268ae3312ee8f` |
| `binance-mainnet`  |        1 | `ev_a5d8c4c02c5f292b2eef7926` | `5b3c754a65f91ecbf3f360f6054ad014599acce232e30d6748b4e58790afd437` |
| `bitcoin-mainnet`  |        0 | `ev_3d617ebc4c473fa6c71f1974` | `94d446e51370d70553aa6d36a30fe1c06692ba16704ec2bb81166f503438ce5c` |
| `solana-mainnet`   |        0 | `ev_99e18dce14176c7e3aecd758` | `6ab508234b037cd58f819096d286f013bbba7421e6bde2231405202ad2a963cb` |

The immediate replay reported `processedBlocks: 0` and `alreadyTerminal: true` for all four run
identities. A host worker invocation ingested an Ethereum range, and the production container target
ingested a BNB Smart Chain range through `docker compose --profile ingest run`; replay was a no-op.
The worker image also built from `npm ci`, proving the workspace/link graph works from a clean image.

A second completely fresh `zerotrace-acceptance` project started the full default seven-service
topology on isolated ports. API, web, PostgreSQL, ClickHouse, Valkey, and MinIO health checks passed;
NATS was running. `/health` reported Evidence storage plus Raw Facts, checkpoints, and artifacts as
`UP`, while signing and broadcasting remained `FORBIDDEN`. Overall health was `DEGRADED` solely
because public chain providers were unavailable from that isolated container network. With the
secure default, the worker returned the safe code `PRIVATE_NETWORK_BLOCKED`; enabling the documented
local interception-proxy exception then ingested a BNB Smart Chain finalized block, and an immediate
replay returned `processedBlocks: 0` and `alreadyTerminal: true`.

These observations validated finalized block-header transport, provenance, storage ordering, and
restart behavior at that stage. They did **not** validate the later transaction/ledger-record work,
continuous scheduling, unfinalized forks/reorgs, cross-provider reconciliation, or protocol
semantics. The interception-proxy exception documented above was still necessary on this host; the
secure default remains `ALLOW_PRIVATE_PROVIDER_URLS=false`.

## Finalized raw-transaction follow-up

The transaction profile was checked first against the official SQD EVM, Bitcoin, and Solana field
contracts and then probed against the public Portal without a key. A production-built worker wrote a
named finalized position for every configured dataset through the same PostgreSQL, ClickHouse, and
versioned MinIO pipeline:

| Dataset            | Position | Transactions | Run ID                                 | Persisted-fact manifest SHA-256                                    |
| ------------------ | -------: | -----------: | -------------------------------------- | ------------------------------------------------------------------ |
| `ethereum-mainnet` |    46147 |            1 | `8470b62e-c87b-4941-baff-b90b398bfdf5` | `cbf7e100df8d09702c403052212dd1749872daef9e186a13a87f6906036f9105` |
| `binance-mainnet`  |        1 |            7 | `2cb84bee-409f-4857-bdfc-d973efe3c04b` | `51b11e7cf83aaf0276784d58b18c89290fc52daae5c49221793795450a913b66` |
| `bitcoin-mainnet`  |      170 |            2 | `4d93bcf9-be7c-48de-87a8-b8f8dee7dcae` | `a123fbc346605e0b3b2f9f7d2b12025983aceb8b47eb0e275fe61499d4215b40` |
| `solana-mainnet`   |   105368 |            1 | `19f980af-9e5d-4867-b874-75f520df3f49` | `37a1da0501d697343c4ed158b0f14ff198d03e06a6ac6546a041baebaa465b1b` |

ClickHouse and PostgreSQL independently returned one block plus the listed transaction count, one
Evidence ID per fact, and one shared content-addressed artifact reference per provider block. Reading
each artifact back from MinIO reproduced the exact transaction count, and every immediate replay
returned the same run ID with `processedBlocks: 0`, `processedTransactions: 0`, and
`alreadyTerminal: true`.

Solana slot `259984950` was also a real skipped-slot probe. Portal returned HTTP 200 with an empty
JSONL body and a finalized head above the requested slot. The worker completed that proven empty
range with zero blocks/transactions; an empty stream with a missing finalized-head proof remains an
error. Header-only runs return `transactionCoverage: NOT_QUERIED` and a null transaction count, so
not-queried history is never presented as numeric zero.

This follow-up validated provider-shaped raw transaction capture and provenance only at that stage.
The subsequent ledger-record follow-up below extends raw capture but still does not claim semantic
transaction or protocol decoding. The disposable transaction-validation containers, network, and
named volumes were removed after the reverse-read assertions.

## Finalized ledger-record follow-up

The `ledger-records` profile was derived from the official SQD EVM log, Bitcoin input/output, and
Solana instruction field contracts, then checked against live public finalized streams. The live
contract probes confirmed two fail-closed edge cases: Bitcoin coinbase inputs carry explicit null
outpoints, and a Solana instruction `transactionIndex` is not necessarily the returned transaction
array offset. A separate Solana slot probe returned 3,851 unique instruction identities, including
1,973 nested CPI paths up to depth four.

A fresh isolated `zerotrace-ledger-test` stack on non-default ports passed all 25 integration tests
against PostgreSQL, ClickHouse, and MinIO. The production-built worker then persisted these named
public-chain observations:

| Dataset            | Position | Transactions | Ledger records                 | Run ID                                 | Artifact SHA-256                                                   |
| ------------------ | -------: | -----------: | ------------------------------ | -------------------------------------- | ------------------------------------------------------------------ |
| `ethereum-mainnet` |  1000000 |            2 | 1 EVM log                      | `f9eb25c0-6ada-4fe9-a322-98fda439fdbe` | `a423c0bcdbb85a69c72f10e3915dd814141723fc10dfa4f0b673b5572759cb05` |
| `binance-mainnet`  |        1 |            7 | 1 EVM log                      | `6cb3d74e-90dc-478f-99b2-cc973912cca2` | `50494c2dbdd996524a68a2d2e8ae0505160c6800b4240a054945248bba441fb6` |
| `bitcoin-mainnet`  |      170 |            2 | 2 inputs and 3 outputs         | `7f0b3ae0-2aa6-46ba-8450-30c85cdf95ac` | `1e797af366f6c8bf2c5332153abd54983a2ff62292e4e451b5dd8f3f98ed9f9f` |
| `solana-mainnet`   |   105368 |            1 | 2 instruction/CPI path records | `581374f0-a92d-4c9a-a581-a4f0fc33c180` | `f709b4febfe620a25ce84bdb83825ac369ac5c1c6d00b5a4ae77c72bc00fec17` |

ClickHouse returned one distinct Evidence ID per fact and the expected fact-type counts. PostgreSQL
returned a non-null Snapshot for every Evidence node. Every fact in a provider block shared exactly
one content-addressed artifact, and an integrity-checked MinIO reverse read reproduced the exact
transaction and ledger-table counts. Immediate replay returned the same four run IDs with zero newly
processed records and `alreadyTerminal: true`.

A separate Ethereum header-only observation at block `1000001` returned `NOT_QUERIED` with null
counts for transactions and logs, and `NOT_APPLICABLE` with null counts for Bitcoin/Solana-only
tables. Numeric zero is therefore reserved for explicitly materialized empty tables. The host uses a
local interception proxy whose synthetic DNS address is reserved; live checks enabled the documented
private-resolution exception while retaining the exact `portal.sqd.dev` allowlist and HTTPS URL.

The production API, web, and ingest-worker Docker targets rebuilt successfully from the locked
`npm ci` stage. The resulting worker container ingested BNB Smart Chain block `2` with one transaction
and one log under run `6b0d1c5d-e6b5-4edd-8ba4-0e6c23c18849`; its immediate container replay was a
terminal no-op. After all reverse-read assertions, the exact disposable Compose project, network,
and its three named data volumes were removed; unrelated containers and the database already using
host port 5432 were not touched.

At that stage, this validated raw EVM log, Bitcoin input/output, and Solana top-level/CPI instruction
capture and provenance. The execution/state follow-up below closes the raw trace, state-diff,
balance, token-balance, and reward gaps; semantic transfers, protocol decoding, independent-provider
reconciliation, and archive-scale backfill remain open.

## Finalized execution/state follow-up

The `sqd-finalized-ingestion-v4` follow-up used the official SQD EVM API/field-selection and Solana
API/field-selection contracts. Live raw-HTTP probes confirmed that EVM trace identity requires an
explicitly selected `traceAddress`, including an empty root path, while a state diff is located by
provider transaction index, account, and state key. Solana probes confirmed provider transaction
indices for logs/native balances/token balances, block-level reward rows, and explicit null pre/post
fields for one-sided token-account creation or closure.

The expanded profile passed 25 integration tests against an isolated PostgreSQL, ClickHouse, and
versioned MinIO stack. A freshly compiled worker runtime then persisted these public finalized
observations:

| Dataset            |  Position | Transactions | Additional materialized records                                         | Run ID                                 | Artifact SHA-256                                                   |
| ------------------ | --------: | -----------: | ----------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `ethereum-mainnet` |   1000000 |            2 | 1 log, 3 traces, 8 state diffs                                          | `2e747f40-2d3a-41d2-baec-7f37738e62a7` | `7dfe4e4e8dc20962667f8f0854aa1eb457fed06952030dd4b182bd29322b04dd` |
| `binance-mainnet`  |         2 |            1 | 1 log, 1 trace, 12 state diffs                                          | `1b876244-b878-49d1-8298-93303ca2272d` | `3fcd6c0fe6ab4d2fc56fa6c0e37c7c3c669e3689aba33cab1951e5202e3a20ed` |
| `bitcoin-mainnet`  |       170 |            2 | 2 inputs and 3 outputs                                                  | `deb61c50-e645-4e03-972b-c9763ed8f001` | `b2ef07cc0f6be018307cfe3027ef0ec1b3fec61e184c9b7e875515fa600b6d67` |
| `solana-mainnet`   | 200000000 |           25 | 148 instructions, 193 logs, 40 balances, 37 token balances, 473 rewards | `6a6f55d5-d117-40ae-96ae-d349abea8d76` | `38422f2f07a5ac537bb317f3ba7be01f9a294a78dd5f04b2e4ca3782191c74f3` |

ClickHouse returned 956 facts at the four named positions, with one distinct Evidence ID per fact
and exactly one artifact reference per block. PostgreSQL returned a non-null Snapshot and the same
single artifact reference for every corresponding Evidence row. Integrity-checked object-store reads
reproduced every table count shown above from the content-addressed envelopes. Immediate replay kept
all four run IDs, processed zero new blocks/records, and returned `alreadyTerminal: true`.

An Ethereum header-only run at block `1000001` reported transactions/logs/traces/state diffs as
`NOT_QUERIED` with null counts, while Bitcoin- and Solana-only tables were `NOT_APPLICABLE` with null
counts. The Docker Hub token endpoint was temporarily unreachable through the local interception
proxy during the first image rebuild attempt. After connectivity recovered, the pinned
`node:24.11.1-alpine` base pulled successfully and the clean current-source `ingest-worker` target
built as image digest `sha256:6e53b6a89a9a5f8fb9ec141727afa391fd0a7e981162bed625f37e1566276f64`.
That image ingested BNB Smart Chain block `3` under run
`f1fc392c-8587-490c-a89d-a2e2d9b5936b`, persisted artifact
`910e4f82eb95fd5a8a1c3273f4a6b3dc06796505dfe998a04d985b2ddbc12050`, and explicitly
materialized zero transactions/logs/traces/state diffs. Its immediate replay retained the run ID,
processed zero blocks, and returned `alreadyTerminal: true`.

This validates provider-shaped finalized execution/state capture and provenance. Semantic transfer,
event/call/state-change interpretation, continuous scheduling, live/reorg handling, independent
provider reconciliation, and archive-scale backfill remain open.

## Request-scoped provider provenance and cache consistency

The current-state transport now returns the safe endpoint ID alongside each response instead of
requiring callers to inspect a shared mutable `lastEndpointId`. Deterministic failover tests prove
that the returned endpoint is the one that produced that specific response. API integration tests
force EVM balance and code, Bitcoin tip height/hash/address, and Solana slot/block/account calls onto
different synthetic endpoints and verify:

- Snapshot `providerVersions` contains every endpoint used to establish its anchor;
- Evidence names the endpoint or deterministic endpoint set used for state observation;
- response metadata `sourceSet` is the sorted union of anchor and state sources;
- concurrent EVM state reads cannot overwrite each other's provenance;
- dynamic anchor requests bypass stored TTL entries, do not replace the normal cached value, and
  increment `cacheBypasses` diagnostics.

The focused transport/adapter/schema/API run passed 62 tests. This is deterministic failover and
concurrency-contract coverage; a forced outage across real independent providers and semantic
agreement/reorg acceptance remain pending.

A live 60-second-TTL probe then captured two successive Snapshots per public network. BNB Smart
Chain moved from block `114971472` to `114971479` with `2` anchor bypasses; Bitcoin remained at
height `961757` with `4` height/hash bypasses; Solana moved from slot `438242571` to `438242581` with
`4` slot/block bypasses. Each Snapshot named only the safe endpoint that returned its anchor. The
changing BSC/Solana positions and exact bypass counters confirm that the stored TTL entry was not
served. No credential was used in this probe.

## Anchor reconciliation and continuity follow-up

The anchor contract was reconciled against primary sources: Ethereum JSON-RPC block tags and
`parentHash`, Esplora block identity/height/`previousblockhash`, Bitcoin Core's off-main-chain
confirmation signal and previous-block identity, and Solana's confirmed-block `parentSlot` plus
`previousBlockhash`. No new third-party runtime package or copied upstream implementation was added.

Deterministic tests prove:

- faster heads are re-read at the minimum common position before comparison;
- agreement requires at least two matching complete identities;
- same-position conflicts retain an Unknown canonical anchor and create an Evidence-linked CRITICAL
  alert without majority selection;
- one failed/rate-limited source remains insufficient/unavailable rather than agreement or zero;
- unchanged, direct extension, gap/history match, same-position replacement, source regression, and
  unavailable continuity states preserve prior/current/check Evidence;
- EVM, Bitcoin, and Solana parent identity must match the replay Snapshot;
- concurrent inspections share one in-flight reconciliation operation.

A fresh `zerotrace-dq-test` stack used non-default host ports and isolated PostgreSQL, ClickHouse,
and MinIO volumes. The complete 32-test integration suite passed. PostgreSQL coverage verified
migrations `005_data_quality` and `006_snapshot_observation_identity`, append-only
anchors/alerts/alert edges, idempotent anchor writes, latest-head recovery after repository restart,
atomic alert Evidence edges, same-anchor recapture at a later time, and rejection of an alert whose
Evidence does not exist.

The production API image was also exercised against a fresh Compose database, then restarted without
removing its volume. Before and after restart the response retained all four chain targets, Data
Quality storage remained `UP`, and `SNAPSHOT_CONFLICT` was absent. Public endpoints were temporarily
unavailable during this final restart probe, so both responses correctly reported
`INSUFFICIENT_SOURCES` and overall `DEGRADED` rather than inventing agreement or zero values.

The first public-chain probe kept default DNS/IP SSRF protection and correctly returned all sources
unavailable because this workstation's interception proxy resolves approved public hostnames through
a reserved address range. No result from that attempt was counted as chain validation. The retry
used the documented local-proxy exception while retaining HTTPS, exact hostname allowlists,
read-only method allowlists, response bounds, and safe source IDs. A locally supplied Ethereum key
was injected only into that process and was not written or printed.

| Chain           | First comparison position | Sources | Result               | Independence |
| --------------- | ------------------------: | ------: | -------------------- | ------------ |
| Ethereum        |                  25719261 |     1/1 | insufficient sources | Unknown      |
| BNB Smart Chain |                 114979794 |     2/2 | endpoint agreement   | Unknown      |
| Bitcoin mainnet |                    961762 |     1/1 | insufficient sources | Unknown      |
| Solana mainnet  |                 438251403 |     1/1 | insufficient sources | Unknown      |

In a separate same-process two-observation probe, Ethereum and Bitcoin were `UNCHANGED`; both BSC
endpoints advanced and returned `HISTORICAL_MATCH` when the service re-read their earlier positions,
then agreed at common position `114979862`. The second Solana observation was unavailable and
remained explicit with zero continuity coverage. No alert was raised in the live probe.

This is real endpoint-level agreement and continuity-path evidence. The two BSC hostnames are not
claimed to be independently operated, no real reorg was forced or observed, and automatic
rollback/replay is not implemented. Those remain release gates.

## Typed ledger query follow-up

The API now validates and returns typed EVM, Bitcoin, and Solana blocks/transactions plus Bitcoin
outpoints. Confirmed records are rebound to an exact block or slot Snapshot; pending EVM, Bitcoin
mempool, and outpoint views are tied to a captured head; Bitcoin mutable views additionally carry a
content digest. Null EVM/Solana provider responses persist a raw provider observation and
source-linked negative Evidence while keeping absence, pruning/propagation, and commitment delay
ambiguous.

Deterministic API coverage includes confirmed and pending EVM transactions, confirmed and mempool
Bitcoin transactions, spent/unspent-field behavior for outpoints, confirmed and null Solana
transactions, block queries on all three ledgers, placement/source mismatches, malformed provider
records, explicit chain context, unconfigured providers, and missing EVM receipts. The last case
keeps the transaction confirmed while execution, gas used, and log count remain Unknown.

The analyst UI accepts typed transaction/block/outpoint search candidates and renders field knowledge
states, the bound Snapshot, source/coverage/model metadata, and Evidence. Chromium exercised the
Solana transaction result on desktop and Pixel 7. On Windows an owned-process wrapper starts isolated
API/web servers and terminates only their process IDs, avoiding shell-dependent Playwright teardown.

Local Docker Desktop was not running during this follow-up. The local coverage run therefore passed
225 tests and explicitly skipped 15 opt-in PostgreSQL/ClickHouse/object-store tests; it still passed
the coverage gate at 83.60% statements, 75.20% branches, 90.44% functions, and 84.57% lines. Those
skips were not counted as durable acceptance. GitHub Actions then started disposable initialized
stores and passed all 240 tests: 203 unit and 37 integration, with 86.93% statements, 78.44%
branches, 95.05% functions, and 87.91% lines. The same immutable commit passed 8 Chromium flows,
CodeQL, dependency/license/SBOM gates, Compose validation, and all five production container targets.

The requested Flap/BSC FFT contract
`0xdcfb441a1f38802820a4e7b4cc8aab37833c7777` is registered in the
[terminal acceptance specification](FLAP_FFT_ACCEPTANCE.md). Official deployment, inspection,
event-indexing, bonding-curve and migrated-market sources have been located. Later entries in this
record accept one same-Snapshot custody/flow observation and one point-in-time Pancake V2 market/buy
slice, but no complete FFT reference-case conclusion is recorded because entity calibration, complete
event/migration history, independent-source reconciliation and multi-route sell/execution RV remain
unfinished. The specification uses zero tolerance for exact chain state, field-class error budgets
for derived values, Brier/ECE gates for entity probabilities, and excludes Unknown from numeric error
denominators.

### Deterministic Flap Portal inspection slice

The repository now contains a clean read-only Flap BSC inspector bound to the officially documented
Portal v5.14.16 deployment and an explicit official interface revision. At one fixed Snapshot block
it checks Portal/token bytecode, decodes V8Safe with RPC-error-only V6/V5 fallbacks, rejects
malformed successful output, preserves future enum codes as Unknown, and source-links the normalized
launch Evidence to deployment, bytecode and call observations. No-code input produces negative
Evidence.

The official registry and inspection guide were re-read on 2026-08-10 after they advanced the same
BSC Portal address from the previously recorded v5.8.6 to v5.14.16. The production deployment now
prefers forward-compatible `getTokenV8Safe` and falls back through V6/V5 only for explicit
non-retryable RPC method errors. Deterministic tests cover current asymmetric taxes, V8-to-V6 and
V8/V6-to-V5 fallback, future enum codes, and malformed-success rejection.

Local verification passed 210 unit tests and 23 API integration tests; 15 durable-store tests were
explicitly skipped because local Docker Desktop remained unavailable. The Windows-owned browser run
passed 10 Chromium flows across desktop and Pixel 7, including Flap lifecycle, replay block,
Evidence, and Unknown sell-capacity rendering. This is deterministic adapter/UI validation only.
No FFT request or named real-chain Flap conclusion was made, and event history, migration, market
reconstruction, entity calibration, executable sell capacity and full RV remain pending.

The follow-up read-only RV slice calls the official `previewSell(address,uint256)` view at the exact
inspection block. Tests cover a positive provider quote, an exact provider-returned zero, buy-only
execution blocking, excessive input, API unavailability, replay drilldown, and desktop/mobile UI.
Only the raw Portal output becomes Known; nominal value, decimals-normalized price, impact and fee
breakdown remain Unknown. This does not satisfy independent quote reconciliation, migrated DEX
routing, sell-capacity discovery, or the registered FFT terminal run.

GitHub Actions then validated that immutable quote commit with disposable initialized stores. It
passed all 253 tests, 10 Chromium flows, dependency/license/SBOM and Compose gates, and all five
production container targets. Coverage was 86.67% statements, 78.11% branches, 95.18% functions,
and 87.61% lines; CodeQL also passed.

### Typed discrepancy audit slice

The Data Quality package now applies exact decimal/rational comparisons to the registered field
classes. Deterministic tests exercise exact-state conflicts, decimal-normalized conservation,
the exact `0.10%` derived boundary, `0.50%`/`1.00%` quote bands, evidenced explanations,
zero-reference equality, coverage gates, Snapshot conflicts, missing Evidence, Unknown exclusion,
unverified source independence, and an empty audit that remains inconclusive. The API additionally
rejects missing source Evidence, persists one derived audit node, and attaches that Evidence ID to
every returned discrepancy.

The repository-level local run passed 225 unit tests and 26 API integration tests. The coverage run
passed 251 tests and explicitly skipped 15 opt-in durable-store tests because the local Docker engine
was unavailable; coverage was 83.79% statements, 75.80% branches, 91.20% functions, and 84.73%
lines. Ten Chromium desktop/mobile flows, formatting, lint, typecheck, build, license, vulnerability,
SBOM and Compose-model gates passed. No dependency was added.

GitHub Actions then passed all 266 tests, including all 41 API/durable integration tests against
disposable initialized PostgreSQL, ClickHouse, and MinIO. Remote coverage was 86.80% statements,
78.69% branches, 95.38% functions, and 87.75% lines. Ten Chromium flows, dependency/license/SBOM
and Compose gates, all five production container targets, and CodeQL passed on the same immutable
code commit.

This slice does not compare live independent providers and does not implement corpus-level entity
probability calibration. Brier score and expected calibration error remain explicit FFT acceptance
gates; the engine cannot convert missing labels or unverified source independence into a pass.

### Flap transaction-local event slice

The clean adapter now accepts a caller-supplied Flap transaction hash, validates the successful
receipt and every log's block/hash/transaction/index placement, recaptures the exact block Snapshot,
and decodes only versioned Portal events for the requested token. Raw receipt and log Evidence remain
separate from the normalized transaction result. Known malformed or duplicate facts and replay-hash
conflicts fail closed.

Deterministic tests cover creation plus explicit curve/tax/DEX configuration, documented defaults,
unknown legacy curve internals, future enum codes, migration launch/pool facts, unrelated Portal
logs, duplicate creation events and inconsistent placement. API integration verifies persistent
Evidence drilldown. The analyst UI accepts the transaction hash and displays value provenance,
Unknown states, zero history coverage, and Evidence; the focused Chromium run passed on desktop and
Pixel 7.

This is not chain-wide history. The caller must supply the transaction, `historyCoverage` remains
zero, and no named FFT or other real-chain event transaction has been accepted. Deployment-origin
continuous discovery, cross-range lifecycle reconstruction, market/RV linkage and entity
calibration remain required before the registered FFT run.

The complete local gate passed formatting, lint, typecheck, 233 unit tests, 27 API integration
tests, production builds, license policy and a zero-vulnerability dependency audit. Coverage passed
260 tests with 15 Docker-dependent durable tests explicitly skipped at 84.11% statements, 76.06%
branches, 91.31% functions and 85.07% lines. All 10 Chromium desktop/mobile flows, CycloneDX SBOM,
Compose-model parsing, diff checks and the credential scan passed.

### Flap bounded event-history slice

The EVM adapter now exposes a strictly bounded typed log query: decimal ranges are normalized to
canonical block tags, topic alternatives are deduplicated, result counts are bounded, and removed,
duplicate, wrong-address, out-of-range, malformed, or non-final log responses fail closed. The Flap
layer chunks at most 50,000 requested blocks and fails above 25,000 observed Portal logs, scans the
official Portal topic set, decodes each non-indexed token field, and exact-receipt replays every
matching transaction.

Deterministic tests cover range sorting/provenance, range and result limits, invalid provider logs,
positive creation discovery, bounded negative Evidence, Evidence drilldown, and invalid-range
rejection before network access. API integration returns the chronology and nested transaction
Evidence. Desktop and Pixel 7 browser tests display requested-range coverage separately from Unknown
token-lifetime coverage and zero terminal history coverage.

This is bounded discovery, not continuous history acceptance. The implementation does not yet prove
the Portal deployment-origin block, persist an incremental semantic event index/checkpoint, or prove
continuous coverage from deployment through the analysis Snapshot. No named real-chain or FFT
history result is accepted by this slice.

The complete local gate for this slice passed formatting, lint, typecheck, 238 unit tests, 28 API
integration tests, production builds, license policy and a zero-vulnerability dependency audit.
Coverage passed 266 tests with 15 Docker-dependent durable tests explicitly skipped at 83.89%
statements, 75.43% branches, 91.55% functions and 85% lines. All 10 Chromium desktop/mobile
flows passed, including the bounded-history range and Evidence rendering.

### SQD/RPC Flap discovery cross-check

The bounded discovery source was then split across independent responsibilities: finalized SQD
`binance-mainnet` supplies strictly filtered address/topic logs, and BSC RPC supplies the exact
transaction receipt and block used to reconstruct and bind every event. SQD dataset metadata
reported start block `0`; the client also requires a complete parent-linked response through the
requested end block, validates every returned filter field, and rejects duplicates or source-head
shortfalls. Every discovered log must reproduce the RPC receipt's block, transaction, log index,
address, topics and data field-for-field. RPC remains the strict fallback discovery source when SQD
is not configured.

Project code replayed the following named non-FFT fixture:

| Field                    | Observation                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction              | `0x53614caf06221b2dadee950b588ca0bad466f73e04a40c6392780f9459630459`                                                                          |
| Block                    | `98759976`                                                                                                                                    |
| Token                    | `0xb81252503501f366b5dfb8c89fff85076d2f8888`                                                                                                  |
| Discovery source         | `sqd:binance-mainnet`                                                                                                                         |
| Requested-range coverage | `1`                                                                                                                                           |
| Chronology               | `TokenCreated`, `TokenCurveSetV2`, `TokenDexSupplyThreshSet`, `TokenVersionSet`, `TokenQuoteSet`, `TokenMigratorSet`, `TokenDexPreferenceSet` |
| Evidence nodes           | `12`                                                                                                                                          |
| Lifetime/history state   | lifetime `unknown`; terminal `historyCoverage: 0`                                                                                             |

The host's DNS interception mapped the official BSC hostname to a private-range fake IP, so the
first live attempt was correctly blocked by the default SSRF guard. The successful local probe used
`allowPrivateNetworks: true` only for the two explicit HTTPS allowlisted hosts. Repository and
example defaults remain secure and unchanged. This result accepts one bounded creation/configuration
fixture; it is not the FFT token, a lifetime-history proof, a continuous checkpoint, an independent
operator reconciliation, or market/RV/entity acceptance.

### SQD contract-origin to exact BSC receipt proof

The sparse SQD creation reader and Flap origin service were then executed through project code
against the same named non-FFT token. SQD supplied the successful `create` trace and parent
transaction; the public BSC RPC supplied the exact receipt and block used to decode `TokenCreated`.
The service accepted the origin only after the official Portal creator, created address, trace
position, receipt log and Snapshot agreed:

| Field                    | Observation                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| Token                    | `0xb81252503501f366b5dfb8c89fff85076d2f8888`                         |
| Creation transaction     | `0x53614caf06221b2dadee950b588ca0bad466f73e04a40c6392780f9459630459` |
| Block                    | `98759976`                                                           |
| Block hash               | `0x7a5bffd6bd99c3dc33ec1a2d20ec48a03928f21cd189e40a791cb0bd71d05253` |
| Trace path               | `[0,0,0,1]`                                                          |
| Contract creator         | official Portal `0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0`         |
| Launch creator           | `0xa2bb0586192ca431c628f83aa82d5b818a6917eb`                         |
| Requested-range coverage | `1`                                                                  |
| Evidence/drilldown nodes | `13` / `13`                                                          |
| Lifetime/history state   | lifetime `unknown`; terminal `historyCoverage: 0`                    |

This proves one bounded contract origin, not continuous coverage. A separate public BSC RPC probe
returned non-retryable historical `eth_getCode` errors across old block heights, so that endpoint is
not accepted as archive-capable. The default SSRF policy remains unchanged; the local live probe
used private-network allowance only for the explicitly allowlisted public HTTPS hostnames because
the host environment's DNS interception resolves them to private-range addresses. No FFT request
or conclusion was made in this slice.

The follow-up coverage probe requested BSC blocks `0-999999` for the same token. SQD returned 268
sparse/header continuation records across 14 HTTP responses before the reader reached
`nextBlock=1000000`; no creation trace was present. Project code retained the requested bounds,
finalized head `115030815`, response-block count, request count and completed status. An earlier
probe with a deliberately low five-request cap failed closed with `HTTP_ERROR`, demonstrating that
partial pagination is not mistaken for complete negative Evidence. This validates one resumable
chunk boundary only; a full dataset-start-to-target scan still requires durable cross-chunk
checkpointing and was not claimed.

The complete local gate for this cross-check passed formatting, lint, typecheck, 241 unit tests, 28
API integration tests, production builds, license policy and a zero-vulnerability dependency audit.
Coverage passed 269 tests with 15 Docker-dependent durable tests explicitly skipped at 83.93%
statements, 75.80% branches, 91.78% functions and 85.05% lines. All 10 Chromium desktop/mobile
flows passed.

### Durable semantic scan checkpoints

PostgreSQL migration `007_semantic_scan_checkpoints` and the storage repository now preserve a
generic semantic scan independently of any provider process. The immutable identity includes scan
type/source/ledger/chain/subject/range/chunk/config payload; canonical hashes bind both identity and
JSON projection state. Each advance requires the caller's exact expected cursor, covers at most one
configured chunk, replaces state only with forward progress, retains the cumulative canonical
Evidence ID set, and clears a prior provider error only after accepted progress. Exact retries are
idempotent and a terminal requested-range-complete record is immutable and append-preserving.

Five focused unit tests passed for resume, contiguous progress, failure recovery, idempotency,
corruption detection, storage-health states and input validation. A freshly built disposable
PostgreSQL 17.10 image executed migrations `001-007`; all 14 PostgreSQL integration tests passed,
including two new semantic-checkpoint cases. The real database rejected cursor rollback, immutable
identity changes, Evidence removal, same-cursor state replacement, oversized chunks, premature
completion, terminal mutation and deletion. The named Docker project and volume were removed after
the run.

The Flap origin API is now bound to the repository whenever PostgreSQL is configured. A deterministic
two-chunk scan persisted the first chunk, recorded a safe `HTTP_ERROR`, resumed at the second chunk
without re-reading the upper anchor or first range, then atomically stored the exact terminal result.
A third identical request returned the stored result without any SQD/BSC RPC call or Evidence write.
API integration also proves the durable path is selected and `/health/ready` fails when migration
`007` is unavailable.

This is restart and replay acceptance, not continuous Flap lifetime acceptance. The synchronous API
remains range-capped. A follow-up added a separate one-shot `semantic-worker` for wider ranges: it
accepts only token/from/to/chunk inputs, preflights both durable stores, reuses the exact checkpoint
identity, and emits a credential-free result or categorized failure. Its locked production image
built successfully and ran `--help` as the unprivileged `node` user. Continuous deployment-origin
scheduling and durable event-history projection still do not exist. No FFT request was made, and no
FFT conclusion is claimed.

### Immutable Flap history segment projection

PostgreSQL migration `008_flap_history_projection` adds an append-only projection for bounded Flap
history results. Each segment is linked to a `FLAP_EVENT_HISTORY` semantic scan and may be inserted
only at that run's exact current cursor for one configured chunk. The repository verifies the
content-addressed segment/result/Snapshot identities, canonical source and Evidence sets, terminal
Evidence root, model version and full typed result on every read. An identical stored segment is a
no-op replay; a conflict fails closed. Ordered scan pagination is available without loading an
unbounded lifetime result into one checkpoint JSON value.

Three focused repository tests passed. A fresh PostgreSQL 17.10 image applied migrations `001-008`;
all 16 PostgreSQL integration tests passed. The database rejected a segment referencing missing
Evidence plus any segment update or deletion, while exact replay continued to work before and after
checkpoint completion. The disposable project and volume were removed. The segment repository is
validated storage infrastructure; the following batch binds the cross-range runner, while API
binding, continuous scheduling and FFT lifetime projection remain pending.

### Restart-safe cross-range Flap history projection

The bounded Flap history scanner is now composed into a wider, restart-safe projection without
changing its 50,000-block safety limit. A semantic scan identity binds token, chain, Portal,
deployment/source revisions, range, segment and inner-query sizes, provider Snapshot tag and result
limits. Every segment is validated again against that identity, its exact inclusive range, final
Snapshot, bounded-history model, canonical SQD/source set and terminal Evidence before the semantic
cursor advances.

Three deterministic runner tests passed. One injects a failure after the first immutable segment is
stored but before the checkpoint advance. The next run finds exactly one cursor-adjacent pending
segment, adopts it without executing that range again, executes the second segment once, then stores
a terminal Evidence root and typed projection summary. A third identical call returns the checkpoint
result without reading the projection store, calling SQD/BSC RPC or writing Evidence. Non-canonical
discovery sources fail before checkpoint creation.

A fresh disposable PostgreSQL 17.10 image applied migrations `001-008`; all 17 PostgreSQL integration
tests passed, including the same interruption boundary through the real Evidence, checkpoint and
projection repositories. The stored run reached `REQUESTED_RANGE_COMPLETE`, `next_block=104`, and
retained two ordered immutable segments. The named Docker project and volume were removed. This is
requested-range projection acceptance only: lifetime coverage remains Unknown, terminal
`historyCoverage` remains zero, and no FFT request or real-chain conclusion was made. Worker/API
binding, continuous scheduling, origin-to-head execution and named FFT/migration validation remain
pending.

### Flap history worker and provider-free replay surface

The cross-range runner is now bound to a second one-shot `semantic-worker` entrypoint. Its CLI
accepts only an EVM token plus bounded range/segment/query limits, validates HTTPS/provider
allowlists and rate/retry policy, and preflights the Evidence, semantic-checkpoint, and immutable
projection repositories before constructing SQD or BSC RPC readers. The safe JSON summary includes
the stable scan UUID, requested range, completed segment and transaction counts, terminal Snapshot
and Evidence metadata, and the still-Unknown lifetime state; it contains no provider URL or
credential.

The production API opens the projection repository alongside Evidence/checkpoint storage and makes
migration `008` part of readiness. A token- and scan-bound endpoint validates the scan type, SQD
source, EVM/BSC identity, subject, terminal result and every stored segment before returning at most
100 immutable rows. Cursor pagination reads PostgreSQL only. A missing repository, mismatched token,
corrupt terminal payload, or unhealthy migration fails closed. The React workspace accepts the scan
ID and presents range progress, stored segments, terminal Evidence IDs and Unknown lifetime coverage;
the storage-unavailable state is explicit.

Focused tests passed 48 checks across the runner, worker config/execution, API runtime and integration
surface. The current complete unit suite passed 275 tests across 32 files, the environment-free API
suite passed 34, and coverage passed 309 with 20 opt-in durable skips at 82.88% statements, 75.76%
branches, 91.50% functions and 83.79% lines. The production semantic-worker image built from the
current source, ran the history CLI help as UID 1000, and Compose rendered both semantic workers.
Desktop and Pixel 7 browser runs verified first/next-page rendering, completed requested-range versus
Unknown lifetime coverage, and an explicit durable-storage failure rather than fake data or a
provider scan.

This batch supplies a restart-safe bounded worker and replay surface, not a scheduler or continuous
deployment-origin-to-finalized-head history. It does not make token lifetime, entity, market, RV, or
FFT claims. No FFT request was made.

### Exact point-in-time Flap lifetime materialization

The lifetime schema and composite runner now make the lifetime claim mechanically conditional. One
identity binds official SQD `binance-mainnet` metadata and dataset start, token/deployment revisions,
origin/history limits, and one exact finalized BSC target hash. The origin child must cover dataset
start through target with one unique Portal-created contract. Its history child must then cover the
evidenced creation block through that identical target Snapshot. Only 100% coverage across both
children emits `lifetimeCoverage=known/true` and terminal `historyCoverage=1`. No unique origin stays
Unknown; short ranges, incomplete children or Snapshot conflicts fail closed.

Deterministic runner tests cover Known lifetime proof, Unknown origin without history execution,
child Snapshot conflict, and a failure after the composite checkpoint advances but before finish.
The latter retry finishes the stored result without repeating origin/history execution or Evidence
writes. The one-shot worker preflights all three PostgreSQL repositories, captures the finalized head
or proves a pinned target is at or below it, obtains SQD metadata, and emits only credential-free
composite/child scan IDs and Evidence metadata. CLI parsing rejects unknown arguments including a
private-key flag.

The token-bound API replays only the semantic checkpoint, re-parses completed state, returns running
progress without a terminal conclusion, and rejects corrupt or mismatched records. The React UI
shows dataset range, composite progress, exact lifetime state, origin/history child provenance and
the terminal Evidence root. Desktop and Pixel 7 Chromium exercised the completed Known fixture. That
fixture is deterministic and not a real-chain claim.

Local acceptance passed 288 unit tests across 35 files, 36 environment-free integration tests, the
complete build, typecheck, lint and formatting gates, and 10 Chromium desktop/mobile tests. Coverage
passed 324 tests with 20 opt-in durable skips at 82.72% statements, 76.04% branches, 91.16% functions
and 83.63% lines. The lifetime CLI built and printed help without provider access; Compose rendered
the new semantic service. The unchanged PostgreSQL storage layer was not re-exercised locally in
this batch; its latest fresh-image `001-008` run remains 17 passing tests, and the latest completed
all-store CI run remains 54 passing tests.

This establishes exact lifetime coverage at one finalized Snapshot only. Repeated-head scheduling,
target-to-target continuity, reorg rollback/replay, semantic market/RV/entity linkage and named FFT
acceptance remain pending. No request was made for FFT
`0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`, and no FFT conclusion is claimed.

## Continuous Flap accepted-head acceptance — 2026-08-10

The accepted-head layer extends the point-in-time proof without rewriting it. The typed extension
runner scans only `(accepted target + 1) -> reconciled target`, requires a Known continuity proof,
and links predecessor lifetime Evidence, continuity Evidence, delta-history Evidence and the new
Snapshot into one terminal root. Unit tests cover first materialization, unchanged replay, exact
delta extension, direct and historical continuity, incomplete delta rejection, source regression,
provider deferral, same-height replacement and finalized conflict alerts.

Migration `009_flap_lifetime_heads.sql` was applied with migrations `001-009` to a fresh disposable
PostgreSQL 17.10 image under isolated Compose project `zt_lifetime_migration`. The existing 17
PostgreSQL integration tests passed, followed by the dedicated lifetime-head repository test, for
18 passing real-PostgreSQL tests in this batch. The repository revalidated completed semantic scans,
source and scan type, token, target, Snapshot, result hash, terminal Evidence, predecessor and
sequence. Database triggers rejected update/delete and divergent or stale append attempts. The
temporary container and volume were removed after the run.

The continuous worker in that accepted-head batch reconciled one common finalized BSC position
across a configurable endpoint quorum, persisted direct or historical predecessor checks, and
advanced the append-only head only after exact delta completion. Retryable provider or storage
states produced a deferred cycle without advancement. At that point, a proven finalized replacement
created a critical Data Quality Alert and stopped the worker; automatic rollback/replay was added and
accepted in the follow-on batch below. The production semantic-worker image built and the
lifetime-head CLI printed help successfully without provider access. Compose rendered the opt-in
service with migrations `001-009`.

The provider-free latest-head endpoint was exercised for a complete stored head, unconfigured
storage and absent head. Desktop and Pixel 7 Chromium exercised the latest sequence, predecessor,
continuity, target Snapshot and terminal Evidence alongside the existing lifetime/projection flows.
Local acceptance passed 306 unit tests across 40 files, 38 environment-free integration tests and 10
Chromium tests. Coverage passed 344 tests with 21 opt-in durable skips at 81.92% statements, 76.06%
branches, 89.51% functions and 82.84% lines.

A follow-on storage acceptance applied migration `010_flap_lifetime_reorgs` on a fresh disposable
PostgreSQL 17.10 image. An exact active suffix was invalidated without updating or deleting accepted
head rows; canonical reads returned the surviving predecessor, the invalidated scan was rejected on
replay, and a replacement branch appended from that predecessor at the next global sequence. All 18
PostgreSQL tests passed and the isolated `zt_reorg_migration` container, network and volume were
removed.

The automatic resolver now verifies every participant at each accepted Snapshot newest-to-oldest,
retains only the newest unanimously confirmed ancestor, and invalidates the exact divergent suffix.
Unavailable history or cross-source historical disagreement defers without invalidation or majority
selection. A full-lineage divergence returns no surviving head, while the continuous worker
immediately re-enters safe materialization or extension after either rollback shape. Focused tests
cover suffix and full-lineage rollback, disagreement and unavailable-source deferral, same-height and
historical conflict routing, lineage-race rejection, and immediate replay.

The current environment-free gate has 333 unit tests and 38 integration tests; coverage passes 371
tests with 21 durable skips at 82.08% statements, 76.19% branches, 90.01% functions and 83.15% lines.
Together with the fresh PostgreSQL run, this proves deterministic rollback-point discovery,
append-only invalidation, canonical surviving-head selection and safe replay. It does not prove a
forced live-provider reorg recovery or operator independence.

This acceptance is deterministic and storage-backed; it is not a named token conclusion. Endpoint
quorum does not prove operator independence, the BSC sources were not certified archive-grade, and
no forced real reorg drill was accepted in this batch. Market/RV/entity linkage and
independent-source validation remain pending. A later section records the first named FFT claim
observations; it does not close the FFT reference case.

## FFT claim-observation acceptance (2026-08-10)

Project code located the exact start boundary requested for the user-provided 2 August pension
policy window. BSC block `113485950`, hash
`0x1fef8f173019d1c31a372bd1d0e296af79e0e4b6c67d6aceee8b240ebe516f53`, is timestamped
`2026-08-02T00:00:00.000Z`; its parent `113485949` is timestamped
`2026-08-01T23:59:59.000Z`.

The new finalized ERC-20 claim observer then completed the inclusive range from block `113485950`
through Snapshot block `115107095`, hash
`0x9da42a08afad71634fdebfad60a27014af0f6f1819d94438342e1a2632681510`, timestamp
`2026-08-10T10:45:29.000Z`. SQD `binance-mainnet` returned 13,591 FFT Transfer logs and the adapter
created the same number of content-addressed Evidence nodes before marking requested-range data and
history coverage complete.

For behavioral candidate `0x8d50a68b4f9ada119d198d6472eaf0cB6dB302d9`, the complete requested
window contained 123 inflows from 109 unique senders, 71 exactly equal to 1,000,000 FFT, totaling
176,000,010 FFT. It contained 10 outflows totaling 24,507,000 FFT, all to
`0x343e8a70b212816a5582a880b9cd4c3278c4f360`. Within the same token-transfer window that
dispatcher made 58 outbound transfers to 32 recipients totaling 24,407,000 FFT. These figures are
atomic-integer calculations over complete requested-range logs. Canonical metadata uses
`dataCoverage=1` and `historyCoverage=1` for that requested window, while `sourceCoverage=0.5`
explicitly reserves `1` for two or more distinct source IDs; source count alone does not establish
independent-operator agreement.

A finalized public BSC RPC custody inspection at block `115108692`, hash
`0xae4079645ae5dc487ab5ed20bfa0c09cf1b26c42ad4b3f46d074d68ec1940b9d`, classified the
candidate as Safe 1.3.0 implementation `0x3e5c63644e683549055b9be8653de26e0b4cd36e`, threshold 4
of 6, nonce 11, after matching the implementation/version against the pinned official Safe v1.3.0
registry. Evidence `ev_e6d2e09c7071ef941a71ae18` has payload hash
`86503f972bf8a3e3e5ce9353b1c4a348319aa44a7bb09ba221d66ffe2a2228b2` under model
`safe-compatible-read-v1.1.0`. This proves owner-threshold movability at that Snapshot and
contradicts a technical-lock interpretation; it does not identify the owners or establish the
candidate's official social attribution.

An initial custody replay at the later transfer Snapshot failed with `missing trie node` on one
public endpoint and `not supported` on the second. The later custody-first composition recorded
below avoided that race by pinning current custody before the range scan. Public RPC archive
capability remains unavailable, and all allocation/dividend/action conclusions remain pending or
Unknown. The supplied community statement is claim input, not chain proof; no public official source
exposing the pension address was accepted in this batch.

## Snapshot-bounded claim address-flow derivation (2026-08-10)

The claim kernel now consumes normalized Transfer observations and produces a deterministic address
summary without assigning behavioral meaning to its counterparties. It reports observed inflow and
outflow lower bounds, unique counterparties, first/last observations, self-transfers, share-unit
adherence and ranked counterparties. Actual totals become Known only when data, requested-history
and source coverage are all exactly complete. A zero observed count remains a valid observation,
while the corresponding Actual amount stays Unknown under incomplete coverage and an empty
share-unit denominator is `Unknown(NOT_APPLICABLE)` rather than numeric zero.

The derivation rejects duplicate observations, invalid atomic amounts, ranges after an EVM/Solana
Snapshot block time and individual observations after that Snapshot. EVM comparison defaults to
case-insensitive canonical identity and normalizes counterparty identity deterministically; Bitcoin
and Solana stay case-sensitive unless explicitly overridden. Five focused tests cover complete
observed flow, incomplete-source/no-flow semantics, time-window and case behavior, and fail-closed
Snapshot/duplicate handling plus coverage-Evidence membership. This code has not yet been persisted
or exposed by the API/UI, and it
does not convert the FFT dispatcher into a dividend, controller, entity, burn or other terminal
action.

## Custody-first same-Snapshot EVM composition (2026-08-10)

The composed EVM observer now requires one finalized Snapshot with block time, captures custody at
that numeric block first, writes the custody Evidence, and only then begins the potentially long
ERC-20 Transfer range scan. This ordering closes the failure mode seen in the first FFT experiment,
where public RPC state for the target block was already pruned by the time a long historical scan
finished. If custody capture fails, the history source and Evidence writer are not called.

Each Transfer query chunk now produces a direct `PROVIDER_OBSERVATION` Evidence node containing its
exact address/topic/range and returned log identities. An empty response therefore retains replay
provenance rather than becoming an unevidenced absence. Per-log Evidence remains separate. After
source nodes are written, one `DERIVED_FEATURE` terminal node links custody, query coverage and
target-relevant log Evidence and binds the address-flow report to the exact Snapshot. Composite
`historyCoverage` remains zero:
the Transfer window may be complete, but one current custody read does not establish historical
authority across that window.

Four orchestration tests prove custody-before-scan order, canonical derived edges, source coverage,
EOA movability, flow Unknown semantics, provider short-circuiting, timestamped-Snapshot gating and
pre-provider time/block validation. Collector regressions prove that a complete empty range still
has source Evidence and that indexed sender/recipient queries accept one identical self-transfer
only once. It still performs no dividend/action attribution.

### Live same-Snapshot FFT composition

The custody-first observer subsequently completed one live, finalized run for FFT and the behavioral
candidate. The exact replay anchor was block `115117033`, hash
`0x70d237c08125931915cde4a775ca8e4830044003068bbfa17af3f0756e4ad700`, block time
`2026-08-10T12:00:02.000Z`, captured at `2026-08-10T12:00:01.404Z`. The token's `18` decimals were
read on chain at that block. The official BNB Chain public RPC supplied the pinned custody state and
SQD `binance-mainnet` supplied the finalized Transfer window.

At that identical Snapshot the candidate was Safe 1.3.0 implementation
`0x3e5c63644e683549055b9be8653de26e0b4cd36e`, threshold 4-of-6, nonce 11, with
`canMoveFunds=Known(true)`. Custody Evidence was `ev_373de48c776eebea7c51996e`. The requested
window observed 123 inflows from 109 counterparties totaling 176,000,010 FFT and 10 outflows to one
counterparty totaling 24,507,000 FFT. Its first and last inflows were
`2026-08-03T09:36:09.000Z` and `2026-08-10T07:00:48.000Z`; its first and last outflows were
`2026-08-04T11:20:42.000Z` and `2026-08-10T10:17:50.000Z`. The only top outflow counterparty was
`0x343e8a70b212816a5582a880b9cd4c3278c4f360`. The 1,000,000 FFT rule had 107 exact-multiple
deposits and 16 non-multiple deposits (`0.8699186991869918` observed adherence); the earlier
complete-window derivation counted 71 deposits exactly equal to one unit.

Composite data coverage was `1`, source coverage `0.5`, historical custody coverage `0`, and
confidence `0.95`. Terminal Evidence `ev_a6a115563867c6dfcbcca54b` bound the same-Snapshot result.
Observed amounts are therefore accepted lower bounds, but Actual totals remain
`Unknown(INSUFFICIENT_DATA)`. A movable Safe and recorded outflows refute an irrecoverable-burn or
technical-lock interpretation for the wallet; they do not prove whether individual pension members
can exit, who controlled an action, or whether an outflow was a dividend.

The follow-up implementation now requests only indexed `from` and `to` topics for the subject,
rejects direction mismatches and conflicting duplicate records, retains explicit empty-query
Evidence, and bounds the terminal root to coverage queries plus relevant transfers. SQD metadata and
stream bodies now have hard deadlines; sparse filtered coverage is explicit and does not change the
gap-free default used by continuous Flap scans. All focused deterministic tests pass. A live rerun
of this optimized path exceeded the current outer process execution limit before returning a
terminal result, so it is not recorded as a second accepted run.

## Durable EVM Claim Report replay (2026-08-10)

Migration `011_evm_claim_reports` and a content-addressed repository now persist a completed
same-Snapshot EVM claim-address observation without exposing a write-capable HTTP route. Repository
validation requires canonical token/subject/window identity, a finalized timestamped EVM Snapshot
shared by custody and flow, canonical result hashing, and terminal plus nested Evidence IDs that are
present in the report metadata. Stored rows are revalidated on every exact or latest read, and SQL
guards reject mutation and deletion.

The new latest/exact API routes and Claim Report UI read PostgreSQL only. Deterministic repository,
API and desktop/mobile browser tests passed for replay, identity mismatch, missing/unconfigured
storage, corrupt rows, observed-versus-Actual Unknown semantics, custody, share metrics, Snapshot and
Evidence display. The real PostgreSQL integration test also covers migration health, idempotent
write, restart replay and database mutation rejection. Docker Desktop was unavailable, so a fresh
isolated PostgreSQL 16.10 instance was initialized with trust authentication on loopback, all
migrations `001-011` applied successfully, and the complete PostgreSQL-enabled integration run
passed 59 tests with only three ClickHouse/object-store tests skipped. Nineteen of those tests
exercised real PostgreSQL, including the new Claim Report path. The temporary server was stopped and
its data directory removed.

This is durable observation replay, not automatic capture, official pension-wallet attribution,
dividend/action proof, independent-source reconciliation, market pricing or FFT reference-case closure.

## FFT Pancake V2 market and buy-size validation (2026-08-10)

The production Flap/Pancake V2 market composition executed read-only for FFT at finalized BSC block
`115131838`, hash `0x04d1d1986cc969ac95e1acd6f3bae677a7934fff10758a628207e5e0c1ae22ef`, block time
`2026-08-10T13:51:07.000Z`, captured at `2026-08-10T13:51:06.371Z`. At the identical Snapshot it
verified pool `0xe374af9818c4359374996f86a734fc39eb04d949`, official factory
`0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73`, official Router
`0x10ED43C718714eb63d5AA57B78B54704E256024E`, pair identity, token ordering, bytecode, 18-decimal
FFT/BSC-USDT assets and positive reserves.

The pool held `74891827.839354821963347306` FFT and `30143.481700747512234533` USDT, producing a
reserve spot of `0.000402493604047242` USDT/FFT. With the documented 25 bps Pancake V2 fee and the
Flap inspection's configured 300 bps buy tax, the accepted scenarios were:

|       Input |       Router/model gross FFT |   Configured-tax estimate FFT | Modeled post-buy spot USDT/FFT |              Move |
| ----------: | ---------------------------: | ----------------------------: | -----------------------------: | ----------------: |
|    100 USDT |  `247012.617596385988641107` |   `239602.239068494408981873` |         `0.000405165202846288` |    `66.37618` bps |
|  1,000 USDT | `2398915.968277365381597299` |   `2326948.48922904442014938` |          `0.00042960726637845` |  `673.642066` bps |
| 10,000 USDT | `18620993.39326804405720477` | `18062363.591470002735488626` |         `0.000713397661433456` | `7724.447152` bps |

The official Router and clean-room integer model matched exactly for all three gross outputs: `0`
bps observed error against the `10` bps deterministic budget, validation `PASS`, three evaluated and
zero failed. Terminal Evidence `ev_c1d282e77439383f0b8495b2` closed a 21-node drilldown. Data
coverage was `0.85`, source coverage `0.5`, simulation coverage `0.5`, and confidence `0.96`.
Source coverage intentionally counts the one chain operator once even though it produced multiple
named RPC Evidence observations.

The production SSRF guard correctly rejected the public BSC hostname when this host's DNS
interception resolved it to a private/reserved address. The live validation therefore supplied a
test-only direct-fetch transport to the production `EvmLedgerAdapter`, market composition and
`EvidenceLedger`; it did not change production networking policy or add a production bypass. Actual
execution-net is `Unknown(NOT_QUERIED)` because no pinned-fork swap observed tax/swapback behavior.
Pension-wallet transfer remains `Unknown(INSUFFICIENT_DATA)` for pricing and is treated as movable
custody rather than burn. This run is not independent-provider, sell-route, gas/capacity, entity,
claim-action, or complete FFT reference-case acceptance.

## FFT Pancake V2 exit-size and partial-RV validation (2026-08-10)

The companion token-to-quote run captured finalized BSC block `115137197`, hash
`0x600b38f896ddc58ceac21169a1c285aef495bce92bbbb67b80249a86c672db75`, parent
`0x04b5caa497d203de2fa5b96354cbf4aea54046c2578f0a15f30d1b5afed9a3af`, block time
`2026-08-10T14:31:19.000Z`, captured at `2026-08-10T14:31:19.012Z`. The same production market
certificate verified the official Pancake V2 identities and observed
`74586827.793161266597497691` FFT plus `30267.053563947710181207` USDT reserves, reserve spot
`0.000405796230507108` USDT/FFT and configured sell tax `300` bps.

|  Input FFT |         Nominal spot USDT |         Router gross USDT | Configured-tax pool estimate USDT | Total exit haircut | Quote reserve consumed |
| ---------: | ------------------------: | ------------------------: | --------------------------------: | -----------------: | ---------------------: |
|  1,000,000 |  `405.796230507108956541` |  `399.439762336147983189` |          `387.610030249454467789` |   `448.160896` bps |        `128.06335` bps |
|  5,000,000 | `2028.981152535544782706` | `1897.055669041575774379` |         `1843.610572166868587816` |   `913.614106` bps |       `609.114649` bps |
| 10,000,000 | `4057.962305071089565413` | `3570.332704241699971628` |         `3475.522007411636832561` |  `1435.302385` bps |      `1148.285544` bps |

All Router gross outputs matched the clean-room 25 bps model exactly (`0` bps error against the 10
bps budget). Terminal Evidence `ev_9627b639672d93ae97fef938` closed 23 nodes; data/source/history/
simulation coverage was `0.9/0.5/0/0.5` and confidence `0.94`. The live path again used the
test-only direct transport because local DNS interception activates production SSRF rejection; no
production bypass was added.

Nominal value is not RV, and the configured-tax result is still not wallet settlement. Actual
execution-net and executable capacity are `Unknown(NOT_QUERIED)` until a pinned fork tests dynamic
tax, exemptions, max-sell, blacklist/whitelist, swapback, gas, reverts and the final balance delta.
This is one route and one chain operator, not independent-source or complete FFT reference-case acceptance.

## Entity structural Precision/False-Merge validation (2026-08-10)

`npm run eval:entity` evaluated the test-only `entity-structural-golden-v1` corpus under policy
`entity-precision-gates-v1.0.0`. The content hash was
`3ca725adc8414280f381426a88c86e659d3ef7f5ec1fb1712621cc28c1f77e63`; six of seven cases emitted
all three probabilities and the evidence-absent case remained an explicit abstention, giving
probability coverage `0.857142` rather than a fabricated score.

| Structural gate                      |    Requirement | Observed | Status |
| ------------------------------------ | -------------: | -------: | :----- |
| High-confidence controller precision |      `>= 0.98` |      `1` | PASS   |
| Coordination precision               |      `>= 0.95` |      `1` | PASS   |
| Service Hub false-merge rate         |     `<= 0.001` |      `0` | PASS   |
| CoinJoin false-merge rate            |          `= 0` |      `0` | PASS   |
| Expected-class regression            | `0` mismatches |      `0` | PASS   |

The corpus covers deterministic authority plus funding, coordinated-but-independent behavior,
independent histories, labeled and path-derived Service Hub suppression, CoinJoin suppression, and
no-evidence abstention. It lives only under `evals/`; no fixture is connected to a production API.

The evaluator also emitted Brier/ECE diagnostics for controller (`0.012080651809` / `0.047741`),
coordination (`0.000462835742` / `0.020685`) and independence (`0.168571890082` / `0.242454`). These
values are `DIAGNOSTIC_ONLY`: a seven-case structural suite is not a real calibration corpus. The
real-world gate requires Snapshot-bound prediction Evidence, label source references, at least 100
labeled cases per probability axis, Brier `<= 0.15`, and ECE `<= 0.05`; missing cases or denominators
produce `INSUFFICIENT_DATA`. Therefore entity calibration and the FFT reference case remain open.

## Claim Audit input-integrity validation (2026-08-10)

Claim Audit model `claim-audit-v1.1.0` now rejects an audit before calculation when its rules mix
asset IDs, action IDs repeat, normalized custody addresses collide, or a rule window, Transfer or
action occurs after the Snapshot time bound. For timestamped EVM/Solana Snapshots the bound is the
earlier of block time and capture time; other Snapshot types conservatively use capture time.

Terminal-action tests also verify that a direct observation is rooted exactly at the claim
destination and a multi-hop action uses unique contiguous Transfer edges, the destination as actor
and path root, non-decreasing edge time, and no edge after the action observation. Invalid paths are
not credited; under complete coverage the action amount remains known zero only because the bounded
scan is complete, not because missing data was coerced. Incomplete coverage continues to return
`Unknown(INSUFFICIENT_DATA)`.

The focused Claim Audit suite passed 12 tests; the complete unit suite passed 369 tests and the
coverage run passed 413 tests with 22 opt-in durable tests skipped. No provider endpoint, fixture,
or manually supplied action was added to a production route in this batch. Same-Snapshot action
derivation and complete reference-case Claim Audit remain pending.

## Claim declaration review acceptance (2026-08-11)

The deterministic `claim-declaration-parser-v1.0.0` compiler was exercised with the supplied FFT
community wording. It emitted six mandatory-human-review drafts: tax receiver, community fund,
buyback burn, buyback liquidity, pension vault and dividend distributor. The four explicitly
published addresses were normalized into their matching roles; the allocation rules were preserved
as `10000`, `2000`, `4000` and `4000` basis points. Pension wording was retained as 1,000,000 human
token units per share with `noExit=true`, and weekly dividends as a 604800-second cadence.

The statement did not publish a pension-wallet address, and `8月2号` did not specify a year or
timezone. Both remain Unknown/Incomplete with an explicit date warning. The compiler did not
substitute the previously observed behavioral candidate, did not infer token decimals, and did not
convert the declaration into burn, dividend, lock or other chain-action proof. The submitted text is
stored as `ANALYST_OBSERVATION` Evidence; an integration test replays that Evidence through the
existing Evidence API.

The new read-only API and Claim Audit UI passed a real local API-to-browser replay on Chromium. This
also exposed a clean-start defect: the API allowed the dev origin on port 5173 but not the repository's
own preview origin on port 4173, causing browser-origin requests to be reported as internal errors.
Local dev/preview origins are now explicit for localhost and 127.0.0.1, and a disallowed origin is a
typed `403 CORS_ORIGIN_DENIED` rather than a 500. Production deployments must still configure their
exact public origin. No chain provider, private key, signing, swap, transaction broadcast or
production fixture path was added.

## FFT supply-conserved burn validation (2026-08-11)

Model `erc20-burn-conservation-v1.0.0` adds a fail-closed, exact-block certificate before a
zero-address Transfer can become a Claim Audit action. Schema, kernel, platform composition and API
tests cover conserved mint plus multiple burns, ordinary transfers, supply/event contradictions,
no-action blocks, incomplete coverage, cross-block logs, zero-to-zero events, malformed supply,
wrong parent lineage and downstream Claim Audit consumption. Desktop and Pixel 7 browser flows
exercise the real API contract through the responsive Claim Audit panel without putting fixtures in
the production path.

The first named FFT probe used the finalized 2 August boundary from the earlier claim observation.
Four contiguous sparse SQD `binance-mainnet` queries completed the inclusive range
`113485950-115154970` and returned no FFT `Transfer` whose indexed destination was the zero address.
This is a complete result for that exact filter and requested range, not proof that no custom
supply-changing code executed. No absent or incomplete provider response was counted as numeric
zero.

The public statement's buyback-burn address
`0x0928Ecc01081CB765d349f49cfc4e78Fc8acd630` was then inspected at finalized block `115155326`,
hash `0xd001f8df0c76a32b5139dea31fb8e5e4914050dc8323041c467d28419814f3ac`, timestamp
`2026-08-10T16:47:20.000Z`. It had no bytecode and was classified as an EOA with
`canMoveFunds=Known(true)`. Custody Evidence `ev_c86fc87af2444fa903aea7a3` has payload hash
`0518f5ddcaf94bac3353f451b40586d19750b5eaa3ce909b4890b4a65d20e417`. The wallet held
`1503182.822387066751417917` FFT, about `0.1503182822%` of the one-billion-token supply. This is
movable custody and cannot be credited as irreversible supply burn merely because the community
calls it a burn wallet.

A separate Alchemy archive read compared the requested window boundary parent block
`113485949`, hash `0xc7361bcf5072c77f45d1786b06863333488a0cd9bf44e87d8d185df7634a513e`, with block `115155326`.
`totalSupply` was exactly `1000000000` FFT at both positions. The published burn wallet balance rose
from `5845.436544272040753992` to `1503182.822387066751417917` FFT. Net supply equality does not
exclude an intermediate mint and burn that cancel, so this comparison remains a bounded net-change
check rather than a complete lifetime action conclusion.

The exact-block model was replayed through project code at block `115155326`. Parent and target
atomic supply were both `1000000000000000000000000000`; the complete target-block Transfer query
was empty; minted and burned amounts were both `0`. The validated status was `NOT_APPLICABLE` with
no actions. Terminal Evidence `ev_1065c77a6f098221f54d151a`, payload hash
`0af50489a423041b26135225f110c06fcdb2bca7d4947a58abe59f9c3e29e15f`, links parent supply
Evidence `ev_51473c82d86a1ef345191420`, target supply Evidence
`ev_c39efac617386c29a72fdf9c`, and complete empty-query Evidence
`ev_384d526d2f3183b6fd7843df` under the exact finalized Snapshot.

The two BNB Chain public endpoints exposed their real archive boundary during replay: one first
rate-limited and later returned `missing trie node`; the other returned `not supported` for the
parent-block call. These states were retained as provider failures. The user-supplied Alchemy key
was injected only into the validation process from the local attachment, never printed, persisted
or written to the repository. The successful certificate has `sourceCoverage=0.5` because it is one
provider. Wide-range silent-supply analysis, independent-provider reconciliation, official wallet
attribution, reviewed-draft promotion and FFT reference-case closure remain open.

## Burn candidate range acceptance (2026-08-11)

Model `erc20-burn-candidate-discovery-v1.0.0` adds a bounded long-range discovery layer before the
exact-block certificate. It reuses SQD `binance-mainnet` with sparse finalized continuation and
queries both indexed zero-address directions. Only non-zero `to=0x0` Transfers become candidate
blocks; same-block mint totals are retained as context. Every query, returned log and terminal
result is canonical Evidence bound to the finalized range-end Snapshot.

The Schema and platform tests cover multiple burns in one block, same-block mint context, ordered
multi-block candidates, zero-amount exclusion, no-candidate ranges, ambiguous zero-to-zero events,
the 5,000,000-block budget, canonical Evidence and replay tampering. API integration exercises the
real runtime composition. Chromium desktop and Pixel 7 render the event scope, candidate count,
terminal Evidence and explicit `Unknown(NOT_QUERIED)` silent-supply state.

`historyCoverage=1` and `dataCoverage=1` refer only to
`ERC20_ZERO_ADDRESS_TRANSFER_EVENTS`. An empty result is named `NO_EVENT_CANDIDATES`; it is not a
statement that `totalSupply` never changed through custom or silent storage writes. Durable
promotion scheduling, all-block silent-supply discovery, independent-source reconciliation and
FFT reference-case closure remain open.

The production discovery path was then replayed against FFT over the exact inclusive range
`113485950-115154970`. Alchemy supplied the finalized range-end Snapshot at hash
`0x428fae3cf1516692f1a1fa9a46f2ecaeddf627e890466c82ff68367d32427ddb`; SQD completed four sparse
direction/chunk queries in about nine minutes. The validated result was `NO_EVENT_CANDIDATES`, with
zero non-zero zero-address events, zero candidate blocks and five Evidence nodes. Terminal Evidence
is `ev_b938c11599c5735884f5e376`. Silent supply-change detection remained
`Unknown(NOT_QUERIED)`. The Alchemy credential was injected process-locally from the user attachment
and was neither printed nor persisted.

## Durable FFT burn-promotion acceptance (2026-08-11)

Model `erc20-burn-candidate-promotion-v1.0.0` now composes long-range event discovery with exact
candidate-block supply certificates behind the generic PostgreSQL semantic checkpoint. One run is
bounded to five segments and 5,000,000 blocks. A segment advances only after its two indexed
zero-address queries, all candidate certificates and their Evidence roots succeed; a partial run
has no terminal result. Schema and worker tests cover completion, provider-free replay, interrupted
resume, corrupted state, storage preflight, write-like argument rejection and the distinction
between scoped event coverage and silent supply-change Unknown.

The first live attempt exposed a real request-budget defect: one event segment requires two SQD
requests because sender-zero and destination-zero are separate indexed queries. The worker failed
before cursor advancement with zero Evidence IDs. The budget was corrected from one to two and a
regression assertion was added. A subsequent full run exposed a provenance defect: an empty
candidate segment listed SQD in `sourceSet` but omitted the BSC RPC that supplied the range-end
Snapshot. The Schema now requires every Snapshot `providerVersions` source in the segment source
set, and `snapshotSourceSetPolicy=provider-versions-v1` is part of immutable scan identity so the
older result cannot be silently reused.

The first retry of that new identity then correctly returned `SNAPSHOT_CONFLICT`: Evidence
observation time had been fixed to block time, so a recaptured Snapshot with a new `capturedAt`
would have attached one Evidence ID to two Snapshot identities. No cursor was advanced. The worker
now uses the current Snapshot capture time for Evidence identity. Within one captured terminal
state this remains idempotent; a later recapture receives a distinct immutable Evidence ID instead
of mutating or conflicting with the earlier graph. Focused tests assert both discovery/certificate
and terminal Evidence capture-time binding.

The corrected production run completed the exact FFT range `113485950-115154970` in two durable
segments under scan `c2b6c82f-abf6-40e4-a824-4e5b86a07485`. Final Snapshot block/hash were
`115154970` / `0x428fae3cf1516692f1a1fa9a46f2ecaeddf627e890466c82ff68367d32427ddb`.
The result contains zero non-zero zero-address events and therefore zero candidate certificates or
actions. This is a known zero for the declared event scope only. Silent supply-change detection is
`Unknown(NOT_QUERIED)`.

Terminal Evidence `ev_a0cfab9b9947fc01565f4018` links the two segment roots
`ev_88301712203c22e89effd32d` and `ev_b10cfc470d297e8f325a0734`. The final source set is
`bsc-rpc@bsc-dataseed.bnbchain.org#1` plus `sqd:binance-mainnet`; source coverage remains `0.5`
because endpoint presence is not independent-source reconciliation. Re-running the identical scan
with deliberately unresolvable `rpc.invalid` and `sqd.invalid` provider URLs completed in under two
seconds with the same scan/result/Evidence IDs, proving terminal replay used PostgreSQL only. The
same check passed from the rebuilt production semantic-worker container in 2.4 seconds.

The rebuilt production API returned this exact result from PostgreSQL with coverage `1`, two
segments, the same terminal Evidence and `Unknown(NOT_QUERIED)`; the provenance-incomplete older
scan was rejected with HTTP 502. An unmocked headed Chromium session then replayed the scan through
the rebuilt Web container and rendered both segment Evidence IDs, the terminal root and Unknown
boundary. The focused panel screenshot is retained under ignored local test output, not committed as
product data.
Continuous scheduling, complete all-block history, official wallet attribution and FFT
reference-case closure remain pending.

## FFT bounded all-block supply continuity (2026-08-11)

Model `erc20-supply-continuity-v1.0.0` adds the complementary path that event-only discovery could
not cover. It reads `totalSupply()` by EIP-1898 canonical block hash at the parent of the requested
range and every finalized block inside it. A segment advances only after all configured sources
agree on block/hash/parent/timestamp/supply. Every detected transition must also pass the existing
complete same-block mint/burn conservation certificate. Deterministic tests cover independent and
same-operator status, exact source conflict before advancement, durable terminal replay, worker
storage preflight, argument boundaries, API identity/storage failures and desktop/mobile rendering.

The first older-block live probe was intentionally retained as an availability finding: Alchemy
returned historical state while the BNB Chain public endpoint returned JSON-RPC `-32000` / `missing
trie node`. The scanner returned `RPC_ERROR` and did not advance the checkpoint. This is provider
retention failure, not unchanged supply.

A recent independent-source run then completed FFT blocks `115188144-115188147` under scan
`0ee1a747-0d83-4cad-a5ab-3aaf0e2a3981`. Alchemy and BNB Chain returned identical finalized block
identities and five supply samples across four transitions. Initial and final atomic supply were
both `1000000000000000000000000000` (`1,000,000,000` FFT at the separately observed 18 decimals),
with net delta `0`, zero supply-change blocks and status `VERIFIED_NO_CHANGE`. The registry resolved
two distinct operators; terminal Evidence is `ev_5074fef4eb70f879c3e2e48d`.

The identical command was rerun with an intentionally invalid Alchemy credential. It returned the
same scan ID, counts, status and terminal Evidence in 1.6 seconds, proving the completed result was
replayed from PostgreSQL without RPC or SQD access. The credential supplied by the user was loaded
process-locally, never printed, persisted or committed. This acceptance is exact-range only and
does not prove the 2 August-to-head history, wallet attribution, burn irreversibility, dividend
semantics or complete FFT reference-case conclusions.

The production semantic-worker image repeated that invalid-credential replay successfully. Rebuilt
API/Web containers were healthy and read-only; the API returned the same scan/status/Evidence from
PostgreSQL, terminal Evidence drilldown traversed 26 stored nodes, and an unmocked Chromium session
rendered the verified status and terminal root in Claim Audit. Top-level health remained
`DEGRADED` because the local provider DNS policy reported three sources down and one unconfigured;
durable storage was `UP`, and the provider degradation was not converted to a supply result.

## Automated verification

Before the current full-store run, the persistent local ClickHouse volume exposed a pre-Evidence
empty `MergeTree` `raw_chain_facts` table with no `fact_id`. The three all-store tests correctly
failed `CLICKHOUSE_NOT_INITIALIZED` / `NO_SUCH_COLUMN_IN_TABLE`. After confirming its row count was
zero, the table was non-destructively renamed to
`raw_chain_facts_legacy_pre_evidence_20260811`, the current initialization SQL was reapplied, and
both tables remained present. No legacy row was discarded or assigned fabricated Evidence.

| Command                  | Result                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| local non-browser gates  | pass: format, lint, typecheck, 425 unit, 60 environment-free integration, 1 model-eval and build; dependency license/audit gates green                                   |
| local durable stores     | pass: PostgreSQL migrations `001-012`, canonical ClickHouse and versioned object store; all 83 integration tests passed                                                  |
| local `test:coverage`    | pass: 485 tests, 23 opt-in durable skips; 82.85% statements, 76.97% branches, 91.99% functions, 83.99% lines                                                             |
| `npm run eval:entity`    | pass: 7-case structural corpus; controller/coordination precision 1, Service Hub/CoinJoin false merges 0, one explicit abstention                                        |
| branch `test:coverage`   | pass on `23b3306`: 385 tests; 83.74% statements, 77.99% branches, 92.22% functions, 84.78% lines                                                                         |
| `npm run test:e2e`       | pass: 24 Chromium tests across desktop and Pixel 7, including EVM Control Rights, supply continuity, market/RV, burn, Claim Declaration/Report and Unknown               |
| `npm run sbom`           | pass: CycloneDX JSON generated locally                                                                                                                                   |
| `docker compose config`  | pass                                                                                                                                                                     |
| production Compose smoke | pass: API/Web and all worker targets rebuilt; keyless API/Web healthy/read-only and immutable FFT control report replay passed                                           |
| branch GitHub Actions CI | [pass on `2d115c3`](https://github.com/greywolf8888/ZeroTrace/actions/runs/31433097623): full CI matrix, structural model gate, 22 Chromium flows and production targets |
| branch CodeQL            | [pass on `2d115c3`](https://github.com/greywolf8888/ZeroTrace/actions/runs/31433098888): JavaScript and TypeScript analysis                                              |

The latest complete all-store durable run used the local Compose PostgreSQL 17.10, ClickHouse 26.7
and MinIO services. All 83 integration tests passed; the PostgreSQL subset passed all 19 tests with
migrations `001-012`. The complete environment-free, browser, dependency, SBOM, production-image
and Compose gates were rerun before push.

The current batch also built the production API and Web images and started the default seven-service
Compose topology. Host port `5432` was already allocated, so the project PostgreSQL mapping used the
documented environment override `55439`; no external database process was stopped. The retained
ZeroTrace volume contained only migrations `001-002`. A custom-format `pg_dump` backup was written
inside that project volume before the missing append-only migrations `003-011` were applied in
order. Migration `012` was then applied for immutable EVM control-surface reports;
`schema_migrations` reported the complete `001-012` sequence and API storage health became `UP`.

Because this host resolves public provider domains through a private-range interception proxy, the
default `ALLOW_PRIVATE_PROVIDER_URLS=false` correctly returned provider-down readiness. A local-only
restart enabled the documented private-network opt-in while retaining the exact hostname allowlist;
no repository default or secret changed. PostgreSQL, ClickHouse, MinIO, Valkey, NATS, API and Web all
became healthy. `npm run health` returned live `UP`, ready `UP`, `readOnly=true` and four provider
entries; BSC, Bitcoin and Solana were `UP`, while Ethereum remained explicitly `UNCONFIGURED`.

Archive history beyond block headers, load, forced real-provider failover, reorg, backup/restore, and
production security controls remain acceptance gates. The branch results are immutable pre-promotion
evidence; protected `main` has not yet received this development batch.

## FFT independent market and RV reconciliation (2026-08-11)

The production reconciliation route was executed read-only for FFT
`0xdcfb441a1f38802820a4e7b4cc8aab37833c7777` through two officially documented BSC
operators: `bnb-mainnet.g.alchemy.com` resolved to Alchemy and
`bsc-dataseed.bnbchain.org` resolved to BNB Chain. The user-supplied Alchemy credential was read
process-locally from the attachment, was not printed or persisted, and was removed from the parent
environment. Because this host resolves provider domains through a private-range interception
proxy, only the temporary validation process used `ALLOW_PRIVATE_PROVIDER_URLS=true`; repository and
Compose defaults remain fail-closed.

The first complete run reconciled finalized block `115179695`, hash
`0x7054294e11db4811df556d2c85835420181b670cf8049e024a161ea67905af89`. Source independence was
`VERIFIED_INDEPENDENT`; all 37 comparisons passed with zero warnings, failures, inconclusive checks
or coverage gaps. Fifteen numeric comparisons entered the error denominator. Exact market identity,
decimals, reserves, fees, taxes, pair timestamp and deterministic outputs had zero mismatch; the
independent Router quote/RV checks stayed within the 0.50% budget.

The Pancake V2 pool was `0xe374af9818c4359374996f86a734fc39eb04d949` against BSC USDT
`0x55d398326f99059ff775485246999027b3197955`. It held
`73,660,551.823833706703241137` FFT and `30,650.325089732606316067` USDT, producing reserve spot
`0.00041610230076793` USDT/FFT.

| Buy input (USDT) | Router gross FFT            | Configured 300 bps tax estimate | Modeled post-buy spot |
| ---------------- | --------------------------- | ------------------------------- | --------------------- |
| 100              | 238947.060226229359049905   | 231778.648419442478278407       | 0.000418818482498961  |
| 1,000            | 2321688.780696396579854181  | 2252038.117275504682458555      | 0.000443661753770791  |
| 10,000           | 18086353.840118338881877371 | 17543763.224914788715421049     | 0.000731460400051912  |

| Exit input (FFT) | Nominal spot USDT       | Router gross USDT       | Configured-tax USDT     | Modeled post-sell spot |
| ---------------- | ----------------------- | ----------------------- | ----------------------- | ---------------------- |
| 1,000,000        | 416.102300767930795232  | 409.516435670612827086  | 397.390227530496510151  | 0.00040536930416399    |
| 5,000,000        | 2080.511503839653976161 | 1943.703535434754583708 | 1888.986155432972203033 | 0.000366337240869684   |
| 10,000,000       | 4161.023007679307952322 | 3655.58648329449500842  | 3558.651829953946931547 | 0.000324993928987318   |

These buy values model acquisition before transferring tokens into pension custody. Such a transfer
does not change pool reserves, does not reduce `totalSupply`, and is not counted as a second burn or
price impact. The configured-tax figures apply the Portal-reported 300 bps configuration to the
verified pool model; they are not execution receipts. Actual wallet receipt, settlement delta,
dynamic tax/swapback, max-sell, blacklist, gas, reverts and executable capacity all remain
`Unknown(NOT_QUERIED)` until a pinned-fork execution exists.

The run was repeated against PostgreSQL at finalized block `115180163`, hash
`0xb834c88b35c1a92dfe5d9c69af079825aa78832b048d591af96bc5d429df0279`. It again passed 37/37.
Registry Evidence `ev_b8f129251ea6679da7b83f1b`, independence Evidence
`ev_e540983d3bd41ef0a3370c8b`, and terminal Evidence `ev_fde8795ff3b8bf6671535f21` close a
91-node drilldown. The provider-configured process was stopped; a new API process with no Alchemy
credential or BSC provider pool then loaded the same 91 nodes from PostgreSQL, proving provider-free
Evidence replay.

This closes the scoped independent-source gate for current Flap/Pancake V2 market and modeled RV.
It does not close historical executable-quote calibration, fork settlement, additional routes,
official pension-wallet attribution, complete claim flows, entity calibration, archive retention,
forced-reorg behavior or FFT reference-case closure.

## FFT EVM control-surface validation (2026-08-11)

The production inspection route read FFT through Alchemy and the official BNB Chain public RPC at
one common finalized block. Both operators returned byte-for-byte identical contract code,
EIP-1967 slots, ERC-173 owner call and Safe-probe state at block `115199429`, hash
`0x8bd43eaa5ec636bf3f9b0caf6f6f642fc9072a69c636c076ea5d5b085f5654d3`.

The exact 45-byte runtime matched ERC-1167 and resolved the fixed implementation to
`0x024f18294970b5c76c0691b87f138a0317156422`. ERC-173 `owner()` returned the zero address;
the EIP-1967 implementation/admin/beacon slots were zero. The engine emitted zero direct rights,
seven Known coverage entries and 16 Unknown entries across the fixed 23-domain matrix. Upgrade
authorization remains Unknown because a fixed redirect does not prove target-code immutability or
recursive implementation control. This is not
a claim that no controller exists: custom implementation authorization, tax, blacklist, trading,
treasury, LP and historical/recursive controller surfaces remain unqueried.

The API stored report `ecs_14af3cdb90ffa23d388ba10a`, result hash
`54a15e586f0e7701df1c39459e24a657928c0c67539cc917d80d52c1505bf8af`, with seven
Evidence nodes and terminal root `ev_b8b0fe2ae38165e2128664c7`. Migration
`012_evm_control_surface_reports` was present and exactly one row matched the ID/hash. PostgreSQL
integration also verified idempotent replay, repository restart, canonical hash/provenance checks,
and database rejection of update/delete.

After capture, the API container was recreated with `ALCHEMY_API_KEY` empty and two keyless BNB
public endpoints. A container-environment assertion found no Alchemy URL credential residue.
Provider-free latest and exact-ID reads returned the same report ID, result hash, Snapshot hash and
terminal Evidence, while readiness remained `UP`. The supplied credential was never printed,
written to repository files or retained in the final container.

### Recursive logic and Sourcify V2 extension

The v1.1 route repeated the independent Alchemy/BNB Chain inspection at finalized block
`115204533`, hash `0xf8c1476af87b6ccd90077145d72e8578664f50f0e629c115a0765ac756e64f55`.
Both operators also returned identical 19,331-byte runtime logic at implementation
`0x024f18294970b5c76c0691b87f138a0317156422`, with Keccak-256 hash
`0xb530a7e0ff0d6ab435a5ec71f2b04092937735e23a0fb3a0746724ce9b875b4a`.

The bounded Sourcify V2 adapter returned an exact `FlapTaxTokenV3` match compiled with Solidity
`0.8.24+commit.e11b9ed9`; its full runtime bytecode equaled the Snapshot-bound RPC bytecode before
the report accepted source provenance. The verified ABI declares owner-transfer and migration
mutations. They remain `DECLARED_ONLY`: zero current direct rights were emitted, and migration
coverage is `Unknown(INSUFFICIENT_DATA)` until effective authorization and reachability are proved.

PostgreSQL accepted report `ecs_d57a8094dae726623a47090a`, result hash
`b863f2a3c7d04e7c72e2e2cc339970b7829f7d9e5e6b31a507443cd2b0aae7e7`, and terminal Evidence
`ev_15ba74e221b8a914eb59702b`. Migration `013_evm_control_source_provenance` enforces exact
logic/source identity, source-set inclusion and declared-capability Evidence for v1.1 inserts.
Unit storage acceptance additionally replays legacy immutable v1.0 reports without manufacturing
the new fields.

The API/Web containers were then rebuilt with `ALCHEMY_API_KEY` empty and two public BNB Chain RPC
URLs. A container-local assertion confirmed no key and no Alchemy credential URL remained. Readiness
stayed `UP` with `readOnly: true`, and the provider-free latest-report route replayed the same v1.1
report ID, result hash, finalized Snapshot, 19,331-byte logic hash, exact source match, two declared
capabilities, zero direct rights and the unchanged 8/25 Known coverage result.

## Bitcoin UTXO and script-control validation (2026-08-11)

The production API path queried the configured public Blockstream Esplora endpoint across two
best-chain Snapshots. The address observation used height `961941`, block
`0000000000000000000157b3f16edc2d7239f37ee76f399895ace9f1b7cac2c7`, previous block
`000000000000000000021020a8673bd2888ef709e57ce0627a95e59d85fb8c40`. The two outpoint
observations used height `961942`, block
`000000000000000000019fdf691bd3d5fca881d4279fd5ef747b5df5ecd6cbe1`, previous block
`0000000000000000000157b3f16edc2d7239f37ee76f399895ace9f1b7cac2c7`.
The local environment maps external hosts through reserved `198.18.0.0/15`; one process-local
validation invocation therefore enabled the documented private-network development override. The
repository default remained `ALLOW_PRIVATE_PROVIDER_URLS=false`, and every request stayed HTTPS
and read-only.

Address `bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4` reported 166 confirmed transactions,
zero current balance and an empty UTXO set. The independent address-stat and UTXO representations
reconciled exactly; these zeros are provider observations at the captured Snapshot, not defaults.
Evidence roots were `ev_f07dd6eb49f75dfa8f488258`,
`ev_2e522c9e7dc071df81567b15`, and `ev_49f3675b7a25eabb359f4e3a`.

An initial sequential validation crossed the live transition from height `961941` to `961942`.
The in-flight outpoint request was rejected with HTTP 502 instead of combining observations from
different tips, and the subsequent request observed the transport circuit as HTTP 503. Fresh,
individually rate-limited processes then completed both outpoint queries at one stable tip. This is
the intended fail-closed behavior; a tip transition is not silently treated as a stable Snapshot.

The same API queried funding transaction
`8cecb5275e9e2a806bb3d9669226ad25acdcc40acd1aab3b10104f7bdb17e782`.
Output `:1` was a 1,000-sat P2WPKH output spent by input 0 of confirmed transaction
`75143e36784fbebace4b207a4dcbd4ca752cd314bc32b47ca732c32c428f038f`.
The script matched the returned address, the spending input matched the funding prevout, and the
derived Evidence was `ev_236b5f398530c818d1616d5a`. The single-key spend condition is Known;
the real-world controller remains `Unknown(INSUFFICIENT_DATA)`.

Output `:0` was an unspent 13,628-sat P2TR output. The output-key/address commitment matched, while
the internal key, optional script tree, spend path, multisig threshold and controller correctly
remained Unknown. Its three Evidence IDs were `ev_90eb2bce31112f57c8ba4994`,
`ev_f75114e39e24a57e9e527f18`, and `ev_d1db5e4013660b21afb61ef4`.

This closes scoped Esplora address/UTXO and standard-script validation. It does not close
self-hosted Core/archive reconciliation, active full-RBF policy, inherited replaceability, CPFP
package state, hidden Taproot tree reconstruction, clustering, custody attribution, or controller
identity.

## Bitcoin transaction entity-safety validation (2026-08-11)

The production query path then evaluated two public Blockstream Esplora transactions with the same
process-local HTTPS development override described above. The repository default remained
`ALLOW_PRIVATE_PROVIDER_URLS=false`. Each result linked the raw transaction, pinned BIP78 revision
`c38071c8c45a1fc50cecaac0d82d99e3bbd56911` and derived
`bitcoin-transaction-entity-v1.0.0` payload as three separate Evidence nodes.

Historical transaction
`074b02b446a3d55b26c33582f7a1b44691cd94ae87f50f430288b3213fea596a` was bound to height
`576833`, block `000000000000000000188cc008f9fa40fe9b2815504dfec4c05c3a9be6a1334b`
and previous block `0000000000000000002099f12fa3e30b1b00399fa83ca04f9aa0029f096d4ea8`.
Its 103 inputs covered 102 distinct addresses; all 194 output addresses were present. Exact arithmetic
reconciled `3860720304` input sats to `3860691308` output sats plus `28996` fee sats over 13,003
virtual bytes (`2.22994693` sat/vB). The transaction contained equal-output groups of 84, 20, 12,
4 and 2 outputs at successively larger denominations, plus a separate two-output group. The model
returned `EQUAL_OUTPUT_COINJOIN_LIKE`, suppressed all change candidates, fixed automatic ownership
merge to false, and retained ownership and selected change as `Unknown(PRECISION_UNSAFE)`. Evidence
IDs were `ev_54725e335f15f673131de166`, `ev_0d61835ca366b112fb6dee5b`, and
`ev_656bb8baf5a074b91b48863f`.

A recent ordinary-shape two-input/two-output transaction,
`002c6f73779400839839b971662ef3fcec4d31c6d00d8634d8491eac6ccae715`, exposed a real Esplora
compatibility case: both P2PKH inputs legitimately omitted the `witness` field. ZeroTrace now maps
that omission to an empty witness only for legacy inputs and continues to reject absent witness data
for native SegWit/Taproot prevouts. The corrected path bound the transaction to height `961943`,
block `00000000000000000001010fa4088d847725c09a30b4aa36a575b16b3d382bd6`, previous block
`000000000000000000019fdf691bd3d5fca881d4279fd5ef747b5df5ecd6cbe1`. It reconciled 138,431
input sats to 129,898 output sats plus an 8,533-sat fee over 371 vB (`23` sat/vB). The bounded
screen reported `NO_STRONG_PATTERN_OBSERVED` and one same-script unique-value change candidate, but
Payjoin and service attribution remained unresolved, automatic merge stayed false, and ownership
plus selected change remained `Unknown(PRECISION_UNSAFE)`. Evidence IDs were
`ev_cd96a240a1315fe51983fab5`, `ev_01d4666bfed1e7879480de6c`, and
`ev_0bc94a650e820b8fe5f1fc45`.

These observations validate transaction-level feature extraction and suppression, not ground-truth
CoinJoin protocol attribution or common control. Complete address history, service labels, Payjoin
provenance, peeling chains, protocol-specific classifiers, independent graph sources and a labeled
calibration corpus remain required before any production entity merge.

The completed local gate passed 448 unit tests across 66 files, 67 environment-free integration
tests, 24 opt-in PostgreSQL/ClickHouse/MinIO integration tests, one Entity structural evaluation and
32 Chromium desktop/mobile E2E tests. The 539-test durable coverage run reached 83.37% statements,
78.08% branches, 93.51% functions and 84.56% lines. Formatting, lint, typecheck, production build,
license allowlist, development and production dependency audits, CycloneDX SBOM generation,
Compose validation, and all six production Docker targets passed. Exact-SHA remote CI remains a
separate pre-merge gate for this batch.

## Solana v0 transaction-semantics validation (2026-08-11)

The production API query path read finalized public-mainnet transaction
`5TVTwAzh85bCJ5tMxLprQPC6yBw2pKTuQTp6qaJapA2m21X9pgUK1QYDKJLKPt3JXVTZQiauxsNEGKFr76iDjqAN`
from `api.mainnet.solana.com`. It rebound the transaction to slot `438523420` and blockhash
`DG63SznvcBCHpRVqoZGdXdpNHfRrgwsM2VMG38EBu4pU`. The version-0 message referenced six Address
Lookup Tables and resolved all 11 static, 20 loaded-writable and 23 loaded-readonly accounts, for
54/54 account coverage.

The normalized result retained six outer instructions and 26 recorded CPI instructions. The raw
transaction, each normalized instruction and the terminal semantic result formed 34 linked Evidence
nodes. After accounting for the 15/16 exact pre/post token-identity pairs, the response reported
data coverage `0.9895833333333334`, confidence `0.940104`, source set
`solana-rpc@api.mainnet.solana.com`, and model versions
`solana-transaction-query-v1.0.0` / `solana-transaction-semantics-v1.0.0`.

Sixteen account/mint token-balance identities were observed. Fifteen had matching pre/post records
and exact integer deltas. One identity existed only in the post-balance table; its pre amount and
delta remained `Unknown(INSUFFICIENT_DATA)` instead of being coerced to zero. This validates the
intended recording boundary on real data. It does not establish a decoded swap/event meaning,
controller identity, launchpad lifecycle, independent-provider agreement or archive replay.

This host resolves the public provider through a private-range interception proxy, so only the
temporary validation process used `ALLOW_PRIVATE_PROVIDER_URLS=true`. The repository default stayed
fail-closed, the allowed hostname remained exact, and all calls were read-only.

The completed local gate passed 453 unit tests across 67 files, 68 environment-free integration
tests, all 92 integration tests with PostgreSQL/ClickHouse/MinIO enabled, one Entity structural
evaluation and 32 Chromium desktop/mobile flows. The 545-test durable coverage run reached 83.41%
statements, 77.99% branches, 93.60% functions and 84.60% lines. Formatting, lint, typecheck,
production build, license allowlist, development/production dependency audits, CycloneDX SBOM,
Compose validation and all six production Docker targets passed. Rebuilt API/Web containers became
healthy and returned `readOnly=true`; readiness remained `DEGRADED` under the fail-closed default
because external provider DNS resolves through the host's private-range interception proxy.

[GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31454676767) and
[CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31454676771) then passed for exact
Solana transaction-semantics commit `bb9f098`, including Quality/contracts, both Chromium viewports,
all six production container targets and JavaScript/TypeScript analysis.

## Solana official instruction and core asset-flow validation (2026-08-11)

The read-only production query function re-read the same finalized mainnet transaction
`5TVTwAzh85bCJ5tMxLprQPC6yBw2pKTuQTp6qaJapA2m21X9pgUK1QYDKJLKPt3JXVTZQiauxsNEGKFr76iDjqAN`
from `api.mainnet.solana.com` and rebound it to slot `438523420`, blockhash
`DG63SznvcBCHpRVqoZGdXdpNHfRrgwsM2VMG38EBu4pU`. The v1.1 model retained six outer and 26 CPI
instructions. Official generated discriminators identified all 20 observed System/SPL
Token/Token-2022 instructions. Strict amount decoders accepted all nine supported core flow
candidates: three classic `Transfer`, four classic `TransferChecked`, one System `TransferSol`, and
one Token-2022 `TransferChecked`.

All nine flows were `APPLIED` and produced separate child Evidence nodes. The response contained 43
Evidence nodes: one raw transaction, 32 normalized instructions, nine asset flows, and one terminal
semantic node with 42 direct derivation edges. Model versions were
`solana-transaction-query-v1.1.0`, `solana-transaction-semantics-v1.1.0`, and
`solana-asset-flow-v1.0.0`.

Flow knowledge coverage was `0.9222222222222223`, which conservatively reduced overall response
coverage to the same value and confidence to `0.876111`. The automatic token audit modeled eleven
account/mint identities, matched nine exactly, found zero conflicts, and retained two Unknown. One
classic close-account lifecycle effect was recognized but intentionally unmodeled. The Token-2022
checked transfer exposed gross amount but not same-Snapshot transfer-fee/hook state, so its fee and
recipient net remained `Unknown(NOT_QUERIED)`. Reconciliation therefore correctly reported
`PARTIAL`, coverage `0.8181818181818182`, and an Unknown observed relative error rather than a false
pass. The deterministic recommended/allowed error for fully modeled atomic token accounting is
exactly zero.

The validation used the repository's SSRF-protected transport with the exact public hostname. This
host's private-range DNS interception required `allowPrivateNetworks=true` only in the bounded
read-only validation process; repository defaults remain fail-closed. The result validates official
core instruction/flow semantics and Evidence lineage, not a Jupiter route, DEX trade, controller,
launchpad event, independent-provider agreement, archive replay, or complete Token-2022 extension
execution.

The completed local gate passed 460 unit tests across 67 files, 68 environment-free integration
tests, all 92 integration tests with PostgreSQL/ClickHouse/MinIO enabled, one Entity structural
evaluation, and 32 Chromium desktop/mobile flows. The durable coverage run passed 528 tests with 24
opt-in tests skipped and reached 82.21% statements, 76.57% branches, 91.94% functions, and 83.42%
lines. Formatting, lint, typecheck, production build, production/development dependency audits,
license allowlist, CycloneDX SBOM, Compose validation, and all six production Docker targets passed.
The rebuilt API/Web containers returned live `UP`, `readOnly=true`, and HTTP 200 from the web root.
Because another local project occupied host ports 5432 and 6379, this non-destructive runtime check
used the documented `POSTGRES_PORT=15432` and `VALKEY_PORT=16379` overrides; the ZeroTrace service
network still used canonical internal ports. Readiness correctly remained `DEGRADED` when the
fail-closed SSRF policy rejected the host's private-range provider DNS interception.

Exact-SHA GitHub Actions and CodeQL validation for this batch remains pending until the reviewed
commit is pushed to Draft PR #5. The latest recorded exact-SHA remote pass before this batch is
commit `506bece`:
[CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31455436239) and
[CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31455436215).

## Durable Solana transaction-report replay validation (2026-08-11)

The same read-only finalized mainnet transaction used for v1.1 semantic/core-flow validation,
`5TVTwAzh85bCJ5tMxLprQPC6yBw2pKTuQTp6qaJapA2m21X9pgUK1QYDKJLKPt3JXVTZQiauxsNEGKFr76iDjqAN`,
was captured through the production API path at slot `438523420`. PostgreSQL Evidence plus migration
`015_solana_transaction_reports.sql` persisted immutable report
`str_2401beff4b82308e93ccd9d6` with result hash
`a4cdc8b4501fea3f51bcf0d950d37bcc1bc398c6635ffa72611101901b21feec`. The report retained 43
Evidence nodes, nine asset flows and `PARTIAL` token reconciliation. Its live response exposed
`replayed=false` and a Known successful live-refresh state.

The API container was then recreated after explicitly restoring
`ALLOW_PRIVATE_PROVIDER_URLS=false`, which made the host's private-range DNS interception fail the
default SSRF policy. Querying the generic transaction route returned the same report ID, result
hash, slot and Evidence graph with `replayed=true` and `liveRefresh=Unavailable(PROVIDER_DOWN)`.
Provider-free latest and exact-ID routes returned byte-equivalent parsed report JSON with identical
IDs/hashes. This proves that provider degradation remains distinct from chain facts and that the
historical Snapshot is not rewritten as a current observation. The default was restored before the
check ended; no key, signing, broadcast, swap or fund movement was used.

The completed local gate passed 463 unit tests across 68 files, 69 environment-free integration
tests, all 94 integration tests with PostgreSQL/ClickHouse/MinIO enabled, one Entity structural
evaluation, and 32 Chromium desktop/mobile flows. The durable coverage run passed all 557 tests and
reached 83.30% statements, 77.82% branches, 93.38% functions, and 84.48% lines. The PostgreSQL test
also proved idempotent writes, repository close/reopen, exact/latest equality, health, and database
rejection of update/delete.

Formatting, lint, typecheck, production build, development/production dependency audits, license
allowlist, CycloneDX SBOM and Compose validation passed. All six production Docker targets built,
and recreated API/Web/PostgreSQL/ClickHouse plus the existing MinIO/Valkey services were healthy;
NATS was running. The API reported `readOnly=true`, durable storage `UP`, and `DEGRADED` readiness
only because the restored fail-closed SSRF default rejected the host's private-range provider DNS
interception. The web root returned HTTP 200. Local host-port conflicts were handled
non-destructively with `POSTGRES_PORT=15432` and `VALKEY_PORT=16379`.

Exact-SHA GitHub Actions and CodeQL passed for immutable durable-report commit `1ea3780` on Draft
PR #5. CI independently repeated formatting, lint, typecheck, disposable PostgreSQL/ClickHouse/
MinIO coverage, production build, licenses, audit, SBOM, both Chromium viewports and all six
production container targets:
[CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31460030258) and
[CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31460030151).

## FFT pension behavior discovery and durable replay: 2026-08-11

ZeroTrace added `evm-pension-candidate-discovery-v1.0.0`, an explicit-policy behavioral screen over
the complete finalized BSC ERC-20 Transfer surface. Unit tests cover qualifying exact-unit deposits,
complete empty results, incomplete range coverage, duplicate/missing Evidence and fail-closed
candidate ceilings. Production-composition tests verify query/log/candidate/terminal derivation
edges and invariant Unknown role/no-exit/dividend meaning. Repository tests verify content-addressed
idempotency, corrupt replay rejection, lookup validation and migration health. API tests cover live
durable persistence, provider-free latest/exact replay and refusal to run without durable storage.

PostgreSQL migration `016_evm_pension_candidate_reports` was applied non-destructively to the active
volume. A real PostgreSQL integration composed the report through the production Evidence writer,
closed and reopened the repository, replayed latest/exact content, passed health, and proved SQL
update/delete rejection. The responsive Claim Audit panel passed both Chromium desktop and Pixel 7
with editable policy, candidate metrics, immutable provenance, explicit Unknown fields and no
horizontal overflow.

The live read-only FFT run used token `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`, finalized range
`113485950-115257276`, end hash
`0x0af09564f5ef906e64e624caf396c6235ffb34b507f886127827ba4669c869b5`, and a recorded policy of
1,000,000 FFT per share, minimum five exact deposits, minimum five unique exact-unit depositors and
maximum 20 candidates. It validated 14,020 Transfers and found one matching address:
`0x8d50a68b4f9ada119d198d6472eaf0cb6db302d9`.

The candidate had 123 inflows, 71 exact-unit deposits from 69 unique exact-unit depositors, 107
exact-multiple deposits, 16 non-multiple deposits, 164 observed whole shares, and ten outflows to
one observed destination. Exact covered-range inflow/outflow/net amounts were respectively
`176000010000000000000000000`, `24507000000000000000000000`, and
`151493010000000000000000000` atomic FFT. Report `pcr_ff8cd2b24f23d71758cf3e63`, result hash
`44ac76cc1adb60446d323761fac89acf53ad7feaedd18a368d35679f6d364d79`, candidate Evidence
`ev_fd1eaba3374aa73bf4eb1230`, and terminal Evidence `ev_dda9728dd1f05d64175d9f4d` were persisted.

The API was then recreated with `ALLOW_PRIVATE_PROVIDER_URLS=false`. Readiness became explicitly
`DEGRADED` because the host intercepts public provider DNS into a private range, while the container
remained healthy and storage stayed available. Provider-free latest and exact-ID routes returned
the identical report ID, hash, candidate and 14,020-transfer count. No secret, signing, approval,
swap, transaction broadcast or fund movement was used. The synchronous scan took 407 seconds;
asynchronous checkpointing and Evidence batch persistence remain a documented production
performance gate.

The complete local gate passed 471 unit tests across 71 files, 71 environment-free integration
tests, all 97 integration tests with PostgreSQL/ClickHouse/MinIO enabled, one Entity structural
evaluation, and 34 Chromium desktop/mobile flows. The durable coverage run passed all 568 tests at
83.37% statements, 77.95% branches, 93.41% functions and 84.55% lines. Formatting, lint, typecheck,
production build, license allowlist, development/production vulnerability audits, CycloneDX SBOM,
Compose validation and runtime health also passed. The first full E2E attempt exposed two ambiguous
legacy text locators after the new panel added similar copy; the locators were scoped to the
declaration panel and the complete 34-test rerun passed.

Exact-SHA GitHub Actions and CodeQL passed for immutable pension-behavior candidate commit
`d450dd0` on Draft PR #5. CI independently repeated formatting, lint, typecheck, disposable
PostgreSQL/ClickHouse/MinIO coverage (568 tests), production build, licenses, audit, SBOM, all 34
Chromium desktop/mobile flows and all six production container targets:
[CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31463334371) and
[CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31463334340).

## FFT pension-candidate entry economics: 2026-08-11

ZeroTrace added `flap-pension-entry-economics-v0.1.0` as a composition over existing durable
pension discovery, verified Flap inspection and Pancake V2 buy scenarios. It accepts only a wallet
contained in the referenced `pcr_...` report, loads every durable report Evidence node before any
market read, and requires a finalized market Snapshot at or after the report range end. Equal-height
hash disagreement fails closed. The result terminal derives from the buy root, candidate node and
report terminal; behavioral candidacy never becomes official attribution.

The exact-integer RV kernel calculates share equivalent, floor whole shares, committed/remainder
tokens, allocated quote cost and conservatively rounded average cost per share. Schema invariants
preserve all arithmetic/Knowledge-state relationships. A zero modeled receipt is Known zero, while
its mathematically undefined average share cost is `Unknown(NOT_APPLICABLE)`. Actual receipt,
transfer tax/swapback, final reserves, supply reduction, custody irreversibility, no-exit policy and
dividend execution remain Unknown. The API and responsive DEX-trading panel expose the report,
wallet, Snapshot and Evidence and have no signing, approval, swap or broadcast path.

The live read-only run used FFT `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`, report
`pcr_ff8cd2b24f23d71758cf3e63`, candidate
`0x8d50a68b4f9ada119d198d6472eaf0cb6db302d9`, and finalized market block `115265311`, hash
`0x9bd0a695d141d8b82dd0b4d8e0a70ac67b51d1f5b8a85fb4d0c4da2b9924b8ef`. Quote asset
`0x55d398326f99059ff775485246999027b3197955` had reserve spot
`0.000341100094559429` quote units/FFT; configured buy tax was 300 bps. Quote inputs
`100/500/1000/5000/10000` yielded modeled net FFT
`282647.37658617146978887/1393281.561909105530168668/2738232.3153520601510885/
12022932.892192772219846144/20867551.78035526377570956` and whole-share counts
`0/1/2/12/20`. Full price/share outputs and the registered error policy are recorded in
[FLAP_FFT_ACCEPTANCE.md](FLAP_FFT_ACCEPTANCE.md#scoped-pension-entry-economics-acceptance-2026-08-11).

Router/model validation passed. Two fixed-block repeats reproduced every economic value exactly;
terminal Evidence differed (`ev_67d98a881251dfaa92762341` and
`ev_a044441475ebcaa714f8aa78`) because a new capture timestamp intentionally creates a distinct
observation. Focused validation passed 39 RV/platform tests, the API durable-report composition test,
both Chromium desktop/mobile pension-entry flows, web typecheck/build and repository typecheck.

The complete local gate then passed 478 unit tests across 71 files, 71 environment-free integration
tests, all 97 integration tests with PostgreSQL/ClickHouse/MinIO enabled, one Entity structural
evaluation and all 34 Chromium desktop/mobile flows. The durable coverage run passed all 575 tests
at 83.36% statements, 77.84% branches, 93.51% functions and 84.53% lines. Formatting, lint,
typecheck, production build, license allowlist, development/production vulnerability audits,
CycloneDX SBOM and Compose validation passed. All six production Dockerfile targets built. Rebuilt
Compose API/Web/PostgreSQL/Valkey remained healthy on the non-destructive local port overrides;
live was `UP`, readiness explicitly `DEGRADED` under fail-closed private-range provider DNS,
`readOnly=true`, all four provider states were reported, and the web root returned HTTP 200. Remote
exact-SHA GitHub Actions and CodeQL then passed for immutable feature commit `f439eef` on Draft PR
#5. CI repeated formatting, lint, typecheck, all 575 durable coverage tests, production build,
license/audit/SBOM gates, all 34 Chromium flows and all six production container targets:
[CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31467827833) and
[CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31467827806).

## Immutable pension-entry Scenario Reports and provider-free replay: 2026-08-11

ZeroTrace added PostgreSQL migration `017_flap_pension_entry_reports` and a dedicated repository for
complete `flap-pension-entry-economics-v0.1.0` results. A report ID is content-addressed as
`per_...`; repository writes and reads parse the complete result Schema and verify its canonical
hash. The insert guard binds token, wallet, `pcr_...` behavior report, finalized market Snapshot,
complete canonical Evidence/source sets, terminal locator, and exactly three terminal parents.
Updates and deletes are database-forbidden. The live POST fails closed without this store, while
latest and exact report reads use PostgreSQL only.

The real PostgreSQL integration composed a Scenario Report through the production Flap/Pancake V2
adapter and Evidence writer, stored it idempotently, closed and reopened the repository, and replayed
exact/latest content byte-for-byte. Health returned `UP`; direct SQL update/delete attempts were
rejected. API integration persisted the composed result, removed the BSC adapter, then replayed both
routes with `replayed: true`; a mismatched token returned `404`. Browser acceptance exercised
calculate/persist and latest provider-free replay in both Chromium desktop and Pixel 7 while
retaining custody-not-burn and execution Unknown wording.

The active PostgreSQL volume was upgraded non-destructively to migration `017`. A separate clean
PostgreSQL 17.10 project applied every migration from `001` through `017` in order and exposed the
new table before its disposable volume was removed. The storage integration uses deterministic
provider-shaped state; it is not counted as a real-chain economic result.

A separate live read-only FFT request captured current finalized block `115279243`, hash
`0x8e671a829214e25bb4f31bc39f98abda144ae4590087538b715afd5fd4564045`, and reserve spot
`0.000329654442107268` BSC USDT/FFT. Scenario Report `per_b59d2afa9a22d8dcf01c15ec`, result hash
`9e377d30848b23385d6093893f01a69f0166b06c8f63236e885df7f901cdcf6f`, terminal Evidence
`ev_bc40c9b439921127039d33bf`, and whole-share outputs `0/1/2/12/21` were persisted. The API was
then restored to `ALLOW_PRIVATE_PROVIDER_URLS=false` and recreated; exact/latest replay matched the
report/result/Snapshot hashes without providers. A separate historical-block request against the
public BNB nodes returned `missing trie node`, produced no report, and was not replaced by current
state. Live buy-plus-transfer execution, irreversibility and dividends remain unvalidated and
Unknown.

The first all-storage rerun against a long-lived local ClickHouse volume failed three unrelated
ingestion tests with ClickHouse error `241 MEMORY_LIMIT_EXCEEDED`; the Scenario Report/PostgreSQL
tests passed. Repeating the identical command against a fresh isolated ClickHouse image/volume
passed all 97 integration tests and all 577 coverage tests. This incident is retained as operational
Evidence: long-lived ClickHouse part/merge memory, retention and capacity management require a load
gate before production. The disposable test volume was removed after validation; the existing
project data volume was preserved.

The complete local gate passed 480 unit tests across 72 files, 71 environment-free integration
tests, 97/97 real-storage integration tests, one Entity structural evaluation and all 34 Chromium
desktop/mobile flows. The durable coverage run passed 577/577 tests at 83.29% statements, 77.81%
branches, 93.49% functions and 84.48% lines. Formatting, lint, typecheck, production build, license
allowlist, development/production vulnerability audits, CycloneDX SBOM and Compose validation
passed. All six production Docker targets built. Recreated API/Web/PostgreSQL retained the existing
volumes and reported API live `UP`, storage `UP`, `readOnly=true`, web HTTP 200, and explicit
`DEGRADED` readiness under the host's fail-closed private-range provider DNS environment.

Exact-SHA GitHub Actions and CodeQL passed for immutable Scenario Report commit `032523d` on Draft
PR #5. CI independently repeated disposable-store coverage (577 tests), formatting, lint,
typecheck, production build, licenses, audit, SBOM, all 34 Chromium flows and all six production
container targets:
[CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31473349649) and
[CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31473349605).

## Evidence-backed Entity investigation graph and optional AGE projection: 2026-08-11

ZeroTrace added `entity-investigation-graph-v0.1.0` as a generic Entity Resolution read model. It
materializes one exact-Snapshot graph from one to 250 immutable relationship timelines, emits only
typed `SAME_CONTROLLER` or distinct `COORDINATED_WITH` edges, retains negative, service,
infrastructure and Unknown observations without inventing edges, and never copies raw transfers or
creates Entity membership. Known service hubs and conflicting service evidence both suppress
ownership propagation. Traversal is limited to depth three and 200 nodes.

PostgreSQL migration `020_entity_investigation_graphs` stores content-addressed reports and rejects
timeline, Snapshot, Evidence, endpoint, probability, projection and terminal-parent mismatches as
well as update/delete attempts. A fresh isolated PostgreSQL 17.10 project applied migrations `001`
through `020`; all 23 real-store tests passed. A separate clean Apache AGE `1.7.0` project created
the extension, graph and immutable projection registry, then passed the same 23 PostgreSQL/AGE
tests. PostgreSQL remains authoritative; AGE is a bounded derivative navigation index whose
availability is reported independently. Both disposable validation volumes were removed.

The rebuilt Compose API materialized persisted graph `eig_c32d2fd69c1bdde5d8adf26a`: two nodes,
one `SAME_CONTROLLER` edge, `rawTransferEdgesCopied=false`, AGE status `PROJECTED`, exact replay
match, two-node bounded traversal, and a four-node terminal Evidence drilldown. An unmocked headed
Chromium session loaded this exact report in the Cytoscape UI and opened its Evidence Ledger from
the accessible edge control. The final browser console contained zero errors and zero warnings.
The strict CSP retains `style-src 'self'` plus the pinned SHA-256 hash required by Cytoscape
`3.34.0`; no broad inline-style allowance was added.

The complete local gate passed 505 unit tests across 77 files, 72 environment-free integration
tests, all 99 real-storage integration tests, one structural Entity evaluation and all 36 Chromium
desktop/mobile flows. The durable coverage run passed all 604 tests at 83.28% statements, 77.48%
branches, 93.76% functions and 84.44% lines. Formatting, lint, typecheck, production build, license
allowlist, development/production vulnerability audits, CycloneDX SBOM and Compose validation
passed. The Cytoscape dependency is pinned at `3.34.0`, MIT licensed, dynamically imported, and
therefore isolated in a lazy web chunk.

The first all-storage run against the existing long-lived ClickHouse volume passed 96 of 99 tests
but three unrelated ingestion cases failed with ClickHouse error `241 MEMORY_LIMIT_EXCEEDED`
(`1.02 GiB` projected versus `802.76 MiB` permitted). The identical suite then passed 99/99 using
a fresh disposable ClickHouse/MinIO environment; the existing project volume was preserved. This
is an operational capacity/retention warning, not accepted as a product pass for the long-lived
volume, and remains a required production load gate.

A web-only Docker build later left Docker Desktop's API unresponsive after its caller timed out.
Docker Desktop was restarted without deleting volumes; ZeroTrace and unrelated existing containers
recovered, AGE was restarted explicitly, and the isolated web rebuild/recreate then passed. Final
Compose health reported PostgreSQL storage and AGE projection `UP`, API live HTTP 200, web HTTP 200,
`readOnly=true`, and explicit provider-dependent readiness rather than converting provider failure
to a successful or zero-valued state.

## Cross-Snapshot Entity investigation graph timelines: 2026-08-12

ZeroTrace added `entity-investigation-graph-timeline-v0.1.0` as a generic temporal read model over
two to 100 immutable `eig_...` reports from one ledger and chain. Deterministic ordering separates
same-position revisions from position advances. Same-position hash equality and direct-parent
identity produce exact continuity Knowledge; skipped positions or missing parent identity remain
`Unknown(INSUFFICIENT_DATA)`, and conflicts remain Known false. Pair additions and omissions are
changes in the two requested graph scopes only. They never establish a relationship start/end,
Entity exit, graph merge/split, or automatic membership mutation.

Migration `021_entity_investigation_graph_timelines` stores content-addressed `eit_...` reports and
validates every observation and pair against its immutable investigation graph, exact terminal
Evidence payloads, transition continuity, canonical result/source/Evidence arrays and the hard
no-termination/no-membership invariants. Transition changes are also recomputed from the two
durable pair observations: exact before/after state, precedence-ordered change kind, Evidence,
canonical order, changed count and unchanged count must all match. Direct-SQL count and state
tampering tests are rejected. Updates and deletes are rejected. An isolated empty
PostgreSQL database applied migrations `001` through `021` in filename order. The complete 23-test
PostgreSQL suite then passed and the temporary database was removed. The same 23 tests passed
against the current PostgreSQL plus Apache AGE `1.7.0`; AGE remains an optional exact-Snapshot
accelerator and is not used by graph-timeline authority or replay.

A production build was started on host port `18082` against the current durable stores. It
materialized `eit_ea900ad3c0aedf0618298d94` from two exact graph observations at EVM position
`910000`. Materialize/latest/exact report hashes matched; the one revision was Known continuous,
one pair was unchanged, relationship termination and Entity-membership mutation were false, and
the terminal Evidence drilldown returned seven nodes. A headed Chromium session loaded the exact
report through the production web build, displayed `Absence ≠ relationship end`, revision and
continuity state, and opened the Evolution Evidence Ledger. All API requests returned HTTP 200.
This is provider-free durable replay, not a real-chain controller or membership conclusion.

The complete repository gate passed formatting, ESLint, typecheck, 512 unit tests across 79 files,
72 environment-free API integration tests, one Entity structural evaluation, production builds,
the production license allowlist and a zero-vulnerability dependency audit. All 36 Chromium desktop
and Pixel 7 flows passed. Coverage passed 608 tests at 83.32% statements, 77.25% branches, 93.93%
functions and 84.48% lines.

The initial 611-test coverage run executed all configured stores. The 608 non-ClickHouse tests
passed, while the three historical-ingestion cases failed because the preserved long-lived
ClickHouse volume again reached error `241 MEMORY_LIMIT_EXCEEDED` (about `1.06 GiB` projected versus
about `805 MiB` then permitted). PostgreSQL, AGE, MinIO and the new graph timeline were not the
failure. The ClickHouse volume was preserved; a restart did not clear its long-lived capacity
condition. The final passing coverage run therefore omitted those three unavailable cases rather
than misreporting them as passing. Disposable-store GitHub CI remains the required independent
all-611 gate, and long-lived ClickHouse retention/compaction/memory sizing remains a production
operations gate.

The affected API, web and PostgreSQL production image targets built successfully; the PostgreSQL
image contains migration `021`. Docker Desktop could inspect, build and restart existing containers
but could not start any newly created container, including a minimal Alpine diagnostic, which
remained in `Created` until removed. Existing volumes and project data were not deleted. Compose
API/Web recreation was therefore not claimed; the production artifacts were exercised through the
host runtime/browser path above, and disposable-container startup remains a remote CI gate for this
commit.

Exact code commit `c9c6a17` then passed [GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31513348630)
and [CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31513348679) on PR #12. Quality
and contracts, Chromium E2E, every production container target, JavaScript/TypeScript analysis and
CodeQL all passed. This independently closes the disposable-container gate for the code commit; it
does not remove the separate long-lived local ClickHouse capacity and Docker Desktop start defects.

## Durable Global Intelligence Search projection: 2026-08-12

ZeroTrace added `global-intelligence-search-v0.1.0` as a generic provider-free read projection over
registered labels and the identifier-bearing immutable report families currently implemented. The
projection does not specialize FFT: the FFT contract is the first acceptance subject already
present in the durable report store. PostgreSQL migration `022_durable_intelligence_search` adds
exact identifier, registered-label and category indexes plus the versioned
`durable_intelligence_search_documents_v1` view. Every match retains its source report, exact
Snapshot, canonical source set, confidence, freshness, model version and terminal Evidence ID.

An isolated empty PostgreSQL database applied migrations `001` through `022` in filename order, and
the search integration passed before the temporary database was removed. Reapplying migration `022`
to the preserved development database was idempotent. The complete serial real-storage suite then
passed 101/101 tests against PostgreSQL, Apache AGE, ClickHouse and MinIO after restarting the
capacity-constrained ClickHouse service. The environment-free integration suite passed 73 tests.

Rebuilt API, web and PostgreSQL images were recreated without deleting persistent volumes. Because
another local service owned host port `5432`, Compose used the documented `POSTGRES_PORT=15432`
override while internal PostgreSQL remained on `5432`. PostgreSQL durable-storage health was `UP`,
the API remained read-only, and the top-level readiness was honestly `DEGRADED` because Ethereum
was unconfigured and the preserved ClickHouse volume retained its separate capacity condition.

A real HTTP request for BSC subject `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`
returned one local classification and six durable matches across control-surface, pension-candidate
and pension-entry reports. The response contained six distinct terminal Evidence IDs, Known result
confidence, `NO_DURABLE_MATCH_IS_NOT_ONCHAIN_NONEXISTENCE`, and explicit pending symbol/ticker,
platform/project, full registry and checkpoint indexes. A headed Chromium session rendered the same
six rows and Evidence ledger. With no durable Subject Registry binding, Entity and label knowledge
displayed `Not Queried`; it was not converted to an empty entity, false label, or numeric zero.

The repository gate passed formatting, ESLint, typecheck, production build, the production license
allowlist, zero-vulnerability dependency audit, CycloneDX SBOM and Compose validation. Unit tests
passed 518/518 across 80 files, one Entity structural evaluation passed, and all 36 desktop/Pixel 7
Chromium flows passed. Durable coverage passed 616 tests at 83.26% statements, 77.36% branches,
93.83% functions and 84.41% lines. The three ClickHouse ingestion cases were deliberately
unconfigured for that final coverage command after V8 coverage instrumentation again exceeded the
reused 1 GiB volume's memory allowance. Their non-instrumented real-storage execution had already
passed 3/3 in the 101-test serial suite; long-lived ClickHouse compaction, retention and memory
sizing remain a production operations gate.

Exact feature commit `db86aca` passed
[GitHub Actions CI](https://github.com/greywolf8888/ZeroTrace/actions/runs/31521748113) and
[CodeQL](https://github.com/greywolf8888/ZeroTrace/actions/runs/31521748107) on PR #13. Quality and
contracts, all 36 Chromium desktop/mobile flows, every production container target,
JavaScript/TypeScript analysis and CodeQL passed. The documentation-only acceptance-record
follow-up must independently pass before the protected-main squash merge.

## Durable Label Intelligence observation-set reports: 2026-08-12

ZeroTrace added the generic `label-intelligence-v0.1.0` engine over registered observations for one
exact ledger, chain and Subject. The engine content-addresses the observation set, applies an
explicit `asOf` and freshness policy, retains future/active/stale/expired states, and preserves
label-value, actor-candidate and determinism conflicts without selecting a silent winner. Source
priority is review ordering only. A current Service Hub observation suppresses ownership
propagation; absence remains `Unknown(NOT_QUERIED)`. Label-to-Entity merge, risk-to-control
inference and cross-chain same-label merge are all fixed false.

Migration `023_label_intelligence_reports` adds immutable `lir_...` reports and a search projection.
Its insert guard revalidates the exact Subject, registered observation payloads, source Evidence,
canonical provenance, terminal derivation and all three non-merge rules; update and delete are
rejected. An isolated database applied migrations `001` through `023` in filename order, passed all
25 PostgreSQL integration tests and was then removed. Reapplying migration `023` to the preserved
development PostgreSQL database was non-destructive. The focused engine/storage suite passed 9/9.

The complete repository `verify` gate passed formatting, ESLint, typecheck, 527 unit tests across 82
files, 75 environment-free integrations, one Entity structural evaluation, every production build,
the production dependency-license allowlist and a zero-vulnerability audit. Durable PostgreSQL and
AGE coverage passed 628 tests with 83.26% statements, 77.36% branches, 93.87% functions and 84.42%
lines. All 36 Chromium desktop and Pixel 7 flows passed, including Label Intelligence request-body,
conflict, safety, Evidence and horizontal-overflow assertions.
The API, web and PostgreSQL production targets also built successfully; the PostgreSQL image
contains migration `023`.

The non-instrumented real-storage run passed 101 tests. The three ClickHouse ingestion tests again
failed with error `241 MEMORY_LIMIT_EXCEEDED` on the preserved long-lived volume (about `1.05 GiB`
projected versus about `814 MiB` permitted). A non-destructive restart did not clear the condition.
Recreating only that container preserved the named volume, but the existing Docker Desktop defect
left the new container in `Created` and its start command blocked; no volume was deleted. The passing
coverage run therefore configured PostgreSQL and AGE and explicitly skipped those three ClickHouse
cases. This is a local operations gate, not a Label Intelligence pass.

A production API build was started on host port `18082` against the preserved PostgreSQL database.
A seven-fractional-digit `asOf` request initially exposed a terminal Evidence string-identity bug:
Evidence normalized the timestamp to milliseconds while the request retained the original text.
The API now canonicalizes `asOf` before analysis, and a regression test covers that input. The live
retry created `lir_6bd746e8081ad66fea12ff62`, normalized
`2026-08-11T19:24:00.1234567Z` to `2026-08-11T19:24:00.123Z`, replayed the exact result hash, retained
one registered observation and two Evidence nodes, and kept all three merge/control rules false.
Latest replay correctly returned an existing report with a later logical `asOf`; it did not confuse
write time with analysis time.

A headed Playwright browser then used the production web build and real API proxy, searched the
same technical PostgreSQL fixture, displayed three durable search rows, replayed the logically latest
Label Snapshot, and showed observation freshness, source priority/license, Unknown global/history
coverage, Service Hub non-observation semantics, all safety boundaries and both Evidence nodes. At a
390×844 viewport the document client/scroll widths were both 375 CSS pixels, the Label panel stayed
inside the viewport, and the browser console had zero errors or warnings.

This acceptance used an explicitly named PostgreSQL integration fixture; it is not a real-world
label attribution and does not validate FFT labels. No external label code/data was copied. Durable
GraphSense/official/commercial/community adapters, production capture handlers, license/term
enforcement, complete Subject Registry/history coverage and an independently evidenced FFT label
conflict case remain pending. The generic scheduler foundation is validated below.

## Generic durable capture scheduling foundation: 2026-08-12

ZeroTrace added `capture-scheduler-v0.1.0` and migration `024_capture_schedules` without any FFT,
Flap or token-specific defaults. The typed contract admits EVM, Bitcoin and Solana targets across
all current capture domains, fixes the operation to `READ_ONLY_CAPTURE`, content-addresses schedule
identity, canonicalizes sub-millisecond timestamps, preserves interval anchors under
`SKIP_MISSED`, and bounds retry attempts and exponential delay.

An isolated PostgreSQL database applied migrations `001` through `024` in filename order. Three
real-database cases then passed: two independent repository instances raced for one due occurrence
and exactly one received the lease; a retryable failure became available only after its calculated
backoff and the second attempt committed a terminal Evidence/Snapshot-bound success; and an expired
one-shot lease was written as `LEASE_EXPIRED`, retried, exhausted and completed with an explicit
Unknown result. A stale token could not complete a terminal or expired run. The temporary database
was removed after the suite.

The success path used two durable Evidence nodes and a finalized EVM Snapshot. PostgreSQL verified
the terminal node's stored Snapshot payload, target ledger/chain, exact recursive Evidence closure,
exact non-derived source set, coverage, freshness, model version and confidence before accepting the
run. Separate completion attempts containing unrelated-Snapshot Evidence or an invented source were
rejected as non-retryable conflicts without consuming the lease. Run/schedule terminal mutation and
scheduler-history deletion remain database-forbidden. Six deterministic unit tests cover identity,
anchor math, bounded backoff, mandatory provenance, unregistered-handler failure and abort behavior.
Runtime wiring and schema/type/lint checks pass.

This validates the reusable persistence and handler-dispatch boundary only. Temporal
Schedules/Workflows, NATS JetStream publication, a long-running worker deployment, concrete
multi-chain handlers, pause/resume operations and real distributed outage drills remain pending.
No FFT chain request was made and no existing token conclusion changed.

## Generic proof-gated Action Semantics: 2026-08-12

ZeroTrace added `action-semantics-v0.1.0` as a chain-, platform- and token-neutral primitive layer.
The schema and engine model transfer, swap, mint, burn, liquidity addition/removal, LP custody,
distribution and contract-call candidates at one exact Snapshot. Applied primitives require their
versioned proof and asset-delta shape; failed calls require both decoded input and receipt Evidence
and remain `NOT_APPLIED`; unavailable execution and incomplete proof remain Unknown.

Five deterministic unit cases passed. They confirm a proved Swap while leaving its claimed purpose
`Unknown(NOT_QUERIED)`, reject a proposed burn represented only by transfer-to-custody Evidence,
retain a proved failed liquidity attempt with zero applied deltas, reject cross-Snapshot candidate
Evidence, and produce the same result hash, action order and terminal Evidence under reversed input
order. The report carries complete source Evidence, a derived terminal node, exact Snapshot,
coverage, freshness, source set, fixed model version and explicit per-action confidence Knowledge.

This is deterministic semantic normalization, not a production chain adapter or a claim verdict.
No FFT address, Flap constant, pension rule, promotional taxonomy or production mock exists in the
package. At this checkpoint durable report persistence was still pending; the follow-on acceptance
below closes that storage/replay gap. Real EVM/Bitcoin/Solana candidate adapters, continuous handler
binding and cross-ledger real-chain calibration remain pending.

The complete repository gate then passed formatting, ESLint, typecheck, 538 unit tests across 84
files, 75 environment-free integrations, one Entity structural evaluation, all application/worker
builds, the production dependency-license allowlist and a zero-vulnerability audit. The first E2E
start correctly failed because the pre-existing local `node_modules` had not linked the newly added
capture-scheduler workspace; reinstalling from the lockfile created the workspace junction and all
36 Chromium desktop/mobile flows passed. The Dockerfile dependency layer now explicitly copies
both new workspace manifests before `npm ci`, and API, web, ingest-worker, semantic-worker,
PostgreSQL and ClickHouse production targets all built successfully from that corrected boundary.

PostgreSQL/AGE durable coverage passed 642 tests with three ClickHouse cases explicitly skipped:
83.17% statements, 77.04% branches, 93.83% functions and 84.32% lines. An environment-free
coverage attempt had failed the global threshold because all durable repository tests, including
the new scheduler integration, were correctly skipped; it was not recorded as a pass. Applying
migration `024` to the preserved PostgreSQL database was non-destructive. A production API build
then connected to it directly and returned durable storage `UP`, `readOnly=true`, and
`durable-capture-scheduling=IMPLEMENTED_DURABLE_STATE_HANDLER_BINDING_PENDING`.

Docker Desktop locally left newly recreated API/web containers in `Created` and also retained the
existing ClickHouse container in that state; even a direct `docker start` blocked. No application
error log was produced and no data volume was deleted. Direct production-build API validation and
real PostgreSQL tests passed, but a current full Compose start is therefore not claimed. Remote CI
container build/E2E and exact-SHA CodeQL acceptance remain pending for this batch.

## Durable generic Action Semantics report replay: 2026-08-12

ZeroTrace added migration `025_action_semantics_reports` and a generic PostgreSQL repository without
introducing a Flap, FFT, launchpad or token-specific field. EVM transaction hashes and Bitcoin
txids are canonical lowercase hexadecimal under distinct ledger rules; Solana signatures remain
base58. Each `asr_...` record is derived from the canonical report result, indexes every represented
transaction, and is re-parsed, re-hashed and terminal-Evidence-checked on every repository read.

The database accepts a report only after all source and terminal Evidence nodes already exist and
each is bound to the byte-identical report Snapshot. It requires the reported Evidence IDs to equal
the terminal node's full recursive derivation closure, the terminal's direct parents to equal the
Action Evidence union, and `sourceSet` to equal the non-derived durable sources. Stored Evidence JSON
must agree with the Evidence table. Reports are append-only; update and delete triggers fail closed.
The API exposes provider-free latest-by-ledger/chain/transaction and exact content-addressed replay,
but deliberately exposes no POST that could let an untrusted client assert `proofKinds`.

An active preserved PostgreSQL volume upgraded non-destructively from migration `024` to `025`.
The new real-database case first attempted report persistence before Evidence and received a closed
failure, then stored source plus terminal Evidence, persisted idempotently, closed/reopened the
repository, replayed by uppercase-input EVM transaction and exact ID, and observed SQL mutation
rejection. A separate disposable database applied all 25 migrations in filename order, exposed
`action_semantics_reports`, and was removed afterward.

The focused schema/action/storage tests passed 11 cases; the full unit suite passed 544 tests across
85 files; the environment-free API/integration suite passed 77 cases. With PostgreSQL, AGE, MinIO
and the preserved ClickHouse volume configured, 107 integration cases passed. The same three
historical-ingestion cases failed with ClickHouse error `241 MEMORY_LIMIT_EXCEEDED` at the preserved
volume's approximately 727 MiB effective limit; no volume or data was deleted. This is an existing
ClickHouse capacity gate and did not affect PostgreSQL migration 025 or Action Semantics replay.

No live chain request was needed for this persistence acceptance, no FFT conclusion changed, and
no mock entered a production path. Production ledger candidate adapters, scheduler binding,
historical backfill, independent-source action reconciliation, full repository gates and remote CI
for this follow-on batch remain pending at this checkpoint.

The complete host gate subsequently passed format checking, ESLint, TypeScript, 544 unit tests, 77
environment-free integrations, the Entity structural evaluation, all application/worker builds,
the production license allowlist and a zero-vulnerability dependency audit. Durable coverage with
PostgreSQL and AGE passed 651 tests with the same three ClickHouse cases explicitly skipped:
83.14% statements, 77.03% branches, 93.91% functions and 84.28% lines. All 36 Chromium desktop and
Pixel 7 E2E flows passed. Compose configuration and CycloneDX SBOM generation also passed.

Before the current six-target Docker build, the existing API, web, PostgreSQL, ClickHouse, AGE,
MinIO, NATS and Valkey Compose services reported healthy/running. The local BuildKit target loop
then produced no result for ten minutes and left Docker CLI calls unresponsive. The two orphan
build clients were stopped. A later attempt to stop the host API test process encountered duplicate
Windows port records and also stopped the already wedged Docker backend process `38024`; no file,
image, container or volume was deleted. Docker Desktop's normal restart command then also timed out
after three minutes, so no further backend intervention was attempted.

Before that host API process was stopped, it returned `readOnly=true` and
`action-semantics=IMPLEMENTED_DURABLE_PROVIDER_FREE_REPLAY`. Because Docker/PostgreSQL had become
unreachable, aggregate storage correctly returned `DOWN/STORAGE_UNAVAILABLE` and the replay query
failed closed with HTTP 503. Local container-target/runtime status is therefore inconclusive, not
failed or passed, and the isolated GitHub Buildx checks remain the acceptance authority for this
batch.

PR #16 supplied that independent authority for immutable code commit `c4047a5`. [CI run
31542652738](https://github.com/greywolf8888/ZeroTrace/actions/runs/31542652738) passed Compose
validation, formatting, lint, typecheck, 654/654 tests against disposable PostgreSQL, AGE,
ClickHouse and MinIO, production builds, license policy, zero-vulnerability audit, SBOM, 36
Chromium desktop/mobile flows, and all six production container targets. Final remote coverage was
82.58% statements, 76.79% branches, 93.34% functions and 83.68% lines. [CodeQL run
31542652768](https://github.com/greywolf8888/ZeroTrace/actions/runs/31542652768) independently passed
JavaScript/TypeScript analysis. The local ClickHouse and Docker observations above remain recorded
as host-environment limitations; the clean remote results show that neither is a product-code
failure.

PR #16 was squash-merged to protected `main` as `e7f1383`. The exact merge commit independently
passed [CI run 31543286842](https://github.com/greywolf8888/ZeroTrace/actions/runs/31543286842)
and [CodeQL run 31543286847](https://github.com/greywolf8888/ZeroTrace/actions/runs/31543286847).
The temporary implementation branch was deleted after merge; no release or tag was created.

## Durable multi-chain Action capture handler: 2026-08-12

Action Semantics advanced to `action-semantics-v0.2.0` while retaining strict replay support for
immutable `v0.1.0` reports. The new generic raw-ledger compiler accepts exactly one provider,
content-addressed artifact, transaction and Snapshot. It derives only facts justified by the stored
ledger records: EVM native and ERC-20 transfers plus contract calls, complete Bitcoin UTXO
conservation and fees, and Solana program calls, validator fees, native deltas and SPL deltas.
Intent such as buyback, pension, dividend, permanent lock or community allocation remains Unknown.

Migration `026_action_semantics_v2` upgraded the database model constraint and terminal-source
guard without rewriting old reports. A new production handler proves that the exact transaction's
`ledger-records` ingestion profile completed, loads the matching ClickHouse facts by provider,
position and artifact, validates the object-store payload plus Evidence/Snapshot closure, compiles
and persists the report, and only then completes the PostgreSQL schedule lease. Missing completed
coverage is retryable; malformed or cross-artifact input is terminally rejected. The worker and
scheduling CLI accept no private key, signature, approval, swap or broadcast operation.

The complete local `npm run verify` gate passed formatting, ESLint, typecheck, 566 unit tests across
91 files, 77 environment-free integration tests, one structural Entity evaluation, all builds and
the production license allowlist. `npm run audit:prod`, CycloneDX SBOM generation, Compose rendering
and all 36 Chromium desktop/Pixel 7 flows also passed. Docker Desktop's Linux engine was unavailable,
so 33 durable cases were explicitly skipped locally; that 642-test coverage attempt reached 78.85%
statements, 72.56% branches, 89.29% functions and 79.92% lines and correctly failed the global
threshold. It is not recorded as a local coverage pass.

PR #18 supplied the clean disposable-store authority for immutable code commit `9d608f5`.
[CI run 31547375160](https://github.com/greywolf8888/ZeroTrace/actions/runs/31547375160) applied
migrations `001-026`, passed 676/676 tests against PostgreSQL, AGE, ClickHouse and MinIO, exercised
the real ingestion-to-exact-fact-to-lease-to-Evidence/report success path, built the repository,
checked licenses, found zero dependency vulnerabilities, generated the SBOM, passed all 36 browser
flows, and built all six production container targets. Remote coverage was 82.39% statements,
76.61% branches, 93.24% functions and 83.49% lines. [CodeQL run
31547375237](https://github.com/greywolf8888/ZeroTrace/actions/runs/31547375237) independently passed
JavaScript/TypeScript analysis.

A later documentation-head rerun, [CI run
31547857040](https://github.com/greywolf8888/ZeroTrace/actions/runs/31547857040), correctly failed
instead of being retried away. Parallel real-database suites showed that an unfiltered worker could
lease a due run belonging to a different registered handler kind. The production fix makes the
registered capture-kind allowlist mandatory and applies it consistently to expired-lease recovery,
retry leasing and new schedule occurrences. `runCaptureCycle` now derives this allowlist from its
actual handler registry, so the transaction worker cannot consume Claim, Label, Entity or other
workers' runs. A fail-closed unit case also retains protection if a repository violates the filter.
The post-fix local gate passed format, lint, typecheck, all 566 unit tests, 77 environment-free
integrations, the Entity evaluation, all builds, license and vulnerability checks, SBOM, Compose
rendering, and all 36 Chromium desktop/mobile flows. Disposable-store concurrency revalidation is
required before merge; the failed run is not acceptance evidence.

This closes generic finalized-transaction handler binding, not terminal historical intelligence.
Continuous discovery/backfill, Temporal/NATS distribution, additional capture kinds,
independent-source action reconciliation and real-chain cross-ledger calibration remain open. FFT
was not queried by this batch and remains a later whole-product acceptance fixture, not a special
production path.

The corrected PR head `3e0e60a` passed [CI run
31548307460](https://github.com/greywolf8888/ZeroTrace/actions/runs/31548307460), including all
676/676 disposable-store tests, 36 Chromium flows and six production container targets, and
[CodeQL run 31548307443](https://github.com/greywolf8888/ZeroTrace/actions/runs/31548307443). PR #18
was then squash-merged to protected `main` as `6f209a5`. That exact merge commit independently
passed [CI run 31548486491](https://github.com/greywolf8888/ZeroTrace/actions/runs/31548486491) and
[CodeQL run 31548486484](https://github.com/greywolf8888/ZeroTrace/actions/runs/31548486484).
Main-commit coverage was 82.38% statements, 76.60% branches, 93.24% functions and 83.49% lines.
The implementation branch was deleted, and no tag or release was created.

PR #19 recorded that correction and acceptance without changing runtime scope, then squash-merged
to protected `main` as `055daf9`. The exact merge commit passed [CI run
31548976151](https://github.com/greywolf8888/ZeroTrace/actions/runs/31548976151) and [CodeQL run
31548976164](https://github.com/greywolf8888/ZeroTrace/actions/runs/31548976164). No tag or release
was created.

## Replayable public declaration reports: 2026-08-12

The existing generic statement compiler was extended rather than duplicated. It now retains the
exact submitted text in `claim-source-document-snapshot-v1`, creates one direct source
`ANALYST_OBSERVATION` and one terminal `DERIVED_FEATURE` Evidence node, and returns document/field/
source/chain coverage, freshness, source set, parser version and extraction confidence. Chain
verification and source independence remain `Unknown(NOT_QUERIED)`; parser confidence is explicitly
not claim-truth confidence. Named FFT values remain outside the compiler.

Migration `027_claim_declaration_reports` and its repository persist immutable content-addressed
`cdr_...` records only after both Evidence nodes and their exact direct edge exist. Reads re-parse
and re-hash embedded source documents, report identity and terminal Evidence. Exact and latest API
routes read PostgreSQL without providers, while an unconfigured parse response reports
`Unknown(STORAGE_UNCONFIGURED)`. The Claim Audit UI displays source Snapshot, exact captured text,
coverage, terminal Evidence and durability.

The first PR #20 Quality run correctly failed 1 of 682 tests while E2E, CodeQL and all production
container targets passed. The new repository health was `DOWN`: the PL/pgSQL parser rejected an
unparenthesized `IS DISTINCT FROM CASE` expression in migration `027`; `restart: unless-stopped`
then restarted the partially initialized database, making older suites pass without the new table.
The expression was made unambiguous and reproduced against a fresh PostgreSQL 17.10 volume.

After the fix, automatic empty-volume initialization applied migrations `001-027`. The dedicated
real-PostgreSQL test passed Evidence-first insertion, idempotency, close/reopen, byte-equivalent
exact/latest replay and update/delete rejection. The complete PostgreSQL integration suite passed
109 tests with only three disabled ClickHouse/MinIO cases; a second clean three-store run passed all
682/682 coverage tests at 82.44% statements, 76.66% branches, 93.29% functions and 83.55% lines.
The isolated `zt-claim-decl-debug` and `zt-claim-decl-full` containers, networks and volumes were
removed after validation.

Corrected PR #20 head `b4035be` then passed [CI run
31551315141](https://github.com/greywolf8888/ZeroTrace/actions/runs/31551315141): migrations
`001-027`, all 682/682 tests, 82.44% statements, 76.66% branches, 93.29% functions, 83.55% lines,
all 36 Chromium desktop/mobile flows, dependency/license/SBOM gates and all six production
container targets. [CodeQL run
31551315173](https://github.com/greywolf8888/ZeroTrace/actions/runs/31551315173) independently passed
JavaScript/TypeScript analysis. This accepts the declaration-report slice; it does not complete
independent-source capture, chain verification, non-EVM declarations or terminal Claim scope.
