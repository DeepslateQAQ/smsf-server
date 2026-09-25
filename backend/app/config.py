"""应用配置。全部来自环境变量，前缀 SMSF_。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 代码所在目录。只用于定位包内资源（静态文件、alembic 脚本），
# **绝不能**用来推导可写数据目录：Nix 打包后代码位于只读的 /nix/store，
# 在那里建目录会直接 OSError 崩在 import 阶段。
APP_DIR = Path(__file__).resolve().parent
DB_FILENAME = "smsf.sqlite3"


def resolve_data_dir(explicit: str | None = None) -> Path:
    """数据目录解析顺序：`SMSF_DATA_DIR` → `<当前工作目录>/data`。

    - 显式给了 `SMSF_DATA_DIR`（Nix wrapper / systemd 会设）就用它；
    - 否则落在 CWD 下的 `data/`，行为可预测且与 `cd backend && uv run ...` 的直觉一致。
    """
    if explicit:
        return Path(explicit).expanduser()
    return Path.cwd() / "data"


def default_database_url(explicit_data_dir: str | None = None) -> str:
    return f"sqlite+pysqlite:///{resolve_data_dir(explicit_data_dir) / DB_FILENAME}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SMSF_", env_file=".env", extra="ignore")

    # 数据库：留空则由 data_dir / CWD 推导（见 resolve_data_dir）
    database_url: str = ""
    data_dir: str | None = None

    # 会话
    session_ttl_days: int = 30
    session_cookie_name: str = "smsf_session"
    cookie_secure: bool = False  # 反代走 HTTPS 时置 true

    # 部署
    host: str = "0.0.0.0"
    port: int = 8801
    auto_migrate: bool = True
    log_level: str = "INFO"
    root_path: str = ""
    trusted_proxy: bool = False
    static_dir: Path = APP_DIR / "static"

    # 入库防护
    max_body_bytes: int = 32 * 1024
    max_content_chars: int = 8192
    rate_limit_per_device_per_min: int = 60

    # 登录防护：用户名锁定之外，再按来源 IP 限制跨用户名喷洒
    login_max_failures: int = 5
    login_lock_minutes: int = 15
    login_ip_max_failures: int = 20
    login_ip_lock_minutes: int = 15
    sign_max_skew_hours: int = 24

    # 前端
    dev_cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    @field_validator("log_level", mode="before")
    @classmethod
    def _normalize_log_level(cls, value: object) -> str:
        level = str(value).upper()
        if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError("log_level must be DEBUG, INFO, WARNING, ERROR or CRITICAL")
        return level


    @model_validator(mode="after")
    def _fill_database_url(self) -> Settings:
        if not self.database_url:
            self.database_url = default_database_url(self.data_dir)
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.dev_cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
