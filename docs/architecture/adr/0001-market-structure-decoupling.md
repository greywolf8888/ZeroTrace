# ADR 0001 — 盘面结构模块解耦

- Status: Accepted
- Date: 2026-08-19

巨型 `App.tsx` / `app.ts` / `schemas/src/index.ts` 与手写 `apps/web/src/api.ts` 被拆为：

- `apps/web/src/App.tsx` 薄入口 + `app/AppShell.tsx` 兼容工作站 + `workspaces/forensic.tsx`
- `apps/api/src/app.ts` 转调 `create-app-impl.ts`，v2 路由在 `plugins/market-structure.ts`
- `packages/schemas/src/contracts/*` 保留既有 Zod 契约；`market-structure/*` 只导出新取证类型
- `apps/web/src/api.ts` 只 re-export `generated-api/client.ts`

不变量（Evidence、Snapshot、Unknown≠0、只读、许可证隔离）不得削弱。
