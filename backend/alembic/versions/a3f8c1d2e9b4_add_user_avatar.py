"""add user avatar columns

为用户头像增加三列：服务端重新编码后的 WebP 字节、内容类型、更新时间（缓存失效指纹）。

Revision ID: a3f8c1d2e9b4
Revises: 60bfa32eb7af
Create Date: 2026-09-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import app.db

revision = "a3f8c1d2e9b4"
down_revision = "60bfa32eb7af"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("avatar", sa.LargeBinary(), nullable=True))
        batch_op.add_column(sa.Column("avatar_content_type", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("avatar_updated_at", app.db.UTCDateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("avatar_updated_at")
        batch_op.drop_column("avatar_content_type")
        batch_op.drop_column("avatar")
