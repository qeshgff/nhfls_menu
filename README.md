# 河外饭点 · NHFLS Menu

南京河西外国语学校**中学部**菜谱查看器。手机单列显示三餐，电脑并排显示；提供每日菜单、整周总览、菜名与食材搜索、官网原文入口和打印。

这是学生制作的非官方应用，实际供餐以学校食堂为准。

午晚餐按实际取餐规则分为 **大荤（三选一）／小荤（二选一）／素菜（两种必选）／特色餐／汤**，晚餐另列 **糕点**。每日菜单、整周总览、搜索结果统一显示分类。分类根据已经确认的官网表格顺序，不按菜名里的“肉”“汤”等字猜测；例如淮南牛肉汤属于特色餐。

官网同一格合并列出的“排骨面、大肉面”会拆开显示，并保留共用食材说明；某天官网只公布一种特色餐时，只显示已经公布的内容。官网结构出现未确认的行数时保留完整列表，提示分类待确认，避免漏菜。

## 架构

- `docs/`：无需构建的静态网站，HTML / CSS / JavaScript，所有资源本地托管，没有外部字体、CDN 或浏览器抓取代理。
- `docs/data/menus.json`：菜单及来源记录，也是网站直接读取的数据。
- `scripts/fetch_menu.py`：Python 3.10+ 标准库抓取器，无 pip 依赖。处理合并单元格、过滤小学部、校验日期和餐次，完整解析成功后才原子替换数据；无变化时不改时间戳。
- `scripts/sync.sh`：服务器定时执行，拉取代码、抓菜单、有变化才提交，随后推送；带文件锁，失败退出，工作区脏或分支不对时停止。
- `deploy/`：可选的 systemd 定时任务。

