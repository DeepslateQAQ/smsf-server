import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';

import ConfirmDialog from '@/components/ConfirmDialog';
import CopyButton from '@/components/CopyButton';
import EmptyState from '@/components/EmptyState';
import LoadingBoundary, { describeError } from '@/components/LoadingBoundary';
import { useT } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import type { AdminUserCreate, Role, UserOut } from '@/api/types';
import { useMe } from '@/api/queries';

import {
  adminKeys,
  useAdminUsers,
  useCreateAdminUser,
  useDeleteAdminUser,
  useResetAdminUserPassword,
  useUpdateAdminUser,
} from './queries';
import { useAdminCopy } from './useAdminCopy';

interface OneTimePassword {
  username: string;
  password: string;
}

function CreateUserDialog({
  open,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: AdminUserCreate) => void;
}) {
  const copy = useAdminCopy();
  const t = useT();
  const [values, setValues] = useState<AdminUserCreate>({
    username: '',
    display_name: '',
    password: '',
    role: 'user',
  });
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues({ username: '', display_name: '', password: '', role: 'user' });
    setTouched(false);
  }, [open]);

  const usernameMissing = values.username.trim().length === 0;

  const handleSubmit = () => {
    setTouched(true);
    if (usernameMissing) return;
    onSubmit({
      username: values.username.trim(),
      display_name: values.display_name?.trim() ?? '',
      password: values.password ? values.password : null,
      role: values.role ?? 'user',
    });
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{copy.users.addTitle}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Typography variant="bodySmall" color="text.secondary">
            {copy.users.addSubtitle}
          </Typography>
          <TextField
            autoFocus
            required
            fullWidth
            label={copy.users.username}
            placeholder={copy.users.usernamePlaceholder}
            value={values.username}
            error={touched && usernameMissing}
            helperText={touched && usernameMissing ? copy.users.usernameRequired : undefined}
            onChange={(event) => setValues((prev) => ({ ...prev, username: event.target.value }))}
            slotProps={{ htmlInput: { maxLength: 64 } }}
          />
          <TextField
            fullWidth
            label={copy.users.displayName}
            placeholder={copy.users.displayNamePlaceholder}
            value={values.display_name}
            onChange={(event) => setValues((prev) => ({ ...prev, display_name: event.target.value }))}
            slotProps={{ htmlInput: { maxLength: 64 } }}
          />
          <TextField
            fullWidth
            type="password"
            label={copy.users.password}
            placeholder={copy.users.passwordPlaceholder}
            helperText={copy.users.passwordHint}
            value={values.password}
            onChange={(event) => setValues((prev) => ({ ...prev, password: event.target.value }))}
            slotProps={{ htmlInput: { maxLength: 256 } }}
          />
          <TextField
            fullWidth
            select
            label={copy.users.role}
            value={values.role ?? 'user'}
            onChange={(event) => setValues((prev) => ({ ...prev, role: event.target.value as Role }))}
          >
            <MenuItem value="user">{copy.users.roleUser}</MenuItem>
            <MenuItem value="admin">{copy.users.roleAdmin}</MenuItem>
          </TextField>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} color="inherit">
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSubmit} disabled={saving} variant="contained">
          {saving ? t('common.saving') : copy.users.create}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function OneTimePasswordDialog({
  value,
  onClose,
}: {
  value: OneTimePassword | null;
  onClose: () => void;
}) {
  const copy = useAdminCopy();
  const t = useT();
  return (
    <Dialog open={value !== null} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{copy.users.initialPasswordTitle}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="bodySmall" color="text.secondary">
            {copy.users.initialPasswordHint}
          </Typography>
          <Typography variant="titleSmall">{value?.username}</Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              px: 1.5,
              py: 1,
            }}
          >
            <Box component="code" sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>
              {value?.password ?? ''}
            </Box>
            <CopyButton value={value?.password ?? ''} label={t('common.copy')} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function UsersPanel() {
  const copy = useAdminCopy();
  const t = useT();
  const usersQuery = useAdminUsers();
  const meQuery = useMe();
  const createUser = useCreateAdminUser();
  const updateUser = useUpdateAdminUser();
  const deleteUser = useDeleteAdminUser();
  const resetPassword = useResetAdminUserPassword();

  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [oneTime, setOneTime] = useState<OneTimePassword | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserOut | null>(null);
  const [pendingReset, setPendingReset] = useState<UserOut | null>(null);
  /** 正在提交角色/启用状态变更的用户 id：只禁用该行，而不是整张表。 */
  const [mutatingUserId, setMutatingUserId] = useState<number | null>(null);

  const me = meQuery.data ?? null;
  const users = usersQuery.data ?? [];
  const actionError = updateUser.error ?? deleteUser.error ?? resetPassword.error;

  const handleDelete = () => {
    if (!pendingDelete) return;
    deleteUser.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
  };

  const handleReset = () => {
    if (!pendingReset) return;
    resetPassword.mutate(pendingReset.id, {
      onSuccess: (result) => {
        setPendingReset(null);
        if (result.initial_password) {
          setOneTime({ username: result.user.username, password: result.initial_password });
        }
      },
      onError: () => setPendingReset(null),
    });
  };

  /**
   * 角色/启用状态走乐观更新：先写 users 列表缓存，失败回滚，
   * settled 后统一 invalidate，保证与服务端最终一致。
   */
  const updateUserRow = (user: UserOut, patch: { role?: Role; is_active?: boolean }) => {
    const previous = queryClient.getQueryData<UserOut[]>(adminKeys.users());
    setMutatingUserId(user.id);
    if (previous) {
      queryClient.setQueryData<UserOut[]>(
        adminKeys.users(),
        previous.map((item) => (item.id === user.id ? { ...item, ...patch } : item)),
      );
    }
    updateUser.mutate(
      { id: user.id, patch },
      {
        onError: () => {
          if (previous) queryClient.setQueryData(adminKeys.users(), previous);
        },
        onSettled: () => {
          setMutatingUserId((current) => (current === user.id ? null : current));
          void queryClient.invalidateQueries({ queryKey: adminKeys.users() });
        },
      },
    );
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
        <Button variant="contained" onClick={() => setCreateOpen(true)}>
          {copy.users.add}
        </Button>
      </Stack>

      {actionError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {describeError(actionError, t)}
        </Alert>
      ) : null}

      <LoadingBoundary
        loading={usersQuery.isLoading}
        error={usersQuery.error}
        onRetry={() => void usersQuery.refetch()}
      >
        {users.length === 0 ? (
          <EmptyState title={copy.users.empty} description={copy.users.emptyHint} />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{copy.users.username}</TableCell>
                  <TableCell>{copy.users.displayName}</TableCell>
                  <TableCell>{copy.users.role}</TableCell>
                  <TableCell>{copy.users.status}</TableCell>
                  <TableCell>{copy.users.lastLoginAt}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => {
                  const isSelf = me?.id === user.id;
                  return (
                    <TableRow key={user.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="bodyMedium">{user.username}</Typography>
                          {isSelf ? <Chip size="small" variant="outlined" label={copy.users.selfHint} /> : null}
                        </Stack>
                      </TableCell>
                      <TableCell>{user.display_name || '—'}</TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          variant="standard"
                          value={user.role}
                          disabled={isSelf || mutatingUserId === user.id}
                          onChange={(event) =>
                            updateUserRow(user, { role: event.target.value as Role })
                          }
                        >
                          <MenuItem value="user">{copy.users.roleUser}</MenuItem>
                          <MenuItem value="admin">{copy.users.roleAdmin}</MenuItem>
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Switch
                            size="small"
                            checked={user.is_active}
                            disabled={isSelf || mutatingUserId === user.id}
                            onChange={(event) => updateUserRow(user, { is_active: event.target.checked })}
                          />
                          <Typography variant="bodySmall" color="text.secondary">
                            {user.is_active ? copy.users.active : copy.users.inactive}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="bodySmall" color="text.secondary">
                          {user.last_login_at ? formatDateTime(user.last_login_at) : copy.users.never}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Button
                            size="small"
                            disabled={isSelf || resetPassword.isPending}
                            onClick={() => setPendingReset(user)}
                          >
                            {copy.users.reset}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            disabled={isSelf || deleteUser.isPending}
                            onClick={() => setPendingDelete(user)}
                          >
                            {copy.users.remove}
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </LoadingBoundary>

      <CreateUserDialog
        open={createOpen}
        saving={createUser.isPending}
        error={createUser.error ? describeError(createUser.error, t) : null}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) =>
          createUser.mutate(values, {
            onSuccess: (result) => {
              setCreateOpen(false);
              if (result.initial_password) {
                setOneTime({ username: result.user.username, password: result.initial_password });
              }
            },
          })
        }
      />

      <OneTimePasswordDialog value={oneTime} onClose={() => setOneTime(null)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={copy.users.deleteTitle}
        description={
          pendingDelete
            ? copy.users.deleteBody(pendingDelete.display_name || pendingDelete.username)
            : undefined
        }
        confirmText={copy.users.deleteConfirm}
        tone="danger"
        loading={deleteUser.isPending}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingReset !== null}
        title={
          pendingReset
            ? copy.users.resetPasswordTitle(pendingReset.display_name || pendingReset.username)
            : ''
        }
        description={copy.users.resetPasswordBody}
        confirmText={copy.users.resetPasswordConfirm}
        loading={resetPassword.isPending}
        onConfirm={handleReset}
        onClose={() => setPendingReset(null)}
      />
    </Box>
  );
}
