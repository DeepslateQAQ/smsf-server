"""FastAPI 应用入口。

单进程部署模型：SSE 事件中枢是进程内的，多 worker 下 fanout 会静默失效，
因此启动时直接拒绝 WEB_CONCURRENCY > 1。
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .logging_config import configure_logging
from .migrations import run_migrations

configure_logging(get_settings().log_level)
logger = logging.getLogger(__name__)


def _assert_single_worker() -> None:
    raw = os.environ.get("WEB_CONCURRENCY", "1")
    try:
        workers = int(raw)
    except ValueError:
        workers = 1
    if workers > 1:
        raise RuntimeError(
            "本服务必须单进程运行（SSE 事件中枢在进程内，多 worker 会导致实时推送静默失效）。"
            f"检测到 WEB_CONCURRENCY={workers}，请改为 1。"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _assert_single_worker()
    settings = get_settings()
    if getattr(settings, "auto_migrate", True):
        try:
            run_migrations()
        except Exception:  # pragma: no cover - 迁移失败必须显式暴露
            logger.exception("自动迁移失败，请手动执行 alembic upgrade head")
            raise
    logger.info("smsf-server 启动完成，db=%s", settings.database_url)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="SMSForwarder 短信中心",
        version="0.1.0",
        root_path=settings.root_path,
        lifespan=lifespan,
    )

    if settings.cors_origins and settings.dev_cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    from .api import admin, auth, devices, events, ingest, messages

    app.include_router(auth.router)
    app.include_router(ingest.router)
    app.include_router(devices.router)
    app.include_router(messages.router)
    app.include_router(events.router)
    app.include_router(admin.router)

    @app.get("/api/health")
    def health() -> dict[str, object]:
        from .services.events import hub

        return {"ok": True, "sse_subscribers": hub.subscriber_count}

    @app.exception_handler(ValueError)
    async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    _mount_frontend(app, settings)
    return app


def _mount_frontend(app: FastAPI, settings) -> None:
    index = settings.static_dir / "index.html"
    assets = settings.static_dir / "assets"

    # Keep unknown API paths as JSON 404 before the SPA fallback; real routes were registered first.
    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        include_in_schema=False,
    )
    def api_not_found(path: str) -> JSONResponse:
        return JSONResponse({"detail": f"接口不存在: /api/{path}"}, status_code=404)

    if not index.exists():

        @app.get("/")
        def dev_root() -> dict[str, str]:
            return {
                "detail": "前端尚未构建。开发模式请访问 Vite 提供的地址；生产模式请先执行前端构建。"
            }

        return

    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        # full_path 已由 uvicorn 做过 URL 解码；必须解析后校验「仍位于 static_dir 内」，
        # 否则 %2e%2e%2f 或绝对路径（//etc/passwd）可穿越读取任意文件。
        base = settings.static_dir.resolve()
        candidate = (base / full_path.lstrip("/")).resolve()
        if full_path and candidate.is_relative_to(base) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
