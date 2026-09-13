"""API 层的共享序列化与查询辅助。

放在单独模块里，避免 auth / devices 各写一份 DeviceOut 组装逻辑（字段很多，容易漏）。

消息序列化的唯一实现是 ``services.search.serialize_messages``（MessageApi 维护，
含批量 device_map 以避免 N+1）；本模块的 ``message_out`` 只做单条委托，不再重复实现。
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..models import Device, DeviceShare, Message, User
from ..schemas import DeviceOut, MessageOut, ShareOut, UserOut
from ..services.search import serialize_messages


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role,  # type: ignore[arg-type]
        is_admin=user.is_admin,
        is_active=user.is_active,
        locale=user.locale,
        theme_seed=user.theme_seed,
        theme_mode=user.theme_mode,  # type: ignore[arg-type]
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        has_avatar=user.avatar is not None,
        avatar_updated_at=user.avatar_updated_at,
    )


def message_count(db: DbSession, device_id: int) -> int:
    return int(db.scalar(select(func.count(Message.id)).where(Message.device_id == device_id)) or 0)


def share_out(db: DbSession, share: DeviceShare) -> ShareOut:
    user = db.get(User, share.user_id)
    return ShareOut(
        user_id=share.user_id,
        username=user.username if user else "",
        display_name=user.display_name if user else "",
        created_at=share.created_at,
    )


def device_out(
    db: DbSession, device: Device, viewer: User, *, include_secret: bool = False
) -> DeviceOut:
    owner = db.get(User, device.owner_id)
    # 共享成员名单只对拥有者可见；被共享者看到自己的设备时 shares 固定为空。
    shares = (
        db.execute(select(DeviceShare).where(DeviceShare.device_id == device.id)).scalars().all()
        if device.owner_id == viewer.id
        else []
    )
    return DeviceOut(
        id=device.id,
        name=device.name,
        description=device.description,
        color=device.color,
        sim_label=device.sim_label,
        is_active=device.is_active,
        owner_id=device.owner_id,
        owner_name=owner.username if owner else "",
        is_owner=device.owner_id == viewer.id,
        created_at=device.created_at,
        last_ingest_at=device.last_ingest_at,
        secret_fingerprint=device.secret_fingerprint,
        device_mark=device.device_mark,
        last_auth_kind=device.last_auth_kind or "",
        message_count=message_count(db, device.id),
        shares=[share_out(db, share) for share in shares],
        secret=device.secret if include_secret else None,
    )


def message_out(db: DbSession, message: Message, viewer: User) -> MessageOut:
    """单条消息序列化：委托给 services.search.serialize_messages。

    viewer 仅为保持调用方签名，can_delete 语义由唯一序列化器决定
    （设备可见即可删，归属者与被共享者一致）。
    """
    device_map = {message.device_id: message.device} if message.device else {}
    return serialize_messages([message], device_map, now=dt.datetime.now(dt.UTC))[0]
