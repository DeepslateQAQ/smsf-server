"""验证码提取。

设计参考 jd1378/otphelper 的 CodeExtractor：
- 双向匹配（「验证码 123456」与「123456 是您的验证码」）
- 跳过短语、清理短语、Unicode 词边界（Java \\b 只认 ASCII）
并在中文场景补三点：
1. NFKC 归一化（全角数字/标点）+ 阿拉伯-印度数字映射
2. 准入判定（必须含数字且数字占比 >= 50%，或形如 G-472193），堵住 "code: expired" 这类英文词误报
3. 局部否决窗口（码左侧 12 字符）而非整条否决，避免误杀
   「验证码 123456，订单号 2026091212345678」这类真实短信

纯函数、无外部依赖。规则改动的回归基线在 tests/test_otp.py 的语料表里。
"""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from dataclasses import dataclass

# ---------------------------------------------------------------- 归一化

_ARABIC_INDIC = str.maketrans({chr(0x0660 + i): str(i) for i in range(10)})
_EXT_ARABIC_INDIC = str.maketrans({chr(0x06F0 + i): str(i) for i in range(10)})
_ZERO_WIDTH = str.maketrans({"​": "", "‌": "", "‍": "", "‎": "", "‏": "", "﻿": ""})


def normalize(text: str) -> str:
    """全角->半角、阿拉伯-印度数字->ASCII、去零宽字符与 NBSP。"""
    out = unicodedata.normalize("NFKC", text)
    out = out.translate(_ARABIC_INDIC).translate(_EXT_ARABIC_INDIC)
    out = out.translate(_ZERO_WIDTH)
    return out.replace("\u00a0", " ")


# ---------------------------------------------------------------- 规则表

# 门控词：必须出现其一才可能提取。中文短词（如「码」「验证」）刻意不收录，避免误报。
GATE_PHRASES: tuple[str, ...] = (
    "验证码",
    "校验码",
    "动态码",
    "短信码",
    "安全码",
    "确认码",
    "认证码",
    "识别码",
    "验证编号",
    "一次性密码",
    "口令",
    "verification code",
    "one-time password",
    "one time password",
    "two-factor code",
    "passcode",
    "otp",
    "code",
)

# 否决词干：出现在候选码左侧 VETO_WINDOW 字符内则丢弃该候选。
# 用词干而非完整词，便于覆盖「取件码/取件号」这类变体。
VETO_STEMS: tuple[str, ...] = (
    "取件",
    "取货",
    "取餐",
    "提货",
    "折扣",
    "优惠",
    "促销",
    "订单号",
    "运单",
    "快递单",
    "流水号",
    "邮编",
    "区号",
    "邀请码",
    "discount",
    "coupon",
    "promo",
    "voucher",
    "tracking",
    "invoice",
    "zip code",
    "postal code",
    "bar code",
    "barcode",
)
VETO_WINDOW = 12
VETO_TAIL_MAX = 4

# 跨金额短语：门控词与码之间出现则跳过该匹配（otphelper 的 skipPhrases）
SKIP_PHRASES: tuple[str, ...] = ("amount", "金额", "مبلغ")

# 码形态
_SEP_CODE = r"(?:\d[-\s]){3,}\d"  # 8-3-2-9-1-4 / 3 3 6 6 8 8
_PLAIN_CODE = r"[0-9A-Za-z]{4,8}(?:[-–—][0-9A-Za-z]{2,8})*"
_PREFIX_CODE = r"[A-Za-z]{1,3}-\d{4,8}"  # G-472193
_CODE_TOKEN = rf"(?:{_SEP_CODE}|{_PLAIN_CODE}|{_PREFIX_CODE})"

# Unicode 友好的「非词」边界
_WORD_START = r"(?<![\w\u4e00-\u9fff])"
_WORD_END = r"(?![\w\u4e00-\u9fff])"


def _gate_alternatives() -> str:
    parts: list[str] = []
    for phrase in GATE_PHRASES:
        escaped = re.escape(phrase)
        if phrase.isascii():
            # ASCII 门控词要求字母边界，否则 barcode / vscode / versionCode / encode 会误命中 "code"
            parts.append(rf"(?<![A-Za-z]){escaped}(?![A-Za-z])")
        else:
            parts.append(escaped)
    return "|".join(parts)


_GATE_RE = _gate_alternatives()
_MT = re.IGNORECASE | re.MULTILINE

# 正向：门控词在前。
# 码左侧必须是非字母数字（mid 可吞数字，缺了这条 "验证码 12345678901234567"
# 会从数字串中间/尾部截出一个合法候选；右侧 _WORD_END 拦不住这种截断）
_FORWARD_RE = re.compile(
    rf"(?:{_GATE_RE})(?P<mid>.{{0,16}}?)(?<![0-9A-Za-z])(?P<code>{_CODE_TOKEN}){_WORD_END}",
    _MT,
)
# 反向：码在前，门控词在后（英文语料常见倒装）
_BACKWARD_RE = re.compile(
    rf"{_WORD_START}(?P<code>{_CODE_TOKEN})(?P<mid>.{{0,20}}?)(?:{_GATE_RE})", _MT
)
# 前缀码：G-123456 这类自带字母前缀的码，仍需门控词在全文中出现
_PREFIX_RE = re.compile(rf"{_WORD_START}(?P<code>{_PREFIX_CODE}){_WORD_END}", _MT)

