# syntax=docker/dockerfile:1

# =============================================================================
# 阶段一：构建前端（Vite + pnpm）
# =============================================================================
FROM node:24-alpine AS frontend

# corepack 下载 pnpm 时不要交互式确认
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app/frontend

# 先拷整个 frontend（含 package.json / pnpm-lock.yaml / vite 配置），
# 再判断锁文件是否存在：有就用 --frozen-lockfile 保证可复现，没有就退化为普通 install。
COPY frontend/ ./

RUN corepack enable \
    && if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install; fi \
    && pnpm build

# =============================================================================
# 阶段二：后端运行时（Python 3.13 + FastAPI + uvicorn）
# =============================================================================
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 安装 backend（pyproject.toml 声明 fastapi / uvicorn / sqlalchemy / alembic 等依赖）。
# 源码留在 /app/backend，alembic.ini 与 alembic/ 目录随源码一起保留。
COPY backend/ ./backend/
RUN pip install --no-cache-dir ./backend

# 把前端产物放进后端静态目录（FastAPI 会挂载 app/static）
COPY --from=frontend /app/frontend/dist ./backend/app/static

# 数据卷挂载点：compose 将 ./data 绑定到 /app/data
RUN mkdir -p /app/data
VOLUME ["/app/data"]

WORKDIR /app/backend

EXPOSE 8801

# 先迁移到最新 schema，再以单 worker 启动（应用内强制 WEB_CONCURRENCY=1）
ENTRYPOINT ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8801 --workers 1"]
