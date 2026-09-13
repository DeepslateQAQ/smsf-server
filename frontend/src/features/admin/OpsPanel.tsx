import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import EmptyState from '@/components/EmptyState';
import LoadingBoundary from '@/components/LoadingBoundary';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import type { LockoutOut } from '@/api/types';

import { useAdminAudit, useAdminLockouts, useAdminStats, useUnlockUser } from './queries';
import { useAdminCopy } from './useAdminCopy';

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="labelMedium" color="text.secondary" sx={{ display: 'block' }}>
          {label}
        </Typography>
        <Typography variant="headlineSmall" component="p" sx={{ mt: 0.5 }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

function StatsSection() {
  const copy = useAdminCopy();
  const statsQuery = useAdminStats();

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="titleMedium" component="h3">
          {copy.ops.title}
        </Typography>
        <Button size="small" onClick={() => void statsQuery.refetch()} disabled={statsQuery.isFetching}>
          {copy.ops.stats.refresh}
        </Button>
      </Stack>
      <LoadingBoundary
        loading={statsQuery.isLoading}
        error={statsQuery.error}
        onRetry={() => void statsQuery.refetch()}
        minHeight={80}
      >
        {statsQuery.data ? (
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
            }}
          >
            <StatCard label={copy.ops.stats.users} value={String(statsQuery.data.users)} />
            <StatCard label={copy.ops.stats.devices} value={String(statsQuery.data.devices)} />
            <StatCard label={copy.ops.stats.messages} value={String(statsQuery.data.messages)} />
            <StatCard label={copy.ops.stats.messages24h} value={String(statsQuery.data.messages_24h)} />
            <StatCard label={copy.ops.stats.codes24h} value={String(statsQuery.data.codes_24h)} />
            <StatCard label={copy.ops.stats.dbBytes} value={formatBytes(statsQuery.data.db_bytes)} />
            <StatCard
              label={copy.ops.stats.lastIngest}
              value={
                statsQuery.data.last_ingest_at
                  ? formatRelative(statsQuery.data.last_ingest_at)
                  : copy.ops.stats.never
              }
            />
          </Box>
        ) : null}
      </LoadingBoundary>
    </Box>
  );
}

function AuditSection() {
  const copy = useAdminCopy();
  const auditQuery = useAdminAudit();
  const items = auditQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Box>
      <Typography variant="titleMedium" component="h3" sx={{ mb: 1.5 }}>
        {copy.ops.audit.title}
      </Typography>
      <LoadingBoundary
        loading={auditQuery.isLoading}
        error={auditQuery.error}
        onRetry={() => void auditQuery.refetch()}
      >
        {items.length === 0 ? (
          <EmptyState title={copy.ops.audit.empty} description={copy.ops.audit.emptyHint} />
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{copy.ops.audit.at}</TableCell>
                    <TableCell>{copy.ops.audit.actor}</TableCell>
                    <TableCell>{copy.ops.audit.action}</TableCell>
                    <TableCell>{copy.ops.audit.target}</TableCell>
                    <TableCell>{copy.ops.audit.ip}</TableCell>
                    <TableCell>{copy.ops.audit.result}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((entry) => (
                    <TableRow key={entry.id} hover>
                      <TableCell>
                        <Typography variant="bodySmall">{formatDateTime(entry.at)}</Typography>
                      </TableCell>
                      <TableCell>{entry.actor_name ?? entry.actor_kind}</TableCell>
                      <TableCell>
                        {copy.actionLabels[entry.action] ?? entry.action}
                      </TableCell>
                      <TableCell>
                        <Typography variant="bodySmall" color="text.secondary">
                          {entry.target_type ? `${entry.target_type}#${entry.target_id}` : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="bodySmall" sx={{ fontFamily: 'monospace' }}>
                          {entry.ip || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={entry.success ? 'success' : 'error'}
                          variant={entry.success ? 'outlined' : 'filled'}
                          label={entry.success ? copy.ops.audit.success : copy.ops.audit.failure}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              {auditQuery.hasNextPage ? (
                <Button
                  variant="outlined"
                  disabled={auditQuery.isFetchingNextPage}
                  onClick={() => void auditQuery.fetchNextPage()}
                >
                  {auditQuery.isFetchingNextPage ? copy.ops.audit.loading : copy.ops.audit.loadMore}
                </Button>
              ) : (
                <Typography variant="bodySmall" color="text.secondary">
                  {copy.ops.audit.noMore}
                </Typography>
              )}
            </Box>
          </>
        )}
      </LoadingBoundary>
    </Box>
  );
}

function LockoutsSection() {
  const copy = useAdminCopy();
  const lockoutsQuery = useAdminLockouts();
  const unlock = useUnlockUser();
  const [pending, setPending] = useState<LockoutOut | null>(null);

  const lockouts = lockoutsQuery.data ?? [];

  return (
    <Box>
      <Typography variant="titleMedium" component="h3" sx={{ mb: 1.5 }}>
        {copy.ops.lockouts.title}
      </Typography>
      <LoadingBoundary
        loading={lockoutsQuery.isLoading}
        error={lockoutsQuery.error}
        onRetry={() => void lockoutsQuery.refetch()}
        minHeight={80}
      >
        {lockouts.length === 0 ? (
          <Typography variant="bodySmall" color="text.secondary">
            {copy.ops.lockouts.empty}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {lockouts.map((entry) => (
              <Stack
                key={entry.username}
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 2, py: 1 }}
              >
                <Typography variant="bodyMedium" sx={{ flex: 1 }}>
                  {entry.username}
                </Typography>
                <Chip
                  size="small"
                  color={entry.locked ? 'error' : 'default'}
                  label={`${copy.ops.lockouts.failedCount}: ${entry.failed_count}`}
                />
                <Button
                  size="small"
                  disabled={unlock.isPending && pending?.username === entry.username}
                  onClick={() => {
                    setPending(entry);
                    unlock.mutate(entry.username, { onSettled: () => setPending(null) });
                  }}
                >
                  {copy.ops.lockouts.unlock}
                </Button>
              </Stack>
            ))}
          </Stack>
        )}
      </LoadingBoundary>
      {unlock.error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {copy.errors.actionFailed}
        </Alert>
      ) : null}
    </Box>
  );
}

export default function OpsPanel() {
  return (
    <Stack spacing={4} divider={<Divider flexItem />}>
      <StatsSection />
      <AuditSection />
      <LockoutsSection />
    </Stack>
  );
}
