# API Guide

- Base path: `/api/v1`
- OpenAPI UI: `/docs`

The initial API has no authentication and is suitable only for local/staging use.

## System endpoints

| Method | Path                                 | Behavior                                                             |
| ------ | ------------------------------------ | -------------------------------------------------------------------- |
| GET    | `/health/live`                       | process liveness and read-only invariant                             |
| GET    | `/health/ready`                      | provider- and configured-request-storage-aware readiness             |
| GET    | `/health`                            | full provider, Evidence, ingestion-store, and data-quality state     |
| GET    | `/metrics`                           | Prometheus text exposition                                           |
| GET    | `/api/v1/capabilities`               | implemented, provider-required, and forbidden capabilities           |
| GET    | `/api/v1/chains`                     | configured chain adapters                                            |
| GET    | `/api/v1/platforms`                  | platform role and implementation truth                               |
| GET    | `/api/v1/data-quality/anchors`       | endpoint anchor reconciliation, continuity, coverage, and alert data |
| POST   | `/api/v1/data-quality/discrepancies` | Evidence-grounded typed same-Snapshot comparisons                    |

## Implemented intelligence endpoints

| Method | Path                                                          | Notes                                                            |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/v1/search?q=...`                                        | local identifier classification; optional `ledger` and `chainId` |
| GET    | `/api/v1/subjects/:ledger/:id`                                | snapshot-pinned current-state read when provider exists          |
| GET    | `/api/v1/ledger/:ledger/:type/:id`                            | typed block, transaction, or Bitcoin outpoint query              |
| GET    | `/api/v1/launches/EVM/:token`                                 | version-pinned Flap BSC current Portal-state inspection          |
| GET    | `/api/v1/launches/EVM/:token/events/:transactionHash`         | exact-receipt Flap creation/configuration/migration decoding     |
| GET    | `/api/v1/launches/EVM/:token/history`                         | bounded Flap Portal log discovery with exact receipt replay      |
| GET    | `/api/v1/launches/EVM/:token/history/projections/:id`         | provider-free paginated replay of immutable stored segments      |
| GET    | `/api/v1/launches/EVM/:token/origin`                          | bounded Flap creation-trace and exact receipt origin proof       |
| GET    | `/api/v1/claims/EVM/:token/addresses/:address/reports/latest` | latest immutable EVM Claim Report; provider-free replay          |
| GET    | `/api/v1/claims/EVM/:token/addresses/:address/reports/:id`    | exact content-addressed EVM Claim Report replay                  |
| POST   | `/api/v1/claims/declarations/parse`                           | compile public wording into Evidence-bound human-review drafts   |
| POST   | `/api/v1/rv/flap-sell`                                        | fixed-block read-only Flap Portal `previewSell` quote            |
| POST   | `/api/v1/rv/flap-pancake-v2-buy-scenarios`                    | migrated Flap Pancake V2 spot and multi-size buy model           |
| POST   | `/api/v1/rv/flap-pancake-v2-sell-scenarios`                   | migrated Flap Pancake V2 nominal/gross/tax exit-size model       |
| POST   | `/api/v1/data-quality/discrepancies`                          | typed error-budget and discrepancy audit                         |
| GET    | `/api/v1/evidence/:id`                                        | Evidence node, source edges, and bound Snapshot                  |
| GET    | `/api/v1/evidence/:id/drilldown`                              | restart-safe derived/source Evidence traversal                   |
| POST   | `/api/v1/entities/resolve`                                    | deterministic evidence-feature baseline                          |
| POST   | `/api/v1/rv/constant-product`                                 | exact-integer pool exit quote                                    |
| POST   | `/api/v1/scenarios/exit-race`                                 | seeded shared-pool exit ordering                                 |

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

### Claim declaration review

`POST /api/v1/claims/declarations/parse` accepts an EVM `chainId`, chain-bound ERC-20 `assetId`, the
original public statement, an optional source URI, and an optional exact ISO 8601 audit window with
timezone. The server records the text as `ANALYST_OBSERVATION` Evidence and returns deterministic
drafts for supported tax, treasury, burn, liquidity, pension and dividend roles.

Percentages are represented as exact basis points. Pension wording such as `100w` or `100万` is a
human token count and is not converted to atomic units until verified token decimals are available.
Missing wallet addresses, exact dates or allocation values remain typed Unknown; a month/day without
a year and timezone produces a warning. Every draft has `requiresHumanReview: true`. This endpoint
does not assert that a declaration is true, perform chain verification, promote a draft to an audit
rule, or initiate any transaction.

### EVM Claim Report replay

`GET /api/v1/claims/EVM/:token/addresses/:address/reports/latest?chainId=eip155:56` returns the
newest immutable report for one canonical token and subject address. Replace `latest` with a stable
`ecr_...` report ID to replay that exact content-addressed result. Both routes read PostgreSQL only;
they perform no RPC or SQD request and cannot initiate capture or any chain write.

Every returned report is revalidated against its canonical hash, finalized timestamped Snapshot,
terminal and nested Evidence IDs, source set, coverage, freshness, model version and confidence.
Custody and flow must use the same Snapshot. Observed inflow/outflow remain atomic-unit lower bounds;
coverage-incomplete Actual values remain typed Unknown. Counterparties and outflows do not prove a
dividend, burn, controller, owner, withdrawal right or terminal action. Unconfigured storage returns
`503`; an absent or identity-mismatched report returns `404` rather than a synthetic zero.

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

The inspector verifies Portal and token bytecode, attempts the officially recommended BSC
`getTokenV8Safe` interface, and falls back through V6/V5 only when the RPC reports that a newer
method is unavailable. A malformed successful response is rejected rather than reinterpreted as
another version. Returned fields include deployment/interface revision, lifecycle, quote and
virtual reserves, circulating/remaining supply, graduation threshold, progress, tax state, pool,
Snapshot, coverage, confidence, and source-linked Evidence. Fields not exposed by that interface,
including current sell capacity and LP rights, remain typed Unknown.

`spotPrice` is Known only while the Portal lifecycle makes its 18-decimal price field applicable.
For a migrated `DEX` token, the Portal field is explicitly `Unknown(NOT_APPLICABLE)` even when its
raw value is zero; ZeroTrace never presents that zero as the market price. The migrated market price
must come from an identified DEX pool at the same Snapshot.

No token bytecode yields negative Evidence and `platformMatch=false`; it does not produce a
plausible launch record. This endpoint performs no approval, signing, swap, or broadcast operation.

`GET /api/v1/launches/EVM/:token/events/:transactionHash?chainId=eip155:56&platform=flap`
accepts a caller-supplied creation, staging, or migration transaction hash. It validates the final
receipt and every log position, recaptures the exact block/hash Snapshot, decodes only logs emitted
by the versioned Portal, and returns receipt, log, documented-default, and derived Evidence.
`TokenCreated` configuration fields identify their provenance as `EVENT`, `OFFICIAL_DEFAULT`, or
`NOT_APPLICABLE`; a documented legacy curve type does not fabricate a curve address or V2 reserve
parameters. Future enum values stay Unknown. `LaunchedToDEX` and
`TokenPoolInfoUpdated` are returned as observed migration facts without inferring an absent
counterpart.

This endpoint has `historyCoverage=0`: it proves what the supplied transaction contains, not that
the transaction is the token's only creation/configuration/migration event. Automatic log discovery
and chain-wide lifecycle reconstruction remain incomplete.

`GET /api/v1/launches/EVM/:token/history?chainId=eip155:56&platform=flap&fromBlock=...&toBlock=...`
scans at most 50,000 blocks per request. The server splits the range into bounded log queries,
filters the versioned Portal event topic set, decodes the non-indexed token field, and then requires
every candidate transaction to pass the exact receipt/block replay described above. When
`SQD_PORTAL_URL` is configured, finalized `binance-mainnet` address/topic filtering supplies the
range observations; strict BSC `eth_getLogs` remains the fallback. The two paths share the same
request-scoped source provenance and fail-closed result validation. An optional `chunkSize` is
limited to 10,000 blocks; total observations are limited to 25,000 Portal logs and 250
receipt-replayed transactions. Request count, result count, topic mismatches, removed logs,
duplicates, out-of-range responses, source-head shortfall, parent discontinuity, and inconsistent
placements fail closed. Every discovered log must also match the RPC receipt's block, transaction,
log index, address, topics, and data exactly.

`requestedRangeCoverage=1` means every chunk in the requested range returned and all matching
transactions were replayed. It does not mean full token history: `lifetimeCoverage` and metadata
`historyCoverage` remain Unknown/zero until the Portal deployment origin is evidenced and indexing
is continuous through the analysis Snapshot. An empty result creates bounded negative Evidence,
not a claim that the token never emitted a Flap event.

`GET /api/v1/launches/EVM/:token/history/projections/:scanId?chainId=eip155:56&platform=flap`
replays an existing one-shot worker scan from PostgreSQL. Optional `afterBlock` is the exclusive
segment-start cursor returned by the preceding page; `limit` defaults to 20 and is bounded
from 1 to 100. The route validates that the UUID belongs to the exact BSC token, SQD source and Flap
event-history scan type, re-parses a completed terminal result, and reads at most `limit + 1`
immutable segments to determine `hasMore` and `nextAfterBlock`.

This endpoint performs no SQD or RPC call. It returns `503` when durable projection storage is not
configured or healthy, `404` for a mismatched token/scan identity, and fails closed on corrupt stored
state. `scan.requestedRangeCoverage` reports durable cursor progress. A completed scan may report
100% requested-range coverage while terminal lifetime coverage remains Unknown and
`historyCoverage=0`.

`GET /api/v1/launches/EVM/:token/history/lifetime/materializations/:scanId?chainId=eip155:56&platform=flap`
replays the composite point-in-time lifetime scan stored by `flap:lifetime`. The route binds the UUID
to the exact token, EVM/BSC chain, `FLAP_LIFETIME_MATERIALIZATION` scan type, and versioned ZeroTrace
source. It reports dataset start, finalized target, durable progress and safe failure metadata. A
completed state is re-parsed through the lifetime schema before it is returned.

The terminal result links its origin and history child scan IDs, origin-search coverage,
origin-to-target history summary, exact target Snapshot, terminal Evidence root, source set,
freshness, model version and confidence. `lifetimeCoverage=known/true` is valid only when the unique
origin search covers official SQD dataset start through target and the history projection covers
the evidenced creation block through that same target with 100% coverage. Missing origin remains
Unknown. Partial or Snapshot-conflicting children never degrade to zero or a plausible result.

The endpoint performs no SQD or RPC call. It returns `503` when durable checkpoints are not
configured, `404` for a mismatched token/scan identity, and fails closed with a checkpoint conflict
for corrupt completed state. This is stored point-in-time proof replay, not continuous scheduling.

`GET /api/v1/launches/EVM/:token/history/lifetime/heads/latest?chainId=eip155:56&platform=flap`
returns the latest accepted INITIAL or EXTENSION row from the append-only lifetime-head chain. It
includes sequence, predecessor ID, scan ID, exact finalized target/hash, typed lifetime state,
freshness/model metadata and terminal Evidence. The API performs no provider request and re-validates
stored rows through the lifetime schema and canonical hashes in the repository. Append-only reorg
invalidations remove their exact descendant suffix from canonical selection without deleting those
historical rows; after rollback the endpoint returns the surviving or safely replayed branch.

An absent token head returns `404` and remains Unknown; unconfigured or unhealthy migration `010`
storage returns `503`. The endpoint never falls back to a one-shot scan, never converts absence to
zero, and never triggers scheduling. Extensions are accepted only after the worker has persisted
multi-endpoint target agreement, direct or historical predecessor continuity, complete delta
history, and the new terminal Evidence root.

`GET /api/v1/launches/EVM/:token/origin?chainId=eip155:56&platform=flap&fromBlock=...&toBlock=...`
searches at most 1,000,000 finalized BSC blocks through SQD's `createResultAddress` trace filter.
The route requires both `SQD_PORTAL_URL` and a BSC RPC provider. A unique successful create trace is
accepted only when its creator is the versioned official Portal and its address, block, transaction,
transaction index and Snapshot agree with the exact RPC receipt and decoded `TokenCreated` event.
The response retains the runtime bytecode fingerprint and trace path as Evidence.

An optional `chunkSize` is bounded at 1,000,000 blocks and the synchronous route permits at most
250 chunks inside its one-million-block request ceiling. Each source response must report the exact
requested range, next block, finalized head, response-block count, request count and completed
status. SQD may paginate one logical filtered chunk across multiple HTTP responses; ZeroTrace does
not claim coverage until continuation reaches the requested end.

`searchedRangeCoverage=1` proves only the requested finalized range. Zero matches produce bounded
negative Evidence and an Unknown origin; multiple matches produce a conflicting-sources Unknown.
Even a unique match leaves `lifetimeCoverage` Unknown and `historyCoverage=0` until checkpointed
event indexing is continuous from the evidenced creation block through the target Snapshot.

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

`POST /api/v1/rv/flap-pancake-v2-buy-scenarios` accepts `chainId=eip155:56`, a canonical EVM
`token`, one to eight positive plain-decimal `quoteInputs`, optional `platform=flap`, and optional
decimal `blockNumber`. It is applicable only when the same-Snapshot Flap inspection reports `DEX`,
DEX ID `0`, a non-native quote token and a pool address.

At one numeric finalized block the adapter verifies pool/factory/router bytecode, `pair.factory`,
`token0`, `token1`, `getReserves`, official-factory `getPair`, router `factory`, and both token
`decimals`. The pool and router must match the versioned official Pancake V2 BSC registry. Each
input receives an official read-only router `getAmountsOut` quote plus a clean-room
constant-product recomputation using the documented fixed 25 bps V2 fee. Every field has Contract
State Evidence and the terminal result links the complete derivation graph.

The response separates raw-reserve spot price, official-router gross output, deterministic formula
output, configured-buy-tax net estimate, average modeled acquisition price, post-buy pool price and
price change. Actual execution-net receipt remains `Unknown(NOT_QUERIED)` until a pinned-fork swap
simulates fee-on-transfer and swapback behavior. Every scenario reports its deterministic quote
error and the top-level `validation` is `PASS`, `FAIL`, or `NOT_RUN`.

The deterministic tolerance is `10 bps` (`0.1%`). A larger mismatch sets the modeled tax-net value
to `Unknown(CONFLICTING_SOURCES)` rather than choosing one quote. `sourceCoverage=0.5` represents one
live chain-state operator plus official registries; repeated reads through that operator do not
inflate independence. `historyCoverage=0` and `simulationCoverage=0.5` make clear that this is a
point-in-time pool/router model, not historical or execution-complete RV.

Sending bought tokens to a pension or treasury wallet is never treated as a burn. The response
keeps `pensionSinkTreatment=Unknown(INSUFFICIENT_DATA)` and counts no extra price effect beyond the
modeled pool buy until custody and transfer execution are separately evidenced. The route performs
only bytecode reads and `eth_call`; it cannot approve, sign, swap, or broadcast.

`POST /api/v1/rv/flap-pancake-v2-sell-scenarios` accepts the same chain, platform, token and optional
block fields plus one to eight positive decimal `tokenInputs`. It reuses the complete same-Snapshot
market certificate, including a one-quote-asset forward Router/formula probe, then reads the
official Router in the token-to-quote direction for every exit size.

Each result keeps four values distinct: marginal-price nominal value, full-input Router gross
quote, the configured sell-tax pool estimate, and actual settlement output. The first three are
derived from the verified reserves and Portal configuration; actual settlement remains
`Unknown(NOT_QUERIED)` until a pinned fork measures the receiving wallet's balance delta. The
response also reports average configured-tax exit price, modeled post-sell spot, price impact and
quote-reserve consumption. A 10 bps Router/formula mismatch withholds every configured-tax field as
`Unknown(CONFLICTING_SOURCES)`.

`executionCapacity` remains `Unknown(NOT_QUERIED)` because reserve math cannot prove max-sell,
blacklist/whitelist, dynamic tax, fee exemptions, swapback, gas or revert behavior. The endpoint is
read-only and never approves, transfers, swaps, signs or broadcasts.

### Typed discrepancy audit

`POST /api/v1/data-quality/discrepancies` accepts up to 1,000 actual/reference comparisons plus
analysis metadata. Every non-empty audit requires one replayable target Snapshot; both observations
and every source or explanation Evidence ID must exist in the Evidence ledger and be compatible
with that complete Snapshot identity. A successful non-empty audit creates a derived Evidence node
linked to all comparison sources.

The engine uses exact decimal/rational arithmetic and field-class budgets:

- exact identity/state, conservation, freshness, and API/UI parity require zero mismatch;
- deterministic derived values pass at relative error `<= 0.10%`;
- independent market quote/RV values pass at `<= 0.50%`, warn through `1.00%`, and fail above
  `1.00%` unless the distinction has explicit explanation Evidence; their source independence must
  also be positively verified by referenced Evidence or the comparison is inconclusive;
- holder/entity aggregates pass at `<= 0.10%` only when declared coverage meets its gate.

When the reference is zero, comparison uses exact absolute equality and is excluded from the
relative-error denominator. Unknown, unavailable, stale, provider-down, unsupported, and not
applicable observations produce `INCONCLUSIVE` coverage gaps, never numeric zero or a passing
comparison. Overall status is `PASS`, `PASS_WITH_WARNINGS`, `FAIL`, or `INCONCLUSIVE`; an empty audit
is inconclusive. Entity-probability Brier/ECE calibration is a separate corpus-level acceptance gate
and is not implemented by this same-Snapshot endpoint.

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

The implemented Flap current-state, supplied-event-transaction, bounded-history, stored projection
replay, and bounded-origin routes above are the only current `/launches` exceptions. Other ledgers,
platforms, deployment-origin continuous history, and launch queries remain unavailable rather than
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
