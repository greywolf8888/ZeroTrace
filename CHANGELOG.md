# Changelog

All notable changes to ZeroTrace will be documented here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once releases begin.

## [Unreleased]

### Added

- runnable npm workspace for API, web, and domain packages;
- canonical multi-ledger snapshot, knowledge, evidence, entity, control, launch, and RV schemas;
- checksum-aware EVM, Bitcoin, and Solana identifier parsing;
- hardened read-only provider transport and current-state adapters;
- immutable process-local evidence graph;
- deterministic entity-evidence baseline, constant-product quote, and exit-race simulation;
- Fastify API with OpenAPI, health, capability truth, metrics, and analysis endpoints;
- responsive React analyst workspace with explicit Unknown states;
- supplied company icon integrated into the GitHub README, web header, hero, and favicon;
- PostgreSQL and ClickHouse initialization schemas;
- Docker Compose topology and multi-stage production images;
- database initialization images that work from Windows Unicode workspace paths;
- repository governance, dependency policy, CI, test, deployment, and release documentation.

### Security

- explicit rejection of EVM and Solana broadcast methods;
- provider URL allowlist, SSRF defenses, redirect denial, bounded responses, timeout/rate controls,
  and unsafe-integer preservation;
- read-only product boundary documented across API, UI, tests, and security policy.
- evidence/snapshot grounding enforced before entity, RV, or scenario derivation.
- immutable-SHA GitHub Actions, production dependency audit, and pruned API runtime image.

### Known limitations

- evidence storage is process-local;
- historical ingestion and protocol-specific launchpad/market decoders are not implemented;
- entity resolution is an uncalibrated baseline;
- public Bitcoin/Solana current-state smoke checks pass; dedicated/archive EVM, load, reorg,
  provider-reconciliation, and production deployment validation remain open.

[Unreleased]: https://github.com/greywolf8888/ZeroTrace/commits/main
