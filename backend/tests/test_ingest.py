"""入库端点测试（契约 §3）。

覆盖范围
--------
- 两种模板（JSON / 表单）与字段别名映射、幂等重放；
- 默认模板 ``{from, content, timestamp, sign}``（无 receive_time、无 device_mark）
  的签名遍历降级路径：同一 timestamp 重发只入库 1 行；
- 两种凭据（Bearer / device_mark+sign）与各种 401 拒绝；
- 请求体 / 正文上限、每设备限速、停用设备 403；
- 设备时区时间落库、验证码提取与过期时间、SSE 事件游标与可见人集合。

这些断言是入库路径的安全与幂等基线，任何一条失败都不应放行。
"""

from __future__ import annotations

import base64
import datetime as dt
import sys
from urllib.parse import urlencode

import pytest
from app.api import ingest as ingest_api
from app.models import AuditLog, Device, DeviceShare, Message, User
from app.security import (
    compute_signature,
    hash_password,
    ingest_failure_limiter,
    ingest_limiter,
    new_device_secret,
    secret_fingerprint,
)
from app.services import settings as settings_service
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

INGEST_PATH = "/api/v1/ingest"
# 服务端已启用签名时间窗校验（sign_skew_ok）：固定历史时间戳会被当作重放拒绝，
# 因此测试统一使用「导入时刻」的新鲜毫秒时间戳（窗口 24h，测试运行远低于此）。
SIGN_TIMESTAMP = int(dt.datetime.now(dt.UTC).timestamp() * 1000)
RATE_LIMIT_KEY = "rate_limit_per_device_per_min"


# --------------------------------------------------------------------- 测试基座


@pytest.fixture(autouse=True)
def _clear_ingest_limiter():
    """限速器是进程内单例，测试之间必须隔离，否则 device:1 会跨用例累计。"""
    ingest_limiter._hits.clear()
    ingest_failure_limiter._hits.clear()
    yield
    ingest_limiter._hits.clear()
    ingest_failure_limiter._hits.clear()


