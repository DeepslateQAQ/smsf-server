"""Security regression tests for authentication, ingestion limits, and static file serving."""

from __future__ import annotations

import time

import pytest
from app.config import get_settings
from app.db import get_db
from app.main import create_app
from app.security import compute_signature
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as DbSession

from .conftest import DEFAULT_PASSWORD, login, make_device, make_user

INGEST = "/api/v1/ingest"
STALE_HOURS = 72


def _signed_payload(secret: str, *, timestamp_ms: int, device_mark: str | None = None) -> dict:
    payload = {
        "from": "10086",
        "content": "验证码 4321",
        "timestamp": str(timestamp_ms),
        "sign": compute_signature(secret, timestamp_ms, url_encode=True),
    }
    if device_mark:
        payload["device_mark"] = device_mark
    return payload


# ------------------------------------------------------------------ 1. 计时侧信道


def test_unknown_user_login_still_hashes_password(client: TestClient, db: DbSession) -> None:
    """不存在的用户也必须做一次 Argon2 校验，否则可用响应时间枚举用户名。

    断言时间下界而不是精确值：Argon2id(m=64MB) 单次校验在数十毫秒量级，
    取 20% 的比值下限既不会误伤慢机器，又能在「直接 return」时立刻失败。
    """
    make_user(db, "known", password=DEFAULT_PASSWORD)

    started = time.perf_counter()
    unknown = client.post("/api/auth/login", json={"username": "nobody", "password": "x" * 12})
    unknown_seconds = time.perf_counter() - started

    started = time.perf_counter()
    wrong = client.post("/api/auth/login", json={"username": "known", "password": "wrong" * 3})
    wrong_seconds = time.perf_counter() - started

    assert unknown.status_code == 401
    assert wrong.status_code == 401
    assert unknown.json() == wrong.json() == {"detail": "用户名或密码错误"}
    assert unknown_seconds > wrong_seconds * 0.2, (
        f"未知用户登录耗时 {unknown_seconds:.4f}s 远低于密码错误 {wrong_seconds:.4f}s，"
        "说明没有跑 Argon2 校验（计时侧信道回来了）"
    )


# ------------------------------------------------------------------ 2. 签名时间窗


def test_stale_signature_is_rejected(client: TestClient, db: DbSession) -> None:
    owner = make_user(db, "owner")
    device = make_device(db, owner, secret="stale-sign-secret")
    stale_ms = int((time.time() - STALE_HOURS * 3600) * 1000)

    response = client.post(
        INGEST,
        json=_signed_payload(device.secret, timestamp_ms=stale_ms, device_mark=device.device_mark),
    )
    assert response.status_code == 401, response.text


def test_fresh_signature_is_accepted(client: TestClient, db: DbSession) -> None:
    """对照组：同样的请求只把时间戳换成当前时间就该通过。"""
    owner = make_user(db, "owner2")
    device = make_device(db, owner, secret="fresh-sign-secret", name="fresh")
    fresh_ms = int(time.time() * 1000)

    response = client.post(
        INGEST,
        json=_signed_payload(device.secret, timestamp_ms=fresh_ms, device_mark=device.device_mark),
    )
    assert response.status_code == 200, response.text
    assert response.json()["code"] == "4321"


def test_bearer_still_works_with_stale_timestamp_but_marks_sign_invalid(
    client: TestClient, db: DbSession
) -> None:
    """Bearer 路径下凭据是 secret 本身，超窗只让 sign_ok 变假，不该拒收。"""
    owner = make_user(db, "owner3")
    device = make_device(db, owner, secret="bearer-stale-secret", name="bearer")
    stale_ms = int((time.time() - STALE_HOURS * 3600) * 1000)

    response = client.post(
        INGEST,
        json=_signed_payload(device.secret, timestamp_ms=stale_ms),
        headers={"Authorization": f"Bearer {device.secret}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["duplicate"] is False

    login(client, "owner3", DEFAULT_PASSWORD)
    listed = client.get("/api/messages").json()["items"]
    assert listed and listed[0]["id"] == response.json()["id"]


# ------------------------------------------------------------------ 3. 流式限长


def test_declared_content_length_over_limit_is_rejected_early(
    client: TestClient, db: DbSession
) -> None:
    owner = make_user(db, "owner4")
    make_device(db, owner, secret="big-body-secret")
    limit = get_settings().max_body_bytes

    response = client.post(
        INGEST,
        content=b"x" * (limit + 1024),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413, response.text
    assert str(limit) in response.json()["detail"]


def test_streamed_body_over_limit_is_rejected(client: TestClient, db: DbSession) -> None:
    """没有可用 Content-Length 时也必须靠流式累积挡下来（生成器没有长度）。"""
    owner = make_user(db, "owner5")
    make_device(db, owner, secret="chunked-body-secret")
    limit = get_settings().max_body_bytes

    def chunks():
        remaining = limit + 4096
        while remaining > 0:
            piece = min(8192, remaining)
            yield b"y" * piece
            remaining -= piece

    response = client.post(
        INGEST,
        content=chunks(),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413, response.text


# ------------------------------------------------------------------ 4. /api 404


@pytest.mark.parametrize("method", ["get", "post"])
def test_unknown_api_path_returns_json_404(client: TestClient, method: str) -> None:
    """未匹配的 /api/* 必须 404 JSON。此前 GET 会掉进 SPA catch-all 返回 200 HTML，
    API 客户端会把它当成成功。"""
    response = getattr(client, method)("/api/definitely-not-a-route")
    assert response.status_code == 404, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert "接口不存在" in response.json()["detail"]


# ------------------------------------------------------------------ 5. 路径穿越


def test_static_file_traversal_is_blocked(tmp_path, monkeypatch, session_factory) -> None:
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<html>SPA-INDEX</html>", encoding="utf-8")
    assets = static_dir / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log(1)", encoding="utf-8")

    secret_file = tmp_path / "secret.txt"
    secret_file.write_text("TOP-SECRET-CONTENT", encoding="utf-8")

    settings = get_settings()
    monkeypatch.setattr(settings, "static_dir", static_dir)

    app = create_app()

    def override_get_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    probe = TestClient(app)

    # 正常静态文件仍然可服务
    assert "console.log(1)" in probe.get("/assets/app.js").text

    for path in (
        "/../secret.txt",
        "/%2e%2e%2fsecret.txt",
        "/%2e%2e/secret.txt",
        "/..%2fsecret.txt",
        "/assets/../../secret.txt",
        "//etc/hostname",
    ):
        response = probe.get(path)
        assert "TOP-SECRET-CONTENT" not in response.text, f"路径穿越成功: {path}"
        # /etc/hostname 若可读也不该泄出内容
        assert response.status_code in (200, 404, 400), f"{path} -> {response.status_code}"
