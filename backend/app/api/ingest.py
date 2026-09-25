"""入库 API（契约 §3）：POST /api/v1/ingest。

SmsForwarder 的兼容面
---------------------
- JSON 模板（接入向导默认）与 ``application/x-www-form-urlencoded`` 旧模板都支持；
  旧模板字段名经 :func:`services.ingest.build_ingest_payload` 映射后统一为
  :class:`~app.schemas.IngestRequest`。
- 凭据两种：``Authorization: Bearer <device.secret>`` 或
  ``device_mark + sent_at + sign``（HMAC-SHA256）。Bearer 即凭据，即使同时带了
  错误的 sign 也不会拒绝，只是把 ``sign_ok`` 记成 False。
- App 默认模板可能既没有 ``device_mark`` 也没有 Bearer（只有
  ``from/content/timestamp/sign``）。此时逐个比对活跃设备的 secret：签名本身
  就是凭据，命中唯一设备后视为 ``auth_kind="sign"``；一个都匹配不上则 401。

防护
----
- 先读完整 body 并按设置判大小（413），再解析（解析失败 400）；
- 解析出设备后按设备维度滑动窗口限速（429 + Retry-After）；
- 停用设备返回 403 而不是 401，避免手机端把同一凭据无限重试；
- 审计只记设备、动作与结果，绝不记正文 / sign / secret 等敏感内容。
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .. import deps, security
from ..db import get_db
from ..models import Device, Message
from ..schemas import IngestResponse
from ..services import audit, test_sessions
from ..services import ingest as ingest_service
from ..services import settings as settings_service
from ..services.events import hub

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["ingest"])

# 限速窗口固定 60 秒；Retry-After 与之一致。
RATE_LIMIT_WINDOW_SECONDS = 60

# 同一来源 IP 每分钟允许的凭据失败次数。超过就不再写审计，直接 429：
# 每次失败写一行审计是公开端点上的写放大，必须封顶。
FAILED_CREDENTIAL_LIMIT_PER_IP = 30

_JSON_CONTENT_TYPES = frozenset({"application/json", "text/json"})
_FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"
_BODY_TOO_LARGE = "请求体超过上限"
_BAD_CREDENTIALS = "设备凭据无效"


# --------------------------------------------------------------------- 请求体解析


def _content_type(request: Request) -> str:
    raw = request.headers.get("content-type", "")
    return raw.split(";", 1)[0].strip().lower()


def _looks_like_json(raw: bytes | str) -> bool:
    if isinstance(raw, bytes):
        text = raw.lstrip()
        return text.startswith((b"{", b"["))
    return raw.lstrip().startswith(("{", "["))


def _looks_like_form(raw: bytes | str) -> bool:
    return "=" in (raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw)


def _load_json(raw: bytes) -> dict[str, object]:
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="JSON 解析失败"
        ) from exc
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="请求体必须是 JSON 对象"
        )
    return data


def _load_form(raw: bytes) -> dict[str, object]:
    try:
        return dict(ingest_service.parse_form_body(raw))
    except Exception as exc:  # pragma: no cover - parse_qsl 基本不会抛
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="表单解析失败") from exc


def _parse_request_body(request: Request, raw: bytes) -> dict[str, object]:
    """按 Content-Type 分派；无 Content-Type 时按形状猜。解析失败一律 400。"""
    ctype = _content_type(request)
    if ctype in _JSON_CONTENT_TYPES or ctype.endswith("+json"):
        return _load_json(raw)
    if ctype == _FORM_CONTENT_TYPE:
        return _load_form(raw)
    if not ctype or ctype.startswith("text/"):
        if _looks_like_json(raw):
            return _load_json(raw)
        if _looks_like_form(raw):
            return _load_form(raw)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无法识别请求体格式")
    # 其他 Content-Type：JSON 形体按 JSON 解，否则按表单形体解，都不像就 400。
    if _looks_like_json(raw):
        return _load_json(raw)
    if _looks_like_form(raw):
        return _load_form(raw)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无法识别请求体格式")


def _build_payload(data: dict[str, object]):
    try:
        return ingest_service.build_ingest_payload(data)
    except (ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="请求体字段不合法"
        ) from exc


def _epoch_ms(value: str | None) -> int | None:
    """sign 校验用的 epoch 毫秒；解析不出来就当作没有（交给 resolve_device 判 401）。"""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(text)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------- 凭据


def _resolve_sign_only_device(db: DbSession, *, sign: str, sent_at_ms: int) -> Device | None:
    """App 默认模板（无 device_mark / 无 Bearer）的降级路径。

    签名本身就是凭据：按 id 顺序遍历活跃设备，命中第一个验签通过的设备。
    多个设备使用不同 secret，"第一个命中"不会产生歧义；不存在的 device_mark
    仍然走 key-id 查找，不会触发这里的遍历。
    """
    # 时间戳超出允许偏差时遍历整个设备表做 O(n) HMAC 也没有意义：先挡掉（重放防护）。
    if not security.sign_skew_ok(sent_at_ms):
        return None
    rows = db.execute(
        select(Device).where(Device.is_active.is_(True)).order_by(Device.id)
    ).scalars()
    for candidate in rows:
        if security.verify_signature(candidate.secret, sent_at_ms, sign):
            return candidate
    return None


def _audit_rejected(
    db: DbSession,
    request: Request,
    *,
    auth_kind: str,
    reason: str,
    device_mark: str | None = None,
) -> None:
    detail: dict[str, Any] = {"auth_kind": auth_kind, "reason": reason}
    if device_mark:
        detail["device_mark"] = device_mark
    audit.log(
        db,
        action="ingest.rejected",
        actor_kind="device",
        target_type="device",
        target_id=device_mark or "",
        ip=deps.client_ip(request),
        user_agent=deps.user_agent(request),
        success=False,
        detail=detail,
    )


def _reject(
    db: DbSession,
    request: Request,
    *,
    status_code: int,
    detail: str,
    auth_kind: str,
    reason: str,
    device_mark: str | None = None,
) -> NoReturn:
    """统一的凭据拒绝出口。

    先扣来源 IP 的失败预算：超限直接 429 且不写审计——否则公开端点会被刷出
    无上限增长的审计表。预算内才落审计并返回原有的 401/403。
    """
    ip = deps.client_ip(request) or "unknown"
    if not security.ingest_failure_limiter.allow(
        f"ingest-fail:{ip}", FAILED_CREDENTIAL_LIMIT_PER_IP, RATE_LIMIT_WINDOW_SECONDS
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="凭据失败次数过多，请稍后再试",
            headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
        )
    _audit_rejected(db, request, auth_kind=auth_kind, reason=reason, device_mark=device_mark)
    raise HTTPException(status_code=status_code, detail=detail)


# --------------------------------------------------------------------- 响应 / 游标


def _encode_cursor(message: Message) -> str:
    """消息列表游标：优先复用 messages 切片的 search.encode_cursor。"""
    try:
        from ..services.search import encode_cursor
    except ImportError:
        encode_cursor = None  # type: ignore[assignment]
    if encode_cursor is not None:
        return encode_cursor(message.received_at, message.id)
    payload = f"{int(message.received_at.timestamp() * 1000)}:{message.id}".encode("ascii")
    return base64.urlsafe_b64encode(payload).decode("ascii")


# --------------------------------------------------------------------- 端点


@router.post("/ingest", response_model=IngestResponse)
async def ingest_message(request: Request, db: DbSession = Depends(get_db)) -> IngestResponse:
    """接收 SmsForwarder Webhook 推送并落库（幂等）。"""
    # 1. 大小先于读取 / 解析 / 鉴权：先看 Content-Length，再按上限流式读体。
    #    直接 await request.body() 会把超限请求的整个请求体先吃进内存。
    limits = ingest_service.effective_limits(db)
    max_body = limits[0]
    too_large = HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail=f"{_BODY_TOO_LARGE} {max_body} 字节",
    )
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_body:
        raise too_large
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > max_body:
            raise too_large
    raw = bytes(chunks)

    # 2. 解析 + 字段别名映射；失败 400。
    data = _parse_request_body(request, raw)
    payload = _build_payload(data)

    bearer_secret = security.parse_bearer(request.headers.get("authorization"))
    device_mark = payload.device_mark or None
    sent_at_ms = _epoch_ms(payload.sent_at)
    sign = payload.sign or None
    auth_kind = "bearer" if bearer_secret else ("sign" if device_mark or sign else "none")

    # 3. 定位设备：Bearer > device_mark key-id > 默认模板的签名遍历。
    sign_ok = False
    if bearer_secret is None and device_mark is None and sign and sent_at_ms is not None:
        device = _resolve_sign_only_device(db, sign=sign, sent_at_ms=sent_at_ms)
        if device is None:
            _reject(
                db,
                request,
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"{_BAD_CREDENTIALS}：签名校验失败",
                auth_kind="sign",
                reason="sign_not_matched",
            )
        auth_kind, sign_ok = "sign", True
    else:
        try:
            device, auth_kind, sign_ok = ingest_service.resolve_device(
                db,
                bearer_secret=bearer_secret,
                device_mark=device_mark,
                sent_at_ms=sent_at_ms,
                sign=sign,
            )
        except ingest_service.IngestError as exc:
            _reject(
                db,
                request,
                status_code=exc.status_code,
                detail=exc.detail,
                auth_kind=auth_kind,
                reason=str(exc.detail),
                device_mark=device_mark,
            )
        if device is None:
            _reject(
                db,
                request,
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=_BAD_CREDENTIALS,
                auth_kind=auth_kind,
                reason="credentials_not_matched",
                device_mark=device_mark,
            )

    # 4. 每设备滑动窗口限速。
    limit = settings_service.rate_limit_per_device(db)
    if not security.ingest_limiter.allow(f"device:{device.id}", limit, RATE_LIMIT_WINDOW_SECONDS):
        audit.log(
            db,
            action="ingest.rate_limited",
            actor_kind="device",
            target_type="device",
            target_id=device.id,
            ip=deps.client_ip(request),
            user_agent=deps.user_agent(request),
            success=False,
            detail={
                "device_id": device.id,
                "auth_kind": auth_kind,
                "limit": limit,
                "window_seconds": RATE_LIMIT_WINDOW_SECONDS,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="推送过于频繁，请稍后再试",
            headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
        )

    # 5. 停用设备用 403 而不是 401：凭据有效，重试没有意义。
    if not device.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="设备已停用")
    # 接入向导测试会话只回显首条推送，不更新设备活动时间、不写消息表或成功审计。
    try:
        test_push = test_sessions.store.capture(
            device.id,
            device.secret,
            payload,
            sign_ok=sign_ok,
            auth_kind=auth_kind,
            limits=limits,
        )
    except ingest_service.IngestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    if test_push is not None:
        return IngestResponse(
            ok=True,
            id=0,
            duplicate=False,
            code=test_push.code,
            received_at=test_push.received_at,
            time_source=test_push.time_source,
        )

    # 6. 落库（幂等键在 services.ingest 内计算，重放返回同一条）。
    try:
        message, duplicate = ingest_service.store_message(
            db, device, payload, data, sign_ok=sign_ok, limits=limits
        )
    except ingest_service.IngestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    device.last_auth_kind = auth_kind
    db.commit()

    # 成功也留审计（不含正文）；接入向导与管理页都会据此显示最近活动。
    audit.log(
        db,
        action="ingest",
        actor_kind="device",
        target_type="message",
        target_id=message.id,
        ip=deps.client_ip(request),
        user_agent=deps.user_agent(request),
        success=True,
        detail={"device_id": device.id, "duplicate": duplicate, "auth_kind": auth_kind},
    )

    # 7. 唤醒该设备归属者与共享者的 SSE 拉取信号。
    hub.publish(
        deps.users_with_access(db, device.id),
        {
            "type": "messages",
            "cursor": _encode_cursor(message),
            "device_id": device.id,
        },
    )

    return IngestResponse(
        ok=True,
        id=message.id,
        duplicate=duplicate,
        code=message.code,
        received_at=message.received_at,
        time_source=message.time_source,
    )
