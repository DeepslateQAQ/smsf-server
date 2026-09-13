import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, CircularProgress, Divider, Stack, TextField, Typography } from '@mui/material';
import HowToRegRoundedIcon from '@mui/icons-material/HowToRegRounded';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, Navigate, useNavigate } from 'react-router';
import { z } from 'zod';

import { useSetupStatus } from '@/api/queries';
import EmptyState from '@/components/EmptyState';
import { describeError } from '@/components/LoadingBoundary';
import { useT } from '@/i18n';

import AuthShell from './AuthShell';
import { useAuth } from './AuthProvider';

interface RegisterFormValues {
  display_name: string;
  username: string;
  password: string;
  confirm_password: string;
}

export default function RegisterPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, register: registerAccount } = useAuth();
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
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: '', username: '', password: '', confirm_password: '' },
  });

  if (user) return <Navigate to="/" replace />;

  // 仅当 setup-status 返回开放注册时可访问
  const registrationClosed =
    !setupStatus.isLoading && setupStatus.data?.allow_public_registration === false;

  const onSubmit = handleSubmit(async (values) => {
    setFormError('');
    try {
      await registerAccount({
        username: values.username,
        password: values.password,
        display_name: values.display_name,
      });
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(describeError(error, t));
    }
  });

  if (registrationClosed) {
    return (
      <AuthShell title={t('auth.register.title')} subtitle={t('auth.register.subtitle')}>
        <EmptyState
          title={t('auth.register.closed')}
          description={t('auth.register.closedHint')}
          action={
            <Button variant="contained" onClick={() => navigate('/login', { replace: true })}>
              {t('auth.register.backToLogin')}
            </Button>
          }
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.register.title')} subtitle={t('auth.register.subtitle')}>
      <Box component="form" onSubmit={onSubmit} noValidate>
        <Stack spacing={2}>
          {formError ? <Alert severity="error">{formError}</Alert> : null}
          <TextField
            {...register('display_name')}
            label={t('auth.register.displayName')}
            autoComplete="name"
            fullWidth
            error={Boolean(errors.display_name)}
            helperText={errors.display_name?.message}
            disabled={isSubmitting}
          />
          <TextField
            {...register('username')}
            label={t('auth.register.username')}
            autoComplete="username"
            autoFocus
            fullWidth
            error={Boolean(errors.username)}
            helperText={errors.username?.message ?? t('validation.usernameLength')}
            disabled={isSubmitting}
          />
          <TextField
            {...register('password')}
            label={t('auth.register.password')}
            type="password"
            autoComplete="new-password"
            fullWidth
            error={Boolean(errors.password)}
            helperText={errors.password?.message ?? t('validation.passwordLength')}
            disabled={isSubmitting}
          />
          <TextField
            {...register('confirm_password')}
            label={t('auth.register.confirmPassword')}
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
            startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : <HowToRegRoundedIcon />}
          >
            {isSubmitting ? t('auth.register.submitting') : t('auth.register.submit')}
          </Button>
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Typography
          component={RouterLink}
          to="/login"
          variant="bodyMedium"
          sx={{ display: 'block', textAlign: 'center', color: 'primary.main', textDecoration: 'none' }}
        >
          {t('auth.register.backToLogin')}
        </Typography>
      </Box>
    </AuthShell>
  );
}
