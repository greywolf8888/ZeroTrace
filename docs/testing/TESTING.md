# Testing and Verification

## Test layers

| Layer       | Command                         | Purpose                                                       |
| ----------- | ------------------------------- | ------------------------------------------------------------- |
| Format      | `npm run format:check`          | deterministic repository formatting                           |
| Lint        | `npm run lint`                  | static correctness and hook rules                             |
| Type        | `npm run typecheck`             | strict project-reference compilation                          |
| Unit        | `npm run test:unit`             | canonical contracts and deterministic domain logic            |
| Integration | `npm run test:integration`      | API contracts plus opt-in PostgreSQL/ClickHouse/object stores |
| Coverage    | `npm run test:coverage`         | line/function/statement 80%, branch 75% gate                  |
| Build       | `npm run build`                 | production package/API/web output                             |
| E2E         | `npm run test:e2e`              | built app in real Chromium at desktop and mobile widths       |
| License     | `npm run license:check`         | production npm allowlist                                      |
| Audit       | `npm run audit`                 | high-severity full dependency graph gate                      |
| SBOM        | `npm run sbom`                  | CycloneDX dependency inventory                                |
| Compose     | `docker compose config --quiet` | resolved topology validation                                  |
| Runtime     | `npm run health`                | live/ready HTTP and read-only invariant                       |

## Required safety cases

- EVM `eth_sendRawTransaction` is rejected before network access.
- Solana `sendTransaction` is rejected before network access.
- URL credentials, unapproved hosts, private/reserved destinations, redirects, traversal, oversized
  responses, and timeouts fail closed.
- retries are bounded, `Retry-After` is capped, pacing is deterministic, expired cache entries are
  missed, circuits recover through half-open, and failover remains on the last healthy endpoint.
- dynamic ledger anchors bypass stored TTL entries without overwriting normal cached values, and
  diagnostics count the bypasses;
- each concurrent/failover response retains the endpoint that actually produced it; Snapshot
  providers, Evidence source, and metadata source sets include all anchor/state endpoints;
- Evidence IDs change when source, locator, block/slot, or observation time changes even when the
  payload hash is identical.
- Evidence IDs include the normalized derivation-edge set; inferred Evidence without a source is
  rejected in memory, in the repository, and by PostgreSQL.
- Snapshot-bound sources are incompatible when their complete Snapshot differs, even at the same
  block/slot.
- EVM Snapshot tags are explicit and provider quantities/data must be canonical; Bitcoin resolves
  the best-chain hash from the observed height; Solana uses `getBlock` for the selected slot and
  rejects missing blocks or account contexts older than that slot.
- EVM, Bitcoin, and Solana anchor parent identities must match their replay Snapshots; malformed or
  cross-linked parent data is rejected before reconciliation.
- typed transaction reads reject malformed identity, placement, quantity, receipt, status, log,
  signature, output, and outspend fields before any result is constructed;
- confirmed ledger records must match their position-pinned block/slot Snapshot; pending EVM and
  Bitcoin mempool observations are bound to a captured head, and null EVM/Solana results retain raw
  provider Evidence plus an evidenced, ambiguous negative observation;
- endpoint heads are lowered to one common position before comparison, so ordinary head skew cannot
  become disagreement; two matching endpoints are required and source independence remains Unknown.
- conflicting same-position anchors produce no canonical winner and create an Evidence-linked
  `CROSS_SOURCE_DISAGREEMENT` alert; a failed source remains unavailable, not a zero or agreement.
- continuity tests cover first observation, unchanged/direct extension, historical gap verification,
  same-position replacement, source regression, unavailable checks, and in-flight deduplication.
- Solana account quantities remain lossless decimal strings. Only explicit `value: null` means a
  Known non-existent account; missing or malformed values never become zero.
- PostgreSQL writes are transactional and idempotent; Evidence, Snapshot, and derivation edges remain
  immutable and drill down after a repository restart.
- PostgreSQL anchor observations and Data Quality Alerts are append-only, restart-readable, and
  idempotent; an alert without an existing Evidence edge is rejected transactionally.
- finalized ingestion stores the raw artifact before Evidence/Raw Fact, advances checkpoints only
  after durable writes, resumes monotonically, and makes terminal replay a no-op;
