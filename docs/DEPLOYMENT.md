# Deployment

## Current deployment classification

The repository supports a reproducible local/staging topology. It is **not production-approved**:
Evidence/Snapshot persistence, bounded finalized raw-ledger ingestion, restart-safe bounded Flap
history projection, and incremental finalized Flap lifetime heads are wired; authentication/
authorization, remaining durable repositories, general continuous semantic history,
independent-operator acceptance, automatic reorg rollback/replay,
backup recovery, load testing, and terminal real-chain acceptance remain incomplete. Common-position endpoint reconciliation,
parent-history continuity detection, and Evidence-linked Data Quality Alerts are implemented.

## Build

```bash
docker compose config --quiet
docker compose build api web ingest-worker flap-origin-worker flap-history-worker \
  flap-lifetime-worker flap-lifetime-head-worker postgres clickhouse
```

The API image runs as the unprivileged Node user and is pruned of test, build, and development-log
packages after compilation. npm retains the optional TypeScript peer selected by the pinned
`viem`/`abitype` graph; it is not invoked by the runtime. The web image serves immutable assets with
Nginx security headers and proxies read API paths. The two database targets bake bootstrap SQL into
their entrypoint directories for path-independent startup.

## Start profiles

Core local topology:

```bash
docker compose up -d
```

Add durable workflows:

```bash
docker compose --profile full up -d
```

Add the optional graph projection store:

```bash
docker compose --profile graph up -d
```

Profiles expose architecture seams. The `ingest` worker is implemented for bounded finalized blocks,
transactions, EVM logs/traces/state diffs, Bitcoin inputs/outputs, and Solana
instructions/logs/balances/token balances/rewards; the `full` workflow and `graph` profiles do not
imply their application projections or orchestration are implemented.

Run one bounded finalized range through the implemented worker profile:

```bash
docker compose --profile ingest run --rm ingest-worker \
  --dataset binance-mainnet --profile ledger-records --from 0 --to 100
```

The worker checks PostgreSQL Evidence/checkpoint schemas, ClickHouse Raw Facts, and the versioned
object bucket before reading SQD. `block-headers` is the default profile; `transactions` adds strict
ledger-specific raw transaction identities; `ledger-records` also adds the applicable EVM
log/trace/state-diff, Bitcoin input/output, or Solana instruction/log/balance/token-balance/reward
tables. These records retain provider shape and do not claim semantic transfer or protocol decoding.
The worker is restart-safe for the same dataset/range/query identity and does not contain any
chain-write operation. Scheduling and continuous-head following are not yet supplied.

Run a wide, restart-safe Flap creation-origin scan through the separate semantic profile:

```bash
docker compose --profile semantic run --rm flap-origin-worker \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 999999 --chunk-size 1000000
```

This one-shot worker requires initialized PostgreSQL Evidence and semantic checkpoint schemas. It
persists completed chunks and a terminal Evidence-bearing result, but it is not a scheduler and does
not project continuous event history.

Run a wide, restart-safe Flap event-history projection through immutable bounded segments:

```bash
docker compose --profile semantic run --rm flap-history-worker \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 99999 --segment-size 50000 --chunk-size 10000
```

This worker requires migrations `001-008`. It preflights Evidence, semantic checkpoints, and the
projection repository before reading SQD or BSC RPC. A segment is committed before its cursor is
advanced; the identical command resumes from a safe boundary and completed runs replay without
provider access. The terminal JSON contains a stable scan ID. With the API connected to the same
PostgreSQL database, retrieve stored pages at:

```text
GET /api/v1/launches/EVM/<token>/history/projections/<scan-id>?chainId=eip155:56&platform=flap&limit=20
```

The API endpoint and UI read only immutable projection rows. They never initiate an SQD/RPC scan.
The worker is one-shot and does not claim deployment-origin-to-head continuity or lifetime coverage.

Run an exact point-in-time lifetime materialization at the current finalized BSC head:

