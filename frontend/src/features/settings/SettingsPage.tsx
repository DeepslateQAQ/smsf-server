import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  ListItemButton,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import BrightnessAutoOutlinedIcon from '@mui/icons-material/BrightnessAutoOutlined';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import UploadOutlinedIcon from '@mui/icons-material/UploadOutlined';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import type { ThemeMode, UserOut } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { describeError } from '@/components/LoadingBoundary';
import TonalButton from '@/components/TonalButton';
import { queryKeys } from '@/api/queries';
import { avatarUrl, deleteAvatar, uploadAvatar, validateAvatarFile, AVATAR_MAX_BYTES } from '@/api/avatar';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocaleSwitch } from '@/features/auth/useLocaleSwitch';
import { currentLocale, useT, type AppLocale } from '@/i18n';
import { THEME_PRESETS, md3Geometry, normalizeHex, stateLayer, themeVars } from '@/theme';
import { useThemeMode } from '@/theme/ThemeModeProvider';
import { formatDateTime } from '@/lib/format';

interface PasswordFormValues {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

/** 账户页头像行：预览 + 上传/更换 + 移除（实现服务的「重新编码」语义；变更错误就地显示）。 */
function AccountAvatarRow({
  user,
  busy,
  onPick,
  onRemove,
}: {
  user: UserOut | null;
  busy: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const src = user ? avatarUrl(user) : undefined;
  const display = (user?.display_name || user?.username || '?').trim();
  return (
    <>
      <Avatar
        src={src}
        alt={display}
        sx={{ width: md3Geometry.height.fab, height: md3Geometry.height.fab }}
      >
        {Array.from(display).slice(0, 2).join('')}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography variant="labelLarge" sx={{ display: 'block' }}>
          {t('settings.avatar')}
        </Typography>
        <Typography variant="bodySmall" color="text.secondary">
          {t('settings.avatarHint')}
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
        <Button
          component="label"
          variant="outlined"
          size="small"
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <UploadOutlinedIcon />}
          disabled={busy}
        >
          {user?.has_avatar ? t('settings.avatarReplace') : t('settings.avatarUpload')}
          <Box
            component="input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            sx={{ display: 'none' }}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) onPick(file);
            }}
          />
        </Button>
        {user?.has_avatar ? (
          <Button size="small" color="error" variant="text" disabled={busy} onClick={onRemove}>
            {t('settings.avatarRemove')}
          </Button>
        ) : null}
      </Stack>
    </>
  );
}

function TabPanel({ value, index, children }: { value: number; index: number; children: React.ReactNode }) {
  if (value !== index) return null;
  return (
    <Box
      role="tabpanel"
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      sx={{ pt: 3 }}
    >
      {children}
    </Box>
  );
}

