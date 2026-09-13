"""SSE 事件流：GET /api/events。

只推送「有新消息」的唤醒信号，数据仍由前端走 REST 游标拉取；因此事件丢失、
重复、乱序都无害（配合前端 60 秒兜底轮询）。单进程模型。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ..deps import current_user
from ..models import User
from ..services.events import hub

router = APIRouter(prefix="/api", tags=["events"])

PING_INTERVAL_SECONDS = 15


@router.get("/events")
async def stream_events(request: Request, user: User = Depends(current_user)) -> StreamingResponse:
    subscriber = hub.subscribe(user.id)

    async def event_stream() -> AsyncIterator[str]:
        try:
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(
                        subscriber.queue.get(), timeout=PING_INTERVAL_SECONDS
                    )
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                yield f"event: messages\ndata: {payload}\n\n"
        except asyncio.CancelledError:
            # 客户端断开，正常退出
            return
        finally:
            hub.unsubscribe(user.id, subscriber)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
