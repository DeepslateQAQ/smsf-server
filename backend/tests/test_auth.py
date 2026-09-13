"""认证路由测试（契约 §2）。

覆盖验收要求的全部场景：
- setup 建号并可立刻 GET /me；第二次 setup 403；未登录 /me 401；
- 密码错 5 次后第 6 次 429 且带 Retry-After；
- 正确登录后 logout 再访问 /me → 401；
- 公开注册默认关闭 403、打开后注册成功且 role=user；
- PATCH /me 改 theme_seed 生效；
- 改密后旧密码登录失败、新密码成功，且另一个预先建立的会话失效。
另外钉住会话只存 token 哈希、审计落库等安全关键细节。
"""

from __future__ import annotations

import datetime as dt

import pytest
from app.config import get_settings
from app.models import AuditLog, LoginAttempt, User
from app.models import Session as SessionModel
from app.security import hash_password, hash_session_token, login_limiter
from app.services import settings as app_settings
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

PASSWORD = "correct horse battery"
NEW_PASSWORD = "brand new correct horse"


@pytest.fixture(autouse=True)
def _clear_login_limiter():
    login_limiter._hits.clear()
    yield
    login_limiter._hits.clear()


# --------------------------------------------------------------------- 便捷函数


def _setup(
    client: TestClient,
    username: str = "admin",
    password: str = PASSWORD,
    display_name: str = "管理员",
):
    response = client.post(
        "/api/auth/setup",
        json={"username": username, "password": password, "display_name": display_name},
    )
    assert response.status_code == 201, response.text
    return response


def _login(client: TestClient, username: str, password: str):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def _register(client: TestClient, username: str, password: str = PASSWORD):
    return client.post(
        "/api/auth/register",
        json={"username": username, "password": password, "display_name": username},
    )


