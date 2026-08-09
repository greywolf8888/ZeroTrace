# Dependency and License Policy

ZeroTrace core is Apache-2.0. Dependencies and upstream integrations are admitted deliberately.

## Rules

1. Record direct packages, containers, SDKs, sidecars, source repositories, version or immutable
   revision, purpose, license, and integration mode.
2. Pin direct runtime and build dependencies. Do not use floating container tags such as
   `latest`.
3. Apache-2.0, MIT, BSD, ISC, CC0, 0BSD, BlueOak, and compatible permissive dependencies may be
   linked into the core after automated and manual review.
4. Copyleft dependencies are not copied or linked into the Apache core without explicit legal
   review. When technically and legally appropriate, isolate them as separately deployed sidecars
   with their own notices and source obligations.
5. A repository with no asserted or detectable license is reference-only until the owner clarifies
   reuse rights.
6. Official documentation, ABI, or IDL facts may guide an independent adapter, but copied source or
   generated artifacts still require license review and attribution.
7. Optional services are not automatically distribution-safe merely because they run in another
   container. Release owners must review the actual distribution model.
8. Every release regenerates a CycloneDX SBOM and runs the production license allowlist check.

## Required review for a new adapter

- upstream repository and canonical documentation;
- immutable tag and commit SHA;
- SPDX license and included notices;
- copied, linked, generated, sidecar, or remote-API boundary;
- known network/API terms;
- update and vulnerability strategy;
- real-chain fixture provenance.

The current review ledger is
[THIRD_PARTY_DEPENDENCIES.md](THIRD_PARTY_DEPENDENCIES.md). Automated output supplements that file;
it does not replace manual review.
