# Local Validation Record — 2026-08-09

This record captures the latest local acceptance run. It is evidence for the runnable foundation,
not a terminal-product or production-deployment approval.

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
slice, but no terminal FFT product conclusion is recorded because entity calibration, complete
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
observations; it does not claim terminal FFT acceptance.

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
dividend/action proof, independent-source reconciliation, market pricing or terminal FFT acceptance.

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
claim-action, or terminal FFT acceptance.

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
This is one route and one chain operator, not independent-source or terminal FFT acceptance.

## Automated verification

| Command                  | Result                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| local non-browser gates  | pass: format, lint, typecheck, 360 unit, 44 environment-free integration and build; dependency license/audit gates green                              |
| local PostgreSQL         | pass: fresh PostgreSQL 16.10 applied migrations `001-011`; 59 integration tests passed, 3 non-PostgreSQL durable tests skipped                        |
| local `test:coverage`    | pass: 404 tests, 22 opt-in durable skips; 82.40% statements, 76.29% branches, 90.80% functions, 83.47% lines                                          |
| branch `test:coverage`   | pass on `23b3306`: 385 tests; 83.74% statements, 77.99% branches, 92.22% functions, 84.78% lines                                                      |
| `test:e2e:windows`       | pass: 12 Chromium tests across desktop and Pixel 7, including migrated-market scenarios, Claim Report, replay and Unknown                             |
| `npm run sbom`           | pass: CycloneDX JSON generated locally                                                                                                                |
| `docker compose config`  | pass                                                                                                                                                  |
| production Compose smoke | pass: current lifetime-head CLI production-image build/help and rendered four-service semantic profile; prior locked semantic image ran as UID 1000   |
| branch GitHub Actions CI | [pass on `07b3478`](https://github.com/greywolf8888/ZeroTrace/actions/runs/31396779069): full CI matrix, 12 Chromium flows and six production targets |
| branch CodeQL            | [pass on `07b3478`](https://github.com/greywolf8888/ZeroTrace/actions/runs/31396779896): JavaScript and TypeScript analysis                           |

The latest complete all-store durable run used GitHub Actions disposable PostgreSQL, ClickHouse,
and MinIO services. All 54 integration tests passed and the workflow removed its named volumes. The
current local PostgreSQL runner passed all 19 PostgreSQL tests after applying migrations `001-011`
to a fresh PostgreSQL 16.10 instance. ClickHouse and MinIO were not rerun locally for this
PostgreSQL/API/UI-only module; the complete environment-free, browser, dependency, SBOM and Compose
gates were rerun before its push.

Archive history beyond block headers, load, forced real-provider failover, reorg, backup/restore, and
production security controls remain acceptance gates. The branch results are immutable pre-promotion
evidence; protected `main` has not yet received this development batch.
