# Contributing to ZeroTrace

Thank you for improving ZeroTrace. Contributions are evaluated against evidence quality,
reproducibility, read-only safety, and the terminal architecture—not only whether a happy-path demo
runs.

## Before changing code

1. Read [AGENTS.md](AGENTS.md), the [architecture](docs/architecture/ARCHITECTURE.md), and
   [PROGRESS.md](PROGRESS.md).
2. Check existing adapters and recorded upstream projects before adding a new implementation.
3. For substantial protocol or inference work, open an issue describing source deployments,
   version/time boundaries, evidence fixtures, failure states, and license.
4. Never include secrets, private keys, seed phrases, real transaction execution, or production
   mock data.

## Local setup

```bash
cp .env.example .env
npm ci
npm run verify
```

For browser and container validation:

```bash
npx playwright install chromium
npm run test:e2e
docker compose config --quiet
docker compose up --build
```

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for Windows and Unix shell equivalents.

## Change requirements

### Chain or platform adapter

- prefer official APIs, ABIs, IDLs, SDKs, or a mature audited upstream;
- record repository, immutable revision/version, purpose, license, and integration boundary in
  [THIRD_PARTY_DEPENDENCIES.md](docs/research/THIRD_PARTY_DEPENDENCIES.md);
- make deployment and protocol versions explicit;
- include named real-chain fixtures, expected finality, and at least one adverse/failure fixture;
- use the shared hardened transport and an explicit read-method allowlist;
- represent missing provider capability as unavailable, never empty success.

### Evidence or inference

- attach evidence IDs to every material output;
- preserve source snapshot, coverage, freshness, confidence, and model version;
- keep raw observations separate from derived conclusions;
- add counterexamples for service hubs, CoinJoin/mixers, routers, relayers, bots, and common
  infrastructure where applicable;
- make deterministic computation reproducible from parameters and seed.

### UI

- render Unknown/unavailable explicitly;
- preserve evidence drilldown and provider/freshness state;
- do not manufacture chart points, counters, labels, or confidence values;
- cover desktop and mobile behavior with Playwright.

## Quality gate

Run the smallest relevant test after each module change and the complete gate before opening a pull
request:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run test:e2e
npm run license:check
npm run audit
npm run sbom
```

If a check cannot run, document the exact blocker and do not mark it passed. Tests that require paid
or credentialed providers belong behind explicit opt-in environment flags.

## Commits and pull requests

Use focused commits with an imperative subject, for example
`feat(evidence): persist derivation edges`. Pull requests should explain:

- the problem and architectural boundary;
- source/evidence and license decisions;
- test results;
- real-chain validation performed or still required;
- migration, security, and rollback impact;
- changes to [PROGRESS.md](PROGRESS.md).

Do not combine unrelated cleanup with a protocol or inference change.

`main` is the only long-lived branch. Use one short-lived `agent/*` branch for an active delivery
batch, squash-merge it through the protected checks, and delete it after merge. Do not create
GitFlow, environment, or routine release branches. GitHub Releases are reserved for planned product
milestones under [the release policy](docs/RELEASING.md).