export default function SettingsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, changePassword, logout } = useAuth();
  const switchLocale = useLocaleSwitch();
  const { seed, mode, setSeed, setMode, resetSeed, syncState } = useThemeMode();
  const [tab, setTab] = useState(0);
  const [hexInput, setHexInput] = useState(seed);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const locale = currentLocale();
  const queryClient = useQueryClient();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const handleAvatarPick = async (file: File) => {
    setAvatarError(null);
    const invalid = validateAvatarFile(file);
    if (invalid) {
      setAvatarError(
        invalid === 'type'
          ? t('settings.avatarInvalidType')
          : t('settings.avatarTooLarge', { mb: AVATAR_MAX_BYTES / 1024 / 1024 }),
      );
      return;
    }
    setAvatarBusy(true);
    try {
      const updated = await uploadAvatar(file);
      queryClient.setQueryData(queryKeys.me, updated);
    } catch (error) {
      setAvatarError(describeError(error, t));
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const updated = await deleteAvatar();
      queryClient.setQueryData(queryKeys.me, updated);
    } catch (error) {
      setAvatarError(describeError(error, t));
    } finally {
      setAvatarBusy(false);
    }
  };

  const schema = useMemo(
    () =>
      z
        .object({
          current_password: z.string().min(1, t('validation.required')),
          new_password: z.string().min(8, t('validation.passwordLength')).max(256),
          confirm_password: z.string().min(1, t('validation.required')),
        })
        .refine((values) => values.new_password === values.confirm_password, {
          path: ['confirm_password'],
          message: t('errors.password_mismatch'),
        }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  const onSubmitPassword = handleSubmit(async (values) => {
    setPasswordError('');
    setPasswordSaved(false);
    try {
      await changePassword({
        current_password: values.current_password,
        new_password: values.new_password,
      });
      reset();
      setPasswordSaved(true);
    } catch (error) {
      setPasswordError(describeError(error, t));
    }
  });

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

  const applyHex = (value: string) => {
    setHexInput(value);
    const normalized = normalizeHex(value);
    if (normalized) setSeed(normalized);
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="headlineSmall" component="h1">
          {t('settings.title')}
        </Typography>
        <Typography variant="bodyMedium" color="text.secondary">
          {t('settings.subtitle')}
        </Typography>
      </Box>

      <Tabs
        value={tab}
        onChange={(_event, next: number) => setTab(next)}
        variant="scrollable"
        allowScrollButtonsMobile
        aria-label={t('settings.title')}
      >
        <Tab
          label={t('settings.tabs.appearance')}
          id="settings-tab-0"
          aria-controls="settings-tabpanel-0"
        />
        <Tab label={t('settings.tabs.account')} id="settings-tab-1" aria-controls="settings-tabpanel-1" />
        <Tab
          label={t('settings.tabs.security')}
          id="settings-tab-2"
          aria-controls="settings-tabpanel-2"
        />
      </Tabs>

      <TabPanel value={tab} index={0}>
        <Stack spacing={3}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
                <PaletteOutlinedIcon color="primary" />
                <Box>
                  <Typography variant="titleMedium">{t('settings.themeSeed')}</Typography>
                  <Typography variant="bodySmall" color="text.secondary">
                    {t('settings.appearanceHint')}
                  </Typography>
                </Box>
              </Stack>

              <Typography variant="labelMedium" color="text.secondary" sx={{ mb: 1 }}>
                {t('settings.presets')}
              </Typography>
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5} sx={{ mb: 3 }}>
                {THEME_PRESETS.map((preset) => {
                  const selected = normalizeHex(seed) === preset.color;
                  return (
                    <Tooltip key={preset.id} title={preset.color}>
                      <ButtonBase
                        aria-label={t(preset.labelKey)}
                        aria-pressed={selected}
                        onClick={() => {
                          setSeed(preset.color);
                          setHexInput(preset.color);
                        }}
                        sx={(theme) => {
                          const { palette } = themeVars(theme);
                          return {
                            width: 48,
                            height: 48,
                            borderRadius: md3Geometry.shape.lg,
                            bgcolor: preset.color,
                            cursor: 'pointer',
                            display: 'grid',
                            placeItems: 'center',
                            color: palette.common.white,
                            border: `${md3Geometry.border.standard}px solid`,
                            borderColor: selected ? palette.outline : 'transparent',
                            // 选中/悬停环沿用主题里 space.x1 的 ring 约定。
                            boxShadow: selected
                              ? `0 0 0 ${md3Geometry.space.x1}px ${palette.primaryContainer}`
                              : 'none',
                            transition: 'box-shadow .2s, border-color .2s',
                            '&:hover': {
                              boxShadow: `0 0 0 ${md3Geometry.space.x1}px ${palette.surfaceContainerHighest}`,
                            },
                            '&:focus-visible': {
                              outline: `${md3Geometry.border.standard}px solid ${palette.primary}`,
                              outlineOffset: `${md3Geometry.border.standard}px`,
                            },
                          };
                        }}
                      >
                        {selected ? <CheckRoundedIcon fontSize="small" /> : null}
                      </ButtonBase>
                    </Tooltip>
                  );
                })}
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                {/* 原生 <input type=color> 是唯一可靠的跨浏览器取色弹层，但外观做成 M3 swatch：
                    圆角容器 + 轮廓边 + 内缩色块，与预设色板同一视觉家族。 */}
                <Box
                  component="input"
                  type="color"
                  value={normalizeHex(hexInput) ?? seed}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => applyHex(event.target.value)}
                  aria-label={t('settings.themeSeedCustom')}
                  sx={{
                    width: 64,
                    height: 48,
                    p: 0,
                    border: `${md3Geometry.border.hairline}px solid`,
                    borderColor: 'var(--mui-palette-outlineVariant)',
                    borderRadius: md3Geometry.shape.md,
                    bgcolor: 'var(--mui-palette-surfaceContainerHigh)',
                    cursor: 'pointer',
                    // 伪元素样式也会走 theme.spacing 换算，必须显式 px，否则 4×8=32 把 swatch 挤没
                    '&::-webkit-color-swatch-wrapper': { p: `${md3Geometry.space.x1}px` },
                    '&::-webkit-color-swatch': { border: 'none', borderRadius: md3Geometry.shape.sm },
                    '&::-moz-color-swatch': { border: 'none', borderRadius: md3Geometry.shape.sm },
                    transition: 'box-shadow 120ms ease',
                    '&:hover': { boxShadow: `0 0 0 ${md3Geometry.space.x1}px color-mix(in srgb, var(--mui-palette-onSurface) 8%, transparent)` },
                    '&:focus-visible': {
                      outline: `${md3Geometry.border.standard}px solid var(--mui-palette-primary)`,
                      outlineOffset: md3Geometry.border.standard,
                    },
                  }}
                />
                <TextField
                  value={hexInput}
                  onChange={(event) => applyHex(event.target.value)}
                  label={t('settings.themeSeedCustom')}
                  helperText={
                    normalizeHex(hexInput) ? t('settings.themeSeedCustomHint') : t('settings.themeSeedInvalid')
                  }
                  error={!normalizeHex(hexInput)}
                  size="small"
                  sx={{ maxWidth: 260 }}
                />
                <Button variant="text" onClick={resetSeed} startIcon={<PaletteOutlinedIcon />}>
                  {t('settings.resetSeeds')}
                </Button>
              </Stack>

              {syncState === 'error' ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  {t('settings.syncFailed')}
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              {/* 设置行惯例：文本块居左、控件居右；行间用 divider 分隔 */}
              <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                <Typography variant="titleMedium">{t('settings.mode')}</Typography>
                <ToggleButtonGroup
                  exclusive
                  value={mode}
                  onChange={(_event, next: ThemeMode | null) => {
                    if (next) setMode(next);
                  }}
                  aria-label={t('settings.mode')}
                  sx={{ flexWrap: 'wrap' }}
                >
                  <ToggleButton value="light">
                    <LightModeOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
                    {t('settings.modeLight')}
                  </ToggleButton>
                  <ToggleButton value="dark">
                    <DarkModeOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
                    {t('settings.modeDark')}
                  </ToggleButton>
                  <ToggleButton value="system">
                    <BrightnessAutoOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
                    {t('settings.modeSystem')}
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>

              <Divider sx={{ my: 2.5 }} />

              <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                <Box>
                  <Typography variant="titleMedium">{t('settings.language')}</Typography>
                  <Typography variant="bodySmall" color="text.secondary">
                    {t('settings.languageHint')}
                  </Typography>
                </Box>
                <ToggleButtonGroup
                  exclusive
                  value={locale}
                  onChange={(_event, next: AppLocale | null) => {
                    if (next) switchLocale(next);
                  }}
                  aria-label={t('settings.language')}
                >
                  <ToggleButton value="zh">{t('nav.languageZh')}</ToggleButton>
                  <ToggleButton value="en">{t('nav.languageEn')}</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="titleMedium" sx={{ mb: 2 }}>
                {t('settings.preview')}
              </Typography>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <Button variant="contained">{t('settings.previewButton')}</Button>
                  <TonalButton>{t('settings.previewButton')}</TonalButton>
                  <Button variant="outlined">{t('settings.previewButton')}</Button>
                  <Button variant="text">{t('settings.previewButton')}</Button>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip label={t('settings.themeSeed')} color="primary" />
                  <Chip label={t('messages.code')} variant="outlined" />
                  <Chip label={seed} sx={{ fontFamily: 'monospace' }} />
                </Stack>
                <ListItemButton
                  component="div"
                  sx={{
                    border: '1px solid',
                    borderColor: 'var(--mui-palette-outlineVariant)',
                    '&:hover': { backgroundColor: stateLayer(seed, 8) },
                  }}
                >
                  <ListItemText
                    primary={t('settings.previewList')}
                    secondary={t('settings.appearanceHint')}
                  />
                </ListItemButton>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </TabPanel>

      <TabPanel value={tab} index={1}>
        <Card>
          <CardContent>
            <Typography variant="titleMedium" sx={{ mb: 0.5 }}>
              {t('settings.account')}
            </Typography>
            <Typography variant="bodySmall" color="text.secondary" sx={{ mb: 3 }}>
              {t('settings.accountHint')}
            </Typography>

            {/* 头像：服务端重新编码 + 居中裁方；上传后可即时预览（avatar_updated_at 指纹换缓存） */}
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              /* 窄屏允许换行到下一行（按钮组右侧对齐），不允许把卡片撑破 */
              sx={{ mb: 3, flexWrap: 'wrap', rowGap: 1 }}
            >
              <AccountAvatarRow user={user} busy={avatarBusy} onPick={handleAvatarPick} onRemove={handleAvatarRemove} />
              {avatarError ? (
                <Alert severity="error" sx={{ mt: 1, flexBasis: '100%' }}>
                  {avatarError}
                </Alert>
              ) : null}
            </Stack>

            <Stack spacing={2.5} sx={{ maxWidth: 480 }}>
              <TextField label={t('settings.username')} value={user?.username ?? ''} disabled fullWidth />
              <TextField
                label={t('settings.displayName')}
                value={user?.display_name ?? ''}
                disabled
                fullWidth
                helperText={t('settings.displayNameHint')}
              />
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="labelMedium" color="text.secondary" sx={{ minWidth: 96 }}>
                  {t('settings.role')}
                </Typography>
                <Chip
                  label={user?.is_admin ? t('settings.roleAdmin') : t('settings.roleUser')}
                  color={user?.is_admin ? 'primary' : 'default'}
                />
              </Stack>
              <Stack direction="row" spacing={2}>
                <Typography variant="labelMedium" color="text.secondary" sx={{ minWidth: 96 }}>
                  {t('settings.createdAt')}
                </Typography>
                <Typography variant="bodyMedium">{formatDateTime(user?.created_at ?? '')}</Typography>
              </Stack>
              <Stack direction="row" spacing={2}>
                <Typography variant="labelMedium" color="text.secondary" sx={{ minWidth: 96 }}>
                  {t('settings.lastLoginAt')}
                </Typography>
                <Typography variant="bodyMedium">
                  {user?.last_login_at ? formatDateTime(user.last_login_at) : t('common.never')}
                </Typography>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel value={tab} index={2}>
        <Stack spacing={3}>
          <Card>
            <CardContent>
              <Typography variant="titleMedium" sx={{ mb: 0.5 }}>
                {t('auth.password.title')}
              </Typography>
              <Typography variant="bodySmall" color="text.secondary" sx={{ mb: 3 }}>
                {t('settings.passwordHint')}
              </Typography>
              <Box
                component="form"
                onSubmit={onSubmitPassword}
                noValidate
                sx={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                {passwordError ? <Alert severity="error">{passwordError}</Alert> : null}
                {passwordSaved ? <Alert severity="success">{t('auth.password.success')}</Alert> : null}
                <TextField
                  {...register('current_password')}
                  type="password"
                  autoComplete="current-password"
                  label={t('auth.password.current')}
                  error={Boolean(errors.current_password)}
                  helperText={errors.current_password?.message}
                  disabled={isSubmitting}
                />
                <TextField
                  {...register('new_password')}
                  type="password"
                  autoComplete="new-password"
                  label={t('auth.password.next')}
                  error={Boolean(errors.new_password)}
                  helperText={errors.new_password?.message ?? t('validation.passwordLength')}
                  disabled={isSubmitting}
                />
                <TextField
                  {...register('confirm_password')}
                  type="password"
                  autoComplete="new-password"
                  label={t('auth.password.confirm')}
                  error={Boolean(errors.confirm_password)}
                  helperText={errors.confirm_password?.message}
                  disabled={isSubmitting}
                />
                <Box>
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={isSubmitting}
                    startIcon={
                      isSubmitting ? <CircularProgress size={18} color="inherit" /> : <SaveRoundedIcon />
                    }
                  >
                    {isSubmitting ? t('auth.password.submitting') : t('auth.password.submit')}
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="titleMedium" sx={{ mb: 0.5 }}>
                {t('nav.account')}
              </Typography>
              <Typography variant="bodySmall" color="text.secondary" sx={{ mb: 3 }}>
                {t('auth.logout.body')}
              </Typography>
              <Button
                variant="outlined"
                color="error"
                startIcon={<LogoutRoundedIcon />}
                onClick={() => setLogoutOpen(true)}
              >
                {t('nav.logout')}
              </Button>
            </CardContent>
          </Card>
        </Stack>
      </TabPanel>

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
    </Stack>
  );
}
