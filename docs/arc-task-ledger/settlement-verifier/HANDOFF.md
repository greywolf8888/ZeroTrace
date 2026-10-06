# Arc USDC 核验器交付状态

本轮基线为实际最新 agent/arc-task-ledger-v1 的48582b9。旧规则atl-v1.2.1保持，新核验器规则zasv-rules-v1.0.0、解析器zasv-usdc-parser-v1.0.0、接口zasv-interface-v1、迁移7。API/Web2.0.0，共享Arc包1.3.0。未合并main、未强推、未修改桌面六项用户改动。

交易→选择真实资金边→冻结收款条件→逐项核对→持久报告→显式分享/导出→独立复算和对账已在真实主网只读链路执行。原生/ERC20镜像均有实际样本，反事实条件生成不匹配/未知。独立对账进程只写自身SQLite，不移动资金或确认履约。

本轮Arc单元114项、PG集成42项、桌面/手机浏览器28项通过。根lint/typecheck/unit/integration/evals/MCP/build/license及Rust工作区通过，全仓库浏览器49项重试通过。初次启动、旧首屏布局、设备项目合并触发限流的失败保留。根格式曾因任务输入JSON和自有文件失败；自有代码已格式化，原任务包保持原始内容，不能伪造全根格式PASS。

生产数据库实际备份后，在独立PG恢复全部Arc对象和数据。迁移6→7前后六个旧表摘要/数量相同；真实隔离重启后19个报告原件保持一致。托管pg_stat_kcache扩展不属Arc恢复范围，未声称完整平台恢复，未重启共享或生产数据库。

当前候选待干净独立构建和云端滚动更新。旧公开8f2d479不是本轮发布。现有服务、实例、数据库容量保持；24小时实际费用观测0，剩余免费额度不由公开接口暴露，不保证永久免费。最终部署SHA、构建号、迁移job、worker和公开闭环另写部署收据。

执行矩阵见[VALIDATION.json](VALIDATION.json)，使用说明见[USER_GUIDE.zh.md](USER_GUIDE.zh.md)，边界见[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)。资助草稿只供用户使用，NOT_SUBMITTED。来源独立性、离线主网真实性、用途/事前约定/履约未核验。
