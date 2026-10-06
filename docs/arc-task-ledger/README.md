# Arc 任务证据组件 v1.2.1 候选

本组件在现有 ZeroTrace 中新增独立只读入口，查询 Arc 主网 5042 上单一已登记 ArcBounty 部署的任务历史、奖励、费用、保证金、退款及账户待领取证据。链上访问不包含签名、授权、提款、交易广播或托管。

代码版本为 v1.2.1；当前修复与剩余门禁见 [审计修复](UI_AUDIT_CORRECTION_20261006.md)。旧 v1.2.0 实际托管记录见 [产品交付](PRODUCT_DELIVERY_20261006.md)，不代表当前候选已部署。本地修复、主网覆盖、公开部署、申请就绪分别记录；页面或测试通过不等于全主网、公开部署或申请完成。

## 本地运行

在原 ZeroTrace 工作副本中沿用 Node 24、npm 11 和锁文件。安装不执行依赖生命周期脚本：

```powershell
npm ci --ignore-scripts
npm run arc:build
$env:ARC_DATABASE_URL = '<本组件专用 PostgreSQL 连接>'
$env:ARC_CURSOR_SECRET = '<至少32字节的稳定随机分页签名密钥>'
npm run arc:migrate
npm run arc:worker -- --current-only
npm run arc:dev
```

独立导出包不依赖原仓库的开发编排脚本。安装、构建、配置数据库与迁移后，在两个终端分别执行 `npm run arc:start` 和 `npm run dev -w @zerotrace/arc-task-ledger-web`；worker 单独执行 `npm run arc:worker`。生产同源入口参见 Compose 部署。

默认 API 为 `127.0.0.1:8087`，网页为 `127.0.0.1:5177`。本轮自动建立的隔离本地 PostgreSQL 位于 `.agent-state/arc-task-ledger/postgres`，端口 55487；`arc_task_ledger_local` 保存本地只读运行记录，`arc_task_ledger_test` 仅供测试；最终复验改用 C 盘临时测试集群（端口 55488），连接见私有配置。连接与启动配置在同目录 `local-config.json`，不会提交或导出。主网连接受阻时页面显示明确缺数，不注入演示任务。

`npm run arc:worker` 执行一个有界同步批次；`--follow` 启用前台增量 worker，首次立即采集，之后按 `ARC_SYNC_INTERVAL_MS` 运行。默认五分钟，限一分钟至一小时；不是协议参数。退出后不启动 Codex 自动任务。`ARC_MAX_JOBS` 默认 1000，`ARC_SCAN_BLOCK_BUDGET` 默认每批 20000 区块、上限 200000，均为本组件资源控制。达到预算显示不完整，不能宣称历史完整。

API 只读取已发布的 PostgreSQL 投影，不因匿名 GET 启动 RPC 扫描。分页绑定快照、筛选摘要与签名，过期返回 410；任务编号按精确数值排序。`ARC_CURSOR_SECRET` 必须跨重启保持稳定。任务详情也可传 `snapshotRunId`，避免追随最新区块改变结果。

## 接口与证据

- `GET /v1/jobs`：任务列表，支持角色地址、业务状态、现金状态筛选及固定快照分页。
- `GET /v1/jobs/{chainId}/{adapter}/{jobId}`：原始合约状态、独立资金腿、事件时间线、账户待领取、证据与规则版本；`format=json` 导出。
- `GET /v1/coverage`：各维覆盖、状态/连续历史水位、最近同步尝试、来源故障与正式模式关闭原因。
- `/healthz` 表示进程存在；`/readyz` 核验持久存储及迁移。两者均不代表主网实时正常。

正式 API 契约位于 [openapi.json](openapi.json)。已知值、未知、不可用、冲突、未支持使用 Knowledge 对象；陈旧与来源故障由 freshness 单独表达。布尔 false 与整数零保留真实值。金额为十进制原子字符串，原生精度 18 位，协议精度 6 位，不能经过浮点转换。

`Completed`、`ProtocolFeePaid`、保证金退款声明均不独立证明现金到账。系统 USDC Transfer 是规范现金观察，ERC-20 Transfer 仅交叉核验；不重复入账。交易失败、未知版本、冲突、任务/角色不唯一时不能形成直接到账确认。账户提现没有任务编号，只在完整有序账户序列、核验开启余额及守恒条件下推导已领取；不使用 FIFO/LIFO 分摊。

