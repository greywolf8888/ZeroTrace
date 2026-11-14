# 独立 AGPL 服务；不向 ZeroTrace 应用镜像或核心源码复制 MinIO 代码。
FROM golang:1.27.4-bookworm@sha256:4fa7c968ba93f1635670522dbb01a2c78150443e1385746924566079f36570ea AS build
WORKDIR /build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local

# 官方 RELEASE.2025-10-15T17-29-55Z 的完整提交，包含 GHSA-jjjj-jwhf-8rgr 修复。
RUN go install -trimpath github.com/minio/minio@9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a \
    && mkdir -p /out \
    && cp /go/bin/minio /out/minio \
    && cp /go/pkg/mod/github.com/minio/minio@*/LICENSE /out/LICENSE \
    && go version -m /out/minio > /out/build-info.txt

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /out/LICENSE /usr/share/doc/minio/LICENSE
COPY --from=build /out/build-info.txt /usr/share/doc/minio/build-info.txt
LABEL org.opencontainers.image.title="ZeroTrace 独立 MinIO 对象存储" \
      org.opencontainers.image.version="RELEASE.2025-10-15T17-29-55Z" \
      org.opencontainers.image.revision="9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a" \
      org.opencontainers.image.source="https://github.com/minio/minio/tree/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
