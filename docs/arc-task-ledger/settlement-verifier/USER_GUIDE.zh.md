# 操作说明

界面首次访问默认英文。顶栏 English / 中文 控制整个 Arc 界面，并在本浏览器保存偏好；切换不会改变报告、原件或资金结果。顶栏 Task list / 任务列表进入兼容任务界面。报告记录见首页 Saved session reports / 当前会话已保存报告，仅包含原会话最近20个版本。

固定报告先显示结论、精确金额、净变化和冻结条件来源。Edit conditions for a new version / 编辑条件建立新版本只开始草稿；修改后旧结论仍只适用于原冻结条件。Compare conditions / 按当前条件核对才保存新版本。复制报告链接不公开私有报告；公开阅览者不会看到原所有者管理按钮。

首页输入 Arc 主网交易哈希或 `https://explorer.arc.io/tx/交易哈希`，点击“读取交易”。应用只读取登记的 RPC，不抓取输入链接。新读取先保存固定观察报告；没有收款条件时不能判为已收到约定款项。

选择具体资金转移，填写预期收款人、可选资金付款人、精确金额或区间及可选 UTC 截止时间，再点击“按当前条件核对”。最多 18 位小数，不能使用科学计数法或浮点近似。每项显示通过、不符合、未知或不适用，并显示期望与实际。点击金额、资金边或核对项可定位原始回执。图中省略的长金额可在下方明细查看完整值。

ArcBounty 任务模式从已支持任务的固定快照与资金段取得协议条件。原任务 Unknown 或归属不明时不能生成确定协议条件；可改用明确标为用户输入的通用交易核验。修改固定协议条件后不再宣称协议来源。历史资金段不会被新的链状态覆盖。

报告在原 PostgreSQL 中不可覆盖，没有短期报告 TTL。条件变化产生新的报告版本；相同事实和条件保留相同报告 ID，不同采集原件可有不同原件包摘要。“在线重新查询”才会读取链，普通报告 GET、导出和分享预览不读取链。

报告默认私有。会话凭据有效期 7 天；浏览器清除 Cookie、凭据过期或丢失后无法恢复私有所有权。本版没有账户登录或所有权找回。请及时导出原件，或在明确需要时预览公开分享。预览会列出地址、金额、时间、条件、结果及链原件；内部业务引用移除。确认公开的是固定版本，不能撤回。不要公开敏感业务条件。公开链接不含会话凭据。

下载原件包后，可在网页的“离线复算原件包”选择文件。文件在本机重新解析，不上传；完整性通过不证明来源主网真实性。独立进程也可运行：

```text
npm ci
npm run arc:build
npx tsx examples/arc-task-ledger/replay-bundle.ts bundle.json
npx tsx examples/arc-task-ledger/reconcile.ts bundle.json local.sqlite accounting_namespace business_reference
```

独立导出包也提供 `npm run arc:replay -- bundle.json`、`npm run arc:reconcile -- bundle.json local.sqlite accounting_namespace business_reference` 和客户端类型检查。Node.js 24/npm 11 为最低版本。SQLite 是示例消费者自己的对账记录，不是第二套生产结算权威。只有 MATCHED 可在给定 namespace 分配所选资金边；重复同一业务引用不新增，分配给另一个引用被拒绝。不自动交付、放款或移动资金。

公开 API 消费用 `https://站点/api#报告ID` 作为示例 CLI 输入，`#报告ID` 仅在客户端解析，不发送为凭据。私有 API 客户端通过会话返回的 Bearer 与 CSRF 访问。不要把会话、数据库连接或管理员密钥放在 URL、日志、原件包或前端。

失败、Pending、来源不可用、限额和冲突不能显示为金额 0。保留原输入，检查错误码后重试；同请求键不可换输入。中断请求不会被 GET 自动重跑。每会话每天 30、全局每天 200 次有界请求；链读取 2 并发、每秒 2 RPC，每次最多 24 RPC/8MiB/45 秒。达到报告容量时仍可读取已有报告。

部署需使用稳定 `ARC_CURSOR_SECRET`、只读 `ARC_DATABASE_URL` 和追加请求角色 `ARC_REQUEST_DATABASE_URL`。先备份并验证恢复，再运行迁移 7 与权限配置；复用原服务规格，不创建付费资源，不删除数据库。详细 API 契约见 [API.md](API.md)，限制见 [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)。
