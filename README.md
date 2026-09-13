# SMSForwarder 短信中心

SMSForwarder 服务端（`smsf-server`）接收手机端 [SmsForwarder](https://github.com/pppscn/SmsForwarder) 推送的短信、通知和来电，并提供网页端检索、验证码提取、设备共享与用户管理。

## 特性

- FastAPI + SQLite，单文件数据库，便于备份
- React + MUI 前端，由后端托管生产构建产物
- Argon2id 密码哈希、不透明会话 Cookie
- 设备支持 HMAC-SHA256 签名和 Bearer secret
- 管理员只能管理元数据，不能绕过设备可见范围读取短信正文
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
3. 在 SmsForwarder 中创建 Webhook：
   - URL：`http(s)://主机地址:8801/api/v1/ingest`
   - 方法：`POST`
   - Header：`Content-Type: application/json`
4. 请求体使用：

```json
{
  "from": "[from]",
  "content": "[content]",
  "org_content": "[org_content]",
  "receive_time": "[receive_time:yyyy-MM-dd'T'HH:mm:ssXXX]",
  "timestamp": "[timestamp]",
  "sign": "[sign]",
  "device_mark": "[device_mark]",
  "card_slot": "[card_slot]"
}
```

在 SmsForwarder 的「密钥」中填设备 `secret`，在「设备备注」中填 `device_mark`。服务端签名规则为：

```text
Base64(HMAC-SHA256(secret, "{timestamp}\\n{secret}"))
```

低版本 Android 不支持 `XXX` 时，将 `receive_time` 改为 `yyyy-MM-dd'T'HH:mm:ssZ`。

设备页的「接入向导」最后一步会自动等待测试推送，并在收到消息后显示连接结果。

## 配置

所有配置使用 `SMSF_` 前缀，完整示例见 `.env.example`。常用配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SMSF_DATABASE_URL` | 自动推导 | SQLite 连接串 |
| `SMSF_DATA_DIR` | `./data` | 数据目录 |
| `SMSF_PORT` | `8801` | 服务端口 |
| `SMSF_COOKIE_SECURE` | `false` | HTTPS 部署时设为 `true` |
| `SMSF_ROOT_PATH` | 空 | 反向代理前缀，例如 `/smsf` |
| `SMSF_TRUSTED_PROXY` | `false` | 是否信任 `X-Forwarded-For` |
| `SMSF_LOGIN_MAX_FAILURES` | `5` | 单用户名失败次数 |
| `SMSF_LOGIN_LOCK_MINUTES` | `15` | 单用户名锁定时间 |
| `SMSF_LOGIN_IP_MAX_FAILURES` | `20` | 单 IP 失败次数 |
| `SMSF_LOGIN_IP_LOCK_MINUTES` | `15` | 单 IP 限速窗口 |
| `SMSF_SIGN_MAX_SKEW_HOURS` | `24` | 签名时间允许偏差 |

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
