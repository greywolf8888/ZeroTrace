# ZeroTrace 一次性完整落地开发 Master Prompt

> 用途：将本文件**原样交给 Codex / GPT-5.6 / Cursor Agent / Claude Code 等开发 Agent**。  
> 目标：Agent 从空仓库或现有空壳项目开始，一次性完成 ZeroTrace 的生产级架构、功能、UI、数据层、链适配、平台机制适配、测试、验证和文档。  
> 原则：**不拆“先做 MVP、以后再补”这种产品阶段。所有能力从一开始按终态架构设计并落地。开发路线只允许按依赖顺序拆解进度，不能通过删功能来缩小目标。**

---

# 0. 给开发 Agent 的最高级指令

你现在是 ZeroTrace 项目的总工程 Agent，同时承担：

- 产品架构师
- 区块链数据工程师
- EVM 工程师
- Bitcoin/UTXO 工程师
- Solana/SVM 工程师
- 图计算/实体识别工程师
- DeFi/AMM/Launchpad 机制分析师
- 数据库工程师
- 前端数据产品工程师
- QA / Benchmark / Regression 工程师
- 安全与许可证审计工程师

你的任务不是提供方案，而是**把本文件描述的系统真正实现到可运行、可验证、可测试、可迭代的生产级代码库中**。

## 0.1 执行规则

1. 不要再向用户询问已经能通过互联网、GitHub、官方文档、链上状态解决的问题。
2. 对所有容易变化的平台参数、合约地址、Program ID、费率、曲线参数、毕业阈值、API 规则，**实现前必须先搜索并核对最新官方文档与链上状态**。
3. 官方文档 / 官方 GitHub / 链上事实优先级最高。
4. 不得把博客、论坛、AI 总结直接当成协议事实。
5. 不得把第三方钱包标签直接当成“同一控制人”的事实。
6. 不得把 AI 的自然语言推断直接写成金融事实。
7. 不得通过硬编码当前某个平台参数完成开发；应读取合约/Program/配置账户/IDL/ABI/平台版本。
8. 不得为了快速完成而把真实查询替换成 Mock。
9. Fixture/Mock 只允许存在于测试目录。
10. 所有推断必须保存 Evidence，可下钻到原始交易、指令、日志、账户、UTXO、区块/slot。
11. 所有分析必须绑定可重放 Snapshot。
12. 项目默认是**只读链上情报工具**：不得保存交易私钥、不得真实 Swap、不得真实 Approve、不得广播 BTC/Solana/EVM 交易。
13. 模拟只能运行在本地 Fork、LiteSVM、离线状态或 `simulateTransaction` 等无广播环境。
14. 如果外部 API 需要付费 Key，必须实现为 Optional Provider。没有该 Key 时核心系统仍然可运行。
15. 优先免费官方 RPC、开放数据、开源项目；不要让核心系统依赖单一商业 API。
16. 每引入一个开源项目，记录：仓库、用途、版本/commit、许可证、是否修改、是否隔离 Sidecar。
17. AGPL/GPL/FSL/非宽松许可证项目不得直接复制代码进入闭源核心；通过 Sidecar、协议调用或重新实现接口并保留许可证审计。
18. 完成开发后必须执行完整测试矩阵，不允许只执行单元测试后宣称完成。
19. 不允许在仓库中留下“以后再做”的核心功能 TODO。若因外部服务不可用而无法验证，功能代码仍需完成，并进入“待外部验证任务”。
20. 持续维护 `PROGRESS.md`，但**不能在 30%、60%、90% 停止交付**；最终目标是 100% Definition of Done。

---

# 1. 项目初始意图

ZeroTrace 不是区块浏览器，也不是普通 Holder 排行榜。

## 1.1 最终目标

对于任意支持的 Token、Coin、Wallet、Address、Contract、Program、Pool 或 Entity，尽可能重建：

1. 谁真正控制这些资产。
2. 一个控制者是否拆分了大量“大号 / 小号 / 中转号 / 归集号 / LP 操作号 / 做市号”。
3. 哪些钱包是同一控制实体。
4. 哪些钱包虽然是不同个人，但存在统一协调行为。
5. 哪些钱包更接近真实独立市场参与者。
6. 哪些地址只是 CEX、Bridge、Router、Program、PDA、ATA、Pool、Vault、Paymaster、Bot、MEV、MM 等基础设施。
7. 项目方、基金会、社区、养老计划、回购钱包、销毁钱包、加池钱包、多签等真实控制关系。
8. 项目对外宣传的税费、分红、回购、销毁、加池、基金会、养老计划等机制是否真实执行。
9. Token 当前“账面市值”和真正可兑现价值之间的区别。
10. 某钱包/实体持有的 Token 如果现在真实卖出，考虑曲线、税、滑点、路由、池深、交易限制后，最终能换回多少 SOL/BNB/ETH/USDT/USDC/BTC 或稳定结算资产。
11. 多个庄家/基金会/社区钱包共用同一个流动性时，如果同时退出，真正能带走多少钱。
12. LP 是否可撤、谁可撤、锁仓/燃烧/多签是否真实。
13. 庄家当前的筹码成本、持币年龄、浮盈、立即可售筹码。
14. 市场真实新增资金是多少，而不是简单看 Volume。
15. 是否存在关联实体循环成交、刷量、协同买卖、批量早期 Sniper、资金回流。
16. 当前盘面处于吸筹、自然扩张、控盘拉升、分发、筹码激活、护盘、撤流动性、资本循环、退出准备、恐慌等哪种可解释状态。
17. 上述结构过去 1H / 6H / 24H / 7D 如何变化。

## 1.2 关键产品原则

ZeroTrace 必须始终区分：

- `Address`：链上地址
- `Account`：链上账户
- `Wallet`：钱包级逻辑对象
- `Cluster`：链上行为聚类
- `Entity`：推测由同一真实控制方控制的一组链上对象
- `CoordinationGroup`：可能不是同一控制者，但明显协同行动
- `Role`：Controller / Treasury / MM / Arbitrage / CEX / Bridge / Retail / Bot 等
- `ControlRight`：Owner / Admin / Multisig / Program Authority / LP 权利等
- `LabelObservation`：某数据源对地址的标签
- `Inference`：ZeroTrace 的推断
- `Fact`：确定性链上事实

必须明确：

> Address ≠ Wallet ≠ Entity  
> Holder Count ≠ Independent User Count  
> Market Cap ≠ Cash In Pool  
> Balance × Spot Price ≠ Realizable Value  
> Multisig ≠ 自动去中心化  
> Label ≠ Beneficial Ownership  
> 高相关行为 ≠ 必然同一个真人

---

# 2. 支持范围：EVM + Bitcoin + Solana

完整架构从第一天支持三类账本。

```text
LedgerAdapter
├── EvmLedgerAdapter
├── BitcoinUtxoLedgerAdapter
└── SolanaLedgerAdapter
```

上层统一到 Canonical Model，不允许把三条链强行塞进同一种底层结构。

---

# 3. EVM 支持要求

## 3.1 EVM 链

设计为 Generic EIP-155 Adapter，优先覆盖但不限于：

- Ethereum
- BNB Smart Chain
- Base
- Arbitrum
- Optimism
- Polygon
- Avalanche C-Chain
- Linea
- Scroll
- zkSync Era
- Blast
- Mantle
- Monad
- X Layer
- Abstract
- Berachain
- 任何能够通过 Capability Probe 验证的 EVM 链

新增普通 EVM 链应尽量只新增配置，不新增业务代码。

## 3.2 EVM 对象

支持：

- Native Coin
- ERC-20
- ERC-721
- ERC-1155
- Proxy
- Transparent Proxy
- UUPS
- Beacon
- Diamond
- Safe
- Factory
- Router
- Pool
- V2 LP
- V3 NFT Position
- Tax Token
- Fee-on-transfer Token
- Rebasing/特殊余额 Token
- Launchpad Token
- Bonding Curve Token

## 3.3 EVM 数据与开源复用

优先复用：

- `ethereum-lists/chains`
- `wevm/viem`
- SQD / Subsquid Portal
- Routescan（Indexed fallback）
- Blockscout API / Blockscout MCP（辅助）
- Sourcify V2
- `@shazow/whatsabi`
- `ethereum-lists/4bytes`
- Heimdall-rs（未验证 Bytecode 辅助）
- Slither Sidecar（AGPL，必须隔离）
- Foundry / Anvil
- Hummingbot Gateway
- PancakeSwap 官方 Router/SDK
- Uniswap 官方 Router/SDK（注意许可证）
- Safe 直接链上读取；Safe Transaction Service 仅可选
- Arbitrum Foundation `sybil-detection`
- Sybil Defender
- NetworkX / 图算法库

## 3.4 EVM RPC

Provider 采用 Capability Model：

```text
CURRENT_STATE
BALANCE
BLOCK
TRANSACTION
RECEIPT
LOG
TRACE
STATE_DIFF
ARCHIVE
MEMPOOL
CONTRACT_SOURCE
ABI
TOKEN_HOLDERS
SIMULATION
LABEL
PRICE
POOL
```

优先：

1. 链官方公共 RPC / 用户自己的 Key
2. SQD 历史数据
3. 可选 Indexed Provider
4. 自建 Node

特别注意：

- BSC 官方公共 Mainnet RPC 可用于当前状态，但历史 logs 能力受限制；不得将其作为唯一历史索引源。
- EVM 历史事实主要走 SQD / 可替换 Index Provider。
- Provider 必须有健康检查、Rate Limit、Retry、Circuit Breaker、Freshness 与 Capability Probe。

