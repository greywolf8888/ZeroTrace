# ZeroTrace 协作配置

范围仅为 greywolf8888/ZeroTrace。目标协作者以自己的 GitHub 账号获得本仓库代码读写权限，不共享所有者账号、PAT、SSH 私钥、浏览器会话或云端管理凭据。

## 当前状态

- 已按用户指定向 [wangranorz](https://github.com/wangranorz) 发出仅限本仓库的 Write 邀请，邀请编号 `343629239`，发出时间为 2026-11-14 19:17:16（Asia/Singapore）。
- 随后回读确认邀请为待接受，实际权限仍为 Read；接受前不能称为写权限已生效。以 GitHub 实际状态及 [执行收据](EXECUTION_20261114.json)为准。
- 已应用原保护模板并回读确认：main 禁止强推和删除；没有新增强制评审、强制状态检查或更改所有者绕过权限。两个旧活动引用此前已清理。
- 本轮从实际主线 `a931eec96890dc3072f285f10f965251039943b4` 建立短期开发分支，原 `F:\ZeroTrace` 中未提交修改保留；Arc 活动源码和其独立仓库未修改。

## 权限范围

本仓库为个人账号下的公开仓库。协作者使用仓库级 Collaborator / Write，可克隆、推送代码、建立分支及 PR，受实际主分支保护规则约束。不会因为本次邀请获得其他仓库的写入或管理权限。

公开仓库的阅读无法按人禁止；本次也不撤销对方以前自行获得的其他权限。Write 不是账号管理员，不授予账户设置、组织成员身份或其他仓库管理权。

当前 GitHub 不支持单独隐藏某个分支。本次使用“活动任务”说明；同一仓库有读权限的人仍可看到其分支和历史。需要严格隐藏活动源码时，应另行使用私有仓库，不能靠分支命名提供访问隔离。

## 发出邀请

获得对方 GitHub 用户名后，所有者打开 https://github.com/greywolf8888/ZeroTrace/settings/access ，选择 Add people，核对账号头像和个人主页，再添加为本仓库协作者。不要邀请到整个组织，不使用账户共享。

也可以在所有者自己的已认证 GitHub CLI 中运行本目录的 invite-collaborator.py。脚本默认只检查，显式 --apply 才发送；固定目标仓库，不接受任意仓库参数，不修改其他仓库。对方接受前状态为待接受，不能写成已生效。

本次邀请通过所有者已登录的 CLI 执行，未共享凭据。脚本已完成真实身份只读检查和测试目录中的权限边界回归；修正 GitHub 邀请返回字段 `repository`，并同时核对对象与 Write 权限。默认检查不发送邀请，已有邀请不需要重复发送。

## 旧分支清理

唯一 ZeroTrace 主线为 main；Arc 活动支线为 agent/arc-task-ledger-v1。历史品牌和部署分支的来源被完整保留，后续删除仅删除旧分支引用，不删除已被主线与活动支线保留的提交。

删除前必须重新核对旧分支 HEAD 未被别人推进，并确认它们是主线及活动支线的祖先。两个固定旧分支已通过仓库内一次性任务完成上述检查及删除，远端复核只剩 main 和 Arc 支线，随后移除一次性工作流。执行链接、来源 SHA 和状态见 branch-plan.json；未删除其他分支，也未改动独立 BundleMark 仓库。

## 官方依据

- https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-personal-account-settings/permission-levels-for-a-personal-account-repository
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/inviting-collaborators-to-a-personal-repository
- https://docs.github.com/en/rest/collaborators/collaborators#add-a-repository-collaborator
