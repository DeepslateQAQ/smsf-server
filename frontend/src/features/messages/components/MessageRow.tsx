/**
 * 单条消息行（MD3 两行式列表项）：
 * - meta 行：类型图标 + 发件人（titleSmall，行内锚点）· 相对时间（次要）· 设备 chip；
 * - 内容行：摘要正文（bodyMedium 主文字色，2 行截断），才是这行的主角；
 * - 右列：验证码胶囊 + 状态徽标 + 删除，纵向居中；
 * - 紧凑密度下 meta 与正文并为一行（正文一行截断）。
 */

import CallOutlinedIcon from '@mui/icons-material/CallOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useMemo } from 'react';

import { formatDateTime, formatRelative } from '@/lib/format';
import { md3Geometry } from '@/theme';
import type { Kind, MessageOut } from '@/api/types';

import { buildHighlightTerms, summarizeText } from '../highlight';
import type { Density } from '../density';
import { useMessagesT } from '../locales';
import { ROW_MIN_HEIGHT } from '../styles';
import CodeCell from './CodeCell';
import DeviceChip from './DeviceChip';
import HighlightedText from './HighlightedText';

const KIND_ICON: Record<Kind, typeof SmsOutlinedIcon> = {
  sms: SmsOutlinedIcon,
  notification: NotificationsNoneOutlinedIcon,
  call: CallOutlinedIcon,
};

const KIND_LABEL_KEY: Record<Kind, string> = {
  sms: 'messages.kindSms',
  notification: 'messages.kindNotification',
  call: 'messages.kindCall',
};

export interface MessageRowProps {
  message: MessageOut;
  density: Density;
  keyword?: string;
  /** 消息所在设备是否为「共享给我」的设备 */
  shared: boolean;
  ownerName?: string;
  onDelete?: (message: MessageOut) => void;
}

export default function MessageRow({
  message,
  density,
  keyword,
  shared,
  ownerName,
  onDelete,
}: MessageRowProps) {
  const t = useMessagesT();
  const terms = useMemo(() => buildHighlightTerms(keyword, message.code), [keyword, message.code]);
  const summary = summarizeText(message.content || message.raw_content);
  const KindIcon = KIND_ICON[message.kind];
  const deviceName = message.device_name || t('messages.deletedDevice');
  const canDelete = message.can_delete;
  const compact = density === 'compact';

  const metaRow = (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ gridArea: 'meta', minWidth: 0 }}
    >
      <Tooltip title={t(KIND_LABEL_KEY[message.kind])}>
        <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
          <KindIcon sx={{ fontSize: md3Geometry.icon.sm }} />
        </Box>
      </Tooltip>
      <Typography variant="titleSmall" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
        {message.sender || t('messages.senderUnknown')}
      </Typography>
      <Tooltip title={`${formatDateTime(message.received_at)} · ${t('messages.timeSource')}: ${message.time_source}`}>
        <Typography
          component="span"
          variant="labelMedium"
          color="text.secondary"
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {formatRelative(message.received_at)}
        </Typography>
      </Tooltip>
      <Box sx={{ minWidth: 0, flexShrink: 1, display: { xs: 'none', sm: 'block' } }}>
        <DeviceChip name={deviceName} color={message.device_color} shared={shared} ownerName={ownerName} />
      </Box>
    </Stack>
  );

  const contentRow = (
    <Typography
      variant="bodyMedium"
      sx={{
        gridArea: 'content',
        minWidth: 0,
        fontStyle: summary ? 'normal' : 'italic',
        color: summary ? 'text.primary' : 'text.secondary',
        ...(compact
          ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
          : {
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
            }),
      }}
    >
      {summary ? (
        <HighlightedText text={summary} terms={terms} />
      ) : (
        t('messages.summaryEmpty')
      )}
    </Typography>
  );

  const trailing = (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
      sx={{ gridArea: 'code', minWidth: 0 }}
    >
      <CodeCell message={message} density={density} />
      <Tooltip title={canDelete ? t('common.delete') : t('messages.noDeletePermission')}>
        <span>
          <IconButton
            size="small"
            disabled={!canDelete}
            aria-label={t('common.delete')}
            onClick={() => onDelete?.(message)}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );

  return (
    <Box
      sx={{
        display: 'grid',
        alignItems: 'center',
        columnGap: `${md3Geometry.space.x4}px`,
        rowGap: `${md3Geometry.space.x1}px`,
        px: { xs: `${md3Geometry.space.x3}px`, md: `${md3Geometry.space.x4}px` },
        py: `${(compact ? md3Geometry.space.x2 : md3Geometry.space.x3)}px`,
        minHeight: ROW_MIN_HEIGHT[density],
        borderBottom: `${md3Geometry.border.hairline}px solid`,
        borderColor: 'divider',
        transition: 'background-color 120ms ease',
        '&:hover': { bgcolor: 'action.hover' },
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr) auto',
          md: compact ? 'minmax(0, auto) minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto',
        },
        gridTemplateAreas: compact
          ? {
              xs: '"meta meta" "content content" "code code"',
              md: '"meta content code"',
            }
          : {
              xs: '"meta meta" "content content" "code code"',
              md: '"meta code" "content code"',
            },
      }}
    >
      {metaRow}
      {contentRow}
      {trailing}
    </Box>
  );
}
