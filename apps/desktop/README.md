# ZeroTrace 只读工作站（免安装启动器）

本目录提供**工作区指针**，不是冻结安装包。

- 双击 `start-workstation.cmd`，或运行 `npm run desktop:sync` 后双击桌面上的「ZeroTrace 只读工作站」。
- 启动器读取本工作区的 `dev-link.json` 与源码，执行与开发端相同的 `npm run dev`。
- Vite 热更新会进入已打开的工作站；改业务代码**不必重新生成 exe**。
- 仅当 `apps/desktop/src-tauri` 或 `crates/zerotrace-desktop-core` 的启动器源码变更时，`npm run desktop:sync` 才会重编 exe。

禁止：私钥托管、签名、广播、自动划转。Unknown 不得当作 0。
