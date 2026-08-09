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

## Automated verification

| Command                  | Result                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| `npm run verify`         | pass: format, lint, typecheck, 113 unit, 18 integration, build, license, audit |
| `npm run test:coverage`  | pass: 92.80% statements, 81.47% branches, 97.55% functions, 93.94% lines       |
| `npm run test:e2e`       | pass: 6 Chromium tests across desktop and Pixel 7                              |
| `npm run sbom`           | pass: CycloneDX JSON generated locally                                         |
| `docker compose config`  | pass                                                                           |
| production Compose smoke | pass with the port overrides documented above                                  |

Remote CI for this branch, archive history, load, forced real-provider failover, reorg,
backup/restore, and production security controls remain acceptance gates.
