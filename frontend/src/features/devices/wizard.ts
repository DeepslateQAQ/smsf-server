/**
 * 接入向导的配置文本构造 —— 纯函数，无副作用，方便单测。
 *
 * 向导分四段：地址 / 请求头 / 请求体模板 / secret。
 * 请求体模板里全部是 SmsForwarder 会做字符串替换的占位符，因此这里用常量对象
 * 构造再序列化，保证界面展示的那段 JSON 一定能被 `JSON.parse` 解析。
 */

/** 后端入库端点（相对路径）。 */
export const INGEST_PATH = '/api/v1/ingest';

/** 唯一需要的请求头。 */
export const INGEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'application/json',
});

/** receive_time 的主格式：带冒号的 ISO8601 时区偏移（如 +08:00）。 */
export const RECEIVE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm:ssXXX";

/** 低版本 Android（Java SimpleDateFormat 不认 XXX）的备用写法，偏移无冒号（如 +0800）。 */
export const RECEIVE_TIME_FORMAT_LEGACY = "yyyy-MM-dd'T'HH:mm:ssZ";

/** 构造请求体模板对象。每次返回新对象，调用方可安全修改。 */
export function buildIngestBodyTemplate(options: { legacyReceiveTime?: boolean } = {}): Record<string, string> {
  const format = options.legacyReceiveTime ? RECEIVE_TIME_FORMAT_LEGACY : RECEIVE_TIME_FORMAT;
  return {
    from: '[from]',
    content: '[content]',
    org_content: '[org_content]',
    receive_time: `[receive_time:${format}]`,
    timestamp: '[timestamp]',
    sign: '[sign]',
    device_mark: '[device_mark]',
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
  /** App 模板里替换的占位符 */
  placeholder: string;
  /** 是否必须配置 */
  required: boolean;
}

/** 模板逐字段说明的骨架（文案见 locales.ts）。 */
export const INGEST_FIELDS: readonly IngestFieldSpec[] = [
  { key: 'from', placeholder: '[from]', required: true },
  { key: 'content', placeholder: '[content]', required: true },
  { key: 'org_content', placeholder: '[org_content]', required: false },
  { key: 'receive_time', placeholder: `[receive_time:${RECEIVE_TIME_FORMAT}]`, required: false },
  { key: 'timestamp', placeholder: '[timestamp]', required: true },
  { key: 'sign', placeholder: '[sign]', required: false },
  { key: 'device_mark', placeholder: '[device_mark]', required: true },
  { key: 'card_slot', placeholder: '[card_slot]', required: false },
];

export interface WizardConfigInput {
  /** 浏览器 origin，例如 https://sms.example.com */
  origin: string;
  /** 仅在创建/轮换响应里拿得到，可能为空 */
  secret?: string | null;
}

export interface WizardConfig {
  /** 第 1 段：Webhook 地址 */
  endpoint: string;
  /** 第 2 段：请求头 */
  headers: string;
  /** 第 3 段：请求体模板（合法 JSON） */
  body: string;
  /** 第 4 段：secret，仅在本次会话可见 */
  secret: string;
}

/** 把四段配置文本一次性算出来，供向导复制按钮与单测使用。 */
export function buildWizardConfig(input: WizardConfigInput): WizardConfig {
  const origin = input.origin.replace(/\/+$/, '');
  const template = buildIngestBodyTemplate();
  return {
    endpoint: `${origin}${INGEST_PATH}`,
    headers: JSON.stringify(INGEST_HEADERS),
    body: JSON.stringify(template, null, 2),
    secret: input.secret ?? '',
  };
}
