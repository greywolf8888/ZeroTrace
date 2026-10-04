# Northflank 托管执行记录

2026-10-05，新支出预算为 0 USD。当前状态 **FREE_TIER_UNVERIFIED**；尚未创建云资源、发布 HTTPS 或通过云端验收。当前附件原路径缺失，用户补充的同一管理凭据已在受限本地文件中使用，没有要求登录 CLI 或重新生成 Key。

## 已实际核实

- `GET /v1/auth` 返回 200，Token 有效，团队 `zanetechs-team`，Owner 角色，无到期时间。公开记录不包含 Token、创建者邮箱、数据库密码或响应正文。
- 项目分页已读到 `hasNextPage=false`：仅有 `arctrace`。该项目的服务、数据库、任务列表均为空。没有证据证明该空项目就是本次专用目标，因此未覆盖或更名。
- 最近一天账单汇总返回 200，已计费总额为 0 USD。这只证明历史计费，不证明未来工作负载免费。
- 规格目录中的计算计划全部有非零价格；目录未返回免费计划。官方价格页列出 Sandbox 的 2 个免费服务、1 个免费数据库、2 个免费 cron job，但当前团队的适用资格、规格、构建、磁盘、流量、暂停 cron 手动运行免费条件及剩余额度尚未得到证明。
- Git 集成列表为空。官方源码访问探测返回 `publicRepo=false`、`accessible=false`、`reason=no-linked-access`。本次用户已明确允许公开整个 ZeroTrace，覆盖附件旧的禁止公开条款；尚未执行可见性修改，因为费用门禁未通过，不能产生部署收益。权限有效与构建来源可读分别判断。
- 公开 REST OpenAPI schema 未发现团队 Sandbox 资格或剩余免费额度接口。浏览器当前显示未登录，不能把价格页的宣传或历史零账单当作账户资格。
- 本机 Docker 引擎不可用，不能声称镜像已构建。独立源导出和 Node 构建与容器实际运行分别记录。

## 已完成的托管适配

`scripts/northflank-deploy.mjs` 提供 `discover/plan/apply/status/verify` 的真实只读发现与费用门禁。凭据只从 `NORTHFLANK_API_TOKEN` 或 `NORTHFLANK_TOKEN_FILE` 获取，Token 不进入运行资源、构建参数或 Git。请求只访问官方 HTTPS 主机，禁用重定向，约束超时、响应大小与分页预算。GET 最多重试两次，429 遵守等待时间，写入结果未知时不重发。响应错误正文不输出。公开输出采用字段白名单。

**此版本的 apply 停止在真实费用预检，不包含已验收的资源创建、迁移、部署编排；不能称作部署完成。** 所有计划中规格、区域、数据库版本、构建标识和 URL 保持空值，未猜免费标志或套餐 ID。

`infra/northflank/Dockerfile` 延用已有 API/web 编译流程。网页模板要求实际平台返回的私有 API DNS 与端口，入口只替换这两个变量，保留 `$uri` 和 `$host`；拒绝 Nginx 配置注入。API、迁移与采集继续使用现有 PostgreSQL schema、migration 4、同一数据权威。采集意图是单次 worker，计划默认暂停，未引入新业务功能。

`.dockerignore` 新增私有状态、导出包、环境文件等排除项；原用户修改保留。导出器增加 Northflank 托管文件和客户端，不依赖远端被忽略的 `dist-public`。

## 资源与验收

| 目标                                   | 实际资源 | 当前结果               |
| -------------------------------------- | -------- | ---------------------- |
| arc-task-ledger                        | 无       | 免费条件未核验，未创建 |
| atl-web / atl-api                      | 无       | 未构建部署，HTTPS 无   |
| atl-postgres                           | 无       | 云端迁移未执行         |
| atl-migrate / atl-sync                 | 无       | 未触发，未开启计划     |
| 托管主网身份、部署、固定区块、资金证据 | 无       | 未执行                 |
| 持久化、公开 API、两次采集、重启复核   | 无       | 未执行                 |
| 真实 cron 触发                         | 无       | 未执行                 |
| 平台网络策略、固定出口 IP              | 无       | 未部署                 |

v1.1.0 既有本地主网证明不转移为 Northflank 证明，特殊资金场景仍是明确标注的本地回归。当前完整托管验收未通过，正式取证模式保持关闭。

## 恢复条件与后续顺序

需要该团队真实 Sandbox 资格及选中资源、构建、磁盘、流量和手动 cron 的零费用证明。只补现有资格证明，不增加付费授权、不添加卡、不创建团队规避额度。资格明确后继续执行已授权源码发布或合法源连接，核实平台读取分支，再填当前 schema 的完整请求并补创建/迁移编排与专项测试。

执行顺序仍为：已核验源码与固定构建 → 专用 PostgreSQL 就绪 → 稳定分页密钥及内部数据库连接 → migration 4 实际 exitCode=0 → API readiness → 有界主网采集 → 同源 HTTPS 网页 → 第二次采集与固定快照重启复核 → 开启计划并观察真实 cron run。不能以资源创建 200、首页或手动运行代替这些门禁。回滚保留数据库与分页密钥，仅暂停本项目采集并切回已核验构建。

官方依据：[身份接口](https://northflank.com/docs/v1/api/miscellaneous/auth/get-current-authentication-info)、[计费 API](https://northflank.com/docs/v1/api/billing-api)、[价格页](https://northflank.com/pricing)、[源码访问核验](https://northflank.com/docs/v1/api/team/integrations/check-repository-access)、[统一任务](https://northflank.com/docs/v1/api/project/jobs/create-job)。当前请求记录与源码对应关系见 `validation/northflank-deployment.json`，不交付整个私有状态目录。