---

# 4. Bitcoin 支持要求

## 4.1 Native Bitcoin

支持：

- Address
- Script
- P2PKH
- P2SH
- P2WPKH
- P2WSH
- P2TR
- Transaction
- Input
- Output
- Outpoint
- UTXO
- Mempool
- RBF
- CPFP
- Block
- Fee
- Coin Age
- Cluster
- Entity

## 4.2 Bitcoin 资产协议

至少提供可插拔 Adapter，并默认支持或接入成熟 Indexer：

- Ordinals / Inscriptions
- Runes
- BRC-20
- Bitcoin-native metadata/protocol extension
- 后续 Atomicals / ARC-20 / Alkanes 等通过 Protocol Adapter 扩展

优先复用：

- Bitcoin Core
- SQD Bitcoin Dataset
- Blockstream Esplora
- Trezor Blockbook
- mempool
- GraphSense
- GraphSense TagPacks
- WalletExplorer（弱外部 Cluster Oracle）
- `ordinals/ord`
- OPI / Open Protocol Indexer（BRC-20 等）
- CCXT（交易所公开 Orderbook）

不得自己重复实现 Ord/Runes 底层索引算法。

## 4.3 Bitcoin 聚类

Evidence 包括：

- Common Input Heuristic
- Change Candidate
- Peel Chain
- Address Reuse
- Script Pattern
- Input Selection Pattern
- Fee Pattern
- Timing Pattern
- Public Key Reuse
- Settlement Cluster
- External Attribution
- UTXO Age

必须先执行反误判：

- CoinJoin
- Mixing
- Exchange Fanout
- Service Cluster
- Custodial Consolidation
- Payjoin 等会污染 Ownership Heuristic 的模式

规则：

> CoinJoin Golden Dataset 中禁止错误 SameController Merge。

---

# 5. Solana / SOL 完整支持

Solana 不是 EVM，建立独立 `SolanaLedgerAdapter`。

## 5.1 Solana 数据对象

必须支持：

- Slot
- Block
- Transaction Signature
- Versioned Transaction
- Address Lookup Table
- Fee Payer
- Signer
- Instruction
- Inner Instruction / CPI
- Program
- ProgramData
- Program Upgrade Authority
- PDA
- System Account
- SPL Token Mint
- SPL Token Account
- Associated Token Account
- Token Owner
- Mint Authority
- Freeze Authority
- Close Authority
- Metadata / Update Authority
- Token-2022 / Token Extensions
- Pool
- Vault
- Bonding Curve
- Multisig / Squads
- Jito/MEV 相关可观察证据
- SOL / WSOL
- SPL Token / Token-2022

## 5.2 Solana 官方与开源底座

优先复用：

- Solana 官方公共 RPC：仅低频、当前状态、开发/回退
- `anza-xyz/agave`：当前 Solana validator/client 主实现
- SQD `solana-mainnet`：历史主数据源，从 genesis + realtime
- `sevenlabs-hq/carbon`：Solana Indexing Framework，优先作为解析/decoder 底座
- `rpcpool/yellowstone-grpc`：实时 Geyser 流能力，作为可选实时 Provider
- `rpcpool/yellowstone-vixen`：Program parser/codegen
- Jupiter：
  - `jup-ag/metis-binary`
  - `jup-ag/jupiter-swap-api-client`
  - 官方 Jupiter 文档
- LiteSVM：Solana 本地执行/模拟
- `Squads-Protocol/v4`
- Pump 官方 `pump-fun/pump-public-docs` / SDK / IDL
- Raydium LaunchLab 官方 Program/SDK/文档
- Meteora Dynamic Bonding Curve 官方 Program/SDK
- Dune Solana 数据/Labels
- 可选 WalletLabels / Nansen / Arkham / GMGN 等外部标签或交叉验证

不要再依赖已经 archived 的 `solana-labs/solana` 作为当前主实现；优先 Anza Agave。

## 5.3 Carbon 的使用

Carbon 已包含/持续维护大量 Solana Program decoders，包括 Pump/PumpSwap、Raydium、Launchpad、Meteora 等。

要求：

- 优先直接复用 Carbon decoder。
- 若 Carbon 已支持，不得自己重新手写同一套 Borsh/Anchor decoder。
- 若缺失 Program，优先通过 IDL + codegen 扩展 Carbon/Vixen decoder。
- 所有 decoder 必须 fixture-test。

## 5.4 Solana Token Control Surface

必须解析：

### SPL / Token-2022

- Mint Authority
- Freeze Authority
- Account Owner
- Close Authority
- Permanent Delegate
- Transfer Fee Configuration
- Withheld Fee Authority
- Transfer Hook
- Default Account State
- Non-transferable
- Interest-bearing 等所有与处置权/流通性有关的 Token Extensions
- Metadata Pointer / Update Authority
- Group / Member Pointer（如适用）

任何可以：

- 再 Mint
- Freeze
- 强制代理转移
- 收取可变 Fee
- Hook Transfer
- 改变 Token 行为

的 Authority 都必须进入 `ControlRight`。

## 5.5 Solana Program 控制权

解析：

- Program executable
- ProgramData
- Upgrade Authority
- Immutable Program
- Anchor IDL（若有）
- Verifiable Build（若可验证）

## 5.6 Squads 多签

使用 `Squads-Protocol/v4` SDK/Program 数据解析：

- Members
- Threshold
- Roles
- Config Authority
- Timelock
- Spending Limit
- Vault
- Sub-account
- 变更历史

不能只显示 “2/3 多签”。

必须进一步判断：

- Signer 是否疑似同一个 Entity
- Config Authority 是否能够降低 Threshold / 修改 Members
- 是否存在 Spending Limit 可绕过普通交易路径
- 真正 Independent Controller 数量

---

# 6. Solana Entity Resolution 特征

Solana 的钱包聚类不能照搬 EVM。

至少建立这些特征：

## 6.1 Funding

- 首笔 SOL 来源
- Funding Ancestor
- 共同 Funding Wallet
- CEX Funding 断点
- 相同资金批量分发
- 相同 Token Distributor
- 相同 ATA 创建 payer

## 6.2 Transaction Construction Fingerprint

- 相同 Fee Payer
- Signer 组合
- Instruction 顺序
- CPI 结构
- 相同 Program 组合
- 相同 Address Lookup Table 使用
- 相同 Compute Budget 参数
- Priority Fee 模式
- 相同 Tip 行为（只有在可靠可观察时使用）
- 相同 Slippage / Route 习惯
- 相同 Token Account 创建/关闭模式
- 相同失败交易模式

## 6.3 Behavioral Fingerprint

- slot/时间同步
- 早期买入排名
- 多项目共同出现
- 买入/卖出时间序列
- 金额拆分模式
- 归集规律
- 跨 Pump/Raydium/Meteora/Jupiter 的交互语法
- Bot 行为指纹
- Sniper 行为
- MM / Arbitrage 行为

特别实现：

### Persistent Early Buyer Cohort

对 Pump / LaunchLab / Meteora / Moonshot 等 Token：

- 提取前 N 个真实 buyer
- 跨多个 launch 统计 co-occurrence
- Union-Find / Community Detection
- 生成 persistent cohort
- 区分“活跃 Bot 共现”与“真正同控”
- 不得因为早期共同买入自动判 SameController

## 6.4 Settlement

- 卖出后 SOL/USDC 归集
- 共同 CEX Deposit
- 共同 Settlement Wallet
- Token 归还同一钱包
- 多跳最终汇聚

---

# 7. 统一 Launchpad / Platform Mechanism Engine

新增核心抽象：

```text
PlatformProtocolAdapter
LaunchMechanismAdapter
ExecutionPlatformAdapter
```

不要按平台散落 if/else。

## 7.1 标准 Launch Lifecycle

```text
DISCOVERED
→ CREATED
→ PRE_LAUNCH
→ BONDING_CURVE / PRIMARY_MARKET
→ GRADUATION_READY
→ MIGRATING
→ MIGRATED
→ DEX_TRADING
→ OPTIONAL_VAULT/TAX/DIVIDEND/LENDING
→ DORMANT / KILLED / REDEEMED
```

平台可以只使用其中部分状态。

## 7.2 LaunchMechanismSnapshot

每个 Token 必须保存平台机制快照：

```text
platform
platform_version
deployment_id
chain
factory/program
creator

quote_asset
curve_type

real_base_reserve
real_quote_reserve
virtual_base_reserve
virtual_quote_reserve

total_supply
curve_supply
circulating_supply
remaining_supply

progress
graduation_condition
graduation_threshold

buy_fee
sell_fee
creator_fee
protocol_fee

tax_model
tax_allocations

fund_recipient
tax_processor
dividend_contract
vault

migration_target
migration_pool
lp_owner
lp_locked
lp_burned
lp_claim_right

anti_sniper_or_anti_farmer_settings

raw_config
source_block_or_slot
source_version
```

任何可变值都由链上/Program/官方配置读取。

---

# 8. Flap Adapter

必须把 Flap 作为 EVM Launchpad/Tax Token 重点适配，而不是普通 ERC20。

当前已知机制只是实现初始参考；编码前再次核对最新官方文档与部署。

## 8.1 Bonding Curve

Flap 使用虚拟储备型 constant-product curve。

要求：

- 自动识别 Portal / VaultPortal
- 读取 Token 对应的 curve config
- 不硬编码 `r/h/K`
- 优先读取官方建议的 Token State / `getTokenV5` 或当前等价接口
- 保存平台 deployment/version
- 正确计算：
  - reserve
  - circulating
  - curve price
  - progress
  - current sell capacity
  - graduation point

