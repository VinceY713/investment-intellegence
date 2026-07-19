@echo off
chcp 65001 >nul
rem ==========================================================================
rem  一键：更新到最新代码 + 本地打开工具（Windows 双击即可运行）
rem  首次使用前需先 git clone 本仓库（见 RUN-LOCAL.md）。
rem ==========================================================================
cd /d "%~dp0"

echo ==^> 拉取最新代码...
git pull --ff-only

set PORT=8080
set URL=http://localhost:%PORT%
echo ==^> 启动本地服务：%URL%   （关闭此窗口即停止）

start "" "%URL%"

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server %PORT%
  goto :eof
)

echo 未检测到 Python，直接用浏览器打开 index.html
start "" "index.html"
pause
