import {
  AppBar,
  Avatar,
  Box,
  ButtonBase,
  Chip,
  Divider,
  Drawer,
  Fab,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  type Theme,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import BrightnessAutoOutlinedIcon from '@mui/icons-material/BrightnessAutoOutlined';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import DevicesOtherOutlinedIcon from '@mui/icons-material/DevicesOtherOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import SmsRoundedIcon from '@mui/icons-material/SmsRounded';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet, Link as RouterLink, useLocation, useNavigate } from 'react-router';

import ConfirmDialog from '@/components/ConfirmDialog';
import { avatarUrl } from '@/api/avatar';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocaleSwitch } from '@/features/auth/useLocaleSwitch';
import { currentLocale, useT, type AppLocale } from '@/i18n';
import { md3Geometry, themeVars } from '@/theme';
import { useThemeMode } from '@/theme/ThemeModeProvider';
import type { ThemeMode } from '@/api/types';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const MODE_ICONS: Record<'light' | 'dark' | 'system', ReactNode> = {
  light: <LightModeOutlinedIcon />,
  dark: <DarkModeOutlinedIcon />,
  system: <BrightnessAutoOutlinedIcon />,
};

const MODE_LABEL_KEYS: Record<'light' | 'dark' | 'system', string> = {
  light: 'nav.themeLight',
  dark: 'nav.themeDark',
  system: 'nav.themeSystem',
};

function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return Array.from(trimmed).slice(0, 2).join('').toUpperCase();
}

/**
 * 壳层布局宽度：MD3 只约束组件几何（md3Geometry.md3Tokens），不约束页面壳层，
 * 这三个宽度是应用级布局常量，集中在此而非散落 JSX。
 */
const SHELL = { railExtendedWidth: 240, mobileDrawerWidth: 280, contentMaxWidth: 1280 } as const;

/**
 * 导航项几何全部引用 md3Geometry：
 * - 行高 56（56×32 胶囊与 12/500 标签都放得下）
 * - 展开态选中胶囊由主题的 ListItemButton `::before` 提供（整行 stadium 胶囊，MD3 nav drawer 形态）
 * - rail 收起态改用 MD3 navigation rail 的居中 56×32 小胶囊，这里按上下文覆盖定位
 */
function navButtonSx(extended: boolean) {
  return {
    minHeight: md3Geometry.height.listItem,
    flexDirection: extended ? 'row' : 'column',
    alignItems: 'center',
    justifyContent: extended ? 'flex-start' : 'center',
    gap: extended ? 0 : `${md3Geometry.space.x1}px`,
    px: extended ? `${md3Geometry.space.x4}px` : 0,
    ...(extended
      ? {}
      : {
          '&&.Mui-selected::before': {
            insetInlineStart: `calc(50% - ${md3Geometry.width.navIndicator / 2}px)`,
            insetInlineEnd: 'auto',
            top: '50%',
            bottom: 'auto',
            transform: 'translateY(-50%)',
            width: md3Geometry.width.navIndicator,
            height: md3Geometry.height.navIndicator,
            borderRadius: md3Geometry.shape.full,
          },
        }),
  } as const;
}