Flap 会更新不同链/不同 quote token 的参数，因此所有参数必须是动态的。

## 8.2 DEX Migration

分析：

- 何时达到毕业
- 剩余 Token
- 收集的 Quote
- 迁移到哪个 DEX
- V2/V3/CLMM/CPMM
- Initial Range
- LP Position
- LP 最终控制者
- LP 是否锁定/燃烧/仍可控制
- Fee rights 属于谁

## 8.3 Tax Token

完整支持：

- PreBond Tax
- Tax Token V1
- Tax Token V2
- Buy Tax
- Sell Tax
- Bonding Curve 额外 Fee
- DEX 后 Transfer Tax
- Tax liquidation threshold
- Tax Splitter
- Tax Processor
- Funds Recipient
- Market Allocation
- Burn
- Buyback
- Dividend
- Liquidity
- dispatch
- Dividend Share
- minimumShareBalance
- excluded addresses
- FlapBlackHole
- Dead Address

## 8.4 Vault

支持：

- Portal
- VaultPortal
- Registered Vault Factory
- Split Vault
- Gift/Snowball/Buyback 类 Vault
- 自定义 Vault

不要根据 Vault 名称推断资金用途。

必须：

- 读取真实 Vault Bytecode/ABI
- 读取 Recipient/BPS
- 跟踪真实资金流
- 形成 `ClaimVerification`

## 8.5 Anti-Farmer / Main Pool

读取当前相关保护配置。

用于：

- 判断某些 V3 外部池是否暂时不可加
- 主税收池与旁池区别
- 真实税收是否能被旁路交易绕过
- Realizable Value 路由时区分税收主池与无税/旁路池

---

# 9. Pump.fun / PumpSwap Adapter

Pump 是 Solana Launchpad 重点适配。

只使用官方：

- `pump-fun/pump-public-docs`
- 官方 IDL
- 官方 SDK
- 链上 Program Account

## 9.1 Bonding Curve

读取：

- BondingCurve PDA
- `virtual_token_reserves`
- `virtual_quote_reserves` / legacy SOL field
- `real_token_reserves`
- `real_quote_reserves`
- `token_total_supply`
- `complete`
- quote mint
- creator
- creator vault
- fee recipient
- buyback fee recipient
- sharing config
- user volume accumulator（如当前版本存在）

不要硬编码旧版 SOL-only 假设。

Pump Program 已持续增加新的 V2 交易指令和 Quote Mint 结构，因此：

> IDL/Program State 是 Source of Truth。

## 9.2 Graduation

检测：

```text
curve complete
→ migration eligible
→ PumpSwap migration
→ canonical pool
```

验证：

- 自动/permissionless migration
- 实际 migration transaction
- Token/Quote 迁移数量
- Pool Account
- LP 处理方式
- Liquidity 是否 protocol-controlled / burned / locked
- Creator fee rights

不得只相信 UI 的“已毕业”。

## 9.3 PumpSwap

Quote 必须考虑当前 PumpSwap Pool State。

如果 Program 中存在：

- Virtual Quote Reserve
- Dynamic Fee
- Creator Fee
- Buyback Fee
- Mayhem/特殊模式
- 新 Trade Instruction

必须由当前 Program State / Carbon Decoder / Official IDL 解析。

## 9.4 Pump Sniper / Controller Analysis

特别检测：

- Creator First Buy
- Same-slot / early buyer cohorts
- 资金分发后的早期买家
- 同源 SOL
- 同一执行语法
- 跨多个 launch 重复出现的 Cohort
- Creator → 小号 → early buy
- 早期买入后归集/卖出
- Jito/MEV/Bot 特征
- 持续 Sniper Bot 与项目方小号必须分开

输出：

```text
Creator Controlled Supply
Probable Sniper Cohort Supply
Independent Early Buyer Supply
Bot/MM Supply
Unknown
```

---

# 10. Raydium LaunchLab Adapter

完整支持：

- JustSendit
- LaunchLab
- Constant-product curve
- Fixed-price curve
- Linear-price curve
- Virtual reserve
- Quote reserve target
- `base_supply_max`
- `base_supply_graduation`
- Creator/platform fee
- Pre-graduation fee split
- Migration type
- AMM v4 / CPMM
- Fee Key NFT / post-migration fee rights
- LP burn/lock/assignment
- Vesting
- Platform PDA / branded launch environment

参数直接读取 LaunchState。

不得假设所有 LaunchLab 都是 Pump 风格 constant-product。

---

# 11. Meteora Dynamic Bonding Curve Adapter

支持：

- Dynamic Bonding Curve
- 自定义 Quote Token
- Flat / Linear / Exponential / 当前支持的 curve
- Configurable fee
- Graduation
- Migration to DAMM v1/v2
- Locked LP
- Creator/Partner liquidity
- Creator/Partner fee rights
- DAMM Config
- Launch Pool
- Virtual Pool

优先复用：

- `MeteoraAg/dynamic-bonding-curve`
- 官方 SDK
- Carbon decoder

---

# 12. Moonshot Adapter

支持 Solana 与其当前 EVM 部署。

分析：

- virtual collateral
- virtual token reserve
- curve generation
- migration threshold
- migration target
- Raydium / Meteora / EVM DEX
- migration fee
- remaining tokens
- burn
- LP burn/lock
- creator

不得把历史 Linear Curve 和当前 Constant Product 版本混合。

通过 launch timestamp / deployment / program version 判断机制。

---

# 13. Four.meme Adapter

将 Four.meme 作为 BNB Chain Launchpad 内置 Adapter。

至少解析：

- Creator
- Launch transaction
- Creator initial buy
- Curve progress
- Fee
- Quote reserve
- Graduation threshold
- Pancake migration
- Curve 剩余 Token
- 迁移到 Pancake 的 Token/BNB
- LP Owner / Lock / Burn
- 平台或项目方费率
- 是否存在新版本/新支付资产

官方规则可能变化，严禁硬编码旧文档中的具体 BNB 阈值。

---

# 14. FomoWell Adapter

FomoWell 必须支持，但不要错误地把它当成 EVM Launchpad。

当前公开资料显示其核心运行在 Internet Computer，并存在 BTC/ckBTC 资产发行与流动性产品；历史 FOMO 机制还存在“挖井/永久流动性/迁移”概念。

因此实现：

```text
FomoWellProtocolAdapter
```

并允许它使用：

```text
ExternalLedgerBridgeAdapter / IcpReadAdapter
```

## 14.1 目标

支持：

- FomoWell Token/Project
- Creator
- Canister
- Token Standard
- ICRC Token
- ckBTC / BTC-linked asset
- FOMO/Well progress
- Well reserve
- Liquidity
- Migration/DEX target
- LP lock/permanent liquidity
- DAO/governance-linked treasury
- Current platform fee
- Project token supply/holder
- 当前新版 BTC assets/liquidity 页面

## 14.2 ICP 最小只读能力

不要因此扩展成完整 ICP 分析产品。

只实现 FomoWell 所需最小能力：

- DFINITY agent/官方 SDK
- Canister query
- Candid/IDL
- ICRC Ledger read
- ckBTC 相关可验证映射
- Canister controller/治理公开信息（若可获取）
- FomoWell current deployed canisters discovery

优先使用 DFINITY 官方工具与公开链数据。

## 14.3 重要要求

FomoWell 新旧产品机制已有变化，因此：

1. 首先发现当前 production canister / protocol。
2. 对照当前 FomoWell UI 和 Docs。
3. 生成 `docs/research/FOMOWELL_CURRENT_MECHANISM.md`。
4. 不得凭旧 2024 文档硬编码迁移阈值。
5. 如果没有可靠官方开源协议代码：
   - 使用官方文档 + 链上 Canister State + Candid
   - 明确 `Source Confidence`
   - 不使用未经验证第三方代码替代协议事实。

---

# 15. GMGN Adapter

GMGN 的定位必须正确：

> GMGN 是 Trading / Router / Terminal / Wallet Intelligence / Execution Platform，不是 Pump/Flap 那种 Token Launchpad 本体。

实现：

```text
GMGNExecutionAdapter
GMGNLabelObservationProvider
```

用途：

- SOL/BSC/Base/ETH route quote（有权限时）
- Route cross-check
- Anti-MEV route metadata
- Program/Router/Contract identification
- GMGN 交易产生的 execution pattern
- 外部 Smart Money / Wallet Label 仅作为 Observation

GMGN Trade API 可能需要审核与 API Key，且有限频。

因此：

- `GMGN_API_KEY` 可选。
- 没有 GMGN Key 不能导致核心失败。
- GMGN 返回的“聪明钱/标签/相关地址”不得直接触发 SameController Merge。
- 不得通过绕过鉴权方式抓取受限接口。
- 可公开读取的数据需尊重 Terms/Rate Limit。

---

# 16. 未知 Launchpad 自动识别

除了 Flap/Pump/FomoWell/Four.meme/Raydium/Meteora/Moonshot，不得让系统对未知平台失效。

实现：

```text
GenericLaunchMechanismInferencer
```

从链上尝试识别：

- Factory / Program
- Token creation
- Quote reserve
- Virtual reserve
- Curve state
- Buy/Sell
- Fee transfer
- Graduation
- Liquidity add
- LP token / position
- Burn
- Lock
- Creator fee
- Treasury
- Router
- Vault

如果无法确定：

```text
platform = UNKNOWN_LAUNCHPAD
mechanism_confidence = ...
```

