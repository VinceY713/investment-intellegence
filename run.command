#!/usr/bin/env bash
# =============================================================================
# 一键：更新到最新代码 + 本地打开工具（macOS 双击即可运行；Linux 亦可）
# 首次使用前需先 git clone 本仓库（见 RUN-LOCAL.md）。
# =============================================================================
cd "$(dirname "$0")" || exit 1

echo "==> 拉取最新代码..."
if ! git pull --ff-only; then
  echo "⚠️  拉取失败：本地可能改过文件。可先执行  git stash  再重试本脚本。"
fi

PORT=8080
URL="http://localhost:$PORT"
echo "==> 启动本地服务：$URL  （关闭此窗口即停止）"

# 稍等 1 秒待服务起来，再自动打开浏览器
( sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi
) &

# 优先用 Python 起静态服务；没有 Python 就直接用浏览器打开文件
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$PORT"
else
  echo "未检测到 Python，直接用浏览器打开 index.html"
  if command -v open >/dev/null 2>&1; then open index.html
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open index.html; fi
  echo "（按回车键退出）"; read -r _
fi
