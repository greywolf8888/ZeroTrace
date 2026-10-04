#!/bin/sh
set -eu
: "${ARC_INTERNAL_API_HOST:?必须提供平台实际返回的 API 私有 DNS}"
: "${ARC_INTERNAL_API_PORT:?必须提供平台实际返回的 API 私有端口}"
# 拒绝通过运行时配置注入 Nginx 指令，且只替换两个指定变量。
case "$ARC_INTERNAL_API_HOST" in
  ''|*[!a-zA-Z0-9.-]*|.*|*.) echo 'API 私有 DNS 格式无效' >&2; exit 1 ;;
esac
case "$ARC_INTERNAL_API_PORT" in
  ''|*[!0-9]*) echo 'API 私有端口格式无效' >&2; exit 1 ;;
esac
if [ "$ARC_INTERNAL_API_PORT" -lt 1 ] || [ "$ARC_INTERNAL_API_PORT" -gt 65535 ]; then
  echo 'API 私有端口超出范围' >&2
  exit 1
fi
envsubst '${ARC_INTERNAL_API_HOST} ${ARC_INTERNAL_API_PORT}' < /etc/nginx/arc-template.conf > /etc/nginx/conf.d/default.conf
nginx -t
exec nginx -g 'daemon off;'
