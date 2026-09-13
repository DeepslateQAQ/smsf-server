"""管理员路由（契约 §7）：用户 / 设备元数据 / 设置 / 审计 / 统计 / 锁定。

授权铁律：管理员不获得短信正文访问权。本模块只做元数据操作，响应里绝不出现
消息正文或设备 secret 明文（只给 secret_fingerprint）。
"""

from __future__ import annotations

import datetime as dt
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..deps import AdminDep, get_db
from ..models import (
    ROLE_ADMIN,
    ROLE_USER,
    AuditLog,
    Device,
    DeviceShare,
    LoginAttempt,
    Message,
    User,
)
from ..models import (
    Session as SessionModel,
)
from ..schemas import (
    AdminDeviceOut,
    AdminUserCreate,
    AdminUserUpdate,
    AuditOut,
    AuditPage,
    CreatedUserOut,
    DeleteResponse,
    DeviceUpdate,
    LockoutOut,
    LoginAttemptOut,
    SettingsOut,
    SettingsUpdate,
    StatsOut,
    UserOut,
)
from ..security import hash_password, is_locked_out
from ..services import audit
from ..services import settings as settings_service
from ..services.search import DEFAULT_LIMIT, decode_cursor, encode_cursor
from . import _common

router = APIRouter(prefix="/api/admin", tags=["admin"])

# 审计 / 登录记录分页上限沿用消息检索的约定
MAX_LIMIT = 200


# --------------------------------------------------------------------- 工具


def _active_admin_count(db: DbSession, *, exclude_id: int | None = None) -> int:
    stmt = select(func.count(User.id)).where(User.role == ROLE_ADMIN, User.is_active.is_(True))
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    return int(db.scalar(stmt) or 0)


def _sqlite_size() -> int:
    """数据库文件字节数；解析失败或文件不存在时返回 0。"""
    url = get_settings().database_url
    prefix = "sqlite+pysqlite:///"
    if not url.startswith(prefix):
        return 0
    raw = url[len(prefix) :]
    if not raw or ":memory:" in raw:
        return 0
    try:
        return Path(raw).stat().st_size
    except OSError:
        return 0


def _require_last_admin_guard(db: DbSession, user: User) -> None:
    """保护最后一个可用管理员：停用 / 降级 / 删除都不允许。"""
    if user.role != ROLE_ADMIN or not user.is_active:
        return
    if _active_admin_count(db, exclude_id=user.id) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能停用、降级或删除最后一个可用管理员",
        )


# --------------------------------------------------------------------- 用户


@router.get("/users", response_model=list[UserOut])
def list_users(db: DbSession = Depends(get_db), _admin: User = AdminDep) -> list[UserOut]:
    users = db.execute(select(User).order_by(User.id)).scalars().all()
    return [_common.user_out(user) for user in users]


