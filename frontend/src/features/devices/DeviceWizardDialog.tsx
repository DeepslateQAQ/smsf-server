import CelebrationOutlinedIcon from '@mui/icons-material/CelebrationOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import CopyButton from '@/components/CopyButton';
import { useT } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { md3Geometry } from '@/theme';
import type { DeviceOut } from '@/api/types';

import { useRotateDeviceSecret } from './queries';
import { useDeviceCopy } from './useDeviceCopy';
import { useSelfCheck } from './useSelfCheck';
import { buildIngestBodyTemplate, buildWizardConfig, INGEST_FIELDS, type HeaderPair } from './wizard';

export interface DeviceWizardDialogProps {
  open: boolean;
  device: DeviceOut;
  /** 创建/轮换响应里拿到的 secret；已有设备打开时为空 */
  initialSecret?: string | null;
  /** 打开时停留的步骤（0-4），默认第 1 步 */
  initialStep?: number;
  /** 只有拥有者能重新生成密钥 */
  canManage?: boolean;
  onClose: () => void;
}

function CodeBlock({ value, label }: { value: string; label?: string }) {
  return (
    <Box
      sx={{
        position: 'relative',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'action.hover',
        p: 1.5,
        pr: 6,
      }}
    >
      <Box
        component="pre"
        sx={{
          m: 0,
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </Box>
      <Box sx={{ position: 'absolute', top: 4, right: 4 }}>
        <CopyButton value={value} label={label} />
      </Box>
    </Box>
  );
}

function HeaderPairBlock({
  header,
  keyLabel,
  valueLabel,
}: {
  header: HeaderPair;
  keyLabel: string;
  valueLabel: string;
}) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="stretch">
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <CodeBlock value={header.key} label={keyLabel} />
      </Box>
      <Typography sx={{ alignSelf: 'center' }} aria-hidden="true">
        :
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <CodeBlock value={header.value} label={valueLabel} />
      </Box>
    </Stack>
  );
}
function authKindLabel(kind: string, copy: ReturnType<typeof useDeviceCopy>): string {
  if (kind === 'bearer') return copy.selfCheck.authBearer;
  if (kind === 'sign') return copy.selfCheck.authSign;
  return copy.selfCheck.authUnknown;
}

