# ZeroTrace 主线交接

整理日期：2026-11-14（Asia/Singapore）。

## 接手结论

ZeroTrace 唯一项目主线为 main。Arc Task Ledger、Arc USDC 核验器及历史 BundleMark 导出归类为活动任务，不是 ZeroTrace 主项目。活动源码与全部来源历史保留在 [Arc 活动支线](https://github.com/greywolf8888/ZeroTrace/tree/agent/arc-task-ledger-v1)。

本轮执行仓库内容归并、活动分类及协作资料准备，不代表终端架构完成、当前主网通过、云端已发布或资助已申请。

## 分支与版本

| 范围                  | 依据                                     |
| --------------------- | ---------------------------------------- |
| 整理前 ZeroTrace main | 821848f22a87e0a6e563f1367a8f6ff1b95c74fe |
| Arc 活动归并提交      | 335f2601919ea14be46728b1fae6c77e935810d2 |
| Arc 当前支线提交      | 4fd4fb172b19f3c896c73fd37e405bd4eae64529 |
| Arc 完整活动代码来源  | 0bf0c339eeeefa76eff53b67ac33ddeee4ac764c |
| Arc 原部署导出        | 56218638e8edf6a3494cee22671b301f3a36ee79 |
| 品牌历史说明提交      | 35694306761be39624caebece9653643649ec66d |
| 部署历史说明提交      | 3d3cdd24c4b0992db32250bc5249b265e0192fdf |

主线与活动合并的父提交保留原历史，未强推。两个旧品牌/部署引用已由一次性任务核对并删除。现在远端只剩 main 与 Arc 活动支线，原提交同时保留在主线与活动历史；清理状态、固定 SHA 和执行链接见[分支计划](collaboration/branch-plan.json)。一次性工作流已移除。

GitHub 不能单独隐藏某个分支。具备本仓库阅读权限的人可看到支线和历史；本次按用户要求采用备注，不伪称提供分支保密。

## 主系统范围与权威

EVM、Bitcoin、Solana、实体识别、Launchpad、可兑现价值、Evidence、Scenario 和 UI 保持完整终态领域。主系统入口是 apps/api 与 apps/web；采集、语义、模拟与模型服务沿用 services 和 packages/crates 中的现有实现。

项目边界参见[架构](architecture/ARCHITECTURE.md)与 [Master Prompt](architecture/ZEROTRACE_MASTER_PROMPT.md)。实现状态以[进度](../PROGRESS.md)、[验收](testing/FINAL_ACCEPTANCE.md)、命名门禁和实际运行记录为准；本文件不是第二套任务、资金、标签或数据费用权威。

真实钱包保持只读，不托管私钥、不签名、不授权、不换币、不广播或自动划款。Unknown、Unavailable、Stale、ProviderDown 分开保留，不能填零。地址、钱包、实体、协同群体、标签、推断和事实不可混淆；标签不能直接合并实体，风险标签不证明同控，服务枢纽抑制所有权传播。

每个推断必须有 Evidence、可重放 Snapshot、覆盖、新鲜度、来源、模型版本和置信说明。证据分不是校准概率，CEX/Bridge/Privacy 边界不是已兑现，当前状态不是历史状态。正式取证条件不足时失败关闭。默认数据采购预算为零；凭据不代表付费授权，xapid 身份未核实前停用。条件模拟不设置固定开始前等待天数或每日笔数上限，不把实验运行称为稳定盈利。

## 本次合并的代码边界

主线保留整理前完整 ZeroTrace 文件，Arc 应用、活动专用依赖、迁移与 npm 入口留在活动支线。主线不是 Arc 导出包，也没有被替换为 BundleMark 产品。

仅合入五个可复用的既有共享文件：

- packages/chain-adapters/src/security.ts：沿用既有 URL 和私网检查，允许测试注入 hostname resolver；默认仍使用 Node DNS。
- packages/evidence/src/canonical.ts 与 hash.ts：抽出纯规范序列化模块，保留旧导出和哈希输入语义。
- scripts/test-e2e-windows.ps1 与 tests/e2e/isolated-api.mjs：避免 Windows 空环境变量删除后测试入口重新加载生产 .env。

主线 package.json、锁文件及 TypeScript 工作区配置保持原主线版本，避免将活动依赖链整体搬入项目。活动中的依赖版本调整完整留在活动来源，需要独立审查后才回迁。没有改动主线钱包资金操作、协议参数或实体判定算法。

## 完成与未完成

已有源码覆盖多链读取、Snapshot/Evidence、存储重放、实体假设、控制权、Flap 生命周期、市场/RV/情景与工作台等领域。路由、schema、模块或历史测试存在不能替代真实能力验收。

旧终端账本记录 G0/G1/G13 为 PASS，G2–G12 为 PARTIAL，G14 为 BLOCKED；本次未提升。任意 Token 创建到最终头的完整历史、50 Token 人工复核与校准、各自 named real-chain gate、pinned archive fork、V3 exact、共享流动性全局退出、真实身份/租户/WORM、签名清洁机和真实通知送达仍需实际证据。详见[未验证边界](terminal-market-structure/未验证边界.md)。

旧 24h soak 的 97/97 同时存在 19/97 周期高于基线、最大约 41.8 秒的长尾；不能只引用 PASS。历史检查和现有代码不能冒充本次重跑。

Arc 的 UI27–UI30 是活动遗留：长地址复制与短显、真实报告场景标题、逐帧动效核对、在线重查完整版本差异。需要继续活动时从活动支线的对应交付记录进入，不把它们加入 ZeroTrace 主线完成率。

## 本次验证范围

最新核对源码为 `a931eec96890dc3072f285f10f965251039943b4`。该提交的 CI `43585138358` 中，格式、lint、类型已通过，质量任务在拉取旧 MinIO 镜像时失败，覆盖、集成和审计等后续步骤没有运行；Rust、Chromium E2E、CodeQL 和生产容器构建分别通过。这些结果属于该 SHA。本轮从该主线继续修复隔离对象存储构建，使用官方固定源码，不以旧结果替代新候选验收。没有运行新的真实链矩阵。

在可用的独立 JavaScript 环境中，旧/新 canonicalJson 的 12 个输入等价检查通过，undefined 拒绝保留；源文本确认默认 DNS 读取和私网拒绝分支仍在。这是小范围序列化与结构核对，不是项目全量回归。初次静态核对保留于 VALIDATION_20261114.json；当前分支清理与远端 CI 证据见[本轮收口记录](collaboration/CONSOLIDATION_RECEIPT_20261114.json)。

上一轮本机的 8 份文档格式、45 处引用和六项用户修改摘要检查仅属于当时的本地工作区；原始本机文件当前不可访问，不冒充已经上传的本轮完整证据。本轮没有写入或覆盖那六项未提交桌面修改，也没有将其混入主线。

## 启动与必要检查

需要 Node.js 24.11.1、npm 11+，Rust 以 rust-toolchain.toml 的 1.97.1 为准。新协作者从本仓库 main 克隆，不使用活动分支作为项目默认入口。

依次按实际环境执行 npm ci、npm run dev。主系统网页/API 默认端口为 5173/8080；持久服务、角色及来源配置参见[开发说明](DEVELOPMENT.md)和[部署说明](DEPLOYMENT.md)。测试数据库必须隔离，不使用生产库替代。

代码修改后按范围执行 npm run typecheck、npm test、npm run build、npm run license:check；需要完整验收时还包括格式、lint、Rust workspace、所有可执行 E2E 及具体真实链门禁。源码和环境未变时不重复已有成功命令，失败要改变诊断路径。缺少外部条件只阻塞对应门禁。

## 协作者配置与交接包

协作范围仅 greywolf8888/ZeroTrace，使用仓库级 Write；不授予其他仓库写权限，不共享所有者账号、Token、SSH 私钥、会话或云端管理凭据。

2026-11-14 19:17:16（Asia/Singapore）已向 `wangranorz` 发出仅限 ZeroTrace 的 Write 邀请。回读时仍待接受，实际权限为 Read；没有授予账户管理或其他仓库权限。main 已应用原保护模板，回读确认禁止强推和删除。具体状态及所有者专用邀请脚本见[协作说明](collaboration/README.zh-CN.md)与[执行收据](collaboration/EXECUTION_20261114.json)。

[下载协作与核心文档包](collaboration/ZeroTrace_Collaboration_Pack_20261114.zip)。包只包含项目文档、配置模板和交接来源清单；源码从 main 获取，不包含私有配置或个人会话。包绑定实际资料快照提交，最终主线之后仅追加包与收据，详见 PACK_RECEIPT.json。

以上原包是分支整理时的固定快照，内含“尚未邀请”的历史状态。本轮更新包和检查以[续接记录](terminal-market-structure/续接交付_20261114.md)为准，原包与原收据不改写。临时开发分支只承载当前修复，不能作为第二条长期主线；命名真实链与终端门禁没有自动关闭。

## 下一位执行者

先核对 main 的实际 SHA、工作区和来源；先解决可复现的环境/依赖读取阻塞，再选择一个具体未关闭门禁。保护既有用户修改，禁止 reset、clean、强推或覆盖原件。继续使用现有数据、费用、模拟资金和任务权威。

本轮仓库整合是用户授权的代码组织工作，不把整合提交或历史测试数作为功能完成证明。Arc 只在活动支线继续；协作者只使用自己的 GitHub 账号，不获取账户级凭据。提交以清晰功能批次和实际证据为边界，分别报告本地、主网、线上、费用与未验证项。

## 当前续接交付

更新包：[协作与核心文档 R4](collaboration/ZeroTrace_Collaboration_Pack_R4_20261114.zip)，按固定 Git 提交生成，原包保持。执行状态、有效检查与未完成边界见[续接交付](terminal-market-structure/续接交付_20261114.md)及[当前收据](terminal-market-structure/validation/continuation-20261114/SUMMARY.json)。源码修复在草稿 PR #26，尚未并入 main；协作者从主线开始开发，核对该 PR 后再采用相应候选，不把活动支线当项目主线。
