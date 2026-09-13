"""End-to-end coverage for ingest, search, sharing, and admin isolation."""

from __future__ import annotations

import datetime as dt

from app.security import compute_signature
from fastapi.testclient import TestClient

from .conftest import DEFAULT_PASSWORD, login


def _create_device(admin: TestClient, name: str = "主力机") -> dict:
    response = admin.post(
        "/api/devices",
        json={"name": name, "description": "测试设备", "color": "#0B57D0", "sim_label": "卡1"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _push(
    secret: str,
    *,
    device_mark: str,
    sender: str,
    content: str,
    received_at: str,
    secret_in_url_encoded_sign: bool = True,
) -> dict:
    # sign_skew_ok 时间窗（默认 24h）要求签名时间戳新鲜，不能用固定历史值。
    timestamp = int(dt.datetime.now(dt.UTC).timestamp() * 1000)
    return {
        "sender": sender,
        "content": content,
        "raw_content": content,
        "received_at": received_at,
        "sent_at": str(timestamp),
        "sign": compute_signature(secret, timestamp, url_encode=secret_in_url_encoded_sign),
        "device_mark": device_mark,
        "kind": "sms",
    }


def test_full_pipeline(client_factory) -> None:
    client = client_factory()
    # 1. 首次 setup 成为管理员
    setup = client.post(
        "/api/auth/setup",
        json={"username": "boss", "password": DEFAULT_PASSWORD, "display_name": "岩"},
    )
    assert setup.status_code == 201, setup.text
    assert setup.json()["role"] == "admin"

    # 2. 建号并建设备，拿到一次性 secret
    created = client.post(
        "/api/admin/users",
        json={"username": "friend", "display_name": "朋友", "role": "user"},
    )
    assert created.status_code == 201, created.text
    friend_password = created.json()["initial_password"]
    assert friend_password

    device = _create_device(client)
    secret = device["secret"]
    device_mark = device["device_mark"]
    assert secret and device_mark.startswith("smsf-")

    # 3. 用真实签名格式推送
    pushed = client.post(
        "/api/v1/ingest",
        json=_push(
            secret,
            device_mark=device_mark,
            sender="106980095588",
            content="【招商银行】您的验证码是 548213，5分钟内有效，请勿泄露。",
            received_at="2026-09-12T10:30:00+08:00",
        ),
    )
    assert pushed.status_code == 200, pushed.text
    body = pushed.json()
    assert body["duplicate"] is False
    assert body["code"] == "548213"
    assert body["time_source"] == "device"
    message_id = body["id"]

    # 4. 幂等：重放同一请求不产生新行
    again = client.post(
        "/api/v1/ingest",
        json=_push(
            secret,
            device_mark=device_mark,
            sender="106980095588",
            content="【招商银行】您的验证码是 548213，5分钟内有效，请勿泄露。",
            received_at="2026-09-12T10:30:00+08:00",
        ),
    )
    assert again.status_code == 200 and again.json()["duplicate"] is True

    listed = client.get("/api/messages").json()
    assert listed["next_cursor"] is None
    assert len(listed["items"]) == 1
    message = listed["items"][0]
    assert message["id"] == message_id
    assert message["code"] == "548213"
    assert message["device_name"] == "主力机"
    assert message["time_doubtful"] is False
    # 带 +08:00 的时间必须落成 UTC
    assert message["received_at"].startswith("2026-09-12T02:30:00")
    assert message["code_expires_at"] is not None
    assert message["can_delete"] is True

    # 5. 检索：正文关键词、发件人、has_code
    assert len(client.get("/api/messages", params={"q": "验证码"}).json()["items"]) == 1
    assert len(client.get("/api/messages", params={"q": "548213"}).json()["items"]) == 1
    assert len(client.get("/api/messages", params={"senders": "106980095588"}).json()["items"]) == 1
    assert len(client.get("/api/messages", params={"senders": "不存在"}).json()["items"]) == 0
    assert (
        len(client.get("/api/messages", params={"q": "验证码", "has_code": True}).json()["items"])
        == 1
    )
    assert (
        len(client.get("/api/messages", params={"q": "验证码", "has_code": False}).json()["items"])
        == 0
    )
    facets = client.get("/api/messages/facets").json()
    assert facets["total"] == 1
    assert facets["senders"][0] == {"value": "106980095588", "label": "106980095588", "count": 1}

    # 6. 共享给朋友：朋友只读可见
    share = client.post(f"/api/devices/{device['id']}/shares", json={"username": "friend"})
    assert share.status_code in (200, 201), share.text

    friend = client_factory()
    login(friend, "friend", friend_password)
    friend_devices = friend.get("/api/devices").json()
    assert [d["id"] for d in friend_devices] == [device["id"]]
    assert friend_devices[0]["is_owner"] is False
    assert friend_devices[0]["shares"] == []
    assert friend.get("/api/messages").json()["items"][0]["id"] == message_id

    # 朋友不能改设备 / 轮换 secret / 管理共享
    assert friend.patch(f"/api/devices/{device['id']}", json={"name": "改"}).status_code == 404
    assert friend.post(f"/api/devices/{device['id']}/secret").status_code == 404
    assert friend.get(f"/api/devices/{device['id']}/shares").status_code == 404

    # 朋友的一键清理不能删掉别人设备的短信
    purge = friend.post("/api/messages/purge", json={"before_days": 1})
    assert purge.status_code == 200
    assert purge.json()["deleted"] == 0
    assert len(client.get("/api/messages").json()["items"]) == 1

    # 7. 管理员看不到正文（这是本项目的隐私铁律）
    admin_devices = client.get("/api/admin/devices")
    assert admin_devices.status_code == 200
    assert "548213" not in admin_devices.text
    assert "请勿泄露" not in admin_devices.text
    assert secret not in admin_devices.text
    stats = client.get("/api/admin/stats").json()
    assert stats["messages"] == 1
    assert stats["codes_24h"] >= 0

    audit = client.get("/api/admin/audit").json()
    assert audit["items"], "推送与共享都应留下审计记录"
    assert "548213" not in str(audit)


def test_ingest_requires_credentials(client: TestClient) -> None:
    client.post(
        "/api/auth/setup",
        json={"username": "boss2", "password": DEFAULT_PASSWORD, "display_name": "岩"},
    )
    assert client.post("/api/v1/ingest", json={"sender": "x", "content": "y"}).status_code == 401


def test_form_fallback_is_idempotent(client: TestClient) -> None:
    """降级表单模式（App 默认模板，无 receive_time）也必须幂等。"""
    client.post(
        "/api/auth/setup",
        json={"username": "boss3", "password": DEFAULT_PASSWORD, "display_name": "岩"},
    )
    device = _create_device(client, name="备用机")
    secret = device["secret"]
    timestamp = int(dt.datetime.now(dt.UTC).timestamp() * 1000)

    payload = {
        "from": "10086",
        "content": "验证码 1234",
        "timestamp": str(timestamp),
        "sign": compute_signature(secret, timestamp, url_encode=True),
    }
    first = client.post("/api/v1/ingest", data=payload)
    assert first.status_code == 200, first.text
    second = client.post("/api/v1/ingest", data=payload)
    assert second.status_code == 200, second.text
    assert second.json()["duplicate"] is True
    assert first.json()["id"] == second.json()["id"]

    # 没有 receive_time 时以 sent_at 为准，且不该标成入库时间
    item = client.get("/api/messages").json()["items"][0]
    assert item["time_source"] == "sent_at"
    assert item["received_at"].startswith(
        dt.datetime.fromtimestamp(timestamp / 1000, dt.UTC).strftime("%Y-%m-%dT%H:%M:%S")
    )
    assert item["time_doubtful"] is True
    assert item["code"] == "1234"
