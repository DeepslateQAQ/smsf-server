"""认证路由（契约 §2）。

提供 8 个端点：初始化、公开注册、登录、登出、当前用户、偏好、改密、初始化状态。

约定：
- 会话 Cookie 只携带随机原始 token；数据库 `sessions.token_hash` 只存 SHA-256。
- 登录失败按 `login_attempts` 计数，达到上限后 429 并返回 `Retry-After`。
- 建号 / 登录 / 登出 / 改密都会写审计，且不带任何敏感信息（密码永不进入审计）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from .. import deps, security
from ..config import get_settings
from ..db import get_db
from ..models import ROLE_ADMIN, ROLE_USER, User, utcnow
from ..models import Session as SessionModel
from ..schemas import (
    LoginRequest,
    PasswordChange,
    PreferencesUpdate,
    RegisterRequest,
    SetupRequest,
    SetupStatus,
    UserOut,
)
from ..services import audit
from ..services import avatar as avatar_service
from ..services import settings as app_settings
from . import _common

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 用户不存在与密码错误必须返回完全相同的提示，避免被用来枚举用户。
INVALID_CREDENTIALS = "用户名或密码错误"

# 预计算的 Argon2id 假哈希（参数与 hash_password 一致）：用户不存在时也校验它，
# 使两种情况耗时一致，无法通过计时区分「用户不存在」与「密码错误」。
_DUMMY_PASSWORD_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=4$"
    "Ni+sUA1ufeK7EstlJJrBWg$nUcuVjYkeMIR0wae+pjlCnjoOUJfPZnhOY8dL/cat8I"
)


class OkResponse(BaseModel):
    ok: bool = True


def _user_out(user: User) -> UserOut:
    """统一的用户序列化函数（实现收敛在 `_common.user_out`，避免两处漂移）。"""
    return _common.user_out(user)


def _set_session_cookie(response: Response, raw: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.session_ttl_days * 86400,
        path="/",
    )


def _issue_session(db: DbSession, request: Request, response: Response, user: User) -> str:
    """新建会话行并下发 Cookie；返回原始 token（仅用于测试/调用方核对）。"""
    raw = security.new_session_token()
    db.add(
        SessionModel(
            user_id=user.id,
            token_hash=security.hash_session_token(raw),
            expires_at=security.session_expiry(),
            ip=deps.client_ip(request),
            user_agent=deps.user_agent(request),
        )
    )
    db.commit()
    _set_session_cookie(response, raw)
    return raw


def _find_user(db: DbSession, username: str) -> User | None:
    return db.execute(select(User).where(User.username == username)).scalar_one_or_none()


def _audit(
    db: DbSession,
    request: Request,
    action: str,
    *,
    actor_user_id: int | None = None,
    target_id: str | int | None = None,
    success: bool = True,
    detail: dict | None = None,
) -> None:
    """认证审计的统一入口：必带 ip 与 user_agent。"""
    audit.log(
        db,
        action=action,
        actor_kind="user" if actor_user_id is not None else "system",
        actor_user_id=actor_user_id,
        target_type="user",
        target_id=target_id if target_id is not None else actor_user_id,
        ip=deps.client_ip(request),
        user_agent=deps.user_agent(request),
        success=success,
        detail=detail or {},
    )


# --------------------------------------------------------------------- 初始化 / 注册


@router.get("/setup-status", response_model=SetupStatus)
def setup_status(db: DbSession = Depends(get_db)) -> SetupStatus:
    """公开接口：前端据此决定展示初始化向导还是登录页。"""
    return SetupStatus(
        setup_required=deps.is_setup_required(db),
        allow_public_registration=app_settings.allow_public_registration(db),
    )


@router.post("/setup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def setup(
    payload: SetupRequest,
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
) -> UserOut:
    """首次初始化：仅在系统还没有任何用户时可用，创建管理员并直接登录。"""
    if not deps.is_setup_required(db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="系统已完成初始化")
    user = User(
        username=payload.username,
        display_name=payload.display_name,
        password_hash=security.hash_password(payload.password),
        role=ROLE_ADMIN,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _issue_session(db, request, response, user)
    _audit(db, request, "auth.setup", actor_user_id=user.id, detail={"username": user.username})
    return _user_out(user)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
) -> UserOut:
    """公开注册：仅在管理员开启 allow_public_registration 时可用。"""
    if not app_settings.allow_public_registration(db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="未开放公开注册")
    if _find_user(db, payload.username) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")
    user = User(
        username=payload.username,
        display_name=payload.display_name,
        password_hash=security.hash_password(payload.password),
        role=ROLE_USER,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _issue_session(db, request, response, user)
    _audit(db, request, "auth.register", actor_user_id=user.id, detail={"username": user.username})
    return _user_out(user)


# --------------------------------------------------------------------- 登录 / 登出


@router.post("/login", response_model=UserOut)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
) -> UserOut:
    """密码登录：按用户名锁定，并对来源 IP 做跨用户名失败限速。"""
    settings = get_settings()
    ip = deps.client_ip(request)
    ip_key = f"login-fail:{ip}"
    if not security.login_limiter.allow(
        ip_key,
        settings.login_ip_max_failures,
        settings.login_ip_lock_minutes * 60,
    ):
        _audit(
            db,
            request,
            "auth.login_failed",
            target_id=payload.username,
            success=False,
            detail={"username": payload.username, "reason": "ip_rate_limited"},
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过于频繁，请稍后再试",
            headers={"Retry-After": str(settings.login_ip_lock_minutes * 60)},
        )

    locked, _ = security.is_locked_out(db, payload.username)
    if locked:
        _audit(
            db,
            request,
            "auth.login_failed",
            target_id=payload.username,
            success=False,
            detail={"username": payload.username, "reason": "locked"},
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录失败次数过多，请稍后再试",
            headers={"Retry-After": str(settings.login_lock_minutes * 60)},
        )

    user = _find_user(db, payload.username)
    # 对不存在的用户也跑一次 Argon2 校验，避免用响应时间探测用户名是否存在。
    # 注意必须「先验后判」：verify 要在判断 user is None 之前无条件执行。
    password_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    password_ok = security.verify_password(password_hash, payload.password)
    if not password_ok or user is None:
        security.record_login_attempt(db, payload.username, deps.client_ip(request), success=False)
        _audit(
            db,
            request,
            "auth.login_failed",
            target_id=payload.username,
            success=False,
            detail={"username": payload.username, "reason": "invalid_credentials"},
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)

    if not user.is_active:
        _audit(
            db,
            request,
            "auth.login_failed",
            target_id=user.username,
            success=False,
            detail={"username": user.username, "reason": "inactive"},
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)

    security.record_login_attempt(db, user.username, deps.client_ip(request), success=True)
    user.last_login_at = utcnow()
    if security.needs_rehash(user.password_hash):
        # 密码正确时顺手把旧参数的哈希升级到当前参数。
        user.password_hash = security.hash_password(payload.password)
    db.commit()
    _issue_session(db, request, response, user)
    _audit(db, request, "auth.login", actor_user_id=user.id, detail={"username": user.username})
    security.login_limiter.reset(ip_key)
    return _user_out(user)


@router.post("/logout", response_model=OkResponse)
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)) -> OkResponse:
    """删除当前会话行并清除 Cookie；未登录时也保持幂等返回 200。"""
    settings = get_settings()
    raw = request.cookies.get(settings.session_cookie_name, "")
    user_id: int | None = None
    if raw:
        row = db.execute(
            select(SessionModel).where(SessionModel.token_hash == security.hash_session_token(raw))
        ).scalar_one_or_none()
        if row is not None:
            user_id = row.user_id
            db.delete(row)
            db.commit()
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )
    if user_id is not None:
        _audit(db, request, "auth.logout", actor_user_id=user_id, detail={})
    return OkResponse()


# --------------------------------------------------------------------- 当前用户 / 偏好 / 改密


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(deps.current_user)) -> UserOut:
    return _user_out(user)


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: PreferencesUpdate,
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(get_db),
) -> UserOut:
    """更新当前用户的 locale / theme_seed / theme_mode。"""
    if payload.locale is not None:
        user.locale = payload.locale
    if payload.theme_seed is not None:
        user.theme_seed = payload.theme_seed
    if payload.theme_mode is not None:
        user.theme_mode = payload.theme_mode
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.post("/password", response_model=OkResponse)
def change_password(
    payload: PasswordChange,
    request: Request,
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(get_db),
) -> OkResponse:
    """修改密码：校验当前密码，成功后吊销该用户其它会话（保留当前）。"""
    settings = get_settings()
    if not security.verify_password(user.password_hash, payload.current_password):
        _audit(
            db,
            request,
            "auth.password_change",
            actor_user_id=user.id,
            success=False,
            detail={"reason": "bad_current_password"},
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码错误")

    user.password_hash = security.hash_password(payload.new_password)
    raw = request.cookies.get(settings.session_cookie_name, "")
    current_hash = security.hash_session_token(raw) if raw else ""
    stmt = delete(SessionModel).where(SessionModel.user_id == user.id)
    if current_hash:
        # 保留当前会话，其余全部吊销。
        stmt = stmt.where(SessionModel.token_hash != current_hash)
    db.execute(stmt)
    db.commit()
    _audit(db, request, "auth.password_change", actor_user_id=user.id, detail={})
    return OkResponse()


# --------------------------------------------------------------------- 头像


@router.put("/me/avatar", response_model=UserOut)
async def upload_avatar(
    request: Request,
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(get_db),
) -> UserOut:
    """上传头像（任意位图字节，服务端重新编码为 256×256 WebP，丢弃所有源数据）。

    直接读请求体：不信任 Content-Type 声明与 multipart，全部交给 Pillow 解码验证；
    文本/SVG/polyglot 一律 400。返回最新用户对象（含 avatar_updated_at 指纹）。
    """
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > avatar_service.MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"文件超过 {avatar_service.MAX_UPLOAD_BYTES // (1024 * 1024)}MB 上限",
        )
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > avatar_service.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"文件超过 {avatar_service.MAX_UPLOAD_BYTES // (1024 * 1024)}MB 上限",
            )
    raw = bytes(chunks)
    try:
        processed = avatar_service.process_avatar(raw)
    except avatar_service.AvatarError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    user.avatar = processed
    user.avatar_content_type = avatar_service.CONTENT_TYPE
    user.avatar_updated_at = utcnow()
    db.commit()
    db.refresh(user)
    _audit(
        db,
        request,
        "auth.avatar_upload",
        actor_user_id=user.id,
        detail={"bytes": len(processed)},
    )
    return _user_out(user)


@router.delete("/me/avatar", response_model=UserOut)
def delete_avatar(
    user: User = Depends(deps.current_user),
    db: DbSession = Depends(get_db),
) -> UserOut:
    """移除头像回到首字母占位态。"""
    user.avatar = None
    user.avatar_content_type = None
    user.avatar_updated_at = None
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.get("/users/{user_id}/avatar")
def user_avatar(
    user_id: int,
    db: DbSession = Depends(get_db),
    _user: User = Depends(deps.current_user),
) -> Response:
    """读头像字节（登录用户可见本体与其他用户：管理员/共享场景需要）。未设置 404。"""
    row = db.get(User, user_id)
    if row is None or row.avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未设置头像")
    return Response(
        content=row.avatar,
        media_type=row.avatar_content_type or "image/webp",
        headers={
            "Cache-Control": "private, max-age=60",
            "X-Content-Type-Options": "nosniff",
        },
    )
