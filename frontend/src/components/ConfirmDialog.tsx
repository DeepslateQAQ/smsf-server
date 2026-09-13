import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  type DialogProps,
} from '@mui/material';
import type { ReactNode } from 'react';

import { useT } from '@/i18n';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** primary = 常规确认；danger = 危险操作（红色） */
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  maxWidth?: DialogProps['maxWidth'];
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  tone = 'primary',
  loading = false,
  onConfirm,
  onClose,
  maxWidth = 'xs',
}: ConfirmDialogProps) {
  const t = useT();

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onClose}
      maxWidth={maxWidth}
      fullWidth
      keepMounted={false}
    >
      <DialogTitle>{title}</DialogTitle>
      {description ? (
        <DialogContent>
          <DialogContentText component="div">{description}</DialogContentText>
        </DialogContent>
      ) : null}
      <DialogActions>
        <Button onClick={onClose} disabled={loading} color="inherit">
          {cancelText ?? t('common.cancel')}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={loading}
          variant="contained"
          color={tone === 'danger' ? 'error' : 'primary'}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {confirmText ?? t('common.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
