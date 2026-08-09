# Security Policy

## Supported versions

ZeroTrace is in active pre-1.0 development. Security fixes are applied only to the latest commit on
the default branch until a stable release line is published.

| Version                              | Supported |
| ------------------------------------ | --------- |
| Default branch                       | Yes       |
| Older commits and unmaintained forks | No        |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
[private vulnerability reporting](https://github.com/greywolf8888/ZeroTrace/security/advisories/new)
form and include:

- affected commit or version;
- reproduction steps and expected impact;
- whether provider credentials, private network access, data integrity, or inference correctness are
  involved;
- logs or payloads with every secret removed;
- a suggested remediation, if available.

Maintainers should acknowledge a complete report within five business days. A remediation timeline
depends on severity and reproducibility. Credit and coordinated disclosure will be discussed with the
reporter.

## Security boundaries

ZeroTrace is intentionally read-only. The core must not:

- accept, derive, persist, or log private keys or seed phrases;
- sign transactions;
- expose EVM, Bitcoin, or Solana transaction-broadcast methods;
- execute swaps, transfers, bridges, or withdrawals.

Provider credentials are server-side configuration only. They must never be embedded in browser
bundles, committed files, evidence payloads, or logs.

Provider URLs are an SSRF boundary. Changes to URL validation, DNS/IP filtering, redirect policy,
method allowlists, response limits, or precision handling require security-focused tests.

## Data and inference safety

On-chain data is public but analyst annotations, provider credentials, IP metadata, and inferred
relationships may be sensitive. Deployments must add authentication, authorization, encryption,
retention, audit, backup, and privacy controls before serving multiple users.

Entity and control conclusions are probabilistic. Unknown or unavailable input must never become a
zero, false, or confident attribution. Security reports may include integrity flaws that violate this
rule even when no conventional code-execution vulnerability exists.

## Dependency policy

Production dependencies are version-pinned and checked against the license allowlist. Dependabot,
CodeQL, npm audit review, CycloneDX SBOM generation, and container scanning are part of the intended
release gate. See [LICENSE_POLICY.md](docs/research/LICENSE_POLICY.md).
