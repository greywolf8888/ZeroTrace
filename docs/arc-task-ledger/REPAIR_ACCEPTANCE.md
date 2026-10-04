# Arc 任务证据组件 v1.0.1 审计修复验收

本次沿用 `agent/arc-task-ledger-v1`，审计基线为 `7df357d194d66317017daae3775a6ebba3e9059c`。范围仍为 ArcBounty 只读任务历史与结算证据。旧 v1.0.0 的本地资金正确性验收结论因确定性反例撤回；历史报告与原证据保留。

## 第一个闭环：反例与资金模型

资金源码修改前，新增13项真实 Vitest/viem ABI 回归得到11失败、2通过。失败退出码1与原日志摘要见 `validation/red-baseline.json`；业务期望未改成错误输出。当前工作副本相关单元58项、数据库集成19项、桌面/390px浏览器6项已通过；最终干净提交还将独立复验新增定点采集案例。

- 停放义务以链、adapter、交易、logIndex、收款人形成身份；提现批次仅关联当时确定清空的具体义务。完整有序账户历史、开启余额、成功系统转移和守恒缺一不可；后来的新义务不继承旧任务号清偿，不使用FIFO。
- 普通及默认争议工作者胜诉均生成奖励段；已确认要求所有已识别必要资金段可核验，单独费用或保证金到账不能替代终结奖励/退款。缺手续费事件不默认零；只有固定区块已验证的不可变feeBps与锁定路径证明零才接受。
- 按可信emitter及topic0分派，Approval不入现金，未知代币主题保留原回执并单列，未知adapter主题限制解析。损坏或矛盾Transfer仍失败关闭。
- 协议零分配标为ZERO_ALLOCATION；全部零为NOT_APPLICABLE，不等待协议未发起的转移。实际ERC20零Transfer仍解码；与协议零义务矛盾的转移不吞掉。

## 第二个闭环：数据库与真实读取

迁移3增加列表投影、证据ID及索引，保留原始文档。列表在数据库执行numeric job_id keyset、筛选和LIMIT+1，不读取全部详情/原始证据；详情直接定位单任务；coverage仅读运行元数据。测试检查SQL、参数、实际返回行数以及禁用完整getRun后的GET路径。游标继续固定快照、绑定筛选并过期410。

live错误区分FAIL_LOCAL、FAIL_CONFLICT_OR_VERSION和BLOCKED_EXTERNAL。断言、程序与SQL错误不得写成外部阻塞。真实采集发现并修复DNS观察数组被后续缓存更新改变的不可变证据缺陷；旧失败记录以EVIDENCE_HASH_MISMATCH/FAIL_LOCAL保留。

系统DNS仍返回198.18保留地址。可选Google Public DNS HTTPS模式仅在当前进程内生效，固定官方bootstrap和TLS主机验证，答案及实际连接继续拒绝私网/保留地址，限制主机、响应大小、超时和TTL；不改变用户系统DNS，不购买RPC。

工作副本已通过真实5042身份、锁定部署及四个历史区块版本、固定区块读取、任务#18事件/资金结果、原PostgreSQL持久化、API展示及关闭后重新建立数据库连接复核；另实际终止并重启API进程，固定快照详情摘要一致。奖励1.98 USDC、费用0.02 USDC，创建存入与接单中转各2 USDC单独记录。详见 `validation/mainnet-read-initial.json` 与 `validation/api-restart-initial.json`。

定点区块通过完整该区块日志与回执/锚点交叉核验，写入原segments/observations/receipts权威，不越过连续历史缺口。当前状态/枚举/部署完整；生命周期、结算、账户历史及来源一致性partial。当前合约状态不冒充历史状态，正式取证模式仍失败关闭。争议、parked和零分配特殊主网案例均NOT_OBSERVED，相关浏览器/数据库样例明确本地合成。

## 第三个闭环：提交、独立导出与脱敏记录

从干净检出提交导出v1.0.1，独立安装不执行生命周期脚本，执行类型/构建、单元、真实PostgreSQL集成、浏览器、lint、许可证与依赖审计。导出拒绝脏工作树，manifest记录sourceCommit和逐文件SHA256。经过脱敏的命令、退出码、时间、日志摘要、源码清单及指纹随交付包提供；原始命令日志和私有状态不整目录公开。

公开部署、Docker实际运行、身份/权利/资格资料和申请仍分别未完成；不自动部署、提交申请、联系维护者或合并main。原ZeroTrace存量外部服务跳过、依赖告警及视觉基线问题单列，不能扩大本次修复或继承旧PASS。

## 官方来源

- [锁定上游终结路径](https://github.com/Sofiia7/ARC/blob/ef5d100882a4bfe475c685586902ecc72da420e8/contracts/src/BountyAdapter.sol)
- [ERC-20事件标准](https://eips.ethereum.org/EIPS/eip-20)
- [Arc网络与官方公共RPC](https://docs.arc.io/arc/references/connect-to-arc)
- [Google HTTPS DNS响应格式](https://developers.google.com/speed/public-dns/docs/doh/json)、[官方bootstrap地址](https://developers.google.com/speed/public-dns/docs/using)
