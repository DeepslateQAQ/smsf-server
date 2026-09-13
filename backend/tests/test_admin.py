"""管理员接口契约测试（契约 §7）。"""

from __future__ import annotations

import asyncio

import httpx
from app.models import Device, Message
from sqlalchemy import func, select
from sqlalchemy.orm import Session as OrmSession


async def _setup_admin(url: str) -> httpx.AsyncClient:
    c = httpx.AsyncClient(base_url=url)
    r = await c.post(
        "/api/auth/setup",
        json={"username": "admin", "password": "correct horse battery", "display_name": "管理员"},
    )
    assert r.status_code == 201, r.text
    return c


async def _login(url: str, username: str, password: str) -> httpx.AsyncClient:
    c = httpx.AsyncClient(base_url=url)
    r = await c.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


async def _admin_id(ac: httpx.AsyncClient) -> int:
    r = await ac.get("/api/auth/me")
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ------------------------------------------------------------------ 鉴权基线


def test_admin_users_unauthenticated(server_url):
    async def go():
        async with httpx.AsyncClient(base_url=server_url) as c:
            r = await c.get("/api/admin/users")
            assert r.status_code == 401, r.text

    asyncio.run(go())


def test_admin_users_normal_user_403(server_url):
    async def go():
        ac = await _setup_admin(server_url)
        r = await ac.post("/api/admin/users", json={"username": "normal", "display_name": "普通人"})
        assert r.status_code == 201, r.text
        initial = r.json()["initial_password"]
        assert initial
        uc = await _login(server_url, "normal", initial)
        r = await uc.get("/api/admin/users")
        assert r.status_code == 403, r.text

    asyncio.run(go())


# ------------------------------------------------------------------ 用户 CRUD


def test_create_user_returns_one_time_password(server_url):
    async def go():
        ac = await _setup_admin(server_url)
        r = await ac.post("/api/admin/users", json={"username": "newbie", "display_name": "新人"})
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["initial_password"], "应返回一次性初始密码"
        assert data["user"]["username"] == "newbie"
        uc = await _login(server_url, "newbie", data["initial_password"])
        assert uc.cookies.get("smsf_session")

    asyncio.run(go())


def test_last_admin_cannot_be_deactivated(server_url):
    async def go():
        ac = await _setup_admin(server_url)
        admin_id = await _admin_id(ac)
        r = await ac.patch(f"/api/admin/users/{admin_id}", json={"is_active": False})
        assert r.status_code == 400, r.text

    asyncio.run(go())


def test_last_admin_cannot_be_demoted(server_url):
    async def go():
        ac = await _setup_admin(server_url)
        admin_id = await _admin_id(ac)
        r = await ac.patch(f"/api/admin/users/{admin_id}", json={"role": "user"})
        assert r.status_code == 400, r.text

    asyncio.run(go())


def test_last_admin_cannot_be_deleted(server_url):
    async def go():
        ac = await _setup_admin(server_url)
        admin_id = await _admin_id(ac)
        r = await ac.delete(f"/api/admin/users/{admin_id}")
        assert r.status_code == 400, r.text

    asyncio.run(go())


def test_admin_cannot_delete_self(server_url):
    async def go():
        ac = await _setup_admin(server_url)
        admin_id = await _admin_id(ac)
        r = await ac.delete(f"/api/admin/users/{admin_id}")
        assert r.status_code == 400, r.text

    asyncio.run(go())


# ------------------------------------------------------------------ 隐私铁律


def test_devices_response_has_no_other_user_message_content_or_secret(server_url):
    async def go():
        admin = await _setup_admin(server_url)
        r = await admin.post(
            "/api/admin/users", json={"username": "alice", "display_name": "Alice"}
        )
        assert r.status_code == 201, r.text
        initial = r.json()["initial_password"]
        alice = await _login(server_url, "alice", initial)
        r = await alice.post("/api/devices", json={"name": "alice-phone"})
        assert r.status_code == 201, r.text
        secret = r.json()["secret"]
        unique = "PRIVATE_ALICE_CONTENT_8842_XYZ"
        r = await alice.post(
            "/api/v1/ingest",
            json={"sender": "10086", "content": unique},
            headers={"Authorization": f"Bearer {secret}"},
        )
        assert r.status_code == 200, r.text
        r = await admin.get("/api/admin/devices")
        assert r.status_code == 200, r.text
        body = r.text
        assert unique not in body, "响应中泄露了他人短信正文"
        assert secret not in body, "响应中泄露了设备 secret 明文"

    asyncio.run(go())


def test_admin_deactivates_own_device_then_ingest_rejected(server_url):
    async def go():
        admin = await _setup_admin(server_url)
        r = await admin.post("/api/devices", json={"name": "admin-phone"})
        assert r.status_code == 201, r.text
        secret = r.json()["secret"]
        device_id = r.json()["id"]
        r = await admin.patch(f"/api/devices/{device_id}", json={"is_active": False})
        assert r.status_code == 200, r.text
        r = await admin.post(
            "/api/v1/ingest",
            json={"sender": "10086", "content": "验证码 1111"},
            headers={"Authorization": f"Bearer {secret}"},
        )
        assert r.status_code == 403, r.text

    asyncio.run(go())


