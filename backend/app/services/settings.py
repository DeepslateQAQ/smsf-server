"""全局设置的读写（DB 为准，环境变量提供初始默认值）。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..models import Setting

_ALLOW_REGISTRATION = "allow_public_registration"
_DEVICE_LIMIT = "device_limit_per_user"
_RATE_LIMIT = "rate_limit_per_device_per_min"
_MAX_BODY = "max_body_bytes"
_MAX_CONTENT = "max_content_chars"


def defaults() -> dict[str, Any]:
    settings = get_settings()
    return {
        _ALLOW_REGISTRATION: False,
        _DEVICE_LIMIT: 10,
        _RATE_LIMIT: settings.rate_limit_per_device_per_min,
        _MAX_BODY: settings.max_body_bytes,
        _MAX_CONTENT: settings.max_content_chars,
    }


def load(db: DbSession) -> dict[str, Any]:
    values = defaults()
    for row in db.execute(select(Setting)).scalars():
        values[row.key] = row.value
    return values


def get(db: DbSession, key: str) -> Any:
    return load(db).get(key, defaults().get(key))


def update(db: DbSession, patch: dict[str, Any]) -> dict[str, Any]:
    for key, value in patch.items():
        if value is None:
            continue
        row = db.get(Setting, key)
        if row is None:
            db.add(Setting(key=key, value=value))
        else:
            row.value = value
    db.commit()
    return load(db)


def allow_public_registration(db: DbSession) -> bool:
    return bool(get(db, _ALLOW_REGISTRATION))


def device_limit_per_user(db: DbSession) -> int:
    return int(get(db, _DEVICE_LIMIT))


def rate_limit_per_device(db: DbSession) -> int:
    return int(get(db, _RATE_LIMIT))


def max_body_bytes(db: DbSession) -> int:
    return int(get(db, _MAX_BODY))


def max_content_chars(db: DbSession) -> int:
    return int(get(db, _MAX_CONTENT))
