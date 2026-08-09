# ZeroTrace Architecture

## Status and authority

This document translates the terminal product requirements in
[ZEROTRACE_MASTER_PROMPT.md](ZEROTRACE_MASTER_PROMPT.md) into implementation boundaries. The Master
Prompt remains authoritative when the two differ. [PROGRESS.md](../../PROGRESS.md) is authoritative
for what is implemented today.

ZeroTrace is a read-only intelligence system. It may construct or simulate transaction semantics for
analysis, but it must never store private keys, sign transactions, execute swaps, or broadcast
transactions.

## Non-negotiable invariants

1. Every material conclusion references immutable evidence and a ledger snapshot.
2. Missing knowledge is a typed state. Unknown, unavailable, unsupported, stale, and not applicable
   are not numeric zero.
3. Entity claims are probabilistic and split into controller, coordination, and independence
   probabilities.
4. Shared infrastructure, exchanges, relayers, routers, mixers, and CoinJoin are suppression signals,
   not naive entity-merge signals.
5. Book value, mark-to-market value, quote value, and realizable value remain separate.
6. Realizable value declares route, capacity, taxes, fees, gas, failure conditions, snapshot, and
   evidence.
7. Protocol semantics are versioned by deployment and time. Current ABIs or IDLs cannot silently
   reinterpret historical events.
8. Provider health and coverage are part of every result. A provider outage cannot become a
   confident empty result.
9. Raw facts are append-only; derived state is reproducible from evidence, model version, and
   parameters.
10. The public runtime exposes no write-capable chain method.

## Logical architecture

```mermaid
flowchart TB
  subgraph Edge["Query and presentation"]
    UI["Analyst UI"]
    API["Fastify API / OpenAPI"]
    EXPORT["Evidence-aware exports"]
  end

  subgraph Intelligence["Intelligence plane"]
    RESOLVE["Identifier and subject resolver"]
    ENTITY["Temporal entity resolution"]
    RIGHTS["Control-right analyzer"]
    LAUNCH["Launch-mechanism adapters"]
    MARKET["Market-state reconstruction"]
    RV["Realizable-value engine"]
    SCENARIO["Scenario engine"]
  end

  subgraph Data["Evidence and data plane"]
    INGEST["Finality-aware ingestion"]
    NORMALIZE["Canonical fact normalization"]
    EVIDENCE["Immutable evidence graph"]
    SNAPSHOT["Snapshot coordinator"]
  end

  subgraph Providers["Read-only providers"]
    EVM["EVM RPC / SQD"]
    BTC["Bitcoin Core / Esplora"]
    SOL["Solana RPC / Geyser"]
    LABELS["Optional label observations"]
  end

  subgraph Stores["Storage"]
    PG[("PostgreSQL")]
    CH[("ClickHouse")]
    GRAPH[("Graph projection")]
    OBJ[("Object storage")]
    CACHE[("Valkey")]
    BUS["NATS / Temporal"]
  end

  UI --> API
  API --> RESOLVE
  RESOLVE --> SNAPSHOT
  SNAPSHOT --> EVM
  SNAPSHOT --> BTC
  SNAPSHOT --> SOL
  EVM --> INGEST
  BTC --> INGEST
  SOL --> INGEST
  LABELS --> NORMALIZE
  INGEST --> NORMALIZE
  NORMALIZE --> EVIDENCE
  EVIDENCE --> ENTITY
  EVIDENCE --> RIGHTS
  EVIDENCE --> LAUNCH
  ENTITY --> RV
  RIGHTS --> RV
  LAUNCH --> MARKET
  MARKET --> RV
  RV --> SCENARIO
  ENTITY --> API
  RIGHTS --> API
  MARKET --> API
  RV --> API
  SCENARIO --> API
  API --> EXPORT
  NORMALIZE --> CH
  EVIDENCE --> PG
  EVIDENCE --> OBJ
  ENTITY --> GRAPH
  API --> CACHE
  INGEST --> BUS
```

Solid paths describe the terminal design. The current initial runtime wires query-time provider reads,
canonical facts, process-local evidence, baseline entity inference, two deterministic RV algorithms,
API, and UI. Dashed or absent persistence/workflow behavior must not be inferred as complete; consult
the progress ledger.

## Canonical concepts

### Ledger snapshot

Each analysis is anchored independently:

- EVM: chain ID, block number, block hash, captured time;
- Bitcoin: network, height, best-block hash, captured time;
- Solana: cluster, slot, blockhash when available, commitment, captured time.

Cross-chain results are a snapshot set, not a fictional global block. The set records capture skew
and the finality policy used for each ledger.

### Subject

A Subject is a ledger-scoped object such as an address, transaction, token, UTXO, program, contract,
pool, launch, or inferred entity. Native identifiers retain chain scope. An EVM address without chain
context is ambiguous and must not silently default in persisted intelligence.

### Knowledge value

Every uncertain field uses a discriminated state:

- `known`: a value is supported at the declared snapshot;
- `unknown`: the system cannot determine it from current evidence;
- `unavailable`: a required provider or capability failed or was not configured.

Reason codes and optional details are carried alongside non-known states. APIs and UI preserve those
states end-to-end.

### Evidence

