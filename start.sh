#!/usr/bin/env bash
# Start smsf-server directly from the checked-out source tree (uv + FastAPI).
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR/backend"

if ! command -v uv >/dev/null 2>&1; then
  cat >&2 <<'EOF'
start.sh requires uv.
Install uv, then run `uv sync` in backend/ and retry.
EOF
  exit 127
fi

# Keep the source-run flow identical to the documented manual commands.
uv run alembic upgrade head
exec uv run uvicorn app.main:app \
  --host "${SMSF_HOST:-0.0.0.0}" \
  --port "${SMSF_PORT:-8801}" \
  --workers 1 \
  "$@"
