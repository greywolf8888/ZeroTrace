# API Guide

- Base path: `/api/v1`
- OpenAPI UI: `/docs`

The initial API has no authentication and is suitable only for local/staging use.

## System endpoints

| Method | Path                                 | Behavior                                                             |
| ------ | ------------------------------------ | -------------------------------------------------------------------- |
| GET    | `/health/live`                       | process liveness and read-only invariant                             |
| GET    | `/health/ready`                      | provider- and configured-request-storage-aware readiness             |
| GET    | `/health`                            | full provider, Evidence, ingestion-store, and data-quality state     |
| GET    | `/metrics`                           | Prometheus text exposition                                           |
| GET    | `/api/v1/capabilities`               | implemented, provider-required, and forbidden capabilities           |
| GET    | `/api/v1/chains`                     | configured chain adapters                                            |
| GET    | `/api/v1/platforms`                  | platform role and implementation truth                               |
| GET    | `/api/v1/data-quality/anchors`       | endpoint anchor reconciliation, continuity, coverage, and alert data |
| POST   | `/api/v1/data-quality/discrepancies` | Evidence-grounded typed same-Snapshot comparisons                    |

## Implemented intelligence endpoints

| Method | Path                                                          | Notes                                                            |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/v1/search?q=...`                                        | local identifier classification; optional `ledger` and `chainId` |
| GET    | `/api/v1/subjects/:ledger/:id`                                | snapshot-pinned current state; Bitcoin includes bracketed UTXOs  |
| GET    | `/api/v1/ledger/:ledger/:type/:id`                            | typed block/transaction or Bitcoin script-aware outpoint query   |
| GET    | `/api/v1/ledger/SOLANA/TRANSACTION/:signature/reports/latest` | latest provider-free immutable Solana semantic report replay     |
| GET    | `/api/v1/ledger/SOLANA/TRANSACTION/:signature/reports/:id`    | exact content-addressed Solana semantic report replay            |
| GET    | `/api/v1/launches/EVM/:token`                                 | version-pinned Flap BSC current Portal-state inspection          |
| GET    | `/api/v1/launches/EVM/:token/events/:transactionHash`         | exact-receipt Flap creation/configuration/migration decoding     |
| GET    | `/api/v1/launches/EVM/:token/history`                         | bounded Flap Portal log discovery with exact receipt replay      |
| GET    | `/api/v1/launches/EVM/:token/history/projections/:id`         | provider-free paginated replay of immutable stored segments      |
| GET    | `/api/v1/launches/EVM/:token/origin`                          | bounded Flap creation-trace and exact receipt origin proof       |
| GET    | `/api/v1/claims/EVM/:token/addresses/:address/reports/latest` | latest immutable EVM Claim Report; provider-free replay          |
| GET    | `/api/v1/claims/EVM/:token/addresses/:address/reports/:id`    | exact content-addressed EVM Claim Report replay                  |
| POST   | `/api/v1/claims/declarations/parse`                           | compile public wording into Evidence-bound human-review drafts   |
| POST   | `/api/v1/claims/EVM/:token/pension-candidates`                | finalized BSC share-unit/depositor behavior discovery            |
| GET    | `/api/v1/claims/EVM/:token/pension-candidates/reports/latest` | latest provider-free immutable behavior report replay            |
| GET    | `/api/v1/claims/EVM/:token/pension-candidates/reports/:id`    | exact content-addressed behavior report replay                   |
| POST   | `/api/v1/claims/EVM/:token/burn-candidates`                   | finalized BSC zero-address Transfer candidate-range discovery    |
| POST   | `/api/v1/claims/EVM/:token/burn-conservation`                 | exact-block ERC-20 supply/mint/burn conservation certificate     |
| GET    | `/api/v1/claims/EVM/:token/burn-promotions/:id`               | provider-free durable candidate-promotion replay                 |
| GET    | `/api/v1/claims/EVM/:token/supply-continuity/:id`             | provider-free all-block supply-continuity replay                 |
| POST   | `/api/v1/rv/flap-sell`                                        | fixed-block read-only Flap Portal `previewSell` quote            |
| POST   | `/api/v1/rv/flap-pancake-v2-buy-scenarios`                    | migrated Flap Pancake V2 spot and multi-size buy model           |
| POST   | `/api/v1/rv/flap-pancake-v2-pension-entry-scenarios`          | durable candidate-bound pension entry/share economics            |
| POST   | `/api/v1/rv/flap-pancake-v2-sell-scenarios`                   | migrated Flap Pancake V2 nominal/gross/tax exit-size model       |
| POST   | `/api/v1/rv/flap-pancake-v2-reconciliation`                   | common-block multi-source market and RV discrepancy certificate  |
| POST   | `/api/v1/data-quality/discrepancies`                          | typed error-budget and discrepancy audit                         |
| GET    | `/api/v1/evidence/:id`                                        | Evidence node, source edges, and bound Snapshot                  |
| GET    | `/api/v1/evidence/:id/drilldown`                              | restart-safe derived/source Evidence traversal                   |
| POST   | `/api/v1/entities/resolve`                                    | deterministic evidence-feature baseline                          |
| POST   | `/api/v1/rv/constant-product`                                 | exact-integer pool exit quote                                    |
| POST   | `/api/v1/scenarios/exit-race`                                 | seeded shared-pool exit ordering                                 |

Current-state subject reads establish a ledger-specific anchor before reading the subject:

- EVM calls `eth_getBlockByNumber` with the configured `finalized`, `safe`, or `latest` tag, then
  reads balance and code at that exact numeric block. The selected finality is part of the Snapshot.
- Bitcoin brackets address aggregates plus `/address/:address/utxo` between two identical
  height/hash anchors. The response reconciles aggregate net value against the complete observed
  UTXO set and carries `BRACKETED_BEST_CHAIN_TIP_WITH_MEMPOOL_DIGEST`; a changing tip fails the
  request and a value conflict remains `Unknown(CONFLICTING_SOURCES)`. This is still a current
  Esplora observation, not archive/Core reconciliation.
- Solana reads the configured commitment slot, obtains that slot's blockhash with `getBlock`, and
  requires `getAccountInfo.context.slot` to be at least the Snapshot slot.

Solana's explicit `value: null` is a Known non-existent account. A missing, stale, malformed, or
provider-failed response remains Unknown/unavailable and is never converted to a zero balance.

### Claim declaration review

`POST /api/v1/claims/declarations/parse` accepts an EVM `chainId`, chain-bound ERC-20 `assetId`, the
original public statement, an optional source URI, and an optional exact ISO 8601 audit window with
timezone. The server records the text as `ANALYST_OBSERVATION` Evidence and returns deterministic
drafts for supported tax, treasury, burn, liquidity, pension and dividend roles.

Percentages are represented as exact basis points. Pension wording such as `100w` or `100万` is a
human token count and is not converted to atomic units until verified token decimals are available.
Missing wallet addresses, exact dates or allocation values remain typed Unknown; a month/day without
a year and timezone produces a warning. Every draft has `requiresHumanReview: true`. This endpoint
does not assert that a declaration is true, perform chain verification, promote a draft to an audit
rule, or initiate any transaction.

### ERC-20 burn candidate discovery

`POST /api/v1/claims/EVM/:token/burn-candidates` accepts BSC `chainId=eip155:56`, ordered
`fromBlock`/`toBlock`, and optional bounded request/transfer/candidate limits. The range may contain
at most 5,000,000 blocks and must end at the finalized Snapshot fetched from BSC RPC. The current
implementation requires the configured SQD `binance-mainnet` reader and uses sparse, finalized,
address/topic-filtered ranges of at most 1,000,000 blocks per query.

The discovery reads only non-zero ERC-20 `Transfer` events whose sender or destination is the zero
address. It groups `to=0x0` events by finalized block, retains same-block mint-event totals, and
persists every range query, returned log, and terminal result as Evidence. `CANDIDATES_DISCOVERED`
means the listed blocks need the exact-block endpoint below; `NO_EVENT_CANDIDATES` means the
complete event query returned none.

This endpoint never turns an empty event result into proof that supply was unchanged. Custom or
silent storage-level supply changes are returned as `Unknown(NOT_QUERIED)`. It does not perform
candidate promotion inside the synchronous request, all-block `totalSupply` scanning, attribution,
signing, swaps or transaction broadcast. The durable worker and replay route below compose the
event candidates with exact-block certificates without weakening that boundary.

### Pension-vault behavioral candidate discovery

`POST /api/v1/claims/EVM/:token/pension-candidates` accepts BSC `chainId=eip155:56`, an ordered
finalized range of at most 5,000,000 blocks, and a required versioned policy:
`shareUnitAtomic`, `minimumExactUnitDeposits`, `minimumUniqueExactUnitDepositors`, and
`maximumCandidates`. No protocol or community threshold is silently hard-coded. Optional bounded
SQD request/transfer limits are operational guards, not classification rules.

The endpoint scans the complete token-wide ERC-20 `Transfer` surface from SQD, persists every query
and returned log, and derives a candidate only when one address receives enough exact share-unit
deposits from enough unique senders. Mint, burn, zero-amount, and self-transfer records do not count
as behavioral deposits. Exact-multiple, non-multiple, outflow, time, counterparty, atomic amount,
whole-share, and Evidence metrics remain separately visible; exceeding the candidate ceiling fails
instead of silently truncating the result.

This is behavioral screening, not official attribution. Every candidate must return
`roleAttribution`, `participantExitPolicy`, and `dividendExecution` as typed Unknown. Neither a
repeated 1,000,000-token deposit pattern nor subsequent outflow proves “养老钱包”, membership,
no-exit enforcement, weekly dividends, controller identity, or payout funding source.

Live discovery requires durable PostgreSQL Evidence and report storage. Migration
`016_evm_pension_candidate_reports` stores `pcr_...` content-addressed reports and validates the
finalized Snapshot, canonical report/source/Evidence sets, candidate-to-transfer derivation edges,
terminal Evidence root, model version, and result hash before insert; update and delete are
forbidden. The latest and exact-ID GET routes read PostgreSQL only, perform no RPC/SQD call, and
return `404` for a token/report mismatch rather than substituting an empty candidate set.

### Durable ERC-20 burn promotion replay

`GET /api/v1/claims/EVM/:token/burn-promotions/:scanId` reads one semantic checkpoint from
PostgreSQL and performs no RPC or SQD request. The token, BSC chain, SQD source, segment cursor,
finalized Snapshots, terminal Evidence identities, aggregate counts and complete result Schema are
revalidated on every replay. An identity mismatch is `404`; missing storage is `503`; corrupt state
fails closed as an invalid provider-shaped result instead of being rendered as completion.

A running scan returns exact requested-range progress and `terminalResult: null`. A terminal scan
returns every discovery segment and its exact-block `VERIFIED` or `CONTRADICTED` certificates.
Contradicted candidates create no burn action. The terminal coverage scope is explicitly
`ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION`; silent/custom supply
changes stay `Unknown(NOT_QUERIED)` even when the candidate count is known zero.

### ERC-20 burn conservation

`POST /api/v1/claims/EVM/:token/burn-conservation` accepts `chainId`, a positive finalized
`blockNumber`, and an optional bounded `maxTransfers`. It captures the exact block and parent
lineage, reads `totalSupply` at both adjacent blocks, and requests every ERC-20 `Transfer` log from
the target block. Parent supply, target supply, the complete log query, every candidate mint/burn
log and the terminal derivation are persisted as a replayable Evidence graph.

The result is `VERIFIED` only when `supplyBefore + minted - burned = supplyAfter` and at least one
non-zero transfer to the zero address exists. Each verified transfer maps one-to-one to a generated
`BURN` action. A zero-address event with unchanged supply is `CONTRADICTED` and creates no action; an
exactly conserved block with no burn is `NOT_APPLICABLE`, not a missing value or a fabricated zero
conclusion. Cross-block logs, incomplete queries, malformed supply responses, non-adjacent lineage,
zero-to-zero events and unfinalized Snapshots fail closed.

This certificate covers one block only. Candidate blocks can be found through the event-only range
endpoint above, but it does not establish who controls an address or classify a transfer into an EOA,
Safe, treasury, pension or publicity-named “burn wallet” as irreversible. The endpoint is strictly
read-only and requires a configured EVM provider with parent-block state availability.

### ERC-20 supply continuity replay

`GET /api/v1/claims/EVM/:token/supply-continuity/:scanId` reads a completed or running semantic
checkpoint from PostgreSQL and performs no RPC or SQD request. It validates the BSC scan type,
canonical token, exact range, cursor, schema and Evidence identity on every request. A missing or
wrong-token scan is `404`; unavailable durable storage is `503`; corrupt terminal state fails closed.

A terminal result reports exact transition/sample counts, initial/final supply, signed net delta,
all supply-change certificates, source-operator attestations, coverage, freshness, Snapshot, model
version and Evidence IDs. `VERIFIED_NO_CHANGE` and `VERIFIED_EVENT_CONSERVED_CHANGES` require at
least two officially registered independent RPC operators. Agreement from the same operator or an
unregistered host is `INCONCLUSIVE_SOURCE_INDEPENDENCE`; an event-unexplained state transition is
`UNEXPLAINED_SUPPLY_CHANGE`. No state is converted to zero. This endpoint cannot start a scan or
perform any chain write, and the conclusion never extends outside the stored requested range.

### EVM Claim Report replay

`GET /api/v1/claims/EVM/:token/addresses/:address/reports/latest?chainId=eip155:56` returns the
newest immutable report for one canonical token and subject address. Replace `latest` with a stable
`ecr_...` report ID to replay that exact content-addressed result. Both routes read PostgreSQL only;
they perform no RPC or SQD request and cannot initiate capture or any chain write.

Every returned report is revalidated against its canonical hash, finalized timestamped Snapshot,
terminal and nested Evidence IDs, source set, coverage, freshness, model version and confidence.
Custody and flow must use the same Snapshot. Observed inflow/outflow remain atomic-unit lower bounds;
coverage-incomplete Actual values remain typed Unknown. Counterparties and outflows do not prove a
dividend, burn, controller, owner, withdrawal right or terminal action. Unconfigured storage returns
`503`; an absent or identity-mismatched report returns `404` rather than a synthetic zero.

### Control-surface inspection and replay

- `POST /api/v1/control-rights/EVM/:subject/inspect`
- `GET /api/v1/control-rights/EVM/:subject/reports/latest?chainId=eip155:56`
- `GET /api/v1/control-rights/EVM/:subject/reports/:reportId?chainId=eip155:56`
- `GET /api/v1/control-rights?ledger=EVM&chainId=eip155:56&subject=:subject`
- `POST /api/v1/control-rights/SOLANA/:subject/inspect`
- `GET /api/v1/control-rights/SOLANA/:subject/reports/latest?chainId=solana:mainnet`
- `GET /api/v1/control-rights/SOLANA/:subject/reports/:reportId?chainId=solana:mainnet`
- `GET /api/v1/control-rights?ledger=SOLANA&chainId=solana:mainnet&subject=:subject`

#### EVM

The inspection request body requires `chainId` and accepts an optional decimal `blockNumber`.
Inspection requires a configured finalized EVM provider and durable PostgreSQL Evidence/report
storage. Every configured source independently reads the same canonical block hash through
EIP-1898 before any result is accepted.

The current standard surface performs exact ERC-1167 runtime-bytecode detection, reads the three
EIP-1967 implementation/admin/beacon slots, calls ERC-173 `owner()`, and reads owners/threshold for
strictly registered Safe singleton versions. It resolves the runtime logic target and reads its code
at the same canonical block. With `SOURCIFY_V2_URL` configured, exact source metadata is accepted
only when the returned runtime bytecode equals the RPC logic bytecode. V1.1 emits a fixed 25-domain
coverage matrix and separately lists verified ABI mutation declarations. A declaration does not
establish its current controller or execution reachability. Effective custom authorization,
mint/burn roles, taxes, blacklist/whitelist, trading switches, limits, routers, treasuries, LP
control, Safe modules/guard/fallback handler, controller recursion, and historical validity remain
typed Unknown until separately decoded; zero-valued `owner()` therefore does not mean all control
is absent. Immutable v1.0 reports retain their original 23-domain shape on replay.

Successful inspection stores one immutable, content-addressed report whose identity is bound to
the finalized Snapshot, canonical subject, source set, model version, source Evidence, terminal
Evidence, and exact derivation edges. Source disagreement fails closed and stores no report. Source
independence is separately attested from the versioned official operator registry; two hostnames
owned by one operator never count as independent. Latest, exact-ID, and list reads replay PostgreSQL
only and do not contact providers.

#### Solana

Solana inspection accepts only `chainId=solana:mainnet` and the current finalized state. A caller-
supplied historical slot returns `HISTORICAL_STATE_UNSUPPORTED` because standard JSON-RPC cannot
prove arbitrary historical account state. The adapter discovers candidate control accounts, then
requires the subject and all candidates to stabilize in a bounded same-context-slot re-read.

The report decodes classic SPL Token mint/account/multisig state, Token-2022 base and extension
authorities, and upgradeable-loader Program/ProgramData authority state. Its fixed 38-domain matrix
preserves disabled authorities as Not Applicable and unimplemented Squads, PDA recursion,
IDL/verifiable-build provenance, history and independent-source agreement as Unknown. Successful
inspection stores an immutable `scs_...` report with nested Evidence and exact derivation edges.
Latest, exact-ID and list routes replay PostgreSQL without contacting Solana RPC.

### Typed ledger records

`type` accepts `BLOCK` and `TRANSACTION` on EVM, Bitcoin, and Solana, plus `OUTPOINT` on Bitcoin.
EVM requires an explicit canonical `chainId=eip155:<id>`. Bitcoin and Solana reject a conflicting
`chainId`. IDs are canonical block positions/hashes, transaction hashes/signatures, or
`<txid>:<vout>` outpoints.

Confirmed transactions are re-read against their reported block/slot and rejected if the placement
hash conflicts with the Snapshot. Pending EVM transactions use a captured finalized head. Bitcoin
mempool transactions and outpoints use a best-chain-tip Snapshot plus a content digest of the
mutable observation. A null EVM/Solana transaction response creates raw provider Evidence and
source-linked negative Evidence; the result stays Unknown because absence, pruning/propagation, and
commitment delay cannot be conflated.

The response contains `subject`, typed `facts`, `metadata`, and `evidence`. `metadata` always carries
the Snapshot, coverage, freshness, source set, model version, confidence, and Evidence IDs.

When durable Evidence and Solana transaction-report storage are configured, every successful
finalized live Solana transaction analysis is stored as one immutable `str_...` report. The generic
transaction route returns `durableReport` with the report ID, result hash, capture time, replay flag,
and a typed `liveRefresh` value. If the Solana provider is unconfigured or a live refresh fails, the
generic route may return the latest stored report, but it sets `replayed=true`, makes `liveRefresh`
explicitly Unavailable with the provider reason, and preserves the report's original Snapshot. The
latest and exact-ID routes are provider-free and never refresh chain state. A missing report is
`404`; unavailable or uninitialized durable storage is `503`; corrupt or conflicting storage fails
closed.

Solana transaction results additionally expose `transactionSemantics`. The versioned model resolves
the canonical account order as static, loaded writable, then loaded readonly; derives fee payer,
signer and writable flags from the message header; and keeps every compiled outer/CPI instruction at
an explicit `outer:N` or `outer:N/inner:M` path. Recorded pre/post lamports and SPL token amounts use
exact integer deltas. Missing loaded-address metadata leaves affected programs/accounts and account
coverage incomplete. Missing inner-instruction or token-balance recording leaves CPI counts or token
deltas Unknown; an account/mint present on only one side never implies a zero balance. The raw
transaction, each normalized instruction and the terminal semantic result are separate, linked
Evidence nodes. `recordingCoverage` measures six explicit response dimensions: execution metadata,
lamport tables, CPI, token balances, logs and compute units. The token dimension uses the fraction of
account/mint identities recorded on both sides, not merely the presence of both arrays. Overall
response coverage uses the weaker of account resolution, recording coverage, and applicable core
asset-flow coverage; confidence is conservatively scaled by that coverage.

Version `solana-transaction-semantics-v1.1.0` uses the official generated System, SPL Token and
Token-2022 discriminators to identify instructions. It strictly decodes native SOL transfers and
the core `Transfer`, `TransferChecked`, `TransferCheckedWithFee`, `MintTo`, `MintToChecked`, `Burn`
and `BurnChecked` token variants into `assetFlows`. Each flow records whether its instruction was
`APPLIED`, `NOT_APPLIED` because the transaction failed, or `UNKNOWN` because execution metadata is
absent. Token-account addresses remain distinct from owners; source/destination owners are emitted
only from recorded pre/post token metadata. Every decoded flow has a child Evidence node beneath its
normalized instruction and the raw transaction.

Classic token effects reconcile modeled per-account atomic deltas with zero allowed integer error.
Token-2022 transfers without same-Snapshot mint extension state keep fee and recipient net output
Unknown even when the instructed gross amount is known. Explicit `TransferCheckedWithFee` data can
establish its expected fee, but unmodeled withheld-fee, confidential, close/sync, hook, or missing
CPI effects keep the reconciliation `PARTIAL`. Gross instruction flows are not equated to net
pre/post balances. This foundation does not claim decoded Jupiter/launchpad/AMM events, controller
identity, full Token-2022 extension execution, launch lifecycle or realizable value.

Bitcoin transaction facts expose `locktime`, every validated input sequence and direct opt-in RBF
signaling. `transactionEntityAnalysis` additionally reconciles input/output/fee arithmetic, records
input-address coverage, exact address reuse and equal-output groups, screens bounded common-input
and script-type change candidates, and reports CoinJoin-like or fanout/batching structure. The raw
transaction, pinned BIP78 source revision and derived model result are separate Evidence nodes.

`commonInputHeuristic` is structural candidate Evidence only. `automaticOwnershipMergeAllowed` is
always `Known(false)` in this route: final transactions do not carry BIP78 Payjoin negotiation
provenance, service/custody attribution is a separate versioned source, and equal-output CoinJoin-like
or fanout/incomplete patterns suppress change candidates before scoring. `ownershipConclusion` and
`selectedChangeOutput` therefore remain Unknown unless a future independently evidenced analysis
meets the precision gates; the current endpoint never creates an Entity merge.

Direct sequence signaling is not promoted to effective replaceability: active node policy,
inherited ancestor state and CPFP package structure remain Unknown because Esplora does not expose
Bitcoin Core `getmempoolentry` fields.

Bitcoin outpoint queries fetch and cross-check the funding output, outspend and spending input. The
derived `scriptControl` classifies standard P2PKH/P2SH/P2WPKH/P2WSH/P2TR, bare multisig, OP_RETURN
and custom scripts; it verifies revealed P2SH/P2WSH commitments and observes legacy multisig plus
CLTV/CSV. Unrevealed P2SH/P2WSH and optional Taproot branches remain Unknown. A script key, key hash,
output key or multisig member is never returned as a controlling entity. Raw transactions, the UTXO
observation and the derived control result retain separate Evidence nodes and exact source edges.

### Flap BSC launch inspection

`GET /api/v1/launches/EVM/:token?chainId=eip155:56&platform=flap` requires a configured BSC
read-only adapter. An optional canonical-hex `blockNumber` pins replay to a historical block;
otherwise the adapter captures its configured Snapshot anchor and converts it to a numeric block
tag before any bytecode or `eth_call` read.

The inspector verifies Portal and token bytecode, attempts the officially recommended BSC
`getTokenV8Safe` interface, and falls back through V6/V5 only when the RPC reports that a newer
method is unavailable. A malformed successful response is rejected rather than reinterpreted as
another version. Returned fields include deployment/interface revision, lifecycle, quote and
virtual reserves, circulating/remaining supply, graduation threshold, progress, tax state, pool,
Snapshot, coverage, confidence, and source-linked Evidence. Fields not exposed by that interface,
including current sell capacity and LP rights, remain typed Unknown.

`spotPrice` is Known only while the Portal lifecycle makes its 18-decimal price field applicable.
For a migrated `DEX` token, the Portal field is explicitly `Unknown(NOT_APPLICABLE)` even when its
raw value is zero; ZeroTrace never presents that zero as the market price. The migrated market price
must come from an identified DEX pool at the same Snapshot.

No token bytecode yields negative Evidence and `platformMatch=false`; it does not produce a
plausible launch record. This endpoint performs no approval, signing, swap, or broadcast operation.

`GET /api/v1/launches/EVM/:token/events/:transactionHash?chainId=eip155:56&platform=flap`
accepts a caller-supplied creation, staging, or migration transaction hash. It validates the final
receipt and every log position, recaptures the exact block/hash Snapshot, decodes only logs emitted
by the versioned Portal, and returns receipt, log, documented-default, and derived Evidence.
`TokenCreated` configuration fields identify their provenance as `EVENT`, `OFFICIAL_DEFAULT`, or
`NOT_APPLICABLE`; a documented legacy curve type does not fabricate a curve address or V2 reserve
parameters. Future enum values stay Unknown. `LaunchedToDEX` and
`TokenPoolInfoUpdated` are returned as observed migration facts without inferring an absent
counterpart.

This endpoint has `historyCoverage=0`: it proves what the supplied transaction contains, not that
the transaction is the token's only creation/configuration/migration event. Automatic log discovery
and chain-wide lifecycle reconstruction remain incomplete.

`GET /api/v1/launches/EVM/:token/history?chainId=eip155:56&platform=flap&fromBlock=...&toBlock=...`
scans at most 50,000 blocks per request. The server splits the range into bounded log queries,
filters the versioned Portal event topic set, decodes the non-indexed token field, and then requires
every candidate transaction to pass the exact receipt/block replay described above. When
`SQD_PORTAL_URL` is configured, finalized `binance-mainnet` address/topic filtering supplies the
range observations; strict BSC `eth_getLogs` remains the fallback. The two paths share the same
request-scoped source provenance and fail-closed result validation. An optional `chunkSize` is
limited to 10,000 blocks; total observations are limited to 25,000 Portal logs and 250
receipt-replayed transactions. Request count, result count, topic mismatches, removed logs,
duplicates, out-of-range responses, source-head shortfall, parent discontinuity, and inconsistent
placements fail closed. Every discovered log must also match the RPC receipt's block, transaction,
log index, address, topics, and data exactly.

`requestedRangeCoverage=1` means every chunk in the requested range returned and all matching
transactions were replayed. It does not mean full token history: `lifetimeCoverage` and metadata
`historyCoverage` remain Unknown/zero until the Portal deployment origin is evidenced and indexing
is continuous through the analysis Snapshot. An empty result creates bounded negative Evidence,
not a claim that the token never emitted a Flap event.

`GET /api/v1/launches/EVM/:token/history/projections/:scanId?chainId=eip155:56&platform=flap`
replays an existing one-shot worker scan from PostgreSQL. Optional `afterBlock` is the exclusive
segment-start cursor returned by the preceding page; `limit` defaults to 20 and is bounded
from 1 to 100. The route validates that the UUID belongs to the exact BSC token, SQD source and Flap
event-history scan type, re-parses a completed terminal result, and reads at most `limit + 1`
immutable segments to determine `hasMore` and `nextAfterBlock`.

This endpoint performs no SQD or RPC call. It returns `503` when durable projection storage is not
configured or healthy, `404` for a mismatched token/scan identity, and fails closed on corrupt stored
state. `scan.requestedRangeCoverage` reports durable cursor progress. A completed scan may report
100% requested-range coverage while terminal lifetime coverage remains Unknown and
`historyCoverage=0`.

`GET /api/v1/launches/EVM/:token/history/lifetime/materializations/:scanId?chainId=eip155:56&platform=flap`
replays the composite point-in-time lifetime scan stored by `flap:lifetime`. The route binds the UUID
to the exact token, EVM/BSC chain, `FLAP_LIFETIME_MATERIALIZATION` scan type, and versioned ZeroTrace
source. It reports dataset start, finalized target, durable progress and safe failure metadata. A
completed state is re-parsed through the lifetime schema before it is returned.

The terminal result links its origin and history child scan IDs, origin-search coverage,
origin-to-target history summary, exact target Snapshot, terminal Evidence root, source set,
freshness, model version and confidence. `lifetimeCoverage=known/true` is valid only when the unique
origin search covers official SQD dataset start through target and the history projection covers
the evidenced creation block through that same target with 100% coverage. Missing origin remains
Unknown. Partial or Snapshot-conflicting children never degrade to zero or a plausible result.

The endpoint performs no SQD or RPC call. It returns `503` when durable checkpoints are not
configured, `404` for a mismatched token/scan identity, and fails closed with a checkpoint conflict
for corrupt completed state. This is stored point-in-time proof replay, not continuous scheduling.

`GET /api/v1/launches/EVM/:token/history/lifetime/heads/latest?chainId=eip155:56&platform=flap`
returns the latest accepted INITIAL or EXTENSION row from the append-only lifetime-head chain. It
includes sequence, predecessor ID, scan ID, exact finalized target/hash, typed lifetime state,
freshness/model metadata and terminal Evidence. The API performs no provider request and re-validates
stored rows through the lifetime schema and canonical hashes in the repository. Append-only reorg
invalidations remove their exact descendant suffix from canonical selection without deleting those
historical rows; after rollback the endpoint returns the surviving or safely replayed branch.

An absent token head returns `404` and remains Unknown; unconfigured or unhealthy migration `010`
storage returns `503`. The endpoint never falls back to a one-shot scan, never converts absence to
zero, and never triggers scheduling. Extensions are accepted only after the worker has persisted
multi-endpoint target agreement, direct or historical predecessor continuity, complete delta
history, and the new terminal Evidence root.

`GET /api/v1/launches/EVM/:token/origin?chainId=eip155:56&platform=flap&fromBlock=...&toBlock=...`
searches at most 1,000,000 finalized BSC blocks through SQD's `createResultAddress` trace filter.
The route requires both `SQD_PORTAL_URL` and a BSC RPC provider. A unique successful create trace is
accepted only when its creator is the versioned official Portal and its address, block, transaction,
transaction index and Snapshot agree with the exact RPC receipt and decoded `TokenCreated` event.
The response retains the runtime bytecode fingerprint and trace path as Evidence.

An optional `chunkSize` is bounded at 1,000,000 blocks and the synchronous route permits at most
250 chunks inside its one-million-block request ceiling. Each source response must report the exact
requested range, next block, finalized head, response-block count, request count and completed
status. SQD may paginate one logical filtered chunk across multiple HTTP responses; ZeroTrace does
not claim coverage until continuation reaches the requested end.

`searchedRangeCoverage=1` proves only the requested finalized range. Zero matches produce bounded
negative Evidence and an Unknown origin; multiple matches produce a conflicting-sources Unknown.
Even a unique match leaves `lifetimeCoverage` Unknown and `historyCoverage=0` until checkpointed
event indexing is continuous from the evidenced creation block through the target Snapshot.

`POST /api/v1/rv/flap-sell` accepts `chainId=eip155:56`, `token`, unsigned-decimal atomic
`inputQuantity`, optional `platform=flap`, and optional decimal `blockNumber`. The inspector and
`previewSell` call share that exact Snapshot. The returned `realizableValue` is Known only when the
Portal returns a valid `uint256`; an exact provider-returned zero remains zero with raw call
Evidence. Buy-only/killed/staged status is `unavailable/EXECUTION_BLOCKED`, migrated DEX status is
`unavailable/UNSUPPORTED`, future status is Unknown, excessive input is blocked, and provider errors
remain provider errors. None of those states is converted to zero.

The output and input remain atomic strings. Nominal value, decimals-normalized average price,
independent price impact, and complete fee breakdown remain Unknown until separate same-Snapshot
sources are implemented. The endpoint uses `eth_call` only and cannot sign, approve, swap, or
broadcast.

`POST /api/v1/rv/flap-pancake-v2-buy-scenarios` accepts `chainId=eip155:56`, a canonical EVM
`token`, one to eight positive plain-decimal `quoteInputs`, optional `platform=flap`, and optional
decimal `blockNumber`. It is applicable only when the same-Snapshot Flap inspection reports `DEX`,
DEX ID `0`, a non-native quote token and a pool address.

At one numeric finalized block the adapter verifies pool/factory/router bytecode, `pair.factory`,
`token0`, `token1`, `getReserves`, official-factory `getPair`, router `factory`, and both token
`decimals`. The pool and router must match the versioned official Pancake V2 BSC registry. Each
input receives an official read-only router `getAmountsOut` quote plus a clean-room
constant-product recomputation using the documented fixed 25 bps V2 fee. Every field has Contract
State Evidence and the terminal result links the complete derivation graph.

The response separates raw-reserve spot price, official-router gross output, deterministic formula
output, configured-buy-tax net estimate, average modeled acquisition price, post-buy pool price and
price change. Actual execution-net receipt remains `Unknown(NOT_QUERIED)` until a pinned-fork swap
simulates fee-on-transfer and swapback behavior. Every scenario reports its deterministic quote
error and the top-level `validation` is `PASS`, `FAIL`, or `NOT_RUN`.

The deterministic tolerance is `10 bps` (`0.1%`). A larger mismatch sets the modeled tax-net value
to `Unknown(CONFLICTING_SOURCES)` rather than choosing one quote. `sourceCoverage=0.5` represents one
live chain-state operator plus official registries; repeated reads through that operator do not
inflate independence. `historyCoverage=0` and `simulationCoverage=0.5` make clear that this is a
point-in-time pool/router model, not historical or execution-complete RV.

Sending bought tokens to a pension or treasury wallet is never treated as a burn. The response
keeps `pensionSinkTreatment=Unknown(INSUFFICIENT_DATA)` and counts no extra price effect beyond the
modeled pool buy until custody and transfer execution are separately evidenced. The route performs
only bytecode reads and `eth_call`; it cannot approve, sign, swap, or broadcast.

`POST /api/v1/rv/flap-pancake-v2-pension-entry-scenarios` accepts the same BSC chain, platform,
token, one-to-eight positive decimal `quoteInputs`, and optional `blockNumber`, plus optional
`pensionReportId` and `pensionWallet`. Durable PostgreSQL Evidence and pension-candidate report
storage are mandatory. Without an explicit report the latest report for the token is selected;
without an explicit wallet the report must contain exactly one candidate. Missing report Evidence,
token/report mismatch, or an unlisted candidate fails closed before market reads.

The market Snapshot must be at or after the behavior report's finalized range end. At an equal
height, its block hash must match exactly. Each result composes the existing verified buy scenario
with exact-integer share arithmetic:

- share equivalent = configured-tax modeled net tokens / observed report share unit;
- whole shares = floor(net tokens / share unit);
- committed tokens and remainder preserve the exact net-token atomic total;
- committed quote cost is allocated proportionally, and average quote cost per share is conservatively
  rounded up by one quote-asset atomic unit when division is not exact;
- the custody transfer has no additional modeled pool impact, so modeled post-deposit spot equals
  the buy scenario's modeled post-buy spot.

Exact arithmetic and allocations have zero atomic-unit tolerance. The inherited Router versus
clean-room pool check uses the versioned `10 bps` budget. A known zero token receipt remains zero,
but its average cost per share is `Unknown(NOT_APPLICABLE)`, never numeric zero. Actual wallet
receipt, whole shares after transfer, transfer tax/swapback, final post-transfer pool price, total
supply reduction, custody irreversibility, participant exit policy and dividend execution remain
typed Unknown until a pinned-fork buy-plus-transfer and independent Claim Evidence exist. The
terminal derivation must link the buy-scenario root, candidate Evidence and durable report terminal
Evidence. This endpoint is read-only and cannot approve, transfer, swap, sign or broadcast.

`POST /api/v1/rv/flap-pancake-v2-sell-scenarios` accepts the same chain, platform, token and optional
block fields plus one to eight positive decimal `tokenInputs`. It reuses the complete same-Snapshot
market certificate, including a one-quote-asset forward Router/formula probe, then reads the
official Router in the token-to-quote direction for every exit size.

Each result keeps four values distinct: marginal-price nominal value, full-input Router gross
quote, the configured sell-tax pool estimate, and actual settlement output. The first three are
derived from the verified reserves and Portal configuration; actual settlement remains
`Unknown(NOT_QUERIED)` until a pinned fork measures the receiving wallet's balance delta. The
response also reports average configured-tax exit price, modeled post-sell spot, price impact and
quote-reserve consumption. A 10 bps Router/formula mismatch withholds every configured-tax field as
`Unknown(CONFLICTING_SOURCES)`.

`executionCapacity` remains `Unknown(NOT_QUERIED)` because reserve math cannot prove max-sell,
blacklist/whitelist, dynamic tax, fee exemptions, swapback, gas or revert behavior. The endpoint is
read-only and never approves, transfers, swaps, signs or broadcasts.

`POST /api/v1/rv/flap-pancake-v2-reconciliation` accepts the same BSC token plus one to eight
positive `quoteInputs` and one to eight positive `tokenInputs`. It does not accept a caller-selected
block. The API first reconciles every configured BSC adapter at the lowest common finalized
position. Fewer than two usable adapters returns HTTP 503; a block/hash disagreement returns HTTP
409 with the complete anchor result and no market read.

After anchor agreement, each adapter independently reruns the complete Flap/Pancake V2 market
certificate and both scenario families at the canonical numeric block. Exact deployment, pool,
asset, decimal, reserve, spot, fee, tax and timestamp fields require zero mismatch. Official Router
gross outputs use the typed independent-market/RV budget: pass at `<=0.50%`, warning through
`1.00%`, and fail above that. Deterministic model outputs remain exact comparisons because the same
versioned code must reproduce the same integers.

Source independence is a separate Evidence-backed decision. Version
`source-operator-registry-v1` currently maps the documented Alchemy BSC hostname to operator
`alchemy` and the documented BNB Chain public hostnames to `bnb-chain`. Every attestation links its
official document plus a versioned registry root. Unknown host ownership produces
`INCONCLUSIVE`; two BNB Chain hostnames produce `SAME_OPERATOR`; neither can become a false pass.
Only complete agreement across at least two documented operators can return `PASS` or
`PASS_WITH_WARNINGS`.

The response includes the common block/hash, anchor reconciliation, operator attestations, every
child buy/sell certificate, all typed discrepancy checks, coverage, three terminal Evidence roots,
and a full Evidence graph. `executionNetTokenOutput`, `executionNetQuoteOutput`, executable
capacity, gas, reverts and dynamic token behavior remain Unknown until separate pinned-fork
execution exists. The endpoint performs only read-only JSON-RPC calls.

### Typed discrepancy audit

`POST /api/v1/data-quality/discrepancies` accepts up to 1,000 actual/reference comparisons plus
analysis metadata. Every non-empty audit requires one replayable target Snapshot; both observations
and every source or explanation Evidence ID must exist in the Evidence ledger and be compatible
with that complete Snapshot identity. A successful non-empty audit creates a derived Evidence node
linked to all comparison sources.

The engine uses exact decimal/rational arithmetic and field-class budgets:

- exact identity/state, conservation, freshness, and API/UI parity require zero mismatch;
- deterministic derived values pass at relative error `<= 0.10%`;
- independent market quote/RV values pass at `<= 0.50%`, warn through `1.00%`, and fail above
  `1.00%` unless the distinction has explicit explanation Evidence; their source independence must
  also be positively verified by referenced Evidence or the comparison is inconclusive;
- holder/entity aggregates pass at `<= 0.10%` only when declared coverage meets its gate.

When the reference is zero, comparison uses exact absolute equality and is excluded from the
relative-error denominator. Unknown, unavailable, stale, provider-down, unsupported, and not
applicable observations produce `INCONCLUSIVE` coverage gaps, never numeric zero or a passing
comparison. Overall status is `PASS`, `PASS_WITH_WARNINGS`, `FAIL`, or `INCONCLUSIVE`; an empty audit
is inconclusive. Entity-probability Brier/ECE calibration is a separate corpus-level acceptance gate
and is not implemented by this same-Snapshot endpoint.

Each successful transport response carries its own safe hostname-based endpoint ID. Snapshot
`providerVersions` lists every endpoint used to establish the anchor; Evidence names the endpoint or
deterministic endpoint set used for the observed state; response metadata `sourceSet` is their sorted
union. This remains correct when concurrent calls complete out of order or a failover occurs.

## Anchor reconciliation and continuity

`GET /api/v1/data-quality/anchors` reads each configured endpoint separately. It lowers healthy
heads to the minimum observed block/slot, re-reads faster endpoints at that exact position, and
compares hash, parent identity, finality, ledger, and chain. The result is one of:

- `AGREEMENT`: at least `DATA_QUALITY_MIN_SOURCES` observations match at the common position;
- `DISAGREEMENT`: observations differ; `canonicalAnchor` is
  `unknown/CONFLICTING_SOURCES`, never a majority-selected winner;
- `INSUFFICIENT_SOURCES`: at least one observation exists but fewer than the required minimum;
- `UNAVAILABLE`: no endpoint produced a valid observation.

Every successful head/comparison is an append-only observation backed by block Evidence. A
reconciliation Evidence node links the common-position observations. Disagreement creates a
CRITICAL `CROSS_SOURCE_DISAGREEMENT` alert with Evidence edges. Each source also reports continuity
against its prior head as `FIRST_OBSERVATION`, `UNCHANGED`, `DIRECT_EXTENSION`, `HISTORICAL_MATCH`,
`REORG_DETECTED`, `SOURCE_REGRESSION`, or `CHECK_UNAVAILABLE`. Reorg/regression alerts retain prior,
current, and optional historical-check Evidence.

`configuredSources` counts endpoints, not independently operated providers. The API deliberately
returns `sourceIndependence: unknown/NOT_QUERIED`; hostname differences do not prove organizational
or infrastructure independence. `snapshotSet` preserves every comparison Snapshot. A single
canonical `metadata.snapshot` exists only for agreement; it is `null` for conflicts and insufficient
data.

Entity, RV, and scenario analysis is accepted only when every supplied source evidence ID already
exists in the evidence ledger and matches the request ledger, chain, and snapshot block/slot. A
successful analysis creates a `DERIVED_FEATURE` evidence node linked to those sources. Missing or
incompatible sources return HTTP 422 with `UNGROUNDED_ANALYSIS` and a typed `evidenceIssue` rather
than producing an ungrounded result. Compatibility includes the complete bound Snapshot, not only
the block/slot number. With `POSTGRES_URL` configured, source Evidence remains available after API
restart; without it, capability and health output explicitly report process-local storage.

## Explicitly incomplete endpoints

`/assets`, `/labels`, `/markets`, `/claims`, and `/timeline` return HTTP 501 with:

- `CAPABILITY_NOT_IMPLEMENTED`;
- a typed Unknown knowledge value;
- zero coverage;
- a model-version marker.

This is deliberate contract preservation, not an implementation.

The implemented Flap current-state, supplied-event-transaction, bounded-history, stored projection
replay, and bounded-origin routes above are the only current `/launches` exceptions. Other ledgers,
platforms, deployment-origin continuous history, and launch queries remain unavailable rather than
falling back to generic data.

## Knowledge values

```json
{ "state": "known", "value": "123" }
```

```json
{
  "state": "unknown",
  "reason": "INSUFFICIENT_DATA",
  "detail": "The required historical evidence has not been indexed."
}
```

```json
{
  "state": "unavailable",
  "reason": "PROVIDER_UNCONFIGURED"
}
```

Clients must switch on `state`. They must not replace non-known values with zero, false, an empty
array, or a confident label.

## Error envelope

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Request validation failed.",
    "requestId": "req-1",
    "retryable": false
  }
}
```