保留 Evidence，不猜平台名。

---

# 17. 统一 Entity Resolution Engine

每个地址/账户之间独立计算：

```text
SameControllerProbability
CoordinationProbability
IndependenceProbability
```

不要输出单一“庄家概率”。

## 17.1 输出类别

- CONFIRMED_SAME_CONTROLLER
- HIGHLY_PROBABLE_SAME_CONTROLLER
- PROBABLE_SAME_CONTROLLER
- COORDINATED_BUT_INDEPENDENT
- LIKELY_INDEPENDENT
- SERVICE_INFRASTRUCTURE
- BOT_MM_ARBITRAGE
- UNKNOWN

## 17.2 Evidence

EVM：

- Deployer / Owner / Admin
- Proxy Admin
- Fee Recipient
- Safe Signer
- Common Funder
- Funding Ancestor
- Settlement Convergence
- Gas Dependency
- Token Distribution
- Transaction Grammar
- Timing
- Router sequence
- Profit collection
- Wallet lifecycle

BTC：

- Common Input
- Change
- Peel Chain
- Script/Input pattern
- Settlement
- Tags
- CoinJoin suppression

Solana：

- Fee payer
- Signer
- Funding
- ATA payer
- ALT usage
- CPI/Instruction grammar
- compute budget
- early buyer cohort
- settlement
- shared authority
- Program interaction
- bot fingerprint

## 17.3 Negative Evidence

必须和 Positive Evidence 同等重要：

- 独立多年历史
- 不同 Funding
- 不同 Settlement
- 独立 CEX 充值
- 真实不同策略
- Service Hub
- Bridge
- Router
- Paymaster
- CEX
- MM
- Arbitrage
- CoinJoin
- Bot common infrastructure

## 17.4 Service Node Suppression

强制维护：

```text
CEX
Bridge
DEX
Router
Aggregator
Factory
Paymaster
Bundler
Faucet
Launchpad
Program/PDA
Vault
Mempool service
MEV/Builder
Bot infrastructure
```

这些节点不得像普通钱包一样传播 Ownership。

---

# 18. Label Intelligence

所有标签都是 `LabelObservation`，不是一个可覆盖的字符串字段。

```text
LabelObservation {
  subject_id
  chain
  source
  source_class
  label
  category
  actor_candidate
  source_confidence
  evidence_uri
  evidence_tx
  observed_at
  valid_from
  valid_to
  deterministic
  license_policy
  raw_payload_hash
}
```

## 18.1 标签来源

优先级：

### A — Deterministic

- Contract/Program on-chain authority
- Deployer
- Verified protocol registry
- Safe/Squads member
- Official project docs
- Program ID / Factory

### B — Curated / Provenance

- GraphSense TagPacks
- Dune Labels
- DefiLlama Adapters/registries
- Explorer Public Tags
- Official GitHub address registry

### C — Commercial Intelligence

Optional：

- Nansen
- Arkham
- Etherscan Metadata
- GMGN
- WalletLabels
- 其他可授权 Provider

### D — Community

- GitHub community lists
- Public explorer manual tags

### E — ZeroTrace Inference

- SameController
- Coordination
- Role prediction

规则：

- Risk Label 不允许触发 SameController Merge。
- 同名标签不允许跨链自动合并 Entity。
- CEX 标签应触发 Service Hub Suppression。
- 标签冲突必须保留。
- 标签必须保留来源和更新时间。

---

# 19. Control Rights Engine

控制权不能只看余额。

统一：

```text
ControlRight {
  subject
  controller
  right_type
  scope
  threshold
  constraints
  evidence
  active_from
  active_to
}
```

## 19.1 EVM

- Owner
- Proxy Admin
- Upgrade
- Mint
- Burn
- Tax Change
- Blacklist
- Whitelist
- Trading Switch
- MaxTx
- MaxWallet
- Fee Exemption
- Router Change
- Treasury
- Safe
- Module
- Guard
- LP Position

## 19.2 Solana

- Mint Authority
- Freeze Authority
- Token-2022 authorities
- Metadata Update
- Program Upgrade Authority
- Squads Members/Config Authority
- Pool Authority
- Vault Authority
- Creator fee rights
- Launchpad config authority

## 19.3 BTC

BTC Native 没有合约 Owner，但需要：

- Script condition
- Multisig / descriptor pattern（仅链上可观察部分）
- UTXO spend condition
- Time lock
- Script path / Taproot 可观察信息
- Custodial cluster

---

# 20. Supply Reality Engine

不要展示单一 Top Holders 作为核心。

统一重建：

```text
Total Supply
├── Burned
├── LP-bound
├── Locked
├── Vesting
├── Confirmed Controller
├── Probable Controller
├── Coordinated
├── Independent
├── CEX/Custody
├── Bridge
├── Protocol
└── Unknown
```

另外计算：

```text
Liquid Controller Supply
Activated Controller Supply
Restricted Controller Supply
LP-bound Controller Supply
```

Solana 特别注意：

> ATA/PDA/Token Account 不能被错误计作“一个独立 Holder”。

必须将 SPL Token Account 映射到真实 owner / authority。

---

# 21. Economic Lot / Cost Basis

内部转账不能重置成本。

统一建立：

```text
EconomicLot
```

来源分类：

- Market Buy
- Mint
- Genesis Allocation
- Airdrop
- Reward
- Internal Transfer
- LP Withdrawal
- Vesting Unlock
- Bridge
- Unknown

同一 Entity 内：

```text
Wallet A → Wallet B → Wallet C
```

成本 Lot 继承。

Solana ATA 之间、BTC Change Output 同样不能创造新成本。

输出：

- Entity Average Cost
- Realized PnL
- Unrealized PnL
- Supply in Profit
- Cost Distribution
- Holding Age

---

# 22. Organic Capital / Wash / Coordination

Volume 必须拆成：

```text
Organic Buy
Organic Sell
Controller Buy
Controller Sell
Coordinated Buy
Coordinated Sell
Market Maker
Arbitrage
MEV/Bot
Recycled/Wash Suspected
Unknown
```

最终核心指标：

```text
Net External Capital Flow
Organic Flow Ratio
Controller Net Flow
```

检测：

- A 买 / B 卖 / 资金回到 A
- 同 Entity 内循环
- 同 Cohort 自成交式流量
- 不同池之间 MM/Arbitrage
- Launchpad 早期人工活跃

不要把真实套利和做市错误当作刷量。

---

# 23. Realizable Value Engine

整个项目的统一价值底座。

禁止把：

```text
balance × spot_price
```

命名成“真实价值”。

保留：

- Nominal Value
- Realizable Value
- RCR
- Average Exit Price
- Price Impact
- Tax/Fee
- Route
- Execution Capacity

定义：

```text
RV(asset, quantity, snapshot, allowed_venues)
```

---

# 24. EVM Realizable Value

流程：

```text
Pool Discovery
→ Route Discovery
→ Hummingbot/Pancake/Uniswap Quote
→ Candidate Route Split
→ Anvil Fork @ Snapshot Block
→ Simulated Swap
→ Settlement Asset Balance Delta
→ RV Point
```

必须考虑：

- Multi Pool
- V2
- V3
- CLMM
- Tax
- Fee-on-transfer
- MaxSell
- Blacklist
- Whitelist
- Dynamic Tax
- SwapBack
- Auto Liquidity
- Special Router
- Exempt Address

真实 EVM 执行结果优先于理论公式。

---

# 25. Solana Realizable Value

流程：

```text
Launch Stage Detection
       │
       ├─ Pre-graduation curve
       │    → Platform Program State
       │    → Curve quote
       │
       └─ DEX stage
            → Jupiter/Metis Route
            → Pool State

→ Current State Snapshot
→ LiteSVM / RPC simulateTransaction / deterministic local account snapshot
→ Token/SOL/USDC balance delta
→ RV
```

要求：

- 不广播交易。
- Jupiter 只做 Quote/Route。
- GMGN 只可作为可选 Route Cross-check。
- Pump 在曲线阶段直接使用 Pump Program 当前状态。
- PumpSwap 使用有效储备，不要只看 vault raw amount。
- Raydium/Meteora 使用当前 pool state。
- Token-2022 transfer fee/hook 必须真实模拟。
- 如果 LiteSVM 无法完整重放某 mainnet Program，使用官方 RPC `simulateTransaction` + 可复现 Snapshot，并标记 Simulation Source。

---

# 26. Bitcoin Realizable Value

BTC Native 没有链上 AMM 的统一退出池。

分成：

## 26.1 Venue Ready RV

假设资产已在交易所：

```text
BTC amount
→ CCXT public orderbooks
→ venue split
→ depth consume
→ fees
→ realized USD/USDT
```

## 26.2 Transfer-to-Venue RV

资产仍在链上：

```text
UTXO
→ miner fee
→ confirmation assumption
→ venue arrival
→ orderbook uncertainty
```

输出 Range，不伪造精确数字。

BRC-20/Runes 等资产则通过其真实交易 Venue/Orderbook/AMM/marketplace Adapter 计算，不能直接使用 BTC 本体模型。

---

# 27. Launchpad Pre-Graduation RV

这是必须专门实现的一层。

对于：

- Pump
- Flap
- Raydium LaunchLab
- Meteora DBC
- Moonshot
- Four.meme
- FomoWell 当前等价机制
- 未知 Bonding Curve

在毕业前：

```text
Realizable Value
=
当前 Token 沿 Curve 实际卖回 Quote 的总输出
```

必须考虑：

