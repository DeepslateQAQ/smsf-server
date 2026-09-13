"""API 契约（Pydantic）。前后端共享的字段定义以此为准。"""

from __future__ import annotations

import datetime as dt
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Kind = Literal["sms", "notification", "call"]
Role = Literal["admin", "user"]
ThemeMode = Literal["light", "dark", "system"]


# --------------------------------------------------------------------- ingest


class IngestRequest(BaseModel):
    """SmsForwarder 请求体。占位符由 App 字符串替换，因此字段都可缺省。"""

    model_config = ConfigDict(extra="allow")

    sender: str = ""
    content: str = ""
    raw_content: str | None = None
    received_at: str | None = None
    sent_at: str | None = None
    sign: str | None = None
    device_mark: str | None = None
    sim: str | None = None
    kind: str = "sms"
    app_version: str | None = None

    @field_validator("kind")
    @classmethod
    def _normalize_kind(cls, value: str) -> str:
        value = (value or "sms").strip().lower()
        return value if value in ("sms", "notification", "call") else "sms"


class IngestResponse(BaseModel):
    ok: bool = True
    id: int
    duplicate: bool = False
    code: str | None = None
    received_at: dt.datetime
    time_source: str


# --------------------------------------------------------------------- auth


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class SetupRequest(LoginRequest):
    display_name: str = Field(default="", max_length=64)


class RegisterRequest(LoginRequest):
    display_name: str = Field(default="", max_length=64)


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: Role
    is_admin: bool
    is_active: bool
    locale: str
    theme_seed: str
    theme_mode: ThemeMode
    created_at: dt.datetime
    last_login_at: dt.datetime | None = None
    has_avatar: bool = False
    # 缓存失效指纹：头像更新时变化，前端拼进 avatar URL 的 query
    avatar_updated_at: dt.datetime | None = None


class PreferencesUpdate(BaseModel):
    locale: Literal["zh", "en"] | None = None
    theme_seed: str | None = Field(default=None, max_length=16)
    theme_mode: ThemeMode | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)


class SetupStatus(BaseModel):
    setup_required: bool
    allow_public_registration: bool


# --------------------------------------------------------------------- devices


class ShareOut(BaseModel):
    user_id: int
    username: str
    display_name: str
    created_at: dt.datetime


class DeviceOut(BaseModel):
    id: int
    name: str
    description: str
    color: str
    sim_label: str
    is_active: bool
    owner_id: int
    owner_name: str
    is_owner: bool
    created_at: dt.datetime
    last_ingest_at: dt.datetime | None
    secret_fingerprint: str
    device_mark: str
    last_auth_kind: str = ""
    message_count: int
    shares: list[ShareOut] = Field(default_factory=list)
    # 仅在创建与轮换的响应里返回，用于接入向导
    secret: str | None = None


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=255)
    color: str = Field(default="#0B57D0", max_length=16)
    sim_label: str = Field(default="", max_length=32)


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    color: str | None = Field(default=None, max_length=16)
    sim_label: str | None = Field(default=None, max_length=32)
    is_active: bool | None = None


class ShareCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class IngestCandidate(BaseModel):
    """接入向导用：一次真实推送的解析回显。"""

    message_id: int
    sender: str
    code: str | None
    received_at: dt.datetime
    time_source: str
    sign_ok: bool


# --------------------------------------------------------------------- messages


class CodeCandidateOut(BaseModel):
    code: str
    confidence: int


class MessageOut(BaseModel):
    id: int
    device_id: int
    device_name: str
    device_color: str
    kind: Kind
    sender: str
    content: str
    raw_content: str
    received_at: dt.datetime
    ingested_at: dt.datetime
    sent_at: dt.datetime | None
    time_source: str
    time_doubtful: bool
    sim_slot: str
    code: str | None
    code_confidence: int | None
    code_candidates: list[CodeCandidateOut]
    code_expires_at: dt.datetime | None
    code_expired: bool
    can_delete: bool
    raw_payload: dict[str, Any]


class MessagePage(BaseModel):
    items: list[MessageOut]
    next_cursor: str | None


class FacetItem(BaseModel):
    value: str
    label: str
    count: int


class FacetsOut(BaseModel):
    senders: list[FacetItem]
    devices: list[FacetItem]
    total: int


class PurgeRequest(BaseModel):
    before_days: int = Field(ge=1, le=3650)
    device_ids: list[int] | None = None


class PurgeResponse(BaseModel):
    deleted: int


class DeleteResponse(BaseModel):
    ok: bool = True


# --------------------------------------------------------------------- admin


class AdminUserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = Field(default="", max_length=64)
    password: str | None = Field(default=None, min_length=8, max_length=256)
    role: Role = "user"


class AdminUserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=64)
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)


class CreatedUserOut(BaseModel):
    user: UserOut
    initial_password: str | None = None


class AdminDeviceOut(DeviceOut):
    message_count: int
    shared_with_count: int


class SettingsOut(BaseModel):
    allow_public_registration: bool
    device_limit_per_user: int
    rate_limit_per_device_per_min: int
    max_body_bytes: int
    max_content_chars: int


class SettingsUpdate(BaseModel):
    allow_public_registration: bool | None = None
    device_limit_per_user: int | None = Field(default=None, ge=0, le=1000)
    rate_limit_per_device_per_min: int | None = Field(default=None, ge=1, le=100000)
    max_body_bytes: int | None = Field(default=None, ge=1024, le=10 * 1024 * 1024)
    max_content_chars: int | None = Field(default=None, ge=64, le=10 * 1024 * 1024)


class AuditOut(BaseModel):
    id: int
    at: dt.datetime
    actor_user_id: int | None
    actor_name: str | None
    actor_kind: str
    action: str
    target_type: str
    target_id: str
    ip: str
    success: bool
    detail: dict[str, Any]


class AuditPage(BaseModel):
    items: list[AuditOut]
    next_cursor: str | None


class StatsOut(BaseModel):
    users: int
    devices: int
    messages: int
    messages_24h: int
    codes_24h: int
    db_bytes: int
    last_ingest_at: dt.datetime | None


class LoginAttemptOut(BaseModel):
    at: dt.datetime
    username: str
    ip: str
    success: bool


class LockoutOut(BaseModel):
    username: str
    locked: bool
    failed_count: int
