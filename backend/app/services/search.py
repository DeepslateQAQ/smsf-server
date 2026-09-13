"""消息检索的纯查询逻辑：游标分页、LIKE 转义、筛选条件与聚合。

本模块只读：不提交事务、不抛 HTTPException。参数非法一律抛 ValueError，
由路由层翻译成 400（app/main.py 也注册了 ValueError -> 400 的兜底处理器）。

时间语义（与路由层一致）：
- ``from`` 是**闭**边界（received_at >= from）
- ``to`` 是**开**边界（received_at < to），整体是半开区间 [from, to)
"""

from __future__ import annotations

import base64
import datetime as dt
from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import Select, and_, false, func, or_, select
from sqlalchemy.orm import Session as DbSession

from ..models import Device, Message
from ..schemas import CodeCandidateOut, FacetItem, FacetsOut, MessageOut
from .ingest import is_time_doubtful

# --------------------------------------------------------------------- 常量

SORT_RECEIVED_AT = "received_at"
SORT_INGESTED_AT = "ingested_at"
SORT_KEYS: tuple[str, ...] = (SORT_RECEIVED_AT, SORT_INGESTED_AT)

ORDER_DESC = "desc"
ORDER_ASC = "asc"
ORDERS: tuple[str, ...] = (ORDER_DESC, ORDER_ASC)

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
FACET_LIMIT = 200

# 查询固定写作 LIKE :kw ESCAPE '\'
LIKE_ESCAPE = "\\"

_CURSOR_SEPARATOR = "|"


def _as_utc(value: dt.datetime) -> dt.datetime:
    """统一成 aware UTC，避免 naive/aware 混用。"""
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value.astimezone(dt.UTC)


def _normalize_device_ids(device_ids: Any) -> list[int]:
    """容忍各种写法：None / int / "1" / "1,2" / [1, 2] / ["1,2"]。

    返回空列表表示「没有任何可见设备」，调用方必须转成恒假条件。
    """
    if device_ids is None:
        return []
    if isinstance(device_ids, (str, int)) and not isinstance(device_ids, bool):
        raw: list[Any] = [device_ids]
    else:
        raw = list(device_ids)
    ids: list[int] = []
    for item in raw:
        for part in str(item).split(","):
            part = part.strip()
            if part:
                ids.append(int(part))
    return ids


def _normalize_senders(senders: Any) -> list[str]:
    """注意：裸字符串必须整体视为一个发件人，否则会被逐字符拆开。"""
    if senders is None:
        return []
    if isinstance(senders, str):
        return [senders] if senders else []
    return [item for item in senders if item]


# --------------------------------------------------------------------- 游标


def encode_cursor(sort_value: dt.datetime, message_id: int) -> str:
    """把 (排序值, id) 复合游标编码成 URL 安全的 Base64。"""
    payload = f"{_as_utc(sort_value).isoformat()}{_CURSOR_SEPARATOR}{int(message_id)}"
    return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii")


def decode_cursor(raw: str) -> tuple[dt.datetime, int]:
    """解析游标。任何不合法输入都抛 ValueError，绝不把脏值带到 SQL 层。"""
    if not raw or not isinstance(raw, str):
        raise ValueError("非法游标")
    text = raw.strip()
    try:
        padded = text + "=" * (-len(text) % 4)
        payload = base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
        body = payload.decode("utf-8")
    except (ValueError, UnicodeError) as exc:  # binascii.Error 是 ValueError 的子类
        raise ValueError("非法游标") from exc

    moment_text, separator, id_text = body.rpartition(_CURSOR_SEPARATOR)
    if not separator or not moment_text or not id_text:
        raise ValueError("非法游标")
    try:
        moment = dt.datetime.fromisoformat(moment_text)
        message_id = int(id_text)
    except ValueError as exc:
        raise ValueError("非法游标") from exc
    if message_id <= 0:
        raise ValueError("非法游标")
    return _as_utc(moment), message_id


# --------------------------------------------------------------------- LIKE 转义


def escape_like(term: str) -> str:
    """转义 LIKE 通配符。反斜杠必须最先替换，否则会把后两步的转义符再转一遍。"""
    return (
        term.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
        .replace("%", f"{LIKE_ESCAPE}%")
        .replace("_", f"{LIKE_ESCAPE}_")
    )


# --------------------------------------------------------------------- 排序


def sort_column(sort: str) -> Any:
    """把排序键映射到列。非法值抛 ValueError。"""
    normalized = (sort or SORT_RECEIVED_AT).strip().lower()
    if normalized == SORT_RECEIVED_AT:
        return Message.received_at
    if normalized == SORT_INGESTED_AT:
        return Message.ingested_at
    raise ValueError(f"不支持的排序键: {sort}")


