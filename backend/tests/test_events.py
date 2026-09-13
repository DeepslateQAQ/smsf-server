"""事件流契约测试（契约 §6）：GET /api/events。"""

from __future__ import annotations

import asyncio
import threading
import time

import httpx
from app.services.events import EventHub


def test_events_unauthenticated(server_url):
    async def go():
        async with httpx.AsyncClient(base_url=server_url) as c:
            r = await c.get("/api/events")
            assert r.status_code == 401, r.text

    asyncio.run(go())


def test_hub_publish_reaches_subscriber():
    async def go():
        hub = EventHub()
        subscriber = hub.subscribe(1)
        hub.publish({1}, {"type": "messages", "device_id": 9})
        return await asyncio.wait_for(subscriber.queue.get(), timeout=2)

    event = asyncio.run(go())
    assert event["type"] == "messages"
    assert event["device_id"] == 9


def test_events_stream_delivers_ingest_event(server_url):
    """已登录订阅者：另一个客户端 ingest 一条后，事件流收到 event: messages。

    全程只走 HTTP。任何直连 ORM 的写法都会落到 ``SMSF_DATABASE_URL`` 指向的库上
    （默认是 backend/data/smsf.sqlite3，即「源码直跑」的生产库），
    那会把测试用户与设备写进用户真实数据里 —— 见 conftest 的 ``server_db`` 说明。
    """
    state: dict[str, str] = {}

    async def setup() -> None:
        async with httpx.AsyncClient(base_url=server_url) as admin:
            r = await admin.post(
                "/api/auth/setup",
                json={
                    "username": "admin",
                    "password": "correct horse battery",
                    "display_name": "管理员",
                },
            )
            assert r.status_code == 201, r.text
            created = await admin.post("/api/devices", json={"name": "events-device"})
            assert created.status_code == 201, created.text
            secret = created.json()["secret"]
            assert secret, created.text
            state["secret"] = secret

    asyncio.run(setup())

    lines: list[str] = []
    finished = threading.Event()

    def reader() -> None:
        async def go() -> None:
            async with httpx.AsyncClient(base_url=server_url, timeout=30) as client:
                # 用一个已登录（admin 会话）客户端订阅
                login = await client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "correct horse battery"},
                )
                assert login.status_code == 200, login.text
                async with client.stream("GET", "/api/events") as resp:
                    assert resp.status_code == 200, resp.text
                    async for line in resp.aiter_lines():
                        lines.append(line)
                        if "event: messages" in line:
                            break

        asyncio.run(go())
        finished.set()

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()

    deadline = time.time() + 5
    while not any("connected" in line for line in lines) and time.time() < deadline:
        time.sleep(0.05)
    assert any("connected" in line for line in lines), f"未收到 connected: {lines}"

    async def push() -> None:
        async with httpx.AsyncClient(base_url=server_url) as client:
            r = await client.post(
                "/api/v1/ingest",
                json={"sender": "10086", "content": "验证码 998877"},
                headers={"Authorization": f"Bearer {state['secret']}"},
            )
            assert r.status_code == 200, r.text

    asyncio.run(push())

    assert finished.wait(timeout=10), f"事件流超时未结束，已读行: {lines}"
    assert any("event: messages" in line for line in lines), f"未收到事件: {lines}"
    thread.join(timeout=5)
