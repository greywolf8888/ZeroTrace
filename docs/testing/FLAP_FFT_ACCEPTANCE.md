# Flap FFT Terminal Acceptance

This specification registers the final real-chain acceptance target requested for ZeroTrace. It is
an acceptance contract, not a completed analysis.

## Target and boundary

| Field    | Value                                               |
| -------- | --------------------------------------------------- |
| Network  | BNB Smart Chain (`eip155:56`)                       |
| Platform | Flap                                                |
| Token    | FFT                                                 |
| Contract | `0xdcfb441a1f38802820a4e7b4cc8aab37833c7777`        |
| Mode     | Read-only; no approval, signing, swap, or broadcast |

The test may run only after the versioned Flap adapter, semantic token/market normalization, control
entity analysis, realizable-value routing, and automatic discrepancy engine are implemented. Until
then, a generic address or transaction read is foundation evidence only and cannot be presented as
an FFT product conclusion.

Implementation note: the deterministic same-Snapshot discrepancy core, class budgets,
target-indexed claim-address observation, immutable report replay, migrated Pancake V2 buy/exit
slices, and the scoped Alchemy/BNB Chain independent market reconciliation are implemented. Named
FFT market and partial-RV runs are recorded below. The terminal run remains gated by complete
event/migration history, independent claim-flow reconciliation, pinned-fork tax and swapback
execution, sell-route capacity/gas, controller/control-right analysis, claim-action semantics,
corpus-level entity calibration, and complete multi-route realizable value.

## Authoritative inputs

The acceptance run must pin one finalized BSC block number and hash, then retain all raw payload
hashes and decoded Evidence at that Snapshot. It must use:

