# 基线与 SHA

| 项目                         | 值                                         |
| ---------------------------- | ------------------------------------------ |
| 起始 `main` / `origin/main`  | `68ebfd9ae92305dd47bbc3175af07bda1a172c61` |
| 主分支合入工作分支的历史合并 | `4436f7765c2602671cf8210bad47d360ec351281` |
| Truth Map                    | `136d69f`                                  |
| P0 语义与算法修复            | `22c5fde`                                  |
| 持久任务与 fenced worker     | `7d174d7`                                  |
| 四入口安全 Tauri 工作站      | `a0262f08adec9b9017e859b361b539204ac09999` |
| 工作分支                     | `agent/terminal-market-structure-v1`       |
| 工作区                       | `F:\ZeroTrace`                             |

## 当前实现候选门禁摘要

- `npm run test:coverage`：171 文件通过、7 文件跳过；1015 测试通过、40 测试跳过；Statements 83.04%、Branches 75.02%、Functions 91.30%、Lines 84.61%。
- `npm run test:e2e`：Chromium desktop/mobile 42/42；Windows 自启动包装器抽样 2/2。
- `npm run verify:terminal`：Rust fmt、workspace Clippy `-D warnings`、workspace tests、架构检查、57 个性质测试、30 个取证黄金测试通过。
- `npm run test:formula:diff`：修复失效门禁与冷编译超时后连续两轮 2/2。
- `npm run test:live`：当前 SHA 上 9 个用例，8 PASS、1 UNSUPPORTED、0 FAIL、0 BLOCKED_EXTERNAL。
- `npm run test:performance`：`NOT_RUN`；`npm run test:soak`：`NOT_RUN`。
- `npm run desktop:build`：release profile `7m40s`，NSIS 成功；隔离目录安装、启动、loopback sidecar 监听和卸载均通过。

## 最终本机制品

| 制品                                                                  |       字节 | SHA-256                                                            | Authenticode |
| --------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------ | ------------ |
| `target/release/bundle/nsis/ZeroTrace 只读工作站_0.1.0_x64-setup.exe` | 21,108,045 | `CE8AB8DC8AB91D6F18443C6889CEDF0EA9D42D5F75793F7B02AC5BD1C02CC03C` | `NotSigned`  |
| `target/release/zerotrace-desktop.exe`                                | 13,536,768 | `2C4A5528001D06959D9CDCAE4A7101872503AF42EE71D57956CAD47CD625ECE3` | `NotSigned`  |

以上是本机工程/捕获证据，不是清洁机器、人工语料、签名、固定硬件性能或 24h Soak 证据。
