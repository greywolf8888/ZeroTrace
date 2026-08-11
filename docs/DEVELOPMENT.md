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

- the PostgreSQL image contains and executes `infra/postgres/init/*.sql`, including append-only
  Evidence, restart-safe ingestion checkpoints, and monotonic semantic-scan checkpoints;
- the ClickHouse image contains and executes `infra/clickhouse/init/*.sql`.

The SQL is copied into small project image stages instead of bind-mounted. This keeps initialization
reliable from Windows workspaces whose paths contain Unicode characters.

The default full Compose path configures durable PostgreSQL Evidence/Snapshot persistence, semantic
checkpoints, and immutable Flap history projections. The Flap origin API uses those checkpoints for
chunk resume and terminal result replay; without PostgreSQL it remains a bounded, process-local
request. Durable history projection replay is unavailable without PostgreSQL. For
host-side watch mode, either leave `POSTGRES_URL` blank for an explicitly ephemeral development
ledger, or start PostgreSQL and set:

```text
POSTGRES_URL=postgresql://zerotrace:zerotrace@localhost:5432/zerotrace
```

When that variable is present, database failure closes writes and readiness; the API does not fall
back to process memory.

## Finalized historical ingestion

Start the three durable worker backends:

```bash
docker compose up -d postgres clickhouse minio
```

For a host-side worker, set `POSTGRES_URL` to the host port and use the object/ClickHouse defaults in
`.env`:

```bash
npm run ingest -- --dataset ethereum-mainnet --profile ledger-records --from 0 --to 100
```

Or let Compose inject the internal service URLs:

```bash
docker compose --profile ingest run --rm ingest-worker \
  --dataset solana-mainnet --profile ledger-records --from 0 --to 100
```

Valid datasets are `ethereum-mainnet`, `binance-mainnet`, `bitcoin-mainnet`, and
`solana-mainnet`. Valid profiles are `block-headers` (default), `transactions`, and
`ledger-records`. The last profile requests transactions plus EVM logs/traces/state diffs, Bitcoin
inputs/outputs, or Solana instructions/logs/native balances/token balances/rewards for the selected
dataset. Ranges are inclusive and capped by `SQD_MAX_RANGE_BLOCKS`. The worker streams only finalized
data, writes one block artifact, then its block, transaction, and requested ledger-record
Evidence/Snapshot plus Raw Facts, and only then advances the checkpoint. It resumes the same
dataset/range/query identity after failure; a completed identity is a no-op on replay. Every record
table reports `MATERIALIZED`, `NOT_QUERIED`, or `NOT_APPLICABLE`, with null rather than numeric zero
outside materialized coverage. It is a chain-read worker and contains no private-key, signing, swap,
or broadcast interface.

## Durable Flap origin scans

The semantic worker can cover an inclusive origin range larger than the synchronous API cap while
keeping every provider request bounded to `FLAP_ORIGIN_CHUNK_SIZE` (maximum 1,000,000 blocks). Start
PostgreSQL, set a host-side `POSTGRES_URL`, and run:

```bash
npm run flap:origin -- \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 999999 --chunk-size 1000000
```

The Compose equivalent is:

```bash
docker compose --profile semantic run --rm flap-origin-worker \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 999999 --chunk-size 1000000
```

The CLI accepts only token/range/chunk arguments. It preflights both the append-only Evidence schema
and semantic checkpoint migration `007`, reads finalized SQD BSC creation traces, verifies a unique
candidate against the exact BSC receipt Snapshot, and emits one credential-free JSON summary. A
failed chunk records only a safe error category. Re-run the exact identity to resume; changing any
identity field starts a separate immutable scan. A complete bounded origin is not continuous token
history and does not turn lifetime coverage into Known.

## Durable Flap event-history projections

The second semantic-worker entrypoint scans a wider inclusive range as independently bounded
segments. Each accepted segment is written immutably before the semantic cursor advances; an
interruption at that boundary is adopted exactly once on restart without re-reading the provider.
Start PostgreSQL, configure read-only SQD and BSC RPC endpoints, then run:

```bash
npm run flap:history -- \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 99999 --segment-size 50000 --chunk-size 10000
```

The Compose equivalent is:

```bash
docker compose --profile semantic run --rm flap-history-worker \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 99999 --segment-size 50000 --chunk-size 10000
```

