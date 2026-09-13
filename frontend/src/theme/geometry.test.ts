import { describe, expect, it } from 'vitest';

import { createAppTheme, md3Geometry, themeVars } from './index';

/**
 * 几何回归测试：从“主题对象”里取出组件覆盖，断言对外可见几何。
 *
 * 规则：期望值必须引用 `md3Geometry`（唯一事实源），不得在测试里重复写死数字；
 * 这样一旦有人绕过事实源改尺寸，测试会立刻失败。
 */

const theme = createAppTheme();
const vars = themeVars(theme);

type StyleObject = Record<string, any>;

const components = theme.components as unknown as Record<
  string,
  { styleOverrides?: Record<string, unknown> } | undefined
>;

/** 取出某个组件的覆盖（默认 `root` slot），函数式覆盖用真实主题求值。 */
function override(component: string, slot = 'root'): StyleObject {
  const styleOverrides = components[component]?.styleOverrides;
  expect(styleOverrides, `${component} 应有 styleOverrides`).toBeTruthy();
  const raw = styleOverrides?.[slot];
  expect(raw, `${component}.${slot} 覆盖应存在`).toBeTruthy();
  return (typeof raw === 'function' ? (raw as (props: { theme: typeof theme }) => StyleObject)({ theme }) : raw) as StyleObject;
}

describe('md3Geometry 事实源', () => {
  it('包含规范表里的形状/高度/宽度/图标/间距/字号条目', () => {
    expect(md3Geometry.shape).toMatchObject({
      none: '0px',
      xxs: '2px',
      xs: '4px',
      sm: '8px',
      md: '12px',
      lg: '16px',
      xl: '28px',
      full: '999px',
    });
    expect(md3Geometry.shape.number).toMatchObject({
      none: 0,
      xxs: 2,
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 28,
      full: 999,
    });
    expect(md3Geometry.height).toMatchObject({
      button: 40,
      segmentedButton: 40,
      iconButton: 40,
      fab: 56,
      chip: 32,
      textField: 56,
      listItem: 56,
      listItemTwoLine: 72,
      appBar: 64,
      tab: 48,
      menuItem: 48,
      dialogAction: 40,
      switchTrack: 32,
      switchThumbOn: 24,
      switchThumbOff: 16,
    });
    expect(md3Geometry.width).toMatchObject({ switchTrack: 52, navRail: 80, navIndicator: 56, switchThumbOn: 24, switchThumbOff: 16 });
    expect(md3Geometry.icon).toEqual({ sm: 18, md: 20, lg: 24 });
    expect(md3Geometry.border).toEqual({ hairline: 1, standard: 2 });
    expect(md3Geometry.field.outlined).toMatchObject({ paddingBlock: 16.5, paddingInline: 14 });
    expect(md3Geometry.field.filled).toMatchObject({ paddingTop: 25, paddingInline: 12, paddingBottom: 8 });
    expect(md3Geometry.size.tooltipMaxWidth).toBe(300);
    expect(md3Geometry.space).toMatchObject({ x0: 0, x1: 4, x2: 8, x3: 12, x4: 16, x5: 20, x6: 24, x8: 32 });
    expect(md3Geometry.type.labelLarge).toMatchObject({
      fontSize: 14,
      fontWeight: 500,
      lineHeight: '20px',
      letterSpacing: '0.1px',
    });
  });

  it('labelLarge 与 MD3 规范一致（14 / 500 / 20 / 0.1）', () => {
    expect(md3Geometry.type.labelLarge.fontSize).toBe(14);
    expect(md3Geometry.type.labelLarge.fontWeight).toBe(500);
    expect(md3Geometry.type.labelLarge.lineHeight).toBe('20px');
    expect(md3Geometry.type.labelLarge.letterSpacing).toBe('0.1px');
  });
});