def _make_user(db: DbSession, username: str = "owner") -> User:
    user = User(
        username=username,
        display_name=username,
        password_hash=hash_password("correct horse battery"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_device(
    db: DbSession,
    owner: User,
    *,
    secret: str | None = None,
    device_mark: str | None = None,
    is_active: bool = True,
) -> Device:
    secret = secret or new_device_secret()
    device = Device(
        owner_id=owner.id,
        name=f"设备-{owner.username}",
        secret=secret,
        secret_fingerprint=secret_fingerprint(secret),
        device_mark=device_mark or f"smsf-{owner.id}-{secret_fingerprint(secret)}",
        is_active=is_active,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def _sign(secret: str, timestamp: int = SIGN_TIMESTAMP) -> str:
    """SmsForwarder App 端签名：先 base64，再 URL encode。"""
    return compute_signature(secret, timestamp, url_encode=True)


def _message_count(db: DbSession) -> int:
    return int(db.scalar(select(func.count(Message.id))) or 0)


def _only_message(db: DbSession) -> Message:
    db.expire_all()
    rows = db.execute(select(Message)).scalars().all()
    assert len(rows) == 1
    return rows[0]


def _fallback_cursor(received_at: dt.datetime, message_id: int) -> str:
    """契约 §3 的兜底游标：base64url(f"{epoch_ms}:{id}")。"""
    payload = f"{int(received_at.timestamp() * 1000)}:{message_id}".encode("ascii")
    return base64.urlsafe_b64encode(payload).decode("ascii")


def _expected_cursor(received_at: dt.datetime, message_id: int) -> str:
    """search.encode_cursor 已存在时复用它，否则用契约兜底表达式。"""
    try:
        from app.services.search import encode_cursor
    except ImportError:
        return _fallback_cursor(received_at, message_id)
    return encode_cursor(received_at, message_id)


# --------------------------------------------------------------------- 幂等 / 签名


def test_valid_hmac_signature_is_idempotent(db: DbSession, client: TestClient) -> None:
    """正确 HMAC → 200 duplicate=false；同请求重发 → duplicate=true 且库里仍 1 行。"""
    owner = _make_user(db)
    device = _make_device(db, owner, secret="hmac-secret")

    payload = {
        "device_mark": device.device_mark,
        "from": "106980095588",
        "content": "【中国银行】您的验证码为123456，5分钟内有效。",
        "timestamp": str(SIGN_TIMESTAMP),
        "sign": _sign("hmac-secret"),
        "receive_time": "2026-09-12T10:30:00+08:00",
    }
    first = client.post(INGEST_PATH, data=payload)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["ok"] is True
    assert body["duplicate"] is False
    assert body["id"] > 0

    second = client.post(INGEST_PATH, data=payload)
    assert second.status_code == 200, second.text
    assert second.json()["duplicate"] is True
    assert second.json()["id"] == body["id"]

    assert _message_count(db) == 1
    stored = _only_message(db)
    assert stored.device_id == device.id
    assert stored.sender == "106980095588"
    assert db.get(Device, device.id).last_auth_kind == "sign"

    # 成功入库也要留审计，但审计里绝不允许出现正文。
    audits = db.execute(select(AuditLog).where(AuditLog.action == "ingest")).scalars().all()
    assert audits, "成功入库应写审计"
    assert audits[0].actor_kind == "device"
    assert all("验证码" not in str(audit.detail) for audit in audits)


def test_default_form_template_is_idempotent(db: DbSession, client: TestClient) -> None:
    """Legacy form templates stay idempotent using timestamp as fallback time."""
    owner = _make_user(db, "legacy")
    device = _make_device(db, owner, secret="legacy-secret")

    payload = {
        "from": "10086",
        "content": "验证码 1234",
        "timestamp": str(SIGN_TIMESTAMP),
        "sign": _sign("legacy-secret"),
    }
    first = client.post(INGEST_PATH, data=payload)
    assert first.status_code == 200, first.text
    assert first.json()["duplicate"] is False

    second = client.post(INGEST_PATH, data=payload)
    assert second.status_code == 200, second.text
    assert second.json()["duplicate"] is True
    assert second.json()["id"] == first.json()["id"]
    assert _message_count(db) == 1, "同一 timestamp 重发不得新增行"

    stored = _only_message(db)
    expected_received = dt.datetime.fromtimestamp(SIGN_TIMESTAMP / 1000, tz=dt.UTC)
    assert stored.received_at == expected_received
    assert stored.time_source == "sent_at"
    assert stored.code == "1234"
    assert db.get(Device, device.id).last_auth_kind == "sign"



def test_active_test_session_echoes_without_persisting(db: DbSession, client: TestClient) -> None:
    """接入测试期间回显推送，但消息与设备活动时间都不得写入数据库。"""
    owner = _make_user(db, "test-session-owner")
    device = _make_device(db, owner, secret="test-session-secret")
    login = client.post(
        "/api/auth/login",
        json={"username": owner.username, "password": "correct horse battery"},
    )
    assert login.status_code == 200, login.text

    started = client.post(f"/api/devices/{device.id}/test-session")
    assert started.status_code == 200, started.text
    session_id = started.json()["session_id"]

    timestamp = SIGN_TIMESTAMP + 1
    payload = {
        "device_mark": device.device_mark,
        "from": "10086",
        "content": "验证码 246810",
        "timestamp": str(timestamp),
        "sign": _sign(device.secret, timestamp),
        "receive_time": "2026-09-12T10:30:00+08:00",
    }
    pushed = client.post(INGEST_PATH, data=payload)
    assert pushed.status_code == 200, pushed.text
    assert pushed.json()["id"] == 0
    assert pushed.json()["code"] == "246810"
    assert _message_count(db) == 0

    db.expire_all()
    stored_device = db.get(Device, device.id)
    assert stored_device is not None
    assert stored_device.last_ingest_at is None
    assert stored_device.last_auth_kind == ""

    status_response = client.get(f"/api/devices/{device.id}/test-session/{session_id}")
    assert status_response.status_code == 200, status_response.text
    assert status_response.json()["active"] is True
    assert status_response.json()["push"]["sender"] == "10086"

    closed = client.delete(f"/api/devices/{device.id}/test-session/{session_id}")
    assert closed.status_code == 200, closed.text

    normal = client.post(INGEST_PATH, data=payload)
    assert normal.status_code == 200, normal.text
    assert normal.json()["id"] > 0
    assert _message_count(db) == 1

def test_wrong_signature_returns_401(db: DbSession, client: TestClient) -> None:
    owner = _make_user(db)
    device = _make_device(db, owner, secret="right-secret")

    response = client.post(
        INGEST_PATH,
        data={
            "from": "10086",
            "content": "验证码 123456",
            "timestamp": str(SIGN_TIMESTAMP),
            "sign": _sign("wrong-secret"),
            "device_mark": device.device_mark,
        },
    )
    assert response.status_code == 401, response.text

    db.expire_all()
    audit = db.execute(select(AuditLog).where(AuditLog.action == "ingest.rejected")).scalar_one()
    assert audit.actor_kind == "device"
    assert audit.success is False


def test_missing_credentials_returns_401(db: DbSession, client: TestClient) -> None:
    response = client.post(INGEST_PATH, json={"sender": "10086", "content": "hi"})
    assert response.status_code == 401, response.text

    db.expire_all()
    audit = db.execute(select(AuditLog).where(AuditLog.action == "ingest.rejected")).scalar_one()
    assert audit.actor_kind == "device"
    assert audit.success is False
    assert _message_count(db) == 0


def test_unknown_device_mark_returns_401(db: DbSession, client: TestClient) -> None:
    owner = _make_user(db)
    _make_device(db, owner, secret="existing-secret")

    response = client.post(
        INGEST_PATH,
        data={
            "from": "10086",
            "content": "验证码 123456",
            "timestamp": str(SIGN_TIMESTAMP),
            # 用真实设备的 secret 造合法签名，但 device_mark 不存在：必须 401，
            # 不能被“签名遍历”意外救活。
            "sign": _sign("existing-secret"),
            "device_mark": "does-not-exist",
        },
    )
    assert response.status_code == 401, response.text
    assert _message_count(db) == 0


# --------------------------------------------------------------------- Bearer


def test_bearer_auth_accepted_with_sign_ok_false(db: DbSession, client: TestClient) -> None:
    owner = _make_user(db)
    device = _make_device(db, owner, secret="bearer-secret")

    response = client.post(
        INGEST_PATH,
        headers={"Authorization": f"Bearer {device.secret}"},
        json={"sender": "10086", "content": "验证码 654321，5分钟内有效"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["duplicate"] is False

    stored = _only_message(db)
    assert stored.sign_ok is False, "Bearer 单独使用不应被当成签名校验通过"
    assert db.get(Device, device.id).last_auth_kind == "bearer"


def test_bearer_with_wrong_sign_is_still_accepted(db: DbSession, client: TestClient) -> None:
    """Bearer 即凭据：同时带错误 sign 也不能拒绝，只把 sign_ok 记为 False。"""
    owner = _make_user(db)
    device = _make_device(db, owner, secret="bearer-secret")

    response = client.post(
        INGEST_PATH,
        headers={"Authorization": f"Bearer {device.secret}"},
        json={
            "sender": "10086",
            "content": "Bearer 优先",
            "sent_at": str(SIGN_TIMESTAMP),
            "sign": "definitely-not-a-valid-signature",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["duplicate"] is False

    stored = _only_message(db)
    assert stored.content == "Bearer 优先"
    assert stored.sign_ok is False


# --------------------------------------------------------------------- 大小 / 限速 / 停用


def test_oversize_content_returns_413(db: DbSession, client: TestClient) -> None:
    owner = _make_user(db)
    device = _make_device(db, owner, secret="long-secret")

    response = client.post(
        INGEST_PATH,
        headers={"Authorization": f"Bearer {device.secret}"},
        json={"sender": "10086", "content": "a" * 9000},
    )
    assert response.status_code == 413, response.text
    assert _message_count(db) == 0


def test_oversize_body_returns_413(client: TestClient) -> None:
    response = client.post(
        INGEST_PATH,
        content=b"a" * (32 * 1024 + 1),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 413, response.text


def test_rate_limit_per_device_returns_429(db: DbSession, client: TestClient) -> None:
    owner = _make_user(db)
    device = _make_device(db, owner, secret="rate-secret")
    settings_service.update(db, {RATE_LIMIT_KEY: 2})

    headers = {"Authorization": f"Bearer {device.secret}"}
    responses = [
        client.post(
            INGEST_PATH,
            headers=headers,
            json={"sender": "10086", "content": f"第 {index} 条"},
        )
        for index in range(3)
    ]

    assert [item.status_code for item in responses] == [200, 200, 429]
    assert responses[2].headers["Retry-After"] == "60"
    assert _message_count(db) == 2, "被限速的请求不应落库"

    audit = db.execute(
        select(AuditLog).where(AuditLog.action == "ingest.rate_limited")
    ).scalar_one()
    assert audit.actor_kind == "device"
    assert audit.success is False


def test_inactive_device_returns_403(db: DbSession, client: TestClient) -> None:
    """停用必须 403：401 会让手机端以为凭据错误而无限重试。"""
    owner = _make_user(db)
    device = _make_device(db, owner, secret="off-secret", is_active=False)

    # Bearer 路径
    bearer = client.post(
        INGEST_PATH,
        headers={"Authorization": f"Bearer {device.secret}"},
        json={"sender": "10086", "content": "off"},
    )
    assert bearer.status_code == 403, bearer.text
    assert bearer.status_code != 401

    # device_mark + sign 路径同样 403
    signed = client.post(
        INGEST_PATH,
        data={
            "from": "10086",
            "content": "off",
            "timestamp": str(SIGN_TIMESTAMP),
            "sign": _sign("off-secret"),
            "device_mark": device.device_mark,
        },
    )
    assert signed.status_code == 403, signed.text
    assert _message_count(db) == 0


# --------------------------------------------------------------------- 时间 / 验证码 / 事件


def test_received_at_with_timezone_is_stored_as_utc(db: DbSession, client: TestClient) -> None:
    owner = _make_user(db)
    device = _make_device(db, owner, secret="tz-secret")

    response = client.post(
        INGEST_PATH,
        headers={"Authorization": f"Bearer {device.secret}"},
        json={
            "sender": "10086",
            "content": "带时区的时间",
            "receive_time": "2026-09-12T10:30:00+08:00",
        },
    )
    assert response.status_code == 200, response.text

    stored = _only_message(db)
    assert stored.received_at == dt.datetime(2026, 9, 12, 2, 30, tzinfo=dt.UTC)
    assert stored.time_source == "device"


def test_code_extraction_and_expiry_end_to_end(db: DbSession, client: TestClient) -> None:
    owner = _make_user(db)
    device = _make_device(db, owner, secret="code-secret")

    response = client.post(
        INGEST_PATH,
        data={
            "device_mark": device.device_mark,
            "from": "95566",
            "content": "验证码 123456，5分钟内有效",
            "timestamp": str(SIGN_TIMESTAMP),
            "sign": _sign("code-secret"),
            "receive_time": "2026-09-12T10:30:00+08:00",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["code"] == "123456"

    stored = _only_message(db)
    assert stored.code == "123456"
    assert stored.received_at == dt.datetime(2026, 9, 12, 2, 30, tzinfo=dt.UTC)
    assert stored.code_expires_at == stored.received_at + dt.timedelta(seconds=300)


def test_success_publishes_event_with_cursor(
    db: DbSession, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """SSE 唤醒信号必须带上 owner + 共享者，以及消息列表可消费的游标。"""
    owner = _make_user(db, "owner")
    sharer = _make_user(db, "sharer")
    device = _make_device(db, owner, secret="event-secret")
    db.add(DeviceShare(device_id=device.id, user_id=sharer.id, granted_by=owner.id))
    db.commit()

    calls: list[tuple[set[int], dict]] = []

    def fake_publish(user_ids, event):
        calls.append((set(user_ids), dict(event)))

    monkeypatch.setattr(ingest_api.hub, "publish", fake_publish)

    response = client.post(
        INGEST_PATH,
        headers={"Authorization": f"Bearer {device.secret}"},
        json={
            "sender": "10086",
            "content": "事件",
            "receive_time": "2026-09-12T10:30:00+08:00",
        },
    )
    assert response.status_code == 200, response.text
    assert len(calls) == 1

    user_ids, event = calls[0]
    assert user_ids == {owner.id, sharer.id}
    assert event["type"] == "messages"
    assert event["device_id"] == device.id
    assert event["cursor"] == _expected_cursor(
        dt.datetime(2026, 9, 12, 2, 30, tzinfo=dt.UTC), response.json()["id"]
    )


def test_event_cursor_falls_back_when_search_module_absent(
    db: DbSession, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """search.py 未落地时必须用契约兜底：base64url(f"{epoch_ms}:{id}")。"""
    monkeypatch.setitem(sys.modules, "app.services.search", None)

    owner = _make_user(db)
    device = _make_device(db, owner, secret="fallback-secret")
    calls: list[dict] = []
    monkeypatch.setattr(ingest_api.hub, "publish", lambda _users, event: calls.append(dict(event)))

    response = client.post(
        INGEST_PATH,
        headers={"Authorization": f"Bearer {device.secret}"},
        json={
            "sender": "10086",
            "content": "兜底游标",
            "receive_time": "2026-09-12T10:30:00+08:00",
        },
    )
    assert response.status_code == 200, response.text
    assert calls and calls[0]["cursor"] == _fallback_cursor(
        dt.datetime(2026, 9, 12, 2, 30, tzinfo=dt.UTC), response.json()["id"]
    )


# --------------------------------------------------------------------- 解析失败


def test_form_body_without_content_type_is_parsed(db: DbSession, client: TestClient) -> None:
    """无 Content-Type 但 body 形如 a=b&c=d 时按表单解析（契约 §3）。"""
    owner = _make_user(db)
    device = _make_device(db, owner, secret="raw-form-secret")
    body = urlencode(
        {
            "from": "10086",
            "content": "无请求头表单",
            "timestamp": str(SIGN_TIMESTAMP),
            "sign": _sign("raw-form-secret"),
            "device_mark": device.device_mark,
        }
    ).encode()

    response = client.post(INGEST_PATH, content=body, headers={"Content-Type": ""})
    assert response.status_code == 200, response.text
    assert response.json()["duplicate"] is False
    assert _only_message(db).content == "无请求头表单"


def test_malformed_json_returns_400(client: TestClient) -> None:
    response = client.post(
        INGEST_PATH,
        content=b"{not-json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400, response.text


# --------------------------------------------------------------------- 失败刷量防护


def test_credential_failure_flood_stops_growing_audit(client: TestClient, db: DbSession) -> None:
    """反复凭据失败最终被来源 IP 预算拦下，且超限后不再写审计行。

    审计写入是公开端点上的写放大：一次失败写一行，不封顶就能被刷爆。
    """
    budget = ingest_api.FAILED_CREDENTIAL_LIMIT_PER_IP
    for _ in range(budget):
        assert client.post(INGEST_PATH, json={"sender": "x", "content": "y"}).status_code == 401

    rejected = client.post(INGEST_PATH, json={"sender": "x", "content": "y"})
    assert rejected.status_code == 429
    assert rejected.headers["Retry-After"] == str(ingest_api.RATE_LIMIT_WINDOW_SECONDS)

    def rejected_audits() -> int:
        return int(
            db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "ingest.rejected"))
            or 0
        )

    assert rejected_audits() == budget, "超过预算后不应再写审计行"

    for _ in range(5):
        assert client.post(INGEST_PATH, json={"sender": "x", "content": "y"}).status_code == 429
    assert rejected_audits() == budget
