"""安全模块测试：签名算法、会话 token、限速、登录锁定。

这些是安全关键路径，必须由独立的断言钉住，不能只靠路由层的间接覆盖。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from urllib.parse import quote, unquote_plus

import pytest
from app.config import get_settings
from app.security import (
    SlidingWindowLimiter,
    compute_signature,
    constant_time_equals,
    hash_password,
    hash_session_token,
    is_locked_out,
    needs_rehash,
    new_device_secret,
    new_session_token,
    parse_bearer,
    record_login_attempt,
    secret_fingerprint,
    sign_skew_ok,
    verify_password,
    verify_signature,
)
from sqlalchemy.orm import Session as DbSession


def _reference_signature(secret: str, timestamp_ms: int) -> str:
    """按 SmsForwarder 文档独立实现一遍，用于交叉验证。"""
    message = f"{timestamp_ms}\n{secret}".encode()
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def test_compute_signature_matches_reference() -> None:
    secret = "s3cr3t-value"
    timestamp = 1757300000000
    assert compute_signature(secret, timestamp) == _reference_signature(secret, timestamp)


def test_verify_signature_accepts_urlencoded_and_raw() -> None:
    secret = new_device_secret()
    timestamp = 1757300000000
    raw = compute_signature(secret, timestamp)
    assert verify_signature(secret, timestamp, quote(raw, safe="")) is True
    assert verify_signature(secret, timestamp, raw) is True


def test_verify_signature_rejects_wrong_secret_and_timestamp() -> None:
    secret = new_device_secret()
    timestamp = 1757300000000
    good = quote(compute_signature(secret, timestamp), safe="")
    assert verify_signature("other-secret", timestamp, good) is False
    assert verify_signature(secret, timestamp + 1, good) is False


def test_verify_signature_survives_plus_in_base64() -> None:
    """Base64 里出现 '+' 时，我们用的是 unquote 而不是 unquote_plus。

    unquote 对 '%2B' 与字面 '+' 都能还原出正确的 Base64；
    若换成 unquote_plus，字面 '+' 会被吃成空格并导致验签失败——这里把差异钉住。
    """
    secret = "find-me-a-plus"
    timestamp = 1757300000000
    for offset in range(0, 5000):
        candidate = timestamp + offset
        raw = compute_signature(secret, candidate)
        if "+" not in raw:
            continue
        encoded = quote(raw, safe="")
        assert "%2B" in encoded
        # App 正常路径：URLEncoder 把 '+' 编码成 %2B
        assert verify_signature(secret, candidate, encoded) is True
        # 字面 '+' 也必须通过（unquote 不动它）
        assert verify_signature(secret, candidate, raw) is True
        # 反证：错误解码方式（unquote_plus）会把 '+' 变成空格，Base64 被破坏
        corrupted = unquote_plus(raw)
        assert corrupted != raw
        assert verify_signature(secret, candidate, corrupted) is False
        return
    pytest.fail("未能在 5000 个时间戳内构造出含 '+' 的签名")


def test_sign_skew_window() -> None:
    import datetime as dt

    now = dt.datetime(2026, 9, 12, 12, 0, tzinfo=dt.UTC)
    now_ms = int(now.timestamp() * 1000)
    limit_hours = get_settings().sign_max_skew_hours
    assert sign_skew_ok(now_ms, now=now) is True
    assert sign_skew_ok(now_ms - (limit_hours - 1) * 3600 * 1000, now=now) is True
    assert sign_skew_ok(now_ms - (limit_hours + 1) * 3600 * 1000, now=now) is False


# --------------------------------------------------------------------- 密码与会话


def test_password_hash_roundtrip() -> None:
    digest = hash_password("correct horse battery")
    assert digest != "correct horse battery"
    assert verify_password(digest, "correct horse battery") is True
    assert verify_password(digest, "wrong") is False
    assert verify_password("not-a-hash", "whatever") is False
    assert needs_rehash(digest) is False


def test_session_token_hashing() -> None:
    raw = new_session_token()
    assert len(raw) >= 32
    assert hash_session_token(raw) == hash_session_token(raw)
    assert hash_session_token(raw) != hash_session_token(new_session_token())


def test_device_secret_and_fingerprint() -> None:
    secret = new_device_secret()
    assert secret_fingerprint(secret) == hashlib.sha256(secret.encode()).hexdigest()[:8]
    assert len(secret_fingerprint(secret)) == 8
    assert secret_fingerprint(secret) != secret_fingerprint(new_device_secret())


def test_constant_time_equals() -> None:
    assert constant_time_equals("abc", "abc") is True
    assert constant_time_equals("abc", "abd") is False
    assert constant_time_equals("", "") is True


def test_parse_bearer() -> None:
    assert parse_bearer("Bearer abc123") == "abc123"
    assert parse_bearer("bearer abc123") == "abc123"
    assert parse_bearer("BEARER   abc123  ") == "abc123"
    assert parse_bearer("Basic abc123") is None
    assert parse_bearer("Bearer ") is None
    assert parse_bearer(None) is None


# --------------------------------------------------------------------- 限速


def test_sliding_window_limiter_blocks_after_limit() -> None:
    limiter = SlidingWindowLimiter()
    assert [limiter.allow("k", 2, 60) for _ in range(3)] == [True, True, False]
    # 不同 key 互不影响
    assert limiter.allow("other", 2, 60) is True


def test_sliding_window_limiter_window_expiry() -> None:
    limiter = SlidingWindowLimiter()
    assert limiter.allow("k", 1, 0.05) is True
    assert limiter.allow("k", 1, 0.05) is False
    time.sleep(0.08)
    assert limiter.allow("k", 1, 0.05) is True


def test_sliding_window_reset() -> None:
    limiter = SlidingWindowLimiter()
    assert limiter.allow("k", 1, 60) is True
    assert limiter.allow("k", 1, 60) is False
    limiter.reset("k")
    assert limiter.allow("k", 1, 60) is True


# --------------------------------------------------------------------- 登录锁定


def test_lockout_after_max_failures(db: DbSession) -> None:
    settings = get_settings()
    username = "someone"
    assert is_locked_out(db, username) == (False, 0)
    for _ in range(settings.login_max_failures):
        record_login_attempt(db, username, "127.0.0.1", success=False)
    locked, failures = is_locked_out(db, username)
    assert locked is True
    assert failures == settings.login_max_failures


def test_successful_login_is_not_counted_as_failure(db: DbSession) -> None:
    settings = get_settings()
    username = "another"
    record_login_attempt(db, username, "127.0.0.1", success=True)
    assert is_locked_out(db, username) == (False, 0)
    for _ in range(settings.login_max_failures - 1):
        record_login_attempt(db, username, "127.0.0.1", success=False)
    assert is_locked_out(db, username)[0] is False


def test_old_failures_fall_out_of_window(db: DbSession) -> None:
    """超出锁定窗口的旧失败不应继续累计。"""
    import datetime as dt

    from app.models import LoginAttempt

    settings = get_settings()
    stale = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=settings.login_lock_minutes + 5)
    for _ in range(settings.login_max_failures + 3):
        db.add(LoginAttempt(username="old", ip="127.0.0.1", at=stale, success=False))
    db.commit()
    assert is_locked_out(db, "old") == (False, 0)
