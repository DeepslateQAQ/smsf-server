"""入库核心：凭据解析、时间归位、幂等键、落库。

幂等键的设计要点（这是唯一一处「重试会不会变成重复消息」的判定）：
稳定时间优先取设备上报的短信接收时间（跨 OkHttp 重试与 App 层重发都恒定），
其次取 App 构造请求的时刻 sent_at（OkHttp 重试复用同一请求，恒定），
**绝不使用服务端入库时间**——它每次请求都不同，会让唯一索引永不冲突。
"""

from __future__ import annotations

import datetime as dt
import hashlib
import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from .. import otp
from ..config import get_settings
from ..models import (
    KIND_SMS,
    TIME_SOURCE_DEVICE,
    TIME_SOURCE_INGEST,
    TIME_SOURCE_SENT,
    Device,
    Message,
    utcnow,
)
from ..schemas import IngestRequest
from ..security import sign_skew_ok, verify_signature

logger = logging.getLogger(__name__)

TIME_SOURCE_DEVICE_LOCAL = "device_local"
_DOUBTFUL_SOURCES = frozenset({TIME_SOURCE_SENT, TIME_SOURCE_INGEST})

_ISO_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
)


class IngestError(Exception):
    """入库失败，携带 HTTP 状态码与对用户可读的提示。"""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# --------------------------------------------------------------------- 凭据


def resolve_device(
    db: DbSession,
    *,
    bearer_secret: str | None,
    device_mark: str | None,
    sent_at_ms: int | None,
    sign: str | None,
) -> tuple[Device | None, str, bool]:
    """返回 (设备, 凭据方式, 签名是否校验通过)。

    - Bearer：secret 即凭据，常量时间比较后定位设备；若同时带 sign 则一并校验
    - 签名：device_mark 是公开的 key id，用它定位设备后必须验签
    """
    if bearer_secret:
        device = db.execute(
            select(Device).where(Device.secret == bearer_secret)
        ).scalar_one_or_none()
        if device is None:
            return None, "bearer", False
        sign_ok = False
        if sign and sent_at_ms is not None:
            sign_ok = verify_signature(device.secret, sent_at_ms, sign) and sign_skew_ok(sent_at_ms)
        return device, "bearer", sign_ok

    if device_mark:
        device = db.execute(
            select(Device).where(Device.device_mark == device_mark)
        ).scalar_one_or_none()
        if device is None:
            return None, "sign", False
        if not sign or sent_at_ms is None:
            raise IngestError(401, "缺少 sign 或 sent_at，无法完成签名校验")
        # 时间窗先于 HMAC：超出允许偏差的签名直接作废（重放防护），也省掉一次 HMAC。
        if not sign_skew_ok(sent_at_ms):
            return None, "sign", False
        if not verify_signature(device.secret, sent_at_ms, sign):
            return None, "sign", False
        return device, "sign", True

    raise IngestError(
        401,
        "缺少设备凭据：请配置请求头 Authorization: Bearer <secret>，"
        "或在请求体带 device_mark + sign。",
    )


# --------------------------------------------------------------------- 时间


def _parse_with_formats(text: str) -> dt.datetime | None:
    for fmt in _ISO_FORMATS:
        try:
            return dt.datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def parse_iso_datetime(value: str) -> tuple[dt.datetime, bool] | None:
    """解析 ISO 8601。返回 (UTC 时间, 是否带时区)。"""
    text = value.strip()
    if not text:
        return None
    candidate = text.replace("Z", "+00:00")
    parsed: dt.datetime | None
    try:
        parsed = dt.datetime.fromisoformat(candidate)
    except ValueError:
        parsed = _parse_with_formats(text)
    if parsed is None:
        return None
    if parsed.tzinfo is not None:
        return parsed.astimezone(dt.UTC), True
    # 无时区：按服务器本地时区解释（SmsForwarder 默认格式即如此）
    local_tz = dt.datetime.now().astimezone().tzinfo or dt.UTC
    return parsed.replace(tzinfo=local_tz).astimezone(dt.UTC), False


def parse_epoch_ms(value: str | int | None) -> dt.datetime | None:
    if value is None or value == "":
        return None
    try:
        millis = int(str(value).strip())
    except ValueError:
        return None
    if millis <= 0:
        return None
    try:
        return dt.datetime.fromtimestamp(millis / 1000, tz=dt.UTC)
    except (OverflowError, OSError, ValueError):
        return None


def resolve_times(
    payload: IngestRequest, ingested_at: dt.datetime
) -> tuple[dt.datetime, str, dt.datetime | None]:
    """返回 (received_at, time_source, sent_at)。"""
    sent_at = parse_epoch_ms(payload.sent_at)

    if payload.received_at:
        parsed = parse_iso_datetime(payload.received_at)
        if parsed is not None:
            moment, aware = parsed
            source = TIME_SOURCE_DEVICE if aware else TIME_SOURCE_DEVICE_LOCAL
            if source == TIME_SOURCE_DEVICE_LOCAL:
                logger.debug("received_at 无时区，按服务器本地时区解释: %s", payload.received_at)
            return moment, source, sent_at

    if sent_at is not None:
        return sent_at, TIME_SOURCE_SENT, sent_at

    return ingested_at, TIME_SOURCE_INGEST, sent_at