Provider errors distinguish retryable timeout/quota/availability failures from invalid requests.
Secret values and raw provider URLs are not included.

Storage failures return HTTP 503 with a stable `STORAGE_*`, `EVIDENCE_*`, or `SNAPSHOT_CONFLICT`
code. When `POSTGRES_URL` is configured, failed durable writes never fall back to process memory.

Configured providers include a `transport` object in health responses with the safe active endpoint
ID, circuit state, logical request/attempt/success/failure counters, retries, pacing delays, cache
hits/misses, failovers, and last attempt timestamps. Endpoint IDs contain the provider role and
hostname only; URL paths and credentials are excluded.

Health responses also contain `storage`: `POSTGRES`/`UP`/`durable: true` for an initialized durable
repository, `POSTGRES`/`DOWN` with a safe error code when configured storage is unavailable, or
`MEMORY`/`EPHEMERAL` for an intentional no-`POSTGRES_URL` development runtime. Configured storage
failure makes `/health/ready` return HTTP 503.

`dataQuality` reports aggregate anchor state, safe per-chain results, configured/observed source
counts, continuity coverage, Evidence IDs, alerts, and its own `POSTGRES` or `MEMORY` storage state.
A source disagreement, reorg/regression alert, or failed data-quality repository degrades full
`/health`. `INSUFFICIENT_SOURCES` and `UNCONFIGURED` remain truthful non-production states without
making current request readiness fail. The endpoint performs read-only chain calls but may append
new Evidence, anchor observations, and alerts to the configured internal repository.