def _make_user(
    db: DbSession,
    username: str,
    *,
    password: str = PASSWORD,
    role: str = "user",
    is_active: bool = True,
) -> User:
    user = User(
        username=username,
        display_name=username,
        password_hash=hash_password(password),
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_login_ip_limiter_blocks_cross_username_spray(client: TestClient) -> None:
    settings = get_settings()
    original_limit = settings.login_ip_max_failures
    settings.login_ip_max_failures = 2
    login_limiter._hits.clear()
    try:
        assert _login(client, "spray-one", "wrong-password").status_code == 401
        assert _login(client, "spray-two", "wrong-password").status_code == 401
        blocked = _login(client, "spray-three", "wrong-password")
        assert blocked.status_code == 429
        assert blocked.headers["Retry-After"] == str(settings.login_ip_lock_minutes * 60)
    finally:
        settings.login_ip_max_failures = original_limit
        login_limiter._hits.clear()


# --------------------------------------------------------------------- 初始化


def test_setup_creates_admin_and_logs_in(client: TestClient, db: DbSession) -> None:
    settings = get_settings()

    status = client.get("/api/auth/setup-status")
    assert status.status_code == 200
    assert status.json() == {"setup_required": True, "allow_public_registration": False}

    response = _setup(client, username="boss", display_name="岩")
    body = response.json()
    assert body["username"] == "boss"
    assert body["display_name"] == "岩"
    assert body["role"] == "admin"
    assert body["is_admin"] is True
    assert body["is_active"] is True
    assert body["last_login_at"] is None

    cookie_header = response.headers["set-cookie"]
    assert settings.session_cookie_name in cookie_header
    assert "HttpOnly" in cookie_header
    assert "SameSite=lax" in cookie_header
    assert "Path=/" in cookie_header
    assert f"Max-Age={settings.session_ttl_days * 86400}" in cookie_header
    assert ("; Secure" in cookie_header) is settings.cookie_secure

    # 建号后立刻可以访问 /me
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "boss"
    assert client.get("/api/auth/setup-status").json()["setup_required"] is False

    # 数据库只存 token 哈希，并记录 ip / user_agent
    raw = client.cookies.get(settings.session_cookie_name)
    assert raw
    db.rollback()
    row = db.execute(select(SessionModel).where(SessionModel.user_id == body["id"])).scalar_one()
    assert row.token_hash == hash_session_token(raw)
    assert row.token_hash != raw
    assert len(row.token_hash) == 64
    assert row.ip == "testclient"
    assert row.user_agent
    assert row.expires_at > dt.datetime.now(dt.UTC)


def test_second_setup_is_forbidden(client: TestClient, db: DbSession) -> None:
    _setup(client, username="only-one")

    second = client.post(
        "/api/auth/setup",
        json={"username": "another", "password": PASSWORD, "display_name": ""},
    )
    assert second.status_code == 403

    db.rollback()
    assert db.scalar(select(func.count(User.id))) == 1


# --------------------------------------------------------------------- 会话


def test_me_requires_login(client: TestClient) -> None:
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"]


def test_login_then_logout_invalidates_session(client: TestClient, db: DbSession) -> None:
    _setup(client, username="session-user")
    client.post("/api/auth/logout")

    logged_in = _login(client, "session-user", PASSWORD)
    assert logged_in.status_code == 200, logged_in.text
    assert logged_in.json()["username"] == "session-user"
    assert client.get("/api/auth/me").status_code == 200

    logged_out = client.post("/api/auth/logout")
    assert logged_out.status_code == 200
    assert logged_out.json() == {"ok": True}
    assert "Max-Age=0" in logged_out.headers["set-cookie"]
    assert client.get("/api/auth/me").status_code == 401

    db.rollback()
    assert db.scalar(select(func.count(SessionModel.id))) == 0


def test_login_updates_last_login_at(client: TestClient) -> None:
    _setup(client, username="stamp")
    client.post("/api/auth/logout")

    response = _login(client, "stamp", PASSWORD)
    assert response.status_code == 200
    assert response.json()["last_login_at"] is not None


# --------------------------------------------------------------------- 登录锁定


def test_login_locks_after_five_failures(client: TestClient, db: DbSession) -> None:
    settings = get_settings()
    _setup(client, username="target")

    for _ in range(settings.login_max_failures):
        response = _login(client, "target", "definitely-wrong")
        assert response.status_code == 401

    locked = _login(client, "target", PASSWORD)
    assert locked.status_code == 429
    assert locked.headers["Retry-After"] == str(settings.login_lock_minutes * 60)

    db.rollback()
    attempts = (
        db.execute(select(LoginAttempt).where(LoginAttempt.username == "target")).scalars().all()
    )
    assert len(attempts) == settings.login_max_failures
    assert all(attempt.success is False for attempt in attempts)


# --------------------------------------------------------------------- 公开注册


def test_register_requires_open_registration(client_factory, db: DbSession) -> None:
    owner = client_factory()
    _setup(owner, username="owner")

    stranger = client_factory()
    closed = _register(stranger, "newbie")
    assert closed.status_code == 403

    app_settings.update(db, {"allow_public_registration": True})
    assert owner.get("/api/auth/setup-status").json()["allow_public_registration"] is True

    opened = _register(stranger, "newbie")
    assert opened.status_code == 201, opened.text
    body = opened.json()
    assert body["username"] == "newbie"
    assert body["role"] == "user"
    assert body["is_admin"] is False
    # 注册即登录
    me = stranger.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "newbie"

    duplicate = _register(client_factory(), "newbie")
    assert duplicate.status_code == 409


# --------------------------------------------------------------------- 偏好


def test_patch_me_updates_theme_seed(client: TestClient) -> None:
    _setup(client, username="themer")

    response = client.patch(
        "/api/auth/me",
        json={"theme_seed": "#FF8800", "theme_mode": "dark", "locale": "en"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["theme_seed"] == "#FF8800"
    assert body["theme_mode"] == "dark"
    assert body["locale"] == "en"

    # 持久化：重新读取仍然是新值
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["theme_seed"] == "#FF8800"
    assert me.json()["theme_mode"] == "dark"


# --------------------------------------------------------------------- 改密


def test_password_change_revokes_other_sessions(client_factory, db: DbSession) -> None:
    first = client_factory()
    _setup(first, username="owner")

    second = client_factory()
    assert _login(second, "owner", PASSWORD).status_code == 200
    assert second.get("/api/auth/me").status_code == 200

    # 当前密码错 → 400，不改密
    wrong = first.post(
        "/api/auth/password",
        json={"current_password": "not-the-password", "new_password": NEW_PASSWORD},
    )
    assert wrong.status_code == 400
    assert _login(client_factory(), "owner", PASSWORD).status_code == 200

    changed = first.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json() == {"ok": True}

    # 当前会话保留，其它会话立即失效
    assert first.get("/api/auth/me").status_code == 200
    assert second.get("/api/auth/me").status_code == 401

    old_login = _login(client_factory(), "owner", PASSWORD)
    assert old_login.status_code == 401
    missing_login = _login(client_factory(), "nobody-here", PASSWORD)
    assert missing_login.status_code == 401
    # 用户不存在与密码错误必须返回同一个 detail，避免枚举
    assert old_login.json()["detail"] == missing_login.json()["detail"]

    fresh = client_factory()
    assert _login(fresh, "owner", NEW_PASSWORD).status_code == 200
    assert fresh.get("/api/auth/me").status_code == 200

    db.rollback()
    sessions = db.execute(select(SessionModel)).scalars().all()
    assert len(sessions) == 2  # 改密保留的当前会话 + 新密码登录的会话


def test_inactive_user_cannot_login(client_factory, db: DbSession) -> None:
    _make_user(db, "sleepy", is_active=False)

    response = _login(client_factory(), "sleepy", PASSWORD)
    assert response.status_code == 401
    assert response.json()["detail"] == "用户名或密码错误"


# --------------------------------------------------------------------- 审计


def test_auth_actions_are_audited(client: TestClient, db: DbSession) -> None:
    _setup(client, username="audited")
    _login(client, "audited", "wrong-password")
    assert _login(client, "audited", PASSWORD).status_code == 200
    assert (
        client.post(
            "/api/auth/password",
            json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        ).status_code
        == 200
    )
    assert client.post("/api/auth/logout").status_code == 200

    db.rollback()
    rows = db.execute(select(AuditLog)).scalars().all()
    actions = {row.action for row in rows}
    assert {
        "auth.setup",
        "auth.login_failed",
        "auth.login",
        "auth.password_change",
        "auth.logout",
    } <= actions
    # 审计必须带 ip / user_agent，且绝不落密码
    assert all(row.ip for row in rows)
    assert all(row.user_agent for row in rows)
    dumped = str([row.detail for row in rows])
    assert PASSWORD not in dumped
    assert NEW_PASSWORD not in dumped
