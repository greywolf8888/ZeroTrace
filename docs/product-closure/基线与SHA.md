# 基线与 SHA

| 项目                  | 值                                         |
| --------------------- | ------------------------------------------ |
| 记录日期              | 2026-08-21                                 |
| `origin/main`         | `68ebfd9ae92305dd47bbc3175af07bda1a172c61` |
| 本地 `main`（开工时） | `68ebfd9ae92305dd47bbc3175af07bda1a172c61` |
| 工作分支              | `agent/terminal-market-structure-v1`       |
| 同步 main 的合并提交  | `4436f7765c2602671cf8210bad47d360ec351281` |
| 工作区                | `F:\ZeroTrace`                             |

## 基线命令

```powershell
git fetch --prune origin
git rev-parse main
git rev-parse origin/main
npm run verify:full
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

## 基线结果

- `npm run verify:full`：格式、lint、typecheck、922 项单元、88 项集成、构建、许可证、依赖审计、架构、schema drift 和覆盖率通过；E2E 在 12 workers 下 33 失败、9 通过。
- E2E 失败共同症状：`Tearing down context exceeded test timeout 30000ms`，不是页面断言失败。
- 限制 Windows 默认 worker 后：`npx playwright test --project=chromium-desktop` 为 21/21；`npm run test:e2e` 为 42/42。
- Rust 基线：format、clippy `-D warnings` 与 workspace test 全部通过。

## 证据边界

以上是本机工程回归证据，不是清洁机器安装、真实全生命周期、人工语料、签名或 24h Soak 证据。所有后续证据必须绑定生成时 SHA；脏工作区上的结果只作为开发证据，不得升级为 Release evidence。
