# API Guide

- Base path: `/api/v1`
- OpenAPI UI: `/docs`

The initial API has no authentication and is suitable only for local/staging use.

## System endpoints

| Method | Path                           | Behavior                                                             |
| ------ | ------------------------------ | -------------------------------------------------------------------- |
| GET    | `/health/live`                 | process liveness and read-only invariant                             |
| GET    | `/health/ready`                | provider- and configured-request-storage-aware readiness             |
| GET    | `/health`                      | full provider, Evidence, ingestion-store, and data-quality state     |
| GET    | `/metrics`                     | Prometheus text exposition                                           |
| GET    | `/api/v1/capabilities`         | implemented, provider-required, and forbidden capabilities           |
| GET    | `/api/v1/chains`               | configured chain adapters                                            |
| GET    | `/api/v1/platforms`            | platform role and implementation truth                               |
| GET    | `/api/v1/data-quality/anchors` | endpoint anchor reconciliation, continuity, coverage, and alert data |

## Implemented intelligence endpoints

| Method | Path                               | Notes                                                            |
| ------ | ---------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/v1/search?q=...`             | local identifier classification; optional `ledger` and `chainId` |
| GET    | `/api/v1/subjects/:ledger/:id`     | snapshot-pinned current-state read when provider exists          |
| GET    | `/api/v1/ledger/:ledger/:type/:id` | typed block, transaction, or Bitcoin outpoint query              |
| GET    | `/api/v1/launches/EVM/:token`      | version-pinned Flap BSC current Portal-state inspection          |
| POST   | `/api/v1/rv/flap-sell`             | fixed-block read-only Flap Portal `previewSell` quote            |
| GET    | `/api/v1/evidence/:id`             | Evidence node, source edges, and bound Snapshot                  |
| GET    | `/api/v1/evidence/:id/drilldown`   | restart-safe derived/source Evidence traversal                   |
| POST   | `/api/v1/entities/resolve`         | deterministic evidence-feature baseline                          |
| POST   | `/api/v1/rv/constant-product`      | exact-integer pool exit quote                                    |
| POST   | `/api/v1/scenarios/exit-race`      | seeded shared-pool exit ordering                                 |

Current-state subject reads establish a ledger-specific anchor before reading the subject:

- EVM calls `eth_getBlockByNumber` with the configured `finalized`, `safe`, or `latest` tag, then
  reads balance and code at that exact numeric block. The selected finality is part of the Snapshot.
- Bitcoin reads the tip height and resolves its hash with `/block-height/:height`, preventing a
  mixed height/hash pair. Esplora address aggregates remain best-effort near that tip and carry the
  `BEST_EFFORT_ESPLORA_TIP` marker; they are not archive-pinned UTXO proofs.
- Solana reads the configured commitment slot, obtains that slot's blockhash with `getBlock`, and
  requires `getAccountInfo.context.slot` to be at least the Snapshot slot.

Solana's explicit `value: null` is a Known non-existent account. A missing, stale, malformed, or
provider-failed response remains Unknown/unavailable and is never converted to a zero balance.

### Typed ledger records

`type` accepts `BLOCK` and `TRANSACTION` on EVM, Bitcoin, and Solana, plus `OUTPOINT` on Bitcoin.
EVM requires an explicit canonical `chainId=eip155:<id>`. Bitcoin and Solana reject a conflicting
`chainId`. IDs are canonical block positions/hashes, transaction hashes/signatures, or
`<txid>:<vout>` outpoints.

Confirmed transactions are re-read against their reported block/slot and rejected if the placement
hash conflicts with the Snapshot. Pending EVM transactions use a captured finalized head. Bitcoin
mempool transactions and outpoints use a best-chain-tip Snapshot plus a content digest of the
mutable observation. A null EVM/Solana transaction response creates raw provider Evidence and
source-linked negative Evidence; the result stays Unknown because absence, pruning/propagation, and
commitment delay cannot be conflated.

The response contains `subject`, typed `facts`, `metadata`, and `evidence`. `metadata` always carries
the Snapshot, coverage, freshness, source set, model version, confidence, and Evidence IDs. These
records validate provider shape and placement but do not claim semantic transfer, protocol-event,
controller, launchpad, or RV decoding.

### Flap BSC launch inspection

`GET /api/v1/launches/EVM/:token?chainId=eip155:56&platform=flap` requires a configured BSC
read-only adapter. An optional canonical-hex `blockNumber` pins replay to a historical block;
otherwise the adapter captures its configured Snapshot anchor and converts it to a numeric block
tag before any bytecode or `eth_call` read.

The inspector verifies Portal and token bytecode, attempts the officially documented BSC
`getTokenV6` interface, and falls back to documented `getTokenV5` only when the RPC reports that the
newer method is unavailable. A malformed successful response is rejected rather than reinterpreted
as another version. Returned fields include deployment/interface revision, lifecycle, quote and
virtual reserves, circulating/remaining supply, graduation threshold, progress, tax state, pool,
Snapshot, coverage, confidence, and source-linked Evidence. Fields not exposed by that interface,
including current sell capacity and LP rights, remain typed Unknown.

No token bytecode yields negative Evidence and `platformMatch=false`; it does not produce a
plausible launch record. This endpoint performs no approval, signing, swap, or broadcast operation.

`POST /api/v1/rv/flap-sell` accepts `chainId=eip155:56`, `token`, unsigned-decimal atomic
`inputQuantity`, optional `platform=flap`, and optional decimal `blockNumber`. The inspector and
`previewSell` call share that exact Snapshot. The returned `realizableValue` is Known only when the
Portal returns a valid `uint256`; an exact provider-returned zero remains zero with raw call
Evidence. Buy-only/killed/staged status is `unavailable/EXECUTION_BLOCKED`, migrated DEX status is
`unavailable/UNSUPPORTED`, future status is Unknown, excessive input is blocked, and provider errors
remain provider errors. None of those states is converted to zero.

The output and input remain atomic strings. Nominal value, decimals-normalized average price,
independent price impact, and complete fee breakdown remain Unknown until separate same-Snapshot
sources are implemented. The endpoint uses `eth_call` only and cannot sign, approve, swap, or
broadcast.

Each successful transport response carries its own safe hostname-based endpoint ID. Snapshot
`providerVersions` lists every endpoint used to establish the anchor; Evidence names the endpoint or
deterministic endpoint set used for the observed state; response metadata `sourceSet` is their sorted
union. This remains correct when concurrent calls complete out of order or a failover occurs.

## Anchor reconciliation and continuity

`GET /api/v1/data-quality/anchors` reads each configured endpoint separately. It lowers healthy
heads to the minimum observed block/slot, re-reads faster endpoints at that exact position, and
compares hash, parent identity, finality, ledger, and chain. The result is one of:

- `AGREEMENT`: at least `DATA_QUALITY_MIN_SOURCES` observations match at the common position;
- `DISAGREEMENT`: observations differ; `canonicalAnchor` is
  `unknown/CONFLICTING_SOURCES`, never a majority-selected winner;
- `INSUFFICIENT_SOURCES`: at least one observation exists but fewer than the required minimum;
- `UNAVAILABLE`: no endpoint produced a valid observation.

Every successful head/comparison is an append-only observation backed by block Evidence. A
reconciliation Evidence node links the common-position observations. Disagreement creates a
CRITICAL `CROSS_SOURCE_DISAGREEMENT` alert with Evidence edges. Each source also reports continuity
against its prior head as `FIRST_OBSERVATION`, `UNCHANGED`, `DIRECT_EXTENSION`, `HISTORICAL_MATCH`,
`REORG_DETECTED`, `SOURCE_REGRESSION`, or `CHECK_UNAVAILABLE`. Reorg/regression alerts retain prior,
current, and optional historical-check Evidence.

`configuredSources` counts endpoints, not independently operated providers. The API deliberately
returns `sourceIndependence: unknown/NOT_QUERIED`; hostname differences do not prove organizational
or infrastructure independence. `snapshotSet` preserves every comparison Snapshot. A single
canonical `metadata.snapshot` exists only for agreement; it is `null` for conflicts and insufficient
data.

Entity, RV, and scenario analysis is accepted only when every supplied source evidence ID already
exists in the evidence ledger and matches the request ledger, chain, and snapshot block/slot. A
successful analysis creates a `DERIVED_FEATURE` evidence node linked to those sources. Missing or
incompatible sources return HTTP 422 with `UNGROUNDED_ANALYSIS` and a typed `evidenceIssue` rather
than producing an ungrounded result. Compatibility includes the complete bound Snapshot, not only
the block/slot number. With `POSTGRES_URL` configured, source Evidence remains available after API
restart; without it, capability and health output explicitly report process-local storage.

## Explicitly incomplete endpoints

`/assets`, `/labels`, `/control-rights`, `/markets`, `/claims`, and
`/timeline` return HTTP 501 with:

- `CAPABILITY_NOT_IMPLEMENTED`;
- a typed Unknown knowledge value;
- zero coverage;
- a model-version marker.

This is deliberate contract preservation, not an implementation.

The implemented Flap route above is the only current `/launches` exception. Other ledgers,
platforms, historical event reconstruction, and launch queries remain unavailable rather than
falling back to generic data.

## Knowledge values

```json
{ "state": "known", "value": "123" }
```

```json
{
  "state": "unknown",
  "reason": "INSUFFICIENT_DATA",
  "detail": "The required historical evidence has not been indexed."
}
```

```json
{
  "state": "unavailable",
  "reason": "PROVIDER_UNCONFIGURED"
}
```

Clients must switch on `state`. They must not replace non-known values with zero, false, an empty
array, or a confident label.

## Error envelope

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Request validation failed.",
    "requestId": "req-1",
    "retryable": false
  }
}
```

