# Northflank 实际执行与交付

2026-10-05，当前状态 **BLOCKED_EXTERNAL / ACCOUNT_PAYMENT_METHOD_REQUIRED**。已经按用户确认的官方免费 Sandbox 执行实际创建，新增付费授权为 0 USD。平台在创建服务时返回 HTTP 409，要求先添加默认支付方式。此条件来自平台的真实响应，不再等待免费资格证明；没有执行添加卡或升级。

## 已完成的实际操作

- 用户已授权公开整个 ZeroTrace，仓库现为 PUBLIC。独立源码分支为 [deploy/arc-task-ledger-northflank](https://github.com/greywolf8888/ZeroTrace/tree/deploy/arc-task-ledger-northflank)。Northflank 源码探测返回 200：publicRepo=true、accessible=true、reason=public；没有要求 CLI 登录或新 Key。
- 在 asia-southeast 创建专用项目返回 409：Region does not support free projects.；改用 us-central 后返回 409：Maximum number of free projects reached。
- 该账户已有唯一空项目 arctrace（显示名 ArcTrace），服务、数据库、任务均为 0。免费 Sandbox 只允许一个项目，因此复用这个空的 Arc 项目作为本组件的目标；实际 ID 保持 arctrace，没有假称新项目已创建或更名。
- 项目说明更新发生连接中断，随即 GET 核对，说明仍为空。没有盲目重发未知结果的写入。
- POST /v1/projects/arctrace/services/combined 实际返回 409：Please complete your account by adding a default payment method.。API 未创建，后续数据库、迁移、网页与采集未触发。
- 管理凭据仅置于 Git 和构建上下文之外的受限本地文件；公开记录采用字段白名单，没有 Token、数据库密码或整份私有状态。既有代码与用户未提交修改保留，main 未合并。

## 代码与本地验证

scripts/northflank-deploy.mjs 支持官方 HTTPS、有界分页/响应/超时、受限 GET 重试、写入未知结果核对。apply 在明确用户确认 Sandbox 时执行真实 API 创建，使用明确选择的空 Arc 项目；默认不从标价或零历史账单推断授权。平台三种实际 409 分别分类为支付方式要求、免费项目额度及免费区域限制。创建请求先设实例为 0、端口私有、关闭自动源码触发与持久构建缓存。目录规格变化或已有资源冲突时停止，避免覆盖共享状态。

此版本入口完成第一项创建尝试；即使平台将来接受创建，也只会返回 API_CREATED_PENDING_CONFIGURATION，不能当作完整迁移或上线成功。后续资源创建、固定提交构建、实际迁移和全部云门禁仍需在账户条件解除后完成并实测。管理 Token 不进入工作负载。

Dockerfile 与 Nginx 延用现有 API/web；迁移继续使用原 schema 的版本 4，worker 为单次有界采集，cron 默认暂停。同源代理只替换实际私有 DNS/端口，保留 Nginx 自身变量。Docker 引擎不可用，镜像实际构建与运行尚未验收。

新增回归先在旧实现得到 4 失败／11 通过，修改后托管专项 15/15 通过；这是本地测试证据，不是平台部署证明。当前干净提交、后续检查与脱敏命令见 validation/northflank-deployment.json。旧预检完整保存在 validation/northflank-preflight-20261004.json，没有覆盖历史失败或继承其 PASS。

## 实际资源与云端门禁

| 项目                                     | 实际状态                                     |
| ---------------------------------------- | -------------------------------------------- |
| arctrace / ArcTrace                      | 既有空项目，us-central；作为本组件拟复用目标 |
| atl-api、atl-web                         | 未创建；没有平台构建 ID、部署版本或 HTTPS    |
| atl-postgres                             | 未创建；云端 migration 4 未运行              |
| atl-migrate、atl-sync                    | 未创建；手动及定时运行均未发生               |
| 主网链身份、部署、固定区块、任务资金结果 | 云端未执行                                   |
| 持久化、API 展示、两次采集与重启复核     | 云端未执行                                   |
| 网络策略与真实 cron 触发                 | 未部署／未执行                               |

候选产品版本为 v1.1.0，部署版本为空。本地既有任务 #18 及窗口证明保持原来源和覆盖边界，不能改称 Northflank 实际观察。窗口外和账户全历史仍 partial，正式取证模式关闭。特殊结算案例仍仅为明确标注的本地回归。

## 外部阻塞与恢复顺序

Northflank 官方要求所有套餐先添加默认支付方式才能创建运行资源；免费套餐存在并不会跳过这一账户门槛。现有授权不包含添加支付方式，不能替用户补卡或升级。当前没有可交付的在线 URL，不能以源码公开或测试通过代替上线。

账户允许创建后继续：固定提交构建 → 私有 PostgreSQL 就绪 → 稳定分页密钥和真实内部连接 → migration 4 exitCode=0 → API readiness → 有界真实主网采集 → 同源 HTTPS 网页 → 第二次采集与固定快照重启复核 → 观察真实 cron。回滚保留数据库和分页密钥，仅暂停本组件任务并切回已验证构建。

官方依据：[账户创建资源与支付方式要求](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)、[免费项目限制](https://northflank.com/docs/v1/application/getting-started/create-a-project)、[源码访问接口](https://northflank.com/docs/v1/api/team/integrations/check-repository-access)。

## 当前提交复验与本地实时链读取

干净提交 7d6593d12020749c7988cdd6fa70092b2bacecad 的格式、lint、类型、构建、许可证、1043 单元、88 集成（42 外部跳过）、2 评估、5 只读 MCP、52 Rust、49 全仓库浏览器及 Arc 75 单元／23 PostgreSQL／8 浏览器全部完成。官方 RPC 于 2026-10-05T08:33:21.867Z 核验 Arc 5042 finalized 区块 24362547、部署回执、代码/代理槽及 view 配置，原始观察选择导出至 validation/northflank-local-anchor-20261005.json。系统 DNS 与两个来源前序部署核验失败保留；当前成功不构成独立来源一致性或 Northflank 验收，任务资金本轮未重采，正式取证关闭。
