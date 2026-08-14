# Launchpad provenance registry

ZeroTrace treats a launchpad name as a research classification, not as proof of
deployment identity. A read-only decoder may be activated only when one
`ProtocolDeploymentVersion` binds:

1. an official documentation or IDL source;
2. a pinned source commit and ABI/IDL hash;
3. the program or contract and factory identities observed on the target chain;
4. a replayable Evidence set and a real historical fixture.

The runtime registry is exported by
`@zerotrace/platform-adapters` as `LAUNCHPAD_PROTOCOL_REGISTRY` and is exposed
through `GET /api/v1/platforms`. Empty `versions` arrays are intentional:
they keep the research target visible while preventing an unpinned address from
becoming production decoder logic.

## Current boundaries

| Platform          | Official read-only sources                                                                                                                                                                                                                                | Current status                          | Boundary                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flap              | [deployed contracts](https://docs.flap.sh/flap/developers/deployed-contract-addresses), [token inspection](https://docs.flap.sh/flap/developers/inspect-a-token), [bonding curve](https://docs.flap.sh/flap/developers/basic-and-mechanism/bonding-curve) | Partial adapter; version record pending | Existing reads remain Evidence/Snapshot-bound; ABI hash and replay provenance still need a single pinned registry record.                                         |
| Pump / PumpSwap   | [Pump docs](https://pump.fun/docs/), [official public docs](https://github.com/pump-fun/pump-public-docs), [Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)                                                               | Provenance pending                      | Decode raw Solana instructions and program accounts; do not use the web UI as the core data source. SOL/USDC, fee, and feature changes require separate versions. |
| Raydium LaunchLab | [bonding curve docs](https://docs.raydium.io/products/launchlab/bonding-curve), [Anchor IDL docs](https://docs.raydium.io/sdk-api/anchor-idl), [IDL repository](https://github.com/raydium-io/raydium-idl)                                                | License review required                 | Use official IDL as a clean-room schema reference or an isolated sidecar. The GPL SDK is not copied into the Apache core.                                         |
| Meteora DBC       | [official docs](https://docs.meteora.ag/), [DBC repository](https://github.com/MeteoraAg/dynamic-bonding-curve)                                                                                                                                           | License review required                 | The repository is a protocol/schema reference until its license boundary is cleared; decoder implementation must remain clean-room or isolated.                   |
| Moonshot / Moonit | [official docs](https://docs.moonshot.cc/), [Data API](https://api.moonshot.cc)                                                                                                                                                                           | Provenance pending                      | Old Moonshot curves, later versions, migration destinations, and Moonit evolution are separate time-aware versions. The API is cross-check evidence only.         |
| Four.meme         | [official site](https://www.four.meme/), [public repository](https://github.com/four-meme-community/four-meme-ai)                                                                                                                                         | Provenance pending                      | Version TokenManager/template/migration and read-only event/quote semantics. No agent skill, private-key, signing, or transaction path is integrated.             |
| FomoWell          | [official site](https://btc.fomowell.com/)                                                                                                                                                                                                                | Provenance pending                      | ICP/ckBTC canister reads remain separate from EVM and Solana. Canister IDs require official-material and chain-state discovery.                                   |

## Generic unknown mechanism

`inferGenericLaunchMechanism` can report a bounded
`UNKNOWN_LAUNCHPAD` / `BONDING_CURVE_LIKE` observation when raw evidence shows
factory-like creation, reserves, repeated buys/sells, migration, or liquidity
events. It never emits Pump, Four.meme, Flap, or another named platform without
the versioned provenance and chain-identity gates above.

The policy is deliberately read-only. No registry entry grants signing,
approval, swap, broadcast, private-key custody, or automatic fund movement.