- Curve real reserve
- Virtual reserve
- Fee
- Tax
- minimum/max constraints
- progress
- sell disabled state
- InDuel/Killed 等平台状态
- Creator special rights

因此不能把 pre-bond Token 的“市值”按 DEX TVL 模型处理。

---

# 28. Market Cap Reality

UI 同时展示：

```text
Spot Price
Price Confidence

Nominal Market Cap
FDV

Stable Realizable Market Capacity

EC-5
EC-10
EC-20
EC-50
```

不要创造一个误导性的“真实市值”。

Market Cap 只是边际价格乘 Supply。

---

# 29. Shared Liquidity / Exit Race

不同实体共享同一个市场。

不能：

```text
RV(A) + RV(B) = Combined RV
```

实现：

```text
ExitRaceScenario
```

模拟：

- Controller
- Treasury
- Foundation
- Pension
- Community
- Whale
- Coordinated Group

随机/指定顺序。

输出：

- P10
- P50
- P90 Realizable
- First Mover Advantage
- Final Price
- Remaining Liquidity
- Pool exhaustion
- Per Entity Result

---

# 30. LP Removal + Sell

Scenario 必须支持：

```text
Remove Controller-owned LP
→ update market state
→ sell controller inventory
```

并和纯 Sell 对比。

对于 Pump 等 protocol-owned/烧毁 LP：

必须正确显示 LP 不可撤，而不是套用普通 EVM LP 模型。

---

# 31. Support Capacity

分析：

- Treasury Stablecoin
- Buyback Wallet
- Foundation
- Market Maker capital
- Community Fund

区分：

```text
Declared Support
Liquid Support
Historically Deployed Support
Observed Reliable Support
```

历史验证：

- 跌多少时有没有真的买
- 买了多少
- 买完有没有再次卖
- 是否真正 Burn
- 是否真正 Add Liquidity

---

# 32. Claim Verification Engine

用户可直接粘贴：

- Telegram 公告
- X/Twitter
- 白皮书
- 网站
- 社区公告
- 类似 FFT 税费公示

Agent 只负责 NLP 结构化：

```text
Claim {
  address
  role
  percentage
  expected_action
  asset
  condition
  time_range
}
```

Deterministic Engine 做链上核验：

```text
Expected
vs
Actual
```

示例：

```text
Tax 100%
├─ Community 20%
├─ Buyback Burn 40%
└─ Buyback LP 40%
```

实际验证：

- 是否收到
- 是否 Swap
- 是否 Burn
- 是否 Add LP
- LP 谁控制
- 是否循环回项目钱包

输出：

- VERIFIED
- PARTIALLY_VERIFIED
- CONTRADICTED
- INSUFFICIENT_DATA

---

# 33. Market State Engine

只能输出有规则和 Evidence 支撑的状态：

- ACCUMULATION
- ORGANIC_EXPANSION
- CONTROLLED_MARKUP
- DISTRIBUTION
- INVENTORY_MOBILIZATION
- LIQUIDITY_DEFENSE
- LIQUIDITY_WITHDRAWAL
- CAPITAL_RECYCLING
- EXIT_PREPARATION
- PANIC
- DORMANT
- UNKNOWN

不做“AI 猜未来价格”。

每个状态必须显示：

- Trigger
- Supporting metrics
- Contradicting metrics
- Confidence
- Time window

---

# 34. Timeline / Pattern Engine

把单笔 Tx 升级成事件。

示例：

```text
Treasury → 20 小号分发
→ Router/Program Approve/Prepare
→ Test Sell
→ Batch Sell
→ USDT/SOL Settlement
→ CEX Deposit
```

形成：

```text
Controller Inventory Mobilization
```

并支持历史模式搜索：

```text
Find Similar Pattern
```

只报告历史统计，不宣称因果必然。

---

# 35. 数据架构

终态直接采用：

## 35.1 Object Storage

存：

- 原始 Provider 响应
- Raw block/trace/instruction artifact
- Contract source
- Program IDL
- Candid
- Simulation artifact
- Agent research
- Parquet
- Snapshot

## 35.2 ClickHouse

Raw Facts / Time Series：

```text
evm_blocks
evm_transactions
evm_logs
evm_traces
evm_transfers
evm_swaps

btc_blocks
btc_transactions
btc_inputs
btc_outputs
btc_outpoints
btc_mempool
btc_protocol_events

sol_slots
sol_transactions
sol_instructions
sol_inner_instructions
sol_token_balances
sol_account_updates
sol_program_events
sol_swaps

platform_launch_events
platform_curve_events
platform_migrations

value_flows
wallet_features
entity_features
market_events
metric_series
```

## 35.3 PostgreSQL

业务对象：

```text
Chain
Provider
Asset
Subject
Contract
Program
Pool
Platform
Launch
Entity
Cluster
LabelObservation
ResolvedLabel
Evidence
Claim
ControlRight
Scenario
AnalysisSnapshot
AnalystOverride
Configuration
```

## 35.4 Apache AGE

只存调查关系图：

- Entity Graph
- Control Graph
- Funding Graph
- Settlement Graph
- Coordination Graph
- Investigation Subgraph

不要把全链所有 transfer edge 全量复制进 AGE。

## 35.5 Cache / Stream

- Valkey/Redis-compatible Cache
- NATS JetStream 或等价轻量消息总线

## 35.6 Workflow

使用 Temporal。

---

# 36. 物理服务架构

不要拆成几十个微服务。

保持：

```text
1. web

2. core-api

3. ingest-workers
   ├─ evm
   ├─ btc
   └─ solana

4. analytics-workers
   ├─ entity
   ├─ labels
   ├─ control
   ├─ market
   ├─ platform
   └─ timeline

5. isolated-simulation-workers
   ├─ anvil
   └─ litesvm

6. sidecars
   ├─ hummingbot
   ├─ slither
   └─ optional external adapters
```

---

# 37. Agent / MCP 架构

内部能力 MCP 化：

```text
chain-mcp
labels-mcp
contract-mcp
program-mcp
platform-mcp
entity-mcp
market-mcp
simulation-mcp
evidence-mcp
claim-mcp
```

Agent 类型：

## Adapter Author Agent

- 搜索官方 docs/GitHub
- 识别 Program/Contract
- 生成 Adapter
- 生成 Fixture
- 运行 Capability Test

## Label Research Agent

- 搜索官方站点
- GitHub
- Dune
- GraphSense
- DefiLlama
- Explorer
- Optional commercial providers
- 输出 LabelObservation

不能直接 Merge Entity。

## Entity Analyst Agent

提出：

- Merge hypothesis
- Split hypothesis
- Coordination hypothesis
- Role hypothesis

最终 Score 由 Feature/Evidence Engine 计算。

## Claim Parser Agent

文本 → Claim。

## QA Replay Agent

- 跑 Golden Case
- 对比历史 Snapshot
- 找 Regression
- 生成 Issue/报告

---

# 38. 完整 UI 要求

UI 必须反向约束后端数据模型。

风格：

- 专业
- 数据密集但清晰
- 支持暗/亮模式
- Desktop 优先，同时响应式
- 禁止用大量无意义大卡片占屏
- 关键结论必须可下钻
- 每个数字必须有 Freshness、Snapshot、Why

---

# 39. UI：Global Intelligence Search

一个输入框支持：

EVM：

- 0x Address
- Contract
- Tx
- Block
- Token Symbol

BTC：

- Address
- TxID
- Block Hash
- Height
- Outpoint
- Inscription
- Rune/BRC20 ticker

Solana：

- Pubkey
- Mint
- Program
- Signature
- Slot
- Pool
- Bonding Curve

通用：

- Entity
- Exchange
- Platform
- Project
- Label

结果显示：

- Chain
- Type
- Entity
- Label
- Confidence
- Freshness

---

# 40. UI：Market Reality

顶部：

```text
Price
Price Confidence
Nominal Market Cap
FDV
Stable Realizable Capacity
Effective Liquidity
EC-10
EC-20
EC-50
Confirmed Controller Supply
Probable Controller Supply
Coordinated Supply
Liquid Controller Supply
Independent Supply
Effective Independent Entities
Organic Flow Ratio
Controller Nominal Value
Controller RV
RCR
Support Capacity
```

Charts：

- Supply Composition
- Controller Concentration
- RV Curve
- Sell Impact Curve
- Liquidity Depth
- Cost Basis
- Cost × Holding Age
- Controller vs Organic Net Flow
- External Capital Flow
- Wallet Activation
- Liquid Controller Supply Timeline

---

# 41. UI：Platform Mechanism Panel

如果 Token 来自 Launchpad，必须自动出现。

显示：

```text
Platform
Platform Version
Lifecycle Stage

Creator
Quote Asset

Curve Type
Curve Progress

Real Reserves
Virtual Reserves

Buy Fee
Sell Fee
Tax

Graduation Condition
Distance to Graduation

Migration Target

Tax Processor/Vault
Dividend
Burn
Liquidity Allocation

LP Status
Fee Rights

Mechanism Snapshot
```

并提供：

```text
View Raw Program/Contract State
```

---

# 42. UI：Address Intelligence

通用：

- Labels
- Entity
- Role
- Same Controller
- Coordination
- Independence
- Assets
- Nominal
- RV
- Funding
- Settlement
- Counterparties
- Timeline
- Evidence

EVM 额外：

- Approvals
- Router
- Contract rights
- Safe

Solana 额外：

- Fee payer behavior
- Signer
- SPL/ATA ownership
- Token Authorities
- Program interaction
- ALT
- CPI
- Sniper/Bot role

BTC 额外：