Provider errors distinguish retryable timeout/quota/availability failures from invalid requests.
Secret values and raw provider URLs are not included.

Storage failures return HTTP 503 with a stable `STORAGE_*`, `EVIDENCE_*`, or `SNAPSHOT_CONFLICT`
code. When `POSTGRES_URL` is configured, failed durable writes never fall back to process memory.

Configured providers include a `transport` object in health responses with the safe active endpoint
ID, circuit state, logical request/attempt/success/failure counters, retries, pacing delays, cache
hits/misses, failovers, and last attempt timestamps. Endpoint IDs contain the provider role and
hostname only; URL paths and credentials are excluded.

Health responses also contain `storage`: `POSTGRES`/`UP`/`durable: true` for an initialized durable
repository, `POSTGRES`/`DOWN` with a safe error code when configured storage is unavailable, or
`MEMORY`/`EPHEMERAL` for an intentional no-`POSTGRES_URL` development runtime. Configured storage
failure makes `/health/ready` return HTTP 503.

`dataQuality` reports aggregate anchor state, safe per-chain results, configured/observed source
counts, continuity coverage, Evidence IDs, alerts, and its own `POSTGRES` or `MEMORY` storage state.
A source disagreement, reorg/regression alert, or failed data-quality repository degrades full
`/health`. `INSUFFICIENT_SOURCES` and `UNCONFIGURED` remain truthful non-production states without
making current request readiness fail. The endpoint performs read-only chain calls but may append
new Evidence, anchor observations, and alerts to the configured internal repository.

