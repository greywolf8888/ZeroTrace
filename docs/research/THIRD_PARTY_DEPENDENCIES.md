# Third-party Dependencies

Inventory date: **2026-08-11**

The current-state Snapshot, request-provenance, anchor reconciliation, 2026-08-11 BSC
operator-attestation/market-reconciliation, EIP-1898 all-block supply continuity, and EVM
ERC-1167/ERC-173/ERC-1967/Safe control-surface and Sourcify V2 exact-source work use clean HTTP
adapters, pinned `viem`, `pg`, and Node.js built-ins. Solana control-state and core instruction
decoding use the official Codama-generated System, SPL Token, Token-2022, and loader-v3 interface
packages listed below; no validator, indexer, wallet, signing, or transaction package is linked.
Safe v1.3.0 remains an LGPL-3.0-only
reference boundary with clean ABI-compatible reads; the EIP specifications are CC0 references.
Sourcify is consumed only as a hosted read API; no Sourcify server package or source is copied or
linked.
Bitcoin script and address commitment analysis uses narrow parse/hash/address subpath imports from
`bitcoinjs-lib`; ZeroTrace does not import its transaction, PSBT, key-generation, signing, or wallet
surfaces.
`@zerotrace/data-quality` is an internal workspace package reused by the platform adapter.

Direct versions are pinned in manifests or container configuration. Transitive npm components are
captured by `npm run sbom` in CycloneDX JSON and checked by `npm run license:check`.

## Runtime npm packages

