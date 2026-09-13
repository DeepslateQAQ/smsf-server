/** 可搜索的多选下拉（发件人 / 设备共用），选项带计数。 */

import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import { Autocomplete, Checkbox, Chip, TextField, Typography } from '@mui/material';
import { useMemo } from 'react';

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

export interface FacetsSelectProps {
  /** 有 label 时浮动在框内；`unlabeled` 时只作 aria-label，框内 solely 走 placeholder（筛选紧凑行用） */
  label: string;
  placeholder: string;
  options: FacetOption[];
  values: string[];
  onChange: (values: string[]) => void;
  loading?: boolean;
  width?: number;
  disabled?: boolean;
  /** 无浮动 label 的紧凑形态：placeholder + aria-label，44px 高 */
  unlabeled?: boolean;
}

export default function FacetsSelect({
  label,
  placeholder,
  options,
  values,
  onChange,
  loading = false,
  width = 220,
  disabled = false,
  unlabeled = false,
}: FacetsSelectProps) {
  const selected = useMemo<FacetOption[]>(() => {
    const byValue = new Map(options.map((option) => [option.value, option]));
    return values.map((value) => byValue.get(value) ?? { value, label: value });
  }, [options, values]);

  return (
    <Autocomplete
      multiple
      size="small"
      disableCloseOnSelect
      /* 超过一枚的比例折叠为 +N：单选 chip 不换行撑高筛选行 */
      limitTags={1}
      loading={loading}
      disabled={disabled}
      options={options}
      value={selected}
      /* 宽度是可生长基值（xs 独占一行）：让整行控件铺满卡片宽度，而不是右端留白 */
      sx={{ flex: { xs: '1 0 100%', sm: `1 1 ${width}px` }, minWidth: 0 }}
      getOptionLabel={(option) => option.label}
      isOptionEqualToValue={(option, value) => option.value === value.value}
      onChange={(_event, next) => onChange(next.map((option) => option.value))}
      renderOption={(props, option, { selected: isSelected }) => (
        <li {...props} key={option.value}>
          <Checkbox
            icon={<CheckBoxOutlineBlankIcon fontSize="small" />}
            checkedIcon={<CheckBoxIcon fontSize="small" />}
            style={{ marginRight: 8 }}
            checked={isSelected}
            size="small"
          />
          <Typography variant="bodyMedium" sx={{ flex: 1, minWidth: 0 }} noWrap>
            {option.label}
          </Typography>
          {option.count !== undefined ? (
            <Typography variant="labelSmall" color="text.secondary" sx={{ ml: 1 }}>
              {option.count}
            </Typography>
          ) : null}
        </li>
      )}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return <Chip key={key} size="small" label={option.label} {...tagProps} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={unlabeled ? undefined : label}
          hiddenLabel={unlabeled}
          inputProps={{ ...params.inputProps, 'aria-label': label }}
          /* 选中后不再渲染占位输入行：chip 已说明语义，占位行只会把控件撑成两行 */
          placeholder={values.length === 0 ? placeholder : ''}
        />
      )}
      noOptionsText={placeholder}
    />
  );
}
