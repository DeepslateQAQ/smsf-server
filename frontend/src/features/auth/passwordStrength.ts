/** 密码强度评估（向导文案见 `auth.setup.strength*`）。 */

export interface PasswordChecks {
  length: boolean;
  mixedCase: boolean;
  digit: boolean;
  symbol: boolean;
}

export interface PasswordStrength {
  /** 0 = 空/极弱，4 = 很强 */
  score: 0 | 1 | 2 | 3 | 4;
  /** i18n key */
  labelKey: string;
  checks: PasswordChecks;
}

const LABEL_KEYS = [
  'auth.setup.strengthWeak',
  'auth.setup.strengthWeak',
  'auth.setup.strengthMedium',
  'auth.setup.strengthStrong',
  'auth.setup.strengthVeryStrong',
] as const;

export function evaluatePassword(password: string): PasswordStrength {
  const checks: PasswordChecks = {
    length: password.length >= 8,
    mixedCase: /[a-z]/.test(password) && /[A-Z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const passed = Number(checks.length) + Number(checks.mixedCase) + Number(checks.digit) + Number(checks.symbol);
  const bonus = password.length >= 12 && passed >= 3 ? 1 : 0;
  const score = Math.min(4, passed + bonus) as PasswordStrength['score'];
  return { score, labelKey: LABEL_KEYS[score], checks };
}