The CLI also accepts bounded `--max-transactions` and `--max-logs` values, preflights Evidence,
semantic checkpoint migration `007`, and projection migration `008`, and emits a credential-free
summary containing the stable scan ID. Re-run the exact identity to resume or replay a completed
result. While the API is connected to the same PostgreSQL database, inspect immutable pages in the
UI or call:

```text
GET /api/v1/launches/EVM/<token>/history/projections/<scan-id>?chainId=eip155:56&platform=flap&limit=20
```

Pagination reads only stored segments. It performs no SQD/RPC request, and complete requested-range
coverage still leaves token-lifetime coverage Unknown until continuous deployment-origin-to-head
orchestration is proven.

## Durable ERC-20 burn-candidate promotion

The burn-promotion entrypoint turns bounded BSC zero-address event discovery into restart-safe
exact-block certificates. A segment is not checkpointed until SQD discovery is complete and every
candidate has a finalized parent/target `totalSupply` plus complete target-block `Transfer`
conservation result:

```bash
npm run claims:burn:promote -- \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 999999 --segment-size 1000000
```

The isolated Compose profile is equivalent:

```bash
docker compose --profile burn-promotion run --rm burn-promotion-worker \
  --token 0x0000000000000000000000000000000000000000 \
  --from 0 --to 999999 --segment-size 1000000
```

One run is limited to 5,000,000 blocks and five segments. Optional `--max-transfers` and
`--max-candidates-per-segment` limits fail closed instead of truncating a result. The worker
preflights append-only Evidence and semantic-checkpoint storage, emits no credentials, and returns a
stable scan ID. Re-running the identical command resumes the first incomplete segment or replays the
terminal checkpoint without an RPC/SQD call.

With the API connected to the same PostgreSQL database, the Claim Audit UI or
`GET /api/v1/claims/EVM/<token>/burn-promotions/<scan-id>` validates and replays progress/result
state without providers. A running scan has `terminalResult: null`; structural corruption fails
closed. Scoped zero-address event/candidate completion never changes silent supply detection from
`Unknown(NOT_QUERIED)`.

## Durable ERC-20 all-block supply continuity

Use this one-shot worker when the question is whether ERC-20 `totalSupply()` changed anywhere in a
specific finalized BSC interval, including custom changes that emit no zero-address `Transfer`:

```bash
npm run claims:supply:scan -- \
  --token 0x0000000000000000000000000000000000000000 \
  --from 100000000 --to 100000127 --segment-size 128
```

The Compose equivalent is isolated from the default stack:

```bash
docker compose --profile supply-continuity run --rm supply-continuity-worker \
  --token 0x0000000000000000000000000000000000000000 \
  --from 100000000 --to 100000127 --segment-size 128
```

Configure `EVM_BSC_RPC_URLS` with one to eight archive-capable read endpoints. A verified result
requires at least two endpoints attributed to distinct operators by the versioned registry. The
worker uses EIP-1898 block-hash state calls and samples the parent of `--from` plus every block
through `--to`; the inclusive transition range is capped at 32,768 blocks, 32 segments and 1,024
transitions per segment. Every changed block additionally requires a complete SQD mint/burn event
query and exact conservation certificate. Conflicts and partial reads record failure without
advancing the checkpoint.

The terminal JSON contains no credential and includes a stable scan ID. Re-run the identical
command to resume or replay, or use the PostgreSQL-only API/UI path:

```text
GET /api/v1/claims/EVM/<token>/supply-continuity/<scan-id>
```

The BNB Chain public endpoint can retain less historical state than an archive service; a
`missing trie node` is an unavailable-provider result, not unchanged supply. Select a recent range
or an archive-capable independent endpoint. Do not enable `ALLOW_PRIVATE_PROVIDER_URLS` outside a
deliberately isolated local environment.

## Exact Flap lifetime materialization

The third semantic-worker entrypoint composes the two durable primitives at one finalized BSC
target. It reads the official SQD `binance-mainnet` dataset start, proves a unique Portal-created
contract origin from that start through the target, then projects all supported Portal events from
the creation block through the same target Snapshot:

```bash
npm run flap:lifetime -- \
  --token 0x0000000000000000000000000000000000000000
```

