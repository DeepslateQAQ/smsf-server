import AddIcon from '@mui/icons-material/Add';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import WifiTetheringIcon from '@mui/icons-material/WifiTethering';
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Divider,
  IconButton,
  Snackbar,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import ConfirmDialog from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import LoadingBoundary, { describeError } from '@/components/LoadingBoundary';
import { useT } from '@/i18n';
import { formatRelative } from '@/lib/format';
import type { DeviceOut } from '@/api/types';

import ColorDot from './components/ColorDot';
import PageHeader from './components/PageHeader';
import DeviceFormDialog, { type DeviceFormValues } from './DeviceFormDialog';
import DeviceWizardDialog from './DeviceWizardDialog';
import ShareDialog from './ShareDialog';
import type { DeviceCopy } from './locales';
import {
  useCreateDevice,
  useDeleteDevice,
  useDevices,
  useRotateDeviceSecret,
  useUpdateDevice,
} from './queries';
import { useDeviceCopy } from './useDeviceCopy';

/** 统计三联：等宽占满、内容居中（统计条惯例排版，比左对齐参差列更易扫读）。 */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <Typography variant="labelSmall" color="text.secondary" sx={{ display: 'block' }} noWrap>
        {label}
      </Typography>
      <Typography variant="bodyMedium" noWrap>
        {value}
      </Typography>
    </Box>
  );
}

interface DeviceCardProps {
  device: DeviceOut;
  copy: DeviceCopy;
  toggling: boolean;
  onToggle: (next: boolean) => void;
  onWizard: () => void;
  onEdit: () => void;
  onShare: () => void;
  onRotate: () => void;
  onDelete: () => void;
}