function SelfCheckPanel({ deviceId, onSkip, autoStart = false }: { deviceId: number; onSkip: () => void; autoStart?: boolean }) {
  const copy = useDeviceCopy();
  const { state, start, reset } = useSelfCheck(deviceId);
  const autoStartedRef = useRef(false);

  // 进入本步只自动开始一次；点击“停止”后不因 idle 状态再次触发。
  useEffect(() => {
    if (!autoStart) {
      autoStartedRef.current = false;
      return;
    }
    if (!autoStartedRef.current) {
      autoStartedRef.current = true;
      start();
    }
  }, [autoStart, start]);

  return (
    <Stack spacing={1.5}>
      <Typography variant="titleMedium" component="h3">
        {copy.selfCheck.title}
      </Typography>

      {state.phase === 'idle' ? (
        <>
          <Typography variant="bodySmall" color="text.secondary">
            {copy.selfCheck.intro}
          </Typography>
          <Typography variant="bodySmall" color="text.secondary">
            {copy.selfCheck.prepare}
          </Typography>
          {!autoStart ? (
            <Box>
              <Button variant="outlined" onClick={start}>
                {copy.selfCheck.start}
              </Button>
            </Box>
          ) : null}
        </>
      ) : null}

      {state.phase === 'waiting' ? (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CircularProgress size={20} color="primary" />
            <Typography variant="bodySmall" color="text.secondary" sx={{ flex: 1 }}>
              {autoStart ? copy.selfCheck.autoWaiting : copy.selfCheck.waiting}
            </Typography>
            <Button size="small" color="inherit" onClick={reset}>
              {copy.selfCheck.stop}
            </Button>
          </Stack>
          <Alert severity="info">
            <Typography variant="titleSmall" sx={{ mb: 0.5 }}>
              {copy.selfCheck.guideTitle}
            </Typography>
            <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
              <li>
                <Typography variant="bodySmall">{copy.selfCheck.guideSteps.configureSms}</Typography>
              </li>
              <li>
                <Typography variant="bodySmall">{copy.selfCheck.guideSteps.configureKeepAlive}</Typography>
              </li>
              <li>
                <Typography variant="bodySmall">{copy.selfCheck.guideSteps.configureRule}</Typography>
              </li>
              <li>
                <Typography variant="bodySmall">{copy.selfCheck.guideSteps.send}</Typography>
              </li>
              <li>
                <Typography variant="bodySmall">{copy.selfCheck.guideSteps.wait}</Typography>
              </li>
              <li>
                <Typography variant="bodySmall">{copy.selfCheck.guideSteps.result}</Typography>
              </li>
            </Box>
          </Alert>
        </Stack>
      ) : null}

      {state.phase === 'success' ? (
        <Box
          sx={{
            borderRadius: md3Geometry.shape.xl,
            bgcolor: 'var(--mui-palette-secondaryContainer)',
            color: 'var(--mui-palette-onSecondaryContainer)',
            p: 3,
            textAlign: 'center',
          }}
        >
          <Stack spacing={1.5} alignItems="center">
            <CelebrationOutlinedIcon sx={{ fontSize: 40 }} />
            <Typography variant="titleLarge" component="h4">
              {copy.selfCheck.congratsTitle}
            </Typography>
            <Typography variant="bodySmall" sx={{ opacity: 0.85 }}>
              {copy.selfCheck.congratsBody}
            </Typography>
            <Divider sx={{ width: '100%', borderColor: 'color-mix(in srgb, currentColor 24%, transparent)' }} />
            <Stack spacing={0.5} alignItems="center">
              <Typography variant="bodySmall">
                {copy.selfCheck.sender}: {state.message.sender || '—'}
              </Typography>
              <Typography variant="bodySmall">
                {copy.selfCheck.code}: {state.message.code ?? copy.selfCheck.noCode}
              </Typography>
              <Typography variant="bodySmall">
                {copy.selfCheck.receivedAt}: {formatDateTime(state.message.received_at)}
              </Typography>
              <Typography variant="bodySmall">
                {copy.selfCheck.authKind}: {authKindLabel(state.message.auth_kind, copy)}
              </Typography>
            </Stack>
          </Stack>
        </Box>
      ) : null}

      {state.phase === 'timeout' ? (
        <Alert severity="warning">
          <Typography variant="titleSmall" sx={{ mb: 1 }}>
            {copy.selfCheck.timeout}
          </Typography>
          <Typography variant="bodySmall" sx={{ mb: 0.5 }}>
            {copy.selfCheck.checklistTitle}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            <li>
              <Typography variant="bodySmall">{copy.selfCheck.checklist.address}</Typography>
            </li>
            <li>
              <Typography variant="bodySmall">{copy.selfCheck.checklist.headers}</Typography>
            </li>
            <li>
              <Typography variant="bodySmall">{copy.selfCheck.checklist.body}</Typography>
            </li>
            <li>
              <Typography variant="bodySmall">{copy.selfCheck.checklist.deviceMark}</Typography>
            </li>
            <li>
              <Typography variant="bodySmall">{copy.selfCheck.checklist.network}</Typography>
            </li>
          </Box>
          <Box sx={{ mt: 1.5 }}>
            <Button size="small" variant="outlined" onClick={start}>
              {copy.selfCheck.retry}
            </Button>
          </Box>
        </Alert>
      ) : null}

      {state.phase === 'success' ? (
        <Box>
          <Button size="small" variant="text" onClick={start}>
            {copy.selfCheck.retry}
          </Button>
        </Box>
      ) : null}

      <Box>
        <Button size="small" color="inherit" onClick={onSkip}>
          {copy.selfCheck.skip}
        </Button>
      </Box>
    </Stack>
  );
}

