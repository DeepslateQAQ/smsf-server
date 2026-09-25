#!/usr/bin/env python3
"""向 smsf-server 推送一条模拟短信（SMSForwarder 兼容）。

用途：在没有手机的情况下验证「Webhook Server + Headers + Params + Secret」这条链路，
      尤其是 HMAC 签名是否正确、同一请求重放是否被判为 duplicate。

签名算法与 backend/app/security.py::compute_signature 完全一致：

    sign = Base64( HMAC_SHA256( key = secret, msg = f"{timestamp_ms}\\n{secret}" ) )

其中 timestamp_ms 是毫秒时间戳，作为请求体里的 timestamp / sent_at 字段一起发送；
发送前 sign 会再做一次 URL 编码（quote），与 App 端行为一致。

仅依赖 Python 标准库，直接 `python3 scripts/fake_push.py ...` 即可运行。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8801"
DEFAULT_PATH = "/api/v1/ingest"

_EPILOG = """\
示例：
  1) Bearer 模式（用设备 secret 直接鉴权）——最省事，先用这个排除网络问题：
     python3 scripts/fake_push.py --secret <device-secret> --bearer \\
         --sender 10086 --content "您的验证码是 123456"

  2) 签名模式（device_mark + timestamp + sign），最贴近 SmsForwarder 默认模板：
     python3 scripts/fake_push.py --secret <device-secret> --device-mark smsf-xxxxxxxx \\
         --sender 106980095588 \\
         --content "【招商银行】您的验证码是 548213，5分钟内有效。" \\
         --received-at "2026-09-12T10:30:00+08:00"

  3) 验证幂等（同一请求连续发 2 次，第二次应返回 duplicate=true）：
     python3 scripts/fake_push.py --secret <device-secret> --bearer --repeat 2

  4) 降级表单编码（application/x-www-form-urlencoded，App 默认模板不带 device_mark）：
     python3 scripts/fake_push.py --secret <device-secret> --form --sender 10086

  5) 指向本机另一个端口 / 自定义路径：
     python3 scripts/fake_push.py --url http://127.0.0.1:8811 --secret <secret> --bearer

退出码：全部请求均为 2xx 时返回 0，否则返回 1。
"""


def compute_signature(secret: str, timestamp_ms: int) -> str:
    """与后端 security.compute_signature 一致的原始 Base64 签名。"""
    message = f"{timestamp_ms}\n{secret}".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def build_payload(args: argparse.Namespace, timestamp_ms: int, signed: bool) -> dict[str, str]:
    """构造 SmsForwarder 风格的请求体字段。"""
    payload: dict[str, str] = {
        "from": args.sender,
        "content": args.content,
        "org_content": args.content,
        "card_slot": "",
        "timestamp": str(timestamp_ms),
        "app_version": "fake-push/0.1",
    }
    if args.received_at:
        payload["receive_time"] = args.received_at
    if signed:
        payload["device_mark"] = args.device_mark
        payload["sign"] = urllib.parse.quote(compute_signature(args.secret, timestamp_ms), safe="")
    return payload


def build_request(
    target_url: str, args: argparse.Namespace, payload: dict[str, str], signed: bool
) -> urllib.request.Request:
    if args.form:
        body = urllib.parse.urlencode(payload).encode("utf-8")
        content_type = "application/x-www-form-urlencoded"
    else:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        content_type = "application/json"

    request = urllib.request.Request(target_url, data=body, method="POST")
    request.add_header("Content-Type", content_type)
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", "smsf-fake-push/0.1")
    if not signed:
        request.add_header("Authorization", f"Bearer {args.secret}")
    return request


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="fake_push.py",
        description="向 smsf-server 推送一条模拟短信，验证签名、鉴权与幂等。",
        epilog=_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help=f"服务基地址，默认 {DEFAULT_URL}",
    )
    parser.add_argument(
        "--path",
        default=DEFAULT_PATH,
        help=f"入库端点路径，默认 {DEFAULT_PATH}",
    )
    parser.add_argument("--secret", required=True, help="设备 secret（必填，作为签名密钥或 Bearer token）")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--device-mark",
        metavar="MARK",
        help="设备标识；给了就走签名路径（device_mark + timestamp + sign）",
    )
    mode.add_argument(
        "--bearer",
        action="store_true",
        help="走 Bearer 路径（Authorization: Bearer <secret>）；不指定 --device-mark 时默认即此模式",
    )
    parser.add_argument("--sender", default="10086", help="发件人号码，默认 10086")
    parser.add_argument(
        "--content",
        default="您的验证码是 123456，5分钟内有效，请勿泄露。",
        help="短信正文",
    )
    parser.add_argument(
        "--received-at",
        metavar="ISO8601",
        default=None,
        help='设备上报的接收时间，例如 "2026-09-12T10:30:00+08:00"；省略则服务端按 sent_at 处理',
    )
    parser.add_argument("--repeat", type=int, default=1, metavar="N", help="重复发送次数，默认 1")
    parser.add_argument(
        "--form",
        action="store_true",
        help="用 application/x-www-form-urlencoded 降级表单编码发送（默认 JSON）",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.repeat < 1:
        print("--repeat 必须 >= 1", file=sys.stderr)
        return 2

    signed = args.device_mark is not None
    timestamp_ms = int(time.time() * 1000)
    payload = build_payload(args, timestamp_ms, signed)
    url = args.url.rstrip("/") + "/" + args.path.lstrip("/")

    mode_label = "签名" if signed else "Bearer"
    print(f"# 模式: {mode_label}  编码: {'form' if args.form else 'json'}")
    print(f"# 目标: {url}")
    print(f"# secret: {args.secret[:4]}...（已隐藏）  repeat: {args.repeat}")

    ok = True
    for index in range(1, args.repeat + 1):
        request = build_request(url, args, payload, signed)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                status = response.status
                raw = response.read()
        except urllib.error.HTTPError as error:  # 4xx/5xx 也把响应体打出来
            status = error.code
            raw = error.read()
            ok = False
        except urllib.error.URLError as error:
            print(f"[{index}/{args.repeat}] 连接失败: {error.reason}", file=sys.stderr)
            return 1

        text = raw.decode("utf-8", errors="replace")
        print(f"[{index}/{args.repeat}] HTTP {status}")
        try:
            print(json.dumps(json.loads(text), ensure_ascii=False, indent=2))
        except json.JSONDecodeError:
            print(text)

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
