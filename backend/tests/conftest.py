"""测试基座。

- 每个测试用例一个临时 SQLite 文件（WAL + 外键），用 Base.metadata.create_all 建表
- 用依赖覆盖把 get_db 指到测试引擎；不使用 TestClient 的上下文管理器，
  因此不会触发 lifespan（也就不会跑 Alembic 迁移）
- 多用户场景用 client_factory 造多个独立 cookie jar 的客户端
"""

from __future__ import annotations

import datetime as dt
import socket
import threading
import time
from collections.abc import Callable, Iterator

import pytest
import uvicorn
from app.config import get_settings
from app.db import Base, create_db_engine, get_db
from app.main import app as fastapi_app
from app.main import create_app
from app.models import Device, User
from app.security import hash_password, new_device_secret, secret_fingerprint
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import sessionmaker

DEFAULT_PASSWORD = "correct horse battery"


@pytest.fixture()
def engine(tmp_path) -> Iterator[Engine]:
    url = f"sqlite+pysqlite:///{tmp_path / 'test.sqlite3'}"
    engine = create_db_engine(url)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def session_factory(engine: Engine) -> sessionmaker[DbSession]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@pytest.fixture()
def db(session_factory: sessionmaker[DbSession]) -> Iterator[DbSession]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client_factory(session_factory: sessionmaker[DbSession]) -> Callable[[], TestClient]:
    def factory() -> TestClient:
        app = create_app()

        def override_get_db() -> Iterator[DbSession]:
            session = session_factory()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_get_db
        return TestClient(app)

    return factory


@pytest.fixture()
def client(client_factory: Callable[[], TestClient]) -> TestClient:
    return client_factory()


# --------------------------------------------------------------------- 便捷构造


def make_user(
    db: DbSession,
    username: str,
    *,
    password: str = DEFAULT_PASSWORD,
    role: str = "user",
    display_name: str = "",
    is_active: bool = True,
) -> User:
    user = User(
        username=username,
        display_name=display_name or username,
        password_hash=hash_password(password),
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_device(
    db: DbSession,
    owner: User,
    *,
    name: str = "设备",
    secret: str | None = None,
    device_mark: str | None = None,
    is_active: bool = True,
) -> Device:
    secret = secret or new_device_secret()
    device = Device(
        owner_id=owner.id,
        name=name,
        secret=secret,
        secret_fingerprint=secret_fingerprint(secret),
        device_mark=device_mark or f"mark-{name}-{owner.id}",
        is_active=is_active,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def login(client: TestClient, username: str, password: str = DEFAULT_PASSWORD) -> None:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text


def setup_admin(
    client: TestClient, username: str = "admin", password: str = DEFAULT_PASSWORD
) -> dict:
    response = client.post(
        "/api/auth/setup",
        json={"username": username, "password": password, "display_name": "管理员"},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture()
def admin_client(client_factory: Callable[[], TestClient]) -> TestClient:
    client = client_factory()
    setup_admin(client)
    return client


def utc(*args: int) -> dt.datetime:
    """便捷构造 UTC 时间：utc(2026, 9, 12, 10, 30)。"""
    return dt.datetime(*args, tzinfo=dt.UTC)  # type: ignore[arg-type]


# --------------------------------------------------------------------- 真实服务器 / 隔离
#
# SSE（/api/events）是无限流：Starlette 的 TestClient 与 httpx 的 ASGITransport 都会
# 把响应体缓冲到结束才返回，遇到无限事件流会永久挂起。因此事件流相关的端到端测试
# 起一个真实的 uvicorn（真 TCP 套接字），用 httpx.AsyncClient 做增量流式读取。

_TABLES_IN_FK_ORDER = (
    "messages",
    "device_shares",
    "sessions",
    "login_attempts",
    "audit_logs",
    "devices",
    "users",
    "settings",
)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _truncate_all(target: Engine) -> None:
    with target.begin() as conn:
        for table in _TABLES_IN_FK_ORDER:
            conn.execute(text(f"DELETE FROM {table}"))


@pytest.fixture(scope="session")
def server_db(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Engine]:
    """真实服务器专用的一次性数据库。

    绝对不能复用 ``app.db.engine``：它指向 ``SMSF_DATABASE_URL``（默认是
    ``backend/data/smsf.sqlite3``，也就是「源码直跑」模式的生产库）。
    测试清库一旦落在那个文件上，跑一次 pytest 就会抹掉用户真实短信。
    """
    path = tmp_path_factory.mktemp("e2e-server") / "server.sqlite3"
    engine = create_db_engine(f"sqlite+pysqlite:///{path}")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def server_url(server_db: Engine) -> Iterator[str]:
    """起一个真实 uvicorn 服务，供 SSE 流式端到端测试使用。

    指向模块级 ``fastapi_app``（必须与测试里 import 的同一个对象，否则
    ``dependency_overrides`` 不生效），但把 ``get_db`` 覆盖到一次性库上，
    并关掉自动迁移，避免 lifespan 去动生产库路径。
    """
    original_auto_migrate = get_settings().auto_migrate
    get_settings().auto_migrate = False
    app_session_factory = sessionmaker(
        bind=server_db, autoflush=False, expire_on_commit=False, future=True
    )

    def override_get_db() -> Iterator[DbSession]:
        session = app_session_factory()
        try:
            yield session
        finally:
            session.close()

    fastapi_app.dependency_overrides[get_db] = override_get_db

    port = _free_port()
    config = uvicorn.Config(fastapi_app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 15
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:  # pragma: no cover - 环境异常
        raise RuntimeError("uvicorn 测试服务器启动失败")
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        fastapi_app.dependency_overrides.pop(get_db, None)
        get_settings().auto_migrate = original_auto_migrate


@pytest.fixture(autouse=True)
def clean_db(server_db: Engine) -> Iterator[None]:
    """清空**测试专用的**服务器库（子表在前，规避外键约束）。"""
    _truncate_all(server_db)
    try:
        yield
    finally:
        _truncate_all(server_db)
