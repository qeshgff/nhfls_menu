# Cloudflare Pages 迁移

本仓库可同时供 GitHub Pages 与 Cloudflare Pages 发布。迁移未验证前保留原 GitHub Pages，勿提前关闭。

## 1. 连接仓库

在 Cloudflare 的 Workers & Pages 创建 **Pages** 项目，连接 GitHub 仓库 `qeshgff/nhfls_menu`：

| 配置 | 值 |
| --- | --- |
| 项目名 | `nhfls-menu`（被占用时使用控制台实际名称） |
| 生产分支 | `main` |
| 框架 | None |
| 根目录 | 仓库根目录，留空 |
| 构建命令 | `npm run build:cf` |
| 输出目录 | `docs` |
| Node.js | 24 |

`functions/` 必须位于仓库根目录，不能把项目根目录设为 `docs`。`docs/_routes.json` 只让 `/api/*` 调用 Functions，普通菜谱浏览仍使用静态资源。代码推送自动发布；评论和评分写入 D1，不产生 Git 提交或重新部署。

## 2. 创建 D1

创建 D1 数据库 `nhfls-menu`。在数据库 Console 中执行 [`migrations/0001_reviews.sql`](../migrations/0001_reviews.sql) 的全部 SQL。

在 Pages 项目 **Settings → Bindings** 中增加 D1 绑定：变量名 **`DB`**，选择上面的数据库。请同时为预览环境使用独立测试数据库，避免预览写入生产数据。

仓库不提交带虚构数据库 ID 的生产 Wrangler 配置。当前部署以控制台绑定和变量为准；`deploy/wrangler.local.example.toml` 仅供本地模拟器使用。

## 3. 配置人机验证和密钥

Pages 项目中添加运行时变量／Secret：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `CAPTCHA_PROVIDER` | 普通变量 | `recaptcha-v3`（默认） |
| `CAPTCHA_SITE_KEY` | 普通变量 | Google reCAPTCHA v3 公开网站密钥 |
| `CAPTCHA_SECRET` | Secret | 与该网站密钥配对的服务端密钥 |
| `SESSION_SECRET` | Secret | 至少32字符的独立随机值，用于签名匿名身份 |
| `MODERATION_SECRET` | Secret | 至少32字符的另一独立随机值，用于评论管理 |
| `RECAPTCHA_MIN_SCORE` | 普通变量，可选 | 默认 `0.5` |

密钥只填 Cloudflare 控制台，不要提交到 Git、截图分享或粘贴到公开评论中。可在自己的电脑执行 `openssl rand -hex 32` 分别生成后两项。更换 `SESSION_SECRET` 会使原浏览器身份失效，可能导致重新评分。

Google 管理后台应添加实际 `pages.dev` 主机名和之后绑定的自定义域名。服务端同时检查 token 成功状态、来源主机名、操作名称、有效期、v3分数和错误字段；即使某些旧 Google 接口在超额时返回成功，也拒绝带错误的结果。每次评分、修改评分或发表评论均需新 token。

可选 Turnstile：将 `CAPTCHA_PROVIDER` 改为 `turnstile`，替换配对的 Site key／Secret。中国区专用端点不在当前实现范围内；不要将中国区密钥填入全球端点配置。未配置数据库或验证码时不显示评价入口，不提供关闭验证码的生产开关。

## 4. 重部署与验收

绑定和运行时变量设置后重新部署。检查：

- `/api/health`：数据库迁移完成时 `ok: true`；`reviewsEnabled: true` 表示必需配置已存在，不代表真实验证码已验证成功。
- 首页保留12周、55天菜单，按北京时间打开今天；调休日期可选。
- 展开菜名，进入“评分与同学评价”；首次应没有虚构评分或评论。
- 用真实网站密钥完成一次1—5星评分，再修改，人数仍为1。
- 发一条评论，提交后提示待审核，公开列表不会立即显示。
- 打开 `/moderate.html`，输入 `MODERATION_SECRET` 审核评论，再回到菜品确认可见。
- 验证取消、网络失败或密钥缺失时，不得写入评分或评论。

匿名评分只约束当前浏览器身份，清除 Cookie 可获得新身份，不能宣称严格一人一票。学校共用出口不按单个 IP 只许一人投票；IP仅用于高阈值频率限制，存入数据库前做带密钥的摘要。过期限流记录在后续成功提交时清理。昵称选填，不收集真实姓名、班级、邮箱或学号。评论内容作为纯文本显示，默认审核后公开。

## 5. 域名与切换

新站使用控制台实际返回的 `pages.dev` 地址，不预设项目域名一定可用。验证完成后再在 Pages 的 Custom domains 中添加自己的域名，并按控制台提示设置 DNS。自定义域名验证通过后，给验证码配置加入该主机名。

代码仍保留在 GitHub。现有服务器抓菜单后推送代码，Cloudflare 会跟随仓库更新；不用每条评论都运行 Actions。全学期补录仍然只能手动触发。当前未连接或配置任何用户远程服务器，不能据此认为自动抓取已经运行。

## 本地开发与测试

```bash
npm ci
cp deploy/wrangler.local.example.toml wrangler.toml
npx wrangler d1 migrations apply nhfls-menu --local
npm run dev
```

如需显示本地评价入口，在 `.dev.vars` 中加入与生产同名的变量。请使用专用于测试的验证服务密钥，勿用生产数据库；该文件已被 Git 忽略。直接静态预览仍能查看菜谱，缺少 API 时隐藏评价入口。

```bash
npm test
python3 -m unittest discover -s tests -v
npm run build:cf
npm run check:cf
```

接口测试用 SQLite 执行真实 SQL，并模拟验证服务返回；它们不会绕过线上验证码。Functions 打包验证使用 Cloudflare 官方 Wrangler。上线前仍需用真实 Cloudflare 绑定和验证码密钥验证。
