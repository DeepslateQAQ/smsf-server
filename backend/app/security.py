"""凭据、签名校验、限速。

三件事：
1. 密码 Argon2id、会话不透明 token（DB 只存 SHA-256）
2. SmsForwarder 的 HMAC 签名校验（含 URL-decode 与 Base64 padding 修补）
3. 入库限速（进程内滑动窗口）与登录失败锁定
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import secrets
from collections import deque
from urllib.parse import unquote

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .config import get_settings
from .models import LoginAttempt

_hasher = PasswordHasher()
SESSION_TOKEN_BYTES = 32


# --------------------------------------------------------------------- 密码


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except Exception:
        return False


# --------------------------------------------------------------------- 会话


def new_session_token() -> str:
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def hash_session_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def session_expiry(now: dt.datetime | None = None) -> dt.datetime:
    base = now or dt.datetime.now(dt.UTC)
    return base + dt.timedelta(days=get_settings().session_ttl_days)


# --------------------------------------------------------------------- 设备 secret


def new_device_secret() -> str:
    return secrets.token_urlsafe(24)


def secret_fingerprint(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:8]


def constant_time_equals(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


# --------------------------------------------------------------------- 签名


def _b64decode_loose(value: str) -> bytes | None:
    """容忍 URL 编码与缺失 padding 的 Base64 解码。"""
    candidate = value + "=" * (-len(value) % 4)
    try:
        return base64.b64decode(candidate, validate=False)
    except Exception:
        return None


def compute_signature(secret: str, timestamp_ms: int, *, url_encode: bool = False) -> str:
    """SmsForwarder 的签名规则：Base64(HMAC_SHA256(key=secret, msg=f"{timestamp}\\n{secret}"))。

    App 端会把结果再做一次 URLEncoder.encode，因此校验时要先 unquote。
    """
    message = f"{timestamp_ms}\n{secret}".encode()
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    encoded = base64.b64encode(digest).decode("ascii")
    if url_encode:
        from urllib.parse import quote

        return quote(encoded, safe="")
    return encoded


def verify_signature(secret: str, timestamp_ms: int, provided: str) -> bool:
    """校验 App 传来的 sign（已 URL 编码）。"""
    if not provided:
        return False
    # 注意：必须用 unquote 而非 unquote_plus，否则 Base64 里的 '+' 会被吃成空格
    decoded_text = unquote(provided).strip()
    provided_bytes = _b64decode_loose(decoded_text)
    if provided_bytes is None:
        return False
    expected = compute_signature(secret, timestamp_ms)
    return hmac.compare_digest(provided_bytes, base64.b64decode(expected))


def sign_skew_ok(timestamp_ms: int, *, now: dt.datetime | None = None) -> bool:
    current = now or dt.datetime.now(dt.UTC)
    skew = abs(current.timestamp() * 1000 - timestamp_ms)
    return skew <= get_settings().sign_max_skew_hours * 3600 * 1000


def parse_bearer(header_value: str | None) -> str | None:
    if not header_value:
        return None
    prefix = "bearer "
    if header_value.lower().startswith(prefix):
        token = header_value[len(prefix) :].strip()
        return token or None
    return None


# --------------------------------------------------------------------- 限速


class SlidingWindowLimiter:
    """进程内滑动窗口限速。单进程部署模型下足够；多实例时每实例独立计数。"""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, limit: int, window_seconds: float) -> bool:
        from time import monotonic

        now = monotonic()
        bucket = self._hits.setdefault(key, deque())
        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)


ingest_limiter = SlidingWindowLimiter()
# 凭据失败的独立预算：按来源 IP 限制失败次数，避免公开端点被刷出无上限的审计表
ingest_failure_limiter = SlidingWindowLimiter()
login_limiter = SlidingWindowLimiter()


# --------------------------------------------------------------------- 登录锁定


def failed_login_count(db: DbSession, username: str, since: dt.datetime) -> int:
    rows = db.execute(
        select(LoginAttempt.at).where(
            LoginAttempt.username == username,
            LoginAttempt.success.is_(False),
            LoginAttempt.at >= since,
        )
    ).all()
    return len(rows)


def is_locked_out(db: DbSession, username: str) -> tuple[bool, int]:
    settings = get_settings()
    window_start = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=settings.login_lock_minutes)
    failures = failed_login_count(db, username, window_start)
    return failures >= settings.login_max_failures, failures


def record_login_attempt(db: DbSession, username: str, ip: str, *, success: bool) -> None:
    db.add(LoginAttempt(username=username, ip=ip, success=success))
    db.commit()
