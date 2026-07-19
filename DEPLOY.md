# 部署到阿里云 ECS（GitHub Actions 自动部署）

每次把代码推送到 `main`/`master` 分支，GitHub Actions 会自动：
把静态文件通过 SSH 同步到你的 ECS → 校验 Nginx 配置 → 重载 Nginx。

整个流程只需**一次性配置**，之后改代码 `git push` 即自动上线。

```
本地/PR 合并 → push 到 main → GitHub Actions
   → SCP 拷贝 index.html/styles.css/app.js 到 ECS:/var/www/investment-intelligence
   → ssh: nginx -t && systemctl reload nginx  ✅ 上线
```

---

## 一次性配置（三步）

### 第 1 步：初始化 ECS 服务器（装 Nginx + 建站点）

登录你的 ECS（假设是 root 或有 sudo 权限的用户）：

```bash
# 装 git（如未安装）
sudo yum install -y git   # Alibaba Cloud Linux / CentOS
# 或 sudo apt-get install -y git   # Ubuntu/Debian

# 拉代码并跑初始化脚本
git clone https://github.com/VinceY713/investment-intellegence.git
cd investment-intellegence
sudo bash deploy/server-setup.sh
```

脚本会：安装 Nginx、创建 `/var/www/investment-intelligence`、装好站点配置、启动 Nginx。

> **阿里云安全组**：到 ECS 控制台 → 安全组 → 入方向，放行 **80** 端口（用 HTTPS 再放行 **443**）。否则外网访问不到。

### 第 2 步：生成一对部署专用 SSH 密钥，公钥放到 ECS

**在你自己电脑上**（不是 ECS 上）生成一对只用于 CI 部署的密钥：

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./ecs_deploy_key -N ""
```

得到两个文件：`ecs_deploy_key`（私钥）、`ecs_deploy_key.pub`（公钥）。

把**公钥**追加到 ECS 上部署用户的 `authorized_keys`：

```bash
# 把公钥内容复制到 ECS 的 ~/.ssh/authorized_keys
ssh-copy-id -i ./ecs_deploy_key.pub root@<你的ECS公网IP>
# 若没有 ssh-copy-id，手动：
#   cat ecs_deploy_key.pub | ssh root@<ECS_IP> 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'
```

### 第 3 步：在 GitHub 仓库配置 Secrets

仓库页面 → **Settings → Secrets and variables → Actions → New repository secret**，添加：

| Secret 名称 | 值 | 说明 |
|---|---|---|
| `ECS_HOST` | 你的 ECS 公网 IP（或域名） | 必填 |
| `ECS_USERNAME` | `root`（或你的部署用户名） | 必填 |
| `ECS_SSH_KEY` | **私钥 `ecs_deploy_key` 的完整内容** | 必填，整段贴入（含 `-----BEGIN...`/`-----END...`）|
| `ECS_PORT` | SSH 端口 | 可选，默认 `22` |
| `APP_PASSWORD` | 访问网页的密码 | 必填，打开网站需输入（用户名固定 `admin`）|

> **访问密码门**：部署时会用 `APP_PASSWORD` 在服务器生成 Nginx Basic Auth 口令文件，
> 打开网站会先弹出登录框——**用户名 `admin`**，密码即 `APP_PASSWORD`。改密码只需改这个
> Secret 再重跑一次部署。注意：未启用 HTTPS 时 Basic Auth 密码是明文传输，若数据敏感，
> 建议绑定域名后用 Certbot 开 HTTPS（见文末）。

> ⚠️ 私钥是敏感信息，只贴到 GitHub Secrets（加密存储），**不要**提交进仓库。

---

## 触发部署

配置完成后，有两种方式触发：

1. **自动**：把改动推送/合并到 `main`（或 `master`）分支即自动部署。
   > 当前代码在 `claude/prototype-development-f9gwtq` 分支。先把它合并到 `main`
   > （或在 `deploy.yml` 里把触发分支改成你的主分支名）自动部署才会生效。

2. **手动**：仓库 → **Actions → Deploy to Aliyun ECS → Run workflow**，选择分支运行。
   手动运行会用所选分支上的代码部署，适合先跑通一次验证。

部署成功后，浏览器访问 `http://<你的ECS公网IP>/` 即可看到工具。

---

## 关于部署用户与 sudo

工作流最后一步执行 `sudo nginx -t && sudo systemctl reload nginx`：

- 用 **root** 部署：`sudo` 直接可用，无需额外配置。
- 用**非 root 用户**部署：需给该用户配置免密 sudo（仅限 nginx 重载）：
  ```bash
  echo '<用户名> ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /bin/systemctl reload nginx' \
    | sudo tee /etc/sudoers.d/deploy-nginx
  ```

---

## （可选）绑定域名 + HTTPS

1. 域名解析：把域名 A 记录指向 ECS 公网 IP。
2. 改 `deploy/nginx.conf` 里的 `server_name _;` 为你的域名，重跑 `server-setup.sh`（或手动 `nginx -s reload`）。
3. 用 Certbot 申请免费 HTTPS 证书：
   ```bash
   sudo yum install -y certbot python3-certbot-nginx   # 或 apt-get
   sudo certbot --nginx -d tools.example.com
   ```
   Certbot 会自动改好 Nginx 配置并配置自动续期。

---

## 排查

| 现象 | 排查 |
|---|---|
| Actions 报 SSH 连接失败 | 检查 `ECS_HOST`/`ECS_PORT`；安全组是否放行了 SSH 端口；公钥是否加到了 ECS |
| Actions 报 permission denied | 私钥（`ECS_SSH_KEY`）是否完整；`ECS_USERNAME` 是否与公钥所在用户一致 |
| `nginx -t` 失败 | 登录 ECS 手动 `sudo nginx -t` 看报错；确认 `server-setup.sh` 已跑过 |
| 部署成功但打不开 | 阿里云安全组是否放行 80 端口；`systemctl status nginx` 是否 running |
| 打开是旧版本 | 已配 `no-store` 无缓存；强刷 `Ctrl+Shift+R`，或确认 Actions 这次跑的是最新分支 |
