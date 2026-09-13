"""头像服务端处理（安全内核）。

设计原则：不信任任何上传内容 ——
- 只认 Pillow 能解码的位图（SVG/脚本类伪装天然被拒）；
- 在解码前检查像素数，避免小体积高压缩图片把内存撑到数百 MB；
- 重新编码为 256×256 WebP：源文件里的元数据、polyglot 载荷全部丢弃；
- 限制原始体积、像素数与输出体积，防解压炸弹与存储膨胀。
"""

from __future__ import annotations

import io

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MAX_IMAGE_PIXELS = 12_000_000
MAX_OUTPUT_BYTES = 256 * 1024
OUTPUT_SIZE = 256
WEBP_QUALITY = 80
CONTENT_TYPE = "image/webp"


class AvatarError(ValueError):
    """不可安全处理的上传；message 面向用户。"""


def process_avatar(raw: bytes) -> bytes:
    """把位图安全地重编为 256×256 WebP；非法输入抛 AvatarError。

    `Image.size` 只读图片头，不会解码像素；像素上限必须放在 `load()` 前检查。
    这把 4MB 压缩输入的解码内存上限从「任意」收紧到约 1200 万像素量级。
    """
    if not raw:
        raise AvatarError("未收到文件内容")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise AvatarError(f"文件超过 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB 上限")

    try:
        opened = Image.open(io.BytesIO(raw))
        width, height = opened.size
        if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
            raise AvatarError(f"图片像素超过 {MAX_IMAGE_PIXELS // 1_000_000}MP 上限")
        opened.load()  # 先过像素门槛，再解码；截断/伪装文件在此发现
        # 手机竖拍 JPEG 常带 EXIF Orientation；裁剪前归一化，避免头像横倒。
        image = ImageOps.exif_transpose(opened)
    except AvatarError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise AvatarError("无法识别的图片文件：请提供 PNG/JPEG/WebP/GIF 图片") from None

    width, height = image.size
    if width <= 0 or height <= 0:
        raise AvatarError("图片尺寸异常")
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    cropped = image.crop((left, top, left + side, top + side))
    if cropped.size != (OUTPUT_SIZE, OUTPUT_SIZE):
        cropped = cropped.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.LANCZOS)

    # 统一转 RGBA/RGB（CMYK、16bit 灰度等在 WebP 里不通用）。
    if cropped.mode not in ("RGB", "RGBA"):
        cropped = cropped.convert("RGBA" if "A" in cropped.mode or cropped.mode == "P" else "RGB")

    for quality in (WEBP_QUALITY, 70, 60, 50):
        buffer = io.BytesIO()
        cropped.save(buffer, format="WEBP", quality=quality, method=6)
        if buffer.tell() <= MAX_OUTPUT_BYTES:
            return buffer.getvalue()
    raise AvatarError("图片处理后仍超过存储上限，请换一张更简单的图片")
