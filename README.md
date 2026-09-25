# SMSForwarder 短信中心

SMSForwarder 服务端（`smsf-server`）接收手机端 [SmsForwarder](https://github.com/pppscn/SmsForwarder) 推送的短信、通知和来电，并提供网页端检索、验证码提取、设备共享与用户管理。

> [!WARNING]
> 本项目属于「岩酱的奇思妙想」系列，代码主要由人工智能生成并维护。请在使用前充分评估其安全性、可靠性与适用性，并谨慎用于生产环境。

## 特性

- FastAPI + SQLite，单文件数据库，便于备份
- React + MUI 前端，由后端托管生产构建产物
- Argon2id 密码哈希、不透明会话 Cookie
- 设备支持 HMAC-SHA256 签名和 Bearer secret
- 消息正文访问范围严格受设备可见性限制，管理员不能绕过权限读取消息正文
- 实时消息通过 SSE 推送

## 使用方式

### Docker Compose

```bash
cp .env.example .env
docker compose pull
docker compose up -d
docker compose logs -f smsf
```

打开 `http://主机地址:8801`，首次访问时创建管理员账号。数据保存在仓库根目录的 `data/`，数据库文件为 `data/smsf.sqlite3`。

### 源码运行

需要 Python 3.13、[uv](https://docs.astral.sh/uv/)、Node.js 和 pnpm。

```bash
uv sync --directory backend --dev
./start.sh
```

`start.sh` 会进入 `backend/`、执行 `alembic upgrade head`，然后以单 worker 启动服务。服务依赖进程内 SSE 中枢，不要使用多个 worker。

也可以手动启动：

```bash
cd backend
uv sync --dev
uv run alembic upgrade head
uv run uvicorn app.main:app --host 0.0.0.0 --port 8801 --workers 1
```

### 前端开发

```bash
cd frontend
pnpm install
pnpm dev
```

Vite 会把 `/api` 请求代理到 `http://127.0.0.1:8801`。

## 接入设备

1. 登录网页端，进入「设备」并创建设备。
2. 保存创建响应中只显示一次的 `secret` 和 `device_mark`。
3. 在 SmsForwarder 的「发送通道」中新建「Webhook」：
   - Webhook Server：`http(s)://主机地址:8801/api/v1/ingest`
   - 请求方式：`POST`
4. 在「消息模板」中填入：

```json
{
  "from": "[from]",
  "content": "[content]",
  "org_content": "[org_content]",
  "receive_time": "[receive_time:yyyy-MM-dd'T'HH:mm:ssXXX]",
  "timestamp": "[timestamp]",
  "sign": "[sign]",
  "device_mark": "<本设备的 device_mark>",
  "card_slot": "[card_slot]"
}
```

5. 将设备 `secret` 填入「Secret」。网页端的接入向导会把本设备的 `device_mark` 直接写入消息模板，无需修改 App 的全局设置。
6. 在「Headers」中添加：键 `Content-Type`，值 `application/json`。
7. 在「通用设置」中完成短信转发与保活配置：
   - 打开「转发短信广播」，按提示授予读取短信、通知类短信、发送短信等权限，并关闭验证码保护。
   - 在「保活措施」中开启「开机启动」「忽略电池优化设置」「在最近任务列表中隐藏」，不要禁用通知栏；可选开启 Cactus 增强保活措施。
8. 在「转发规则」页面点击「添加转发规则」：
   - 选择「发送通道」，配置「匹配字段」「匹配模式」「匹配的值」，并启用规则。
   - 选择你创建的 Webhook 通道；通道名称可填「短信中心」。

服务端签名规则为：

```text
Base64(HMAC-SHA256(secret, "{timestamp}\\n{secret}"))
```

低版本 Android 不支持 `XXX` 时，将 `receive_time` 改为 `yyyy-MM-dd'T'HH:mm:ssZ`。

设备页的「接入向导」进入测试步骤后会自动等待测试推送，并在收到首条推送后在窗口内显示连接结果。测试期间收到的推送只用于本次验证，不写入消息库；测试结束后恢复正常入库。

## 配置

所有配置使用 `SMSF_` 前缀，完整示例见 `.env.example`。常用配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SMSF_DATABASE_URL` | 自动推导 | SQLite 连接串 |
| `SMSF_DATA_DIR` | `./data` | 数据目录 |
| `SMSF_PORT` | `8801` | 服务端口 |
| `SMSF_COOKIE_SECURE` | `false` | HTTPS 部署时设为 `true` |
| `SMSF_ROOT_PATH` | 空 | 反向代理前缀，例如 `/smsf` |
| `SMSF_CLIENT_IP_SOURCE` | `off` | 客户端 IP 来源：`off`、`x-forwarded-for` 或 `cf-connecting-ip`。XFF 仅适合可信单层代理并取最右段；CF 模式要求 TCP 对端属于 Cloudflare 网段。
| `SMSF_LOGIN_MAX_FAILURES` | `5` | 单用户名失败次数 |
| `SMSF_LOGIN_LOCK_MINUTES` | `15` | 单用户名锁定时间 |
| `SMSF_LOGIN_IP_MAX_FAILURES` | `20` | 单 IP 失败次数 |
| `SMSF_LOGIN_IP_LOCK_MINUTES` | `15` | 单 IP 限速窗口 |
| `SMSF_SIGN_MAX_SKEW_HOURS` | `24` | 签名时间允许偏差 |

Cloudflare 网段在服务启动时抓取并每 24 小时刷新一次；抓取失败时回退到内置网段列表。`cf-connecting-ip` 模式仅在 TCP 对端确实是 Cloudflare 边缘 IP 时生效；如果前面还有本机 Nginx 或 Cloudflare Tunnel，请使用 `x-forwarded-for` 模式。
通过 HTTPS 公开服务时，建议同时启用 `SMSF_COOKIE_SECURE=true`，并在 Cloudflare Access 或其他反向代理层增加访问控制。

## 备份

SQLite 使用 WAL。运行服务时不要直接复制数据库文件，使用 SQLite 在线备份：

```bash
sqlite3 data/smsf.sqlite3 ".backup 'backup/smsf-$(date +%F).sqlite3'"
```

恢复前停止服务，并删除旧数据库对应的 `-wal` 与 `-shm` 文件。

## 开发

运行后端测试、静态检查和类型检查：

```bash
cd backend
uv run pytest
uv run ruff check app tests
uv run mypy app
```

运行前端检查和构建：

```bash
cd frontend
pnpm typecheck
pnpm test
pnpm build
```

`scripts/fake_push.py` 可用于本地模拟设备推送：

```bash
python3 scripts/fake_push.py --help
```

## 许可证

本项目以 GNU General Public License v3.0（GPLv3）发布。
