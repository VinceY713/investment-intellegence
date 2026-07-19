# 本地运行 + 一键更新

工具是纯静态站点，本地跑不需要服务器。日常只做一个动作：**双击一个脚本**，它会自动
「拉最新代码 + 打开工具」。

## 更新方向（重要）

```
我（Claude）开发完 → 自动 git push 到 GitHub
        └──────────────→ 你双击 run 脚本：git pull 拉最新 + 打开浏览器 ✅
```

我在远程沙箱里，碰不到你的电脑，所以代码通过 GitHub 中转。你那边永远是「拉取」，不是「推送」。

---

## 首次配置（只做一次）

1. 装 **Git**：<https://git-scm.com/downloads>
   （建议再装 **Python**：<https://www.python.org/downloads/> —— 用于本地起服务，可选）
2. 克隆仓库到本地：
   ```bash
   git clone https://github.com/VinceY713/investment-intellegence.git
   cd investment-intellegence
   ```
3. 如果代码还在开发分支（尚未合并到主分支），先切到该分支：
   ```bash
   git checkout claude/prototype-development-f9gwtq
   ```

## 之后每次：双击一个脚本

| 你的系统 | 双击这个 |
|---|---|
| **Windows** | `run.bat` |
| **macOS** | `run.command` |
| **Linux** | 终端里执行 `./run.command` |

它会自动：`git pull` 拉最新 → 起本地服务 → 打开浏览器到 `http://localhost:8080`。
关掉那个黑窗口就停止服务。

> macOS 首次双击 `run.command` 若提示「无法打开」，右键 → 打开 → 确认一次即可；
> 或在终端执行一次 `chmod +x run.command`。

---

## 常见问题

| 情况 | 说明 |
|---|---|
| 双击没反应 / 报 `git` 找不到 | 没装 Git，装好后重开脚本 |
| 提示拉取失败 | 你本地手动改过文件。执行 `git stash` 后再双击脚本 |
| 没装 Python | 脚本会自动改为直接打开 `index.html`，功能一样（数据存浏览器 localStorage）|
| 想换端口 | 编辑脚本里的 `PORT=8080` |

## 本地 vs 部署到服务器

- **本地运行**：只有你自己这台电脑能用，数据存在你浏览器里，最私密、零成本。适合自用。
- **部署到云服务器**（腾讯云/阿里云，见 `DEPLOY.md`）：任何设备通过网址访问。适合多设备或分享。

两者不冲突，可以都留着。
