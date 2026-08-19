# 开源复用与 Sidecar 边界

核心仍为 Apache-2.0。允许的 permissive 依赖见根目录 `license:check` allowlist。

| 项目                            | 复用方式                                        | License    | 边界                                     |
| ------------------------------- | ----------------------------------------------- | ---------- | ---------------------------------------- |
| PELT 变化点                     | 自研最小二乘分段（campaign-intelligence）       | Apache-2.0 | 不引入 GPL 实现                          |
| Uniswap V2/V3 / StableSwap 公式 | 自研只读仿真（market-reality-engine + 既有 rv） | Apache-2.0 | 不复制 GPL 接口代码                      |
| Apache AGE                      | 既有可选 sidecar                                | 见上游     | 仅图投影，不进入 permissive 核心源码复制 |
| Cytoscape                       | UI 图渲染                                       | MIT        | 浏览器端                                 |

禁止把 GPL/AGPL/FSL 源码复制进 `packages/` 或 `apps/`。
