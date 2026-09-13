"""数据库引擎与会话。

SQLite 约定：
- WAL 模式（读写并发）、foreign_keys=ON、busy_timeout、synchronous=NORMAL
- 所有 datetime 以 UTC 存储；SQLite 无时区类型，因此用 UTCDateTime 统一读写为 aware UTC
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import unquote

from sqlalchemy import DateTime, Engine, TypeDecorator, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


class UTCDateTime(TypeDecorator[dt.datetime]):
    """存储为 naive UTC，读出为 aware UTC。避免 naive/aware 混用导致的时间偏移 bug。"""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: dt.datetime | None, dialect) -> dt.datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=dt.UTC).astimezone(dt.UTC).replace(tzinfo=None)
        return value.astimezone(dt.UTC).replace(tzinfo=None)

    def process_result_value(self, value: dt.datetime | None, dialect) -> dt.datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=dt.UTC)


def _apply_pragmas(dbapi_connection, _record) -> None:
    cur = dbapi_connection.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


def create_db_engine(url: str | None = None) -> Engine:
    settings = get_settings()
    target = url or settings.database_url

    connect_args: dict[str, object] = {}
    if target.startswith("sqlite"):
        if ":memory:" in target:
            # 测试用内存库必须共享同一连接
            from sqlalchemy.pool import StaticPool

            connect_args["check_same_thread"] = False
            engine = create_engine(target, connect_args=connect_args, poolclass=StaticPool)
            event.listen(engine, "connect", _apply_pragmas)
            return engine
        connect_args["check_same_thread"] = False
        _ensure_sqlite_dir(target)

    engine = create_engine(target, connect_args=connect_args, future=True)
    if target.startswith("sqlite"):
        event.listen(engine, "connect", _apply_pragmas)
    return engine


def _ensure_sqlite_dir(url: str) -> None:
    prefix = "sqlite+pysqlite:///"
    if not url.startswith(prefix):
        return
    path = Path(unquote(url[len(prefix) :]))
    if path.name == ":memory:":
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        # 典型场景：从只读目录（Nix store、容器只读层）启动且没有指定可写数据目录。
        # 这里给一句能直接照做的提示，而不是把裸 OSError 抛给用户。
        raise RuntimeError(
            f"无法创建数据库目录 {path.parent}：{exc}。"
            "请把 SMSF_DATABASE_URL 或 SMSF_DATA_DIR 指向一个可写路径后重试。"
        ) from exc


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
