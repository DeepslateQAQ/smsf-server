"""验证码提取语料表。

这是本项目最重要的回归资产：每条都是真实短信形态或针对性对抗样本。
规则改动必须先过这张表。
"""

from __future__ import annotations

import pytest
from app.otp import extract, is_acceptable, normalize, parse_ttl_seconds

# (正文, 期望的主候选；None 表示不应提取出任何码)
CORPUS: list[tuple[str, str | None]] = [
    # ---- 中文正向 ----
    ("【中国银行】您的验证码为123456，5分钟内有效。", "123456"),
    ("【支付宝】验证码：8823。请勿泄露。", "8823"),
    ("【顺丰速运】您的验证码是 569812，请于 10 分钟内输入。", "569812"),
    ("【京东】您正在登录，校验码：741258，请勿告知他人。", "741258"),
    ("【招商银行】动态码 336688，请勿泄露。", "336688"),
    ("【中国移动】您的短信验证码：102938，有效 3 分钟，切勿告知他人。", "102938"),
    ("【12306】您的验证码为 8842，请在 5 分钟内完成验证", "8842"),
    ("【银行】您的验证码是 12345678，请勿泄露", "12345678"),
    ("【腾讯】验证码 887766，工作人员不会向您索要", "887766"),
    ("【银行】动态口令 556677，请勿泄露", "556677"),
    ("【某】验证码 0000", "0000"),
    ("【D】验证码：5482，如非本人操作请忽略", "5482"),
    ("【E】请勿向任何人透露此验证码 8821", "8821"),
    ("【H】动态口令：778899，请勿转发", "778899"),
    ("【G】验证码 123456（有效期10分钟）", "123456"),
    ("【F】验证码：123456，有效期2分钟", "123456"),
    ("尊敬的客户，您的验证码为 123456，工作人员不会向您索要，请勿转发。", "123456"),
    # ---- 分隔写法 ----
    ("【美团】验证码 8-3-2-9-1-4，切勿转发。", "8-3-2-9-1-4"),
    ("【某应用】请使用验证码 3 3 6 6 8 8 登录", "3 3 6 6 8 8"),
    # ---- 英文 / 前缀码 ----
    ("G-472193 is your Google verification code", "G-472193"),
    ("Your verification code is 391047", "391047"),
    ("Your one-time password is 029381.", "029381"),
    ("PayPal code: 9876", "9876"),
    ("Code: 8842 expires in 10 minutes", "8842"),
    ("【Google】G-884213 是你的 Google 验证码", "G-884213"),
    ("【I】Google 验证码 G-12345678", "G-12345678"),
    # ---- 数字形态归一化 ----
    ("【淘宝】验证码：９４８２７１", "948271"),
    ("【B】您的验证码是 １２３４，请勿泄露", "1234"),
    # ---- 字母数字混合 ----
    ("【A】验证码 A1B2C3", "A1B2C3"),
    # ---- 多候选：取最靠近门控词的 ----
    ("【某】验证码 1234 但你输入的是 5678", "1234"),
    ("【J】验证码 123456 和 654321 哪个？", "123456"),
    # ---- 反例：非验证码的短数字 ----
    ("【丰巢】您的取件码为 7-4-2-1，请及时取件。", None),
    ("【快递】取件码 556677", None),
    ("【工商银行】您尾号 8899 的账户于 09月12日支出 1,000.00 元，余额 12,345.67 元。", None),
    ("【滴滴出行】您本次行程的验证码为 42，请告知司机。", None),
    ("【某商家】双十一折扣码 SAVE50，全场五折！", None),
    ("【某】您的订单号 2026091212345678 已发货", None),
    ("【某】验证码错误，请重新输入", None),
    ("Your code has expired. Please request a new one.", None),
    ("验证码错误，请重新获取", None),
    # ---- 反例：优惠/订单类码必须被局部否决 ----
    ("【某】Your discount code is 123456", None),
    ("【某】优惠券口令 123456", None),
    ("【A】barcode 1234567890", None),
    ("【B】versionCode 1234 released", None),
    ("【C】请使用编码 encode 1234 完成", None),
    # ---- 边界：门控词在别处，长数字串不得被截断 ----
    ("【某】您的验证码是 12345678901234567", None),
    # ---- 混合：订单号在验证码之后，不应否决验证码 ----
    ("【某】验证码 123456，订单号 2026091212345678 已发货", "123456"),
    ("【某】取件码 123456，验证码 654321", "654321"),
    # ---- 语音播报口径（域内短码） ----
    ("验证码 10086 已发送至 13800138000", "10086"),
]


@pytest.mark.parametrize(("text", "expected"), CORPUS, ids=[f"{i:02d}" for i in range(len(CORPUS))])
def test_extract_corpus(text: str, expected: str | None) -> None:
    result = extract(text)
    got = result.primary.code if result.primary else None
    assert got == expected, f"{text!r} -> {got!r}, 期望 {expected!r}"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("【中国银行】您的验证码为123456，5分钟内有效。", 300),
        ("【顺丰速运】您的验证码是 569812，请于 10 分钟内输入。", 600),
        ("【中国移动】您的短信验证码：102938，有效 3 分钟，切勿告知他人。", 180),
        ("验证码 123456，60秒内有效", 60),
        ("验证码：123456，有效期2分钟", 120),
        ("验证码 123456，请勿泄露", None),
        ("验证码 123456，有效期 3 天", None),
    ],
)
def test_ttl(text: str, expected: int | None) -> None:
    assert parse_ttl_seconds(text) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("１２３", "123"),
        ("１２３４：５６７８", "1234:5678"),
        ("٠١٢٣", "0123"),
        ("a\u00a0b", "a b"),
        ("\u200b123456", "123456"),
    ],
)
def test_normalize(raw: str, expected: str) -> None:
    assert normalize(raw) == expected


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("123456", True),
        ("1234", True),
        ("0000", True),
        ("12345678", True),
        ("G-472193", True),
        ("A1B2C3", True),
        ("123", False),
        ("1234567890123", False),
        ("expired", False),
        ("SAVE50", False),
        ("8-3-2-9-1-4", True),
    ],
)
def test_is_acceptable(code: str, expected: bool) -> None:
    assert is_acceptable(code) is expected


def test_candidates_are_ordered_and_deduped() -> None:
    result = extract("【某】验证码 123456 有效，请勿泄露")
    assert [c.code for c in result.candidates] == ["123456"]
    assert result.primary is not None
    assert result.primary.confidence == 100