`ingestionStorage` reports the independent historical backends:

- `rawFacts`: ClickHouse `zerotrace.raw_chain_facts` schema and migration health;
- `checkpoints`: PostgreSQL `ingestion_runs` schema and migration health;
- `artifacts`: S3-compatible bucket reachability and versioning.

Each component is `UP`, `DOWN`, or `UNCONFIGURED`; the aggregate additionally uses `PARTIAL` when
only some components are configured. A historical backend failure degrades `/health`, but does not
make `/health/ready` fail because current API request paths do not depend on the worker stores. The
worker itself performs a fail-closed preflight across all stores before ingestion. Health output
never returns storage passwords or provider URL paths.

## Numeric representation

Atomic ledger quantities and reserves use decimal strings. JSON numbers are used only for bounded
probabilities, coverage ratios, latency, and explicitly safe counters. Clients must not coerce atomic
strings into JavaScript `number`.

## Snapshot and evidence requirements

Production conclusions must return:

- ledger-specific snapshot;
- source set, freshness, coverage, model version, and confidence;
- evidence IDs whose nodes can be retrieved;
- derivation edges for calculated conclusions.

Current search classification is local structural evidence. Provider-backed subject reads and
derived entity/RV/scenario results write their Evidence, derivation edges, and complete Snapshot to
PostgreSQL when configured. The separate finalized worker stores each ingested provider block as a
content-addressed versioned raw artifact, binds blocks, transactions, EVM logs/traces/state diffs,
Bitcoin inputs/outputs, and Solana instructions/logs/native balances/token balances/rewards to
durable Evidence/Snapshot provenance, stores idempotent ClickHouse Raw Facts, and only then advances
its PostgreSQL checkpoint. Per-table coverage is `MATERIALIZED`, `NOT_QUERIED`, or `NOT_APPLICABLE`;
non-materialized tables have null counts. These raw records are not semantic transfers or protocol
events.
