# 独立 MinIO 对象存储构建

2026-11-14，主线 CI `43585138358` 无法下载原 `minio/minio:RELEASE.2025-09-07T16-13-09Z`；官方 Quay 同标签的匿名读取也返回 401。本配置改用官方建议的源码构建，不依赖第三方重打包镜像。

来源为 [MinIO 官方安全发布](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)，固定完整提交 `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`。该版修复官方公布的 [GHSA-jjjj-jwhf-8rgr](https://github.com/minio/minio/security/advisories/GHSA-jjjj-jwhf-8rgr)。构建工具链采用核验时的 Go 官方稳定版 `1.27.4`，运行层固定已核对的 Debian 镜像摘要。Go 模块下载保留校验；镜像内 `/usr/share/doc/minio/build-info.txt` 记录实际模块构建信息。

MinIO 使用 AGPL-3.0-only，作为独立进程和独立镜像运行。ZeroTrace 仅通过已有 S3 HTTP 客户端访问；不静态链接 MinIO、不把其 Go 源码复制到 Apache-2.0 核心，不修改上游源文件。许可证与原始来源地址保留于镜像。镜像分发或对外服务时仍须履行该组件适用的源码和许可证义务；核心许可证检查不能代替此边界。

本目录不引入第二套证据存储权威，仍沿用原 `minio` 服务、数据卷、端口、访问配置和已有对象存储接口。CI 只使用一次性数据卷。本次没有执行生产卷升级；已有生产数据应按现有备份恢复流程在隔离副本验收后再切换。

```powershell
docker compose build minio
docker compose up -d minio
docker compose exec -T minio curl -fsS http://127.0.0.1:9000/minio/health/live
```

构建及真实 S3 版本化、原件回读由当前 CI 的隔离对象存储集成测试验证；镜像能构建或健康端点返回成功均不替代这些检查。