function DeviceCard({
  device,
  copy,
  toggling,
  onToggle,
  onWizard,
  onEdit,
  onShare,
  onRotate,
  onDelete,
}: DeviceCardProps) {
  const ownerLabel = device.is_owner
    ? `${device.owner_name || copy.card.me}（${copy.card.me}）`
    : device.owner_name || copy.card.unknownOwner;

  return (
    <Card variant="outlined" sx={{ display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <ColorDot color={device.color} size={14} sx={{ mt: 0.9 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="titleMedium" component="h2" sx={{ minWidth: 0 }}>
                {device.name}
              </Typography>
              <Chip
                size="small"
                variant={device.is_owner ? 'outlined' : 'filled'}
                color={device.is_owner ? 'default' : 'info'}
                label={device.is_owner ? copy.card.ownBadge : copy.card.sharedBadge}
              />
              {!device.is_active ? (
                <Chip size="small" variant="outlined" color="warning" label={copy.card.inactive} />
              ) : null}
            </Stack>
            <Typography variant="bodySmall" color="text.secondary" sx={{ mt: 0.5 }}>
              {copy.card.owner}: {ownerLabel}
            </Typography>
            {device.description ? (
              <Typography variant="bodySmall" color="text.secondary" sx={{ mt: 0.25 }}>
                {device.description}
              </Typography>
            ) : null}
            {device.sim_label ? (
              <Typography variant="bodySmall" color="text.secondary" sx={{ mt: 0.25 }}>
                SIM: {device.sim_label}
              </Typography>
            ) : null}
          </Box>
          <Switch
            checked={device.is_active}
            disabled={!device.is_owner || toggling}
            onChange={(event) => onToggle(event.target.checked)}
            slotProps={{ input: { 'aria-label': copy.card.status } }}
          />
        </Stack>
        <Divider sx={{ my: 1.5 }} />
        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
          <Metric
            label={copy.card.lastIngest}
            value={device.last_ingest_at ? formatRelative(device.last_ingest_at) : copy.card.neverPushed}
          />
          <Metric label={copy.card.messageCount} value={String(device.message_count)} />
          <Metric
            label={copy.card.shareCount}
            value={device.is_owner ? String(device.shares.length) : '—'}
          />
        </Stack>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 1.5, columnGap: 0 }}>
        {/* 「接入向导」是卡片主操作，保持文字按钮；其余收成图标按钮（tooltip 说明），删除推向最右 */}
        <Button size="small" startIcon={<WifiTetheringIcon />} onClick={onWizard}>
          {copy.actions.wizard}
        </Button>
        {device.is_owner ? (
          <>
            <Tooltip title={copy.actions.edit}>
              <IconButton aria-label={copy.actions.edit} onClick={onEdit}>
                <EditOutlinedIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={copy.actions.share}>
              <IconButton aria-label={copy.actions.share} onClick={onShare}>
                <ShareOutlinedIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={copy.actions.rotate}>
              <IconButton aria-label={copy.actions.rotate} onClick={onRotate}>
                <AutorenewIcon />
              </IconButton>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <Tooltip title={copy.actions.delete}>
              <IconButton aria-label={copy.actions.delete} color="error" onClick={onDelete}>
                <DeleteOutlineIcon />
              </IconButton>
            </Tooltip>
          </>
        ) : null}
      </CardActions>
    </Card>
  );
}

interface WizardState {
  open: boolean;
  device: DeviceOut | null;
  secret: string | null;
  step: number;
}

export default function DevicesPage() {
  const copy = useDeviceCopy();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const devicesQuery = useDevices();
  const createDevice = useCreateDevice();
  const updateDevice = useUpdateDevice();
  const deleteDevice = useDeleteDevice();
  const rotateDevice = useRotateDeviceSecret();

  const [form, setForm] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    device: DeviceOut | null;
  }>({ open: false, mode: 'create', device: null });
  const [sharingId, setSharingId] = useState<number | null>(null);
  const [wizard, setWizard] = useState<WizardState>({ open: false, device: null, secret: null, step: 0 });
  const [pendingDelete, setPendingDelete] = useState<DeviceOut | null>(null);
  const [pendingRotate, setPendingRotate] = useState<DeviceOut | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const newParam = searchParams.get('new');

  // 消息页 FAB 跳到 `/devices?new=1`：首次挂载与参数从无到有都要自动打开新建对话框。
  useEffect(() => {
    if (newParam === '1') setForm({ open: true, mode: 'create', device: null });
  }, [newParam]);

  // 关闭对话框时用 replace 把 `new` 从 URL 抹掉：不污染历史，也不会刷新后又弹一次。
  const closeForm = () => {
    setForm((prev) => ({ ...prev, open: false }));
    if (!searchParams.has('new')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  };

  const devices = devicesQuery.data ?? [];
  const sharingDevice = sharingId === null ? null : (devices.find((item) => item.id === sharingId) ?? null);
  const formError =
    form.mode === 'create'
      ? createDevice.error
        ? describeError(createDevice.error, t)
        : null
      : updateDevice.error
        ? describeError(updateDevice.error, t)
        : null;

  const handleSubmit = (values: DeviceFormValues) => {
    if (form.mode === 'create') {
      createDevice.mutate(values, {
        onSuccess: (device) => {
          closeForm();
          setWizard({ open: true, device, secret: device.secret ?? null, step: 0 });
          setToast(copy.form.created);
        },
      });
      return;
    }
    if (!form.device) return;
    updateDevice.mutate(
      { id: form.device.id, patch: values },
      {
        onSuccess: () => {
          setForm((prev) => ({ ...prev, open: false }));
          setToast(copy.form.updated);
        },
      },
    );
  };

  const handleToggle = (device: DeviceOut, next: boolean) => {
    setTogglingId(device.id);
    updateDevice.mutate(
      { id: device.id, patch: { is_active: next } },
      { onSettled: () => setTogglingId(null) },
    );
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    deleteDevice.mutate(pendingDelete.id, {
      onSuccess: () => setToast(copy.remove.success),
      onSettled: () => setPendingDelete(null),
    });
  };

  const handleRotate = () => {
    if (!pendingRotate) return;
    rotateDevice.mutate(pendingRotate.id, {
      onSuccess: (device) => {
        setWizard({ open: true, device, secret: device.secret ?? null, step: 3 });
        setToast(copy.rotate.success);
      },
      onSettled: () => setPendingRotate(null),
    });
  };

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setForm({ open: true, mode: 'create', device: null })}
          >
            {copy.actions.add}
          </Button>
        }
      />

      <LoadingBoundary
        loading={devicesQuery.isLoading}
        error={devicesQuery.error}
        onRetry={() => void devicesQuery.refetch()}
      >
        {devices.length === 0 ? (
          <EmptyState
            title={copy.empty.title}
            description={copy.empty.hint}
            icon={<WifiTetheringIcon />}
            action={
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setForm({ open: true, mode: 'create', device: null })}
              >
                {copy.actions.add}
              </Button>
            }
          />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
            }}
          >
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                copy={copy}
                toggling={togglingId === device.id}
                onToggle={(next) => handleToggle(device, next)}
                onWizard={() => setWizard({ open: true, device, secret: null, step: 0 })}
                onEdit={() => setForm({ open: true, mode: 'edit', device })}
                onShare={() => setSharingId(device.id)}
                onRotate={() => setPendingRotate(device)}
                onDelete={() => setPendingDelete(device)}
              />
            ))}
          </Box>
        )}
      </LoadingBoundary>

      <DeviceFormDialog
        open={form.open}
        mode={form.mode}
        initial={form.device}
        saving={createDevice.isPending || updateDevice.isPending}
        error={formError}
        onClose={closeForm}
        onSubmit={handleSubmit}
      />

      {wizard.device ? (
        <DeviceWizardDialog
          open={wizard.open}
          device={wizard.device}
          initialSecret={wizard.secret}
          initialStep={wizard.step}
          canManage={wizard.device.is_owner}
          onClose={() => setWizard((prev) => ({ ...prev, open: false, secret: null }))}
        />
      ) : null}

      {sharingDevice ? (
        <ShareDialog open onClose={() => setSharingId(null)} device={sharingDevice} />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={copy.remove.title}
        description={pendingDelete ? copy.remove.body(pendingDelete.name) : undefined}
        confirmText={copy.remove.confirm}
        tone="danger"
        loading={deleteDevice.isPending}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingRotate !== null}
        title={copy.rotate.title}
        description={pendingRotate ? copy.rotate.body(pendingRotate.name) : undefined}
        confirmText={copy.rotate.confirm}
        tone="danger"
        loading={rotateDevice.isPending}
        onConfirm={handleRotate}
        onClose={() => setPendingRotate(null)}
      />

      <Snackbar
        open={toast !== null}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </>
  );
}
