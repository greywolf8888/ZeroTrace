# API 与编排映射

## 当前 Token 主路径

```text
POST analyze
  -> 校验 TokenAnalyzeRequest
  -> 正式模式检查 PostgresJobQueue
  -> enqueue TOKEN_MARKET_STRUCTURE
  -> HTTP handler 内 inspectFlapToken
  -> materializeTokenMarketStructure
  -> 保存 ReportEnvelope
  -> queue.succeed
  -> 同步返回报告
```

问题：入队记录存在，但 provider 调用和物化仍在 HTTP handler；`processOneForensicJob` 没有生产循环，故“durable worker 是唯一执行主链”尚不成立。

## 目标主路径

```text
POST analyze -> 幂等创建/重开案件 -> durable enqueue -> 202 QUEUED
worker claim -> lease/checkpoint -> 查询 Coverage -> 只补缺口
-> 按 Stage 落盘原始资料/事实/报告 -> READY/PARTIAL/BLOCKED
GET job/case -> 返回持久状态和 partial result refs
cancel/retry -> 审计化状态转换
```

## 已确认边界

- 正式模式没有 durable queue 时返回 `JOB_QUEUE_UNAVAILABLE`，不得退回 Map。
- 正式报告没有 PostgreSQL 时返回 `FORENSIC_STORE_UNAVAILABLE`。
- research 模式允许本机同步降级，但不能作为生产取证证据。
- `PostgresJobQueue` 已有幂等键、claim、lease、fencing token、checkpoint、重试上限和 dead-letter 基础；缺 heartbeat、cancel/retry 转换与阶段级结构化持久化。
