"""Alembic 迁移入口，供应用启动时自动升级。"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

from .config import get_settings

BACKEND_DIR = Path(__file__).resolve().parent.parent


def alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", get_settings().database_url)
    return config


def run_migrations(revision: str = "head") -> None:
    command.upgrade(alembic_config(), revision)
