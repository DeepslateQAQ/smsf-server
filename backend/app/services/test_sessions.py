"""进程内接入测试会话。

接入向导测试期间，设备的下一条推送只用于回显验证结果，不写入消息表；
会话超时或显式关闭后，后续推送恢复正常入库。

``device_key`` 是设备当前的 secret，用于让 secret 轮换后旧会话立即失效。
"""

from __future__ import annotations

import secrets
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from ..otp import extract
from ..schemas import IngestRequest
from .ingest import IngestError, resolve_times

TEST_SESSION_TTL_SECONDS = 60


@dataclass(frozen=True)
class TestPush:
    sender: str
    code: str | None
    received_at: datetime
    time_source: str
    sign_ok: bool
    auth_kind: str


@dataclass
class TestSession:
    session_id: str
    device_id: int
    device_key: str
    expires_at: datetime
    push: TestPush | None = None


class TestSessionStore:
    """按设备保存有界的接入测试会话，不持久化推送内容。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[str, TestSession] = {}
        self._by_device: dict[int, str] = {}

    def start(self, device_id: int, device_key: str) -> TestSession:
        with self._lock:
            self._prune_locked()
            old_id = self._by_device.pop(device_id, None)
            if old_id is not None:
                self._sessions.pop(old_id, None)
            session = TestSession(
                session_id=secrets.token_urlsafe(18),
                device_id=device_id,
                device_key=device_key,
                expires_at=datetime.now(UTC) + timedelta(seconds=TEST_SESSION_TTL_SECONDS),
            )
            self._sessions[session.session_id] = session
            self._by_device[device_id] = session.session_id
            return session

    def status(
        self, device_id: int, device_key: str, session_id: str
    ) -> tuple[bool, TestPush | None]:
        with self._lock:
            self._prune_locked()
            session = self._sessions.get(session_id)
            if (
                session is None
                or session.device_id != device_id
                or session.device_key != device_key
            ):
                return False, None
            return True, session.push

    def capture(
        self,
        device_id: int,
        device_key: str,
        payload: IngestRequest,
        *,
        sign_ok: bool,
        auth_kind: str,
        limits: tuple[int, int],
    ) -> TestPush | None:
        with self._lock:
            self._prune_locked()
            active_id = self._by_device.get(device_id)
            session = self._sessions.get(active_id or "")
            if session is None or session.device_key != device_key:
                return None
            if session.push is not None:
                return session.push

            content = payload.content or ""
            raw_content = payload.raw_content if payload.raw_content is not None else content
            max_content = limits[1]
            if len(content) > max_content or len(raw_content) > max_content:
                raise IngestError(413, f"正文超过上限 {max_content} 字符")
            received_at, time_source, _ = resolve_times(payload, datetime.now(UTC))
            result = extract(content or raw_content)
            session.push = TestPush(
                sender=(payload.sender or "")[:128],
                code=result.primary.code if result.primary else None,
                received_at=received_at,
                time_source=time_source,
                sign_ok=sign_ok,
                auth_kind=auth_kind,
            )
            return session.push

    def close(self, device_id: int, device_key: str, session_id: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if (
                session is None
                or session.device_id != device_id
                or session.device_key != device_key
            ):
                return
            self._sessions.pop(session_id, None)
            if self._by_device.get(device_id) == session_id:
                self._by_device.pop(device_id, None)

    def _prune_locked(self) -> None:
        now = datetime.now(UTC)
        expired = [
            session for session in self._sessions.values() if session.expires_at <= now
        ]
        for session in expired:
            self._sessions.pop(session.session_id, None)
            if self._by_device.get(session.device_id) == session.session_id:
                self._by_device.pop(session.device_id, None)


store = TestSessionStore()
