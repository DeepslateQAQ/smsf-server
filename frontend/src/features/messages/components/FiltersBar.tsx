/**
 * 筛选栏：关键词（300ms 防抖）、发送者多选（facets 带计数、可搜索）、设备多选、
 * 时间快捷项 + 自定义日期区间（MUI X 中文 locale）、排序字段/方向、has_code、类型，
 * 以及「清除全部」与当前条件计数徽标。所有状态由父组件同步进 URL query。
 */

import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import CloseIcon from '@mui/icons-material/Close';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SortOutlinedIcon from '@mui/icons-material/SortOutlined';
import {
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { md3Geometry } from '@/theme';
import type { DeviceOut, FacetsOut } from '@/api/types';

import {
  activeFilterCount,
  endOfDayIso,
  KIND_FILTERS,
  resolveTimeWindow,
  startOfDayIso,
  type KindFilter,
  type MessagesUrlState,
  type SortField,
  type SortOrder,
  type TimeRangePreset,
} from '../filters';
import { useMessagesT } from '../locales';
import FacetsSelect, { type FacetOption } from './FacetsSelect';

/** 关键词输入防抖：只在停止输入 300ms 后同步进 URL。 */
const KEYWORD_DEBOUNCE_MS = 300;

/**
 * 筛选控件的字段宽度（工具行布局常量，8px 网格对齐）：
 * 统一收在这里，保证两行 wrap 断点可预期，而不是各处散写 156/148。
 */
const FILTER_FIELD = { searchMin: 240, select: 184, date: 168, sortCombined: 220, segment: 152 } as const;

/**
 * 筛选行专用下拉：无浮动 label，startIcon + value 自释语义（图标 + aria-label 承担无障碍）。
 * 三个枚举筛选（类型/时间范围/排序方向/排序字段）统一成同一控件形态，不再混用分段按钮。
 */
function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
  icon,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  ariaLabel: string;
  icon: ReactNode;
  width: number;
}) {
  return (
    <TextField
      select
      size="small"
      hiddenLabel
      value={value}
      onChange={(event) => onChange(event.target.value)}
      /* 宽度是可生长基值：让整行控件铺满卡片宽度，而不是右端留白 */
      sx={{ flex: { xs: '1 0 100%', sm: `1 1 ${width}px` }, minWidth: 0 }}
      inputProps={{ 'aria-label': ariaLabel }}
      slotProps={{
        input: {
          startAdornment: <InputAdornment position="start">{icon}</InputAdornment>,
        },
      }}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

const KIND_LABEL_KEY: Record<KindFilter, string> = {
  sms: 'messages.kindSms',
  notification: 'messages.kindNotification',
  call: 'messages.kindCall',
};

export interface FiltersBarProps {
  state: MessagesUrlState;
  onChange: (patch: Partial<MessagesUrlState>) => void;
  /** 关键词（防抖后）单独提交，走 replace 不污染历史 */
  onKeyword: (value: string) => void;
  onClearAll: () => void;
  /** 父组件「清除全部」时自增，用来丢弃尚未提交的关键词草稿 */
  resetToken?: number;
  /** 交叉维面：去掉了「发件人 / 设备」自身筛选后计算的选项上下文（缺省时 options 退化为全部设备列表） */
  senderFacets?: FacetsOut;
  deviceFacets?: FacetsOut;
  facetsLoading?: boolean;
  devices?: DeviceOut[];
}

export default function FiltersBar({
  state,
  onChange,
  onKeyword,
  onClearAll,
  resetToken = 0,
  senderFacets,
  deviceFacets,
  facetsLoading = false,
  devices = [],
}: FiltersBarProps) {
  const t = useMessagesT();
  const [keyword, setKeyword] = useState(state.q ?? '');
  const timer = useRef<number | null>(null);
  const lastResetToken = useRef(resetToken);

  /** 丢弃尚未提交的关键词防抖任务。 */
  const cancelPending = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // 「清除全部」：即使 URL 里本来就没有 q，也要丢掉输入框草稿
  useEffect(() => {
    if (lastResetToken.current === resetToken) return;
    lastResetToken.current = resetToken;
    setKeyword('');
    cancelPending();
  }, [resetToken, cancelPending]);

  // 外部变化（清空筛选 / 分享链接 / 浏览器前进后退）时同步输入框，并取消尚未提交的防抖任务
  useEffect(() => {
    setKeyword((current) => (current === (state.q ?? '') ? current : state.q ?? ''));
    cancelPending();
  }, [state.q, cancelPending]);

  useEffect(() => () => cancelPending(), [cancelPending]);

  const handleKeyword = (next: string) => {
    setKeyword(next);
    cancelPending();
    timer.current = window.setTimeout(() => onKeyword(next), KEYWORD_DEBOUNCE_MS);
  };

  const senderOptions: FacetOption[] = (senderFacets?.senders ?? []).map((item) => ({
    value: item.value,
    label: item.label || item.value,
    count: item.count,
  }));

  const deviceOptions: FacetOption[] = deviceFacets?.devices?.length
    ? deviceFacets.devices.map((item) => ({ value: item.value, label: item.label, count: item.count }))
    : devices.map((device) => ({ value: String(device.id), label: device.name }));

  const count = activeFilterCount(state);
  const clearTime = { range: undefined, from: undefined, to: undefined } as const;
  /**
   * 时间预设不是独立状态：选择后把「开始/结束」解析为具体日期呈现在日期选择器里，
   * 用户能看到「近 7 天」到底是哪段区间（与 toApiQuery 的解析同源）。
   */
  const timeWindow = useMemo(() => resolveTimeWindow(state), [state]);

  return (
    <>
      {/* 独立搜索条（MD3 search bar 语义）：56px stadium、无下划线，作为整页主入口，
          不再把搜索挤进筛选卡片内部。 */}
      <TextField
        size="medium"
        hiddenLabel
        fullWidth
        value={keyword}
        onChange={(event) => handleKeyword(event.target.value)}
        placeholder={t('messages.searchPlaceholder')}
        aria-label={t('messages.searchPlaceholder')}
        sx={{
          /* MD3 search bar 不铺满宽屏：760 上限（移动端保持全宽） */
          maxWidth: { xs: '100%', md: 760 },
          '& .MuiFilledInput-root': {
            borderRadius: md3Geometry.shape.full,
            '&::before, &::after': { display: 'none' },
            /* MD3 search bar：leading icon 距左 16，无下划线后文字保持盒内居中 */
            px: `${md3Geometry.space.x4}px`,
          },
        }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
            endAdornment: keyword ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label={t('common.clear')}
                  onClick={() => {
                    cancelPending();
                    setKeyword('');
                    onKeyword('');
                  }}
                >
                  <CloseIcon />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          },
        }}
      />

      <Stack
        spacing={`${md3Geometry.space.x2}px`}
        sx={{
          p: { xs: `${md3Geometry.space.x2}px`, md: `${md3Geometry.space.x3}px` },
          border: `${md3Geometry.border.hairline}px solid`,
          borderColor: 'divider',
          borderRadius: md3Geometry.shape.md,
          bgcolor: 'background.paper',
        }}
      >
        {/* 「筛什么」行：发件人 + 设备；类型与只看验证码捆成不可拆小组，整组换行，不会出现孤行开关。 */}
        <Stack direction="row" spacing={`${md3Geometry.space.x1}px`} useFlexGap flexWrap="wrap" alignItems="center">
          <FacetsSelect
            unlabeled
            label={t('messages.senderFilter')}
            placeholder={t('messages.senderSearch')}
            options={senderOptions}
            values={state.senders}
            onChange={(values) => onChange({ senders: values })}
            loading={facetsLoading}
            width={FILTER_FIELD.select}
          />

          <FacetsSelect
            unlabeled
            label={t('messages.deviceFilter')}
            placeholder={t('messages.deviceSearch')}
            options={deviceOptions}
            values={state.deviceIds.map(String)}
            onChange={(values) =>
              onChange({
                deviceIds: values
                  .map((value) => Number.parseInt(value, 10))
                  .filter((value) => Number.isFinite(value)),
              })
            }
            loading={facetsLoading}
            width={FILTER_FIELD.select}
          />

          <FilterSelect
            value={state.kind ?? 'all'}
            onChange={(next) => onChange({ kind: next === 'all' ? undefined : (next as KindFilter) })}
            ariaLabel={t('messages.kindFilter')}
            icon={<CategoryOutlinedIcon fontSize="small" />}
            width={FILTER_FIELD.segment}
            options={[
              { value: 'all', label: t('messages.kindAll') },
              ...KIND_FILTERS.map((kind) => ({ value: kind, label: t(KIND_LABEL_KEY[kind]) })),
            ]}
          />

          <FormControlLabel
            labelPlacement="start"
            control={
              <Switch
                size="small"
                checked={state.hasCode}
                onChange={(event) => onChange({ hasCode: event.target.checked })}
              />
            }
            label={t('messages.codeOnly')}
            sx={{ m: 0, whiteSpace: 'nowrap' }}
          />
        </Stack>

      {/* 「什么时间 / 怎么排」行：时间快捷项、日期区间、排序各自捆成小组整体换行；
          条件数与「清除全部」作为工具组推到行尾，wrap 时整组落到下一行右对齐。 */}
      <Stack direction="row" spacing={`${md3Geometry.space.x1}px`} useFlexGap flexWrap="wrap" alignItems="center">
        <FilterSelect
          value={state.range ?? 'all'}
          onChange={(next) => onChange(next === 'all' ? clearTime : { ...clearTime, range: next as TimeRangePreset })}
          ariaLabel={t('messages.quickTime')}
          icon={<ScheduleOutlinedIcon fontSize="small" />}
          width={FILTER_FIELD.segment}
          options={[
            { value: 'today', label: t('messages.quickToday') },
            { value: '7d', label: t('messages.quick7d') },
            { value: '30d', label: t('messages.quick30d') },
            { value: 'all', label: t('messages.quickAll') },
          ]}
        />


        {/* 开始/结束解绑：窄屏各自整行，桌面并排并参与铺满。值呈现预设解析后的窗口。 */}
        <Stack direction="row" spacing={`${md3Geometry.space.x1}px`} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: `${md3Geometry.space.x1}px`, flex: { xs: '1 0 100%', sm: '1 1 352px' }, minWidth: 0 }}>
          <DatePicker
            label={t('messages.dateFrom')}
            value={timeWindow.from ? dayjs(timeWindow.from) : null}
            onChange={(value) =>
              onChange({
                from: value && value.isValid() ? startOfDayIso(value.toDate()) : undefined,
                range: undefined,
              })
            }
            format="YYYY-MM-DD"
            slotProps={{ textField: { size: 'small', sx: { flex: { xs: '1 0 100%', sm: '1 1 0' }, minWidth: 0 } } }}
          />
          <DatePicker
            label={t('messages.dateTo')}
            value={timeWindow.to ? dayjs(timeWindow.to) : null}
            onChange={(value) =>
              onChange({
                to: value && value.isValid() ? endOfDayIso(value.toDate()) : undefined,
                range: undefined,
              })
            }
            format="YYYY-MM-DD"
            slotProps={{ textField: { size: 'small', sx: { flex: { xs: '1 0 100%', sm: '1 1 0' }, minWidth: 0 } } }}
          />
        </Stack>

        {/* 排序字段 + 方向合并为一个下拉（移动端正文不再被 50% 截断） */}
        <FilterSelect
          value={`${state.sort}:${state.order}`}
          onChange={(next) => {
            const [sort, order] = next.split(':');
            onChange({ sort: sort as SortField, order: order as SortOrder });
          }}
          ariaLabel={`${t('messages.sortBy')} · ${t('messages.sortOrder')}`}
          icon={<SortOutlinedIcon fontSize="small" />}
          width={FILTER_FIELD.sortCombined}
          options={
            [
              { value: 'received_at:desc', label: `${t('messages.sortReceivedAt')} · ${t('messages.orderDesc')}` },
              { value: 'received_at:asc', label: `${t('messages.sortReceivedAt')} · ${t('messages.orderAsc')}` },
              { value: 'ingested_at:desc', label: `${t('messages.sortIngestedAt')} · ${t('messages.orderDesc')}` },
              { value: 'ingested_at:asc', label: `${t('messages.sortIngestedAt')} · ${t('messages.orderAsc')}` },
            ]
          }
        />

        <Stack direction="row" spacing={`${md3Geometry.space.x1}px`} alignItems="center" sx={{ ml: { md: 'auto' }, flexWrap: 'nowrap' }}>
          {count > 0 ? (
            <Chip
              size="small"
              color="primary"
              label={t('messages.filterBadge', { count })}
            />
          ) : null}
          <Button
            size="small"
            color="inherit"
            startIcon={<ClearAllIcon fontSize="small" />}
            disabled={count === 0}
            onClick={onClearAll}
          >
            {t('messages.clearAll')}
          </Button>
        </Stack>
      </Stack>
      </Stack>
    </>
  );
}
