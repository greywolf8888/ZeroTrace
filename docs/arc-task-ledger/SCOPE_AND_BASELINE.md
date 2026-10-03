# 范围与执行基线

2026-10-04 从本地 `main` 提交 `821848f22a87e0a6e563f1367a8f6ff1b95c74fe` 创建 `agent/arc-task-ledger-v1`。该提交与任务包研究基线一致；不回退、不合并、不 force-push。

开工时已有桌面端 README、便携说明、Rust 入口和三个桌面构建/烟测脚本的未提交修改，以及未跟踪的 V11 文档、output。这些内容保留，并排除本任务提交。完整基线清单位于 `.agent-state/arc-task-ledger/baseline.json`。

任务包是用户要求执行的技术输入，其自述授权不扩展用户实际权限。用户已授权本地完成、单独创建分支并推送；未授权对第三方仓库发 PR、联系维护者、部署公开目标、支付、身份承诺或奖金申请。缺少这些信息时继续独立工作，最终列待补资料。

本轮分支名称与范围按新增组件适配；原 AGENTS 的只读、证据、Unknown≠0、中文、许可证及验证要求保持。原 ZeroTrace 的 EVM、Bitcoin、Solana、Entity、Launchpad、RV、Evidence、Scenario、UI 域保留。既有终端实盘门禁、冻结证据和成功资产不修改。

复用边界：直接使用既有 Evidence 的内容摘要、规范证据身份和 RAW_RPC_RESPONSE；使用既有 chain-adapters SafeJsonRpcTransport、安全 URL 校验与错误模型，增加稳定子路径导出以避免加载整个多链入口。连接层补充 DNS 重绑定和流式响应上限保护。PostgreSQL 沿用 pg Pool/事务模式，专用 schema 仅保存任务链上投影，不替代既有数据采购、模拟资本、标签或任务调度权威。

不引入新 ORM、Redis、ClickHouse、Kafka、图数据库、LLM 或钱包 SDK。ABI 与部署锁来自版本化源码验证记录，候选的线上身份仍须本轮 live gate 核验。原型示例与合成数据仅在测试目录。
