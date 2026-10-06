# Arc USDC 核验 API / Verification API

这是现有 Arc 组件的新增接口，链上始终只读。公开网页的 API 基地址是网页地址加 `/api`；本地独立 API 可直接使用其 origin。旧 `/v1/jobs`、固定任务报告和分页接口继续保留。

## 会话与工作请求

`POST /v1/sessions` 创建或复用七天会话。浏览器要求同源 Origin，并通过 HttpOnly、SameSite=Strict Cookie 持有身份；生产 Cookie 使用 Secure。返回 csrfToken。独立客户端发送 `X-Arc-Client: zasv-sdk-v1`，响应额外含 sessionToken；后续使用 `Authorization: Bearer …`。客户端不得把这些凭据放到 URL、原件包或公开日志。

所有工作 POST 必须发送 `X-ZASV-CSRF`。核验、重查和发布另要求 `Idempotency-Key`，16—100个字母、数字、下划线或连字符；同键不同输入返回409。失败后使用新键发起新的明确请求。进行中的同键请求返回202 VERIFICATION_RUNNING，不产生第二条链查询。

成功核验与重查返回持久 `requestId`。`GET /v1/verifications/:id` 只读取该会话自己的 RUNNING/COMPLETED/FAILED 状态，完成时返回固定结果，不进行 RPC、回收或重跑；无会话401，其他所有者/不存在404。SDK 提供 `status(id)`；202 的 `VerifierApiError.requestId` 可用于明确状态读取。报告会话过期或丢失无法恢复私有权限，请及时导出；报告本身不会随会话过期而删除。

`POST /v1/verifications` 接受 `{transaction, expectation? , task?}`。transaction 只能是 Arc 主网规范哈希或登记的 explorer 交易链接。没有 expectation 时只是交易观察；不能声称订单已付款。expectation 为 zasv-expectation-v1，包含 chainId、asset、expectedPayee、可选 expectedMovementPayer、EXACT/RANGE、精确 min/maxAmountAtomic18、可选 UTC notBefore/deadline、明确同交易 selection、可选私有 contextRef、provenance。金额必须是整数字符串。provenance 普通入口为 USER_INPUT 或 REPORT_IMPORT，不能自行声称 REGISTERED_TASK。

task 为 `{jobId,snapshotRunId,legId}`，只能引用原持久任务投影。任务金额、收款人和可选付款人必须与固定协议条件相同；手改条件使用普通入口。报告原件保留任务来源与规则版本，交易仍重新读取。`GET /v1/task-conditions/:jobId?snapshotRunId=…&legId=…&transaction=…` 只读取已有固定任务条件，不触发 RPC。

核验响应分别提供 observation.acquisition、report、expectation、evaluation、Evidence、Snapshot、coverage、freshness、sourceSet 与未校准 confidence。返回200不代表 MATCHED；消费方必须检查 evaluation.outcome 以及逐项 checks。来源错误、限额、pending、冲突的原件及原因保持明确，未知金额为 null。

## 固定报告与复核

`GET /v1/reports/:id`、`GET /v1/reports/:id/bundle` 只读取持久数据。报告默认仅所属会话可见；已明确公开的固定原件版本可匿名读。未授权和不存在均返回404。GET 不查询链、不自动换金额、不依赖旧列表快照TTL。报告内容及已有原件不能覆盖；后续采集作为附件追加。

`POST /v1/reports/:id/recheck` 仅报告所属会话可以执行，重新查询链并按原冻结条件核对。返回 previousReportId、factsChanged；相同事实与条件可以得到相同 reportId，但新原件的 bundleHash 可不同。旧报告及公开原件附件仍保留。

`POST /v1/reports/:id/share-preview` 返回完整公开报告预览、bundleHash 和移除字段说明；删除 expectation.contextRef。公开内容含链上原件、地址、条件、来源别名和采集时间。`POST /v1/reports/:id/publish` 必须明确提交预览的 `{confirmReportId,confirmBundleHash}`。公开固定版本不能替换或撤回。公开报告链接为 `/?report=…`；原私有版本继续保留。

`POST /v1/replay` 在服务器复算有界JSON包，不触发RPC。本机独立复算入口是 `examples/arc-task-ledger/replay-bundle.ts`，浏览器也可直接导入JSON文件离线复算。复算重新解析原始回执并核对三层标识，而非只比较外层哈希。未知规则返回422。离线一致不证明数据来自主网；原件自洽的合成包不能获得主网真实性背书。

## 有界资源和错误

每个 API 进程共享2并发、每秒2次RPC；单次最多24 RPC、8MiB链响应、45秒。持久工作全局2并发，单会话30/24小时、全局200/24小时。最多1000报告、128MiB原件，单包16MiB，公开分享10/会话/24小时。容量达到上限时已有报告仍可读，不自动删除报告。旧任务同步使用既有独立进程和权限；这些限制是工程策略，不是链协议参数。

错误响应为 `{code,message,retryable}`。常用状态：400输入不合法；401无会话；403来源或CSRF拒绝；404无报告权限；409输入/版本/原件冲突；422未知规则或无法确定任务条件；429频率/配额/容量达到上限；503持久写入或来源不可用。不得把这些情况转为金额0或付款成功。

## Independent client contract

机器可读规范见 `openapi.json`。`GET /v1/verifier/examples` 只展示最多三份实际已明确公开、条件核对 MATCHED 的固定报告；没有种子示例，不触发链查询。公开预览包含即将分享的完整原件包，说明公开内容也可能进入该示例列表。

Use `ArcUsdcClient` from `examples/arc-task-ledger/verifier-client.ts`. Start a private session, verify one transaction with an explicit expectation, inspect each check, fetch the bundle, and preview before publication. GET never starts RPC work. An identical idempotency key cannot bind different input. Reports are content-addressed; changing conditions creates a different report. Requery preserves earlier versions.

For offline use, run `npx tsx examples/arc-task-ledger/replay-bundle.ts bundle.json`. For local accounting, run `npx tsx examples/arc-task-ledger/reconcile.ts bundle.json local.sqlite namespace business_reference`. A public API bundle may be supplied as `https://SITE/api#REPORT_ID`. The separate process allocates only MATCHED selected movements in its own namespace, enforced by a SQLite unique constraint. It does not transfer funds, establish order attribution, or mark delivery complete. MISMATCHED/INCONCLUSIVE/UNSUPPORTED produce NO_ALLOCATION; API failures and tampering are rejected. Offline authenticity remains NOT_VERIFIED_OFFLINE.
