#!/usr/bin/env bash
# =============================================================================
# 阿里云 ECS 一次性初始化脚本
# 作用：安装 Nginx、创建站点目录、装好站点配置。只需在 ECS 上跑一次。
# 用法（在 ECS 上，用 root 或有 sudo 的用户执行）：
#   git clone <你的仓库地址> && cd investment-intellegence
#   sudo bash deploy/server-setup.sh
# =============================================================================
set -euo pipefail

SITE_DIR="/var/www/investment-intelligence"
CONF_SRC="$(cd "$(dirname "$0")" && pwd)/nginx.conf"

echo "==> 1/5 安装 Nginx"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx
elif command -v yum >/dev/null 2>&1; then
  yum install -y nginx        # 阿里云 Alibaba Cloud Linux / CentOS
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y nginx
else
  echo "未识别的包管理器，请手动安装 nginx 后重跑。" >&2
  exit 1
fi

echo "==> 2/5 创建站点目录 $SITE_DIR"
mkdir -p "$SITE_DIR"
# 让部署用户可写：GitHub Actions 用 SCP 以该用户身份往这里写文件，
# 若目录属 root，非 root 部署用户会 permission denied。
DEPLOY_USER="${SUDO_USER:-$(whoami)}"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$SITE_DIR"
echo "    站点目录属主设为：$DEPLOY_USER"

echo "==> 3/5 安装站点配置到 /etc/nginx/conf.d/"
mkdir -p /etc/nginx/conf.d
cp "$CONF_SRC" /etc/nginx/conf.d/investment-intelligence.conf

# Debian/Ubuntu 的默认站点会占用 80 端口的默认 server，按需移除
if [ -e /etc/nginx/sites-enabled/default ]; then
  echo "    移除 Debian/Ubuntu 默认站点"
  rm -f /etc/nginx/sites-enabled/default
fi

echo "==> 4/5 放一个占位首页（真正的文件由 GitHub Actions 部署覆盖）"
if [ ! -f "$SITE_DIR/index.html" ]; then
  echo '<h1>Waiting for first deploy…</h1>' > "$SITE_DIR/index.html"
fi

echo "==> 5/5 校验配置并启动 Nginx"
nginx -t
systemctl enable nginx
systemctl restart nginx

echo ""
echo "✅ 服务器初始化完成。"
echo "   - 站点目录：$SITE_DIR"
echo "   - 现在配置 GitHub Secrets 后推送代码，即可自动部署（见 DEPLOY.md）。"
echo "   - 别忘了在阿里云安全组放行 80 端口（以及 HTTPS 的 443）。"
