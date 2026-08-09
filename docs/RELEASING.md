# Release Process

ZeroTrace uses Semantic Versioning tags of the form `vMAJOR.MINOR.PATCH`. Pre-1.0 releases may
change interfaces but must still document migrations and known limitations.

## Release gate

1. Freeze the intended commit and ensure the worktree is clean.
2. Update `CHANGELOG.md` and `PROGRESS.md` with evidence-backed status.
3. Refresh source revisions, direct dependency versions, licenses, and hosted-provider terms.
4. Run:

   ```bash
   npm ci
   npm run verify
   npm run test:coverage
   npm run test:e2e
   npm run sbom
   docker compose config --quiet
   docker compose build api web postgres clickhouse
   ```

5. Run named real-chain fixtures for every capability claimed as validated.
6. Scan resolved container images, archive SBOM/license output, and review critical/high findings.
7. Verify database migrations and restore on a clean environment.
8. Have another reviewer confirm read-only method boundaries and Unknown handling.

## Tag and notes

Create an annotated immutable tag only after the gate passes:

```bash
git tag -s v0.1.0 -m "ZeroTrace v0.1.0"
git push origin v0.1.0
```

Release notes must include:

- implemented capabilities and supported ledger/platform versions;
- exact commit and image digests;
- breaking changes and migrations;
- test, coverage, real-chain, load, and security evidence;
- provider/API requirements;
- incomplete capabilities and known limitations;
- SBOM and checksums.

Never move or recreate a published tag. If an asset or note is wrong, publish a corrected patch
release and retain the original record.

## Version vocabulary

- **implemented:** code and automated tests exist;
- **validated:** named real data or environment evidence has passed;
- **production-approved:** all operational, security, data, and release gates for the declared scope
  pass;
- **experimental:** contract may change and evidence set is not sufficient for production.

A successful build or container health check may justify “implemented,” but never by itself
“validated” or “production-approved.”
