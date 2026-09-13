import { useTranslation } from 'react-i18next';

import { deviceCopy, type DeviceCopy } from './locales';

/** 读取当前语言下的 devices 文案；语言随 i18next 变化而切换。 */
export function useDeviceCopy(): DeviceCopy {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage === 'en' ? deviceCopy.en : deviceCopy.zh;
}
