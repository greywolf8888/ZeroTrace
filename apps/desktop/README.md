# ZeroTrace 只读工作站

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
窗口、动态 loopback、匿名访问拒绝、WebView2、单实例、系统通知 API 接收和退出无残留。
回执只表示操作系统 API 接收，不表示用户已查看。

`desktop:sync` / `start-workstation.cmd` 仅保留为旧开发入口，不得作为正式交付或安装证据。当前代码签名证书、清洁机安装和完整 Provider Setup/OS Credential Vault 验收仍是独立门禁；没有这些证据不得标记 G10 PASS。

禁止：私钥托管、签名、广播、自动划转。Unknown 不得当作 0。
