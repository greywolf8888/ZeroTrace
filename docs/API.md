# API Guide

- Base path: `/api/v1`
- OpenAPI UI: `/docs`

The initial API has no authentication and is suitable only for local/staging use.

## System endpoints

| Method | Path                   | Behavior                                                   |
| ------ | ---------------------- | ---------------------------------------------------------- |
| GET    | `/health/live`         | process liveness and read-only invariant                   |
| GET    | `/health/ready`        | provider- and configured-storage-aware readiness           |
| GET    | `/health`              | full provider, Evidence, and ingestion-storage state       |
| GET    | `/metrics`             | Prometheus text exposition                                 |
| GET    | `/api/v1/capabilities` | implemented, provider-required, and forbidden capabilities |
| GET    | `/api/v1/chains`       | configured chain adapters                                  |
| GET    | `/api/v1/platforms`    | platform role and implementation truth                     |

## Implemented intelligence endpoints

| Method | Path                             | Notes                                                            |
| ------ | -------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/v1/search?q=...`           | local identifier classification; optional `ledger` and `chainId` |
| GET    | `/api/v1/subjects/:ledger/:id`   | snapshot-pinned current-state read when provider exists          |
| GET    | `/api/v1/evidence/:id`           | Evidence node, source edges, and bound Snapshot                  |
| GET    | `/api/v1/evidence/:id/drilldown` | restart-safe derived/source Evidence traversal                   |
| POST   | `/api/v1/entities/resolve`       | deterministic evidence-feature baseline                          |
| POST   | `/api/v1/rv/constant-product`    | exact-integer pool exit quote                                    |
| POST   | `/api/v1/scenarios/exit-race`    | seeded shared-pool exit ordering                                 |

Entity, RV, and scenario analysis is accepted only when every supplied source evidence ID already
exists in the evidence ledger and matches the request ledger, chain, and snapshot block/slot. A
successful analysis creates a `DERIVED_FEATURE` evidence node linked to those sources. Missing or
incompatible sources return HTTP 422 with `UNGROUNDED_ANALYSIS` and a typed `evidenceIssue` rather
than producing an ungrounded result. Compatibility includes the complete bound Snapshot, not only
the block/slot number. With `POSTGRES_URL` configured, source Evidence remains available after API
restart; without it, capability and health output explicitly report process-local storage.

## Explicitly incomplete endpoints

`/assets`, `/labels`, `/control-rights`, `/launches`, `/markets`, `/claims`, and
`/timeline` return HTTP 501 with:

- `CAPABILITY_NOT_IMPLEMENTED`;
- a typed Unknown knowledge value;
- zero coverage;
- a model-version marker.

This is deliberate contract preservation, not an implementation.

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
content-addressed versioned raw artifact, binds block and optionally raw-transaction observations to
durable Evidence/Snapshot provenance, stores idempotent ClickHouse Raw Facts, and only then advances
its PostgreSQL checkpoint. Header-only runs expose transaction coverage as `NOT_QUERIED`; raw
transactions are not yet normalized into logs, traces, inputs/outputs, instructions, transfers, or
protocol events.
