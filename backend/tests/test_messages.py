"""消息切片：排序 / 检索 / 分页 / 越权 / 删除 / 清理 / facets / 导出（契约 §5）。

本文件只覆盖消息切片。登录路径由 test_auth.py 负责，所以这里用
:func:`sign_in` 直接往 sessions 表写一行再塞 cookie —— 走的仍然是真实的
``current_user`` 链路（cookie -> sessions 表 -> User），只是不经过
``/api/auth/login`` 这一个 HTTP 环节，避免消息切片被 auth 的实现细节拖累。
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from app import deps
from app.models import (
    AuditLog,
    Device,
    DeviceShare,
    Message,
    User,
    utcnow,
)
from app.models import (
    Session as SessionModel,
)
from app.security import hash_session_token, new_session_token, session_expiry
from app.services import search
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import sessionmaker

from .conftest import make_device, make_user, utc

# CSV 首行 = BOM + 这行表头（契约里写死的顺序，改动必须同步改测试）
EXPECTED_CSV_HEADER = ("时间", "设备", "发送者", "类型", "验证码", "正文")


# --------------------------------------------------------------------- 辅助


def sign_in(client: TestClient, db: DbSession, user: User) -> TestClient:
    """直接落库建会话并塞 cookie。"""
    token = new_session_token()
    db.add(
        SessionModel(
            user_id=user.id,
            token_hash=hash_session_token(token),
            expires_at=session_expiry(),
        )
    )
    db.commit()
    client.cookies.set(deps.SESSION_COOKIE, token)
    return client


def make_message(
    db: DbSession,
    device: Device,
    *,
    sender: str = "10086",
    content: str = "验证码 123456",
    raw_content: str | None = None,
    received_at: dt.datetime | None = None,
    ingested_at: dt.datetime | None = None,
    code: str | None = "123456",
    code_candidates: list[dict[str, object]] | None = None,
    code_expires_at: dt.datetime | None = None,
    time_source: str = "device",
    kind: str = "sms",
) -> Message:
    moment = received_at or utc(2026, 9, 12, 10, 0)
    message = Message(
        device_id=device.id,
        kind=kind,
        sender=sender,
        content=content,
        raw_content=raw_content if raw_content is not None else content,
        received_at=moment,
        ingested_at=ingested_at or moment,
        time_source=time_source,
        code=code,
        code_confidence=90 if code else None,
        code_candidates=(
            code_candidates
            if code_candidates is not None
            else ([{"code": code, "confidence": 90}] if code else [])
        ),
        code_expires_at=code_expires_at,
        dup_key=uuid.uuid4().hex,
        raw_payload={"sender": sender},
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def iso(moment: dt.datetime) -> str:
    """查询串里统一用带时区的 ISO 字符串。"""
    return moment.astimezone(dt.UTC).isoformat()


def ids(client: TestClient, **params: object) -> list[int]:
    response = client.get("/api/messages", params=params)
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def fresh_row(session_factory: sessionmaker[DbSession], model: type, pk: int) -> object | None:
    """换一个 session 读，避免测试 session 的身份缓存/快照看到旧值。"""
    with session_factory() as session:
        return session.get(model, pk)


def audits(session_factory: sessionmaker[DbSession], action: str) -> list[AuditLog]:
    with session_factory() as session:
        return list(
            session.execute(
                select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id)
            ).scalars()
        )


# --------------------------------------------------------------------- 排序


def test_default_order_is_newest_first_and_asc_reverses_it(db: DbSession, client_factory) -> None:
    owner = make_user(db, "排序用户")
    device = make_device(db, owner, name="排序机")
    oldest = make_message(db, device, content="最早", code=None, received_at=utc(2026, 9, 12, 8, 0))
    middle = make_message(db, device, content="中间", code=None, received_at=utc(2026, 9, 12, 9, 0))
    newest = make_message(
        db, device, content="最新", code=None, received_at=utc(2026, 9, 12, 10, 0)
    )
    client = sign_in(client_factory(), db, owner)

    # 缺省就是「最新在前」
    assert ids(client) == [newest.id, middle.id, oldest.id]
    # order=asc 生效
    assert ids(client, order="asc") == [oldest.id, middle.id, newest.id]
    # 显式写出来也一样
    assert ids(client, sort="received_at", order="desc") == [newest.id, middle.id, oldest.id]


def test_sorting_by_ingested_at_is_honoured(db: DbSession, client_factory) -> None:
    owner = make_user(db, "入库排序用户")
    device = make_device(db, owner, name="入库机")
    # received_at 与 ingested_at 的顺序刻意相反
    late_ingest = make_message(
        db,
        device,
        content="a",
        code=None,
        received_at=utc(2026, 9, 12, 8, 0),
        ingested_at=utc(2026, 9, 12, 12, 0),
    )
    early_ingest = make_message(
        db,
        device,
        content="b",
        code=None,
        received_at=utc(2026, 9, 12, 9, 0),
        ingested_at=utc(2026, 9, 12, 11, 0),
    )
    client = sign_in(client_factory(), db, owner)

    assert ids(client) == [early_ingest.id, late_ingest.id]
    assert ids(client, sort="ingested_at", order="desc") == [late_ingest.id, early_ingest.id]
    assert ids(client, sort="ingested_at", order="asc") == [early_ingest.id, late_ingest.id]


def test_unknown_sort_or_order_is_a_400(db: DbSession, client_factory) -> None:
    owner = make_user(db, "非法排序用户")
    make_device(db, owner, name="非法排序机")
    client = sign_in(client_factory(), db, owner)

    assert client.get("/api/messages", params={"sort": "code"}).status_code == 400
    assert client.get("/api/messages", params={"order": "sideways"}).status_code == 400


# --------------------------------------------------------------------- 关键词


def test_keyword_hits_content_raw_content_and_sender(db: DbSession, client_factory) -> None:
    owner = make_user(db, "检索用户")
    device = make_device(db, owner, name="检索机")
    in_content = make_message(
        db,
        device,
        sender="10086",
        content="正文里有 苹果",
        raw_content="无关",
        code=None,
        received_at=utc(2026, 9, 12, 10, 0),
    )
    in_raw = make_message(
        db,
        device,
        sender="10086",
        content="无关",
        raw_content="原始内容里有 香蕉",
        code=None,
        received_at=utc(2026, 9, 12, 10, 1),
    )
    in_sender = make_message(
        db,
        device,
        sender="樱桃速递",
        content="无关",
        raw_content="无关",
        code=None,
        received_at=utc(2026, 9, 12, 10, 2),
    )
    untouched = make_message(
        db,
        device,
        sender="10086",
        content="无关",
        raw_content="无关",
        code=None,
        received_at=utc(2026, 9, 12, 10, 3),
    )
    client = sign_in(client_factory(), db, owner)

    assert ids(client, q="苹果") == [in_content.id]  # 命中正文
    assert ids(client, q="香蕉") == [in_raw.id]  # 命中 raw_content
    assert ids(client, q="樱桃") == [in_sender.id]  # 命中 sender
    assert ids(client, q="不存在的词") == []
    assert len(ids(client)) == 4  # 未加关键词时四条都在
    assert untouched.id in ids(client)


def test_like_wildcards_are_escaped(db: DbSession, client_factory) -> None:
    owner = make_user(db, "转义用户")
    device = make_device(db, owner, name="转义机")
    percent = make_message(
        db,
        device,
        content="进度 100% 完成",
        raw_content="无",
        code=None,
        received_at=utc(2026, 9, 12, 10, 0),
    )
    underscore = make_message(
        db,
        device,
        content="user_name",
        raw_content="无",
        code=None,
        received_at=utc(2026, 9, 12, 10, 1),
    )
    make_message(
        db,
        device,
        content="没有通配符",
        raw_content="无",
        code=None,
        received_at=utc(2026, 9, 12, 10, 2),
    )
    client = sign_in(client_factory(), db, owner)

    assert len(ids(client)) == 3
    # '%' 未转义时 LIKE '%%%' 会命中全部三条
    assert ids(client, q="%") == [percent.id]
    # '_' 未转义时 LIKE '%_%' 会命中任何非空正文
    assert ids(client, q="_") == [underscore.id]


# --------------------------------------------------------------------- 筛选


def test_senders_is_exact_and_device_ids_is_intersected(db: DbSession, client_factory) -> None:
    owner = make_user(db, "筛选用户")
    stranger = make_user(db, "外人")
    phone = make_device(db, owner, name="手机")
    tablet = make_device(db, owner, name="平板")
    stranger_device = make_device(db, stranger, name="别人的机器")

    bank_phone = make_message(
        db, phone, sender="银行", content="a", code=None, received_at=utc(2026, 9, 12, 10, 0)
    )
    bank_tablet = make_message(
        db, tablet, sender="银行", content="b", code=None, received_at=utc(2026, 9, 12, 10, 1)
    )
    bank_support = make_message(
        db, phone, sender="银行客服", content="c", code=None, received_at=utc(2026, 9, 12, 10, 2)
    )
    notice = make_message(
        db,
        phone,
        sender="10086",
        content="d",
        code=None,
        kind="notification",
        received_at=utc(2026, 9, 12, 10, 3),
    )
    stranger_msg = make_message(
        db,
        stranger_device,
        sender="银行",
        content="e",
        code=None,
        received_at=utc(2026, 9, 12, 10, 4),
    )
    client = sign_in(client_factory(), db, owner)

    # 精确匹配：前缀相似的「银行客服」不算命中
    assert set(ids(client, senders="银行")) == {bank_phone.id, bank_tablet.id}
    # 两台自有设备
    assert set(ids(client, device_ids=[phone.id, tablet.id])) == {
        bank_phone.id,
        bank_support.id,
        notice.id,
        bank_tablet.id,
    }
    # 交集收敛：不可见的设备 id 被静默丢弃，只剩自己那台
    assert ids(client, device_ids=[phone.id, stranger_device.id]) == [
        notice.id,
        bank_support.id,
        bank_phone.id,
    ]
    # 组合筛选
    assert ids(client, senders="银行", device_ids=[phone.id]) == [bank_phone.id]
    # 没有 device_id 时怎么都看不到别人的
    assert stranger_msg.id not in ids(client)
    assert ids(client, device_ids=[stranger_device.id]) == []
    assert ids(client, senders="银行", device_ids=[stranger_device.id]) == []
    # kind 过滤
    assert ids(client, kind="notification") == [notice.id]


def test_time_range_from_is_inclusive_and_to_is_exclusive(db: DbSession, client_factory) -> None:
    owner = make_user(db, "时间用户")
    device = make_device(db, owner, name="时钟机")
    before = make_message(
        db, device, content="a", code=None, received_at=utc(2026, 9, 12, 9, 59, 59)
    )
    at_from = make_message(
        db, device, content="b", code=None, received_at=utc(2026, 9, 12, 10, 0, 0)
    )
    inside = make_message(
        db, device, content="c", code=None, received_at=utc(2026, 9, 12, 10, 30, 0)
    )
    at_to = make_message(db, device, content="d", code=None, received_at=utc(2026, 9, 12, 11, 0, 0))
    after = make_message(db, device, content="e", code=None, received_at=utc(2026, 9, 12, 11, 0, 1))
    client = sign_in(client_factory(), db, owner)

    start = utc(2026, 9, 12, 10, 0, 0)
    end = utc(2026, 9, 12, 11, 0, 0)

    # from 是闭边界：正好等于 from 的那条被包含
    assert set(ids(client, **{"from": iso(start)})) == {at_from.id, inside.id, at_to.id, after.id}
    # to 是开边界：正好等于 to 的那条被排除
    assert set(ids(client, **{"to": iso(end)})) == {before.id, at_from.id, inside.id}
    # 合起来就是半开区间 [from, to)
    assert set(ids(client, **{"from": iso(start), "to": iso(end)})) == {at_from.id, inside.id}
    # 两个边界都不给就是全部
    assert set(ids(client)) == {before.id, at_from.id, inside.id, at_to.id, after.id}


# --------------------------------------------------------------------- 分页


def test_cursor_pagination_walks_thirty_rows_in_three_pages(db: DbSession, client_factory) -> None:
    owner = make_user(db, "分页用户")
    device = make_device(db, owner, name="分页机")
    created = [
        make_message(
            db,
            device,
            content=f"第{index}条",
            code=None,
            received_at=utc(2026, 9, 12, 10, 0) + dt.timedelta(minutes=index),
        )
        for index in range(30)
    ]
    expected = {message.id for message in created}
    client = sign_in(client_factory(), db, owner)

    seen: list[int] = []
    cursors: list[str | None] = []
    cursor: str | None = None
    for _ in range(3):
        params: dict[str, object] = {"limit": 10}
        if cursor:
            params["cursor"] = cursor
        response = client.get("/api/messages", params=params)
        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["items"]) == 10
        seen.extend(item["id"] for item in body["items"])
        cursor = body["next_cursor"]
        cursors.append(cursor)

    assert cursors[0] and cursors[1]  # 前两页都还有下一页
    assert cursors[2] is None  # 第三页到尽头
    assert len(seen) == len(set(seen)) == 30  # 无重复
    assert set(seen) == expected  # 无遗漏
    # 默认倒序：第 29 条 → 第 0 条
    assert seen == [message.id for message in reversed(created)]

    # limit 也要能限制到 1
    only = client.get("/api/messages", params={"limit": 1}).json()
    assert len(only["items"]) == 1
    assert only["items"][0]["id"] == created[-1].id


def test_cursor_from_one_filter_set_is_accepted_by_another(db: DbSession, client_factory) -> None:
    owner = make_user(db, "游标复用用户")
    device = make_device(db, owner, name="游标机")
    for index in range(5):
        make_message(
            db,
            device,
            sender="10086",
            content=f"第{index}条",
            code=None,
            received_at=utc(2026, 9, 12, 10, 0) + dt.timedelta(minutes=index),
        )
    client = sign_in(client_factory(), db, owner)

    first_page = client.get("/api/messages", params={"limit": 2}).json()
    cursor = first_page["next_cursor"]
    assert cursor

    # 换一组筛选（结果为空）用同一个游标：不报错、返回空
    empty = client.get("/api/messages", params={"cursor": cursor, "senders": "不存在"})
    assert empty.status_code == 200, empty.text
    assert empty.json()["items"] == []

    # 换设备范围 + 关键词同样不报错
    other = client.get(
        "/api/messages", params={"cursor": cursor, "device_ids": [device.id], "q": "第"}
    )
    assert other.status_code == 200, other.text
    assert all(item["id"] != first_page["items"][0]["id"] for item in other.json()["items"])


def test_invalid_cursor_is_rejected_with_400(db: DbSession, client_factory) -> None:
    owner = make_user(db, "非法游标用户")
    make_device(db, owner, name="非法游标机")
    client = sign_in(client_factory(), db, owner)

    for bad in ("not-a-cursor", "!!!", "****", "YWJj"):
        response = client.get("/api/messages", params={"cursor": bad})
        assert response.status_code == 400, f"游标 {bad!r} 应当 400，实际 {response.status_code}"
        assert response.json()["detail"]


def test_limit_out_of_range_is_rejected(db: DbSession, client_factory) -> None:
    owner = make_user(db, "超限用户")
    make_device(db, owner, name="超限机")
    client = sign_in(client_factory(), db, owner)

    assert client.get("/api/messages", params={"limit": 0}).status_code == 422
    assert client.get("/api/messages", params={"limit": 5000}).status_code == 422


# --------------------------------------------------------------------- has_code


def test_has_code_true_returns_only_coded_messages(db: DbSession, client_factory) -> None:
    owner = make_user(db, "验证码用户")
    device = make_device(db, owner, name="验证码机")
    with_code = make_message(
        db, device, content="验证码 548213", code="548213", received_at=utc(2026, 9, 12, 10, 0)
    )
    without = make_message(
        db, device, content="普通通知", code=None, received_at=utc(2026, 9, 12, 10, 1)
    )
    client = sign_in(client_factory(), db, owner)

    assert ids(client, has_code="true") == [with_code.id]
    assert ids(client, has_code="false") == [without.id]
    # 不带该参数时是「不过滤」，两条都在
    assert set(ids(client)) == {with_code.id, without.id}
    # 与关键词叠加
    assert ids(client, q="验证码", has_code="true") == [with_code.id]
    assert ids(client, q="验证码", has_code="false") == []


# --------------------------------------------------------------------- 序列化


def test_message_payload_fills_device_code_and_flag_fields(db: DbSession, client_factory) -> None:
    owner = make_user(db, "序列化用户")
    device = make_device(db, owner, name="序列化机")
    fresh = make_message(
        db,
        device,
        sender="10086",
        content="验证码 998877",
        code="998877",
        code_candidates=[{"code": "998877", "confidence": 97}, {"code": "9988", "confidence": 40}],
        code_expires_at=utcnow() + dt.timedelta(minutes=5),
        time_source="sent_at",
        received_at=utc(2026, 9, 12, 10, 0),
    )
    stale = make_message(
        db,
        device,
        sender="10086",
        content="验证码 112233",
        code="112233",
        code_expires_at=utcnow() - dt.timedelta(minutes=5),
        time_source="device",
        received_at=utc(2026, 9, 12, 10, 1),
    )
    client = sign_in(client_factory(), db, owner)

    items = {item["id"]: item for item in client.get("/api/messages").json()["items"]}

    assert items[fresh.id]["device_name"] == "序列化机"
    assert items[fresh.id]["device_color"] == device.color
    assert items[fresh.id]["time_doubtful"] is True  # sent_at 属于可疑来源
    assert items[fresh.id]["code_expired"] is False
    assert items[fresh.id]["can_delete"] is True
    assert items[fresh.id]["code_candidates"] == [
        {"code": "998877", "confidence": 97},
        {"code": "9988", "confidence": 40},
    ]
    assert items[stale.id]["time_doubtful"] is False  # device 来源可信
    assert items[stale.id]["code_expired"] is True
    assert items[stale.id]["code"] == "112233"


# --------------------------------------------------------------------- 越权


def test_other_users_device_is_invisible_and_yields_empty_not_403(
    db: DbSession, client_factory
) -> None:
    alice = make_user(db, "甲")
    bob = make_user(db, "乙")
    alice_device = make_device(db, alice, name="甲的设备")
    alice_message = make_message(db, alice_device, sender="10086", content="甲的短信", code=None)

    bob_client = sign_in(client_factory(), db, bob)

    # 乙看不到甲的消息
    assert ids(bob_client) == []
    # 指名索要甲的设备：空结果而不是 403，也不泄露是否存在
    response = bob_client.get("/api/messages", params={"device_ids": alice_device.id})
    assert response.status_code == 200
    assert response.json()["items"] == []
    # 单条详情 / 删除同样不可达
    assert bob_client.get(f"/api/messages/{alice_message.id}").status_code == 404
    assert bob_client.delete(f"/api/messages/{alice_message.id}").status_code == 404
    # facets 也不能泄露
    facets = bob_client.get("/api/messages/facets").json()
    assert facets == {"senders": [], "devices": [], "total": 0}
    # 导出同理
    assert bob_client.get("/api/messages/export", params={"format": "json"}).json() == []

    # 甲自己看得到
    alice_client = sign_in(client_factory(), db, alice)
    assert ids(alice_client) == [alice_message.id]
    assert alice_client.get(f"/api/messages/{alice_message.id}").status_code == 200


# --------------------------------------------------------------------- 删除


def test_sharee_can_delete_a_message_on_a_shared_device(
    db: DbSession, client_factory, session_factory
) -> None:
    alice = make_user(db, "共享甲")
    bob = make_user(db, "共享乙")
    device = make_device(db, alice, name="共享机")
    message = make_message(db, device, content="共享设备上的短信", code=None)
    db.add(DeviceShare(device_id=device.id, user_id=bob.id, granted_by=alice.id))
    db.commit()

    bob_client = sign_in(client_factory(), db, bob)

    # 被共享就能看到，且 can_delete 为真（设备可见即可删）
    assert ids(bob_client) == [message.id]
    detail = bob_client.get(f"/api/messages/{message.id}")
    assert detail.status_code == 200
    assert detail.json()["can_delete"] is True

    # 删除成功
    deleted = bob_client.delete(f"/api/messages/{message.id}")
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True}

    # 归属者也看不到了，库里真的没了
    alice_client = sign_in(client_factory(), db, alice)
    assert ids(alice_client) == []
    assert alice_client.get(f"/api/messages/{message.id}").status_code == 404
    assert fresh_row(session_factory, Message, message.id) is None


# --------------------------------------------------------------------- 清理


def test_purge_only_touches_owned_devices_and_writes_audit(
    db: DbSession, client_factory, session_factory
) -> None:
    alice = make_user(db, "清理甲")
    bob = make_user(db, "清理乙")
    alice_device = make_device(db, alice, name="甲机")
    bob_device = make_device(db, bob, name="乙机")

    old = utcnow() - dt.timedelta(days=30)
    alice_message = make_message(db, alice_device, content="甲的旧短信", code=None, received_at=old)
    bob_old = make_message(db, bob_device, content="乙的旧短信", code=None, received_at=old)
    bob_fresh = make_message(
        db,
        bob_device,
        content="乙的新短信",
        code=None,
        received_at=utcnow() - dt.timedelta(hours=1),
    )

    bob_client = sign_in(client_factory(), db, bob)

    # 乙指名要清理甲的设备：与 owned 的交集为空 → 一条都不删
    response = bob_client.post(
        "/api/messages/purge", json={"before_days": 7, "device_ids": [alice_device.id]}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"deleted": 0}
    assert fresh_row(session_factory, Message, alice_message.id) is not None

    # 不带 device_ids：只清自己名下超过 7 天的
    response = bob_client.post("/api/messages/purge", json={"before_days": 7})
    assert response.status_code == 200, response.text
    assert response.json() == {"deleted": 1}
    assert fresh_row(session_factory, Message, bob_old.id) is None  # 旧的删了
    assert fresh_row(session_factory, Message, bob_fresh.id) is not None  # 新的没动
    assert fresh_row(session_factory, Message, alice_message.id) is not None  # 别人的没动

    # 审计：message.purge，detail 记 before_days / device_count / deleted
    entries = audits(session_factory, "message.purge")
    assert entries, "清理必须留下审计"
    last = entries[-1]
    assert last.actor_user_id == bob.id
    assert last.detail["before_days"] == 7
    assert last.detail["deleted"] == 1
    assert last.detail["device_count"] == 1


def test_purge_requires_a_positive_before_days(db: DbSession, client_factory) -> None:
    owner = make_user(db, "清理参数用户")
    make_device(db, owner, name="清理参数机")
    client = sign_in(client_factory(), db, owner)

    assert client.post("/api/messages/purge", json={"before_days": 0}).status_code == 422
    assert client.post("/api/messages/purge", json={}).status_code == 422


# --------------------------------------------------------------------- facets


def test_facets_count_senders_devices_and_total(db: DbSession, client_factory) -> None:
    owner = make_user(db, "facets 用户")
    phone = make_device(db, owner, name="手机")
    tablet = make_device(db, owner, name="平板")
    make_message(db, phone, sender="银行", code=None, received_at=utc(2026, 9, 12, 10, 0))
    make_message(db, tablet, sender="银行", code=None, received_at=utc(2026, 9, 12, 10, 1))
    make_message(db, phone, sender="快递", code=None, received_at=utc(2026, 9, 12, 10, 2))
    client = sign_in(client_factory(), db, owner)

    body = client.get("/api/messages/facets").json()
    assert body["total"] == 3
    # sender 计数：银行 2 / 快递 1，按 count desc
    assert body["senders"][0] == {"value": "银行", "label": "银行", "count": 2}
    assert {item["value"]: item["count"] for item in body["senders"]} == {"银行": 2, "快递": 1}
    # label 与 value 相同
    assert all(item["label"] == item["value"] for item in body["senders"])
    # device 计数：value 是字符串 id，label 是设备名
    assert {item["value"]: item["count"] for item in body["devices"]} == {
        str(phone.id): 2,
        str(tablet.id): 1,
    }
    assert {item["value"]: item["label"] for item in body["devices"]}[str(phone.id)] == "手机"

    # 与筛选联动：三项都跟着筛选走
    filtered = client.get("/api/messages/facets", params={"senders": "银行"}).json()
    assert filtered["total"] == 2
    assert filtered["senders"] == [{"value": "银行", "label": "银行", "count": 2}]
    assert {item["value"]: item["count"] for item in filtered["devices"]}[str(phone.id)] == 1

    # 设备筛选：只看平板
    only_tablet = client.get("/api/messages/facets", params={"device_ids": [tablet.id]}).json()
    assert only_tablet["total"] == 1
    assert [item["value"] for item in only_tablet["devices"]] == [str(tablet.id)]


def test_facets_sender_top_is_ordered_by_count(db: DbSession, client_factory) -> None:
    owner = make_user(db, "facets 排序用户")
    device = make_device(db, owner, name="排序机")
    for index in range(3):
        make_message(db, device, sender="高频", code=None, received_at=utc(2026, 9, 12, 10, index))
    for index in range(2):
        make_message(db, device, sender="中频", code=None, received_at=utc(2026, 9, 12, 11, index))
    make_message(db, device, sender="低频", code=None, received_at=utc(2026, 9, 12, 12, 0))
    client = sign_in(client_factory(), db, owner)

    senders = client.get("/api/messages/facets").json()["senders"]
    assert [item["value"] for item in senders] == ["高频", "中频", "低频"]
    assert [item["count"] for item in senders] == [3, 2, 1]


# --------------------------------------------------------------------- 导出


def test_csv_export_starts_with_bom_and_header_and_has_three_rows(
    db: DbSession, client_factory
) -> None:
    owner = make_user(db, "导出用户")
    device = make_device(db, owner, name="导出机")
    make_message(
        db,
        device,
        sender="10086",
        content="第一条内容",
        code="111111",
        received_at=utc(2026, 9, 12, 10, 0),
    )
    make_message(
        db,
        device,
        sender="10010",
        content="第二条内容",
        code="222222",
        received_at=utc(2026, 9, 12, 10, 1),
    )
    make_message(
        db,
        device,
        sender="10086",
        content="第三条内容",
        code=None,
        received_at=utc(2026, 9, 12, 10, 2),
    )
    client = sign_in(client_factory(), db, owner)

    response = client.get("/api/messages/export", params={"format": "csv"})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    disposition = response.headers["content-disposition"]
    assert "attachment" in disposition
    assert "messages-" in disposition and disposition.endswith('.csv"')
    assert dt.datetime.now(dt.UTC).strftime("%Y-%m-%d") in disposition

    text = response.text
    assert text.startswith("\ufeff"), "CSV 必须带 UTF-8 BOM，否则 Excel 会乱码"
    lines = text.splitlines()
    # 首行 = BOM + 表头
    assert lines[0] == "\ufeff" + ",".join(EXPECTED_CSV_HEADER)
    # 表头 + 3 条数据
    assert len(lines) == 4
    for content in ("第一条内容", "第二条内容", "第三条内容"):
        assert content in text
    assert "导出机" in text and "10010" in text


def test_json_export_returns_a_plain_list_of_messages(db: DbSession, client_factory) -> None:
    owner = make_user(db, "JSON 导出用户")
    device = make_device(db, owner, name="JSON 机")
    created = [
        make_message(
            db,
            device,
            sender="10086",
            content=f"第{index}条",
            code=None,
            received_at=utc(2026, 9, 12, 10, index),
        )
        for index in range(3)
    ]
    client = sign_in(client_factory(), db, owner)

    response = client.get("/api/messages/export", params={"format": "json"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert isinstance(payload, list)
    assert len(payload) == 3
    assert {item["id"] for item in payload} == {message.id for message in created}
    assert all(item["device_name"] == "JSON 机" for item in payload)
    assert "messages-" in response.headers["content-disposition"]

    # 路径别名同样可用
    alias = client.get("/api/messages/export.csv")
    assert alias.status_code == 200
    assert alias.headers["content-type"].startswith("text/csv")
    assert alias.text.startswith("\ufeff")
    alias_json = client.get("/api/messages/export.json")
    assert alias_json.status_code == 200
    assert isinstance(alias_json.json(), list)

    assert client.get("/api/messages/export", params={"format": "xml"}).status_code == 400


# --------------------------------------------------------------------- 纯查询层
#
# 下面几条直接盯 services/search.py 的契约本身：路由层测不到「空设备集合必须
# 恒假」这类边界，而它一旦退化成「不加条件」，就是一次全表泄露。


def test_escape_like_escapes_backslash_percent_and_underscore() -> None:
    assert search.escape_like("100%") == "100\\%"
    assert search.escape_like("a_b") == "a\\_b"
    assert search.escape_like("c\\d") == "c\\\\d"
    assert search.escape_like("普通正文") == "普通正文"


def test_cursor_roundtrip_and_rejects_garbage() -> None:
    moment = utc(2026, 9, 12, 10, 30)
    raw = search.encode_cursor(moment, 42)
    assert raw.isascii()
    assert search.decode_cursor(raw) == (moment, 42)

    for bad in ("", "not-a-cursor", "!!!", "****", "YWJj", "MjAyNi0wMS0wMXw="):
        with pytest.raises(ValueError):
            search.decode_cursor(bad)


def test_empty_device_ids_never_degrades_into_a_full_table_read(db: DbSession) -> None:
    """空设备集合必须恒假。这是越权查询的最后一道闸门。"""
    owner = make_user(db, "恒假用户")
    device = make_device(db, owner, name="恒假机")
    make_message(db, device, content="这条必须查不到", code=None)

    stmt = search.build_message_query(
        db,
        device_ids=[],
        q=None,
        senders=None,
        time_from=None,
        time_to=None,
        sort="received_at",
        order="desc",
        has_code=None,
        kind=None,
    )
    rows, next_cursor = search.paginate(
        db, stmt, sort="received_at", order="desc", cursor=None, limit=50
    )
    assert rows == []
    assert next_cursor is None

    # 有筛选条件时同样是恒假，而不是绕过条件
    stmt = search.build_message_query(
        db,
        device_ids=[],
        q="查不到",
        senders=["10086"],
        time_from=None,
        time_to=None,
        sort="received_at",
        order="desc",
        has_code=None,
        kind=None,
    )
    rows, _ = search.paginate(db, stmt, sort="received_at", order="desc", cursor=None, limit=50)
    assert rows == []
