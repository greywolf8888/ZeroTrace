## Outcome

<!-- What behavior or engineering truth changes? -->

## Architecture and scope

- Master Prompt / architecture boundary:
- Explicitly out of scope:
- Existing upstream capability reused:

## Evidence and data semantics

- Evidence IDs / fixtures added:
- Snapshot and finality behavior:
- Unknown / unavailable behavior:
- Model or decoder version:

## Read-only security

- [ ] No private-key, seed, signing, swap execution, or transaction-broadcast path was added
- [ ] Provider URL/method changes fail closed and have security tests
- [ ] Secrets and full credential-bearing URLs are absent from code, logs, fixtures, and screenshots

## Dependencies and license

- New or changed dependency:
- Version or immutable revision:
- License and integration boundary:
- [ ] THIRD_PARTY_DEPENDENCIES.md and SBOM impact reviewed

## Verification

- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] `npm run test:e2e` when UI/API behavior changed
- [ ] `npm run license:check`
- [ ] `npm run audit`
- [ ] Docker/Compose check when runtime or infrastructure changed

Real-chain identifiers and snapshot anchors tested:

Checks not run and exact reason:

## Operational impact

- Migration:
- Rollback/roll-forward:
- Provider/API key requirement:
- Observability:

## Progress truth

- [ ] `PROGRESS.md` and `CHANGELOG.md` reflect the actual state
- [ ] Incomplete work remains marked incomplete or returns an explicit unavailable response
