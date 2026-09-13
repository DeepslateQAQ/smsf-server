import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, CircularProgress, Divider, Stack, TextField, Typography } from '@mui/material';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';

import { useSetupStatus } from '@/api/queries';
import { describeError } from '@/components/LoadingBoundary';
import { useT } from '@/i18n';

import AuthShell from './AuthShell';
import { useAuth } from './AuthProvider';

interface LoginFormValues {
  username: string;
  password: string;
}

export default function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();
  const setupStatus = useSetupStatus();
  const [formError, setFormError] = useState('');

  const schema = useMemo(
    () =>
      z.object({
        username: z
          .string()
          .min(1, t('validation.required'))
          .max(64, t('validation.usernameLength')),
        password: z.string().min(1, t('validation.required')).max(256),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  if (user) return <Navigate to="/" replace />;

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  const onSubmit = handleSubmit(async (values) => {
    setFormError('');
    try {
      await login(values);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setFormError(describeError(error, t));
    }
  });

  return (
    <AuthShell title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      <Box component="form" onSubmit={onSubmit} noValidate>
        <Stack spacing={2}>
          {formError ? <Alert severity="error">{formError}</Alert> : null}
          <TextField
            {...register('username')}
            label={t('auth.login.username')}
            autoComplete="username"
            autoFocus
            fullWidth
            error={Boolean(errors.username)}
            helperText={errors.username?.message}
            disabled={isSubmitting}
          />
          <TextField
            {...register('password')}
            label={t('auth.login.password')}
            type="password"
            autoComplete="current-password"
            fullWidth
            error={Boolean(errors.password)}
            helperText={errors.password?.message}
            disabled={isSubmitting}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={isSubmitting}
            startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : <LoginRoundedIcon />}
            sx={{ mt: 1 }}
          >
            {isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
          </Button>
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Stack spacing={1} sx={{ alignItems: 'center' }}>
          {setupStatus.data?.allow_public_registration ? (
            <Typography variant="bodyMedium" color="text.secondary">
              {t('auth.login.noAccount')}{' '}
              <Typography
                component={RouterLink}
                to="/register"
                variant="bodyMedium"
                sx={{ color: 'primary.main', textDecoration: 'none' }}
              >
                {t('auth.login.register')}
              </Typography>
            </Typography>
          ) : (
            <Typography variant="bodySmall" color="text.secondary" textAlign="center">
              {t('auth.register.closedHint')}
            </Typography>
          )}
          {setupStatus.data?.setup_required ? (
            <Typography
              component={RouterLink}
              to="/setup"
              variant="bodySmall"
              sx={{ color: 'primary.main', textDecoration: 'none' }}
            >
              {t('auth.login.needSetup')}
            </Typography>
          ) : null}
          <Typography variant="bodySmall" color="text.secondary" textAlign="center">
            {t('auth.login.forgot')}
          </Typography>
        </Stack>
      </Box>
    </AuthShell>
  );
}
