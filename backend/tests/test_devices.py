"""设备管理路由（契约 §4）测试。

覆盖点：
- 创建响应一次性返回明文 secret，且 ``secret_fingerprint`` 与派生的指纹一致；
- 列表 / 详情不返回 secret；
- 非归属者 PATCH / DELETE / 轮换 / 管理共享 / 自检一律 404；
- ``device_limit_per_user`` 生效（0 表示不限制）；
- 共享后对方可见、``is_owner=false``、``shares=[]``，重复共享幂等；
- 被共享者只读：能读设备与消息，但不能删除；
- 删除显式级联消息，并写审计（detail 只含设备名与消息数）；
- 轮换 secret 写审计 ``device.rotate_secret``；解除共享写审计。

测试直接造会话 cookie 登录，避免把设备切片绑死在 auth 路由上；这样
``GET``/``PATCH`` 的鉴权路径仍走真实的 :mod:`app.deps`。
"""

from __future__ import annotations

import datetime as dt
import secrets

import pytest
from app.deps import SESSION_COOKIE, get_readable_device
from app.models import AuditLog, Device, DeviceShare, Message, User
from app.models import Session as SessionModel
from app.security import (
    hash_password,
    hash_session_token,
    new_device_secret,
    new_session_token,
    secret_fingerprint,
    session_expiry,
)
from app.services import settings as settings_service
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

# --------------------------------------------------------------------- 构造辅助


