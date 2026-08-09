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

These observations validate finalized block-header transport, provenance, storage ordering, and
restart behavior. They do **not** validate transaction/log/trace/input/output/instruction decoding,
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

This follow-up validates provider-shaped raw transaction capture and provenance only. EVM receipt,
log and trace normalization, Bitcoin input/output and outpoint materialization, Solana
instruction/CPI and balance tables, protocol decoding, independent-provider reconciliation, and
archive-scale backfill remain open. The disposable transaction-validation containers, network, and
named volumes were removed after the reverse-read assertions.

## Automated verification

| Command                  | Result                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `npm run verify:full`    | pass: format, lint, typecheck, 161 unit, 25 integration, build, license, audit, coverage, 6 E2E, SBOM |
| `npm run test:coverage`  | pass: 186 tests; 87.57% statements, 78.82% branches, 96.71% functions, 88.99% lines                   |
| `npm run test:e2e`       | pass: 6 Chromium tests across desktop and Pixel 7                                                     |
| `npm run sbom`           | pass: CycloneDX JSON generated locally                                                                |
| `docker compose config`  | pass                                                                                                  |
| production Compose smoke | pass with the port overrides documented above                                                         |
| branch GitHub Actions CI | pass on `dea2133`: quality/contracts, Chromium E2E, and five production container targets             |
| branch CodeQL            | pass on `dea2133`: JavaScript and TypeScript analysis                                                 |

Archive history beyond block headers, load, forced real-provider failover, reorg, backup/restore, and
production security controls remain acceptance gates. The branch results are immutable pre-promotion
evidence; protected `main` has not yet received this development batch.
