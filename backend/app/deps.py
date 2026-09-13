"""认证与授权依赖。

授权铁律：**管理员不获得短信正文访问权**。
可见设备集合对所有人都是「自有 ∪ 被共享」，管理员的多余能力只体现在
admin 路由里的元数据操作（用户、设备、设置、审计），绝不进入内容查询路径。
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .config import get_settings
from .db import get_db
from .models import Device, DeviceShare, User
from .models import Session as SessionModel
from .security import hash_session_token

SESSION_COOKIE = get_settings().session_cookie_name


def client_ip(request: Request) -> str:
    settings = get_settings()
    if settings.trusted_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


def user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:255]


def _unauthorized(detail: str = "未登录") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def is_setup_required(db: DbSession) -> bool:
    return db.scalar(select(func.count(User.id))) == 0


def session_user(request: Request, db: DbSession) -> User | None:
    raw = request.cookies.get(SESSION_COOKIE)
    if not raw:
        return None
    row = db.execute(
        select(SessionModel).where(SessionModel.token_hash == hash_session_token(raw))
    ).scalar_one_or_none()
    if row is None:
        return None
    now = dt.datetime.now(dt.UTC)
    if row.expires_at <= now:
        db.delete(row)
        db.commit()
        return None
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        return None
    row.last_seen_at = now
    db.commit()
    return user


def current_user(request: Request, db: DbSession = Depends(get_db)) -> User:
    user = session_user(request, db)
    if user is None:
        raise _unauthorized()
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


# --------------------------------------------------------------------- 设备范围


def owned_device_ids(db: DbSession, user: User) -> set[int]:
    return set(db.execute(select(Device.id).where(Device.owner_id == user.id)).scalars())


def shared_device_ids(db: DbSession, user: User) -> set[int]:
    rows = db.execute(select(DeviceShare.device_id).where(DeviceShare.user_id == user.id)).scalars()
    return set(rows)


def visible_device_ids(db: DbSession, user: User) -> set[int]:
    return owned_device_ids(db, user) | shared_device_ids(db, user)


def users_with_access(db: DbSession, device_id: int) -> set[int]:
    """能收到该设备新消息事件的人：归属者 + 被共享者。"""
    device = db.get(Device, device_id)
    if device is None:
        return set()
    shared = db.execute(
        select(DeviceShare.user_id).where(DeviceShare.device_id == device_id)
    ).scalars()
    return {device.owner_id} | set(shared)


def resolve_device_scope(db: DbSession, user: User, requested: Sequence[int] | None) -> list[int]:
    """把请求中的设备筛选收敛到可见集合内。不可见的 id 被静默丢弃（不泄露存在性）。"""
    visible = visible_device_ids(db, user)
    if not requested:
        return sorted(visible)
    return sorted(visible.intersection(int(item) for item in requested))


def get_readable_device(db: DbSession, user: User, device_id: int) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="设备不存在")
    if device.owner_id != user.id and device.id not in shared_device_ids(db, user):
        # 对无权访问者不区分「不存在」与「无权限」
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="设备不存在")
    return device


def get_owned_device(db: DbSession, user: User, device_id: int) -> Device:
    device = db.get(Device, device_id)
    if device is None or device.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="设备不存在")
    return device


DbDep = Depends(get_db)
UserDep = Depends(current_user)
AdminDep = Depends(require_admin)