- Script
- UTXO
- Cluster
- Change evidence
- CoinJoin warning
- Peel chain

---

# 43. UI：Entity Intelligence

显示：

```text
Entity ID
Confidence
Wallet/Address Count
Chains
Roles

Nominal Assets
Realizable Assets

Controlled Token Supply
Liquid Supply

Members
Control Rights
Funding
Settlement
Behavior Similarity
Market Influence
Cross-chain Assets
Timeline
Evidence
```

---

# 44. UI：Controller Graph

使用 Cytoscape.js 或同等级库。

Node：

- Entity
- EVM Address
- Solana Address
- BTC Address
- BTC Cluster
- Contract
- Program
- Token
- Pool
- Safe/Squads
- CEX
- Bridge
- Vault
- Platform

Edge：

- TRANSFER
- FUNDS
- SETTLES_TO
- OWNER
- ADMIN
- SIGNER
- MODULE
- GUARD
- UPGRADE_AUTHORITY
- MINT_AUTHORITY
- LP_OWNER
- SAME_CONTROLLER
- COORDINATED_WITH
- BRIDGE_TO

点击推断边必须打开 Evidence Ledger。

---

# 45. UI：Evidence Ledger

固定格式：

```text
Claim:
A and B likely same controller

Confidence:
0.88

Positive:
+ Settlement convergence
+ Funding ancestor
+ synchronized trades
+ transaction grammar
+ distribution source

Negative:
- independent historical activity
- CEX path break

Coverage:
93%

Model:
entity-vX

Snapshot:
...

Source transactions:
...
```

任何分数必须能解释。

---

# 46. UI：Scenario Lab

选择：

- Controller Entity
- Treasury
- Foundation
- Pension
- Whale
- Coordination Group

参数：

- Sell %
- Sequential / Random
- LP Remove first
- Support capital
- Buyback
- Venue set

结果：

- P10/P50/P90
- Realizable
- Final price
- Liquidity remaining
- Stable extracted
- First mover advantage
- Per Entity result

---

# 47. UI：Claim Audit

粘贴公告 → 自动解析 → 人工可编辑 → Chain Verify。

显示：

- Claimed rule
- Expected amount
- Actual amount
- Destination
- Final destination
- Verified %
- Status

---

# 48. UI：Control Timeline

展示：

- Controller distribution
- Approve/Program preparation
- wallet activation
- test sell
- large sell
- settlement
- CEX deposit
- LP remove
- buyback
- burn
- migration

---

# 49. UI：Analyst Workbench

必须支持：

- Merge Entity
- Split Entity
- Confirm Independent
- Mark CEX
- Mark MM
- Mark Bot
- Mark Controller
- Reject Evidence
- Confirm Evidence
- Add Label
- Add Source
- Override Role

全部审计：

```text
author
time
reason
previous
new
```

---

# 50. UI：Data Health

显示 Provider：

- RPC
- SQD
- Bitcoin Core
- Esplora
- Solana RPC
- Jupiter
- CCXT
- Label Sources
- Simulation Workers

包括：

- Status
- Lag
- Rate Limit
- Last Success
- Current snapshot
- Reorg/fork status

“数据源挂了”不得显示成业务值 0。

---

# 51. API / Backend 契约

API 至少围绕：

```text
/search
/chains
/subjects
/assets
/entities
/evidence
/labels
/control-rights
/platforms
/launches
/markets
/rv
/scenarios
/claims
/timeline
/health
```

所有分析响应至少包含：

```text
snapshot
data_coverage
freshness
source_set
model_version
confidence
```

---

# 52. Snapshot / Replay

每次分析：

EVM：

```text
chain_id
block_number
block_hash
timestamp
```

Bitcoin：

```text
height
block_hash
mempool_snapshot
```

Solana：

```text
slot
blockhash
commitment
timestamp
```

同时记录：

```text
provider_versions
adapter_versions
platform_config_version
entity_model_version
simulation_version
label_snapshot
config_hash
```

任何历史报告必须可重放。

---

# 53. 安全要求

ZeroTrace 默认：

```text
READ ONLY
```

禁止：

- 保存私钥
- 真实 Swap
- Approve
- BTC Broadcast
- Solana SendTransaction
- EVM SendRawTransaction
- Agent 自动操作链上资金

模拟环境：

- Anvil Ephemeral Fork
- LiteSVM Ephemeral
- RPC simulate only

Provider URL：

- SSRF 防护
- allowlist/private network deny
- timeout
- rate limit

Contract/Program 分析：

- sandbox
- CPU/RAM limit
- timeout

---

# 54. 许可证要求

CI 必须生成：

- SPDX
- SBOM
- License Report

特别注意：

- Slither：AGPL
- mempool：AGPL
- Squads V4：核对当前许可证后决定 Sidecar/SDK 使用边界
- Safe Transaction Service：核对当前 FSL/MIT 历史边界
- Uniswap Router：核对版本许可证
- 任何 GPL/AGPL/FSL 组件不得直接复制源码进入 ZeroTrace 核心

宽松许可证优先：

- MIT
- Apache-2.0
- BSD

---

# 55. 推荐 Monorepo

```text
zerotrace/
├─ apps/
│  ├─ web/
│  ├─ api/
│  └─ analyst-console/
│
├─ services/
│  ├─ chain-router/
│  ├─ evm-ingest/
│  ├─ btc-ingest/
│  ├─ solana-ingest/
│  ├─ label-intelligence/
│  ├─ contract-intelligence/
│  ├─ program-intelligence/
│  ├─ platform-intelligence/
│  ├─ entity-engine/
│  ├─ control-engine/
│  ├─ market-engine/
│  ├─ execution-simulator/
│  ├─ scenario-engine/
│  ├─ claim-verifier/
│  ├─ search/
│  └─ agent-gateway/
│
├─ packages/
│  ├─ schemas/
│  ├─ identifiers/
│  ├─ evidence/
│  ├─ chain-adapters/
│  │  ├─ evm/
│  │  ├─ bitcoin/
│  │  └─ solana/
│  ├─ platform-adapters/
│  │  ├─ flap/
│  │  ├─ pump/
│  │  ├─ raydium-launchlab/
│  │  ├─ meteora-dbc/
│  │  ├─ moonshot/
│  │  ├─ four-meme/
│  │  ├─ fomowell/
│  │  └─ generic/
│  ├─ execution-adapters/
│  │  ├─ hummingbot/
│  │  ├─ jupiter/
│  │  ├─ gmgn/
│  │  └─ ccxt/
│  ├─ provider-adapters/
│  ├─ label-adapters/
│  ├─ protocol-adapters/
│  ├─ scoring/
│  ├─ rv/
│  └─ agent-tools/
│
├─ workers/
│  ├─ feature-builder/
│  ├─ cluster-builder/
│  ├─ label-sync/
│  ├─ timeline-builder/
│  ├─ simulation/
│  └─ replay/
│
├─ infra/
│  ├─ postgres/
│  ├─ age/
│  ├─ clickhouse/
│  ├─ object-store/
│  ├─ temporal/
│  ├─ nats/
│  ├─ valkey/
│  └─ observability/
│
├─ fixtures/
│  ├─ evm/
│  ├─ bitcoin/
│  ├─ solana/
│  ├─ platforms/
│  ├─ entities/
│  ├─ labels/
│  └─ markets/
│
├─ evals/
│  ├─ entity-resolution/
│  ├─ coordination/
│  ├─ labels/
│  ├─ rv/
│  ├─ launchpads/
│  ├─ claims/
│  └─ agents/
│
├─ docs/
│  ├─ research/
│  ├─ architecture/
│  └─ testing/
│
├─ AGENTS.md
├─ ARCHITECTURE.md
├─ PROGRESS.md
├─ SECURITY.md
└─ LICENSE_POLICY.md
```

---

# 56. 完整测试要求

测试是产品组成部分，不是收尾任务。

---

# 57. Test Layer 1：Schema Contract

验证：

- Canonical Model
- Ledger adapters
- Platform adapters
- Provider capability
- Snapshot
- Evidence
- Label
- Entity
- ControlRight

Schema migration 必须有回滚/兼容测试。

---

# 58. EVM Golden Tests

至少覆盖：

- Ethereum
- BSC
- Base
- Arbitrum
- Optimism
- Polygon
- Avalanche
- zkEVM 系一条

能力：

- Block
- Tx
- Receipt
- Balance
- Code
- Storage
- Call
- Logs
- Trace
- ERC20
- ERC721
- ERC1155

合约：

- Normal ERC20
- Fee-on-transfer
- Dynamic Tax
- Blacklist
- Whitelist
- MaxTx
- MaxWallet
- Mint
- Trading Switch
- Proxy
- UUPS
- Diamond
- Safe
- V2 LP
- V3 Position

---

# 59. Bitcoin Golden Tests

覆盖：

- P2PKH
- P2SH
- P2WPKH
- P2WSH
- P2TR
- normal multi-input
- change
- peel chain
- address reuse
- exchange fanout
- CoinJoin
- RBF
- CPFP
- mempool
- spent/unspent outpoint
- Ordinal
- Rune
- BRC20 fixture

硬要求：

```text
Known CoinJoin false SameController merge = 0
```

---

# 60. Solana Golden Tests

必须覆盖：

## Core

- Legacy Transaction
- v0 Versioned Transaction
- Address Lookup Table
- Inner Instruction
- CPI
- failed transaction
- multiple signers
- custom fee payer
- compute budget
- WSOL

## SPL

- SPL Token
- Token-2022
- ATA
- PDA
- Mint
- Freeze
- Close
- Transfer Fee
- Permanent Delegate
- Transfer Hook