| Package                      | Version | Purpose                                                               | License      | Repository                                                                                        |
| ---------------------------- | ------: | --------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| `fastify`                    |  5.11.3 | HTTP API framework                                                    | MIT          | [fastify/fastify](https://github.com/fastify/fastify)                                             |
| `@fastify/cors`              |  11.3.0 | explicit browser-origin policy                                        | MIT          | [fastify-cors](https://github.com/fastify/fastify-cors)                                           |
| `@fastify/swagger`           |   9.8.1 | OpenAPI generation                                                    | MIT          | [fastify-swagger](https://github.com/fastify/fastify-swagger)                                     |
| `@fastify/swagger-ui`        |   6.1.1 | local API documentation UI                                            | MIT          | [fastify-swagger-ui](https://github.com/fastify/fastify-swagger-ui)                               |
| `dotenv`                     |  17.4.2 | local environment loading                                             | BSD-2-Clause | [motdotla/dotenv](https://github.com/motdotla/dotenv)                                             |
| `prom-client`                |  15.1.3 | Prometheus metrics                                                    | Apache-2.0   | [siimon/prom-client](https://github.com/siimon/prom-client)                                       |
| `zod`                        |   4.4.3 | canonical runtime validation                                          | MIT          | [colinhacks/zod](https://github.com/colinhacks/zod)                                               |
| `react` / `react-dom`        |  19.2.8 | analyst UI                                                            | MIT          | [facebook/react](https://github.com/facebook/react)                                               |
| `cytoscape`                  |  3.34.0 | interactive bounded Entity investigation graph                        | MIT          | [cytoscape/cytoscape.js](https://github.com/cytoscape/cytoscape.js)                               |
| `viem`                       | 2.55.11 | EVM checksum/address normalization only                               | MIT          | [wevm/viem](https://github.com/wevm/viem)                                                         |
| `bitcoin-address-validation` |   3.0.0 | Bitcoin network/type/checksum validation                              | MIT          | [ruigomeseu/bitcoin-address-validation](https://github.com/ruigomeseu/bitcoin-address-validation) |
| `bitcoinjs-lib`              |   7.0.1 | Bitcoin script/address/hash parsing only                              | MIT          | [bitcoinjs/bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib)                             |
| `bs58`                       |   6.0.0 | lossless Solana public-key/signature decoding                         | MIT          | [cryptocoinjs/bs58](https://github.com/cryptocoinjs/bs58)                                         |
| `@solana-program/system`     |  0.13.0 | official System instruction identification and transfer-data decoding | Apache-2.0   | [solana-program/system](https://github.com/solana-program/system)                                 |
| `@solana-program/token`      |  0.15.0 | official classic SPL Token account decoders                           | Apache-2.0   | [solana-program/token](https://github.com/solana-program/token)                                   |
| `@solana-program/token-2022` |  0.14.1 | official Token-2022 base/TLV decoders                                 | Apache-2.0   | [solana-program/token-2022](https://github.com/solana-program/token-2022)                         |
| `@solana-program/loader-v3`  |   0.5.0 | official loader-v3 program identity/interface                         | MIT          | [solana-program/loader-v3](https://github.com/solana-program/loader-v3)                           |
| `pg`                         |  8.23.0 | pooled, parameterized PostgreSQL access                               | MIT          | [brianc/node-postgres](https://github.com/brianc/node-postgres)                                   |
| `@clickhouse/client`         |  1.23.1 | parameterized ClickHouse Raw Fact access                              | Apache-2.0   | [ClickHouse/clickhouse-js](https://github.com/ClickHouse/clickhouse-js)                           |
| `minio`                      |   8.0.7 | S3-compatible versioned artifact client                               | Apache-2.0   | [minio/minio-js](https://github.com/minio/minio-js)                                               |

Internal `@zerotrace/*` workspace packages are not third-party dependencies.

## Direct build, quality, and test dependencies

| Package                             |          Version | Purpose                             | License      | Repository                                                                                    |
| ----------------------------------- | ---------------: | ----------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `@cyclonedx/cyclonedx-npm`          |            6.0.0 | CycloneDX SBOM                      | Apache-2.0   | [CycloneDX/cyclonedx-node-npm](https://github.com/CycloneDX/cyclonedx-node-npm)               |
| `@eslint/js` / `eslint`             |  10.0.1 / 10.8.1 | static analysis                     | MIT          | [eslint/eslint](https://github.com/eslint/eslint)                                             |
| `typescript-eslint`                 |           8.66.0 | TypeScript ESLint rules             | MIT          | [typescript-eslint/typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) |
| `eslint-plugin-react-hooks`         |            7.1.1 | React hook correctness              | MIT          | [facebook/react](https://github.com/facebook/react)                                           |
| `globals`                           |           17.9.0 | environment globals                 | MIT          | [sindresorhus/globals](https://github.com/sindresorhus/globals)                               |
| `@playwright/test`                  |           1.62.1 | real-browser E2E                    | Apache-2.0   | [microsoft/playwright](https://github.com/microsoft/playwright)                               |
| `vitest` / `@vitest/coverage-v8`    |           4.1.10 | unit/integration tests and coverage | MIT          | [vitest-dev/vitest](https://github.com/vitest-dev/vitest)                                     |
| `typescript`                        |            6.0.3 | strict compilation                  | Apache-2.0   | [microsoft/TypeScript](https://github.com/microsoft/TypeScript)                               |
| `tsx`                               |          4.23.11 | local TypeScript execution/watch    | MIT          | [privatenumber/tsx](https://github.com/privatenumber/tsx)                                     |
| `vite` / `@vitejs/plugin-react`     |    8.2.1 / 6.0.5 | web build and dev server            | MIT          | [vitejs/vite](https://github.com/vitejs/vite)                                                 |
| `concurrently`                      |           10.0.4 | coordinated local processes         | MIT          | [open-cli-tools/concurrently](https://github.com/open-cli-tools/concurrently)                 |
| `pino-pretty`                       |           13.1.3 | development-only readable API logs  | MIT          | [pinojs/pino-pretty](https://github.com/pinojs/pino-pretty)                                   |
| `prettier`                          |            3.9.6 | deterministic formatting            | MIT          | [prettier/prettier](https://github.com/prettier/prettier)                                     |
| `license-checker-rseidelsohn`       |            5.0.1 | production license allowlist        | BSD-3-Clause | [RSeidelsohn/node-license-checker](https://github.com/RSeidelsohn/node-license-checker)       |
| `@types/node`                       |         24.10.14 | Node type declarations              | MIT          | [DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)         |
| `@types/react` / `@types/react-dom` | 19.2.18 / 19.2.4 | React type declarations             | MIT          | [DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)         |
| `@types/pg`                         |           8.21.0 | node-postgres type declarations     | MIT          | [DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)         |

## Container images

| Image                          | Pinned tag                     | Purpose                          | Upstream license                                         | Repository                                                            | Integration                                                                                    |
| ------------------------------ | ------------------------------ | -------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `node`                         | `24.11.1-alpine`               | build and API runtime            | MIT for Node.js; image has additional component licenses | [nodejs/docker-node](https://github.com/nodejs/docker-node)           | distributed base image                                                                         |
| `nginx`                        | `1.29-alpine`                  | static UI and API reverse proxy  | BSD-2-Clause                                             | [nginx/docker-nginx](https://github.com/nginx/docker-nginx)           | distributed base image                                                                         |
| `postgres`                     | `17.10-alpine`                 | relational/evidence authority    | PostgreSQL License                                       | [docker-library/postgres](https://github.com/docker-library/postgres) | separate service                                                                               |
| `clickhouse/clickhouse-server` | `26.7.3.19-alpine`             | raw facts and metric series      | Apache-2.0                                               | [ClickHouse/ClickHouse](https://github.com/ClickHouse/ClickHouse)     | separate service                                                                               |
| `valkey/valkey`                | `8.1.9-alpine`                 | cache/rate coordination          | BSD-3-Clause                                             | [valkey-io/valkey](https://github.com/valkey-io/valkey)               | separate service                                                                               |
| `nats`                         | `2.11.17-alpine`               | event bus and JetStream          | Apache-2.0                                               | [nats-io/nats-server](https://github.com/nats-io/nats-server)         | separate service                                                                               |
| `minio/minio`                  | `RELEASE.2025-09-07T16-13-09Z` | content-addressed object storage | AGPL-3.0                                                 | [minio/minio](https://github.com/minio/minio)                         | isolated local/staging sidecar; upstream repository archived 2026-04-25; no linked server code |
| `temporalio/auto-setup`        | `1.29.7`                       | optional durable workflows       | MIT                                                      | [temporalio/temporal](https://github.com/temporalio/temporal)         | `full` profile sidecar                                                                         |
| `temporalio/ui`                | `2.53.1`                       | optional workflow operator UI    | MIT                                                      | [temporalio/ui](https://github.com/temporalio/ui)                     | `full` profile sidecar                                                                         |
| `apache/age`                   | `release_PG18_1.7.0`           | optional investigation traversal | Apache-2.0                                               | [apache/age](https://github.com/apache/age)                           | derivative `graph` profile sidecar; PostgreSQL reports remain authoritative                    |

## GitHub Actions

Workflow actions are pinned to immutable commit SHAs. The adjacent comment in each workflow retains
the reviewed major tag for Dependabot updates.

| Action                       | Reviewed tag | Commit                                     | Purpose                    | License    | Repository                                                                  |
| ---------------------------- | ------------ | ------------------------------------------ | -------------------------- | ---------- | --------------------------------------------------------------------------- |
| `actions/checkout`           | `v7`         | `3d3c42e5aac5ba805825da76410c181273ba90b1` | source checkout            | MIT        | [actions/checkout](https://github.com/actions/checkout)                     |
| `actions/setup-node`         | `v7`         | `820762786026740c76f36085b0efc47a31fe5020` | Node and npm cache setup   | MIT        | [actions/setup-node](https://github.com/actions/setup-node)                 |
| `actions/upload-artifact`    | `v7`         | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | test/SBOM artifact upload  | MIT        | [actions/upload-artifact](https://github.com/actions/upload-artifact)       |
| `docker/setup-buildx-action` | `v4`         | `bb05f3f5519dd87d3ba754cc423b652a5edd6d2c` | BuildKit builder setup     | Apache-2.0 | [docker/setup-buildx-action](https://github.com/docker/setup-buildx-action) |
| `docker/build-push-action`   | `v7`         | `53b7df96c91f9c12dcc8a07bcb9ccacbed38856a` | production target builds   | Apache-2.0 | [docker/build-push-action](https://github.com/docker/build-push-action)     |
| `github/codeql-action`       | `v4`         | `5595ccaf912efad79be6eef63a5619ff05969be3` | CodeQL initialization/scan | MIT        | [github/codeql-action](https://github.com/github/codeql-action)             |

Container images carry transitive OS packages and notices. A production release must scan the
resolved image digests and archive their license/SBOM output; a tag pin alone is not a digest pin.

## Evaluated upstream integrations

The following are **not currently installed dependencies**. They were evaluated to avoid rebuilding
mature capabilities.

| Upstream                                                                    | Revision observed                                     | License                  | Intended use                             | Boundary/status                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Blockstream Esplora](https://github.com/Blockstream/esplora)               | `b9cc1aea3a6dc221b55fac6bcfd569362db1915b`            | MIT                      | Bitcoin REST/index                       | HTTP adapter implemented; self-host recommended                                             |
| [GraphSense Lib](https://github.com/graphsense/graphsense-lib)              | `c483e667d8b17e56d55459401233885784ef67bf`            | MIT                      | Bitcoin address/entity/cluster graph     | evaluated future HTTP/sidecar integration; Cassandra/Spark stack is not installed in core   |
| [GraphSense TagPacks](https://github.com/graphsense/graphsense-tagpacks)    | `921ae2ba98fe9f4050f46c80583cd4b98ced1042`            | MIT                      | address/label/source observation model   | design reference for coexisting source observations; no code or data copied                 |
| [Dune Spellbook](https://github.com/duneanalytics/spellbook)                | `9508101c34b635abdcb1423f02a71cbcabd3c8b3`            | BSL-1.1                  | community label/model review             | non-permissive reference only; future use requires an isolated adapter and data-term review |
| [DefiLlama Adapters](https://github.com/DefiLlama/DefiLlama-Adapters)       | `7953195083e5540309d45807bde25dee838a8d2d`            | no root license detected | protocol registry/adapter review         | reference only pending explicit licensing; no code or registry data copied                  |
| [Blockscout](https://github.com/blockscout/blockscout)                      | `6389e9ebe03633856d9fec6e4ae8184eb4147806`            | custom restrictive       | explorer labels and verification review  | no copying or linking; any future integration must use a clean API boundary and term review |
| [Carbon](https://github.com/sevenlabs-hq/carbon)                            | `v1.0.0` / `af70b199b39e60a1a33306e5411f8040374f8d9a` | MIT                      | Solana indexing and protocol decoders    | preferred future Rust component                                                             |
| [Anza Agave](https://github.com/anza-xyz/agave)                             | `ab6553293094e59dee7d3e7c928c7fa1023d0684`            | Apache-2.0               | Solana runtime/node                      | future node/reference                                                                       |
| [Foundry](https://github.com/foundry-rs/foundry)                            | `5b2f0422119c86fe53b98f5ad05d7e6d15a05556`            | Apache-2.0               | EVM fixtures and contract testing        | future dev dependency                                                                       |
| [Substreams](https://github.com/streamingfast/substreams)                   | `53cf084c0fbf8e7134afebd82b0a0175123b76e6`            | Apache-2.0               | multi-chain ingestion                    | evaluate sidecar                                                                            |
| [ord](https://github.com/ordinals/ord)                                      | `00d410a796af6f4d6af1e034d71604eb3e35a406`            | CC0-1.0                  | inscription/rune index semantics         | evaluate read sidecar                                                                       |
| [Hummingbot Gateway](https://github.com/hummingbot/gateway)                 | `f090f4ab7a8159b85fca2f3d4467970a5231cf5f`            | Apache-2.0               | routing/quote adapter patterns           | quote-only evaluation; trading forbidden                                                    |
| [SQD Portal](https://github.com/subsquid/sqd-portal)                        | `46bd604fc55a34e12625f8448b413a7d8d485b8d`            | AGPL-3.0                 | finalized EVM/Bitcoin/Solana raw history | clean HTTP adapter only; no package/server code linked                                      |
| `@subsquid/evm-stream@portal-api`                                           | `0.0.1-portal-api.d5861e`                             | GPL-3.0-or-later         | Portal EVM streaming client              | rejected from core; clean HTTP implemented                                                  |
| `@subsquid/solana-stream@portal-api`                                        | `1.0.0-portal-api.d5861e`                             | GPL-3.0-or-later         | Portal Solana streaming client           | rejected from core; clean HTTP implemented                                                  |
| `@subsquid/batch-processor@portal-api`                                      | `0.2.0-portal-api.d5861e`                             | GPL-3.0-or-later         | Portal batch processing                  | rejected from core; clean HTTP implemented                                                  |
| [Yellowstone gRPC](https://github.com/rpcpool/yellowstone-grpc)             | `f402c411887e360d4002e52254244cfea167b070`            | AGPL-3.0                 | Solana live ingestion                    | isolated service with obligations                                                           |
| [Yellowstone Old Faithful](https://github.com/rpcpool/yellowstone-faithful) | `a69a0d2e189006608e3b73b7659a957b00b3567e`            | AGPL-3.0                 | Solana archive                           | remote/isolated service                                                                     |
| [Raydium SDK V2](https://github.com/raydium-io/raydium-sdk-V2)              | `bf78fdd96e8aab348bf7863f686647f0d8dc512f`            | GPL-3.0                  | LaunchLab/AMM semantics                  | no linking/copying into core; isolate or clean adapter                                      |
| [Squads v4](https://github.com/Squads-Protocol/v4)                          | `c34015c9bf497349767c9855aeff738c9d568451`            | AGPL-3.0                 | multisig semantics                       | IDL/on-chain facts or isolated service                                                      |
| [Pump public docs](https://github.com/pump-fun/pump-public-docs)            | `9c82f61cb711b044a17f770ab8ce9f9bdf78f333`            | no detected license      | official IDLs/docs                       | reference only pending license clarification                                                |
| [Meteora DBC](https://github.com/MeteoraAg/dynamic-bonding-curve)           | `3b540e94b5b20ba37733de6e25f58522a0cd8961`            | NOASSERTION              | DBC program/SDK semantics                | reference only pending license clarification                                                |
| [FlapVaultExample](https://github.com/flap-sh/FlapVaultExample)             | `0a6ad1b71cecf0051b1f3a239e719d2f77989e26`            | MIT                      | official Portal inspection interfaces    | clean ABI-compatible read adapter; no upstream code copied                                  |
| [PancakeSwap V2 core](https://github.com/pancakeswap/pancake-swap-core)     | `3b214306770e86bc3a64e67c2b5bdb566b4e94a7`            | GPL-3.0                  | official factory/pair reference          | reference only; clean ABI/math implementation, no copied or linked code                     |
| [Safe Smart Account](https://github.com/safe-fndn/safe-smart-account)       | `v1.3.0` / `186a21a74b327f17fc41217a927dea7064f74604` | LGPL-3.0-only            | multisig proxy and custody semantics     | reference only; clean ABI-compatible reads, no linking or copied code                       |
| [Sourcify](https://github.com/ethereum/sourcify)                            | hosted API V2 observed 2026-08-11                     | MIT                      | exact verified-source metadata           | clean bounded HTTPS adapter only; no server package or source linked                        |

Hosted APIs and official documentation are recorded in
[VERIFIED_SOURCES.md](VERIFIED_SOURCES.md). Their network terms and quotas require a fresh review
before production use.
