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

## Authoritative inputs

The acceptance run must pin one finalized BSC block number and hash, then retain all raw payload
hashes and decoded Evidence at that Snapshot. It must use:

1. at least two configured BSC endpoint observations lowered to the same block;
2. the deployed Flap Portal discovered from the official
   [deployment registry](https://docs.flap.sh/flap/developers/deployed-contract-addresses);
3. the version-appropriate Portal inspection result, preferring the documented
   [`getTokenV5`/BSC `getTokenV6` interface](https://docs.flap.sh/flap/developers/inspect-a-token);
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