def _user(db: DbSession, username: str) -> User:
    user = User(
        username=username,
        display_name=username,
        password_hash=hash_password("correct horse battery"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _device(db: DbSession, owner: User, *, name: str = "设备") -> Device:
    secret = new_device_secret()
    device = Device(
        owner_id=owner.id,
        name=name,
        secret=secret,
        secret_fingerprint=secret_fingerprint(secret),
        device_mark="smsf-" + secrets.token_urlsafe(9),
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def _message(db: DbSession, device: Device, *, content: str = "验证码 120000") -> Message:
    message = Message(
        device_id=device.id,
        sender="10086",
        content=content,
        raw_content=content,
        received_at=dt.datetime.now(dt.UTC),
        dup_key=f"dup-{device.id}-{content}",
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def _api(client_factory, db: DbSession, user: User):
    """建一个带着该用户会话 cookie 的 TestClient。"""
    client = client_factory()
    token = new_session_token()
    db.add(
        SessionModel(
            user_id=user.id,
            token_hash=hash_session_token(token),
            expires_at=session_expiry(),
        )
    )
    db.commit()
    client.cookies.set(SESSION_COOKIE, token)
    return client


def _count(db: DbSession, model, *conditions) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(*conditions)) or 0)


# --------------------------------------------------------------------- 创建 / 列表


def test_create_returns_one_time_secret(client_factory, db: DbSession) -> None:
    owner = _user(db, "alice")
    api = _api(client_factory, db, owner)

    response = api.post(
        "/api/devices",
        json={"name": "主力机", "description": "测试", "color": "#0B57D0", "sim_label": "卡1"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["secret"]
    assert body["secret_fingerprint"] == secret_fingerprint(body["secret"])
    assert body["device_mark"].startswith("smsf-")
    assert body["is_owner"] is True
    assert body["owner_name"] == "alice"
    assert body["message_count"] == 0
    assert body["shares"] == []

    # 创建之后再读，secret 不再出现
    listed = api.get("/api/devices")
    assert listed.status_code == 200
    assert listed.json()[0]["secret"] is None
    assert listed.json()[0]["secret_fingerprint"] == body["secret_fingerprint"]

    detail = api.get(f"/api/devices/{body['id']}")
    assert detail.status_code == 200
    assert detail.json()["secret"] is None


def test_device_limit_per_user(client_factory, db: DbSession) -> None:
    owner = _user(db, "alice")
    api = _api(client_factory, db, owner)

    settings_service.update(db, {"device_limit_per_user": 1})
    assert api.post("/api/devices", json={"name": "一号机"}).status_code == 201
    second = api.post("/api/devices", json={"name": "二号机"})
    assert second.status_code == 400

    # 0 = 不限制
    settings_service.update(db, {"device_limit_per_user": 0})
    assert api.post("/api/devices", json={"name": "三号机"}).status_code == 201


# --------------------------------------------------------------------- 权限边界


def test_non_owner_gets_404_on_every_write(client_factory, db: DbSession) -> None:
    owner = _user(db, "owner")
    stranger = _user(db, "stranger")
    device = _device(db, owner)
    api = _api(client_factory, db, stranger)

    # 未共享 → 连读都不可见
    assert api.get(f"/api/devices/{device.id}").status_code == 404
    assert api.patch(f"/api/devices/{device.id}", json={"name": "改名"}).status_code == 404
    assert api.delete(f"/api/devices/{device.id}").status_code == 404
    assert api.post(f"/api/devices/{device.id}/secret").status_code == 404
    assert api.get(f"/api/devices/{device.id}/shares").status_code == 404
    assert (
        api.post(f"/api/devices/{device.id}/shares", json={"username": "owner"}).status_code == 404
    )
    assert api.delete(f"/api/devices/{device.id}/shares/{owner.id}").status_code == 404


# --------------------------------------------------------------------- 共享


def test_share_visibility_and_idempotency(client_factory, db: DbSession) -> None:
    owner = _user(db, "alice")
    friend = _user(db, "bob")
    device = _device(db, owner, name="共享机")
    owner_api = _api(client_factory, db, owner)
    friend_api = _api(client_factory, db, friend)

    assert friend_api.get("/api/devices").json() == []

    granted = owner_api.post(f"/api/devices/{device.id}/shares", json={"username": "bob"})
    assert granted.status_code == 201, granted.text
    assert granted.json()["username"] == "bob"

    # 幂等：重复共享不新增记录，返回 200
    again = owner_api.post(f"/api/devices/{device.id}/shares", json={"username": "bob"})
    assert again.status_code == 200, again.text
    assert _count(db, DeviceShare, DeviceShare.device_id == device.id) == 1

    # 错误分支
    assert (
        owner_api.post(f"/api/devices/{device.id}/shares", json={"username": "alice"}).status_code
        == 400
    )
    assert (
        owner_api.post(f"/api/devices/{device.id}/shares", json={"username": "ghost"}).status_code
        == 404
    )

    # 归属者能看到共享名单
    owner_list = owner_api.get("/api/devices").json()
    assert [s["username"] for s in owner_list[0]["shares"]] == ["bob"]
    assert owner_api.get(f"/api/devices/{device.id}/shares").json()[0]["username"] == "bob"

    # 被共享者能看到设备，但 is_owner=false 且 shares 为空
    friend_list = friend_api.get("/api/devices").json()
    assert [d["id"] for d in friend_list] == [device.id]
    assert friend_list[0]["is_owner"] is False
    assert friend_list[0]["owner_name"] == "alice"
    assert friend_list[0]["shares"] == []
    assert friend_api.get(f"/api/devices/{device.id}").json()["shares"] == []


def test_list_orders_owned_before_shared(client_factory, db: DbSession) -> None:
    alice = _user(db, "alice")
    bob = _user(db, "bob")
    shared_device = _device(db, alice, name="alice 的设备")
    own_device = _device(db, bob, name="bob 的设备")

    assert (
        _api(client_factory, db, alice)
        .post(f"/api/devices/{shared_device.id}/shares", json={"username": "bob"})
        .status_code
        == 201
    )

    ids = [item["id"] for item in _api(client_factory, db, bob).get("/api/devices").json()]
    assert ids == [own_device.id, shared_device.id]


def test_revoke_share_writes_audit(client_factory, db: DbSession) -> None:
    owner = _user(db, "alice")
    friend = _user(db, "bob")
    device = _device(db, owner)
    owner_api = _api(client_factory, db, owner)
    friend_api = _api(client_factory, db, friend)

    assert (
        owner_api.post(f"/api/devices/{device.id}/shares", json={"username": "bob"}).status_code
        == 201
    )
    assert friend_api.get(f"/api/devices/{device.id}").status_code == 200

    removed = owner_api.delete(f"/api/devices/{device.id}/shares/{friend.id}")
    assert removed.status_code == 200
    assert removed.json()["ok"] is True
    assert friend_api.get(f"/api/devices/{device.id}").status_code == 404

    audits = (
        db.execute(select(AuditLog).where(AuditLog.action == "device.share_remove")).scalars().all()
    )
    assert len(audits) == 1
    assert audits[0].detail["user_id"] == friend.id


# --------------------------------------------------------------------- 只读共享与删除


def test_shared_user_reads_messages_but_cannot_delete(client_factory, db: DbSession) -> None:
    owner = _user(db, "alice")
    friend = _user(db, "bob")
    stranger = _user(db, "eve")
    device = _device(db, owner, name="备用机")
    message = _message(db, device)

    owner_api = _api(client_factory, db, owner)
    assert (
        owner_api.post(f"/api/devices/{device.id}/shares", json={"username": "bob"}).status_code
        == 201
    )
    friend_api = _api(client_factory, db, friend)

    # B 能读设备与消息（走 deps 鉴权；消息已落库）
    assert friend_api.get(f"/api/devices/{device.id}").status_code == 200
    assert get_readable_device(db, friend, device.id).id == device.id
    assert db.get(Message, message.id) is not None
    assert owner_api.get("/api/devices").json()[0]["message_count"] == 1

    # 无关第三方不可读（越权断言）
    with pytest.raises(HTTPException) as excinfo:
        get_readable_device(db, stranger, device.id)
    assert excinfo.value.status_code == 404

    # B 不能删除设备，也不能管理共享
    assert friend_api.delete(f"/api/devices/{device.id}").status_code == 404
    assert (
        friend_api.post(f"/api/devices/{device.id}/shares", json={"username": "eve"}).status_code
        == 404
    )
    assert _count(db, Device, Device.id == device.id) == 1

    # 归属者删除：显式级联删消息，审计只记设备名与消息数
    deleted = owner_api.delete(f"/api/devices/{device.id}")
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True
    assert _count(db, Device, Device.id == device.id) == 0
    assert _count(db, Message, Message.device_id == device.id) == 0
    assert _count(db, DeviceShare, DeviceShare.device_id == device.id) == 0

    audits = db.execute(select(AuditLog).where(AuditLog.action == "device.delete")).scalars().all()
    assert len(audits) == 1
    assert audits[0].detail == {"name": "备用机", "message_count": 1}


# --------------------------------------------------------------------- 轮换 secret


def test_rotate_secret_returns_new_secret_and_audits(client_factory, db: DbSession) -> None:
    owner = _user(db, "alice")
    api = _api(client_factory, db, owner)
    created = api.post("/api/devices", json={"name": "主力机"}).json()

    rotated = api.post(f"/api/devices/{created['id']}/secret")
    assert rotated.status_code == 200, rotated.text
    body = rotated.json()
    assert body["secret"] and body["secret"] != created["secret"]
    assert body["secret_fingerprint"] == secret_fingerprint(body["secret"])
    assert body["secret_fingerprint"] != created["secret_fingerprint"]

    # 轮换后详情不泄露 secret
    assert api.get(f"/api/devices/{created['id']}").json()["secret"] is None

    audits = (
        db.execute(select(AuditLog).where(AuditLog.action == "device.rotate_secret"))
        .scalars()
        .all()
    )
    assert len(audits) == 1
    assert all(audit.target_id == str(created["id"]) for audit in audits)
