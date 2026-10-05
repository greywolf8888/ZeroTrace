# Arc Task Ledger Northflank 实际部署交付

2026-10-05，状态 **PUBLIC_DEPLOYED_WITH_LIMITATIONS**。用户完成账户操作后，本组件已通过 Northflank REST API 实际部署并完成云端验收。新增付费授权为 **0 USD**；截至 2026-10-05T12:36:38.628Z，平台最近 24 小时使用量为 **0 USD**。这项观测不构成永久免费或账单硬上限证明。

公开地址：[Arc 任务证据台](https://web--atl-web--xtd599t97njk.code.run/)。产品版本 **v1.1.0**；实际运行提交 **5d7deacc440505320e7495b3d55c952ece90a35a**，完整复验源码提交 **e934896ebf4361671ec7e27be9e29cd6bd09a5f9**。构建来源为同一仓库的独立分支 [deploy/arc-task-ledger-northflank](https://github.com/greywolf8888/ZeroTrace/tree/5d7deacc440505320e7495b3d55c952ece90a35a)，139 个导出文件与部署 Git blob 摘要一致。API 构建 noiseless-plant-6606、网页构建 dramatic-wall-6514 均 SUCCESS，部署 COMPLETED，镜像和配置摘要见验收记录。最后交付提交只更新文档、无密钥资源记录和收据，未更换执行源码或运行镜像。

## 实际资源

复用既有空 Arc 专用项目 **arctrace / ArcTrace**，区域 **us-central**。此前免费区域、单项目上限和账户支付方式错误原样保留在历史记录；本轮没有添加支付方式、升级或创建新团队。

| 资源         | 实际配置与用途                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------- |
| atl-web      | nf-compute-10，1 实例，公开 8080 HTTP，经平台 HTTPS；同源 /api 代理至 atl-api:8087                |
| atl-api      | nf-compute-10，1 实例，私有 8087 HTTP；API 数据库角色 atl_api_reader，只读                        |
| atl-postgres | PostgreSQL 16，nf-compute-20，1 副本，4096 MiB NVMe；内部连接、TLS verify-full，无外部访问        |
| atl-migrate  | nf-compute-10，计划暂停；固定 API 镜像，原 schema migration 4，原生迁移与角色引导                 |
| atl-sync     | nf-compute-10，每 10 分钟，禁止重叠，240 秒截止，失败自动重试 0；单次原生有界 worker，无 --follow |

用户确认 Sandbox；平台实际接受 2 服务、1 数据库、2 cron，此项资源额度剩余均为 0。数据库最小规格经实际平台拒绝后采用 nf-compute-20，未沿用付费教程参数。构建和流量剩余额度未获可证明数值；没有配置自动扩容、磁盘扩展、付费备份或附加 IP。数据库和 API 未开公开端口。未配置命名网络策略、宿主防火墙或固定出口，不把私有端口标志写成这些能力已完成。

## 实际云端验收

- 当前提交镜像上的迁移 227f99c0-ec0a-4af9-893a-326e8d74bd2c 成功、退出码 0，migration 4；真实数据库权限检查 readerSelect=true、readerInsert=false、workerInsert=true。管理员连接仅迁移使用，worker 与 API 权限分离；网页无数据库凭据，所有工作负载已核查没有 Northflank 管理 Token。稳定游标密钥复用。
- 两次手动有界采集 ae3bf26d-2b16-4286-b8d9-f11e8a09a895、938b0481-9678-4a9d-9768-82c66a9179b6 均 SUCCESS / exitCode=0；原生 worker 记录固定区块、请求数、响应字节、耗时与递增历史检查点。只读取链数据，未签名或广播交易。
- 真实 cron 29e397c7-9772-4dfb-a069-5c34014a2baa 在 **2026-10-05T12:30:00.000Z** 自动触发，**2026-10-05T12:31:45.000Z** 成功结束、退出码 0。观察基线之后手动采集 POST 数为 0；不是以计划已启用代替定时执行。
- API 实际重启后，同一快照 run_203377cfc0c702f996af65e2b5a772f3 的资金与原始回执完全一致，原分页游标仍有效；本轮没有重启数据库，不宣称数据库故障恢复完成。
- 实际 HTTPS 浏览器的分页、任务 #18、金额和原始证据查看通过，页面异常 0，所访问 API 均 200。网页展示存储回放、快照时间、来源和覆盖缺口；截图及原始链上证据选集随收据提供。

## 实际主网结果与覆盖

Arc 主网 **5042**，已登记适配器 **0x73c617e808ed5c7ca41413dfc6ee940ddcbb0b8d**，托管合约 **0x64ca39fc57315d0d488accac07c37c6e841cd058**。云端完成链身份、部署交易回执、代码与协议状态核验，并在 finalized 固定区块 **24390571** 发布快照 **run_60427b582d5c69f3e6701b5e1f51f170**。16 个任务的当前状态与枚举完整；任务 #18 的存入 2 USDC、托管中转 2 USDC、费用 0.02 USDC、奖励 1.98 USDC 均由本轮真实事件和回执支持，49 项证据 payload 摘要复核一致。所有必要资金腿一起确认，不能仅因费用或保证金到账认定全款已确认。

使用官方免费来源 https://rpc.mainnet.arc.io/?atl=northflank-20261005 和正常系统 DNS。普通 URL 的部署回执返回 null，查询隔离 URL 返回真实回执；保留两种观测，不推断未经证明的服务端原因。null 回执的真实反例在旧实现先失败（1 失败、11 通过），修复后专项 13/13，通过 RECEIPT_UNAVAILABLE 分类并继续关闭部署确认；没有更改预期迁就错误输出。

每次历史扫描预算 2000 区块，任务上限 1000；四个定点证据区块每次重新请求。声明窗口从 **23388428** 开始，当前连续核验至 **23400427**，其后至快照区块和窗口之前的历史仍不完整。当前状态不能代替全历史。单官方来源；生命周期、结算、待领取历史与独立来源一致性 partial，正式取证模式 **FAIL_CLOSED_COVERAGE_INSUFFICIENT**。争议胜诉、具体停放款归属、零分配等特殊案例本轮主网 **NOT_OBSERVED**，只保留明确标注的真实本地回归。

两次纯 SELECT 存储测量、检查点、去重回执数与原始文档大小见收据。数据库容量是实际使用量，不能等同原始证据全部历史覆盖。

## 当前源码复验与剩余条件

干净提交 e934896ebf4361671ec7e27be9e29cd6bd09a5f9 的格式、lint、类型、构建、许可证、1043 单元、88 集成（42 外部跳过）、2 评估、5 只读 MCP、52 Rust、49 全仓库浏览器，以及 Arc 81 单元、23 真实本地 PostgreSQL 集成、8 浏览器均通过。独立导出安装、81 单元、构建、实际 TypeScript、许可证及依赖审计通过，独立依赖告警 0；全仓库仍 8 告警（4 high、4 moderate）。本机 Docker 引擎不可用，云端两个镜像已实际构建和运行。旧检查和失败记录保留，未继承历史 PASS。

公开应用与源码已完成；资助申请及身份/资格资料未完成，也未向上游发送消息。全历史、多独立来源、数据库重启恢复、命名网络策略、长期免费或账单硬限制未验证。ZeroTrace 其他终端门禁未提升，main 未合并，用户原有未提交修改保持。

## 可重入操作与回滚

完整主控为 scripts/northflank-orchestrate.mjs，模式 apply / status / sync / restart / schedule；复用 scripts/northflank-deploy.mjs 的官方 API 客户端。此前初建入口的 API_CREATED_PENDING_CONFIGURATION 是历史阶段状态，不代表完整上线。无密钥配置在 infra/northflank/；生产使用固定 SHA/buildId、关闭自动源码触发，并按迁移→API 就绪→有界采集→网页→复采/重启→计划的顺序执行。

本机已有 NORTHFLANK_TOKEN_FILE、NORTHFLANK_STATE_DIR 与 NORTHFLANK_SOURCE_SHA 配置的启动包装已实际执行完整主控；不需要新 Key 或 CLI 登录。复用现有私有状态时必须保留游标及数据库密钥和相同 sourceSha。下列入口仅适用于已正确配置上述变量的进程，不含凭据值：

```powershell
node scripts/northflank-orchestrate.mjs status
node scripts/northflank-orchestrate.mjs apply --sandbox-confirmed-by-user
node scripts/northflank-orchestrate.mjs restart --sandbox-confirmed-by-user
node scripts/northflank-orchestrate.mjs schedule --sandbox-confirmed-by-user
```

回滚先暂停 atl-sync 的计划，核对运行中的任务结束，再将 API、worker、迁移及网页切回同一已验证 SHA/buildId；保持数据库、schema 4 和稳定游标密钥，不 drop schema、不删除项目、不做破坏性降级。配置身份不符或 POST 结果未知时先 GET 对账，禁止盲目重发；外部不可用与版本/资金冲突分层处理。

## 脱敏证据

- [当前完整验收](validation/northflank-hosted-20261005.json)：真实资源、构建、主网回执选集、手动/定时运行、API 重启、费用和剩余条件。
- [脱敏命令](validation/northflank-hosted-commands-20261005.json)：实际请求字段白名单与干净源码检查的时间、命令、退出码及摘要。
- [源码对应](validation/northflank-hosted-source-map-20261005.json)：139 文件清单和关键源文件的 Git blob 摘要。
- [当前网页截图](validation/northflank-hosted-job18-20261005.png)。历史阻塞记录见 NORTHFLANK_DEPLOYMENT_BEFORE_RESUME_20261005.md 与 validation/northflank-before-account-resume-20261005.json；旧预检及本地主网记录不改称云端证明。

公开记录只选取必要链上数据和白名单摘要，没有上传整个私有状态目录。官方接口以本轮下载的实际 schema 和返回值为准：[REST API](https://northflank.com/docs/v1/api/use-the-api)、[计费条件](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)、[定时任务](https://northflank.com/docs/v1/application/run/run-an-image-once-or-on-a-schedule)。

### 有界查询与存储测量补充

实际 HTTPS 复核：单项分页和固定快照游标通过；limit=0/101、篡改游标和更改筛选条件均返回 400。纯 SELECT 测得数据库由 24,976,407 增至 28,318,743 字节，快照 5→6、任务投影 80→96、观察 456→547、去重回执 20→24；新增固定快照需要新的区块锚定回执，不能把跨快照增加视为重复写入。两个手动采集和首个 cron 分别耗时 78,014 / 79,796 / 80,696 ms，均 134 次 RPC、历史推进 2000 区块；响应 586,849 / 585,875 / 592,913 字节。每 10 分钟 2000 区块即实测配置下 12,000 区块/小时；未证明能追平持续增长的主网全历史，240 秒截止不是性能承诺。平台实际构建规格 nf-compute-400-16，运行资源规格如上，本轮账单 0 USD，剩余构建额度不可证明。
