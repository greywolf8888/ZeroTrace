# User guide

Enter an Arc mainnet transaction hash or its official `https://explorer.arc.io/tx/HASH` link, then select **Read transaction**. The link is parsed locally; it is not fetched. Acquisition saves an immutable observation report. Without explicit receiving conditions, this does not establish payment against an agreement.

Select specific movements, enter the expected payee, optional movement payer, exact amount or range, and optional UTC deadline. Compare conditions to inspect PASS, FAIL, UNKNOWN and NOT_APPLICABLE with expected and actual values. Amounts use integer strings with up to 18 decimal places; Gas is separate. Select an amount, graph edge or check to inspect its raw receipt position. Full amounts remain available in the movement list when graph labels are shortened.

ArcBounty mode derives conditions from an existing supported task's fixed snapshot and attributed leg. Unknown attribution fails closed. Editing those conditions switches to user input; it does not forge protocol provenance. Old reports and financial results remain under their original rules.

Reports are append-only in the existing PostgreSQL database and have no short report TTL. Conditions create fixed versions. Equal facts and conditions retain the same report ID; separate observations may have separate bundle hashes. Only explicit **Requery chain** performs a fresh bounded chain read. Report GET, export and sharing preview do not.

Reports are private by default. Session credentials expire after seven days. Clearing cookies, expiry or loss prevents access to private ownership; account login and ownership recovery are not implemented. Export your bundle while you have access. A full sharing preview lists raw chain data, addresses, amounts, time conditions and checks, with the internal context reference removed. Confirming publication creates a public immutable version which cannot be withdrawn. Public links contain no session credentials.

Offline replay parses the exported raw receipt again, verifies the digest and recomputes the report. It does not authenticate mainnet provenance. Browser file replay stays local. Node.js 24/npm 11 standalone usage:

```text
npm ci
npm run arc:build
npx tsx examples/arc-task-ledger/replay-bundle.ts bundle.json
npx tsx examples/arc-task-ledger/reconcile.ts bundle.json local.sqlite accounting_namespace business_reference
```

The independent export also provides `arc:replay`, `arc:reconcile` and `arc:client:typecheck`. The consumer's SQLite is its own accounting namespace, not a replacement production settlement authority. MATCHED reports can allocate selected movements locally. Repeating the same business reference is idempotent; assigning the same movement to another reference is rejected. No fund movement or order fulfillment occurs.

For public API consumption the reconciliation CLI accepts `https://SITE/api#REPORT_ID`. The fragment is parsed by the client. Private API calls use a session Bearer token and CSRF value, never URL credentials or embedded admin tokens. See [API.md](API.md) for methods, units, states, quotas and failures.

Unknown, pending, provider failure, limits and conflicts are not numeric zero. Preserve input and inspect errors before retrying. Use the same idempotency key only for the same request. GET status does not restart interrupted work. Limits: two concurrent acquisitions, two RPC attempts per second, 24 RPC/8MiB/45 seconds per verification, 30 requests per owner and 200 globally per day. Existing reports remain readable when storage capacity is reached.

Deployment requires stable `ARC_CURSOR_SECRET`, read-only `ARC_DATABASE_URL` and restricted append-request `ARC_REQUEST_DATABASE_URL`. Back up and verify restoration before migration 7; reuse current free resources and do not delete the database. Read [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) before interpreting results.
