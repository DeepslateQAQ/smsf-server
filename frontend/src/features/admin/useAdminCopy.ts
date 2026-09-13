import { useTranslation } from 'react-i18next';

import { adminCopy, type AdminCopy } from './locales';

/** 读取当前语言下的 admin 文案；语言随 i18next 变化而切换。 */
export function useAdminCopy(): AdminCopy {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage === 'en' ? adminCopy.en : adminCopy.zh;
}
