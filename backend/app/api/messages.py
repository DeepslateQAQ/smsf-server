"""消息检索、facets、导出、单条删除与保留期清理。

设备范围一律先用 :func:`deps.resolve_device_scope` 收敛：不可见的设备 id 被静默
丢弃，所以越权查询得到的是**空集**而不是 403，也不会泄露设备是否存在。

时间语义（与 services/search.py 一致）：``from`` 闭、``to`` 开，半开区间 [from, to)。
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from collections.abc import Sequence
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import delete
from sqlalchemy.orm import Session as DbSession

from .. import deps
from ..models import Message, User, utcnow
from ..schemas import (
    DeleteResponse,
    FacetsOut,
    MessageOut,
    MessagePage,
    PurgeRequest,
    PurgeResponse,
)
from ..services import audit as audit_service
from ..services import search

router = APIRouter(prefix="/api/messages", tags=["messages"])

_Kind = Literal["sms", "notification", "call"]
_FORMATS = ("csv", "json")

#: 导出是一次拿全量的接口，需要一个天花板避免内存被撑爆
EXPORT_LIMIT = 10_000

#: CSV 表头：BOM + 这行必须是文件首行，Excel 靠它识别 UTF-8
CSV_HEADERS: tuple[str, ...] = ("时间", "设备", "发送者", "类型", "验证码", "正文")

_UTF8_BOM = "\ufeff"


def _parse_device_ids(*groups: Sequence[str] | None) -> list[int] | None:
    """解析设备筛选：支持重复参数、逗号分隔与别名 device_id。

    返回 None 表示「未指定」（= 全部可见设备）；返回列表（可能为空）表示
    调用方明确圈定了范围，交给 resolve_device_scope 收敛。
    """
    values: list[str] = []
    for group in groups:
        values.extend(group or [])
    if not values:
        return None

    ids: set[int] = set()
    for value in values:
        for part in str(value).split(","):
            part = part.strip()
            if not part:
                continue
            try:
                ids.add(int(part))
            except ValueError as exc:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, f"device_ids 参数不合法: {value}"
                ) from exc
    return sorted(ids)


class MessageFilters:
    """list / facets / export 共用的查询参数。"""

    def __init__(
        self,
        device_ids: list[str] | None = Query(
            default=None, description="设备 id，可重复或逗号分隔；不可见的 id 被静默忽略"
        ),
        device_id: list[str] | None = Query(default=None, description="device_ids 的兼容别名"),
        q: str | None = Query(
            default=None, max_length=200, description="关键词，匹配正文 / 原始内容 / 发件人"
        ),
        senders: list[str] | None = Query(default=None, description="发件人精确匹配，可重复"),
        time_from: dt.datetime | None = Query(
            default=None, alias="from", description="起始时间（含）"
        ),
        time_to: dt.datetime | None = Query(
            default=None, alias="to", description="结束时间（不含）"
        ),
        sort: str = Query(default=search.SORT_RECEIVED_AT, description="received_at | ingested_at"),
        order: str = Query(default=search.ORDER_DESC, description="desc | asc"),
        has_code: bool | None = Query(
            default=None, description="true=仅有码 / false=仅无码 / 缺省不过滤"
        ),
        kind: _Kind | None = Query(default=None, description="sms | notification | call"),
    ) -> None:
        self.device_ids = _parse_device_ids(device_ids, device_id)
        self.q = q
        self.senders = [item for item in (senders or []) if item] or None
        self.time_from = time_from
        self.time_to = time_to
        self.sort = sort
        self.order = order
        self.has_code = has_code
        self.kind = kind


def _readable_message(db: DbSession, user: User, message_id: int) -> Message:
    """取一条当前用户可见的消息：不可见与不存在一律 404（不泄露 id 是否存在）。"""
    message = db.get(Message, message_id)
    if message is None or message.device_id not in deps.visible_device_ids(db, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "消息不存在")
    return message


def _bad_request(exc: ValueError) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc) or "参数不合法")


# --------------------------------------------------------------------- 列表


@router.get("", response_model=MessagePage, summary="消息列表（游标分页）")
def list_messages(
    cursor: str | None = Query(default=None, description="上一页返回的 next_cursor"),
    limit: int = Query(default=search.DEFAULT_LIMIT, ge=1, le=search.MAX_LIMIT),
    filters: MessageFilters = Depends(),
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(deps.get_db),
) -> MessagePage:
    scope = deps.resolve_device_scope(db, user, filters.device_ids)
    try:
        stmt = search.build_message_query(
            db,
            device_ids=scope,
            q=filters.q,
            senders=filters.senders,
            time_from=filters.time_from,
            time_to=filters.time_to,
            sort=filters.sort,
            order=filters.order,
            has_code=filters.has_code,
            kind=filters.kind,
        )
        rows, next_cursor = search.paginate(
            db,
            stmt,
            sort=filters.sort,
            order=filters.order,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc

    device_map = search.load_devices(db, [row.device_id for row in rows])
    items = search.serialize_messages(rows, device_map, now=utcnow())
    return MessagePage(items=items, next_cursor=next_cursor)


# --------------------------------------------------------------------- facets


@router.get("/facets", response_model=FacetsOut, summary="按发件人 / 设备聚合")
def message_facets(
    filters: MessageFilters = Depends(),
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(deps.get_db),
) -> FacetsOut:
    scope = deps.resolve_device_scope(db, user, filters.device_ids)
    try:
        return search.facets(
            db,
            device_ids=scope,
            q=filters.q,
            senders=filters.senders,
            time_from=filters.time_from,
            time_to=filters.time_to,
            has_code=filters.has_code,
            kind=filters.kind,
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc


# --------------------------------------------------------------------- 导出


def _export_format(request: Request, requested: str | None) -> str:
    """/export.csv、/export.json 这两个别名从路径推断，否则用 ?format=。"""
    path = request.url.path.lower()
    if path.endswith(".json"):
        return "json"
    if path.endswith(".csv"):
        return "csv"
    fmt = (requested or "csv").strip().lower()
    if fmt not in _FORMATS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "format 仅支持 csv 或 json")
    return fmt


@router.get("/export", summary="导出（csv 默认 / json）")
@router.get("/export.csv", include_in_schema=False)
@router.get("/export.json", include_in_schema=False)
def export_messages(
    request: Request,
    format_: str | None = Query(default=None, alias="format", description="csv（默认）| json"),
    filters: MessageFilters = Depends(),
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(deps.get_db),
) -> Response:
    fmt = _export_format(request, format_)
    scope = deps.resolve_device_scope(db, user, filters.device_ids)
    try:
        stmt = search.build_message_query(
            db,
            device_ids=scope,
            q=filters.q,
            senders=filters.senders,
            time_from=filters.time_from,
            time_to=filters.time_to,
            sort=filters.sort,
            order=filters.order,
            has_code=filters.has_code,
            kind=filters.kind,
        )
        rows, _ = search.paginate(
            db,
            stmt,
            sort=filters.sort,
            order=filters.order,
            cursor=None,
            limit=EXPORT_LIMIT,
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc

    device_map = search.load_devices(db, [row.device_id for row in rows])
    items = search.serialize_messages(rows, device_map, now=utcnow())
    stamp = utcnow().strftime("%Y-%m-%d")

    if fmt == "json":
        return JSONResponse(
            content=jsonable_encoder(items),
            headers={"Content-Disposition": f'attachment; filename="messages-{stamp}.json"'},
        )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_HEADERS)
    for item in items:
        writer.writerow(
            [
                item.received_at.isoformat(),
                item.device_name,
                item.sender,
                item.kind,
                item.code or "",
                item.content,
            ]
        )
    # UTF-8 BOM：没有它 Excel 会把中文正文识别成乱码
    content = _UTF8_BOM + buffer.getvalue()
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="messages-{stamp}.csv"'},
    )


# --------------------------------------------------------------------- 清理


@router.post("/purge", response_model=PurgeResponse, summary="按保留期清理")
def purge_messages(
    payload: PurgeRequest,
    request: Request,
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(deps.get_db),
) -> PurgeResponse:
    """只清理**自己名下**的设备；被共享的设备再多请求也不会删。"""
    owned = deps.owned_device_ids(db, user)
    requested = {int(item) for item in payload.device_ids} if payload.device_ids else None
    scope = sorted(owned if requested is None else owned & requested)

    deleted = 0
    if scope:
        cutoff = utcnow() - dt.timedelta(days=payload.before_days)
        result = db.execute(
            delete(Message).where(
                Message.device_id.in_(scope),
                Message.received_at < cutoff,
            )
        )
        # Session.execute 的标注是 Result[Any]，但 DELETE 实际返回带 rowcount 的 CursorResult
        deleted = int(result.rowcount or 0)  # type: ignore[attr-defined]
        db.commit()

    audit_service.log(
        db,
        action="message.purge",
        actor_kind="user",
        actor_user_id=user.id,
        target_type="message",
        ip=deps.client_ip(request),
        user_agent=deps.user_agent(request),
        detail={
            "before_days": payload.before_days,
            "device_count": len(scope),
            "deleted": deleted,
        },
    )
    return PurgeResponse(deleted=deleted)


# --------------------------------------------------------------------- 单条


@router.get("/{message_id}", response_model=MessageOut, summary="消息详情")
def get_message(
    message_id: int,
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(deps.get_db),
) -> MessageOut:
    message = _readable_message(db, user, message_id)
    device_map = search.load_devices(db, [message.device_id])
    # can_delete=True：设备可见即可删，所以列表里下一行断言必然成立
    return search.serialize_messages([message], device_map, now=utcnow())[0]


@router.delete("/{message_id}", response_model=DeleteResponse, summary="删除单条")
def delete_message(
    message_id: int,
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(deps.get_db),
) -> DeleteResponse:
    """可见即可删：归属者与被共享者都能删（删除后归属者也看不到）。"""
    message = _readable_message(db, user, message_id)
    db.delete(message)
    db.commit()
    return DeleteResponse(ok=True)