def test_admin_deletes_device_then_messages_gone(server_url, server_db):
    async def go():
        admin = await _setup_admin(server_url)
        r = await admin.post("/api/devices", json={"name": "admin-phone"})
        assert r.status_code == 201, r.text
        secret = r.json()["secret"]
        device_id = r.json()["id"]
        r = await admin.post(
            "/api/v1/ingest",
            json={"sender": "10086", "content": "验证码 123456"},
            headers={"Authorization": f"Bearer {secret}"},
        )
        assert r.status_code == 200, r.text
        r = await admin.delete(f"/api/devices/{device_id}")
        assert r.status_code == 200, r.text
        # 断言真实服务器那个库，而不是 SMSF_DATABASE_URL 指向的生产库
        with OrmSession(server_db) as sess:
            assert sess.get(Device, device_id) is None
            remaining = (
                sess.execute(
                    select(func.count(Message.id)).where(Message.device_id == device_id)
                ).scalar()
                or 0
            )
            assert remaining == 0, f"消息未随设备删除: {remaining}"

    asyncio.run(go())


# ------------------------------------------------------------------ 注册开关


def test_public_registration_toggle(server_url):
    async def go():
        ac = await _setup_admin(server_url)
        async with httpx.AsyncClient(base_url=server_url) as anon:
            r = await anon.post(
                "/api/auth/register", json={"username": "anon", "password": "x" * 8}
            )
            assert r.status_code == 403, r.text
        r = await ac.patch("/api/admin/settings", json={"allow_public_registration": True})
        assert r.status_code == 200, r.text
        async with httpx.AsyncClient(base_url=server_url) as uc:
            r = await uc.post(
                "/api/auth/register", json={"username": "public_user", "password": "x" * 8}
            )
            assert r.status_code == 201, r.text
            assert r.json()["role"] == "user"

    asyncio.run(go())


# ------------------------------------------------------------------ 统计


def test_stats_message_count(server_url):
    async def go():
        admin = await _setup_admin(server_url)
        for i in range(3):
            r = await admin.post(
                "/api/admin/users", json={"username": f"u{i}", "display_name": f"U{i}"}
            )
            assert r.status_code == 201, r.text
            initial = r.json()["initial_password"]
            uc = await _login(server_url, f"u{i}", initial)
            r = await uc.post("/api/devices", json={"name": f"d{i}"})
            assert r.status_code == 201, r.text
            secret = r.json()["secret"]
            r = await uc.post(
                "/api/v1/ingest",
                json={"sender": "10086", "content": f"验证码 {100000 + i}"},
                headers={"Authorization": f"Bearer {secret}"},
            )
            assert r.status_code == 200, r.text
        r = await admin.get("/api/admin/stats")
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["messages"] == 3
        assert s["messages_24h"] == 3
        assert s["codes_24h"] == 3
        assert isinstance(s["db_bytes"], int) and s["db_bytes"] >= 0
        assert s["last_ingest_at"] is not None

    asyncio.run(go())


# ------------------------------------------------------------------ 锁定


def test_lockouts_appear_after_5_failures_and_clear(server_url):
    async def go():
        admin = await _setup_admin(server_url)
        r = await admin.post("/api/admin/users", json={"username": "victim", "display_name": "V"})
        assert r.status_code == 201, r.text
        for _ in range(5):
            async with httpx.AsyncClient(base_url=server_url) as uc:
                r = await uc.post(
                    "/api/auth/login", json={"username": "victim", "password": "wrong"}
                )
                assert r.status_code == 401, r.text
        r = await admin.get("/api/admin/lockouts")
        assert r.status_code == 200, r.text
        lockouts = r.json()
        assert any(lo["username"] == "victim" and lo["locked"] for lo in lockouts), lockouts
        r = await admin.post("/api/admin/lockouts/victim/clear")
        assert r.status_code == 200, r.text
        r = await admin.get("/api/admin/lockouts")
        lockouts = r.json()
        assert not any(lo["username"] == "victim" for lo in lockouts)

    asyncio.run(go())


# ------------------------------------------------------------------ 审计


def test_audit_cursor_pagination_and_action_filter(server_url):
    async def go():
        admin = await _setup_admin(server_url)
        for i in range(3):
            await admin.post(
                "/api/admin/users", json={"username": f"u{i}", "display_name": f"U{i}"}
            )
        r = await admin.get("/api/admin/audit?limit=2")
        assert r.status_code == 200, r.text
        page = r.json()
        assert len(page["items"]) <= 2
        assert page["next_cursor"] is not None
        r2 = await admin.get(f"/api/admin/audit?limit=2&cursor={page['next_cursor']}")
        assert r2.status_code == 200, r2.text
        assert len(r2.json()["items"]) <= 2
        r3 = await admin.get("/api/admin/audit?action=admin.user_create")
        assert r3.status_code == 200, r3.text
        for item in r3.json()["items"]:
            assert item["action"] == "admin.user_create"

    asyncio.run(go())


