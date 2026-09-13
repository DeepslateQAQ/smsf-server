/**
 * MD3 几何度量单一事实源（single source of truth）。
 *
 * 组件覆盖层（`src/theme/index.ts` 的 `components`）与业务层的局部几何覆盖
 * （`app/Layout.tsx`、`components/TonalButton.tsx` 等）只能引用本表，
 * 不得再写死尺寸/圆角/字号。数值单位：长度 = px，type 的 fontSize/lineHeight/
 * letterSpacing 与 MUI `typography` 兼容（数字按 px 处理）。
 *
 * 规范表之外的补充条目（均在此集中，避免散落）：
 * - `shape.xxs`        Checkbox 圆角 2
 * - `height.divider` / `height.tabIndicator` / `height.linearProgress` / `height.sliderTrack`
 * - `height.navIndicator` 导航栏/列表选中胶囊高度 32（与 `width.navIndicator` 配对）
 * - `height.snackbar` / `height.touchTarget`
 * - `width.dialogMin` / `width.dialogMax`（Dialog min/max 宽度）
 * - `width.sliderThumb`
 * - `border.hairline|standard`：1px / 2px 描边（Divider、轮廓、Switch thumb/track）
 * - `field.outlined|filled`：输入框内部对齐常量（撑出 56px 高、label 上下位置）
 * - `size.tooltipMaxWidth` / `size.scrollbarThickness`
 * - `type.display*` / `type.headlineLarge|Medium` / `type.bodySmall`：原 MD3 type scale 中
 *   规范表未列出的变体，数值原样保留，保证整张 type scale 仍只有一个事实源。
 */
export const md3Geometry = {
  /**
   * 圆角。**必须是 px 字符串**，不能是裸数字：MUI 的 `sx` 会把数字 `borderRadius`
   * 乘以 `theme.shape.borderRadius`（本主题为 12），于是 `16` 会渲染成 192px、
   * `999` 变成 11988px —— 曾经真的把登录卡片、色板、Chip 都渲染成了圆球。
   * 需要数字形态时用 `shape.number`（MUI 的 `theme.shape.borderRadius` 只接受数字）。
   */
  shape: {
    none: '0px',
    xxs: '2px',
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '28px',
    full: '999px',
    /** 数字形态，仅用于 MUI 需要数字的场景（`theme.shape.borderRadius`）。 */
    number: { none: 0, xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 28, full: 999 },
  },

  height: {
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
    /* --- 规范表外的补充条目 --- */
    divider: 1,
    tabIndicator: 3,
    linearProgress: 4,
    sliderTrack: 4,
    navIndicator: 32,
    snackbar: 48,
    touchTarget: 40,
  },

  width: {
    switchTrack: 52,
    navRail: 80,
    navIndicator: 56,
    switchThumbOn: 24,
    switchThumbOff: 16,
    /* --- 规范表外的补充条目 --- */
    dialogMin: 280,
    dialogMax: 560,
    sliderThumb: 20,
  },

  icon: { sm: 18, md: 20, lg: 24 },

  space: { x0: 0, x1: 4, x2: 8, x3: 12, x4: 16, x5: 20, x6: 24, x8: 32 },

  /* --- 规范表外的补充条目（二）：描边宽度 / 输入框对齐常量 / 杂项尺寸 --- */
  /** 描边宽度：hairline = 1px（Divider、轮廓、分隔线），standard = 2px（Switch、聚焦轮廓）。 */
  border: { hairline: 1, standard: 2 },

  /** TextField 系列的内部对齐常量（保证正好 56px 高、label 上下位置正确）。 */
  field: {
    outlined: { paddingBlock: 16.5, paddingInline: 14, labelRestX: 14, labelRestY: 16, labelShrinkY: -9 },
    filled: { paddingTop: 25, paddingInline: 12, paddingBottom: 8, labelRestX: 12, labelRestY: 16, labelShrinkY: 7 },
    /**
     * `size="small"` 变体（筛选栏等密集工具行用）：
     * - 无 label（hiddenLabel）：40 高，与 40 的分段按钮/按钮同节奏；
     * - 有 label：48 高（label 仍要在盒内上浮，不能再压到 40）；
     * - 数值沿用 MUI 内置 small 几何（21/4、8/9、label 位置），防止与组件内部测量打架。
     */
    small: {
      height: 44,
      heightWithLabel: 52,
      filled: {
        hidden: { paddingTop: 8, paddingBottom: 9, paddingInline: 12 },
        withLabel: { paddingTop: 21, paddingBottom: 4, paddingInline: 12 },
        labelRestX: 12,
        labelRestY: 13,
        labelShrinkY: 4,
      },
      outlined: {
        paddingBlock: 8.5,
        paddingInline: 14,
        labelRestX: 14,
        labelRestY: 9,
        labelShrinkY: -9,
      },
    },
  },

  /** 杂项尺寸（非 MD3 规范表条目，但同样不能散落在组件覆盖里）。 */
  size: { tooltipMaxWidth: 300, scrollbarThickness: 10 },

  type: {
    displayLarge: { fontSize: '3.5rem', fontWeight: 400, lineHeight: 1.12, letterSpacing: '-0.02em' },
    displayMedium: { fontSize: '2.75rem', fontWeight: 400, lineHeight: 1.16, letterSpacing: '-0.01em' },
    displaySmall: { fontSize: '2.25rem', fontWeight: 400, lineHeight: 1.22 },
    headlineLarge: { fontSize: '2rem', fontWeight: 400, lineHeight: 1.25 },
    headlineMedium: { fontSize: '1.75rem', fontWeight: 400, lineHeight: 1.28 },
    headlineSmall: { fontSize: 24, fontWeight: 400, lineHeight: '32px', letterSpacing: '0' },
    titleLarge: { fontSize: 22, fontWeight: 400, lineHeight: '28px', letterSpacing: '0' },
    titleMedium: { fontSize: 16, fontWeight: 500, lineHeight: '24px', letterSpacing: '0.15px' },
    titleSmall: { fontSize: 14, fontWeight: 500, lineHeight: '20px', letterSpacing: '0.1px' },
    bodyLarge: { fontSize: 16, fontWeight: 400, lineHeight: '24px', letterSpacing: '0.5px' },
    bodyMedium: { fontSize: 14, fontWeight: 400, lineHeight: '20px', letterSpacing: '0.25px' },
    bodySmall: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.45, letterSpacing: '0.02em' },
    labelLarge: { fontSize: 14, fontWeight: 500, lineHeight: '20px', letterSpacing: '0.1px' },
    labelMedium: { fontSize: 12, fontWeight: 500, lineHeight: '16px', letterSpacing: '0.5px' },
    labelSmall: { fontSize: 11, fontWeight: 500, lineHeight: '16px', letterSpacing: '0.5px' },
  },
} as const;
