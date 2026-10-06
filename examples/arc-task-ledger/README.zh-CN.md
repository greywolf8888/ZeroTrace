# 结算结果消费者

实际演示入口为 `/consumer`。输入已登记主网任务编号，页面通过本项目 HTTP API 查询，并使用和任务详情相同的 `SettlementCard` 与 `atl-settlement-result-v2`。这是同一应用的集成演示，不能作为外部采用证明；2026-10-06 审计修复尚未更新公开站点。

v2 的金额按收款角色和分配类型区分：直接奖励、超时份额、保证金、退款与后续领取分别表达。`qualifier` 区分完整精确值、已观察部分、已识别下限和未知；部分历史下不能把未清偿总额写成精确零。后续领取只展示唯一映射的任务义务金额，不展示整个账户提现额。`flows` 是服务器投影的具体分配记录；`PARKED` 表示分配声明，不是已观察现金转移，也不能把中转与最终收款重复求和。

`consumer.ts` 提供独立调用方式：`fetchLedgerJob(baseUrl, '5042', adapter, jobId)`。它验证响应结构、任务身份和快照；API 成功但历史或金额不足返回 `EVIDENCE_INCOMPLETE`，API 失败返回 `API_UNAVAILABLE`。可选上游只读回退不会变成资金确认。任何调用者都应保留结果内的范围和证据链接，不自行把账户 pending 余额归给任务。

固定报告和消费者链接都包含快照编号。详情接口 `/v1/jobs/5042/<adapter>/<jobId>?snapshotRunId=<run>`；完整参数、限额和错误见 `docs/arc-task-ledger/openapi.json`。无需签名或钱包连接，没有链上写入权限，也不发送上游消息。
