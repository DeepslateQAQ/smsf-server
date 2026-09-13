import { Box, Tab, Tabs, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';

import { useT } from '@/i18n';

import DevicesPanel from './DevicesPanel';
import OpsPanel from './OpsPanel';
import SettingsPanel from './SettingsPanel';
import UsersPanel from './UsersPanel';
import { useAdminCopy } from './useAdminCopy';

/**
 * 与 SettingsPage 相同的局部 TabPanel 模式：面板只在激活时渲染内容，
 * 但始终保留 role/id/aria-labelledby 的 Tabs ↔ TabPanel 关联。
 */
function TabPanel({
  value,
  index,
  children,
}: {
  value: number;
  index: number;
  children: ReactNode;
}) {
  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      id={`admin-tabpanel-${index}`}
      aria-labelledby={`admin-tab-${index}`}
      sx={{ pt: 3 }}
    >
      {value === index ? children : null}
    </Box>
  );
}

export default function AdminPage() {
  const copy = useAdminCopy();
  const t = useT();
  const [tab, setTab] = useState(0);

  return (
    <>
      <Box sx={{ mb: 3 }}>
        <Typography variant="headlineSmall" component="h1">
          {copy.title}
        </Typography>
        <Typography variant="bodyMedium" color="text.secondary" sx={{ mt: 0.5 }}>
          {copy.subtitle}
        </Typography>
      </Box>

      <Tabs
        value={tab}
        onChange={(_event, next: number) => setTab(next)}
        variant="scrollable"
        allowScrollButtonsMobile
        aria-label={t('nav.admin')}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}
      >
        <Tab label={copy.tabs.users} id="admin-tab-0" aria-controls="admin-tabpanel-0" />
        <Tab label={copy.tabs.devices} id="admin-tab-1" aria-controls="admin-tabpanel-1" />
        <Tab label={copy.tabs.settings} id="admin-tab-2" aria-controls="admin-tabpanel-2" />
        <Tab label={copy.tabs.ops} id="admin-tab-3" aria-controls="admin-tabpanel-3" />
      </Tabs>

      <TabPanel value={tab} index={0}>
        <UsersPanel />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <DevicesPanel />
      </TabPanel>
      <TabPanel value={tab} index={2}>
        <SettingsPanel />
      </TabPanel>
      <TabPanel value={tab} index={3}>
        <OpsPanel />
      </TabPanel>
    </>
  );
}
