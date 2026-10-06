# Arc USDC 结算核验器 2.0.0 交付

已完成限定Arc S0—S7开发与公开更新。实际开发/独立构建源码 6b2454f666befe3179dc6093800f36eea6df3976；云端导出源码 60284c4667e4d6215d0aac5c6f1c92041fa85972，API/Web/migrate/sync同版本，迁移7，旧资金规则atl-v1.2.1。未合并main或强推，原桌面用户改动、旧数据库、旧报告/原件/游标保留。

[公开核验器](https://web--atl-web--xtd599t97njk.code.run) · [真实原生报告](https://web--atl-web--xtd599t97njk.code.run/?report=zasv_4e98a1e6aa85fde1870dd8002e68bef25e7f0528de83d08db5978f01c88fe148)。首页可打开两个实际公开示例；金额由原始回执计算。通用交易和ArcBounty固定条件模式都在正常HTTPS浏览器完成。独立对账只写自身SQLite，重复0新增；不确认用途、事前约定、履约或真实用户采用。

Arc独立包114单元、42真实PG、28浏览器通过；构建、lint、客户端类型、许可证和生产依赖审计0漏洞通过。根1050单元、88集成通过但42外部跳过；全仓库49浏览器、Windows49、Rust工作区及静态门禁执行。旧视觉基线源码指纹仍FAIL，最终全根格式检查通过，外部任务输入及原件显式排除以保持原始字节；不宣称全平台通过。初次资源竞争/布局/合并设备触发限流失败已保留，修复后的窄回归通过。

实际生产备份在独立PG恢复全部Arc对象/数据，迁移6→7前后旧六表一致，真实隔离重启19份原件一致；不是包含平台专用扩展的全平台恢复，未重启生产/共享数据库。旧#18固定版本各字段与JSON导出摘要保持，旧游标仍可用。

公开新核验6RPC/2798ms/12483bytes，重查6RPC/2585ms。报告GET五样本 219/219/216/214/215ms，非P95/SLA。原服务、实例、存储、定时设置保持，24h实际观测费用0，无新增资源/付款/付费数据源；剩余免费额度未公开，不保证永久免费。

逐项门禁和产物摘要见[VALIDATION.json](VALIDATION.json)，操作见[USER_GUIDE.zh.md](USER_GUIDE.zh.md)，API见[API.md](API.md)及[openapi.json](openapi.json)，边界见[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)，申请草稿见[SUBMISSION_DRAFT.en.md](SUBMISSION_DRAFT.en.md)。submissionReadiness是资料准备状态；grantApplication=NOT_SUBMITTED。单RPC、离线无法认证主网、私有会话7天且无找回、公开版本不可撤回等限制保留。

独立包：`Arc_USDC_Verifier_2.0.0_Cloud_20261007.zip`，14973922字节，415条目；SHA256 `12a0236ae7e3871951425a30764f7898acc4d86f212c2a961683a187487f89c0`。导出提交0f0289a0ec56a9168849c03e35539d58e71e580e，112项执行/配置文件与独立测试候选逐字相同，ZIP CRC、条目摘要和17门禁产物摘要通过。外置[包收据](PACKAGE_RECEIPT.json)避免自引用哈希；文档收据提交不再次部署，旧包保留。