# ------------------------------------------------------------------ 管理员设备元数据


async def _alice_with_device(
    server_url: str, admin: httpx.AsyncClient
) -> tuple[httpx.AsyncClient, int, str]:
    r = await admin.post("/api/admin/users", json={"username": "alice", "display_name": "Alice"})
    assert r.status_code == 201, r.text
    alice = await _login(server_url, "alice", r.json()["initial_password"])
    r = await alice.post("/api/devices", json={"name": "alice-phone"})
    assert r.status_code == 201, r.text
    return alice, r.json()["id"], r.json()["secret"]


def test_admin_device_patch_controls_ingest(server_url):
    async def go():
        admin = await _setup_admin(server_url)
        alice, device_id, secret = await _alice_with_device(server_url, admin)

        r = await admin.patch(f"/api/admin/devices/{device_id}", json={"is_active": False})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_active"] is False
        assert body["secret"] is None and "secret_fingerprint" in body

        r = await alice.post(
            "/api/v1/ingest",
            json={"sender": "10086", "content": "验证码 2233"},
            headers={"Authorization": f"Bearer {secret}"},
        )
        assert r.status_code == 403, r.text

        r = await admin.patch(f"/api/admin/devices/{device_id}", json={"is_active": True})
        assert r.status_code == 200 and r.json()["is_active"] is True, r.text
        r = await alice.post(
            "/api/v1/ingest",
            json={"sender": "10086", "content": "验证码 2233"},
            headers={"Authorization": f"Bearer {secret}"},
        )
        assert r.status_code == 200, r.text

        r = await admin.get("/api/admin/audit?action=admin.device_update")
        assert r.status_code == 200, r.text
        assert r.json()["items"], "设备停用/恢复应写审计"

    asyncio.run(go())


def test_admin_device_delete_removes_messages(server_url, server_db):
    async def go():
        admin = await _setup_admin(server_url)
        alice, device_id, secret = await _alice_with_device(server_url, admin)
        r = await alice.post(
            "/api/v1/ingest",
            json={"sender": "10086", "content": "验证码 445566"},
            headers={"Authorization": f"Bearer {secret}"},
        )
        assert r.status_code == 200, r.text

        r = await admin.delete(f"/api/admin/devices/{device_id}")
        assert r.status_code == 200 and r.json()["ok"] is True, r.text

        r = await admin.get("/api/admin/devices")
        assert r.status_code == 200, r.text
        assert all(item["id"] != device_id for item in r.json())
        with OrmSession(server_db) as sess:
            assert sess.get(Device, device_id) is None
            remaining = (
                sess.execute(
                    select(func.count(Message.id)).where(Message.device_id == device_id)
                ).scalar()
                or 0
            )
            assert remaining == 0, f"消息未随设备删除: {remaining}"

        r = await admin.patch(f"/api/admin/devices/{device_id}", json={"is_active": False})
        assert r.status_code == 404, r.text

        r = await admin.get("/api/admin/audit?action=admin.device_delete")
        assert r.status_code == 200, r.text
        assert r.json()["items"], "删除设备应写审计"

    asyncio.run(go())


# ------------------------------------------------------------------ 重置密码


def test_admin_reset_password_returns_one_time_password_and_revokes_sessions(server_url):
    """重置密码：返回一次性初始密码、旧密码失效、且该用户已有会话被吐掉。"""

    async def go():
        admin = await _setup_admin(server_url)
        r = await admin.post("/api/admin/users", json={"username": "bob", "display_name": "小鲍"})
        assert r.status_code == 201, r.text
        bob_id = r.json()["user"]["id"]
        first_password = r.json()["initial_password"]

        # bob 先登录用旧密码，拿到一个有效会话
        bob = await _login(server_url, "bob", first_password)
        assert (await bob.get("/api/auth/me")).status_code == 200

        r = await admin.post(f"/api/admin/users/{bob_id}/reset-password")
        assert r.status_code == 200, r.text
        body = r.json()
        new_password = body["initial_password"]
        assert new_password and new_password != first_password
        assert body["user"]["id"] == bob_id

        # 旧密码不再可用
        r = await httpx.AsyncClient(base_url=server_url).post(
            "/api/auth/login", json={"username": "bob", "password": first_password}
        )
        assert r.status_code == 401, r.text

        # 重置前的会话必须失效
        assert (await bob.get("/api/auth/me")).status_code == 401

        # 新密码可登录
        new_bob = await _login(server_url, "bob", new_password)
        assert (await new_bob.get("/api/auth/me")).status_code == 200

        # 审计存在且不含密码明文
        r = await admin.get("/api/admin/audit?action=admin.user_reset_password")
        assert r.status_code == 200, r.text
        assert r.json()["items"], "重置密码应写审计"
        assert new_password not in r.text

        await bob.aclose()
        await new_bob.aclose()

    asyncio.run(go())


def test_admin_reset_password_unknown_user_404(server_url):
    async def go():
        admin = await _setup_admin(server_url)
        r = await admin.post("/api/admin/users/9999/reset-password")
        assert r.status_code == 404, r.text

    asyncio.run(go())