同高度读取采用区块编号固定加读取前后摘要核对。当前版本没有声称 EIP-1898 已实测。启动先核验 finalized 锚点、部署回执、链上 adapter/escrow/implementation 字节码、代理实现槽和 view getters；任何版本不一致隔离解析并保留原始观察。

PostgreSQL 专用 schema 是唯一持久源。原始观察追加写，回执按来源/区块版本保留；交易数据、任务快照、资金腿与账户投影分别保存在观察或运行文档中。窗口数据与检查点在同一事务提交，CAS 水位只跨越连续完成区间。worker 的写事务绑定持有 advisory lock 的数据库连接，失去该连接便不能继续写入。

当前状态、任务枚举、生命周期历史、结算历史、账户历史、部署核验、来源一致性分别说明范围。来源故障保留旧快照，并显示 provider-down；正式取证模式在必要覆盖、存储、来源或回放不足时关闭。

## 验证

```powershell
$env:ARC_TEST_DATABASE_URL = '<专用 arc_task_ledger_test 数据库连接>'
npm run arc:test:unit
npm run arc:test:integration
npm run arc:test:e2e
npm run arc:build
npm run arc:test:live
```

测试数据库名称强制为 `arc_task_ledger_test`，不存在时失败而非全部跳过。测试清理只针对该库中的专用 schema。浏览器测试使用独立入口和明确标记的合成记录，生产入口不导入测试目录。

任务包工具在 Windows 上存在路径索引和 npm.CMD 引用兼容问题。`python scripts/arc-pack-compat.py` 在内存中修正索引后核验原 manifest，不改原包。命令收据通过原 `record_check.py` 调用 Node 的 npm CLI 入口生成，避免 .CMD 双重引用。

## 部署、导出和接入

`npm run arc:export` 生成 `dist-public/arc-task-ledger`：只包含所需源码、依赖闭合的锁文件、中文文档、许可证与明确文件清单，不包含 `.git`、`.env`、私有运行日志、任务研究包或原 ZeroTrace 的其他产品模块。导出必须在干净目录独立安装构建，见最终收据。

`infra/arc-task-ledger/compose.yaml` 提供专用数据库、迁移、API、单 worker 和同源静态网页。API 与数据库不向宿主暴露；容器使用非 root 用户。公开部署前需要实际目标、预算、稳定密钥、数据卷、镜像摘要及容器出口策略验证。现有账号凭据不代表发布权限，本轮不会自行发布或申请奖金。

最小接入示例为 `examples/arc-task-ledger/consumer.ts`。它只替换数据读取，回退时明确 datasource 与 degraded，不把原始“业务完成”混为现金到账。本地 consumer 通过不能宣称 ArcBounty 已采用。

协议接口来自锁定上游 [ArcBounty 源码](https://github.com/Sofiia7/ARC/tree/ef5d100882a4bfe475c685586902ecc72da420e8)，MIT 许可证见 [上游许可](UPSTREAM_LICENSE.txt)。ABI 与字节码参考 [Sourcify 精确匹配记录](https://sourcify.dev/server/v2/contract/5042/0x73c617e808ED5c7Ca41413DFC6EE940dDcBb0b8D?fields=all)。官方 [网络连接说明](https://docs.arc.network/arc/references/connect-to-arc) 和 [USDC 精度说明](https://docs.arc.network/arc/references/gas-and-fees) 是网络研究来源。源码验证记录不替代本次生产主网执行。

## v1.0.1安全解析与定点证据

系统DNS异常时可显式设置 `$env:ARC_DNS_MODE = 'google-doh'`；默认仍为system，不修改系统网络配置。Google官方bootstrap为8.8.8.8，HTTPS域名及RPC域名TLS验证保留；返回私网/保留地址仍拒绝。

`ARC_EVIDENCE_BLOCKS`为可选逗号分隔区块编号，最多10个，必须介于已验证部署与本轮finalized快照之间。例如真实任务#18核验使用 `23388428,23465819,23466663,23508410`。候选编号只作定位，每个区块重新通过RPC完整日志、回执、锚点及历史部署版本核验。配合`--current-only`只补定点证据，不能宣布全历史complete；该参数不改变原连续水位规则。

迁移3必须先执行`arc:migrate`；列表仅查询投影和证据ID。API的Fastify类型解析与该workspace实际依赖版本一致，独立导出回落到根安装路径，不以类型强制转换掩盖插件版本差异。
