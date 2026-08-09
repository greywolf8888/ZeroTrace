# Local Development

## Prerequisites

- Git
- Node.js `24.11.1` (the repository pin is [`.nvmrc`](../.nvmrc))
- npm 11 or newer
- Docker Engine and Compose v2 for backing services and container validation
- Chromium installed by Playwright for E2E tests

No provider key is required to build or run the degraded local core. Dedicated read-only providers are
required for meaningful chain validation.

## Clean checkout

### PowerShell

```powershell
git clone git@github.com:greywolf8888/ZeroTrace.git
Set-Location ZeroTrace
Copy-Item .env.example .env
npm ci
npm run build
npm test
```

### POSIX shell

```bash
git clone git@github.com:greywolf8888/ZeroTrace.git
cd ZeroTrace
cp .env.example .env
npm ci
npm run build
npm test
```

`npm ci` is the supported dependency installation path. It fails when the lockfile and manifests
diverge.

## Start the application

For API and web watch mode:

```bash
npm run dev
```

For local infrastructure:

```bash
docker compose up -d postgres clickhouse valkey nats minio
```

For the entire containerized application:

```bash
docker compose up --build
```

Database initialization is automatic on a new Compose volume:

- the PostgreSQL image contains and executes `infra/postgres/init/*.sql`;
- the ClickHouse image contains and executes `infra/clickhouse/init/*.sql`.

The SQL is copied into small project image stages instead of bind-mounted. This keeps initialization
reliable from Windows workspaces whose paths contain Unicode characters.

Initialization scripts are intentionally idempotent where the engine supports it. Docker entrypoint
scripts run only when the data volume is first created. Apply future schema changes through explicit
migrations; do not delete a developer's volumes to simulate migration.

## Configuration

1. Copy `.env.example` to `.env`.
2. Add provider hosts to `PROVIDER_ALLOW_HOSTS`.
3. Set only HTTPS read-only endpoints.
4. Keep optional providers blank when unavailable.

Important values:

| Variable                      | Meaning                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `API_PORT` / `WEB_PORT`       | host ports                                                                   |
| `CORS_ORIGIN`                 | comma-separated exact browser origins                                        |
| `PROVIDER_ALLOW_HOSTS`        | comma-separated exact provider hostnames                                     |
| `ALLOW_PRIVATE_PROVIDER_URLS` | explicit local proxy/private-RPC exception; defaults to false                |
| `EVM_*_RPC_URL`               | optional Ethereum/BSC read-only RPC                                          |
| `BITCOIN_ESPLORA_URL`         | optional Esplora base path                                                   |
| `SOLANA_RPC_URL`              | optional Solana read-only RPC                                                |
| `SOLANA_COMMITMENT`           | processed, confirmed, or finalized; production analysis should use finalized |

`PROVIDER_ALLOW_HOSTS` does not authorize transaction methods. Method allowlists remain enforced
inside each adapter.

Keep `ALLOW_PRIVATE_PROVIDER_URLS=false` unless an explicitly trusted local network or interception
proxy maps approved public provider names to private/reserved addresses (for example, a local
proxy using `198.18.0.0/15`). Enabling it relaxes DNS/IP SSRF protection but does not relax the
exact hostname allowlist, HTTPS requirement, redirect denial, or read-only RPC method allowlists.

## Development workflow

Run the closest test after changing a package:

```bash
npm run test:unit
npm run test:integration
npm run typecheck
```

Run the complete non-browser gate:

```bash
npm run verify
```

Run browser validation:

```bash
npx playwright install chromium
npm run test:e2e
```

Generate dependency evidence:

```bash
npm run license:check
npm run audit
npm run sbom
```

## API-only development

```bash
npm run dev:api
```

The API starts on `http://localhost:8080`. Check:

```bash
npm run health
```

The readiness endpoint may report `DEGRADED` when no provider is configured. This is a valid
developer state; `readOnly` must still be true.

## Web-only development

```bash
npm run dev:web
```

Vite proxies `/api`, `/health`, `/metrics`, and `/docs` to the API. Starting only the web
process leaves data panels in an explicit unavailable state.

## Adding a workspace package

1. Create `packages/<name>/package.json` with an `@zerotrace/*` name.
2. Extend `tsconfig.packages.json` project references.
3. Reference other internal packages through workspace entries.
4. Export a narrow public API from `src/index.ts`.
5. Add unit tests beside source and document external dependencies.

Domain packages may not import web or API code.

## Troubleshooting

- **Provider rejected:** add the exact lower-case hostname to `PROVIDER_ALLOW_HOSTS`; do not bypass
  URL safety for a public endpoint.
- **Readiness degraded:** inspect `/health` for `UNCONFIGURED`, timeout, or rate-limit state.
- **Database tables absent:** confirm whether the volume predated the initialization SQL; apply the
  migration explicitly rather than deleting data.
- **E2E browser missing:** run `npx playwright install chromium`.
- **Port in use:** set host-side ports in `.env`. The container ports remain fixed.
- **Unsafe integer error:** the provider returned a precision-sensitive value in an unsupported
  shape. Preserve it as a string in the adapter; never round it.
