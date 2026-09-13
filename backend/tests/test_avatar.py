"""头像管线的可观察契约：

- 任意源图都被服务端重新编码为 256×256 WebP（源格式/元数据不可复原）；
- 文本、伪图片、超限请求体一律 400/413 风格拒绝，绝不落库；
- `avatar_updated_at` 指纹随更新变化（前端缓存失效信号）；
- 未登录不可读头像；删除后 GET 404。
"""

from __future__ import annotations

import io

import pytest
from app.services.avatar import AvatarError, process_avatar
from fastapi.testclient import TestClient
from PIL import Image, ImageOps
from sqlalchemy.orm import Session as DbSession

from .conftest import login, make_user

ME = "/api/auth/me/avatar"


def _png_bytes(
    size: tuple[int, int] = (800, 600),
    color: tuple[int, int, int] = (11, 87, 208),
) -> bytes:
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_excessive_pixel_dimensions_are_rejected_before_decode() -> None:
    # Header-only dimensions are rejected before pixel decoding.
    with pytest.raises(AvatarError, match="像素"):
        process_avatar(_png_bytes(size=(4000, 4000)))


def test_exif_orientation_is_normalized_before_crop() -> None:
    # 四个色块让「先旋转再居中裁方」与「直接裁原图」产生可区分的象限排列。
    image = Image.new("RGB", (80, 40))
    colors = {
        "red": (255, 0, 0),
        "green": (0, 200, 0),
        "blue": (0, 0, 255),
        "yellow": (255, 220, 0),
    }
    for box, color in (
        ((0, 0, 40, 20), colors["red"]),
        ((40, 0, 80, 20), colors["green"]),
        ((0, 20, 40, 40), colors["blue"]),
        ((40, 20, 80, 40), colors["yellow"]),
    ):
        image.paste(color, box)
    exif = image.getexif()
    exif[274] = 6  # Orientation: rotate 90° clockwise, as common phone JPEGs do.
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif.tobytes(), quality=100, subsampling=0)

    processed = process_avatar(buffer.getvalue())
    output = Image.open(io.BytesIO(processed)).convert("RGB")
    oriented = ImageOps.exif_transpose(Image.open(io.BytesIO(buffer.getvalue())))
    side = min(oriented.size)
    expected = oriented.crop(
        (0, (oriented.height - side) // 2, side, (oriented.height + side) // 2)
    )
    expected = expected.resize((256, 256), Image.Resampling.NEAREST)

    palette = list(colors.values())

    def nearest(pixel: tuple[int, int, int]) -> tuple[int, int, int]:
        return min(
            palette,
            key=lambda color: sum(
                (a - b) ** 2 for a, b in zip(pixel, color, strict=True)
            ),
        )

    for point in ((64, 64), (192, 64), (64, 192), (192, 192)):
        assert nearest(output.getpixel(point)) == nearest(expected.getpixel(point))


def test_upload_reencodes_to_256_webp(client: TestClient, db: DbSession) -> None:
    owner = make_user(db, "owner")
    login(client, "owner")
    response = client.put(ME, content=_png_bytes(), headers={"Content-Type": "image/png"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_avatar"] is True
    assert body["avatar_updated_at"] is not None

    fetched = client.get(f"/api/auth/users/{owner.id}/avatar")
    assert fetched.status_code == 200, fetched.text
    assert fetched.headers["content-type"] == "image/webp"
    image = Image.open(io.BytesIO(fetched.content))
    assert image.format == "WEBP"
    assert image.size == (256, 256)


def test_text_blob_is_rejected_and_nothing_persists(client: TestClient, db: DbSession) -> None:
    owner = make_user(db, "owner")
    login(client, "owner")
    response = client.put(
        ME,
        content=b"<script>alert(1)</script>",
        headers={"Content-Type": "text/html"},
    )
    assert response.status_code == 400, response.text
    assert db.get(owner.__class__, owner.id).avatar is None


def test_oversized_upload_is_rejected(client: TestClient, db: DbSession) -> None:
    owner = make_user(db, "owner")
    login(client, "owner")
    response = client.put(ME, content=b"\x00" * (4 * 1024 * 1024 + 1))
    assert response.status_code == 413, response.text
    assert db.get(owner.__class__, owner.id).avatar is None


def test_replace_bumps_fingerprint_then_delete_clears(client: TestClient, db: DbSession) -> None:
    owner = make_user(db, "owner")
    login(client, "owner")
    first = client.put(ME, content=_png_bytes(), headers={"Content-Type": "image/png"})
    assert first.status_code == 200
    first_fp = first.json()["avatar_updated_at"]

    second = client.put(
        ME,
        content=_png_bytes(color=(185, 38, 30)),
        headers={"Content-Type": "image/png"},
    )
    assert second.status_code == 200
    assert second.json()["avatar_updated_at"] != first_fp

    cleared = client.delete(ME)
    assert cleared.status_code == 200
    body = cleared.json()
    assert body["has_avatar"] is False
    assert body["avatar_updated_at"] is None
    assert client.get(f"/api/auth/users/{owner.id}/avatar").status_code == 404


def test_unknown_user_avatar_404_after_upload_by_other(db: DbSession, client_factory) -> None:
    owner = make_user(db, "owner")
    client = client_factory()
    login(client, "owner")
    first_put = client.put(ME, content=_png_bytes(), headers={"Content-Type": "image/png"})
    assert first_put.status_code == 200

    other = make_user(db, "other")
    other_client = client_factory()
    login(other_client, "other")
    assert other_client.get(f"/api/auth/users/{owner.id}/avatar").status_code == 200
    assert other_client.get(f"/api/auth/users/{other.id}/avatar").status_code == 404

    anon = client_factory()
    assert anon.get(f"/api/auth/users/{owner.id}/avatar").status_code == 401
