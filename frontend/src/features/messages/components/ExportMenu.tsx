/** 导出按钮：浏览器直接下载当前筛选结果的 CSV / JSON。 */

import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { Button, ListItemText, Menu, MenuItem } from '@mui/material';
import { useId, useState } from 'react';

import type { Query } from '@/api/client';

import { downloadMessagesExport } from '../api';
import { useMessagesT } from '../locales';

export interface ExportMenuProps {
  /** 当前筛选（不要带 cursor/limit） */
  query: Query;
}

export default function ExportMenu({ query }: ExportMenuProps) {
  const t = useMessagesT();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const menuId = useId();

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<DownloadOutlinedIcon fontSize="small" />}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : undefined}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {t('messages.exportTitle')}
      </Button>
      <Menu
        id={menuId}
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            downloadMessagesExport(query, 'csv');
            setAnchor(null);
          }}
        >
          <ListItemText primary={t('messages.exportCsv')} secondary={t('messages.exportHint')} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            downloadMessagesExport(query, 'json');
            setAnchor(null);
          }}
        >
          <ListItemText primary={t('messages.exportJson')} secondary={t('messages.exportHint')} />
        </MenuItem>
      </Menu>
    </>
  );
}