export default function Layout() {
  const t = useT();
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const switchLocale = useLocaleSwitch();
  const { mode, resolvedMode, setMode } = useThemeMode();
  const extendedRail = useMediaQuery(theme.breakpoints.up('lg'));
  const showExtendedFab = useMediaQuery(theme.breakpoints.up('md'));

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modeMenuAnchor, setModeMenuAnchor] = useState<HTMLElement | null>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const items = useMemo<NavItem[]>(() => {
    const base: NavItem[] = [
      { to: '/', label: t('nav.messages'), icon: <ChatBubbleOutlineRoundedIcon /> },
      { to: '/devices', label: t('nav.devices'), icon: <DevicesOtherOutlinedIcon /> },
      { to: '/settings', label: t('nav.settings'), icon: <SettingsOutlinedIcon /> },
    ];
    if (user?.is_admin) {
      base.push({ to: '/admin', label: t('nav.admin'), icon: <AdminPanelSettingsOutlinedIcon /> });
    }
    return base;
  }, [t, user?.is_admin]);

  const activeItem = items.find((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to),
  );
  const pageTitle = activeItem?.label ?? t('app.name');
  const activeLocale = currentLocale();

  useEffect(() => {
    document.title = `${pageTitle} · ${t('app.fullName')}`;
  }, [pageTitle, t]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
      setLogoutOpen(false);
    }
  };

  const renderNav = (extended: boolean) => (
    <List component="nav" sx={{ width: '100%', px: extended ? 0.5 : 0 }}>
      {items.map((item) => {
        const active = item === activeItem;
        return (
          /* 真实链接（可中键新标签打开 / 读屏器识别为 navigation），选中态由 activeItem 驱动 */
          <ListItemButton
            key={item.to}
            component={RouterLink}
            to={item.to}
            selected={active}
            aria-current={active ? 'page' : undefined}
            sx={navButtonSx(extended)}
          >
            <ListItemIcon sx={{ color: 'inherit', justifyContent: 'center' }}>
              {item.icon}
            </ListItemIcon>
            <ListItemText
              primary={item.label}
              sx={{
                m: 0,
                '& .MuiListItemText-primary': extended
                  ? { ...md3Geometry.type.labelLarge }
                  : { ...md3Geometry.type.labelMedium, textAlign: 'center' },
              }}
            />
          </ListItemButton>
        );
      })}
    </List>
  );

  const brand = (extended: boolean) => (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{ px: extended ? 2 : 0, py: 1.5, justifyContent: 'center' }}
    >
      <Avatar sx={{ bgcolor: 'var(--mui-palette-primaryContainer)', color: 'var(--mui-palette-onPrimaryContainer)' }}>
        <SmsRoundedIcon fontSize="small" />
      </Avatar>
      {extended ? (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="titleMedium" noWrap>
            {t('app.name')}
          </Typography>
          <Typography variant="labelSmall" color="text.secondary" noWrap>
            SMSForwarder
          </Typography>
        </Box>
      ) : null}
    </Stack>
  );

  /**
   * 侧栏主操作（Gmail「Compose」式的 navigation drawer action）：
   * 展开态是 secondaryContainer 底的「图标 + 文字」56px 按钮（圆角 16）；
   * 收起态是 56×56 图标按钮。移动端没有常驻 rail，仍走右下角悬浮 FAB。
   */
  const railAction = (extended: boolean) => (
    <ButtonBase
      aria-label={t('devices.add')}
      onClick={() => navigate('/devices?new=1')}
      sx={(theme) => {
        const { palette } = themeVars(theme);
        return {
          mx: extended ? 1 : 'auto',
          mb: 1,
          width: extended ? 'auto' : md3Geometry.height.fab,
          height: md3Geometry.height.fab,
          borderRadius: md3Geometry.shape.lg,
          bgcolor: 'var(--mui-palette-secondaryContainer)',
          color: 'var(--mui-palette-onSecondaryContainer)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: extended ? `${md3Geometry.space.x3}px` : 0,
          px: extended ? `${md3Geometry.space.x4}px` : 0,
          alignSelf: extended ? 'stretch' : 'center',
          ...md3Geometry.type.titleSmall,
          transition: theme.transitions.create(['background-color'], { duration: theme.transitions.duration.shortest }),
          '&:hover': {
            backgroundColor: `color-mix(in srgb, ${palette.onSecondaryContainer} 8%, ${palette.secondaryContainer})`,
          },
        };
      }}
    >
      <AddRoundedIcon />
      {extended ? t('devices.add') : null}
    </ButtonBase>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
      {/* 桌面 Navigation rail / Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          /* 展开 240 / 收起按 MD3 nav rail 80 */
          width: extendedRail ? SHELL.railExtendedWidth : md3Geometry.width.navRail,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: extendedRail ? SHELL.railExtendedWidth : md3Geometry.width.navRail,
            boxSizing: 'border-box',
            border: 'none',
            px: extendedRail ? 1 : 0.5,
            py: 1,
            bgcolor: 'var(--mui-palette-surface)',
            overflowX: 'hidden',
          },
        }}
      >
        {brand(extendedRail)}
        {railAction(extendedRail)}
        {renderNav(extendedRail)}
      </Drawer>

      {/* 移动端临时 Drawer */}
      <Drawer
        variant="temporary"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: SHELL.mobileDrawerWidth, p: 1 } }}
      >
        {brand(true)}
        <Divider sx={{ my: 1 }} />
        {renderNav(true)}
      </Drawer>

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AppBar position="sticky">
          <Toolbar sx={{ gap: 1 }}>
            <IconButton
              aria-label={t('nav.openMenu')}
              onClick={() => setDrawerOpen(true)}
              sx={{ display: { xs: 'inline-flex', md: 'none' } }}
            >
              <MenuRoundedIcon />
            </IconButton>
            <Typography variant="titleLarge" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
              {pageTitle}
            </Typography>
            <Tooltip title={t('nav.toggleTheme')}>
              <IconButton
                aria-label={t('nav.toggleTheme')}
                aria-haspopup="menu"
                aria-expanded={modeMenuAnchor ? 'true' : undefined}
                aria-controls={modeMenuAnchor ? 'theme-mode-menu' : undefined}
                onClick={(event) => setModeMenuAnchor(event.currentTarget)}
              >
                {MODE_ICONS[mode === 'system' ? 'system' : resolvedMode]}
              </IconButton>
            </Tooltip>
            <Tooltip title={t('nav.userMenu')}>
              <IconButton
                aria-label={t('nav.userMenu')}
                aria-haspopup="menu"
                aria-expanded={userMenuAnchor ? 'true' : undefined}
                aria-controls={userMenuAnchor ? 'user-menu' : undefined}
                onClick={(event) => setUserMenuAnchor(event.currentTarget)}
                sx={{ p: 0.5 }}
              >
                <Avatar
                  src={user ? avatarUrl(user) : undefined}
                  sx={{
                    width: 34,
                    height: 34,
                    fontSize: 14,
                    bgcolor: 'var(--mui-palette-primaryContainer)',
                    color: 'var(--mui-palette-onPrimaryContainer)',
                  }}
                >
                  {user?.has_avatar ? null : initialsOf(user?.display_name || user?.username || '')}
                </Avatar>
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            width: '100%',
            maxWidth: SHELL.contentMaxWidth,
            mx: 'auto',
            px: { xs: 2, md: 3 },
            py: { xs: 2, md: 3 },
          }}
        >
          <Outlet />
        </Box>

        {/* 主操作在桌面由侧栏 rail action 承担；悬浮 FAB 只在移动端出现（md3 nav drawer 惯例） */}
        {activeItem?.to === '/' ? (
          <Fab
            color="primary"
            variant={showExtendedFab ? 'extended' : 'circular'}
            aria-label={t('devices.add')}
            onClick={() => navigate('/devices?new=1')}
            sx={{
              display: { xs: 'flex', md: 'none' },
              position: 'fixed',
              right: `${md3Geometry.space.x4}px`,
              bottom: `${md3Geometry.space.x4}px`,
              zIndex: (theme2: Theme) => theme2.zIndex.speedDial,
            }}
          >
            <AddRoundedIcon />
            {showExtendedFab ? (
              <Box component="span">{t('devices.add')}</Box>
            ) : null}
          </Fab>
        ) : null}
      </Box>

      {/* 主题模式菜单 */}
      <Menu
        id="theme-mode-menu"
        anchorEl={modeMenuAnchor}
        open={Boolean(modeMenuAnchor)}
        onClose={() => setModeMenuAnchor(null)}
      >
        {(['light', 'dark', 'system'] as ThemeMode[]).map((value) => (
          <MenuItem
            key={value}
            selected={mode === value}
            onClick={() => {
              setMode(value);
              setModeMenuAnchor(null);
            }}
          >
            <ListItemIcon>{MODE_ICONS[value]}</ListItemIcon>
            <ListItemText>{t(MODE_LABEL_KEYS[value])}</ListItemText>
            {mode === value ? <CheckRoundedIcon fontSize="small" /> : null}
          </MenuItem>
        ))}
      </Menu>

      {/* 用户菜单 */}
      <Menu
        id="user-menu"
        anchorEl={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        onClose={() => setUserMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 260 } } }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar
              src={user ? avatarUrl(user) : undefined}
              sx={{
                bgcolor: 'var(--mui-palette-primaryContainer)',
                color: 'var(--mui-palette-onPrimaryContainer)',
              }}
            >
              {user?.has_avatar ? null : initialsOf(user?.display_name || user?.username || '')}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="titleSmall" noWrap>
                {user?.display_name || user?.username}
              </Typography>
              <Typography variant="bodySmall" color="text.secondary" noWrap>
                {user?.username}
              </Typography>
            </Box>
            {user?.is_admin ? (
              <Chip size="small" label={t('nav.adminBadge')} sx={{ ml: 'auto' }} />
            ) : null}
          </Stack>
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            setUserMenuAnchor(null);
            navigate('/settings');
          }}
        >
          <ListItemIcon>
            <SettingsOutlinedIcon />
          </ListItemIcon>
          <ListItemText>{t('nav.settings')}</ListItemText>
        </MenuItem>
        <Divider sx={{ my: 0.5 }} />
        {(['zh', 'en'] as AppLocale[]).map((locale) => (
          <MenuItem
            key={locale}
            selected={activeLocale === locale}
            onClick={() => {
              switchLocale(locale);
              setUserMenuAnchor(null);
            }}
          >
            {/* 无 leading icon 的行文字与 icon 行文字同一起点（12 + 32 = 44px） */}
            <ListItemText sx={{ pl: `${md3Geometry.icon.md + md3Geometry.space.x3 * 2}px` }}>
              {locale === 'zh' ? t('nav.languageZh') : t('nav.languageEn')}
            </ListItemText>
            {activeLocale === locale ? <CheckRoundedIcon fontSize="small" /> : null}
          </MenuItem>
        ))}
        <Divider sx={{ my: 0.5 }} />
        <MenuItem
          onClick={() => {
            setUserMenuAnchor(null);
            setLogoutOpen(true);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}>
            <LogoutRoundedIcon />
          </ListItemIcon>
          <ListItemText>{t('nav.logout')}</ListItemText>
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={logoutOpen}
        title={t('auth.logout.title')}
        description={t('auth.logout.body')}
        confirmText={t('auth.logout.confirm')}
        tone="danger"
        loading={loggingOut}
        onConfirm={() => void handleLogout()}
        onClose={() => setLogoutOpen(false)}
      />
    </Box>
  );
}
