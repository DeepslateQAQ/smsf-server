"""审计日志。审计写入失败绝不能影响主流程。"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session as DbSession

from ..models import AuditLog

logger = logging.getLogger(__name__)


def log(
    db: DbSession,
    *,
    action: str,
    actor_kind: str = "system",
    actor_user_id: int | None = None,
    target_type: str = "",
    target_id: str | int | None = "",
    ip: str = "",
    user_agent: str = "",
    success: bool = True,
    detail: dict[str, Any] | None = None,
) -> None:
    try:
        db.add(
            AuditLog(
                actor_user_id=actor_user_id,
                actor_kind=actor_kind,
                action=action,
                target_type=target_type,
                target_id="" if target_id is None else str(target_id),
                ip=ip[:64],
                user_agent=(user_agent or "")[:255],
                success=success,
                detail=detail or {},
            )
        )
        db.commit()
    except Exception:  # pragma: no cover - 审计不可阻断业务
        logger.exception("写入审计日志失败: action=%s", action)
        db.rollback()