菜单只从[学校官网每周菜谱](https://www.nhfls.com.cn/mzsp/list.htm)同步，不需要学校账号。服务器更新数据，访客只访问 GitHub Pages。

## 开启 GitHub Pages

1. 打开本仓库 **Settings → Pages**。
2. 在 **Build and deployment → Source** 选择 **Deploy from a branch**。
3. 分支选择 **main**，目录选择 **/docs**，点击 **Save**。
4. 等待仓库 Actions 中的 Pages 发布完成。默认地址为 `https://qeshgff.github.io/nhfls_menu/`。

Pages 无需 Node 构建步骤。另有独立的手动学期补录任务，不影响分支发布方式。

### 绑定自己的域名

先在 Pages 的 **Custom domain** 中填入域名，如 `menu.example.com`，保存后在 DNS 添加：

| 类型 | 名称 | 目标 |
| --- | --- | --- |
| CNAME | menu | qeshgff.github.io |

目标不要带仓库名称。域名验证成功后开启 **Enforce HTTPS**。建议在 GitHub 账号的 Pages 设置中验证域名归属。GitHub Pages 在大陆的访问速度需用自己的网络实测；自定义域名不会改变源站线路。

## 本地预览

```bash
git clone https://github.com/qeshgff/nhfls_menu.git
cd nhfls_menu
python3 -m http.server 8080 --directory docs
```

打开 `http://localhost:8080`。请通过 HTTP 访问；直接双击 HTML 的 `file://` 方式无法正常加载 JSON 和 ES 模块。

## 服务器定时同步

在专用检出目录运行，不要和日常开发共用有未提交改动的工作区。以下命令以 Debian / Ubuntu 为例：

```bash
sudo apt-get update
sudo apt-get install -y git python3 util-linux openssh-client
```

用运行定时任务的普通用户克隆仓库，并设置提交身份：

```bash
git clone https://github.com/qeshgff/nhfls_menu.git
cd nhfls_menu
git config user.name 'Menu sync'
git config user.email 'menu-sync@users.noreply.github.com'
```

### 配置单仓库 SSH Deploy Key

如果服务器已有可写 GitHub 的 SSH 身份，可以复用对应身份。否则给此项目单独生成密钥，将**公钥**加到仓库 **Settings → Deploy keys → Add deploy key**，启用 **Allow write access**。私钥仅留在服务器上，不要提交到仓库，也不需要发给他人。

```bash
ssh-keygen -t ed25519 -f ~/.ssh/nhfls_menu -C nhfls-menu-sync
cat ~/.ssh/nhfls_menu.pub
```

给 `~/.ssh/config` 增加项目别名：

```sshconfig
Host github-nhfls-menu
    HostName github.com
    User git
    IdentityFile ~/.ssh/nhfls_menu
    IdentitiesOnly yes
```

首次连接按 GitHub 官方公布的指纹核验主机身份。定时任务不支持交互式输入密码；密钥应能在任务用户的运行环境中使用。

```bash
ssh -T github-nhfls-menu
git remote set-url origin git@github-nhfls-menu:qeshgff/nhfls_menu.git
bash scripts/sync.sh
```

GitHub 的 `ssh -T` 在认证成功后仍可能以退出码 1 结束，以返回的认证成功文字为准。

### 使用 cron（简单方式）

在**同一个运行用户**下执行 `crontab -e`，加入以下内容，把路径换成实际克隆目录：

```cron
17 */4 * * * /bin/bash /绝对路径/nhfls_menu/scripts/sync.sh >> /绝对路径/nhfls_menu-sync.log 2>&1
```

每四小时检查一次，时间按服务器时区。没有新菜单不会产生重复提交。日志放仓库外，并按需轮转。

### 使用 systemd（可选，与 cron 二选一）

编辑 `deploy/nhfls-menu.service` 的 `User`、`WorkingDirectory` 和 `ExecStart`，指向现有普通用户和克隆路径。该用户必须拥有检出目录和上述 SSH 身份。再安装服务：

```bash
sudo cp deploy/nhfls-menu.service deploy/nhfls-menu.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nhfls-menu.timer
systemctl list-timers nhfls-menu.timer
journalctl -u nhfls-menu.service -n 50
```

定时器明确使用北京时间，每四小时检查一次，并加最多十分钟的随机延迟。只安装模板文件并不会在未配置的远程服务器上自动生效。

## 手动抓取与验证

```bash
python3 scripts/fetch_menu.py
python3 scripts/fetch_menu.py --max-weeks 1
python3 -m unittest discover -s tests -v
node --test tests/menu-utils.test.mjs
```

`--max-weeks` 默认 4，检查列表中最近几周，保留已收录历史。任何待检查页面下载或解析失败，本次更新全部停止，保留原数据。若官网表格结构变化，需要修复解析器，不会用空数据覆盖旧菜单。

### 补录整个学期

```bash
python3 scripts/backfill_semester.py --semester 2026-2027-1
```

学期格式为“起始年-结束年-学期序号”。程序翻页读取官网目录，只导入指定学期的中学部食谱，跨入更早学期后停止。完整解析的周菜单会合并到已有数据，不删除历史；失败周不会替换已有内容。

核对 `docs/data/import-report.json`：`catalogComplete` 表示目录是否遍历完成，`discovered` 是找到的原文，`imported` 是成功解析的周，`failed` 列出失败原因。只要有失败，命令以非零状态结束，不能视为全学期收齐。`--archive /仓库外/目录` 可保留本次官网原始 HTML。

也可打开仓库 **Actions → Import published semester menus → Run workflow**，输入学期执行。此任务没有定时计划；成功的数据和核对报告自动提交，原始网页保留为 7 天的 Actions artifact。全学期补录仅手动运行，修改代码不会自动触发。GitHub Actions 自带 token 提交不会自动触发 Pages；补录后需要再从普通 GitHub 身份提交，或在 Pages 发布任务中手动重新运行发布。

离线解析测试：

```bash
python3 scripts/fetch_menu.py \
  --html tests/fixtures/reconstructed-week12.html \
  --url https://www.nhfls.com.cn/2026/1113/c88a4916/page.htm \
  --output /tmp/nhfls-menu-test.json
```

## 收录数据与验证范围

已补录官网截至 2026 年 11 月 16 日公布的 **2026—2027 学年第一学期中学部第 1—12 周**，覆盖 **9 月 1 日至 11 月 20 日、55 个供餐日、1,638 项原表菜品条目**。节假日和调休按官网原文日期记录，不补造休息日菜单。每周保留详情页来源与发布时间。

其中 11 周直接解析官网原始 HTML 表格；第 6 周（10 月 8—10 日）为图片，人工核对转录 90 个条目，记录在 `scripts/curated/2026-10-08.json`。补录器同时核对原图片地址和 SHA-256；图片变化时停止复用转录结果并报错，需重新核对。官网菜名和食材中的个别不一致照录，不将原料克重当作实际取餐重量或营养计算。

`docs/data/import-report.json` 记录目录遍历和逐周解析结果。原始官网页面和第 6 周图片可在补录任务的 Actions artifact 中核对（保留 7 天）。旧的 `tests/fixtures/reconstructed-week12.html` 仍只是初版重建测试夹具，不是原始网页存档。测试覆盖分页学期边界、图文来源校验、合并单元格、跨年、短周、跨自然周调休、缺餐/缺日期拒绝更新、失败保留旧数据和无变化不重复写入。

用户日期按 `Asia/Shanghai` 计算。周末、未发布日期和旧数据会显示明确状态，不把旧菜单标成今天。尚未收录历史时，搜索仅覆盖已收录的数据。