- semantic-scan checkpoints hash-verify JSON state, retain cumulative Evidence IDs, reject stale or
  oversized cursor advances and coverage gaps, resume after repository restart, and prohibit
  terminal mutation or deletion in PostgreSQL;
- transaction-profile ingestion validates EVM hash, Bitcoin txid, and Solana signature identities,
  rejects duplicate/malformed records, and writes every transaction before advancing its block;
- ledger-record ingestion validates EVM log, trace-address and changed-state identities; Bitcoin
  coinbase/outpoint positions; and Solana instruction/log/account/reward identities, including
  one-sided token-balance nulls. It rejects duplicate/malformed records and writes all applicable raw
  records before advancing its block;
- header-only runs preserve applicable table coverage as `NOT_QUERIED`/null, distinguish
  `NOT_APPLICABLE`, and only let an explicitly materialized provider-empty table report zero;
- Solana skipped-slot empty streams advance only with a finalized-head coverage proof;
- raw artifacts are content-addressed, read-after-write verified, and kept in a versioned bucket;
- ClickHouse Raw Fact writes are idempotent and preserve Evidence/artifact provenance;
- integers above `Number.MAX_SAFE_INTEGER` remain exact strings.
- invalid EVM/Bitcoin/Solana checksums or structure do not become a valid address.
- no-evidence entity input remains Unknown.
- common services and CoinJoin suppress controller confidence.
- sell-disabled RV is unavailable rather than zero.
- exit-race simulations are deterministic for the same seed.
- incomplete API domains return HTTP 501 and typed Unknown.
- typed discrepancy audits require same-Snapshot Evidence, use exact-decimal class budgets, keep
  insufficient coverage and Unknown outside numeric denominators, and refuse to score independent
  quote/RV comparisons unless source independence is positively verified;
- UI displays Unknown and read-only state without placeholder data.

## Real-chain fixture rules

Every fixture must record:

- ledger/network and canonical identifier;
- block hash/height/slot and finality/commitment;
- provider and capture time;
- raw response hash;
- expected normalized facts;
- independent source or authoritative decoder used for reconciliation;
- reason the fixture covers a production behavior or edge case.

Do not make public tests depend on a floating chain head. Capture immutable evidence where provider
terms permit it. Credentialed smoke tests must be opt-in and skip with a visible reason when secrets
are absent.

`tests/integration/postgres.test.ts` requires explicit `TEST_POSTGRES_URL`.
`tests/integration/ingestion-storage.test.ts` additionally requires `TEST_CLICKHOUSE_URL`,
`TEST_OBJECT_STORE_ENDPOINT`, `TEST_OBJECT_STORE_ACCESS_KEY`, and
`TEST_OBJECT_STORE_SECRET_KEY`. Use only initialized disposable services. CI builds the repository's
database targets, waits for PostgreSQL/ClickHouse/MinIO readiness, runs the suites under the coverage
gate, and destroys the named test volumes afterward. Per-run identities make repeated execution
against the same disposable stack safe; production targets remain forbidden.

## Browser tests

Playwright starts the built API and Vite preview servers. The E2E suite covers:

- read-only and capability truth on first load;
- explicit Unknown metric rendering;
- valid EVM identifier classification without a provider;
- scenario gating;
- data-health navigation and explicit Evidence plus three-backend ingestion-storage states;
- typed Solana transaction rendering with Snapshot, Evidence, and humanized field names;
- Flap fixed-block state, transaction-local creation/default provenance, bounded range/lifetime
  history coverage, sell preview, Unknown preservation and Evidence rendering;
- anchor-reconciliation status, common-position/operator-independence explanation, four configured
  chain targets, and process-local data-quality storage truth;
- mobile viewport layout;
- containment of primary panels within the mobile viewport.

CI-owned Playwright servers never reuse an already-listening process. On Windows,
`npm run test:e2e:windows` starts and health-checks test-only API/web processes itself, then Playwright
reuses only those endpoints and the wrapper stops only its owned process IDs. Both paths clear
provider and durable-storage runtime variables for the API process, so a developer's provider key,
database, or unrelated process cannot silently contaminate browser acceptance.

Install Chromium once with `npx playwright install chromium`. Test artifacts stay under
`output/playwright` and are not production fixtures.

## Updating the progress record

Update [PROGRESS.md](../../PROGRESS.md) only after the command has run in the current checkout.
Record counts, pass/fail, and any external blocker. Do not convert a skipped credentialed test into a
pass.
