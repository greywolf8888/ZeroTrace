# API Guide

- Base path: `/api/v1`
- OpenAPI UI: `/docs`

The initial API has no authentication and is suitable only for local/staging use.

## System endpoints

| Method | Path                   | Behavior                                                   |
| ------ | ---------------------- | ---------------------------------------------------------- |
| GET    | `/health/live`         | process liveness and read-only invariant                   |
| GET    | `/health/ready`        | provider-aware readiness                                   |
| GET    | `/health`              | full provider state                                        |
| GET    | `/metrics`             | Prometheus text exposition                                 |
| GET    | `/api/v1/capabilities` | implemented, provider-required, and forbidden capabilities |
| GET    | `/api/v1/chains`       | configured chain adapters                                  |
| GET    | `/api/v1/platforms`    | platform role and implementation truth                     |

## Implemented intelligence endpoints

| Method | Path                             | Notes                                                            |
| ------ | -------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/v1/search?q=...`           | local identifier classification; optional `ledger` and `chainId` |
| GET    | `/api/v1/subjects/:ledger/:id`   | snapshot-pinned current-state read when provider exists          |
| GET    | `/api/v1/evidence/:id`           | process-local evidence node                                      |
| GET    | `/api/v1/evidence/:id/drilldown` | derived/source evidence traversal                                |
| POST   | `/api/v1/entities/resolve`       | deterministic evidence-feature baseline                          |
| POST   | `/api/v1/rv/constant-product`    | exact-integer pool exit quote                                    |
| POST   | `/api/v1/scenarios/exit-race`    | seeded shared-pool exit ordering                                 |

Entity, RV, and scenario analysis is accepted only when every supplied source evidence ID already
exists in the evidence ledger and matches the request ledger, chain, and snapshot block/slot. A
successful analysis creates a `DERIVED_FEATURE` evidence node linked to those sources. Missing or
incompatible sources return HTTP 422 with `UNGROUNDED_ANALYSIS` and a typed `evidenceIssue` rather
than producing an ungrounded result. Evidence is currently process-local, so callers must perform
the provider-backed subject read in the same API process before submitting downstream analysis.

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

Current search classification is local structural evidence and current subject reads add
process-local evidence. Durable retrieval across restarts remains pending.
