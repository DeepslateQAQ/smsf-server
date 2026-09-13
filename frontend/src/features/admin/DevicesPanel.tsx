import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  Alert,
  Box,
  Button,
  Chip,
  InputAdornment,
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
import SearchIcon from '@mui/icons-material/Search';
import { useMemo, useState } from 'react';

import ConfirmDialog from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import LoadingBoundary from '@/components/LoadingBoundary';
import ColorDot from '@/features/devices/components/ColorDot';
import { useT } from '@/i18n';
import { formatRelative } from '@/lib/format';
import type { AdminDeviceOut } from '@/api/types';

import { useAdminDevices, useDeleteAdminDevice, useUpdateAdminDevice } from './queries';
import { useAdminCopy } from './useAdminCopy';

export default function DevicesPanel() {
  const copy = useAdminCopy();
  const t = useT();
  const devicesQuery = useAdminDevices();
  const updateDevice = useUpdateAdminDevice();
  const deleteDevice = useDeleteAdminDevice();

  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AdminDeviceOut | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const devices = useMemo(() => {
    const all = devicesQuery.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (device) =>
        device.name.toLowerCase().includes(needle) ||
        (device.owner_name ?? '').toLowerCase().includes(needle),
    );
  }, [devicesQuery.data, search]);

  const handleDelete = () => {
    if (!pendingDelete) return;
    deleteDevice.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
  };

  return (
    <Box>
      <Alert severity="info" icon={false} sx={{ mb: 2 }}>
        {copy.devices.metadataOnly}
      </Alert>

      <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={copy.devices.searchPlaceholder}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
            htmlInput: { 'aria-label': copy.devices.searchPlaceholder },
          }}
          sx={{ maxWidth: 320 }}
        />
      </Stack>

      <LoadingBoundary
        loading={devicesQuery.isLoading}
        error={devicesQuery.error}
        onRetry={() => void devicesQuery.refetch()}
      >
        {devices.length === 0 ? (
          <EmptyState title={copy.devices.empty} description={copy.devices.emptyHint} />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{copy.devices.name}</TableCell>
                  <TableCell>{copy.devices.owner}</TableCell>
                  <TableCell align="right">{copy.devices.shares}</TableCell>
                  <TableCell align="right">{copy.devices.messages}</TableCell>
                  <TableCell>{copy.devices.status}</TableCell>
                  <TableCell>{copy.devices.fingerprint}</TableCell>
                  <TableCell>{copy.devices.lastIngest}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {devices.map((device) => (
                  <TableRow key={device.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <ColorDot color={device.color} size={10} />
                        <Typography variant="bodyMedium">{device.name}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{device.owner_name || '—'}</TableCell>
                    <TableCell align="right">{device.shared_with_count}</TableCell>
                    <TableCell align="right">{device.message_count}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Switch
                          size="small"
                          checked={device.is_active}
                          disabled={togglingId === device.id}
                          slotProps={{
                            input: {
                              'aria-label': device.is_active
                                ? copy.devices.disable
                                : copy.devices.enable,
                            },
                          }}
                          onChange={(event) => {
                            setTogglingId(device.id);
                            updateDevice.mutate(
                              { id: device.id, patch: { is_active: event.target.checked } },
                              { onSettled: () => setTogglingId(null) },
                            );
                          }}
                        />
                        <Typography variant="bodySmall" color="text.secondary">
                          {device.is_active ? copy.devices.disable : copy.devices.enable}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={device.secret_fingerprint}
                        sx={{ fontFamily: 'monospace' }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="bodySmall" color="text.secondary">
                        {device.last_ingest_at ? formatRelative(device.last_ingest_at) : copy.devices.never}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteOutlineIcon />}
                        disabled={deleteDevice.isPending}
                        onClick={() => setPendingDelete(device)}
                      >
                        {copy.devices.remove}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </LoadingBoundary>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={copy.devices.deleteTitle}
        description={pendingDelete ? copy.devices.deleteBody(pendingDelete.name) : undefined}
        confirmText={copy.devices.deleteConfirm}
        tone="danger"
        loading={deleteDevice.isPending}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Box>
  );
}
