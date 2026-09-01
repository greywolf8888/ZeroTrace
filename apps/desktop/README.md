# ZeroTrace 链上取证工作站

正式构建采用 Tauri 2：

- 内嵌 `apps/web/dist` 的 production Web，不打开外部浏览器；
- 打包 API 可执行 sidecar，动态绑定 `127.0.0.1` 端口；
- Tauri 负责 sidecar 启动、就绪检查和退出清理；
- 单实例启动，第二次打开时聚焦主窗口；
- 正式包不依赖源码、Node、npm、Docker 或固定 5173/8080 端口。

开发预备与构建：

```powershell
npm run desktop:prepare
npm run desktop:build
npm run desktop:smoke:release
```

`desktop:smoke:release` 直接启动刚构建的 `target/release` 主程序及同目录 sidecar，检查中文
窗口、动态 loopback、匿名访问拒绝、桌面令牌鉴权、版本化模拟资金配置、WebView2、单实例、系统通知 API 接收和退出无残留。
回执只表示操作系统 API 接收，不表示用户已查看。

免安装便携版：

```powershell
npm run desktop:portable
npm run desktop:portable:smoke
```

`desktop:portable` 产生 `output/portable/ZeroTrace-Portable-<version>-win-x64.zip`。ZIP 只包含可执行文件、版本化只读配置、示例环境文件、说明和 SHA-256，不包含真实 `.env` 或凭据。解压后双击 `ZeroTrace.exe`；便携数据始终位于同目录 `ZeroTrace-Data`。

`desktop:portable:smoke` 会把 ZIP 解压到新的临时目录，校验全部 SHA-256，再真实启动并检查便携窗口、同目录数据根、sidecar 鉴权、配置、单实例与退出清理。

`desktop:sync` / `start-workstation.cmd` 仅保留为旧开发入口，不得作为正式交付证据。当前代码签名证书、清洁机便携/安装验收和完整 Provider Setup/OS Credential Vault 验收仍是独立门禁；没有这些证据不得标记 G10 PASS。

禁止：私钥托管、签名、广播、自动划转。Unknown 不得当作 0。
