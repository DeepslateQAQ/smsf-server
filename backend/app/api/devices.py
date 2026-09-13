"""设备管理 API（契约 §4）。

权限模型
--------
- 读取端点（列表 / 详情）走 :func:`deps.get_readable_device`，
  可见集合是「自有 ∪ 被共享」。
- 写入端点（改名、删除、轮换 secret、管理共享、接入向导自检）走
  :func:`deps.get_owned_device`，对非归属者一律 404（不区分「不存在」与
  「无权限」，避免探测设备存在性）。

secret 泄漏面
-------------
明文 ``secret`` 只在「创建」与「轮换」两个响应里返回（接入向导要用一次）；
其余端点（含列表、详情）的 ``DeviceOut.secret`` 恒为 ``None``，客户端只能拿到
``secret_fingerprint`` / ``device_mark`` 做展示。

统计
----
列表端点的 ``message_count`` 用一条 ``GROUP BY device_id`` 聚合查询得出，
``shares`` 也用一条 join 批量取回，避免按设备逐条 COUNT 的 N+1；
``shares`` 只对归属者填充，被共享者看到的一律是空列表。
单设备响应的序列化统一复用 :mod:`app.api._common`。
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from .. import security
from ..db import get_db
from ..deps import current_user, get_owned_device, get_readable_device, visible_device_ids
from ..models import Device, DeviceShare, Message, User
from ..schemas import (
    DeleteResponse,
    DeviceCreate,
    DeviceOut,
    DeviceUpdate,
    ShareCreate,
    ShareOut,
)
from ..services import audit
from ..services import settings as settings_service
from . import _common

router = APIRouter(prefix="/api/devices", tags=["devices"])

# 公开的设备标识（填进 SmsForwarder 的「设备备注」），不是秘密。
_DEVICE_MARK_PREFIX = "smsf-"


# --------------------------------------------------------------------- 批量序列化


def _load_shares(db: DbSession, device_ids: list[int]) -> dict[int, list[ShareOut]]:
    """一次 join 取回若干设备的共享列表，按设备分组（避免 N+1）。"""
    grouped: dict[int, list[ShareOut]] = {}
    if not device_ids:
        return grouped
    rows = db.execute(
        select(DeviceShare, User)
        .join(User, User.id == DeviceShare.user_id)
        .where(DeviceShare.device_id.in_(device_ids))
        .order_by(DeviceShare.created_at, DeviceShare.user_id)
    ).all()
    for share, share_user in rows:
        grouped.setdefault(share.device_id, []).append(
            ShareOut(
                user_id=share_user.id,
                username=share_user.username,
                display_name=share_user.display_name,
                created_at=share.created_at,
            )
        )
    return grouped


def _message_counts(db: DbSession, device_ids: list[int]) -> dict[int, int]:
    """一条 ``SELECT device_id, COUNT(*) ... GROUP BY device_id`` 聚合。"""
    if not device_ids:
        return {}
    rows = db.execute(
        select(Message.device_id, func.count(Message.id))
        .where(Message.device_id.in_(device_ids))
        .group_by(Message.device_id)
    ).all()
    counts: dict[int, int] = {}
    for device_id, count in rows:
        counts[device_id] = count
    return counts


def _owner_names(db: DbSession, owner_ids: set[int]) -> dict[int, str]:
    if not owner_ids:
        return {}
    rows = db.execute(select(User.id, User.username).where(User.id.in_(owner_ids))).all()
    names: dict[int, str] = {}
    for user_id, username in rows:
        names[user_id] = username
    return names


def _device_out(
    device: Device,
    *,
    viewer: User,
    owner_name: str,
    message_count: int,
    shares: list[ShareOut],
) -> DeviceOut:
    """列表端点的批量序列化，secret 恒为 None。"""
    return DeviceOut(
        id=device.id,
        name=device.name,
        description=device.description,
        color=device.color,
        sim_label=device.sim_label,
        is_active=device.is_active,
        owner_id=device.owner_id,
        owner_name=owner_name,
        is_owner=device.owner_id == viewer.id,
        created_at=device.created_at,
        last_ingest_at=device.last_ingest_at,
        secret_fingerprint=device.secret_fingerprint,
        device_mark=device.device_mark,
        last_auth_kind=device.last_auth_kind,
        message_count=message_count,
        shares=shares,
        secret=None,
    )


# --------------------------------------------------------------------- 设备


@router.get("", response_model=list[DeviceOut])
def list_devices(
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[DeviceOut]:
    """自有 ∪ 被共享。自有排在前，其后按 created_at 升序。"""
    visible = visible_device_ids(db, user)
    if not visible:
        return []

    devices = list(db.execute(select(Device).where(Device.id.in_(visible))).scalars())
    devices.sort(key=lambda item: (item.owner_id != user.id, item.created_at, item.id))

    device_ids = [item.id for item in devices]
    owned_ids = [item.id for item in devices if item.owner_id == user.id]
    counts = _message_counts(db, device_ids)
    owner_names = _owner_names(db, {item.owner_id for item in devices})
    shares = _load_shares(db, owned_ids) if owned_ids else {}

    return [
        _device_out(
            item,
            viewer=user,
            owner_name=owner_names.get(item.owner_id, ""),
            message_count=counts.get(item.id, 0),
            shares=shares.get(item.id, []) if item.owner_id == user.id else [],
        )
        for item in devices
    ]


@router.post("", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def create_device(
    payload: DeviceCreate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> DeviceOut:
    """创建设备，响应里一次性返回明文 secret。"""
    limit = settings_service.device_limit_per_user(db)
    if limit > 0:
        owned = db.scalar(select(func.count(Device.id)).where(Device.owner_id == user.id)) or 0
        if owned >= limit:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"设备数量已达上限（{limit}）",
            )

    secret = security.new_device_secret()
    device = Device(
        owner_id=user.id,
        name=payload.name,
        description=payload.description,
        color=payload.color,
        sim_label=payload.sim_label,
        secret=secret,
        secret_fingerprint=security.secret_fingerprint(secret),
        device_mark=_DEVICE_MARK_PREFIX + secrets.token_urlsafe(9),
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    audit.log(
        db,
        action="device.create",
        actor_kind="user",
        actor_user_id=user.id,
        target_type="device",
        target_id=device.id,
        detail={"name": device.name},
    )
    return _common.device_out(db, device, user, include_secret=True)


@router.get("/{device_id}", response_model=DeviceOut)
def get_device(
    device_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> DeviceOut:
    """归属者与被共享者都可读；响应里不含 secret。"""
    device = get_readable_device(db, user, device_id)
    return _common.device_out(db, device, user)


@router.patch("/{device_id}", response_model=DeviceOut)
def update_device(
    device_id: int,
    payload: DeviceUpdate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> DeviceOut:
    """仅归属者可改。``is_active`` 也能在这里切换。"""
    device = get_owned_device(db, user, device_id)
    changes = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if value is not None
    }
    for key, value in changes.items():
        setattr(device, key, value)
    db.commit()
    db.refresh(device)

    audit.log(
        db,
        action="device.update",
        actor_kind="user",
        actor_user_id=user.id,
        target_type="device",
        target_id=device.id,
        detail={"fields": sorted(changes)},
    )
    return _common.device_out(db, device, user)


@router.delete("/{device_id}", response_model=DeleteResponse)
def delete_device(
    device_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> DeleteResponse:
    """仅归属者可删；显式级联删消息与共享，不依赖 SQLite 的 foreign_keys PRAGMA。"""
    device = get_owned_device(db, user, device_id)
    device_name = device.name
    message_count = (
        db.scalar(select(func.count(Message.id)).where(Message.device_id == device.id)) or 0
    )

    db.execute(delete(Message).where(Message.device_id == device.id))
    db.execute(delete(DeviceShare).where(DeviceShare.device_id == device.id))
    db.delete(device)
    db.commit()

    audit.log(
        db,
        action="device.delete",
        actor_kind="user",
        actor_user_id=user.id,
        target_type="device",
        target_id=device_id,
        # 审计只记设备名与消息数，绝不带正文。
        detail={"name": device_name, "message_count": message_count},
    )
    return DeleteResponse()


def _rotate_secret(db: DbSession, user: User, device_id: int) -> DeviceOut:
    device = get_owned_device(db, user, device_id)
    secret = security.new_device_secret()
    device.secret = secret
    device.secret_fingerprint = security.secret_fingerprint(secret)
    db.commit()
    db.refresh(device)

    audit.log(
        db,
        action="device.rotate_secret",
        actor_kind="user",
        actor_user_id=user.id,
        target_type="device",
        target_id=device.id,
        detail={"name": device.name},
    )
    return _common.device_out(db, device, user, include_secret=True)


@router.post("/{device_id}/secret", response_model=DeviceOut)
def rotate_secret(
    device_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> DeviceOut:
    """轮换 secret：旧 secret 立即失效，新明文只在本次响应里返回。"""
    return _rotate_secret(db, user, device_id)


# --------------------------------------------------------------------- 共享


@router.get("/{device_id}/shares", response_model=list[ShareOut])
def list_shares(
    device_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[ShareOut]:
    """共享名单仅归属者可读（被共享者的 DeviceOut.shares 也恒为空）。"""
    device = get_owned_device(db, user, device_id)
    return _load_shares(db, [device.id]).get(device.id, [])


@router.post(
    "/{device_id}/shares",
    response_model=ShareOut,
    status_code=status.HTTP_201_CREATED,
)
def add_share(
    device_id: int,
    payload: ShareCreate,
    response: Response,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ShareOut:
    """把设备共享给某个用户。重复共享幂等：200 + 已有共享记录。"""
    device = get_owned_device(db, user, device_id)

    target = db.execute(select(User).where(User.username == payload.username)).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if target.id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能共享给自己")
    if target.id == device.owner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="设备归属者无需共享")

    share = db.get(DeviceShare, (device.id, target.id))
    if share is not None:
        response.status_code = status.HTTP_200_OK
    else:
        share = DeviceShare(device_id=device.id, user_id=target.id, granted_by=user.id)
        db.add(share)
        db.commit()
        db.refresh(share)
        audit.log(
            db,
            action="device.share_add",
            actor_kind="user",
            actor_user_id=user.id,
            target_type="device",
            target_id=device.id,
            detail={"username": target.username, "user_id": target.id},
        )
    return _common.share_out(db, share)


@router.delete("/{device_id}/shares/{user_id}", response_model=DeleteResponse)
def remove_share(
    device_id: int,
    user_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> DeleteResponse:
    """解除共享（仅归属者），并写审计。"""
    device = get_owned_device(db, user, device_id)
    share = db.get(DeviceShare, (device.id, user_id))
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="共享记录不存在")

    target = db.get(User, user_id)
    db.delete(share)
    db.commit()

    audit.log(
        db,
        action="device.share_remove",
        actor_kind="user",
        actor_user_id=user.id,
        target_type="device",
        target_id=device.id,
        detail={"username": target.username if target else "", "user_id": user_id},
    )
    return DeleteResponse()