export default function DeviceWizardDialog({
  open,
  device,
  initialSecret,
  initialStep = 0,
  canManage = false,
  onClose,
}: DeviceWizardDialogProps) {
  const copy = useDeviceCopy();
  const t = useT();
  const rotate = useRotateDeviceSecret();
  const [activeStep, setActiveStep] = useState(initialStep);
  const [secret, setSecret] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // 关闭后不在组件 state 里保留明文密钥（父层同时会清空 wizard.secret）。
      setSecret(null);
      return;
    }
    setActiveStep(initialStep);
    setSecret(initialSecret ?? device.secret ?? null);
  }, [open, initialSecret, initialStep, device.secret]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const config = buildWizardConfig({ origin, deviceMark: device.device_mark, secret });
  const bodyTemplate = buildIngestBodyTemplate({ deviceMark: device.device_mark });
  const legacyBody = JSON.stringify(
    buildIngestBodyTemplate({ legacyReceiveTime: true, deviceMark: device.device_mark }),
    null,
    2,
  );
  const stepLabels = [
    copy.wizard.steps.address,
    copy.wizard.steps.body,
    copy.wizard.steps.secret,
    copy.wizard.steps.headers,
    copy.wizard.steps.check,
  ];

  const fullText = [
    `【${copy.wizard.addressLabel}】`,
    config.endpoint,
    '',
    `【${copy.wizard.bodyLabel}】`,
    config.body,
    '',
    `【${copy.wizard.secretLabel}】`,
    config.secret || copy.wizard.secretMissing,
    '',
    `【${copy.wizard.headersLabel}】`,
    `${config.headers.key}: ${config.headers.value}`,
  ].join('\n');

  const handleRegenerate = () => {
    rotate.mutate(device.id, { onSuccess: (updated) => setSecret(updated.secret ?? null) });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="titleLarge" component="span">
              {copy.wizard.title}
            </Typography>
            <Typography variant="bodySmall" color="text.secondary" sx={{ display: 'block' }}>
              {copy.wizard.subtitle}
            </Typography>
          </Box>
          <CopyButton value={fullText} label={t('common.copy')} size="medium" />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3 }}>
          {stepLabels.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {activeStep === 0 ? (
          <Stack spacing={2}>
            <Typography variant="bodyMedium">{copy.wizard.addressIntro}</Typography>
            <CodeBlock value={config.endpoint} label={t('common.copy')} />
          </Stack>
        ) : null}

        {activeStep === 3 ? (
          <Stack spacing={2}>
            <Typography variant="bodyMedium">{copy.wizard.headersIntro}</Typography>
            <HeaderPairBlock
              header={config.headers}
              keyLabel={copy.wizard.copyKey}
              valueLabel={copy.wizard.copyValue}
            />
          </Stack>
        ) : null}

        {activeStep === 1 ? (
          <Stack spacing={2}>
            <Typography variant="bodyMedium">{copy.wizard.bodyIntro}</Typography>
            <CodeBlock value={config.body} label={t('common.copy')} />


            <Divider />
            <Typography variant="bodySmall" color="text.secondary">
              {copy.wizard.bodyLegacy}
            </Typography>
            <CodeBlock value={legacyBody} label={t('common.copy')} />

            <Divider />
            <Typography variant="titleMedium" component="h3">
              {copy.wizard.fieldTable.header}
            </Typography>
            <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{copy.wizard.fieldTable.columnKey}</TableCell>
                    <TableCell>{copy.wizard.fieldTable.columnPlaceholder}</TableCell>
                    <TableCell>{copy.wizard.fieldTable.columnMeaning}</TableCell>
                    <TableCell align="right">{copy.wizard.fieldTable.columnRequired}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {INGEST_FIELDS.map((field) => (
                    <TableRow key={field.key}>
                      <TableCell>
                        <Box component="code" sx={{ fontFamily: 'monospace' }}>
                          {field.key}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box component="code" sx={{ fontFamily: 'monospace' }}>
                          {bodyTemplate[field.key]}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="bodySmall">{copy.fieldMeanings[field.key]}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        {field.required ? (
                          <Chip size="small" color="primary" label={copy.wizard.fieldTable.required} />
                        ) : (
                          <Chip size="small" variant="outlined" label={copy.wizard.fieldTable.optional} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        ) : null}

        {activeStep === 2 ? (
          <Stack spacing={2}>
            {secret ? (
              <>
                <Typography variant="bodyMedium">{copy.wizard.secretIntro}</Typography>
                {/* 标签在上、代码值独占一整行：flex 挤排时 32 位 token 会被逐字折断成纵向栏 */}
                {[
                  { label: copy.wizard.secretLabel, value: secret },
                ].map((row) => (
                  <Box
                    key={row.label}
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: md3Geometry.shape.sm,
                      px: 1.5,
                      py: 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                      <Typography variant="labelLarge" color="text.secondary">
                        {row.label}
                      </Typography>
                      <CopyButton value={row.value} label={t('common.copy')} />
                    </Box>
                    <Box
                      component="code"
                      sx={{
                        display: 'block',
                        width: '100%',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {row.value}
                    </Box>
                  </Box>
                ))}
                <Alert severity="info">{copy.wizard.secretHint}</Alert>
              </>
            ) : (
              <Alert severity="info">
                <Typography variant="bodyMedium" sx={{ mb: 1 }}>
                  {copy.wizard.secretMissing}
                </Typography>
                <Button
                  variant="contained"
                  disabled={!canManage || rotate.isPending}
                  onClick={handleRegenerate}
                >
                  {copy.wizard.regenerate}
                </Button>
              </Alert>
            )}

          </Stack>
        ) : null}

        {/* 第 5 步：测试连接。进入该步自动开始自检，收到推送即切换为祝贺态 */}
        {activeStep === 4 ? <SelfCheckPanel deviceId={device.id} onSkip={onClose} autoStart /> : null}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={onClose} color="inherit">
          {copy.wizard.close}
        </Button>
        <Stack direction="row" spacing={1}>
          <Button disabled={activeStep === 0} onClick={() => setActiveStep((step) => step - 1)}>
            {copy.wizard.prev}
          </Button>
          {activeStep < stepLabels.length - 1 ? (
            <Button variant="contained" onClick={() => setActiveStep((step) => step + 1)}>
              {copy.wizard.next}
            </Button>
          ) : (
            <Button variant="contained" onClick={onClose}>
              {copy.wizard.done}
            </Button>
          )}
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
