# 专用部署与回滚

先完成导出及独立构建：`npm run arc:export`。Compose 的 build context 是候选导出，不是整个 ZeroTrace。不要上传原工作副本、Git 历史、环境文件或私有证据日志。

配置 `ARC_DB_PASSWORD`、`ARC_CURSOR_SECRET` 后执行：

```powershell
docker compose -f infra/arc-task-ledger/compose.yaml config --quiet
docker compose -f infra/arc-task-ledger/compose.yaml build
docker compose -f infra/arc-task-ledger/compose.yaml up -d
```

默认网页仅绑定 `127.0.0.1:5177`。数据库与 API 无宿主端口；只有 `/api` 查询路由被反代。迁移完成后启动 API 与单 worker。数据库数据卷持久化，worker 可重启续作。不得运行上游部署、提款或 approve 脚本。

镜像与配置发布须登记源码 SHA、独立导出文件摘要、实际镜像 digest、脱敏配置摘要、迁移版本 2、启动时间和浏览器记录。没有实际 digest 不能填写示例值为已构建事实。

链访问仅允许版本化配置登记的 HTTPS RPC，连接时检查实际 DNS 地址并拒绝保留/私有网段，禁止重定向，流式响应上限 4 MB。容器防火墙应额外仅允许实际已核验 RPC 公网地址的 TCP 443，并按来源变更更新；不要把连接库校验当成已经安装的宿主出口防火墙。本轮公开部署门禁要求这项外部部署验证，尚未具备目标时保持未通过。

回滚时停止 worker，保存数据库卷，切回已核验镜像 digest。当前迁移只有专用 schema 的新增表和索引，没有 destructive downgrade；不要删除数据库卷或共享业务表。旧 raw observations、runs 和 receipts 保留，通过固定 snapshotRunId 回放。分页密钥不变才能继续旧 cursor；超过快照期限应重新开始列表。

正式上线仍缺：授权目标/域名、实际预算、生产凭据、出口策略、公开访问与主网生产运行证据。仅登录状态不能替代这些授权。
