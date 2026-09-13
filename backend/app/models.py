"""数据模型。所有时间列为 UTC。"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, UTCDateTime

ROLE_ADMIN = "admin"
ROLE_USER = "user"

KIND_SMS = "sms"
KIND_NOTIFICATION = "notification"
KIND_CALL = "call"

# 消息时间的来源：设备上报 / App 发送时刻 / 服务端入库时刻（仅为兜底，不参与幂等键的常规路径）
TIME_SOURCE_DEVICE = "device"
TIME_SOURCE_SENT = "sent_at"
TIME_SOURCE_INGEST = "ingest"


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(64), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default=ROLE_USER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    locale: Mapped[str] = mapped_column(String(8), default="zh")
    theme_seed: Mapped[str] = mapped_column(String(16), default="#0B57D0")
    theme_mode: Mapped[str] = mapped_column(String(8), default="system")
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_login_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # 头像：服务端「重新编码 + 居中裁方」后的 WebP 字节，安全不可执行；未设置时为 NULL
    avatar: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    avatar_content_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    avatar_updated_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, nullable=True)

    devices: Mapped[list[Device]] = relationship(back_populates="owner")

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_seen_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(UTCDateTime)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")

    user: Mapped[User] = relationship()


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), index=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    success: Mapped[bool] = mapped_column(Boolean, default=False)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(255), default="")
    # secret 明文存储：HMAC 校验需要密钥本身（见方案 §8 的取舍说明）
    secret: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    secret_fingerprint: Mapped[str] = mapped_column(String(16))
    # 公开的设备标识（key id）：填进 SmsForwarder 的「设备备注」，用于定位设备后再验签。
    # 它不是秘密，泄露无碍；秘密始终是 secret。
    device_mark: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    last_auth_kind: Mapped[str] = mapped_column(String(16), default="")
    color: Mapped[str] = mapped_column(String(16), default="#0B57D0")
    sim_label: Mapped[str] = mapped_column(String(32), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_ingest_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)

    owner: Mapped[User] = relationship(back_populates="devices")
    shares: Mapped[list[DeviceShare]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )


class DeviceShare(Base):
    __tablename__ = "device_shares"

    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    granted_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (PrimaryKeyConstraint("device_id", "user_id"),)

    device: Mapped[Device] = relationship(back_populates="shares")
    user: Mapped[User] = relationship(foreign_keys=[user_id])


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default=KIND_SMS)
    sender: Mapped[str] = mapped_column(String(128), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    raw_content: Mapped[str] = mapped_column(Text, default="")

    # received_at 是对外展示与排序的主时间；ingested_at 只做审计与兜底
    received_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, index=True)
    ingested_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    sent_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, nullable=True)
    time_source: Mapped[str] = mapped_column(String(16), default=TIME_SOURCE_SENT)

    sign_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    sim_slot: Mapped[str] = mapped_column(String(64), default="")

    code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    code_confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    code_candidates: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    code_expires_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # 幂等键：sha256(sender|content|稳定时间)，稳定时间见 services/ingest.py 的 compute_dup_key
    dup_key: Mapped[str] = mapped_column(String(64))
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    __table_args__ = (
        UniqueConstraint("device_id", "dup_key", name="uq_messages_device_dup"),
        Index("ix_messages_received_id", "received_at", "id"),
        Index("ix_messages_device_received_id", "device_id", "received_at", "id"),
    )

    device: Mapped[Device] = relationship()


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_kind: Mapped[str] = mapped_column(String(16), default="system")
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str] = mapped_column(String(32), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
