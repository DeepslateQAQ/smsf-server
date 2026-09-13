import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import PersonAddAltRoundedIcon from '@mui/icons-material/PersonAddAltRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router';
import { z } from 'zod';

import { useSetupStatus } from '@/api/queries';
import { describeError } from '@/components/LoadingBoundary';
import { useT } from '@/i18n';

import AuthShell from './AuthShell';
import { useAuth } from './AuthProvider';
import { evaluatePassword } from './passwordStrength';

interface SetupFormValues {
  display_name: string;
  username: string;
  password: string;
  confirm_password: string;
}

const STRENGTH_COLORS = ['error', 'error', 'warning', 'success', 'success'] as const;

export default function SetupPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, setup } = useAuth();
  const setupStatus = useSetupStatus();
  const [formError, setFormError] = useState('');

  const schema = useMemo(
    () =>
      z
        .object({
          display_name: z.string().max(64, t('validation.displayNameLength')),
          username: z
            .string()
            .min(1, t('validation.required'))
            .max(64, t('validation.usernameLength')),
          password: z.string().min(8, t('validation.passwordLength')).max(256),
          confirm_password: z.string().min(1, t('validation.required')),
        })
        .refine((values) => values.password === values.confirm_password, {
          path: ['confirm_password'],
          message: t('errors.password_mismatch'),
        }),
    [t],
  );

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SetupFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: '', username: '', password: '', confirm_password: '' },
  });

  const password = watch('password');
  const strength = evaluatePassword(password ?? '');
  const ruleRows = [
    { ok: strength.checks.length, label: t('auth.setup.ruleLength') },
    { ok: strength.checks.mixedCase, label: t('auth.setup.ruleCase') },
    { ok: strength.checks.digit, label: t('auth.setup.ruleDigit') },
    { ok: strength.checks.symbol, label: t('auth.setup.ruleSymbol') },
  ];

  if (user) return <Navigate to="/" replace />;

  const alreadySetUp = !setupStatus.isLoading && setupStatus.data?.setup_required === false;

  const onSubmit = handleSubmit(async (values) => {
    setFormError('');
    try {
      await setup({
        username: values.username,
        password: values.password,
        display_name: values.display_name,
      });
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(describeError(error, t));
    }
  });

  if (alreadySetUp) {
    return (
      <AuthShell title={t('auth.setup.title')} subtitle={t('auth.setup.alreadyDone')}>
        <Stack spacing={2}>
          <Alert severity="info">{t('errors.already_setup')}</Alert>
          <Button variant="contained" onClick={() => navigate('/login', { replace: true })}>
            {t('auth.login.submit')}
          </Button>
        </Stack>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.setup.title')} subtitle={t('auth.setup.subtitle')}>
      <Box component="form" onSubmit={onSubmit} noValidate>
        <Stack spacing={2}>
          {formError ? <Alert severity="error">{formError}</Alert> : null}
          <TextField
            {...register('display_name')}
            label={t('auth.setup.displayName')}
            placeholder={t('auth.setup.displayNamePlaceholder')}
            autoComplete="name"
            fullWidth
            error={Boolean(errors.display_name)}
            helperText={errors.display_name?.message}
            disabled={isSubmitting}
          />
          <TextField
            {...register('username')}
            label={t('auth.setup.username')}
            autoComplete="username"
            autoFocus
            fullWidth
            error={Boolean(errors.username)}
            helperText={errors.username?.message ?? t('validation.usernameLength')}
            disabled={isSubmitting}
          />
          <TextField
            {...register('password')}
            label={t('auth.setup.password')}
            type="password"
            autoComplete="new-password"
            fullWidth
            error={Boolean(errors.password)}
            helperText={errors.password?.message ?? t('validation.passwordLength')}
            disabled={isSubmitting}
          />

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="labelMedium" color="text.secondary">
                {t('auth.setup.strength')}
              </Typography>
              <Typography
                variant="labelMedium"
                color={password ? `${STRENGTH_COLORS[strength.score]}.main` : 'text.secondary'}
              >
                {password ? t(strength.labelKey) : '—'}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={(strength.score / 4) * 100}
              color={STRENGTH_COLORS[strength.score]}
            />
            <List dense disablePadding sx={{ mt: 1 }}>
              {ruleRows.map((row) => (
                <ListItem key={row.label} disableGutters sx={{ py: 0, minHeight: 24 }}>
                  <ListItemIcon sx={{ minWidth: 26 }}>
                    {row.ok ? (
                      <CheckCircleRoundedIcon fontSize="small" color="success" />
                    ) : (
                      <RadioButtonUncheckedRoundedIcon fontSize="small" color="disabled" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={row.label}
                    slotProps={{ primary: { variant: 'bodySmall' } }}
                    sx={{ color: row.ok ? 'text.primary' : 'text.secondary' }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>

          <TextField
            {...register('confirm_password')}
            label={t('auth.setup.confirmPassword')}
            type="password"
            autoComplete="new-password"
            fullWidth
            error={Boolean(errors.confirm_password)}
            helperText={errors.confirm_password?.message}
            disabled={isSubmitting}
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={isSubmitting}
            startIcon={
              isSubmitting ? <CircularProgress size={18} color="inherit" /> : <PersonAddAltRoundedIcon />
            }
          >
            {isSubmitting ? t('auth.setup.submitting') : t('auth.setup.submit')}
          </Button>

          <Typography variant="bodySmall" color="text.secondary" textAlign="center">
            {t('auth.setup.hint')}
          </Typography>
        </Stack>
      </Box>
    </AuthShell>
  );
}