def stable_time(
    received_at: dt.datetime,
    time_source: str,
    sent_at: dt.datetime | None,
    ingested_at: dt.datetime,
) -> dt.datetime:
    """幂等键使用的时间分量。设备上报时间 > App 发送时刻 > 入库时刻（兜底）。"""
    if time_source in (TIME_SOURCE_DEVICE, TIME_SOURCE_DEVICE_LOCAL):
        return received_at
    if time_source == TIME_SOURCE_SENT and sent_at is not None:
        return sent_at
    return sent_at or ingested_at


def compute_dup_key(sender: str, content: str, moment: dt.datetime) -> str:
    material = f"{sender}\x1f{content}\x1f{moment.astimezone(dt.UTC).isoformat()}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def is_time_doubtful(time_source: str) -> bool:
    return time_source in _DOUBTFUL_SOURCES


# --------------------------------------------------------------------- 落库


def store_message(
    db: DbSession,
    device: Device,
    payload: IngestRequest,
    raw_payload: dict[str, object],
    *,
    sign_ok: bool,
    limits: tuple[int, int],
) -> tuple[Message, bool]:
    """把一条推送落库。返回 (消息, 是否重复)。"""
    max_content = limits[1]
    content = payload.content or ""
    raw_content = payload.raw_content if payload.raw_content is not None else content
    if len(content) > max_content or len(raw_content) > max_content:
        raise IngestError(413, f"正文超过上限 {max_content} 字符")

    ingested_at = utcnow()
    received_at, time_source, sent_at = resolve_times(payload, ingested_at)
    moment = stable_time(received_at, time_source, sent_at, ingested_at)
    dup_key = compute_dup_key(payload.sender, content, moment)

    existing = db.execute(
        select(Message).where(Message.device_id == device.id, Message.dup_key == dup_key)
    ).scalar_one_or_none()
    if existing is not None:
        device.last_ingest_at = ingested_at
        db.commit()
        return existing, True

    result = otp.extract(content or raw_content)
    received_at, time_source, sent_at = resolve_times(payload, ingested_at)
    message = Message(
        device_id=device.id,
        kind=payload.kind or KIND_SMS,
        sender=(payload.sender or "")[:128],
        content=content,
        raw_content=raw_content,
        received_at=received_at,
        ingested_at=ingested_at,
        sent_at=sent_at,
        time_source=time_source,
        sign_ok=sign_ok,
        sim_slot=(payload.sim or "")[:64],
        code=result.primary.code if result.primary else None,
        code_confidence=result.primary.confidence if result.primary else None,
        code_candidates=[
            {"code": candidate.code, "confidence": candidate.confidence}
            for candidate in result.candidates
        ],
        code_expires_at=otp.code_expires_at(received_at, result.ttl_seconds),
        dup_key=dup_key,
        raw_payload=dict(raw_payload),
    )

    try:
        with db.begin_nested():
            db.add(message)
            db.flush()
    except IntegrityError:
        # 并发下的竞态：另一个请求刚插入了同一条
        existing = db.execute(
            select(Message).where(Message.device_id == device.id, Message.dup_key == dup_key)
        ).scalar_one_or_none()
        if existing is None:
            raise
        device.last_ingest_at = ingested_at
        db.commit()
        return existing, True

    device.last_ingest_at = ingested_at
    db.commit()
    db.refresh(message)
    return message, False


def parse_form_body(raw: bytes) -> dict[str, str]:
    from urllib.parse import parse_qsl

    text = raw.decode("utf-8", errors="replace")
    return dict(parse_qsl(text, keep_blank_values=True))


def build_ingest_payload(data: dict[str, object]) -> IngestRequest:
    """把任意来源的字段名映射到内部字段。

    兼容 App 默认表单模板（from/content/timestamp/sign）与自定义模板（sender/...）。
    """
    alias = {
        "from": "sender",
        "msg": "content",
        "org_content": "raw_content",
        "timestamp": "sent_at",
        "receive_time": "received_at",
        "device_mark": "device_mark",
        "card_slot": "sim",
        "title": "sim",
        "app_version": "app_version",
    }
    mapped: dict[str, object] = {}
    for key, value in data.items():
        target = alias.get(key, key)
        if target not in mapped or not mapped[target]:
            mapped[target] = value
    return IngestRequest.model_validate(mapped)


def within_body_limit(size: int, limit: int) -> bool:
    return size <= limit


def effective_limits(db: DbSession) -> tuple[int, int]:
    from . import settings as settings_service

    config = get_settings()
    return (
        settings_service.max_body_bytes(db) or config.max_body_bytes,
        settings_service.max_content_chars(db) or config.max_content_chars,
    )
