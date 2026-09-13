"""配置解析测试。

重点防回归：默认数据目录**不能**跟着代码位置走。Nix 打包后代码位于只读的
/nix/store，历史实现用 `Path(__file__).parent.parent/data` 推导默认库路径，
导致 `nix run` 在 import 阶段就 EROFS 崩掉。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app.config import APP_DIR, Settings, default_database_url, resolve_data_dir


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "SMSF_DATABASE_URL",
        "SMSF_DATA_DIR",
        "XDG_DATA_HOME",
        "SMSF_SESSION_TTL_DAYS",
    ):
        monkeypatch.delenv(key, raising=False)


def test_default_data_dir_is_cwd_relative(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _clear_env(monkeypatch)
    monkeypatch.chdir(tmp_path)
    assert resolve_data_dir() == tmp_path / "data"
    assert default_database_url().endswith(f"{tmp_path / 'data' / 'smsf.sqlite3'}")


def test_default_never_points_inside_package_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """默认库路径必须与代码所在目录无关 —— 否则只读安装树必崩。"""
    _clear_env(monkeypatch)
    monkeypatch.chdir(tmp_path)
    url = Settings().database_url
    assert str(APP_DIR) not in url
    assert "/nix/store" not in url


def test_explicit_data_dir_wins(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _clear_env(monkeypatch)
    target = tmp_path / "srv-data"
    monkeypatch.setenv("SMSF_DATA_DIR", str(target))
    settings = Settings()
    assert settings.database_url == f"sqlite+pysqlite:///{target / 'smsf.sqlite3'}"


def test_explicit_database_url_wins_over_data_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("SMSF_DATA_DIR", str(tmp_path / "ignored"))
    monkeypatch.setenv("SMSF_DATABASE_URL", "sqlite+pysqlite:////tmp/extra/explicit.sqlite3")
    assert Settings().database_url == "sqlite+pysqlite:////tmp/extra/explicit.sqlite3"


def test_tilde_in_data_dir_is_expanded(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("SMSF_DATA_DIR", "~/smsf-test")
    assert "~" not in Settings().database_url
