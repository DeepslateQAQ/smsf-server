/** 设备 chip：颜色圆点 + 名称（+ 共享标记）。 */

import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import { Box, Tooltip, Typography } from '@mui/material';

import { md3Geometry } from '@/theme';

import { useMessagesT } from '../locales';

export interface DeviceChipProps {
  name: string;
  color?: string;
  shared?: boolean;
  ownerName?: string;
  /** 紧凑模式仅显示圆点 + 名称，不带边框 */
  plain?: boolean;
}

export default function DeviceChip({ name, color, shared = false, ownerName, plain = false }: DeviceChipProps) {
  const t = useMessagesT();
  const chip = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        maxWidth: '100%',
        px: plain ? 0 : 0.75,
        py: plain ? 0 : 0.125,
        borderRadius: md3Geometry.shape.sm,
        border: plain ? 'none' : '1px solid',
        borderColor: 'divider',
        color: 'text.secondary',
      }}
    >
      <Box
        component="span"
        sx={{
          width: 8,
          height: 8,
          flexShrink: 0,
          borderRadius: '50%',
          bgcolor: color || 'text.disabled',
        }}
      />
      <Typography variant="labelMedium" noWrap sx={{ color: 'text.secondary' }}>
        {name}
      </Typography>
      {shared ? <PeopleAltOutlinedIcon sx={{ fontSize: md3Geometry.icon.sm, flexShrink: 0 }} /> : null}
    </Box>
  );

  if (!shared) return chip;
  return (
    <Tooltip
      title={`${t('messages.deviceShared')}${ownerName ? ` · ${t('messages.ownerLabel')}: ${ownerName}` : ''}`}
      describeChild
    >
      {chip}
    </Tooltip>
  );
}
