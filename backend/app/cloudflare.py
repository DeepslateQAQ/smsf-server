"""Cloudflare proxy IP range cache.

The ranges are fetched from Cloudflare at startup and refreshed every 24 hours.
Until a successful refresh, the bundled ranges provide a fail-safe baseline.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import threading
import urllib.request
from collections.abc import Iterable

IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network

logger = logging.getLogger(__name__)

_REFRESH_SECONDS = 24 * 60 * 60
_FETCH_TIMEOUT_SECONDS = 10
_URLS = ("https://www.cloudflare.com/ips-v4", "https://www.cloudflare.com/ips-v6")
_FALLBACK_RANGES = (
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
)

_lock = threading.RLock()
_networks = tuple(ipaddress.ip_network(value) for value in _FALLBACK_RANGES)


def _parse_ranges(values: Iterable[str]) -> tuple[IpNetwork, ...]:
    parsed = tuple(ipaddress.ip_network(value.strip()) for value in values if value.strip())
    if not parsed:
        raise ValueError("Cloudflare returned no IP ranges")
    return parsed


def _fetch_ranges() -> tuple[IpNetwork, ...]:
    values: list[str] = []
    for url in _URLS:
        with urllib.request.urlopen(url, timeout=_FETCH_TIMEOUT_SECONDS) as response:
            values.extend(response.read().decode("ascii").splitlines())
    return _parse_ranges(values)


async def refresh_cloudflare_ranges() -> None:
    """Refresh ranges without blocking the event loop; retain cache on failure."""
    global _networks
    try:
        fresh = await asyncio.to_thread(_fetch_ranges)
    except Exception:
        logger.exception("刷新 Cloudflare IP 网段失败，继续使用上次缓存")
        return
    with _lock:
        _networks = fresh
    logger.info("Cloudflare IP 网段已刷新，共 %d 条", len(fresh))


def is_cloudflare_peer(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    with _lock:
        return any(address in network for network in _networks)


async def refresh_loop() -> None:
    """启动时由调用方刷新一次，之后每 24 小时刷新。"""
    while True:
        await asyncio.sleep(_REFRESH_SECONDS)
        await refresh_cloudflare_ranges()