```bash
docker compose --profile semantic run --rm flap-lifetime-worker \
  --token 0x0000000000000000000000000000000000000000
```

This service requires migrations `001-008` and preflights Evidence, semantic checkpoints and the
immutable history projection before provider access. It obtains the official SQD dataset start,
captures one finalized target, and composes origin plus origin-to-target event history. Set
`FLAP_LIFETIME_TARGET_BLOCK` or pass `--target <block>` to pin an exact rerun; the worker proves that
the target is no higher than the current finalized head. The terminal scan ID replays through:

```text
GET /api/v1/launches/EVM/<token>/history/lifetime/materializations/<scan-id>?chainId=eip155:56&platform=flap
```

The endpoint and UI do not contact providers. A running checkpoint exposes progress but no terminal
conclusion; a corrupt completed result fails closed. This one-shot proof can establish exact
lifetime coverage at one Snapshot.

Maintain accepted finalized lifetime heads continuously:

```bash
docker compose --profile semantic up --build flap-lifetime-head-worker
```

Set `FLAP_LIFETIME_HEAD_TOKEN`, two or more `EVM_BSC_RPC_URLS`, and an optional
`FLAP_LIFETIME_HEAD_INTERVAL_MS`. This service requires migrations `001-010`. It reconciles a common
finalized BSC target, appends only the missing delta after Evidence-proving the stored predecessor,
and emits credential-free complete/deferred JSON events. The latest accepted state is available at:

```text
GET /api/v1/launches/EVM/<token>/history/lifetime/heads/latest?chainId=eip155:56&platform=flap
```

`FLAP_LIFETIME_HEAD_MAX_CYCLES` is for bounded tests and operations only; blank means continuous.
Provider disagreement and retryable outages defer advancement. A finalized reorg is recorded and
stops the worker because automatic rollback/replay is not yet accepted.

## Health and smoke checks

```bash
docker compose ps
npm run health
curl http://localhost:8080/api/v1/capabilities
curl http://localhost:8080/api/v1/data-quality/anchors
curl http://localhost:8080/metrics
```

Expected invariants:

- `/health/live` returns HTTP 200, `status: UP`, and `readOnly: true`;
- readiness is `UP` when at least one provider is healthy and configured storage, if any, is healthy;
- configured PostgreSQL failure returns readiness HTTP 503 and never silently changes to memory;
- missing or unhealthy Flap projection/head migrations `008`/`010` return readiness HTTP 503 when PostgreSQL
  is configured;
- `/health` reports `ingestionStorage` independently for Raw Facts, checkpoints, and raw artifacts;
- `/health` and `/api/v1/data-quality/anchors` distinguish agreement, disagreement, insufficient
  sources, provider unavailability, continuity state, and data-quality storage health;
- disagreement or a reorg/regression alert degrades full health, retains Evidence, and never chooses
  a majority winner; one source cannot report agreement;
- provider diagnostics expose request cache hits/misses/bypasses and a safe active endpoint ID;
- a configured historical backend failure degrades aggregate health, while API readiness continues
  to describe whether current API requests can be served;
- capability output marks signing, broadcasting, and key storage as `FORBIDDEN`;
- missing capabilities return 501 rather than fabricated data;
- the UI renders provider failures and Unknown values visibly.

## Production requirements not supplied by Compose

Before internet-facing deployment, add and verify:

- TLS and strict ingress policy;
- SSO or equivalent authentication, role-based authorization, tenancy isolation, and audit logging;
- a managed secret store and credential rotation;
- provider egress allowlists and per-provider quotas;
- redundant, independently operated archive-grade providers with common-position consistency checks;
- explicit per-network EVM finality policy (`EVM_*_SNAPSHOT_TAG`, default `finalized`) and alerts
  for unsupported or regressed provider finality;
- encrypted persistent volumes, backups, restore drills, retention, and deletion policy;
- migration automation plus remaining PostgreSQL and ClickHouse application repositories;
- managed object retention/object-lock policy beyond the implemented versioned content-addressed
  bucket;
