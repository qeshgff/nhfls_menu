# 部署到 Cloudflare Workers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fqeshgff%2Fnhfls_menu)

这是 **Workers + Static Assets + D1** 版本。首页、菜谱和评论接口在同一个 Worker 域名下运行，不需要另建 Pages 项目或连接 ChatGPT 的 Cloudflare 插件。原 GitHub Pages 可继续使用。

## 1. 点击部署按钮

登录自己的 Cloudflare 账号，选择 GitHub 账号，按向导设置仓库名和 Worker 名。

官方按钮通常会把代码复制到你的 GitHub 账号；如果 `nhfls_menu` 已存在，给副本换一个名称。之后 Cloudflare 跟随这个新仓库的提交更新，原仓库不会自动同步到副本。抓菜单的服务器也应推送到实际构建源仓库。

向导若显示构建配置，使用：

| 项目 | 值 |
| --- | --- |
| 仓库根目录 | 留空 |
| 构建命令 | `npm run build` |
| 部署命令 | `npm run deploy` |
| 配置文件 | `wrangler.jsonc` |
| Node.js | 24 |

不要把根目录设为 `docs`。`wrangler.jsonc` 已声明 Worker 入口 `worker/index.mjs` 和静态资源目录 `docs`；普通静态资源先由 Assets 提供，`/api/*` 进入评论接口。

## 2. 选择／绑定数据库与初始化

配置中已声明 D1 绑定 **`DB`**，默认数据库名 `nhfls-menu`，没有写入任何账号 ID 或虚构数据库 UUID。官方部署向导支持为该绑定创建／选择资源。

默认的 `npm run deploy` 先发布 Worker 并配置／创建声明的 D1 资源，再执行建表迁移：

```bash
wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

这一步完成后部署任务才算成功。这里使用绑定名 `DB`，即使你在向导中改了数据库名称，仍可正确找到绑定。

如果你选择手动绑定，或部署后换了数据库：

1. 在 **Storage & databases → D1** 创建数据库。
2. 在该数据库的 **Console** 中执行 [`migrations/0001_reviews.sql`](../migrations/0001_reviews.sql) 的全部 SQL，建立评分、评论与限流表。
3. 在 Worker 的 **Bindings → Add binding → D1 database** 中选择这个数据库，变量名保持 **`DB`**。
4. 同时将构建源仓库 `wrangler.jsonc` 的 D1 配置更新为这个数据库的实际 `database_name` 和 `database_id`，避免下次部署切回原绑定。数据库 ID 不是密钥。
5. 保存并重新部署。

如果你修改了默认部署命令，跳过了迁移，或部署后手动换了数据库，请按上述步骤执行 SQL；仅添加绑定不会自动建表。首次部署的建表步骤完成前，`/api/health` 可能暂时返回503，应以整个部署任务成功和健康检查通过为准。

不要将测试环境和生产环境指向同一数据库。

## 3. 填写验证码和管理密钥

在 Worker 的 **Settings → Variables and Secrets** 添加以下配置。可以先部署菜谱，再填写这些值；未配置完整时评价入口保持隐藏。

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `CAPTCHA_PROVIDER` | 普通变量，可选 | 默认 `recaptcha-v3` |
| `CAPTCHA_SITE_KEY` | 普通变量 | Google reCAPTCHA v3 公开 Site key |
| `CAPTCHA_SECRET` | Secret | 与上述网站密钥配对的服务端密钥 |
| `SESSION_SECRET` | Secret | 至少32字符的独立随机值，用于签名匿名身份 |
| `MODERATION_SECRET` | Secret | 至少32字符的另一独立随机值，用于评论审核 |
| `RECAPTCHA_MIN_SCORE` | 普通变量，可选 | 默认 `0.5` |

在自己的电脑分别执行 `openssl rand -hex 32`，生成后两项。不要复用模板值，不要把 Secret 提交到 Git。更换 `SESSION_SECRET` 会使原浏览器身份失效。

Google 管理后台应添加实际 `workers.dev` 主机名和之后绑定的自定义域名。代码通过 `recaptcha.net` 加载和验证，部署后仍需在自己的网络实测。每次评分、修改评分和发表评论都验证新的 token；服务端检查来源、操作名称、有效期、分数和错误信息，验证失败不会写入数据。

可选 Turnstile：将 `CAPTCHA_PROVIDER` 改为 `turnstile`，替换配对的公开 key 与 Secret。当前实现使用全球端点，不适用于中国区专用密钥。

`keep_vars: true` 保留通过控制台配置的普通运行时变量，避免后续代码部署清掉 Site key；Secret 也只保存在 Cloudflare。数据库绑定仍以 Wrangler 配置为准。

## 4. 验收与审核

使用 Cloudflare 控制台实际返回的 Worker 地址：

- 首页保留12周、55天菜单，按北京时间打开当天。
- `/api/health` 返回 `ok: true`，说明数据库表已初始化；`reviewsEnabled: true` 仅表示必需配置已存在，仍需实际验证 Google 密钥。
- 展开菜名，进入“评分与同学评价”，可提交1—5星评分和评论。
- 同一浏览器修改这次供餐的评分，评分人数不应增加。
- 评论先进入待审核队列，审核后才公开。
- 打开 `/moderate.html`，输入 `MODERATION_SECRET` 查看和审核评论，刷新或退出清除页面内存中的管理密钥。

匿名评分只限制当前浏览器身份，清除 Cookie 可获得新身份，不能宣称严格一人一票。学校共用出口不按单个 IP 只许一人投票；IP仅用于高阈值限流，保存前做带密钥摘要。昵称选填，不需要真实姓名、班级、邮箱或学号。评论作为纯文本显示。

自定义域名在 Worker 的 **Settings → Domains & Routes** 中添加；域名启用后也要加入验证码允许列表。

## 本地开发

```bash
npm ci
npm run db:migrate:local
npm run dev
```

本地变量放 `.dev.vars`，已被 Git 忽略；请用测试专用密钥。当前 Worker 命令明确使用 `wrangler.jsonc`，不会读取旧 Pages 本地配置 `wrangler.toml`。

```bash
npm test
python3 -m unittest discover -s tests -v
npm run build
npm run check:cf
```

`check:cf` 执行官方 Wrangler 的 `deploy --dry-run`，不会真正上线。接口测试用 SQLite 执行真实 SQL，并模拟验证服务的响应；不提供线上验证码绕过开关。真实 Cloudflare 账号部署、数据库和真实验证码密钥由你在控制台配置。