@router.post("/users", response_model=CreatedUserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AdminUserCreate,
    db: DbSession = Depends(get_db),
    admin: User = AdminDep,
) -> CreatedUserOut:
    exists = db.execute(select(User).where(User.username == payload.username)).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已被占用")

    initial_password: str | None = None
    if payload.password:
        password = payload.password
    else:
        initial_password = secrets.token_urlsafe(9)
        password = initial_password

    user = User(
        username=payload.username,
        display_name=payload.display_name or payload.username,
        password_hash=hash_password(password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    audit.log(
        db,
        action="admin.user_create",
        actor_kind="user",
        actor_user_id=admin.id,
        target_type="user",
        target_id=user.id,
        detail={"username": user.username, "role": user.role},
    )
    return CreatedUserOut(user=_common.user_out(user), initial_password=initial_password)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    db: DbSession = Depends(get_db),
    admin: User = AdminDep,
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    data = payload.model_dump(exclude_unset=True)
    demoting = (data.get("role") == ROLE_USER) or (data.get("is_active") is False)
    if demoting:
        _require_last_admin_guard(db, user)

    if data.get("display_name") is not None:
        user.display_name = data["display_name"]
    if data.get("role") is not None:
        user.role = data["role"]
    if data.get("is_active") is not None:
        user.is_active = data["is_active"]
    if data.get("password"):
        user.password_hash = hash_password(data["password"])
        db.execute(delete(SessionModel).where(SessionModel.user_id == user.id))
    db.commit()
    db.refresh(user)

    audit.log(
        db,
        action="admin.user_update",
        actor_kind="user",
        actor_user_id=admin.id,
        target_type="user",
        target_id=user.id,
        detail={"fields": sorted(data.keys())},
    )
    return _common.user_out(user)


@router.post("/users/{user_id}/reset-password", response_model=CreatedUserOut)
def reset_user_password(
    user_id: int,
    db: DbSession = Depends(get_db),
    admin: User = AdminDep,
) -> CreatedUserOut:
    """重置某用户密码，返回一次性初始密码（管理员转交本人）。

    与建号一致：密码只回显这一次，同时吊销该用户已有的全部会话，
    避免旧会话在被重置后仍然有效。
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    initial_password = secrets.token_urlsafe(9)
    user.password_hash = hash_password(initial_password)
    db.execute(delete(SessionModel).where(SessionModel.user_id == user.id))
    db.commit()
    db.refresh(user)

    audit.log(
        db,
        action="admin.user_reset_password",
        actor_kind="user",
        actor_user_id=admin.id,
        target_type="user",
        target_id=user.id,
        detail={"username": user.username},
    )
    return CreatedUserOut(user=_common.user_out(user), initial_password=initial_password)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: DbSession = Depends(get_db),
    admin: User = AdminDep,
) -> dict[str, bool]:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能删除自己")
    _require_last_admin_guard(db, user)

    username = user.username
    device_ids = list(db.execute(select(Device.id).where(Device.owner_id == user.id)).scalars())
    if device_ids:
        db.execute(delete(Message).where(Message.device_id.in_(device_ids)))
        db.execute(delete(DeviceShare).where(DeviceShare.device_id.in_(device_ids)))
        db.execute(delete(Device).where(Device.id.in_(device_ids)))
    db.execute(delete(DeviceShare).where(DeviceShare.user_id == user.id))
    db.execute(delete(SessionModel).where(SessionModel.user_id == user.id))
    db.execute(delete(LoginAttempt).where(LoginAttempt.username == username))
    db.delete(user)
    db.commit()

    audit.log(
        db,
        action="admin.user_delete",
        actor_kind="user",
        actor_user_id=admin.id,
        target_type="user",
        target_id=user_id,
        detail={"username": username, "devices": len(device_ids)},
    )
    return {"ok": True}


# --------------------------------------------------------------------- 设备


def _admin_device_out(
    db: DbSession,
    device: Device,
    admin: User,
    *,
    message_count: int | None = None,
    shared_with_count: int | None = None,
) -> AdminDeviceOut:
    """AdminDeviceOut 统一组装；列表调用方传入批量统计以避免 N+1。"""
    base = _common.device_out(db, device, admin)
    data = base.model_dump()
    if message_count is None:
        message_count = int(
            db.scalar(select(func.count(Message.id)).where(Message.device_id == device.id)) or 0
        )
    if shared_with_count is None:
        shared_with_count = int(
            db.scalar(
                select(func.count(DeviceShare.user_id)).where(DeviceShare.device_id == device.id)
            )
            or 0
        )
    data["message_count"] = int(message_count)
    data["shared_with_count"] = int(shared_with_count)
    return AdminDeviceOut(**data)


@router.get("/devices", response_model=list[AdminDeviceOut])
def list_devices(db: DbSession = Depends(get_db), admin: User = AdminDep) -> list[AdminDeviceOut]:
    devices = db.execute(select(Device).order_by(Device.id)).scalars().all()
    message_counts: dict[int, int] = {}
    for device_id, count in db.execute(
        select(Message.device_id, func.count(Message.id)).group_by(Message.device_id)
    ).all():
        message_counts[device_id] = int(count)
    share_counts: dict[int, int] = {}
    for device_id, count in db.execute(
        select(DeviceShare.device_id, func.count(DeviceShare.user_id)).group_by(
            DeviceShare.device_id
        )
    ).all():
        share_counts[device_id] = int(count)
    return [
        _admin_device_out(
            db,
            device,
            admin,
            message_count=message_counts.get(device.id, 0),
            shared_with_count=share_counts.get(device.id, 0),
        )
        for device in devices
    ]


@router.patch("/devices/{device_id}", response_model=AdminDeviceOut)
def update_device(
    device_id: int,
    payload: DeviceUpdate,
    db: DbSession = Depends(get_db),
    admin: User = AdminDep,
) -> AdminDeviceOut:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="设备不存在")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if value is not None:
            setattr(device, field, value)
    db.commit()
    db.refresh(device)

    audit.log(
        db,
        action="admin.device_update",
        actor_kind="user",
        actor_user_id=admin.id,
        target_type="device",
        target_id=device.id,
        detail={"fields": sorted(data.keys()), "is_active": device.is_active},
    )
    return _admin_device_out(db, device, admin)


@router.delete("/devices/{device_id}", response_model=DeleteResponse)
def delete_device(
    device_id: int,
    db: DbSession = Depends(get_db),
    admin: User = AdminDep,
) -> DeleteResponse:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="设备不存在")

    device_name = device.name
    db.execute(delete(Message).where(Message.device_id == device_id))
    db.execute(delete(DeviceShare).where(DeviceShare.device_id == device_id))
    db.delete(device)
    db.commit()

    audit.log(
        db,
        action="admin.device_delete",
        actor_kind="user",
        actor_user_id=admin.id,
        target_type="device",
        target_id=device_id,
        detail={"name": device_name},
    )
    return DeleteResponse(ok=True)


# --------------------------------------------------------------------- 设置


@router.get("/settings", response_model=SettingsOut)
def get_settings_view(db: DbSession = Depends(get_db), _admin: User = AdminDep) -> SettingsOut:
    return SettingsOut(**settings_service.load(db))


@router.patch("/settings", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdate,
    db: DbSession = Depends(get_db),
    admin: User = AdminDep,
) -> SettingsOut:
    updated = settings_service.update(db, payload.model_dump(exclude_unset=True))
    audit.log(
        db,
        action="admin.settings_update",
        actor_kind="user",
        actor_user_id=admin.id,
        target_type="settings",
        detail={"fields": sorted(payload.model_dump(exclude_unset=True).keys())},
    )
    return SettingsOut(**updated)


# --------------------------------------------------------------------- 审计


def _audit_out(row: AuditLog, names: dict[int, str]) -> AuditOut:
    return AuditOut(
        id=row.id,
        at=row.at,
        actor_user_id=row.actor_user_id,
        actor_name=names.get(row.actor_user_id) if row.actor_user_id else None,
        actor_kind=row.actor_kind,
        action=row.action,
        target_type=row.target_type,
        target_id=row.target_id,
        ip=row.ip,
        success=row.success,
        detail=row.detail or {},
    )


@router.get("/audit", response_model=AuditPage)
def list_audit(
    action: str | None = Query(default=None),
    success: bool | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    db: DbSession = Depends(get_db),
    _admin: User = AdminDep,
) -> AuditPage:
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if success is not None:
        stmt = stmt.where(AuditLog.success.is_(success))
    if cursor:
        try:
            moment, last_id = decode_cursor(cursor)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="游标无效") from exc
        stmt = stmt.where(
            (AuditLog.at < moment) | ((AuditLog.at == moment) & (AuditLog.id < last_id))
        )
    rows = (
        db.execute(stmt.order_by(AuditLog.at.desc(), AuditLog.id.desc()).limit(limit + 1))
        .scalars()
        .all()
    )
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1].at, page[-1].id) if len(rows) > limit and page else None

    actor_ids = {row.actor_user_id for row in page if row.actor_user_id}
    names: dict[int, str] = {}
    if actor_ids:
        names = {
            user.id: user.username
            for user in db.execute(select(User).where(User.id.in_(actor_ids))).scalars()
        }
    return AuditPage(items=[_audit_out(row, names) for row in page], next_cursor=next_cursor)


# --------------------------------------------------------------------- 统计


@router.get("/stats", response_model=StatsOut)
def stats(db: DbSession = Depends(get_db), _admin: User = AdminDep) -> StatsOut:
    now = dt.datetime.now(dt.UTC)
    day_ago = now - dt.timedelta(hours=24)

    users = int(db.scalar(select(func.count(User.id))) or 0)
    devices = int(db.scalar(select(func.count(Device.id))) or 0)
    messages = int(db.scalar(select(func.count(Message.id))) or 0)
    messages_24h = int(
        db.scalar(select(func.count(Message.id)).where(Message.received_at >= day_ago)) or 0
    )
    codes_24h = int(
        db.scalar(
            select(func.count(Message.id)).where(
                Message.received_at >= day_ago, Message.code.is_not(None)
            )
        )
        or 0
    )
    last_ingest_at = db.scalar(select(func.max(Device.last_ingest_at)))
    return StatsOut(
        users=users,
        devices=devices,
        messages=messages,
        messages_24h=messages_24h,
        codes_24h=codes_24h,
        db_bytes=_sqlite_size(),
        last_ingest_at=last_ingest_at,
    )


# --------------------------------------------------------------------- 登录锁定


@router.get("/login-attempts", response_model=list[LoginAttemptOut])
def list_login_attempts(
    username: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=MAX_LIMIT),
    db: DbSession = Depends(get_db),
    _admin: User = AdminDep,
) -> list[LoginAttemptOut]:
    stmt = select(LoginAttempt)
    if username:
        stmt = stmt.where(LoginAttempt.username == username)
    rows = (
        db.execute(stmt.order_by(LoginAttempt.at.desc(), LoginAttempt.id.desc()).limit(limit))
        .scalars()
        .all()
    )
    return [
        LoginAttemptOut(at=row.at, username=row.username, ip=row.ip, success=row.success)
        for row in rows
    ]


@router.get("/lockouts", response_model=list[LockoutOut])
def list_lockouts(db: DbSession = Depends(get_db), _admin: User = AdminDep) -> list[LockoutOut]:
    result: list[LockoutOut] = []
    for user in db.execute(select(User).where(User.is_active.is_(True))).scalars():
        locked, failed = is_locked_out(db, user.username)
        if locked:
            result.append(LockoutOut(username=user.username, locked=True, failed_count=failed))
    return result


@router.post("/lockouts/{username}/clear")
def clear_lockout(
    username: str,
    db: DbSession = Depends(get_db),
    admin: User = AdminDep,
) -> dict[str, bool]:
    db.execute(
        delete(LoginAttempt).where(
            LoginAttempt.username == username, LoginAttempt.success.is_(False)
        )
    )
    db.commit()
    audit.log(
        db,
        action="admin.lockout_clear",
        actor_kind="user",
        actor_user_id=admin.id,
        target_type="user",
        target_id=username,
    )
    return {"ok": True}
