/**
 * 验证码格（tertiary 胶囊）：
 * - tertiaryContainer 底 + onTertiaryContainer 等宽数字（18/24px 随密度），点击即复制；
 *   胶囊本身就是复制按钮（aria-label/focus 环齐全），不再放重复的 CopyButton；
 * - 无码消息不渲染本体（缺省即信号，行高由 ROW_MIN_HEIGHT 保持稳定）；
 * - 有 `code_expires_at` 时显示每秒刷新的倒计时徽标，归零后胶囊转为 disabled 配色 + 划线；
 * - `code_candidates.length > 1` 时显示 `+N` 角标，点击展开候选列表；
 * - `time_doubtful` 用 warning 徽标区分。
 */

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import { Box, Chip, IconButton, Popover, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatDuration } from '@/lib/format';
import type { MessageOut } from '@/api/types';

import { md3Geometry } from '@/theme';
import { splitCodeCandidates } from '../code';
import { copyToClipboard } from '../clipboard';
import { CODE_FONT_SIZE, CODE_PILL_HEIGHT, type Density } from '../density';
import { useMessagesT } from '../locales';
import { MONO_FONT } from '../styles';

/** 每秒刷新剩余秒数；没有到期时间或已到期时停止计时。 */
function useCountdownSeconds(expiresAt: string | null): number | null {
  const target = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (!Number.isFinite(target) || target <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= target) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  if (!Number.isFinite(target)) return null;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

export interface CodeCellProps {
  message: MessageOut;
  density: Density;
  /** 桌面端右对齐 */
  align?: 'start' | 'end';
}

export default function CodeCell({ message, density, align = 'end' }: CodeCellProps) {
  const t = useMessagesT();
  const { primary, rest, total } = useMemo(
    () => splitCodeCandidates(message.code_candidates, message.code),
    [message.code_candidates, message.code],
  );
  const remaining = useCountdownSeconds(message.code_expires_at);
  const expired = message.code_expired || (remaining !== null && remaining <= 0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const copy = useCallback(
    async (value: string) => {
      const ok = await copyToClipboard(value);
      setFeedback(ok ? t('messages.codeCopied') : t('messages.codeCopyFailed'));
      if (ok) setAnchor(null);
    },
    [t],
  );

  const candidates = primary ? [primary, ...rest] : rest;
  const alignItems = align === 'end' ? 'flex-end' : 'flex-start';
  /* 紧凑档行高放不下「胶囊 + 徽标」两行，徽标并入胶囊同一行 */
  const compact = density === 'compact';

  return (
    <Stack
      direction={compact ? 'row' : 'column'}
      spacing={0.5}
      sx={{
        alignItems: compact ? 'center' : { xs: 'flex-start', md: alignItems },
        justifyContent: compact ? 'flex-end' : undefined,
        flexWrap: compact ? 'nowrap' : undefined,
        minWidth: 0,
      }}
    >
      {primary ? (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip title={t('messages.codeCopyHint')}>
            <Box
              component="button"
              type="button"
              onClick={() => void copy(primary.code)}
              aria-label={`${t('messages.copyCode')}: ${primary.code}`}
              sx={{
                border: 0,
                cursor: 'pointer',
                fontFamily: MONO_FONT,
                fontSize: CODE_FONT_SIZE[density],
                fontWeight: 500,
                lineHeight: 1.1,
                letterSpacing: '0.04em',
                height: `${CODE_PILL_HEIGHT[density]}px`,
                px: `${md3Geometry.space.x3}px`,
                borderRadius: md3Geometry.shape.sm,
                /* 验证码走 tertiary 角色：命中高亮（styles.ts MARK_SX）同源，浅/深色都成立 */
                bgcolor: expired
                  ? 'action.disabledBackground'
                  : 'var(--mui-palette-tertiaryContainer)',
                color: expired ? 'text.disabled' : 'var(--mui-palette-onTertiaryContainer)',
                textDecoration: expired ? 'line-through' : 'none',
                transition: 'background-color 120ms ease',
                '&:hover': {
                  bgcolor: expired
                    ? 'action.disabledBackground'
                    : 'color-mix(in srgb, var(--mui-palette-onTertiaryContainer) 8%, var(--mui-palette-tertiaryContainer))',
                },
                '&:focus-visible': {
                  outline: `${md3Geometry.border.standard}px solid`,
                  outlineColor: 'primary.main',
                  outlineOffset: md3Geometry.border.standard,
                },
              }}
            >
              {primary.code}
            </Box>
          </Tooltip>
          {rest.length > 0 ? (
            <Chip
              size="small"
              variant="outlined"
              color="primary"
              label={t('messages.codeMore', { count: rest.length })}
              onClick={(event) => setAnchor(event.currentTarget)}
              sx={{ cursor: 'pointer' }}
            />
          ) : null}
        </Stack>
      ) : null}

      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
        {message.time_doubtful ? (
          <Chip
            size="small"
            variant="outlined"
            color="warning"
            icon={<ErrorOutlineOutlinedIcon />}
            label={t('messages.timeDoubtful')}
          />
        ) : null}
        {message.code_expires_at ? (
          expired ? (
            <Chip
              size="small"
              label={t('messages.codeExpired')}
              disabled
              sx={{ opacity: 0.6, textDecoration: 'line-through' }}
            />
          ) : (
            <Chip
              size="small"
              variant="outlined"
              color="success"
              icon={<ScheduleOutlinedIcon />}
              label={t('messages.codeExpiresIn', { time: formatDuration(remaining ?? 0) })}
            />
          )
        ) : null}
      </Stack>

      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 1.5, minWidth: 240 }}>
          <Typography variant="labelLarge" sx={{ display: 'block', mb: 1 }}>
            {t('messages.candidatesTitle', { count: total })}
          </Typography>
          <Stack spacing={0.5}>
            {candidates.map((candidate) => (
              <Stack
                key={candidate.code}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={1}
                sx={{
                  px: 1,
                  py: 0.5,
                  borderRadius: md3Geometry.shape.sm,
                  bgcolor: candidate.code === primary?.code ? 'action.selected' : 'transparent',
                }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Typography sx={{ fontFamily: MONO_FONT, fontWeight: 500, fontSize: '1rem', letterSpacing: '0.06em' }}>
                    {candidate.code}
                  </Typography>
                  {candidate.code === primary?.code ? (
                    <Chip size="small" color="primary" label={t('messages.candidatePrimary')} />
                  ) : null}
                </Stack>
                <Stack direction="row" spacing={0.25} alignItems="center">
                  <Typography variant="bodySmall" color="text.secondary">
                    {t('messages.candidateConfidence', { value: Math.max(0, Math.min(100, Math.round(candidate.confidence))) })}
                  </Typography>
                  <Tooltip title={t('messages.candidateCopy', { code: candidate.code })}>
                    <IconButton size="small" onClick={() => void copy(candidate.code)}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Box>
      </Popover>

      <Snackbar
        open={feedback !== null}
        autoHideDuration={2000}
        onClose={() => setFeedback(null)}
        message={feedback ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  );
}
