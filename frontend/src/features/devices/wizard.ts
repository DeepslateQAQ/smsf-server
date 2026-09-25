/**
 * 接入向导的配置文本构造 —— 纯函数，无副作用，方便单测。
 *
 * 向导分四段：Webhook Server / Params / Secret / Headers。
 * Params 中除直接嵌入的 device_mark 外，其他动态值都是 SmsForwarder 会替换的占位符；
 * 这里用常量对象构造再序列化，保证界面展示的那段 JSON 一定能被 `JSON.parse` 解析。
 */

/** 后端入库端点（相对路径）。 */
export const INGEST_PATH = '/api/v1/ingest';

/** SmsForwarder 需要逐项填写的 Header 键值。 */
export interface HeaderPair {
  key: string;
  value: string;
}

export const INGEST_HEADER: Readonly<HeaderPair> = Object.freeze({
  key: 'Content-Type',
  value: 'application/json',
});

/** receive_time 的主格式：带冒号的 ISO8601 时区偏移（如 +08:00）。 */
export const RECEIVE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm:ssXXX";

/** 低版本 Android（Java SimpleDateFormat 不认 XXX）的备用写法，偏移无冒号（如 +0800）。 */
export const RECEIVE_TIME_FORMAT_LEGACY = "yyyy-MM-dd'T'HH:mm:ssZ";

/** 构造 Params 对象；device_mark 由向导直接嵌入，其他动态值由 App 替换。 */
export function buildIngestBodyTemplate(
  options: { legacyReceiveTime?: boolean; deviceMark?: string } = {},
): Record<string, string> {
  const format = options.legacyReceiveTime ? RECEIVE_TIME_FORMAT_LEGACY : RECEIVE_TIME_FORMAT;
  return {
    from: '[from]',
    content: '[content]',
    org_content: '[org_content]',
    receive_time: `[receive_time:${format}]`,
    timestamp: '[timestamp]',
    sign: '[sign]',
    device_mark: options.deviceMark ?? '[device_mark]',
    card_slot: '[card_slot]',
  };
}

export type IngestFieldKey =
  | 'from'
  | 'content'
  | 'org_content'
  | 'receive_time'
  | 'timestamp'
  | 'sign'
  | 'device_mark'
  | 'card_slot';

export interface IngestFieldSpec {
  /** JSON 字段名 */
  key: IngestFieldKey;
  /** 是否必须配置 */
  required: boolean;
}

/** 模板逐字段说明的骨架（值由 buildIngestBodyTemplate 提供，文案见 locales.ts）。 */
export const INGEST_FIELDS: readonly IngestFieldSpec[] = [
  { key: 'from', required: true },
  { key: 'content', required: true },
  { key: 'org_content', required: false },
  { key: 'receive_time', required: false },
  { key: 'timestamp', required: true },
  { key: 'sign', required: false },
  { key: 'device_mark', required: true },
  { key: 'card_slot', required: false },
];

export interface WizardConfigInput {
  /** 浏览器 origin，例如 https://sms.example.com */
  origin: string;
  /** 服务端生成的公开设备标识，直接嵌入 Params */
  deviceMark: string;
  /** 仅在创建/轮换响应里拿得到，可能为空 */
  secret?: string | null;
}

export interface WizardConfig {
  /** 第 1 段：Webhook Server */
  endpoint: string;
  /** 第 2 段：Params（合法 JSON） */
  body: string;
  /** 第 3 段：Secret，仅在本次会话可见 */
  secret: string;
  /** 第 4 段：Headers 键值对 */
  headers: HeaderPair;
}

/** 把四段配置文本一次性算出来，供向导复制按钮与单测使用。 */
export function buildWizardConfig(input: WizardConfigInput): WizardConfig {
  const origin = input.origin.replace(/\/+$/, '');
  const template = buildIngestBodyTemplate({ deviceMark: input.deviceMark });
  return {
    endpoint: `${origin}${INGEST_PATH}`,
    body: JSON.stringify(template, null, 2),
    secret: input.secret ?? '',
    headers: { ...INGEST_HEADER },
  };
}
