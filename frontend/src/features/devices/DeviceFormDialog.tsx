import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { useEffect, useState } from 'react';

import { useT } from '@/i18n';
import type { DeviceOut } from '@/api/types';

import { useDeviceCopy } from './useDeviceCopy';

export interface DeviceFormValues {
  name: string;
  description: string;
  color: string;
  sim_label: string;
}

export interface DeviceFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: DeviceOut | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: DeviceFormValues) => void;
}

const DEFAULT_COLOR = '#0B57D0';
const COLOR_PRESETS = ['#0B57D0', '#1E8E3E', '#D93025', '#E37400', '#9334E6', '#00838F', '#5F6368'];

const EMPTY: DeviceFormValues = { name: '', description: '', color: DEFAULT_COLOR, sim_label: '' };

export default function DeviceFormDialog({
  open,
  mode,
  initial,
  saving = false,
  error,
  onClose,
  onSubmit,
}: DeviceFormDialogProps) {
  const copy = useDeviceCopy();
  const t = useT();
  const [values, setValues] = useState<DeviceFormValues>(EMPTY);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setValues({
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      color: initial?.color || DEFAULT_COLOR,
      sim_label: initial?.sim_label ?? '',
    });
  }, [open, initial]);

  const nameMissing = values.name.trim().length === 0;

  const handleSubmit = () => {
    setTouched(true);
    if (nameMissing) return;
    onSubmit({
      ...values,
      name: values.name.trim(),
      description: values.description.trim(),
      sim_label: values.sim_label.trim(),
    });
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{mode === 'create' ? copy.form.addTitle : copy.form.editTitle}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            autoFocus
            required
            fullWidth
            label={copy.form.name}
            placeholder={copy.form.namePlaceholder}
            value={values.name}
            error={touched && nameMissing}
            helperText={touched && nameMissing ? copy.form.nameRequired : undefined}
            onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
            slotProps={{ htmlInput: { maxLength: 64 } }}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label={copy.form.description}
            placeholder={copy.form.descriptionPlaceholder}
            value={values.description}
            onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))}
            slotProps={{ htmlInput: { maxLength: 255 } }}
          />
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <Box
              component="input"
              type="color"
              aria-label={copy.form.color}
              value={values.color.trim() || DEFAULT_COLOR}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, color: (event.target as HTMLInputElement).value }))
              }
              sx={{
                width: 48,
                height: 48,
                p: 0.5,
                mt: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.paper',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
            <TextField
              fullWidth
              label={copy.form.color}
              value={values.color}
              helperText={copy.form.colorHint}
              onChange={(event) => setValues((prev) => ({ ...prev, color: event.target.value }))}
              slotProps={{ htmlInput: { maxLength: 16 } }}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            {COLOR_PRESETS.map((preset) => (
              <Box
                key={preset}
                component="button"
                type="button"
                aria-label={preset}
                onClick={() => setValues((prev) => ({ ...prev, color: preset }))}
                sx={{
                  width: 24,
                  height: 24,
                  p: 0,
                  borderRadius: '50%',
                  bgcolor: preset,
                  cursor: 'pointer',
                  border: '2px solid',
                  borderColor:
                    values.color.toLowerCase() === preset.toLowerCase() ? 'text.primary' : 'transparent',
                }}
              />
            ))}
          </Stack>
          <TextField
            fullWidth
            label={copy.form.simLabel}
            placeholder={copy.form.simLabelPlaceholder}
            value={values.sim_label}
            onChange={(event) => setValues((prev) => ({ ...prev, sim_label: event.target.value }))}
            slotProps={{ htmlInput: { maxLength: 32 } }}
          />
          {error ? (
            <Box sx={{ color: 'error.main', typography: 'bodySmall' }} role="alert">
              {error}
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} color="inherit">
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSubmit} disabled={saving} variant="contained">
          {saving ? t('common.saving') : copy.form.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
