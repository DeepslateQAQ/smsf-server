import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import ConfirmDialog from '@/components/ConfirmDialog';
import { describeError } from '@/components/LoadingBoundary';
import { useT } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import type { DeviceOut, ShareOut } from '@/api/types';

import { useShareDevice, useUnshareDevice } from './queries';
import { useDeviceCopy } from './useDeviceCopy';

export interface ShareDialogProps {
  open: boolean;
  device: DeviceOut;
  onClose: () => void;
}

export default function ShareDialog({ open, device, onClose }: ShareDialogProps) {
  const copy = useDeviceCopy();
  const t = useT();
  const addShare = useShareDevice();
  const removeShare = useUnshareDevice();
  const [username, setUsername] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<ShareOut | null>(null);

  const errorMessage = addShare.error
    ? describeError(addShare.error, t)
    : removeShare.error
      ? describeError(removeShare.error, t)
      : null;

  const handleAdd = () => {
    const name = username.trim();
    if (!name) return;
    addShare.mutate({ id: device.id, username: name }, { onSuccess: () => setUsername('') });
  };

  const handleRemove = () => {
    if (!pendingRemoval) return;
    removeShare.mutate(
      { id: device.id, userId: pendingRemoval.user_id },
      { onSettled: () => setPendingRemoval(null) },
    );
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{copy.share.title}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="bodyMedium" color="text.secondary">
              {copy.share.subtitle(device.name)}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField
                fullWidth
                size="small"
                label={copy.share.username}
                placeholder={copy.share.usernamePlaceholder}
                value={username}
                disabled={addShare.isPending}
                onChange={(event) => setUsername(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleAdd();
                  }
                }}
              />
              <Button
                variant="contained"
                onClick={handleAdd}
                disabled={addShare.isPending || username.trim().length === 0}
                startIcon={<PersonAddAlt1Icon />}
                sx={{ flexShrink: 0, height: 40 }}
              >
                {copy.share.add}
              </Button>
            </Stack>
            {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
            <Box>
              <Typography variant="titleSmall" component="h3" sx={{ mb: 1 }}>
                {copy.share.listHeader}
              </Typography>
              {device.shares.length === 0 ? (
                <Typography variant="bodySmall" color="text.secondary">
                  {copy.share.empty}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {device.shares.map((share) => (
                    <ListItem
                      key={share.user_id}
                      disableGutters
                      secondaryAction={
                        <IconButton
                          edge="end"
                          aria-label={copy.share.unshare}
                          onClick={() => setPendingRemoval(share)}
                        >
                          <DeleteOutlineIcon />
                        </IconButton>
                      }
                    >
                      <ListItemAvatar>
                        <Avatar sx={{ width: 32, height: 32 }}>
                          {(share.display_name || share.username).slice(0, 1).toUpperCase()}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={share.display_name || share.username}
                        secondary={`@${share.username} · ${copy.share.sharedAt} ${formatDateTime(share.created_at)}`}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
            <Typography variant="bodySmall" color="text.secondary">
              {copy.share.ownerHint}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="inherit">
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={copy.share.unshareTitle}
        description={
          pendingRemoval
            ? copy.share.unshareBody(pendingRemoval.display_name || pendingRemoval.username)
            : undefined
        }
        confirmText={copy.share.unshareConfirm}
        tone="danger"
        loading={removeShare.isPending}
        onConfirm={handleRemove}
        onClose={() => setPendingRemoval(null)}
      />
    </>
  );
}