def normalize_order(order: str) -> str:
    """归一化排序方向。非法值抛 ValueError。"""
    normalized = (order or ORDER_DESC).strip().lower()
    if normalized not in ORDERS:
        raise ValueError(f"不支持的排序方向: {order}")
    return normalized


# --------------------------------------------------------------------- 条件


def _message_conditions(
    *,
    device_ids: Sequence[int],
    q: str | None,
    senders: Sequence[str] | None,
    time_from: dt.datetime | None,
    time_to: dt.datetime | None,
    has_code: bool | None,
    kind: str | None,
) -> list[Any]:
    """把筛选参数翻译成 WHERE 条件列表。"""
    ids = _normalize_device_ids(device_ids)
    if not ids:
        # 空设备集合必须是恒假条件：一旦「不加条件」，越权查询就会退化成全表
        return [false()]

    conditions: list[Any] = [Message.device_id.in_(ids)]

    keyword = (q or "").strip()
    if keyword:
        pattern = f"%{escape_like(keyword)}%"
        conditions.append(
            or_(
                Message.content.like(pattern, escape=LIKE_ESCAPE),
                Message.raw_content.like(pattern, escape=LIKE_ESCAPE),
                Message.sender.like(pattern, escape=LIKE_ESCAPE),
            )
        )

    wanted = _normalize_senders(senders)
    if wanted:
        conditions.append(Message.sender.in_(wanted))

    if time_from is not None:
        conditions.append(Message.received_at >= _as_utc(time_from))
    if time_to is not None:
        conditions.append(Message.received_at < _as_utc(time_to))

    if has_code is True:
        conditions.append(Message.code.is_not(None))
    elif has_code is False:
        conditions.append(Message.code.is_(None))

    if kind:
        conditions.append(Message.kind == kind)

    return conditions


def build_message_query(
    db: DbSession,
    *,
    device_ids: Sequence[int],
    q: str | None = None,
    senders: Sequence[str] | None = None,
    time_from: dt.datetime | None = None,
    time_to: dt.datetime | None = None,
    sort: str = SORT_RECEIVED_AT,
    order: str = ORDER_DESC,
    has_code: bool | None = None,
    kind: str | None = None,
) -> Select[tuple[Message]]:
    """返回已应用全部 WHERE 的 ``select(Message).join(Device)``。

    ``sort`` / ``order`` 在这里只做合法性校验（真正的排序在 :func:`paginate` 里做），
    让调用方无论走哪条路径都能最早发现非法参数。``db`` 为签名对称保留，本函数不查库。
    """
    sort_column(sort)
    normalize_order(order)

    stmt: Select[tuple[Message]] = select(Message).join(Device, Device.id == Message.device_id)
    conditions = _message_conditions(
        device_ids=device_ids,
        q=q,
        senders=senders,
        time_from=time_from,
        time_to=time_to,
        has_code=has_code,
        kind=kind,
    )
    return stmt.where(*conditions)


# --------------------------------------------------------------------- 分页


def _keyset_predicate(
    column: Any, moment: dt.datetime, message_id: int, *, descending: bool
) -> Any:
    """复合排序键 (column, id) 的严格不等号条件。"""
    if descending:
        return or_(column < moment, and_(column == moment, Message.id < message_id))
    return or_(column > moment, and_(column == moment, Message.id > message_id))


def paginate(
    db: DbSession,
    stmt: Select[tuple[Message]],
    *,
    sort: str,
    order: str,
    cursor: str | None,
    limit: int,
) -> tuple[list[Message], str | None]:
    """按 (排序键, id) 复合键做游标分页，返回 (当页, 下一页游标)。

    多取一条判断是否还有下一页；游标带不回退、不跳页（严格不等号）。
    """
    if limit < 1:
        raise ValueError("limit 必须 >= 1")

    column = sort_column(sort)
    descending = normalize_order(order) == ORDER_DESC

    if descending:
        ordered = stmt.order_by(column.desc(), Message.id.desc())
    else:
        ordered = stmt.order_by(column.asc(), Message.id.asc())

    if cursor:
        moment, message_id = decode_cursor(cursor)
        ordered = ordered.where(
            _keyset_predicate(column, moment, message_id, descending=descending)
        )

    rows = list(db.execute(ordered.limit(limit + 1)).scalars())
    has_more = len(rows) > limit
    page = rows[:limit]

    next_cursor: str | None = None
    if has_more and page:
        last = page[-1]
        sort_value = getattr(last, (sort or SORT_RECEIVED_AT).strip().lower())
        next_cursor = encode_cursor(sort_value, last.id)
    return page, next_cursor


