# Deployment

## Current deployment classification

The repository supports a reproducible local/staging topology. It is **not production-approved**:
durable repositories, authentication/authorization, multi-provider reconciliation, historical
ingestion, backup recovery, load testing, and real-chain acceptance remain incomplete.

## Build

```bash
docker compose config --quiet
docker compose build api web postgres clickhouse
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

Profiles expose architecture seams; starting them does not mean their application repositories or
workers are implemented.

## Health and smoke checks

```bash
docker compose ps
npm run health
curl http://localhost:8080/api/v1/capabilities
curl http://localhost:8080/metrics
```

Expected invariants:

- `/health/live` returns HTTP 200, `status: UP`, and `readOnly: true`;
- readiness is `UP` when at least one provider is healthy and `DEGRADED` otherwise;
- capability output marks signing, broadcasting, and key storage as `FORBIDDEN`;
- missing capabilities return 501 rather than fabricated data;
- the UI renders provider failures and Unknown values visibly.

## Production requirements not supplied by Compose

Before internet-facing deployment, add and verify:

- TLS and strict ingress policy;
- SSO or equivalent authentication, role-based authorization, tenancy isolation, and audit logging;
- a managed secret store and credential rotation;
- provider egress allowlists and per-provider quotas;
- redundant archive-grade providers with consistency checks;
- encrypted persistent volumes, backups, restore drills, retention, and deletion policy;
- PostgreSQL/ClickHouse migrations and application repository wiring;
- object-store immutability/versioning;
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

## Shutdown

```bash
docker compose down
```

This preserves named volumes. Removing volumes destroys local database/object data and is never part
of normal shutdown.
