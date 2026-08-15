# Launchpad provenance registry

ZeroTrace treats a launchpad name as a research classification, not as proof of
deployment identity. A read-only decoder may be activated only when one
`ProtocolDeploymentVersion` binds:

1. an official documentation or IDL source;
2. a pinned source commit and ABI/IDL hash;
3. the program or contract and factory identities observed on the target chain;
4. a replayable Evidence set and a real historical provider capture.

The runtime registry is exported by
`@zerotrace/platform-adapters` as `LAUNCHPAD_PROTOCOL_REGISTRY` and is exposed
through `GET /api/v1/platforms`. Empty `versions` arrays are intentional:
they keep the research target visible while preventing an unpinned address from
becoming production decoder logic. Pump and PumpSwap have the first
`READY_READ_ONLY` versions. Raydium LaunchLab now has a source-pinned partial
clean-room decoder record, but it remains blocked until a real finalized
historical capture closes its Evidence chain; the other named entries remain
blocked until their own provenance and historical-capture gates pass.

## Current boundaries

| Platform          | Official read-only sources                                                                                                                                                                                                                                                                                                     | Current status                                 | Boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flap              | [deployed contracts](https://docs.flap.sh/flap/developers/deployed-contract-addresses), [token inspection](https://docs.flap.sh/flap/developers/inspect-a-token), [bonding curve](https://docs.flap.sh/flap/developers/basic-and-mechanism/bonding-curve)                                                                      | Partial adapter; version record pending        | Existing reads remain Evidence/Snapshot-bound; ABI hash and replay provenance still need a single pinned registry record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Pump / PumpSwap   | [Pump docs](https://pump.fun/docs/), [official public docs](https://github.com/pump-fun/pump-public-docs), [Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)                                                                                                                                    | Pinned read-only v1                            | Pump and PumpSwap each bind the official source/IDL hash, executable program identity, four Evidence nodes, and a finalized mainnet provider capture. SOL/USDC, fee, and feature changes require separate versions.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Raydium LaunchLab | [program addresses](https://docs.raydium.io/reference/program-addresses), [bonding curve docs](https://docs.raydium.io/products/launchlab/bonding-curve), [Anchor IDL docs](https://docs.raydium.io/sdk-api/anchor-idl), [pinned IDL](https://github.com/raydium-io/raydium-idl/tree/e7e0c96fe77bcf6a020b84a44c47a722aac8e359) | Partial clean-room decoder; activation blocked | Mainnet program `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` and source commit `e7e0c96fe77bcf6a020b84a44c47a722aac8e359` are pinned. `initialize`, `initialize_v2`, Token-2022 initialization, trades, migration arguments, and the raw 429-byte `PoolState` layout decode from the official Borsh shapes. Public RPC reads use `minContextSlot` and remain `MIN_CONTEXT_ONLY` when the response is later; an explicit archive adapter can provide `EXACT` only when its response context equals the requested slot. Deployment-sensitive remaining accounts and durable finalized Evidence closure remain open. No SDK is copied into the Apache core. |
| Meteora DBC       | [official docs](https://docs.meteora.ag/), [DBC repository](https://github.com/MeteoraAg/dynamic-bonding-curve), [official license](https://raw.githubusercontent.com/MeteoraAg/dynamic-bonding-curve/main/license.md)                                                                                                         | License review required                        | Official README identifies mainnet-beta DBC program `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`; the repository declares a non-commercial license. No DBC IDL is promoted into the permissive core. Decoder work requires a clean-room or isolated boundary plus a real finalized fixture and Evidence closure.                                                                                                                                                                                                                                                                                                                                         |
| Moonshot / Moonit | [official docs](https://docs.moonshot.cc/), [Data API](https://api.moonshot.cc)                                                                                                                                                                                                                                                | Provenance pending                             | Old Moonshot curves, later versions, migration destinations, and Moonit evolution are separate time-aware versions. The API is cross-check evidence only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Four.meme         | [official site](https://www.four.meme/), [public repository](https://github.com/four-meme-community/four-meme-ai)                                                                                                                                                                                                              | Provenance pending                             | Version TokenManager/template/migration and read-only event/quote semantics. No agent skill, private-key, signing, or transaction path is integrated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| FomoWell          | [official site](https://btc.fomowell.com/)                                                                                                                                                                                                                                                                                     | Provenance pending                             | ICP/ckBTC canister reads remain separate from EVM and Solana. Canister IDs require official-material and chain-state discovery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Pump/PumpSwap decoder slice

The current clean-room decoder is pinned to the official public-docs commit
[`9c82f61cb711b044a17f770ab8ce9f9bdf78f333`](https://github.com/pump-fun/pump-public-docs/tree/9c82f61cb711b044a17f770ab8ce9f9bdf78f333).
It records the raw IDL hashes and the two official Solana program identities at runtime:

| Program  | Identity                                      | IDL SHA-256                                                        |
| -------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Pump     | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | `b90bc471327f671449271d5d1d42354d1fae6f5a06502f5834459a3108138e49` |
| PumpSwap | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | `6b5c7ec4e5ef9742fa99dc57b0d75b1031b379bba02a7e1b3c5a4cad68d77e56` |

`npm run launchpad:pump:smoke -- --signature <finalized-signature>` captures a real transaction
through the public Solana RPC, writes an in-memory Evidence lineage, and replays the decoder.
The 2026-08-14 runs observed Pump `buy` at slot `439138804` and PumpSwap `buy` at slot
`439146809`; both decoded their arguments with full argument/account coverage and retained extra
accounts as explicit layout warnings. These are real provider captures, not test mocks, but the
run is not durable database storage acceptance.

The API and UI expose these results as `launchpadObservations` with the exact finalized Snapshot,
Evidence IDs, source commit, IDL hash, instruction version, coverage, and warnings. The registry
activates `pump-solana-mainnet-9c82f61cb711` and
`pumpswap-solana-mainnet-9c82f61cb711` as `READY_READ_ONLY` from
`packages/platform-adapters/src/launchpad-provenance.ts`. The four-node provenance graph includes
official IDL, executable program identity, transaction observation, and derived decoder Evidence
for each protocol; the pinned records are durable provenance manifests and are not used as
production query input. Other named platforms remain `PROVENANCE_PENDING` or
`LICENSE_REVIEW_REQUIRED`.

## Raydium LaunchLab partial decoder boundary

The clean-room implementation in
`packages/platform-adapters/src/solana-raydium-launchlab.ts` is deliberately narrower than an
SDK integration. It recognizes the official source-pinned LaunchLab discriminators for
`initialize`, `initialize_v2`, `initialize_with_token_2022`, the four buy/sell primitive trade
instructions, and `migrate_to_amm`/`migrate_to_cpswap`. It decodes the pinned Borsh
`MintParams`, `CurveParams`, `VestingParams`, AMM fee enum, and optional Token-2022 transfer-fee
struct into bounded JSON argument strings. It also has a bounded raw decoder for the official
429-byte `PoolState` account layout, including curve reserves, status, migration type, token
program flags, vesting schedule, and protocol addresses. That decoder does not calculate price,
graduation, realizable value, or control rights; callers must supply finalized account Evidence
and an exact Snapshot before promotion. Public account reads use only finalized `getAccountInfo`
with `minContextSlot`; the adapter never promotes a later response to historical truth. A provider
with the optional archive `getAccountInfoAt` capability may close the account read only when the
returned context slot is exact. Deployment-sensitive remaining accounts are not inferred; account
addresses are included only when the normalized Solana transaction resolved them, and short,
trailing, or unresolved layouts are explicit warnings.

Every emitted observation carries the exact finalized Snapshot, source commit, compact clean-room
descriptor hash, execution state, coverage, warnings, and Evidence IDs. The registry exposes the
version record so the API/UI can show why the decoder is present but not activated for production:
the record has no real finalized fixture Evidence IDs, and no chain-identity acceptance run has been
claimed. This keeps protocol research visible without treating a guessed or current-only decoder as
historical truth.

## Generic unknown mechanism

`inferGenericLaunchMechanism` can report a bounded
`UNKNOWN_LAUNCHPAD` / `BONDING_CURVE_LIKE` observation when raw evidence shows
factory-like creation, reserves, repeated buys/sells, migration, or liquidity
events. It never emits Pump, Four.meme, Flap, or another named platform without
the versioned provenance and chain-identity gates above.

The policy is deliberately read-only. No registry entry grants signing,
approval, swap, broadcast, private-key custody, or automatic fund movement.
