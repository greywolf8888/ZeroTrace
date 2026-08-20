# API 与编排映射

## 当前正式 Token 主路径

```text
POST analyze（ADMISSIBLE/FORENSIC）
  -> 校验请求与持久设施
  -> durable enqueue
  -> 202 QUEUED + jobId
worker claim -> fencing token -> heartbeat/lease
  -> 只读捕获与 checkpoint
  -> PARTIAL/READY/FAILED 状态持久化
GET job -> 轮询状态与已落盘 partial refs
cancel/retry -> 审计化状态转换
```

已修复：正式 handler 不再同步冒充持久工作流；`processOneForensicJob` 有独立 worker 入口；租约 heartbeat、过期恢复、fencing、cancel、retry 与 stale-result 保留已有测试。生产硬编码 creation transaction 映射已删除。

仍未闭合：worker 尚未为任意 Token 生成完整统一 `ReportEnvelope`；完整 Stage lineage、只补缺区间和外部 PostgreSQL 重启恢复没有当前 SHA 的端到端证据。因此 Stage 3 仍为 `PARTIAL`。

## 桌面主路径

```text
Tauri 主窗口
  -> 动态选择 127.0.0.1 端口
  -> 每会话随机 desktop token
  -> 启动打包的 production API sidecar
  -> 注入只读 API origin/token
  -> 加载内嵌 production Web
  -> 退出时终止 sidecar
```

API 仅接受 loopback 且使用等长常量时间 token 比较；生产 Swagger 关闭。Tauri capability 只含 `core:default`，不授予网页任意 shell 能力。
