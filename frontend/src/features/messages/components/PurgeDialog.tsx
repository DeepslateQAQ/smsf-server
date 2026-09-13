/**
 * 一键清理对话框：
 * 1) 选预设天数（7/30/60/90/180/365）；
 * 2) 二次确认（明确不可撤销）；
 * 3) 提交后展示服务端返回的删除条数。
 * 只清理「自有设备」——共享设备永远不会被清掉，这里显式提示。
 */

import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import { isApiError } from '@/api/client';
import { describeError } from '@/components/LoadingBoundary';

import { usePurgeMessages } from '../api';
import { useMessagesT } from '../locales';

const PRESET_DAYS = [7, 30, 60, 90, 180, 365] as const;
const DEFAULT_DAYS = 30;

type Step = 'select' | 'confirm' | 'done';

export interface PurgeDialogProps {
  open: boolean;
  onClose: () => void;
  /** 调用者拥有的设备 id（清理范围） */
  ownedDeviceIds: number[];
  /** 当前筛选里的设备 id（用于「仅清理当前筛选的设备」） */
  filteredDeviceIds: number[];
}

export default function PurgeDialog({
  open,
  onClose,
  ownedDeviceIds,
  filteredDeviceIds,
}: PurgeDialogProps) {
  const t = useMessagesT();
  const purge = usePurgeMessages();
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [step, setStep] = useState<Step>('select');
  const [scopeToFilter, setScopeToFilter] = useState(false);
  const [deleted, setDeleted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('select');
    setDeleted(null);
    setError(null);
    setScopeToFilter(false);
  }, [open]);

  const scopedIds = scopeToFilter
    ? ownedDeviceIds.filter((id) => filteredDeviceIds.includes(id))
    : ownedDeviceIds;
  // HIGH：scopeToFilter 打开但范围内的自有设备为空时，绝不能把 device_ids 变成
  // undefined —— 后端会把它当成「全部自有设备」而误删。这里直接阻断提交。
  const scopeEmpty = scopeToFilter && scopedIds.length === 0;
  const scopeLabel = scopeToFilter
    ? t('messages.purgeScopeChosen', { count: scopedIds.length })
    : t('messages.purgeScopeOwned');

  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // step 切换时把焦点送到确认按钮（键盘用户落在主操作上）。
  useEffect(() => {
    if (step === 'confirm') confirmButtonRef.current?.focus();
  }, [step]);

  const submit = async () => {
    if (scopeEmpty) return;
    setError(null);
    try {
      const result = await purge.mutateAsync({
        before_days: days,
        // scopeToFilter 打开时 scopedIds 必然非空（否则按钮已禁用），
        // 关闭时才回退到 undefined 表示「全部自有设备」。
        device_ids: scopeToFilter ? scopedIds : scopedIds.length ? scopedIds : undefined,
      });
      setDeleted(result.deleted);
      setStep('done');
    } catch (err) {
      setError(isApiError(err) && err.detail ? err.detail : describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onClose={purge.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('messages.purgeTitle')}</DialogTitle>

      <DialogContent dividers>
        {step === 'select' ? (
          <Stack spacing={2}>
            <Typography variant="bodyMedium" color="text.secondary">
              {t('messages.purgeOwnOnly')}
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={days}
              onChange={(_event, next: number | null) => {
                if (next !== null) setDays(next);
              }}
              sx={{ flexWrap: 'wrap', gap: 0.5 }}
            >
              {PRESET_DAYS.map((preset) => (
                <ToggleButton key={preset} value={preset}>
                  {t('messages.purgeDays', { count: preset })}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="bodySmall" color="text.secondary">
              {t('messages.purgeBody', { days })}
            </Typography>
            {filteredDeviceIds.length > 0 ? (
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={scopeToFilter}
                    onChange={(event) => setScopeToFilter(event.target.checked)}
                  />
                }
                label={t('messages.purgeScopeFilter')}
              />
            ) : null}
            {scopeEmpty ? (
              <Typography variant="bodySmall" color="error">
                {t('messages.purgeScopeNone')}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {step === 'confirm' ? (
          <Stack spacing={1.5}>
            <Alert severity="warning">{t('messages.purgeConfirmTitle')}</Alert>
            <Typography variant="bodyMedium">
              {t('messages.purgeConfirmBody', { days, scope: scopeLabel })}
            </Typography>
            {scopeEmpty ? <Alert severity="error">{t('messages.purgeScopeNone')}</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        ) : null}

        {step === 'done' ? (
          <Alert severity={deleted ? 'success' : 'info'}>
            {deleted ? t('messages.purgeDone', { count: deleted }) : t('messages.purgeEmpty')}
          </Alert>
        ) : null}
      </DialogContent>

      <DialogActions>
        {step === 'select' ? (
          <>
            <Button color="inherit" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="contained" color="error" disabled={scopeEmpty} onClick={() => setStep('confirm')}>
              {t('messages.purgeSubmit')}
            </Button>
          </>
        ) : null}

        {step === 'confirm' ? (
          <>
            <Button color="inherit" disabled={purge.isPending} onClick={() => setStep('select')}>
              {t('common.back')}
            </Button>
            <Button
              ref={confirmButtonRef}
              variant="contained"
              color="error"
              disabled={purge.isPending || scopeEmpty}
              startIcon={purge.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void submit()}
            >
              {t('common.confirm')}
            </Button>
          </>
        ) : null}

        {step === 'done' ? (
          <Button variant="contained" onClick={onClose}>
            {t('common.done')}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