1. at least two configured BSC endpoint observations lowered to the same block;
2. the deployed Flap Portal discovered from the official
   [deployment registry](https://docs.flap.sh/flap/developers/deployed-contract-addresses);
3. the version-appropriate Portal inspection result, preferring the documented
   [BSC `getTokenV8Safe` with explicit legacy fallbacks](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/inspect-a-token);
4. indexed `TokenCreated` plus optional same-transaction configuration events described by the
   official [event indexing guide](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/index-token-created-events);
5. token bytecode, supply/balance state, holders, authorities/control rights, pool/reserve state,
   quote token, and every discovered market route required by the terminal architecture;
6. the per-token curve parameters returned by chain state. The official
   [bonding-curve documentation](https://docs.flap.sh/flap/developers/basic-and-mechanism/bonding-curve)
   explicitly forbids silently hard-coding those parameters.

A deployment address, ABI, parameter, or status copied from documentation must be rechecked against
the pinned chain state and recorded with source/version/validity metadata.

## Recommended error budget

One blanket percentage is unsafe because the fields have different mathematical meanings. The
automatic checker therefore applies the following typed budgets:

| Class                        | Examples                                                                                                                                    | Acceptance budget                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Exact identity/state         | chain ID, block/token/pool/quote address, bytecode hash, event topic/order, status enum, version, decimals, integer supply/balance/reserves | **0 mismatch** at the same Snapshot; any difference is an error                                                             |
| Conservation                 | decoded transfers, holder balances within declared coverage, reserve deltas                                                                 | exact atomic-unit equality for the covered set; uncovered state remains Unknown                                             |
| Deterministic derived values | curve invariant, price from the same raw reserves, fee/tax transformation, route arithmetic                                                 | relative error `<= 0.10%` after both sides use the same documented rounding; division-by-zero is unavailable, never 0       |
| Independent market quote/RV  | executable read-only quote or reconstructed exit proceeds at the same block, route and size                                                 | relative error `<= 0.50%`; `0.50–1.00%` warning; `> 1.00%` failure unless an evidenced fee/rounding distinction explains it |
| Holder/entity aggregates     | controller-controlled supply and concentration derived from a declared address set                                                          | raw balances exact; aggregate relative error `<= 0.10%`; coverage below the declared gate is inconclusive                   |
| Entity probability model     | controller/coordination/independence probabilities on a labeled evaluation corpus                                                           | Brier score `<= 0.15` and expected calibration error `<= 0.05`; one FFT case alone cannot validate calibration              |
| Freshness                    | source capture distance from the selected Snapshot                                                                                          | same block for comparisons; otherwise stale/unavailable, not an error percentage                                            |
| API/UI parity                | knowledge state, Evidence IDs, Snapshot and displayed atomic/decimal values                                                                 | exact structured equality before presentation rounding                                                                      |

Relative error is `abs(actual - reference) / abs(reference)`. When the reference is zero, the checker
uses exact absolute equality. Unknown, unavailable, stale, provider-down, unsupported, and not
applicable values are excluded from numeric denominators and reported as coverage gaps.
Independent quote/RV checks additionally require positively verified source independence and its
Evidence; separate hostnames alone do not establish independence, and an unverified relationship is
inconclusive.

## Automatic discrepancy workflow

1. Resolve the token and Flap deployment/version from official metadata and pinned on-chain state.
2. Capture a finalized BSC Snapshot and lower all providers to the same block identity.
3. Read raw token, Portal, event, pool, quote-token, holder, control-right, and route observations.
4. Validate each provider response before normalization; preserve unsafe integers as decimal strings.
5. Recompute exact and derived facts independently from the retained raw observations.
6. Compare sources and computations using the typed budgets above.
7. Emit an Evidence-linked discrepancy for every mismatch with field path, actual/reference values,
   absolute/relative error, threshold, source set, model/decoder version, and severity.
8. Return one of `PASS`, `PASS_WITH_WARNINGS`, `FAIL`, or `INCONCLUSIVE`. Insufficient coverage can
   only be `INCONCLUSIVE`, never `PASS`.

Exact state conflicts, block/hash conflicts, negative reserves, impossible supply conservation,
wrong pool/token identity, or a missing Evidence edge are failures. Provider outage, pruned history,
and absent calibration labels are explicit inconclusive gates. No majority vote may convert a
same-block source conflict into truth.

## Partial market acceptance: 2026-08-10

The production market composition was executed read-only against FFT and accepted the following one
operator/one Snapshot result. This is a completed point-in-time market slice, not the terminal
acceptance artifact.

| Field                | Accepted observation                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot             | finalized BSC block `115131838`, hash `0x04d1d1986cc969ac95e1acd6f3bae677a7934fff10758a628207e5e0c1ae22ef`, timestamp `2026-08-10T13:51:07.000Z`                                                         |
| Market               | PancakeSwap V2 pool `0xe374af9818c4359374996f86a734fc39eb04d949`, verified against official factory `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` and Router `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| Reserves             | `74891827.839354821963347306` FFT and `30143.481700747512234533` BSC USDT                                                                                                                                |
| Current reserve spot | `0.000402493604047242` USDT/FFT                                                                                                                                                                          |
| Fee/tax inputs       | documented V2 fee `25` bps; Flap inspection reported configured buy tax `300` bps                                                                                                                        |
| Automatic check      | `PASS`; three scenarios evaluated, zero failed, `10` bps budget, observed error `0` bps                                                                                                                  |
| Provenance           | 21 Evidence nodes; terminal Evidence `ev_c1d282e77439383f0b8495b2`; source coverage `0.5`                                                                                                                |

| Quote input |       Router/model gross FFT |   Configured-tax estimate FFT | Average configured-tax price |  Modeled post-buy spot |         Spot move |
| ----------: | ---------------------------: | ----------------------------: | ---------------------------: | ---------------------: | ----------------: |
|    100 USDT |  `247012.617596385988641107` |   `239602.239068494408981873` |       `0.000417358370225468` | `0.000405165202846288` |    `66.37618` bps |
|  1,000 USDT | `2398915.968277365381597299` |   `2326948.48922904442014938` |       `0.000429747372848513` |  `0.00042960726637845` |  `673.642066` bps |
| 10,000 USDT | `18620993.39326804405720477` | `18062363.591470002735488626` |       `0.000553637399078962` | `0.000713397661433456` | `7724.447152` bps |

The Router output and independently implemented 25 bps integer model matched exactly at atomic-unit
precision. The configured-tax column is a policy/configuration estimate, not a simulated receipt:
actual execution-net remains `Unknown(NOT_QUERIED)` until a pinned-fork execution observes transfer
tax and swapback behavior. The live run used one chain operator plus official documentation, so it
does not pass the independent-source gate. Host DNS interception caused the production SSRF guard to
reject the public RPC hostname after it resolved into a private range; validation therefore used a
test-only direct-fetch transport while retaining the production ledger adapter, market composition,
Evidence ledger, read-only calls, and same-Snapshot checks. The production SSRF policy was not
weakened.

Sending acquired FFT to the behavioral pension-wallet candidate is modeled as a subsequent transfer
into movable custody, not an irreversible burn and not a second AMM trade. It therefore does not
create an extra automatic spot-price effect. Technical custody, individual membership withdrawal,
weekly dividend execution, controller identity, and official wallet attribution remain separate
Evidence questions.

### Partial exit/RV acceptance: 2026-08-10

A later read-only run pinned finalized block `115137197`, hash
`0x600b38f896ddc58ceac21169a1c285aef495bce92bbbb67b80249a86c672db75`, timestamp
`2026-08-10T14:31:19.000Z`. The verified pool contained
`74586827.793161266597497691` FFT and `30267.053563947710181207` USDT; reserve spot was
`0.000405796230507108` USDT/FFT and Flap inspection reported a configured 300 bps sell tax.

| FFT exit input |      Nominal at spot USDT |         Router gross USDT | Configured-tax estimate USDT | Average configured-tax exit |         Post-sell spot | Quote reserve consumed |
| -------------: | ------------------------: | ------------------------: | ---------------------------: | --------------------------: | ---------------------: | ---------------------: |
|      1,000,000 |  `405.796230507108956541` |  `399.439762336147983189` |     `387.610030249454467789` |      `0.000387610030249454` | `0.000395456564368927` |        `128.06335` bps |
|      5,000,000 | `2028.981152535544782706` | `1897.055669041575774379` |    `1843.610572166868587816` |      `0.000368722114433373` | `0.000357811908927055` |       `609.114649` bps |
|     10,000,000 | `4057.962305071089565413` | `3570.332704241699971628` |    `3475.522007411636832561` |      `0.000347552200741163` | `0.000317861429336053` |      `1148.285544` bps |

Router gross output matched the independent 25 bps integer model at atomic precision for all three
sizes (`0` bps error, validation `PASS`, 10 bps budget). Terminal Evidence
`ev_9627b639672d93ae97fef938` closes 23 nodes. Coverage is data `0.9`, source `0.5`, history `0`,
simulation `0.5`, with confidence `0.94`.

The nominal column is explicitly not RV. The configured-tax column assumes 3% is removed before the
pair; it is not a wallet settlement observation. Actual execution-net and executable capacity remain
`Unknown(NOT_QUERIED)` until a pinned fork tests dynamic tax, exemptions, max-sell,
blacklist/whitelist, swapback, gas, reverts, and final balance delta. This partial result therefore
does not satisfy the terminal multi-route sell requirement.

## Scoped independent-source acceptance: 2026-08-11

The complete current-market certificate was rerun through Alchemy and BNB Chain at one common
finalized block. Official endpoint documents resolved the two safe hostname-only source IDs to two
distinct operators under `source-operator-registry-v1`; two BNB Chain endpoints or any unregistered
hostname remain inconclusive by contract.

At block `115179695`, hash
`0x7054294e11db4811df556d2c85835420181b670cf8049e024a161ea67905af89`, all 37 exact and bounded
market/buy/exit comparisons passed with zero warnings, failures, inconclusive results or coverage
gaps. A second PostgreSQL-backed run at block `115180163`, hash
`0xb834c88b35c1a92dfe5d9c69af079825aa78832b048d591af96bc5d429df0279`, also passed 37/37.
Its 91-node graph reloaded after the provider-configured API stopped: terminal Evidence
`ev_fde8795ff3b8bf6671535f21`, independence Evidence `ev_e540983d3bd41ef0a3370c8b`, registry
Evidence `ev_b8f129251ea6679da7b83f1b`.

This satisfies the independent-source gate for the current Pancake V2 market and modeled route
quotes. Exact prices and three buy/exit scenarios are recorded in
[VALIDATION_RECORD.md](VALIDATION_RECORD.md#fft-independent-market-and-rv-reconciliation-2026-08-11).
It does not convert configured-tax estimates into execution facts and does not close the historical,
multi-route, fork-settlement, claim, entity or full lifecycle requirements below.

## Scoped all-block supply acceptance: 2026-08-11

The supply-continuity worker sampled FFT `totalSupply()` at the parent plus every finalized block in
`115188144-115188147`. Alchemy and BNB Chain agreed exactly on five canonical block/state samples
and were attributed to two operators by the versioned registry. Initial and final supply were
`1000000000000000000000000000` atomic units, net delta was zero, and terminal status was
`VERIFIED_NO_CHANGE` with Evidence `ev_5074fef4eb70f879c3e2e48d`. A replay using an intentionally
invalid Alchemy credential returned the same durable result.

The zero is valid only for those four transitions. An older BNB public-node probe returned `missing
trie node`, so no conclusion is emitted for that unavailable history. The result neither changes
the pension Safe from movable custody into a burn nor proves deployment-to-head supply continuity.
Independent archive-capable backfill and continuous scheduling remain terminal gates.

## Required output

The terminal acceptance artifact must contain:

- Flap mechanism/version/status and launch-to-market lifecycle;
- holder distribution, controller candidates, coordination/independence probabilities, service-hub
  suppression, and control rights;
- every discovered pool/route, curve/reserve state, taxes/fees/gas assumptions, capacity and shared
  liquidity;
- gross/book value separated from realizable value across at least three sell-size scenarios;
- automatic discrepancy table and the calculated error for every compared field;
- Snapshot, source set, coverage, freshness, model/decoder version, confidence, Evidence IDs, and raw
  payload hashes for every material conclusion;
- an explicit list of Unknown/unavailable/stale/provider-down fields and the external capability
  needed to resolve each one.

The run passes only when all exact checks pass, numeric checks stay within their class budget, no
critical discrepancy remains, required coverage is met, and replay reproduces the same normalized
facts from retained Evidence.