`ingestionStorage` reports the independent historical backends:

- `rawFacts`: ClickHouse `zerotrace.raw_chain_facts` schema and migration health;
- `checkpoints`: PostgreSQL `ingestion_runs` schema and migration health;
- `artifacts`: S3-compatible bucket reachability and versioning.

Each component is `UP`, `DOWN`, or `UNCONFIGURED`; the aggregate additionally uses `PARTIAL` when
only some components are configured. A historical backend failure degrades `/health`, but does not
make `/health/ready` fail because current API request paths do not depend on the worker stores. The
worker itself performs a fail-closed preflight across all stores before ingestion. Health output
never returns storage passwords or provider URL paths.

## Numeric representation

Atomic ledger quantities and reserves use decimal strings. JSON numbers are used only for bounded
probabilities, coverage ratios, latency, and explicitly safe counters. Clients must not coerce atomic
strings into JavaScript `number`.

## Snapshot and evidence requirements

Production conclusions must return:

- ledger-specific snapshot;
- source set, freshness, coverage, model version, and confidence;
- evidence IDs whose nodes can be retrieved;
- derivation edges for calculated conclusions.

Current search classification is local structural evidence. Provider-backed subject reads and
derived entity/RV/scenario results write their Evidence, derivation edges, and complete Snapshot to
PostgreSQL when configured. The separate finalized worker stores each ingested provider block as a
content-addressed versioned raw artifact, binds blocks, transactions, EVM logs/traces/state diffs,
Bitcoin inputs/outputs, and Solana instructions/logs/native balances/token balances/rewards to
durable Evidence/Snapshot provenance, stores idempotent ClickHouse Raw Facts, and only then advances
its PostgreSQL checkpoint. Per-table coverage is `MATERIALIZED`, `NOT_QUERIED`, or `NOT_APPLICABLE`;
non-materialized tables have null counts. These raw records are not semantic transfers or protocol
events.