Omitting `--target` captures the current finalized head. For exact replay after the first run, pass
the emitted block as `--target <block>`; a pinned target is read only after the worker proves it is
at or below the current finalized head. Origin chunk, history segment/query and result limits have
separate bounded flags. The Compose equivalent is:

```bash
docker compose --profile semantic run --rm flap-lifetime-worker \
  --token 0x0000000000000000000000000000000000000000
```

The composite scan advances once, only after the origin and history child results both validate
against their immutable identities. A crash after that advance but before terminal completion is
finished on retry without repeating child provider reads or Evidence writes. `lifetimeCoverage`
becomes `known/true` only for a unique origin plus 100% origin-to-target history at the exact target
Snapshot. No origin keeps the conclusion Unknown; incomplete or conflicting child results fail the
run. Replay the stored composite result through the UI or:

```text
GET /api/v1/launches/EVM/<token>/history/lifetime/materializations/<scan-id>?chainId=eip155:56&platform=flap
```

The replay endpoint reads only PostgreSQL. The worker is one-shot.

## EVM Claim Report replay

Migration `011_evm_claim_reports` adds immutable, content-addressed storage for completed
same-Snapshot EVM claim-address observations. The storage repository validates terminal and nested
Evidence membership before writing, then revalidates canonical identity on every read. The API and
UI can replay the latest report for a token/address or an exact `ecr_...` report ID without calling
an external provider:

```text
GET /api/v1/claims/EVM/<token>/addresses/<address>/reports/latest?chainId=eip155:56
GET /api/v1/claims/EVM/<token>/addresses/<address>/reports/<report-id>?chainId=eip155:56
```

This module does not schedule or initiate a live capture. Report creation is a repository operation
for a completed Evidence-backed observation; automated capture orchestration remains pending.

## Continuous Flap lifetime heads

The fourth semantic-worker entrypoint maintains one append-only accepted lifetime chain. It requires
at least `DATA_QUALITY_MIN_SOURCES` distinct BSC RPC URLs, reconciles their common finalized
position, and then either accepts an INITIAL materialization, returns UNCHANGED, or appends an
EXTENSION that scans only the missing block interval:

```bash
npm run flap:lifetime:heads -- \
  --token 0x0000000000000000000000000000000000000000 \
  --interval-ms 60000
```

`--max-cycles` is a bounded test/operations control; omit it for normal continuous operation. The
same service is available as `flap-lifetime-head-worker` in the `semantic` Compose profile. Each
extension links the previous lifetime terminal Evidence, target reconciliation Evidence,
per-provider historical predecessor checks when the target is not a direct child, delta projection
Evidence, and one new terminal root. Migration `009_flap_lifetime_heads` rejects non-completed scans,
forked predecessors, out-of-order sequences, target/Snapshot conflicts and mutation. Migration
`010_flap_lifetime_reorgs` adds immutable active-suffix invalidation and canonical-lineage replay.

Retryable provider or storage failures defer the cycle using a credential-free error code. Endpoint
disagreement, regression, incomplete coverage or an accepted finalized hash conflict cannot advance
the conflicting head. On a finalized conflict, every participating source is checked newest-to-oldest
over the active lineage. Only unanimous historical results can select the newest surviving ancestor;
the worker then appends one invalidation and immediately re-enters materialization/extension.
Unavailable or disagreeing sources defer without majority selection. Forced real-reorg,
independent-operator and FFT terminal acceptance remain separate gates. Replay the latest accepted
state without providers through:

```text
GET /api/v1/launches/EVM/<token>/history/lifetime/heads/latest?chainId=eip155:56&platform=flap
```

