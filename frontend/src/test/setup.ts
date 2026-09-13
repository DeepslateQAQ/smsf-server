import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// 测试里固定界面语言为中文（i18n 在模块加载时读取该 key），避免依赖 jsdom 的 navigator.language
try {
  globalThis.localStorage?.setItem('smsf.locale', 'zh');
} catch {
  /* ignore */
}

afterEach(() => {
  cleanup();
});

// jsdom 没有 matchMedia / clipboard，补齐供 MUI 与 CopyButton 使用
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}