_VETO_RE = re.compile("|".join(re.escape(s) for s in VETO_STEMS), re.IGNORECASE)
_SKIP_RE = re.compile("|".join(re.escape(s) for s in SKIP_PHRASES), re.IGNORECASE)
_ANY_GATE_RE = re.compile(_GATE_RE, _MT)

# 有效期：5分钟内有效 / 有效期2分钟 / 有效3分钟 / 60秒内
_TTL_RE = re.compile(
    r"(?:有效期|有效)\D{0,6}?(\d{1,3})\s*(分钟|分|秒)"
    r"|(\d{1,3})\s*(分钟|分|秒)\s*内",
    re.IGNORECASE,
)
_TTL_MAX_SECONDS = 3600

_PREFERRED_LENGTHS = frozenset({4, 6, 8})


@dataclass(frozen=True, slots=True)
class OtpCandidate:
    code: str  # 原文形式，保留横杠与空格
    normalized: str  # 去掉分隔符、统一大小写前的形式
    confidence: int
    rule: str
    span: tuple[int, int]


@dataclass(frozen=True, slots=True)
class OtpResult:
    primary: OtpCandidate | None
    candidates: tuple[OtpCandidate, ...]
    ttl_seconds: int | None

    @property
    def has_code(self) -> bool:
        return self.primary is not None


def _digits_only(code: str) -> str:
    return re.sub(r"[\s\-–—]", "", code)


def is_acceptable(code: str) -> bool:
    """准入判定：长度 4..10、至少 1 位数字，且（数字占比 >= 50% 或形如字母前缀码）。"""
    core = _digits_only(code)
    if not 4 <= len(core) <= 10:
        return False
    digits = sum(ch.isdigit() for ch in core)
    if digits == 0:
        return False
    if re.fullmatch(r"[A-Za-z]{1,3}\d{4,8}", core):
        return True
    return digits / len(core) >= 0.5


def _left_veto(text: str, boundary: int) -> bool:
    """边界左侧 VETO_WINDOW 字符内的否决词干，且需"紧邻"才生效。

    紧邻 = 否决词与边界之间没有数字且距离 <= VETO_TAIL_MAX。
    这样「Your discount code is 123456」被否决（"discount" 紧贴 "code"），
    而「取件码 123456，验证码 654321」里的真验证码不会被前一个码否决。
    """
    left = text[max(0, boundary - VETO_WINDOW) : boundary]
    for match in _VETO_RE.finditer(left):
        tail = left[match.end() :]
        if len(tail) <= VETO_TAIL_MAX and not any(ch.isdigit() for ch in tail):
            return True
    return False


def extract(text: str) -> OtpResult:
    """从短信正文提取验证码候选与有效期。"""
    if not text:
        return OtpResult(None, (), None)

    normalized = normalize(text)
    candidates: list[OtpCandidate] = []
    seen: set[str] = set()

    def push(
        raw_code: str,
        confidence: int,
        rule: str,
        span: tuple[int, int],
        boundary: int,
        mid: str,
    ) -> None:
        code = raw_code.strip()
        if not is_acceptable(code):
            return
        if _VETO_RE.search(mid) or _left_veto(normalized, boundary):
            return
        key = _digits_only(code).lower()
        if key in seen:
            return
        seen.add(key)
        candidates.append(OtpCandidate(code, key, confidence, rule, span))

    if _ANY_GATE_RE.search(normalized):
        for match in _PREFIX_RE.finditer(normalized):
            push(match.group("code"), 95, "prefix", match.span("code"), match.start("code"), "")

    for match in _FORWARD_RE.finditer(normalized):
        mid = match.group("mid")
        if _SKIP_RE.search(mid):
            continue
        gap = len(mid)
        confidence = 100 if gap <= 3 else (92 if gap <= 8 else 84)
        push(
            match.group("code"),
            confidence,
            f"forward+{gap}",
            match.span("code"),
            match.start(),
            mid,
        )

    for match in _BACKWARD_RE.finditer(normalized):
        mid = match.group("mid")
        if _SKIP_RE.search(mid):
            continue
        gap = len(mid)
        push(
            match.group("code"),
            88 if gap <= 6 else 78,
            f"backward+{gap}",
            match.span("code"),
            match.start("code"),
            mid,
        )

    candidates.sort(
        key=lambda c: (
            -c.confidence,
            0 if len(c.normalized) in _PREFERRED_LENGTHS else 1,
            c.span[0],
        )
    )
    ttl = parse_ttl_seconds(normalized)
    return OtpResult(candidates[0] if candidates else None, tuple(candidates), ttl)


def parse_ttl_seconds(text: str) -> int | None:
    """解析「5分钟内有效」这类有效期，返回秒数；超过 1 小时视为噪声。"""
    match = _TTL_RE.search(normalize(text))
    if not match:
        return None
    value = int(match.group(1) or match.group(3))
    unit = match.group(2) or match.group(4)
    seconds = value * 60 if "分" in unit else value
    if not 1 <= seconds <= _TTL_MAX_SECONDS:
        return None
    return seconds


def code_expires_at(received_at: dt.datetime, ttl_seconds: int | None) -> dt.datetime | None:
    if ttl_seconds is None:
        return None
    return received_at + dt.timedelta(seconds=ttl_seconds)