# --------------------------------------------------------------------- 序列化


def load_devices(db: DbSession, device_ids: Iterable[int]) -> dict[int, Device]:
    """按 id 批量取设备，供 device_name / device_color 回填与 facets label 使用。"""
    ids = {int(item) for item in device_ids}
    if not ids:
        return {}
    rows = db.execute(select(Device).where(Device.id.in_(ids))).scalars()
    return {device.id: device for device in rows}


def _code_candidates(raw: Any) -> list[CodeCandidateOut]:
    """把 DB 里的 JSON 还原成 CodeCandidateOut 列表，坏数据直接跳过。"""
    candidates: list[CodeCandidateOut] = []
    if not isinstance(raw, list):
        return candidates
    for item in raw:
        if not isinstance(item, dict):
            continue
        code = item.get("code")
        if not code:
            continue
        try:
            confidence = int(item.get("confidence") or 0)
        except (TypeError, ValueError):
            confidence = 0
        candidates.append(CodeCandidateOut(code=str(code), confidence=confidence))
    return candidates


def _code_expired(expires_at: dt.datetime | None, now: dt.datetime) -> bool:
    if expires_at is None:
        return False
    return _as_utc(expires_at) <= _as_utc(now)


def serialize_messages(
    rows: Sequence[Message],
    device_map: dict[int, Device],
    *,
    now: dt.datetime,
) -> list[MessageOut]:
    """把 ORM 行转成对外契约 MessageOut。"""
    items: list[MessageOut] = []
    for row in rows:
        device = device_map.get(row.device_id)
        items.append(
            MessageOut(
                id=row.id,
                device_id=row.device_id,
                device_name=device.name if device is not None else "",
                device_color=device.color if device is not None else "",
                kind=row.kind,  # type: ignore[arg-type]
                sender=row.sender,
                content=row.content,
                raw_content=row.raw_content,
                received_at=row.received_at,
                ingested_at=row.ingested_at,
                sent_at=row.sent_at,
                time_source=row.time_source,
                time_doubtful=is_time_doubtful(row.time_source),
                sim_slot=row.sim_slot,
                code=row.code,
                code_confidence=row.code_confidence,
                code_candidates=_code_candidates(row.code_candidates),
                code_expires_at=row.code_expires_at,
                code_expired=_code_expired(row.code_expires_at, now),
                # 设备可见即可删：单条删除对归属者与被共享者同样开放
                can_delete=True,
                raw_payload=dict(row.raw_payload or {}),
            )
        )
    return items


# --------------------------------------------------------------------- 聚合


def facets(
    db: DbSession,
    *,
    device_ids: Sequence[int],
    q: str | None = None,
    senders: Sequence[str] | None = None,
    time_from: dt.datetime | None = None,
    time_to: dt.datetime | None = None,
    has_code: bool | None = None,
    kind: str | None = None,
    top: int = FACET_LIMIT,
) -> FacetsOut:
    """同一组筛选条件下的 facets：senders（top N）、devices、total。

    三项都与筛选条件一致（包括各自维度自身的筛选），保证前端拿到的计数
    和列表条数对得上。
    """
    conditions = _message_conditions(
        device_ids=device_ids,
        q=q,
        senders=senders,
        time_from=time_from,
        time_to=time_to,
        has_code=has_code,
        kind=kind,
    )
    count = func.count(Message.id)

    sender_rows = db.execute(
        select(Message.sender, count.label("n"))
        .where(*conditions)
        .group_by(Message.sender)
        .order_by(count.desc(), Message.sender.asc())
        .limit(top)
    ).all()

    device_rows = db.execute(
        select(Message.device_id, count.label("n"))
        .where(*conditions)
        .group_by(Message.device_id)
        .order_by(count.desc(), Message.device_id.asc())
    ).all()

    device_map = load_devices(db, [row[0] for row in device_rows])
    total = db.scalar(select(count).where(*conditions)) or 0

    return FacetsOut(
        senders=[
            FacetItem(value=sender or "", label=sender or "", count=int(row_count))
            for sender, row_count in sender_rows
        ],
        devices=[
            FacetItem(
                value=str(device_id),
                label=device_map[device_id].name if device_id in device_map else str(device_id),
                count=int(row_count),
            )
            for device_id, row_count in device_rows
        ],
        total=int(total),
    )
