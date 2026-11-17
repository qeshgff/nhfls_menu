# 部署到自己的 VPS

域名继续使用原来的 DNS 服务商。网站、评分、评论审核都在 VPS 运行，不需要 Cloudflare 账号或 D1。后端为 Node.js 24 和 SQLite，首次启动自动建表；验证码仍使用你配置的 Google reCAPTCHA v3（也可选择 Turnstile）。

以下以有公网 IP 的 Debian / Ubuntu VPS 为例。需要已安装 Git、Docker Engine 和 Docker Compose 插件；服务器需要能访问镜像仓库和验证码验证接口。

## 1. 域名解析

在现有 DNS 服务商添加 `A` 记录：`menu` → VPS 的公网 IPv4。最终访问 `https://menu.你的域名`。

有可用公网 IPv6 才添加 AAAA；不要保留指向旧站点或不可用 IPv6 的同名记录。不需要改根域名 NS。放通服务器防火墙和服务商安全组的 TCP 80、443。

## 2. 配置并启动

```bash
git clone https://github.com/qeshgff/nhfls_menu.git
cd nhfls_menu
cp .env.vps.example .env
chmod 600 .env
nano .env
```

将 `DOMAIN=menu.example.com` 改成你的实际子域名，不能带 `https://` 或路径。然后运行：

```bash
docker compose up -d --build
docker compose logs --tail=80
```

Caddy 自动申请和续期 HTTPS 证书；DNS 必须先指向这台 VPS，80 / 443 端口可从公网访问。若这两个端口已被宝塔、1Panel、Nginx 或其他网站占用，使用下面的“已有反向代理”方式，不要停掉现有站点。

首次启动已能查看菜谱。打开 `https://你的域名/api/health`，应返回 `ok:true`、`database:true`；尚未填验证码时 `reviewsEnabled:false` 是正常状态。

## 3. 启用评论和评分

在 Google reCAPTCHA 管理页创建 **v3 / 基于分数**的网站密钥，允许域名填写你实际访问的子域名，不带协议和路径。将配对密钥填入 `.env`：

```dotenv
CAPTCHA_PROVIDER=recaptcha-v3
CAPTCHA_SITE_KEY=你的公开SiteKey
CAPTCHA_SECRET=你的SecretKey
SESSION_SECRET=独立生成的随机值
MODERATION_SECRET=另一独立生成的随机值
```

使用下面命令生成一个随机值，运行两次，分别填入后两项（不要填示例文字）：

```bash
openssl rand -hex 32
```

设置后重新创建 app，使新的环境变量生效：

```bash
docker compose up -d --force-recreate app
```

`/api/health` 的 `reviewsEnabled:true` 只表示配置已齐全；还需在真实域名实际提交一次评分和评论，确认验证码可用。每次评分 / 评论都会进行服务端验证。评论先进入审核队列，访问 `/moderate.html` 并输入 `MODERATION_SECRET` 审核；此密钥不要发给访客。

所有网站资源和评论接口都通过同一个域名访问。VPS 到验证码服务、以及学生浏览器到验证码脚本的网络都需要实测；更换托管不会改变 Google 服务本身的可达性。

## 更新网站与菜谱

更新网站代码：

```bash
git pull --ff-only
docker compose up -d --build
```

抓取最新菜单（主机需要 Python 3.10+）：

```bash
python3 scripts/fetch_menu.py
docker compose restart app
```

`docs/` 已只读挂载进容器，抓取后前端直接读取新数据；重启 app 是为了让后端同步加载新菜谱，允许对新增菜品评分。失败抓取不会覆盖原数据。还未在你的服务器安装定时任务，原 README 的抓取和 Git 推送方式仍可使用；若使用 `scripts/sync.sh`，在脚本成功后执行 `docker compose restart app`。

## 数据存储与备份

数据库在 Docker 命名卷 `menu_data`，普通重建 / 更新 / `docker compose down` 会保留；**不要运行 `docker compose down -v`**，它会删除数据库和证书卷。SQLite 文件不在 Git 仓库里，不依赖 D1。

在线备份（SQLite backup API 会正确处理 WAL，不需要停站）：

```bash
docker compose exec app node scripts/backup-vps.mjs /app/backups/reviews.sqlite
mkdir -p backups
docker compose cp app:/app/backups/reviews.sqlite ./backups/reviews.sqlite
```

将导出的文件复制到另一台设备；下次备份先保存旧文件或改用其他文件名。备份目录、数据库目录、`.env` 已被 Git 忽略。

恢复时先停止 app，并保留现有数据库的副本，再用备份替换命名卷内的 `reviews.sqlite`，同时移除对应的 `reviews.sqlite-wal` / `reviews.sqlite-shm`，然后启动 app。不要在运行中的数据库上直接覆盖文件。原 Cloudflare D1 数据不会自动迁入；如果已有真实评论，需要另行导出并迁移。

## 已有反向代理 / 不使用 Docker

安装 **Node.js 24**，不需要 `npm install` 就能运行 VPS 服务，SQLite 使用 Node 内置模块。仓库中的 Wrangler 仅用于可选的 Cloudflare 部署，不是 VPS 的运行依赖。

在 `.env` 额外设置：

```dotenv
APP_ORIGIN=https://menu.你的域名
HOST=127.0.0.1
PORT=8787
DATABASE_PATH=/绝对路径/nhfls-menu-data/reviews.sqlite
TRUST_PROXY=1
```

`APP_ORIGIN` 必须与浏览器的真实访问地址一致，后端用它核对提交来源、验证码域名并签发 Secure Cookie。用普通服务用户启动：

```bash
npm start
```

长期运行可按 `deploy/nhfls-menu-web.service` 配置 systemd；修改其中的用户、仓库路径、Node 路径和环境文件路径。通过现有面板 / Nginx 反向代理到 `http://127.0.0.1:8787`，HTTPS 证书由现有代理管理。Nginx 对应配置示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`TRUST_PROXY=1` 仅用于上述受控代理：代理必须覆盖 `X-Real-IP`，应用端口不要暴露公网。直接本地测试则使用 `APP_ORIGIN=http://127.0.0.1:8787`，不启用 `TRUST_PROXY`。

不用 Docker 时执行 `npm run backup:vps`，备份写入 `backups/`；若抓取脚本定时更新菜单，成功后通过 systemd 重启网页服务。

## 验证范围

自动化测试覆盖实际 Node HTTP 服务、SQLite 自动迁移和持久化、在线备份、HTTPS Cookie、评论审核、跨站提交拒绝、静态文件路径和符号链接隔离。Docker / Caddy 配置作为部署模板提供；是否成功签发公网证书、真实验证码能否通过，需要在实际 VPS 和域名上验证。

参考：[Node SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)、[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[Docker Engine 安装](https://docs.docker.com/engine/install/)。