describe('组件几何：数值全部引用 md3Geometry', () => {
  it('Button：40 高 / full 圆角 / 24 水平内边距 / labelLarge / text-transform none', () => {
    const root = override('MuiButton');
    expect(root.height).toBe(md3Geometry.height.button);
    expect(root.minHeight).toBe(md3Geometry.height.button);
    expect(root.borderRadius).toBe(md3Geometry.shape.full);
    expect(root.paddingInline).toBe(md3Geometry.space.x6);
    expect(root.paddingBlock).toBe(0);
    expect(root.fontSize).toBe(md3Geometry.type.labelLarge.fontSize);
    expect(root.fontWeight).toBe(md3Geometry.type.labelLarge.fontWeight);
    expect(root.lineHeight).toBe(md3Geometry.type.labelLarge.lineHeight);
    expect(root.letterSpacing).toBe(md3Geometry.type.labelLarge.letterSpacing);
    expect(root.textTransform).toBe('none');
    // 图标 18 / 图标-文字间隔 8
    expect(root['& .MuiButton-startIcon, & .MuiButton-endIcon']['& > *:nth-of-type(1)'].fontSize).toBe(md3Geometry.icon.sm);
    expect(root['& .MuiButton-startIcon'].marginRight).toBe(md3Geometry.space.x2);
    expect(root['& .MuiButton-endIcon'].marginLeft).toBe(md3Geometry.space.x2);
  });

  it('Chip：32 高 / 8 圆角 / 14、500 label / 12（带图标 8/12）内边距 / 1px outline', () => {
    const root = override('MuiChip');
    expect(root.height).toBe(md3Geometry.height.chip);
    expect(root.borderRadius).toBe(md3Geometry.shape.sm);
    expect(root.fontSize).toBe(md3Geometry.type.labelLarge.fontSize);
    expect(root.fontWeight).toBe(md3Geometry.type.labelLarge.fontWeight);
    const label = root['& .MuiChip-label'];
    expect(label.paddingLeft).toBe(md3Geometry.space.x3);
    expect(label.paddingRight).toBe(md3Geometry.space.x3);
    expect(label.fontSize).toBe(md3Geometry.type.labelLarge.fontSize);
    expect(label.fontWeight).toBe(md3Geometry.type.labelLarge.fontWeight);
    const icon = root['& .MuiChip-icon'];
    expect(icon.fontSize).toBe(md3Geometry.icon.sm);
    expect(icon.marginLeft).toBe(md3Geometry.space.x2);
    // 图标与文字间隔 = label padding(12) + icon marginRight(-4) = 8
    expect(label.paddingLeft + icon.marginRight).toBe(md3Geometry.space.x2);
    const outlined = root['&.MuiChip-outlined'];
    expect(outlined.borderColor).toBe(vars.palette.outline);
    // 描边占 1px：outlined 时图标仍在 8px、文字仍在 12px，图标-文字间隔仍是 8px
    expect(outlined['& .MuiChip-icon'].marginLeft + md3Geometry.border.hairline).toBe(md3Geometry.space.x2);
    expect(outlined['& .MuiChip-label'].paddingLeft + md3Geometry.border.hairline).toBe(md3Geometry.space.x3);
    expect(outlined['& .MuiChip-label'].paddingLeft + outlined['& .MuiChip-icon'].marginRight).toBe(md3Geometry.space.x2);
  });

  it('Switch：52 宽 × 32 高 / track full；未选中 thumb 16 + 2px outline，选中 thumb 24 onPrimary', () => {
    const root = override('MuiSwitch');
    expect(root.width).toBe(md3Geometry.width.switchTrack);
    expect(root.height).toBe(md3Geometry.height.switchTrack);
    expect(root.padding).toBe(0);
    const track = root['& .MuiSwitch-track'];
    expect(track.borderRadius).toBe(md3Geometry.shape.full);
    expect(track.opacity).toBe(1);
    const base = root['& .MuiSwitch-switchBase'];
    expect(base.width).toBe(md3Geometry.height.switchTrack);
    expect(base.height).toBe(md3Geometry.height.switchTrack);
    expect(base.padding).toBe((md3Geometry.height.switchTrack - md3Geometry.height.switchThumbOn) / 2);
    const thumb = base['& .MuiSwitch-thumb'];
    expect(thumb.width).toBe(md3Geometry.height.switchThumbOff);
    expect(thumb.height).toBe(md3Geometry.height.switchThumbOff);
    const checked = base['&.Mui-checked'];
    expect(checked.transform).toBe(`translateX(${md3Geometry.width.switchTrack - md3Geometry.height.switchTrack}px)`);
    expect(checked['& .MuiSwitch-thumb'].width).toBe(md3Geometry.height.switchThumbOn);
    expect(checked['& .MuiSwitch-thumb'].height).toBe(md3Geometry.height.switchThumbOn);
    expect(checked['& .MuiSwitch-thumb'].backgroundColor).toBe(vars.palette.onPrimary);
    expect(checked['& + .MuiSwitch-track'].backgroundColor).toBe(vars.palette.primary.main);
  });

  it('Fab：56 高 / 16 圆角 / 扩展态 20 水平内边距 + 12 图标间隔', () => {
    const root = override('MuiFab');
    expect(root.height).toBe(md3Geometry.height.fab);
    expect(root.borderRadius).toBe(md3Geometry.shape.lg);
    expect(root.paddingInline).toBe(md3Geometry.space.x5);
    expect(root.columnGap).toBe(md3Geometry.space.x3);
    const extended = override('MuiFab', 'extended');
    expect(extended.height).toBe(md3Geometry.height.fab);
    expect(extended.borderRadius).toBe(md3Geometry.shape.lg);
    expect(extended.paddingInline).toBe(md3Geometry.space.x5);
    expect(extended.minWidth).toBe(md3Geometry.height.fab);
  });

  it('Dialog：28 圆角 / min 280 / max 560 / 24 内边距 / headlineSmall 标题', () => {
    const paper = override('MuiDialog', 'paper');
    expect(paper.borderRadius).toBe(md3Geometry.shape.xl);
    expect(paper.minWidth).toBe(md3Geometry.width.dialogMin);
    expect(paper.maxWidth).toBe(md3Geometry.width.dialogMax);
    const title = override('MuiDialogTitle');
    expect(title.padding).toBe(md3Geometry.space.x6);
    expect(title.fontSize).toBe(md3Geometry.type.headlineSmall.fontSize);
    expect(title.fontWeight).toBe(md3Geometry.type.headlineSmall.fontWeight);
    expect(override('MuiDialogActions').padding).toBe(md3Geometry.space.x6);
    expect(override('MuiDialogContent').paddingLeft).toBe(md3Geometry.space.x6);
    expect(override('MuiDialogContent').paddingBottom).toBe(md3Geometry.space.x6);
  });

  it('TextField(OutlinedInput/FilledInput)：4 圆角 / 56 高 / 输入 16、400 / 上浮 label 12', () => {
    const outlined = override('MuiOutlinedInput');
    expect(outlined.borderRadius).toBe(md3Geometry.shape.xs);
    expect(outlined.height).toBe(md3Geometry.height.textField);
    expect(outlined.minHeight).toBe(md3Geometry.height.textField);
    const outlinedInput = outlined['& .MuiOutlinedInput-input'];
    expect(outlinedInput.fontSize).toBe(md3Geometry.type.bodyLarge.fontSize);
    expect(outlinedInput.fontWeight).toBe(md3Geometry.type.bodyLarge.fontWeight);
    expect(outlined['& .MuiOutlinedInput-notchedOutline'].borderWidth).toBe(md3Geometry.border.hairline);
    expect(outlined['&.Mui-focused .MuiOutlinedInput-notchedOutline'].borderWidth).toBe(md3Geometry.border.standard);

    const filled = override('MuiFilledInput');
    expect(filled.borderTopLeftRadius).toBe(md3Geometry.shape.xs);
    expect(filled.borderTopRightRadius).toBe(md3Geometry.shape.xs);
    expect(filled.height).toBe(md3Geometry.height.textField);
    expect(filled['& .MuiFilledInput-input'].fontSize).toBe(md3Geometry.type.bodyLarge.fontSize);

    const label = override('MuiInputLabel');
    expect(label.fontSize).toBe(md3Geometry.type.bodyLarge.fontSize);
    const shrink = override('MuiInputLabel', 'shrink');
    expect(shrink.fontSize).toBe(md3Geometry.type.labelMedium.fontSize);
    expect(shrink.fontWeight).toBe(md3Geometry.type.labelMedium.fontWeight);
    expect(shrink.lineHeight).toBe(md3Geometry.type.labelMedium.lineHeight);
  });

  it('ToggleButton / ToggleButtonGroup：40 高 / full 圆角 / 选中 secondaryContainer', () => {
    const root = override('MuiToggleButton');
    expect(root.height).toBe(md3Geometry.height.segmentedButton);
    expect(root.minHeight).toBe(md3Geometry.height.segmentedButton);
    expect(root.borderRadius).toBe(md3Geometry.shape.full);
    expect(root.fontSize).toBe(md3Geometry.type.labelLarge.fontSize);
    expect(root.fontWeight).toBe(md3Geometry.type.labelLarge.fontWeight);
    expect(root['&.Mui-selected'].backgroundColor).toBe(vars.palette.secondaryContainer);
    expect(root['&.Mui-selected'].color).toBe(vars.palette.onSecondaryContainer);
    expect(override('MuiToggleButtonGroup').borderRadius).toBe(md3Geometry.shape.full);
  });

  it('ListItemButton：56 高（双行 72）/ 行圆角 0 / 选中整行 stadium 胶囊（MD3 nav drawer）', () => {
    const root = override('MuiListItemButton');
    expect(root.height).toBe(md3Geometry.height.listItem);
    expect(root.minHeight).toBe(md3Geometry.height.listItem);
    expect(root.borderRadius).toBe(md3Geometry.shape.none);
    expect(root.paddingInline).toBe(md3Geometry.space.x4);
    expect(root['&.MuiListItemButton-alignItemsFlexStart'].minHeight).toBe(md3Geometry.height.listItemTwoLine);
    const selected = root['&.Mui-selected'];
    const pill = selected['&::before'];
    // 展开态：胶囊撑满整行（上下齐边、左右内缩 12）；收起 rail 的 56×32 居中胶囊由 Layout 覆盖。
    expect(pill.insetBlock).toBe(0);
    expect(pill.insetInlineStart).toBe(md3Geometry.space.x3);
    expect(pill.insetInlineEnd).toBe(md3Geometry.space.x3);
    expect(pill.borderRadius).toBe(md3Geometry.shape.full);
    expect(pill.backgroundColor).toBe(vars.palette.secondaryContainer);
    expect(selected.color).toBe(vars.palette.onSecondaryContainer);
    expect(selected.backgroundColor).toBe('transparent');
  });

  it('AppBar + Toolbar：64 高 / 0 圆角 / surface 底色 / 无阴影', () => {
    const root = override('MuiAppBar');
    expect(root.height).toBe(md3Geometry.height.appBar);
    expect(root.minHeight).toBe(md3Geometry.height.appBar);
    expect(root.borderRadius).toBe(md3Geometry.shape.none);
    expect(root.boxShadow).toBe('none');
    expect(root.backgroundColor).toBe(vars.palette.surface);
    expect(String(root.backgroundColor)).not.toContain('primary');
    expect(root['[data-mui-color-scheme="dark"] &'].backgroundColor).toBe(vars.palette.surface);
    expect(override('MuiToolbar').minHeight).toBe(md3Geometry.height.appBar);
  });

  it('Tabs / Tab：48 高 / 指示器 3px primary / label titleSmall 14、500', () => {
    const tab = override('MuiTab');
    expect(tab.minHeight).toBe(md3Geometry.height.tab);
    expect(tab.fontSize).toBe(md3Geometry.type.titleSmall.fontSize);
    expect(tab.fontWeight).toBe(md3Geometry.type.titleSmall.fontWeight);
    expect(tab.lineHeight).toBe(md3Geometry.type.titleSmall.lineHeight);
    expect(tab.textTransform).toBe('none');
    const tabsRoot = override('MuiTabs', 'root');
    expect(tabsRoot.minHeight).toBe(md3Geometry.height.tab);
    const indicator = override('MuiTabs', 'indicator');
    expect(indicator.height).toBe(md3Geometry.height.tabIndicator);
    expect(indicator.backgroundColor).toBe(vars.palette.primary.main);
  });

  it('IconButton：40×40 / full / 图标 24', () => {
    const root = override('MuiIconButton');
    expect(root.width).toBe(md3Geometry.height.iconButton);
    expect(root.height).toBe(md3Geometry.height.iconButton);
    expect(root.borderRadius).toBe(md3Geometry.shape.full);
    expect(root['& svg'].fontSize).toBe(md3Geometry.icon.lg);
  });

  it('Menu / MenuItem：项高 48 / 8 圆角 / 菜单上下 padding 8、0（MD3）/ 项 16、400', () => {
    const item = override('MuiMenuItem');
    expect(item.minHeight).toBe(md3Geometry.height.menuItem);
    expect(item['@media (min-width:600px)'].minHeight).toBe(md3Geometry.height.menuItem);
    expect(item.borderRadius).toBe(md3Geometry.shape.sm);
    expect(item.paddingBlock).toBe(0);
    expect(item.fontSize).toBe(md3Geometry.type.bodyLarge.fontSize);
    expect(item.fontWeight).toBe(md3Geometry.type.bodyLarge.fontWeight);
    expect(override('MuiMenu', 'list').padding).toBe(`${md3Geometry.space.x2}px ${md3Geometry.space.x0}px`);
    expect(override('MuiMenu', 'paper').borderRadius).toBe(md3Geometry.shape.sm);
  });

  it('Tooltip：4 圆角 / 4、8 内边距 / inverseSurface / labelSmall 11、500', () => {
    const tooltip = override('MuiTooltip', 'tooltip');
    expect(tooltip.borderRadius).toBe(md3Geometry.shape.xs);
    expect(tooltip.padding).toBe(`${md3Geometry.space.x1}px ${md3Geometry.space.x2}px`);
    expect(tooltip.backgroundColor).toBe(vars.palette.inverseSurface);
    expect(tooltip.color).toBe(vars.palette.inverseOnSurface);
    expect(tooltip.fontSize).toBe(md3Geometry.type.labelSmall.fontSize);
    expect(tooltip.fontWeight).toBe(md3Geometry.type.labelSmall.fontWeight);
  });

  it('Snackbar：min 48 / 4 圆角 / 0、16 内边距 / inverseSurface / bodyMedium', () => {
    const root = override('MuiSnackbarContent');
    expect(root.minHeight).toBe(md3Geometry.height.snackbar);
    expect(root.borderRadius).toBe(md3Geometry.shape.xs);
    expect(root.padding).toBe(`${md3Geometry.space.x0}px ${md3Geometry.space.x4}px`);
    expect(root.backgroundColor).toBe(vars.palette.inverseSurface);
    expect(root.color).toBe(vars.palette.inverseOnSurface);
    expect(root.fontSize).toBe(md3Geometry.type.bodyMedium.fontSize);
    expect(root.fontWeight).toBe(md3Geometry.type.bodyMedium.fontWeight);
  });

  it('Divider：1px outlineVariant', () => {
    const root = override('MuiDivider');
    expect(root.borderBottomWidth).toBe(md3Geometry.height.divider);
    expect(root.borderColor).toBe(vars.palette.outlineVariant);
    expect(override('MuiDivider', 'vertical').borderRightWidth).toBe(md3Geometry.height.divider);
  });

  it('Checkbox / Radio：原生图标几何（18 框 / 20-10 圆）+ 40 触控区', () => {
    const checkbox = override('MuiCheckbox');
    expect(checkbox.padding).toBe((md3Geometry.height.touchTarget - md3Geometry.icon.lg) / 2);
    expect(checkbox['& .MuiSvgIcon-root'].fontSize).toBe(md3Geometry.icon.lg);
    expect(checkbox.color).toBe(vars.palette.onSurfaceVariant);
    expect(checkbox['&.Mui-checked, &.MuiCheckbox-indeterminate'].color).toBe(vars.palette.primary.main);

    const radio = override('MuiRadio');
    expect(radio.padding).toBe((md3Geometry.height.touchTarget - md3Geometry.icon.lg) / 2);
    expect(radio['& .MuiSvgIcon-root'].fontSize).toBe(md3Geometry.icon.lg);
    expect(radio['&.Mui-checked'].color).toBe(vars.palette.primary.main);
  });

  it('Slider：轨道 4 / 手柄 20', () => {
    expect(override('MuiSlider', 'rail').height).toBe(md3Geometry.height.sliderTrack);
    expect(override('MuiSlider', 'track').height).toBe(md3Geometry.height.sliderTrack);
    const thumb = override('MuiSlider', 'thumb');
    expect(thumb.width).toBe(md3Geometry.width.sliderThumb);
    expect(thumb.height).toBe(md3Geometry.width.sliderThumb);
  });

  it('LinearProgress：轨道 4', () => {
    const root = override('MuiLinearProgress');
    expect(root.height).toBe(md3Geometry.height.linearProgress);
    expect(root.borderRadius).toBe(md3Geometry.shape.full);
  });
});