## Program

- Upgradeable Program
- Immutable Program

## Multisig

- Squads simple threshold
- Roles
- Config Authority
- Spending Limit

## DEX/Launch

- Pump curve buy/sell
- Pump graduation
- PumpSwap
- Jupiter route
- Raydium
- LaunchLab
- Meteora DBC
- Moonshot fixture

---

# 61. Platform Mechanism Tests

## 61.1 Pump

至少 fixture：

1. 刚创建、0/低进度。
2. 曲线中段。
3. 接近毕业。
4. complete 未 migrate。
5. 已 migrate PumpSwap。
6. Creator fee。
7. 新 V2 buy/sell instruction。
8. Token/Quote 新字段。
9. PumpSwap effective quote reserve。
10. early buyer cohort。

验证：

- Platform Stage
- Curve reserve
- Quote
- Fee
- Migration
- Pool
- Creator
- Supply
- RV

## 61.2 Flap

fixture：

1. Standard token curve。
2. Tax V1。
3. Tax V2。
4. VaultPortal。
5. Split Vault。
6. Dividend。
7. Burn。
8. Liquidity allocation。
9. PreBond Tax。
10. DEX migrated tax token。
11. DEX migrated non-tax token。
12. V2/V3 path。
13. anti-farmer config。

验证：

- 不能使用错误旧 curve 参数。
- 真实 config 与 UI 一致。
- Tax Processor 实际分配可回放。
- LP ownership 正确。

## 61.3 Raydium LaunchLab

分别测试：

- Constant Product
- Fixed Price
- Linear Price
- Different fee split
- Graduation
- CPMM
- AMM v4
- Fee Key NFT

## 61.4 Meteora DBC

- Different curve
- Different quote
- fee
- partner
- migration
- DAMM v1
- DAMM v2
- LP locked

## 61.5 Moonshot

- Legacy/current mechanism version detection
- Solana
- EVM
- migration target

## 61.6 Four.meme

- launch
- creator initial buy
- curve
- graduation
- Pancake pool
- LP

## 61.7 FomoWell

由于当前生产协议可能与旧 Docs 不一致：

测试任务首先发现至少 3 个当前真实 Token/Asset：

- active
- migrated/liquidity state
- historical/legacy（若可用）

然后生成 Fixture。

不得用虚构 Canister ID。

## 61.8 GMGN

有 API Key：

- Route result
- Rate limit
- Anti-MEV route metadata
- SOL/BSC/Base/ETH

无 API Key：

- Core app 仍全部通过。
- GMGN 显示 unavailable/optional，而不是 error。

---

# 62. Entity Resolution Tests

高置信 SameController：

```text
Precision >= 98%
```

Coordination：

```text
Precision >= 95%
```

Service Hub：

```text
False Merge <= 0.1%
```

CoinJoin：

```text
False Merge = 0 on Golden set
```

不要为了 Recall 降低 Precision。

如果证据不够：

```text
UNKNOWN
```

是正确输出。

---

# 63. Entity Adversarial Tests

模拟：

- 经 CEX 中转
- Bridge
- 不同 gas/SOL 来源
- 随机金额
- 随机时间
- 不同 Router
- 不同 Jupiter route
- 不同结算地址
- 长期养号
- 多层中转
- Bot 干扰
- 同服务 Provider

系统应降低 Confidence，而不是无证据强行判断。

---

# 64. Label Tests

验证：

- Observation immutable
- Conflict preserved
- Source priority
- freshness
- license
- source evidence

硬规则：

- Risk label 不 Merge。
- 同名不跨链 Merge。
- CEX 触发 Hub Suppression。
- AI Label 必须标 Inference。

---

# 65. Cost Basis Tests

覆盖：

- market buy
- internal transfer
- entity self-transfer
- bridge
- BTC change
- SPL ATA transfer
- mint
- vesting
- LP withdraw

确保内部转账不重置成本。

---

# 66. Realizable Value Tests

## EVM

标准 Token：

Router quote vs Anvil concrete execution：

```text
误差目标 <= 0.5%
```

复杂 Token：

- Anvil concrete execution 为准。

## Solana

针对标准 SPL：

Jupiter quote 与无状态变化下模拟结果应在可解释 Fee/Slippage 范围内一致。

针对 Pump：

Curve Formula 与 Program State/Simulation 一致。

针对 Token-2022：

Transfer Fee/Hook 必须反映在最终 output。

## BTC

给固定：

- Orderbook snapshot
- Amount
- Fee
- Venue set

必须 deterministic。

---

# 67. Scenario Tests

固定：

- Snapshot
- Entity supply
- Pool
- Route
- Seed
- Execution order
- Engine version

必须可完全重复。

---

# 68. Claim Audit Tests

建立 FFT 风格 Fixture：

```text
Tax Receiver 100%
Community 20%
Burn 40%
LP 40%
```

测试：

- 正常执行
- 少发
- 未 Burn
- 假 Burn Wallet
- LP 可撤
- 钱绕回 Controller
- 分多跳后执行

---

# 69. UI Test

使用：

- Unit component tests
- Playwright E2E
- Visual regression
- Accessibility basic checks

必须验证：

- Loading
- Empty
- Error
- Stale Data
- Provider Down
- Unknown
- Conflicting Labels
- Partial Coverage

任何数据缺失不得显示为 0。

---

# 70. UI Evidence Drilldown Acceptance

核心硬验收：

点击：

```text
Controller Supply = 23.8%
```

必须能：

```text
23.8%
→ Entities
→ Entity wallets
→ Evidence
→ Original Tx/Instruction/UTXO
```

如果一个核心指标不能追到原始事实：

> 该指标不得进入正式 UI。

---

# 71. Cross-source Reconciliation

随机抽取 Golden Sample：

EVM：

- RPC
- SQD
- Routescan/Explorer

Bitcoin：

- Bitcoin Core
- SQD
- Esplora

Solana：

- RPC
- SQD
- Carbon decoder

比较：

- tx
- balance
- token transfer
- pool state
- block/slot

冲突必须生成 Data Quality Alert。

---

# 72. Reorg / Fork Tests

EVM：

- Reorg
- Finality depth

BTC：

- competing tip / mempool replacement

Solana：

- processed/confirmed/finalized
- slot fork

分析 Snapshot 默认使用足够确定的 commitment/finality。

---

# 73. Performance / Soak

不要把性能目标写成不现实绝对值。

至少建立 Benchmark：

- 单 Address 查询
- 100 Holder feature build
- 1k Wallet cluster
- 100k Edge graph
- 1M transfer scan
- RV 12 个 quantity point
- 1,000 scenario sequence
- Solana high instruction tx
- BTC large transaction

输出：

- P50/P95 latency
- memory
- CPU
- DB read/write
- RPC calls
- cache hit

建立 regression threshold。

---

# 74. Data Quality

每个 Analysis 计算：

```text
DataCoverage
SourceCoverage
HistoryCoverage
LabelCoverage
SimulationCoverage
```

例如：

```text
Entity Confidence = High
Data Coverage = 42%
```

不能展示为同等可信。

---

# 75. 开发路线与进度

这不是产品阶段，只是依赖顺序。

Agent 必须一直执行到 100%。

## 0–8%

- Repo/Monorepo
- Schema
- Evidence
- Snapshot
- Provider Capability
- UI Route Skeleton
- Fixtures

验收：Schema Contract。

## 8–22%

- EVM Ledger
- Bitcoin Ledger
- Solana Ledger
- SQD
- RPC
- Esplora/Core
- Search

验收：Cross-source Query。

## 22–35%

- EVM contract/program analysis
- Solana program/token authority
- BTC protocol adapter
- Label Intelligence
- Safe/Squads

验收：Control/Label Golden。

## 35–50%

- Platform Engine
- Pump
- Flap
- Raydium
- Meteora
- Moonshot
- Four.meme
- FomoWell
- GMGN optional

验收：Platform Golden。

## 50–66%

- Entity Resolution
- Coordination
- BTC clustering
- Solana cohort
- EVM sybil
- Evidence Fusion
- Analyst Override

验收：Precision Gate。

## 66–78%

- Supply
- Economic Lots
- Cost Basis
- Organic Flow
- Market Venue
- Price Confidence

验收：Market Reconciliation。

## 78–88%

- EVM Anvil RV
- Solana RV
- BTC Orderbook RV
- Shared Liquidity
- Exit Race
- LP removal
- Support

验收：Simulation Determinism。

## 88–94%

- Claim Audit
- Market State
- Timeline
- Pattern Search

验收：Historical Replay。

## 94–98%

- 全 UI
- Evidence drilldown
- MCP
- Agent Console
- Data Health

验收：Playwright End-to-End。

## 98–100%

- Adversarial
- Soak
- Reorg
- Security
- License
- Performance
- Regression

验收：Production Acceptance。

---

# 76. 待测试任务清单

项目代码完成后，以下任务必须全部执行并记录在：

```text
docs/testing/FINAL_ACCEPTANCE.md
```

## 链

- [ ] Ethereum
- [ ] BSC
- [ ] Base
- [ ] Arbitrum
- [ ] Optimism
- [ ] Polygon
- [ ] Avalanche
- [ ] generic custom EVM
- [ ] Bitcoin Mainnet
- [ ] Bitcoin Mempool
- [ ] Solana Mainnet

## 协议

- [ ] ERC20
- [ ] Tax ERC20
- [ ] Proxy
- [ ] Safe
- [ ] V2
- [ ] V3
- [ ] BTC UTXO
- [ ] Ordinals
- [ ] Runes
- [ ] BRC20
- [ ] SPL
- [ ] Token-2022
- [ ] Squads

