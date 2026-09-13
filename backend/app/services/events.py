"""进程内 SSE 事件中枢。

只发「有新消息」的唤醒信号，数据仍由前端走 REST 游标拉取；
因此事件丢失、重复、乱序都无害（配合 60s 兜底轮询）。

单进程模型：多 worker 下各进程独立订阅表，fanout 会失效。启动时校验。
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(eq=False)
class Subscriber:
    """SSE 订阅者。

    eq=False 是必要的：默认的 dataclass 会生成 __eq__ 从而把 __hash__ 置空，
    而订阅者要放进 set 去重——那会在每次建立 SSE 连接时抛 TypeError。
    这里用身份相等，语义也正是我们想要的。
    """

    queue: asyncio.Queue[dict[str, Any]]
    loop: asyncio.AbstractEventLoop


@dataclass
class EventHub:
    _subscribers: dict[int, set[Subscriber]] = field(default_factory=dict)

    def subscribe(self, user_id: int) -> Subscriber:
        loop = asyncio.get_running_loop()
        subscriber = Subscriber(queue=asyncio.Queue(maxsize=64), loop=loop)
        self._subscribers.setdefault(user_id, set()).add(subscriber)
        return subscriber

    def unsubscribe(self, user_id: int, subscriber: Subscriber) -> None:
        bucket = self._subscribers.get(user_id)
        if not bucket:
            return
        bucket.discard(subscriber)
        if not bucket:
            self._subscribers.pop(user_id, None)

    def publish(self, user_ids: set[int] | list[int], event: dict[str, Any]) -> None:
        """线程安全：入库端点在同步上下文中调用，订阅者在事件循环里。"""
        for user_id in set(user_ids):
            for subscriber in list(self._subscribers.get(user_id, ())):
                try:
                    subscriber.loop.call_soon_threadsafe(self._deliver, subscriber, event)
                except RuntimeError:
                    # 事件循环已关闭，丢弃
                    self.unsubscribe(user_id, subscriber)

    @staticmethod
    def _deliver(subscriber: Subscriber, event: dict[str, Any]) -> None:
        try:
            subscriber.queue.put_nowait(event)
        except asyncio.QueueFull:
            # 客户端太慢，丢弃旧信号，保留最新的
            try:
                subscriber.queue.get_nowait()
                subscriber.queue.put_nowait(event)
            except Exception:
                pass

    @property
    def subscriber_count(self) -> int:
        return sum(len(bucket) for bucket in self._subscribers.values())


hub = EventHub()