- metrics, logs, traces, alerts, SLOs, and incident response;
- worker scaling and replay-safe workflow semantics;
- image digest pinning, signature/provenance, vulnerability scan, and SBOM archival;
- capacity, chaos, provider-failure, reorg/finality, and disaster-recovery tests.

## Secrets

Do not place secrets in Compose files, image layers, frontend environment variables, evidence, or
logs. Use a deployment secret manager and inject values only into server processes. `GMGN_API_KEY`
is optional and has no browser path.

Provider URLs can contain commercially sensitive tenant IDs even without query secrets. Treat the
full URL as a secret and avoid logging it.

## Network policy

The API should have egress only to approved providers and internal services. Databases, NATS, MinIO,
Temporal, and provider credentials must not be directly internet-exposed. The default host port
mappings exist for local development and should be removed or firewalled in production.

Private provider endpoints require an intentional production policy. Compose defaults
`ALLOW_PRIVATE_PROVIDER_URLS=false`; production internal RPC access should use an explicit,
audited network-aware configuration rather than changing that flag casually. The opt-in exists for
trusted local interception proxies and private RPC networks, and must be paired with the exact
`PROVIDER_ALLOW_HOSTS` allowlist.

## Database lifecycle

The SQL under `infra/*/init` is baked into the project database images and bootstraps fresh
databases. It is not a substitute for production migrations. Before the first persistent release:

1. adopt a migration tool with an immutable migration ledger;
2. split application and migration credentials;
3. verify upgrade and rollback/roll-forward on a restored production-sized copy;
4. monitor schema and ingestion version compatibility;
5. test point-in-time restore and evidence-hash reconciliation.

An existing local PostgreSQL volume does not rerun image entrypoint scripts. After backing it up,
apply the append-only anchor/alert and Snapshot-observation identity migrations explicitly:

```bash
docker compose exec -T postgres psql -U zerotrace -d zerotrace \
  < infra/postgres/init/005_data_quality.sql
docker compose exec -T postgres psql -U zerotrace -d zerotrace \
  < infra/postgres/init/006_snapshot_observation_identity.sql
docker compose exec -T postgres psql -U zerotrace -d zerotrace \
  < infra/postgres/init/007_semantic_scan_checkpoints.sql
docker compose exec -T postgres psql -U zerotrace -d zerotrace \
  < infra/postgres/init/008_flap_history_projection.sql
docker compose exec -T postgres psql -U zerotrace -d zerotrace \
  < infra/postgres/init/009_flap_lifetime_heads.sql
docker compose exec -T postgres psql -U zerotrace -d zerotrace \
  < infra/postgres/init/010_flap_lifetime_reorgs.sql
```

PowerShell equivalent:

```powershell
Get-Content -Raw infra/postgres/init/005_data_quality.sql |
  docker compose exec -T postgres psql -U zerotrace -d zerotrace
Get-Content -Raw infra/postgres/init/006_snapshot_observation_identity.sql |
  docker compose exec -T postgres psql -U zerotrace -d zerotrace
Get-Content -Raw infra/postgres/init/007_semantic_scan_checkpoints.sql |
  docker compose exec -T postgres psql -U zerotrace -d zerotrace
Get-Content -Raw infra/postgres/init/008_flap_history_projection.sql |
  docker compose exec -T postgres psql -U zerotrace -d zerotrace
Get-Content -Raw infra/postgres/init/009_flap_lifetime_heads.sql |
  docker compose exec -T postgres psql -U zerotrace -d zerotrace
Get-Content -Raw infra/postgres/init/010_flap_lifetime_reorgs.sql |
  docker compose exec -T postgres psql -U zerotrace -d zerotrace
```

Then confirm `dataQuality.storage.status` and top-level `storage.status` are `UP`. Never delete a
persistent volume as a migration strategy.

## Shutdown

```bash
docker compose down
```

This preserves named volumes. Removing volumes destroys local database/object data and is never part
of normal shutdown.
