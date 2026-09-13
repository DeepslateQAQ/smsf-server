/**
 * 局部日期选择器 Provider：中文（zhCN）locale + dayjs 适配器。
 * 挂在 messages 页面内部，不依赖 shell 是否已提供 LocalizationProvider（嵌套会局部覆盖）。
 */

import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { zhCN } from '@mui/x-date-pickers/locales';
import dayjs from 'dayjs';
import { useEffect, type ReactNode } from 'react';

import 'dayjs/locale/zh-cn';

import { currentLocale } from '@/i18n';

const ZH_LOCALE_TEXT = zhCN.components.MuiLocalizationProvider.defaultProps.localeText;

export default function DatePickersProvider({ children }: { children: ReactNode }) {
  const locale = currentLocale();
  const adapterLocale = locale === 'en' ? 'en' : 'zh-cn';

  useEffect(() => {
    dayjs.locale(adapterLocale);
  }, [adapterLocale]);

  return (
    <LocalizationProvider
      dateAdapter={AdapterDayjs}
      adapterLocale={adapterLocale}
      localeText={locale === 'en' ? undefined : ZH_LOCALE_TEXT}
    >
      {children}
    </LocalizationProvider>
  );
}
