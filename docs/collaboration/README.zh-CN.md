# ZeroTrace 协作配置

范围仅为 greywolf8888/ZeroTrace。目标协作者以自己的 GitHub 账号获得本仓库代码读写权限，不共享所有者账号、PAT、SSH 私钥、浏览器会话或云端管理凭据。

## 当前状态

- GitHub 收件人尚未提供，邀请未发送。
- 管理类接口目前不可用；本机 CLI 认证未通过，浏览器未登录，随后本机环境断开。
- 仓库成员邀请、主分支保护变更及旧分支删除均未执行，不能把配置文件当作已授权成功。
- 代码与文档整理通过现有仓库内容连接执行；实际提交与分支状态以远端收据为准。

## 权限范围

本仓库为个人账号下的公开仓库。协作者使用仓库级 Collaborator / Write，可克隆、推送代码、建立分支及 PR，受实际主分支保护规则约束。不会因为本次邀请获得其他仓库的写入或管理权限。

公开仓库的阅读无法按人禁止；本次也不撤销对方以前自行获得的其他权限。Write 不是账号管理员，不授予账户设置、组织成员身份或其他仓库管理权。

当前 GitHub 不支持单独隐藏某个分支。本次使用“活动任务”说明；同一仓库有读权限的人仍可看到其分支和历史。需要严格隐藏活动源码时，应另行使用私有仓库，不能靠分支命名提供访问隔离。

## 发出邀请

获得对方 GitHub 用户名后，所有者打开 https://github.com/greywolf8888/ZeroTrace/settings/access ，选择 Add people，核对账号头像和个人主页，再添加为本仓库协作者。不要邀请到整个组织，不使用账户共享。

也可以在所有者自己的已认证 GitHub CLI 中运行本目录的 invite-collaborator.py。脚本默认只检查，显式 --apply 才发送；固定目标仓库，不接受任意仓库参数，不修改其他仓库。对方接受前状态为待接受，不能写成已生效。

脚本和管理配置尚未在真实管理会话执行。提供身份后仍须核对邀请对象与最终仓库权限。

## 旧分支清理

唯一 ZeroTrace 主线为 main；Arc 活动支线为 agent/arc-task-ledger-v1。历史品牌和部署分支的来源被完整保留，后续删除仅删除旧分支引用，不删除已被主线与活动支线保留的提交。

删除前必须重新核对旧分支 HEAD 未被别人推进，并确认它们是主线及活动支线的祖先。当前缺少管理通道，删除尚未执行。具体固定分支、来源 SHA 和状态见 branch-plan.json；不得顺手删除其他分支或改动独立 BundleMark 仓库。

## 官方依据

- https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-personal-account-settings/permission-levels-for-a-personal-account-repository
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/inviting-collaborators-to-a-personal-repository
- https://docs.github.com/en/rest/collaborators/collaborators#add-a-repository-collaborator
