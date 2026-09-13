import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { IconButton, Snackbar, Tooltip, type IconButtonProps } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';
import { copyText } from '@/lib/clipboard';

export interface CopyButtonProps {
  /** 要复制的文本 */
  value: string;
  /** 按钮提示与无障碍标签，默认「复制」 */
  label?: string;
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  color?: IconButtonProps['color'];
}

/** 复制反馈（对勾图标 + Snackbar）的展示时长，两个状态由同一个值驱动。 */
const FEEDBACK_DURATION_MS = 2000;

export default function CopyButton({
  value,
  label,
  size = 'small',
  disabled = false,
  color,
}: CopyButtonProps) {
  const t = useT();
  const [feedback, setFeedback] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<number | null>(null);

  // 卸载时清掉未触发的定时器，避免在已卸载组件上 setState。
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    const ok = await copyText(value);
    setFeedback(ok ? 'copied' : 'failed');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setFeedback(null);
    }, FEEDBACK_DURATION_MS);
  }, [value]);

  const title = label ?? t('common.copy');
  const iconSize = size === 'large' ? 'medium' : 'small';

  return (
    <>
      <Tooltip title={title}>
        <span>
          <IconButton
            aria-label={title}
            size={size}
            disabled={disabled}
            color={color}
            onClick={(event) => {
              event.stopPropagation();
              void handleCopy();
            }}
          >
            {feedback === 'copied' ? (
              <CheckRoundedIcon fontSize={iconSize} color="success" />
            ) : (
              <ContentCopyIcon fontSize={iconSize} />
            )}
          </IconButton>
        </span>
      </Tooltip>
      <Snackbar
        open={feedback !== null}
        autoHideDuration={FEEDBACK_DURATION_MS}
        onClose={() => setFeedback(null)}
        message={feedback === 'failed' ? t('common.copyFailed') : t('common.copied')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}
