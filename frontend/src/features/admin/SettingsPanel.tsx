import {
  Alert,
  Box,
  Button,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import LoadingBoundary, { describeError } from '@/components/LoadingBoundary';
import { useT } from '@/i18n';
import type { SettingsOut, SettingsUpdate } from '@/api/types';

import { useAdminSettings, useUpdateAdminSettings } from './queries';
import { useAdminCopy } from './useAdminCopy';

type NumberKey =
  | 'device_limit_per_user'
  | 'rate_limit_per_device_per_min'
  | 'max_body_bytes'
  | 'max_content_chars';

interface NumberField {
  key: NumberKey;
  min: number;
  max: number;
  label: string;
  hint: string;
}

export default function SettingsPanel() {
  const copy = useAdminCopy();
  const t = useT();
  const settingsQuery = useAdminSettings();
  const updateSettings = useUpdateAdminSettings();

  const [form, setForm] = useState<SettingsOut | null>(null);
  const [errors, setErrors] = useState<Partial<Record<NumberKey, string>>>({});
  const [saved, setSaved] = useState(false);
  /** 已吸附过的 dataUpdatedAt：同一份数据不重复 setForm。 */
  const hydratedAtRef = useRef(-1);
  /** 是否有未保存编辑；有编辑时服务端 refetch 不得覆盖表单。 */
  const formDirtyRef = useRef(false);

  useEffect(() => {
    const data = settingsQuery.data;
    if (!data) return;
    if (hydratedAtRef.current === settingsQuery.dataUpdatedAt) return;
    // 保存成功会清零 dirty，随后的 refetch 才允许用服务端数据重新吸附。
    if (formDirtyRef.current && form !== null) return;
    hydratedAtRef.current = settingsQuery.dataUpdatedAt;
    setForm(data);
  }, [form, settingsQuery.data, settingsQuery.dataUpdatedAt]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  const numberFields: NumberField[] = [
    {
      key: 'device_limit_per_user',
      min: 0,
      max: 1000,
      label: copy.settings.deviceLimitPerUser,
      hint: copy.settings.deviceLimitHint,
    },
    {
      key: 'rate_limit_per_device_per_min',
      min: 1,
      max: 100000,
      label: copy.settings.rateLimitPerDevice,
      hint: copy.settings.rateLimitHint,
    },
    {
      key: 'max_body_bytes',
      min: 1024,
      max: 10 * 1024 * 1024,
      label: copy.settings.maxBodyBytes,
      hint: copy.settings.maxBodyBytesHint,
    },
    {
      key: 'max_content_chars',
      min: 64,
      max: 10 * 1024 * 1024,
      label: copy.settings.maxContentChars,
      hint: copy.settings.maxContentCharsHint,
    },
  ];

  const setNumber = (field: NumberField, raw: string) => {
    formDirtyRef.current = true;
    setForm((prev) => (prev ? { ...prev, [field.key]: raw === '' ? 0 : Number(raw) } : prev));
    setErrors((prev) => ({ ...prev, [field.key]: undefined }));
  };

  const handleSave = () => {
    if (!form) return;
    const nextErrors: Partial<Record<NumberKey, string>> = {};
    for (const field of numberFields) {
      const value = form[field.key];
      if (!Number.isInteger(value) || value < field.min || value > field.max) {
        nextErrors[field.key] = copy.settings.invalidNumber(field.min, field.max);
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const patch: SettingsUpdate = {
      allow_public_registration: form.allow_public_registration,
      device_limit_per_user: form.device_limit_per_user,
      rate_limit_per_device_per_min: form.rate_limit_per_device_per_min,
      max_body_bytes: form.max_body_bytes,
      max_content_chars: form.max_content_chars,
    };
    updateSettings.mutate(patch, {
      onSuccess: () => {
        formDirtyRef.current = false;
        setSaved(true);
      },
    });
  };

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography variant="titleLarge" component="h2">
        {copy.settings.title}
      </Typography>
      <Typography variant="bodySmall" color="text.secondary" sx={{ mb: 2 }}>
        {copy.settings.subtitle}
      </Typography>

      <LoadingBoundary
        loading={settingsQuery.isLoading}
        error={settingsQuery.error}
        onRetry={() => void settingsQuery.refetch()}
      >
        {form ? (
          <Stack spacing={2.5} divider={<Divider flexItem />}>
            <FormControlLabel
              /* 设置项惯例：文本块居左、控件居右 */
              labelPlacement="start"
              sx={{ m: 0, justifyContent: 'space-between' }}
              control={
                <Switch
                  checked={form.allow_public_registration}
                  onChange={(event) => {
                    formDirtyRef.current = true;
                    setForm((prev) =>
                      prev ? { ...prev, allow_public_registration: event.target.checked } : prev,
                    );
                  }}
                />
              }
              label={
                <Box>
                  <Typography variant="bodyMedium">{copy.settings.allowPublicRegistration}</Typography>
                  <Typography variant="bodySmall" color="text.secondary">
                    {copy.settings.allowPublicRegistrationHint}
                  </Typography>
                </Box>
              }
            />

            {numberFields.map((field) => (
              <TextField
                key={field.key}
                type="number"
                fullWidth
                label={field.label}
                helperText={errors[field.key] ?? field.hint}
                error={Boolean(errors[field.key])}
                value={Number.isFinite(form[field.key]) ? form[field.key] : ''}
                onChange={(event) => setNumber(field, event.target.value)}
                slotProps={{ htmlInput: { min: field.min, max: field.max, step: 1 } }}
              />
            ))}

            {updateSettings.error ? (
              <Alert severity="error">{describeError(updateSettings.error, t)}</Alert>
            ) : null}
            {saved ? <Alert severity="success">{copy.settings.saved}</Alert> : null}

            <Box>
              <Button variant="contained" onClick={handleSave} disabled={updateSettings.isPending}>
                {updateSettings.isPending ? t('common.saving') : copy.settings.save}
              </Button>
            </Box>
          </Stack>
        ) : null}
      </LoadingBoundary>
    </Box>
  );
}