## 平台

- [ ] Pump
- [ ] PumpSwap
- [ ] Flap
- [ ] Flap Tax V1
- [ ] Flap Tax V2
- [ ] Flap Vault
- [ ] Raydium LaunchLab
- [ ] Meteora DBC
- [ ] Moonshot
- [ ] Four.meme
- [ ] FomoWell
- [ ] GMGN optional adapter

## 盘面

- [ ] Holder reconstruction
- [ ] Entity clustering
- [ ] Coordination
- [ ] Service suppression
- [ ] Bot/MM classification
- [ ] Cost basis
- [ ] Organic flow
- [ ] Controller supply
- [ ] Liquid controller supply
- [ ] Price confidence
- [ ] Effective liquidity
- [ ] RV curve
- [ ] EC-10/20/50
- [ ] Exit Race
- [ ] LP removal
- [ ] Support capacity
- [ ] Market State

## 证据

- [ ] Every core score has Why
- [ ] Every inference has positive evidence
- [ ] Every inference supports negative evidence
- [ ] Every evidence reaches raw fact
- [ ] Unknown supported

## UI

- [ ] Search
- [ ] Market Reality
- [ ] Platform Mechanism
- [ ] Address
- [ ] BTC/UTXO
- [ ] Solana
- [ ] Entity
- [ ] Controller Graph
- [ ] Evidence
- [ ] Flow
- [ ] Liquidity
- [ ] RV
- [ ] Scenario
- [ ] Claim Audit
- [ ] Timeline
- [ ] Analyst Workbench
- [ ] Data Health
- [ ] Agent Console

---

# 77. 研究任务：开发开始前立即执行

不要把本 Prompt 内的 2026-08 研究快照当永久真相。

创建：

```text
docs/research/VERIFIED_SOURCES.md
```

逐项核验最新版本：

## EVM

- BNB Chain public RPC
- SQD EVM datasets
- Sourcify V2
- Hummingbot Gateway
- Foundry
- Safe
- Flap
- Four.meme

## Bitcoin

- Bitcoin Core
- Esplora
- GraphSense
- ord
- OPI

## Solana

- Solana public RPC
- Anza Agave
- SQD solana-mainnet
- Carbon
- Yellowstone
- Vixen
- Jupiter/Metis
- LiteSVM
- Pump
- Raydium
- Meteora
- Squads
- Token-2022

## Platforms

- Flap current deployments
- Pump Program/IDL/current fees
- FomoWell current canisters
- GMGN current API
- Raydium LaunchLab
- Meteora DBC
- Moonshot
- Four.meme

每条记录：

```text
source
official?
retrieved_at
version
chain
program/contract
license
important_change
```

---

# 78. 当前研究基线（只用于引导，不允许硬编码）

以下是 2026-08-09 前后检索到的事实，Agent 必须再次确认：

1. Solana 官方有 public mainnet RPC，但官方明确说明其有 rate limit，且不建议生产高流量应用长期依赖。
2. SQD `solana-mainnet` 当前可从 genesis 查询并支持 realtime。
3. SevenLabs Carbon 当前为活跃 Solana indexing framework，并已存在 Pump/PumpSwap、Raydium Launchpad、Meteora、多个 DEX decoder。
4. Jupiter 当前提供 Metis routing binary / Swap API client 等工具。
5. LiteSVM 是活跃的 Solana 本地 VM 测试/模拟工具。
6. Pump 官方公开 IDL/Program Docs；其 Bonding Curve 使用虚拟/真实 reserve，并在完成后迁移到 PumpSwap。其 Program/fee/account 结构仍在持续更新。
7. Flap 当前支持多套 bonding curve deployment，官方明确建议不要硬编码 curve 参数；Tax Token 支持 PreBond、V1/V2、TaxProcessor、Dividend、Vault。
8. Flap Tax Token 当前可将税配置给 Funds/Burn/Dividend/Liquidity 等用途。
9. FomoWell 的历史公开文档属于 ICP fair launch，“挖井/永久流动性”机制；当前又存在面向 BTC/ckBTC 资产发行和流动性的新版产品，因此必须 runtime discovery。
10. GMGN 当前是 SOL/BSC/Base/ETH 等链的 Trading/Router/Intelligence provider，不应被建模成 Launchpad。
11. Raydium LaunchLab 支持不止一种 curve（constant/fixed/linear）并可迁移到 Raydium pool。
12. Meteora DBC 支持高度可配置 curve、fee、quote、migration。
13. Four.meme 属于 BSC bonding-curve → Pancake liquidity 类 Launchpad，具体阈值不能硬编码。
14. Moonshot 同时存在 Solana/EVM 机制与历史版本差异。

---

# 79. Definition of Done

只有以下全部成立才允许报告“完成”：

- [ ] EVM/BTC/Solana 三类 Ledger 可查询
- [ ] Generic EVM chain 可 Capability Probe
- [ ] BTC address/tx/UTXO/mempool 可查询
- [ ] Solana account/mint/program/signature/slot 可查询
- [ ] SPL ATA/PDA 不被误算成独立真人
- [ ] Token-2022 权限可解析
- [ ] Safe/Squads 实际控制权可解析
- [ ] 多来源 Labels 带出处、版本、冲突
- [ ] Entity 大小号聚类可解释
- [ ] Coordination 与 SameController 分开
- [ ] Service/Router/CEX/Bot 抑制生效
- [ ] BTC CoinJoin 抑制生效
- [ ] Flap/Pump/Raydium/Meteora/Four.meme/Moonshot/FomoWell 平台机制可识别
- [ ] GMGN 可选 Adapter 不影响核心
- [ ] Pre-graduation curve RV 可算
- [ ] Post-graduation DEX RV 可算
- [ ] EVM Anvil simulation 可用
- [ ] Solana simulation 可用
- [ ] BTC orderbook RV 可用
- [ ] Controller RV 与 Nominal 分开
- [ ] Shared Liquidity/Exit Race 可运行
- [ ] LP removal scenario 可运行
- [ ] Claim Audit 可运行
- [ ] Market State 有 Evidence
- [ ] Timeline 可重建
- [ ] 所有核心 UI 可用
- [ ] 所有核心指标可下钻到 raw fact
- [ ] Snapshot 可重放
- [ ] Data Health 正确区分 0/Unknown/Provider Down
- [ ] High-confidence Entity Precision 达标
- [ ] Golden Tests 通过
- [ ] Adversarial Tests 通过
- [ ] Reorg/Fork Tests 通过
- [ ] Security Tests 通过
- [ ] License Gate 通过
- [ ] Playwright End-to-End 通过
- [ ] `docs/testing/FINAL_ACCEPTANCE.md` 完整

---

# 80. Agent 最终交付报告格式

完成全部开发后，只允许按以下结构向用户汇报：

## 1. 完成状态

- Overall: X%
- Production Acceptance: PASS / FAIL

## 2. 已实现模块

逐项列出。

## 3. 复用项目

表格：

```text
Project
Repository
Version/Commit
Purpose
License
Integration Mode
```

## 4. 数据源

```text
Chain
Historical
Current State
Fallback
Labels
Market
```

## 5. 平台支持

```text
Platform
Detected
Curve
Tax
Migration
RV
Golden Test
```

## 6. 测试结果

```text
Unit
Integration
Golden
Entity Eval
RV
Scenario
UI
Security
License
Performance
```

给出真实数字。

## 7. 外部待验证

只允许列因为：

- API Key 缺失
- 官方服务不可达
- 当前网络不存在可用真实 Fixture
- 上游协议刚发生 Breaking Change

而暂时无法验证的项目。

不得用“以后再做”掩盖未开发功能。

## 8. 启动方式

给出：

- 环境变量模板
- Docker Compose / 容器启动
- 开发启动
- 测试启动
- 数据初始化
- Golden Fixture
- 完整验证命令

---

# 81. 最终不可违背的产品判断

ZeroTrace 的价值不在于“显示更多链上数据”。

最终核心护城河必须落在：

1. **Entity Resolution**：一个庄家拆了多少大小号。
2. **Coordination Detection**：不同控制者是否统一行动。
3. **Evidence Fusion**：为什么这么判断。
4. **Supply Reality**：真实筹码结构。
5. **Economic Lot**：真实筹码成本。
6. **Organic Capital**：真正有多少外部资金。
7. **Launch Mechanism Intelligence**：曲线、毕业、税、Vault、LP、平台规则。
8. **Realizable Value**：这批币现在实际上能卖多少钱。
9. **Scenario Engine**：一起跑、撤 LP、护盘后会怎样。
10. **Market State**：盘面现在实际正在发生什么。
11. **Claim Verification**：项目方公开说法与链上事实是否一致。
12. **Analyst Ground Truth**：人工纠正不断形成数据护城河。

系统最终不是回答：

> “这个地址是不是庄家？”

而是回答：

> “这个资产当前实际上由多少独立经济实体参与；哪些实体拥有共同控制权，哪些虽然独立但存在协调；控制方真正控制多少筹码、其中多少现在可立即出售；筹码成本和浮盈在哪里；平台曲线、税费、Vault、毕业和 LP 规则实际如何工作；市场真正有多少外部资本；这些筹码沿当前真实市场路径究竟能兑现多少稳定资产；多个控制实体同时退出、撤 LP 或项目方启动护盘后市场会如何变化；以及所有判断背后的链上证据是什么。”

**不要降低这个最终意图。直接开始开发。**
