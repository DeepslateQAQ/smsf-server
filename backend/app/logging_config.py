"""统一桥接标准库、Uvicorn、Alembic 与 Loguru 的日志输出。"""

from __future__ import annotations

import logging
import sys

from loguru import logger as loguru_logger


class InterceptHandler(logging.Handler):
    """把标准库 LogRecord 转发给 Loguru，避免两套 handler 并行输出。"""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level: str | int = loguru_logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        loguru_logger.patch(lambda message: message.update({"name": record.name})).opt(
            exception=record.exc_info
        ).log(level, record.getMessage())


def configure_logging(level: str = "INFO") -> None:
    """配置漂亮的终端输出，并限制第三方库的日志级别。"""
    normalized = level.upper()
    if normalized not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        normalized = "INFO"

    loguru_logger.remove()
    loguru_logger.add(
        sys.stderr,
        level=normalized,
        colorize=sys.stderr.isatty(),
        backtrace=False,
        diagnose=False,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level:<8}</level> | "
            "<cyan>{name}</cyan> | <level>{message}</level>"
        ),
    )

    intercept = InterceptHandler()
    root = logging.getLogger()
    root.handlers = [intercept]
    root.setLevel(logging.WARNING)

    # DEBUG 只放大本项目日志；SQLAlchemy/httpx 的参数可能含正文或凭据。
    managed_levels: dict[str, int] = {
        "app": getattr(logging, normalized),
        "uvicorn": logging.INFO,
        "uvicorn.error": logging.INFO,
        "uvicorn.access": logging.INFO,
        "alembic": logging.INFO,
        "sqlalchemy": logging.WARNING,
        "sqlalchemy.engine": logging.WARNING,
        "sqlalchemy.pool": logging.WARNING,
        "httpx": logging.WARNING,
        "httpcore": logging.WARNING,
    }
    for name, logger_level in managed_levels.items():
        target = logging.getLogger(name)
        target.handlers = [intercept]
        target.setLevel(logger_level)
        target.propagate = False