Initialization scripts are intentionally idempotent where the engine supports it. Docker entrypoint
scripts run only when the data volume is first created. Apply future schema changes through explicit
migrations; do not delete a developer's volumes to simulate migration. The current non-destructive
local upgrade commands, including migrations `007` through `015`, are in
[Deployment](DEPLOYMENT.md#database-lifecycle).

## Configuration

1. Copy `.env.example` to `.env`.
2. Add provider hosts to `PROVIDER_ALLOW_HOSTS`.
3. Set only HTTPS read-only endpoints.
4. Keep optional providers blank when unavailable.

Important values:

| Variable                              | Meaning                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `API_PORT` / `WEB_PORT`               | host ports                                                                       |
| `CORS_ORIGIN`                         | comma-separated exact browser origins                                            |
| `PROVIDER_ALLOW_HOSTS`                | comma-separated exact provider hostnames                                         |
| `ALLOW_PRIVATE_PROVIDER_URLS`         | explicit local proxy/private-RPC exception; defaults to false                    |
| `PROVIDER_MAX_ATTEMPTS`               | bounded attempts per endpoint, including the first attempt                       |
| `PROVIDER_RETRY_BASE_MS/MAX_MS`       | exponential retry-delay bounds; provider `Retry-After` is capped by the maximum  |
| `PROVIDER_CIRCUIT_*`                  | consecutive-failure threshold and half-open reset delay                          |
| `PROVIDER_CACHE_TTL_MS/MAX_ENTRIES`   | process-local TTL/LRU response cache; zero TTL disables stored responses         |
| `DATA_QUALITY_MIN_SOURCES`            | minimum matching endpoint observations; integer 2-20, default 2                  |
| `ALCHEMY_API_KEY` / `ETH_RPC_URL`     | optional Alchemy key and read-only URL/template                                  |
| `EVM_*_RPC_URLS`                      | ordered, comma-separated EVM provider pools                                      |
| `EVM_*_SNAPSHOT_TAG`                  | `finalized`, `safe`, or `latest`; defaults to `finalized` per configured network |
| `EVM_*_REQUESTS_PER_SECOND`           | per-endpoint request pacing; zero disables internal pacing                       |
| `BITCOIN_ESPLORA_URLS`                | ordered Esplora base paths                                                       |
| `BITCOIN_ESPLORA_REQUESTS_PER_SECOND` | per-endpoint Esplora pacing                                                      |
| `SOLANA_RPC_URLS`                     | ordered Solana read-only RPC pool                                                |
| `SOLANA_REQUESTS_PER_SECOND`          | per-endpoint Solana pacing                                                       |
| `SOLANA_COMMITMENT`                   | processed, confirmed, or finalized; production analysis should use finalized     |
| `SQD_PORTAL_URL`                      | clean HTTP origin used by the finalized ingestion worker                         |
| `SQD_PROVIDER_ALLOW_HOSTS`            | worker-only exact hostname allowlist; defaults to `portal.sqd.dev`               |
| `SQD_REQUESTS_PER_SECOND`             | worker request pacing, capped at the public Portal policy                        |
| `SQD_MAX_RANGE_BLOCKS`                | maximum inclusive range accepted by one worker invocation                        |
| `SOURCIFY_V2_URL`                     | optional exact verified-source API base; blank keeps provenance Unknown          |
| `SOURCIFY_REQUESTS_PER_SECOND`        | bounded Sourcify request pacing                                                  |
| `FLAP_HISTORY_*`                      | Compose defaults for the bounded event-history projection worker                 |
| `BURN_PROMOTION_*`                    | Compose defaults for bounded durable ERC-20 candidate promotion                  |
| `FLAP_LIFETIME_*`                     | Compose defaults for exact point-in-time lifetime materialization                |
| `FLAP_LIFETIME_HEAD_*`                | continuous worker token, interval and optional bounded cycle count               |
| `POSTGRES_URL`                        | optional host-dev URL; configured storage is mandatory at runtime once present   |
| `TEST_POSTGRES_URL`                   | disposable initialized PostgreSQL used by the real repository integration tests  |
| `CLICKHOUSE_URL` / credentials        | Raw Fact HTTP origin and optional separately supplied credentials                |
| `OBJECT_STORE_*`                      | S3-compatible origin, credentials, and versioned raw-artifact bucket             |
| `TEST_CLICKHOUSE_URL`                 | disposable initialized ClickHouse used by storage integration tests              |
| `TEST_OBJECT_STORE_*`                 | disposable object store endpoint and credentials used by integration tests       |

`PROVIDER_ALLOW_HOSTS` does not authorize transaction methods. Method allowlists remain enforced
inside each adapter.

The shared cache never serves EVM block-tag anchors, Bitcoin tip-height/hash anchors, Solana slot or
slot-block anchors, or dynamic health heads: those calls use explicit cache bypass. The bypass does
not overwrite a normal cached value, retains in-flight deduplication within its own mode, and is
visible as `cacheBypasses` in provider diagnostics. Fixed block/slot reads may use the bounded cache.

Keep EVM snapshot tags at `finalized` for normal analysis. Selecting `safe` or `latest` is an
explicit freshness/finality tradeoff; the chosen value remains in the persisted Snapshot and
Evidence metadata.

The BSC URL list also expands `${ALCHEMY_API_KEY}`. The keyless `.env.example` endpoints are both
documented as BNB Chain-operated, so they can test endpoint agreement but the market/RV
reconciliation returns `SAME_OPERATOR`/`INCONCLUSIVE`. To test the documented independence gate,
set the key locally and use:

```dotenv
EVM_BSC_RPC_URLS=https://bnb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY},https://bsc-dataseed.bnbchain.org
```

Source IDs retain only safe hostnames. The key and URL path are not returned by the API or stored in
Evidence.

Each comma-separated provider URL creates a separate anchor observation source. The data-quality
service compares those sources at a common block/slot and requires at least
`DATA_QUALITY_MIN_SOURCES` matches. URL or hostname diversity does not prove operator independence,
so `sourceIndependence` remains Unknown until an audited source-ownership registry is implemented.

Never commit `.env` or API keys. ZeroTrace records safe source IDs such as
`ethereum-rpc@eth-mainnet.g.alchemy.com`; provider URL paths and credentials are not exposed in
health or Evidence metadata.

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

Durable-store integration tests skip unless all disposable backends are explicitly provided. A
PostgreSQL-only run is still available:

```powershell
$env:TEST_POSTGRES_URL = 'postgresql://zerotrace:zerotrace@127.0.0.1:5432/zerotrace'
npx vitest run tests/integration/postgres.test.ts
Remove-Item Env:TEST_POSTGRES_URL
```

Do not point `TEST_POSTGRES_URL` at production. Required CI creates and removes a dedicated Compose
project and volume for this suite.

The complete storage suite additionally uses `TEST_CLICKHOUSE_URL`,
`TEST_OBJECT_STORE_ENDPOINT`, `TEST_OBJECT_STORE_ACCESS_KEY`, and
`TEST_OBJECT_STORE_SECRET_KEY`. These tests create canonical test records and a versioned test
bucket; point them only at disposable initialized services. Test identities are unique per run, so
the same disposable stack can be tested repeatedly without stale rows producing false results.

Run the complete non-browser gate:

```bash
npm run verify
```

Run browser validation:

```bash
npx playwright install chromium
npm run test:e2e
```

On Windows, use the owned-process launcher if shell process-tree teardown is unreliable:

```powershell
npm run test:e2e:windows
```

It starts the built API and Vite preview on test-only ports, clears provider and durable-storage
variables for those owned processes, waits for both health endpoints, runs Playwright, and stops only
the processes it created.

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

Typed, read-only ledger queries use canonical identifiers:

```text
GET /api/v1/ledger/EVM/BLOCK/16?chainId=eip155:1
GET /api/v1/ledger/EVM/TRANSACTION/<hash>?chainId=eip155:1
GET /api/v1/ledger/BITCOIN/TRANSACTION/<txid>
GET /api/v1/ledger/BITCOIN/OUTPOINT/<txid>:<vout>
GET /api/v1/ledger/SOLANA/BLOCK/<slot>
GET /api/v1/ledger/SOLANA/TRANSACTION/<signature>
```

EVM queries require an explicit canonical `eip155:<chain-id>`. Confirmed results are bound to their
exact block/slot Snapshot. Pending, mempool, null, and unavailable observations retain distinct
knowledge states and Evidence.

The readiness endpoint may report `DEGRADED` when no provider is configured, or HTTP 503 when the
configured Evidence repository is unavailable. The no-provider state is valid for development;
`readOnly` must still be true. Inspect `storage` for the request-serving Evidence repository and
`ingestionStorage` for ClickHouse Raw Facts, PostgreSQL checkpoints, and raw artifacts. Each
historical component reports `UP`, `DOWN`, or `UNCONFIGURED`; the aggregate also distinguishes
`PARTIAL`. Inspect `dataQuality` or `GET /api/v1/data-quality/anchors` for common-position anchor
agreement, continuity, source coverage, Evidence, alerts, and its independent storage health.

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