describe('label 字号缺陷回归（Button/Chip/Tab/SegmentedButton/MenuItem = labelLarge）', () => {
  it('typography.button 不再把 label 拖成 600', () => {
    expect(theme.typography.button.fontSize).toBe(md3Geometry.type.labelLarge.fontSize);
    expect(theme.typography.button.fontWeight).toBe(md3Geometry.type.labelLarge.fontWeight);
    expect(theme.typography.button.lineHeight).toBe(md3Geometry.type.labelLarge.lineHeight);
    expect(theme.typography.button.letterSpacing).toBe(md3Geometry.type.labelLarge.letterSpacing);
    expect(theme.typography.button.textTransform).toBe('none');
  });

  it('五个控件的 label 都是 14px、500（Chip/MenuItem 各自规范字号除外）', () => {
    const labelLarge = md3Geometry.type.labelLarge;
    for (const component of ['MuiButton', 'MuiChip', 'MuiTab', 'MuiToggleButton']) {
      const root = override(component);
      expect(root.fontSize, `${component} fontSize`).toBe(labelLarge.fontSize);
      expect(root.fontWeight, `${component} fontWeight`).toBe(labelLarge.fontWeight);
    }
    const menuItem = override('MuiMenuItem');
    expect(menuItem.fontSize).toBe(md3Geometry.type.bodyLarge.fontSize);
    expect(menuItem.fontWeight).toBe(md3Geometry.type.bodyLarge.fontWeight);
  });
});
