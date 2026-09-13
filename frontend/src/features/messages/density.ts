/**
 * 列表密度（紧凑 / 舒适）：存 localStorage，不进 URL。
 * 验证码大字号的唯一来源，取值落在 28–40px 区间内。
 */

import { useCallback, useState } from 'react';

export type Density = 'compact' | 'comfortable';

export const DENSITY_STORAGE_KEY = 'smsf.messages.density';
export const DEFAULT_DENSITY: Density = 'comfortable';

/**
 * 验证码胶囊的等宽字号（px）：随密度缩放。
 * 原来是 28/40px 的裸灰字「幽灵大字」，现在落在 tertiaryContainer 胶囊内，
 * 18/24px 足以扫读又不至于抢掉整行层级。
 */
export const CODE_FONT_SIZE: Record<Density, number> = {
  compact: 18,
  comfortable: 24,
};

/** 验证码胶囊的高度（px）：舒适档跟随按钮 40，紧凑档跟随 chip 32。 */
export const CODE_PILL_HEIGHT: Record<Density, number> = {
  compact: 32,
  comfortable: 40,
};

export function isDensity(value: unknown): value is Density {
  return value === 'compact' || value === 'comfortable';
}

function readStoredDensity(): Density {
  try {
    const raw = globalThis.localStorage?.getItem(DENSITY_STORAGE_KEY);
    return isDensity(raw) ? raw : DEFAULT_DENSITY;
  } catch {
    // localStorage 不可用（隐私模式）时用默认值
    return DEFAULT_DENSITY;
  }
}

/** `[密度, 切换]`；切换会写回 localStorage。 */
export function useDensity(): [Density, (next: Density) => void] {
  const [density, setDensity] = useState<Density>(readStoredDensity);
  const update = useCallback((next: Density) => {
    setDensity(next);
    try {
      globalThis.localStorage?.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
  }, []);
  return [density, update];
}