Evidence IDs are hashes over canonical content. A node records ledger, chain, source, locator,
snapshot position, finality, payload hash, capture time, and summary. Derived evidence must list its
source evidence IDs. The initial in-memory ledger enforces immutability; durable PostgreSQL/object
storage wiring is pending.

### Entity relationship

The engine returns independent controller, coordination, and independence probabilities. Feature
weights incorporate reliability and evidence IDs. Service hubs and privacy/co-spend patterns suppress
overconfident merging. The baseline is deterministic and testable but is not yet a calibrated
production entity model.

### Realizable value

The implemented kernel uses exact integer arithmetic for a constant-product pool and represents a
disabled or impossible sell as unavailable. The seeded exit-race simulation mutates shared reserves
in order and reports deterministic distributions. Multi-route liquidity, transfer taxes, protocol
fees, gas, slippage limits, reverts, bridges, CEX assumptions, and historical execution calibration
remain terminal requirements.

## Read query sequence

```mermaid
sequenceDiagram
  actor Analyst
  participant API
  participant Resolver
  participant Adapter
  participant Evidence
  participant Engine

  Analyst->>API: subject or analysis request
  API->>Resolver: validate and classify identifier
  Resolver-->>API: ledger-scoped candidates
  API->>Adapter: establish finalized snapshot
  Adapter-->>API: block/height/slot anchor
  API->>Adapter: allowlisted read at anchor
  Adapter-->>API: lossless raw response
  API->>Evidence: content-address raw observation
  Evidence-->>API: evidence ID
  API->>Engine: facts + evidence + metadata
  Engine-->>API: typed result + coverage + evidence IDs
  API-->>Analyst: result or explicit unavailable state
```

No request path falls back to a send method. If a provider lacks the necessary historical or
snapshot-consistent read, the operation returns unavailable.

## Provider boundary and transport security

The shared provider transport is defensive because provider URLs are privileged server-side
connections:

- HTTPS by default, with explicit opt-in for private local infrastructure;
- hostname allowlist and DNS/IP checks against loopback, private, link-local, multicast, and reserved
  space;
- no embedded URL credentials, fragments, path traversal, or redirects;
- bounded response size, request timeout, per-endpoint pacing, and JSON content validation;
- bounded exponential retry with capped `Retry-After`, in-flight deduplication, TTL/LRU response
  caching, per-endpoint circuit breakers, and ordered sticky failover;
- hostname-based source identifiers and transport diagnostics that exclude credentials and URL
  paths;
- lossless handling of integers beyond JavaScript's safe range;
- adapter-level method allowlists.

EVM rejects `eth_sendRawTransaction` and related write methods. Solana rejects
`sendTransaction`. Bitcoin uses only Esplora GET resources in the current adapter. These are
security boundaries and have regression tests.

## Storage ownership

| Store            | Intended authority                                                                                     | Current state                              |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| PostgreSQL       | subjects, snapshots, evidence metadata/edges, entities, rights, launches, scenarios, analyst overrides | Schema initialized; repositories not wired |
| ClickHouse       | raw normalized facts, platform events, time-series metrics                                             | Schema initialized; ingestion not wired    |
| Object storage   | raw provider payloads and large artifacts by content hash                                              | Compose service only                       |
| Graph projection | temporal entity/control traversal                                                                      | Optional Apache AGE service only           |
| Valkey           | bounded cache, locks, rate coordination                                                                | Compose service only                       |
| NATS / Temporal  | ingestion events and durable workflows                                                                 | Compose/profile services only              |

PostgreSQL evidence and snapshot tables include append-only guards. ClickHouse tables enforce a
knowledge-state/value consistency constraint.

## Platform-adapter policy

Protocol-specific adapters live behind the canonical launch/market interfaces:

- use official deployment discovery, ABI/IDL, program account state, and version windows;
- preserve unknown mechanisms when discovery is incomplete;
- keep copyleft or unclear-license components behind a process/API boundary until reviewed;
- never copy proprietary schemas or code into the Apache-2.0 core;
- validate each decoder against named real transactions/accounts and retain the evidence fixture.

The evaluated repositories, revisions, licenses, and intended boundaries are recorded in
[THIRD_PARTY_DEPENDENCIES.md](../research/THIRD_PARTY_DEPENDENCIES.md).

## Deployment topology

The default local topology is a single API and static web container plus PostgreSQL, ClickHouse,
Valkey, NATS, and MinIO. Temporal and a graph database are profiles so the foundation remains
startable while preserving the terminal seams. Production deployments must add TLS termination,
secret management, provider-specific quotas, persistent backups, network policy, observability,
horizontal worker scaling, and disaster recovery.

## Definition of production acceptance

An architecture slice is accepted only when:

1. its source and license are recorded;
2. raw and derived evidence can be drilled down;
3. snapshot/finality, coverage, freshness, and model version are visible;
4. Unknown is exercised in tests and UI;
5. unit, integration, and real-browser tests pass;
6. named real-chain fixtures have been verified against at least one independent source where
   practical;
7. provider failure, reorg/finality, rate limiting, precision, and adversarial inputs have been
   tested;
8. the progress ledger marks the capability complete with evidence.

A green process health check alone is not production acceptance.
