import { describe, expect, it } from 'vitest';

import {
  buildIngestBodyTemplate,
  buildWizardConfig,
  INGEST_FIELDS,
  RECEIVE_TIME_FORMAT,
  RECEIVE_TIME_FORMAT_LEGACY,
} from './wizard';

const ORIGIN = 'https://sms.example.com';

describe('buildWizardConfig —— 向导四段配置文本', () => {
  const config = buildWizardConfig({ origin: ORIGIN, deviceMark: 'smsf-device', secret: 's3cr3t-value' });

  it('第 1 段 / 地址：origin + /api/v1/ingest', () => {
    expect(config.endpoint).toBe(`${ORIGIN}/api/v1/ingest`);
    expect(buildWizardConfig({ origin: `${ORIGIN}/`, deviceMark: 'smsf-device' }).endpoint).toBe(`${ORIGIN}/api/v1/ingest`);
  });

  it('第 2 段 / Headers：键和值可分别复制', () => {
    expect(config.headers).toEqual({ key: 'Content-Type', value: 'application/json' });
    expect(config.headers.key).toBe('Content-Type');
    expect(config.headers.value).toBe('application/json');
  });

  it('第 3 段 / 消息模板：JSON.parse 可解析且占位符齐全', () => {
    const parsed = JSON.parse(config.body) as Record<string, string>;
    expect(parsed).toEqual(buildIngestBodyTemplate({ deviceMark: 'smsf-device' }));
    expect(parsed).toMatchObject({
      from: '[from]',
      content: '[content]',
      org_content: '[org_content]',
      receive_time: `[receive_time:${RECEIVE_TIME_FORMAT}]`,
      timestamp: '[timestamp]',
      sign: '[sign]',
      device_mark: 'smsf-device',
      card_slot: '[card_slot]',
    });
  });

  it('第 3 段 / 低版本 Android 用 Z 备用写法', () => {
    expect(buildIngestBodyTemplate({ legacyReceiveTime: true }).receive_time).toBe(
      `[receive_time:${RECEIVE_TIME_FORMAT_LEGACY}]`,
    );
  });

  it('第 4 段 / secret：缺失时为空串', () => {
    expect(config.secret).toBe('s3cr3t-value');
    expect(buildWizardConfig({ origin: ORIGIN, deviceMark: 'smsf-device' }).secret).toBe('');
  });

  it('INGEST_FIELDS 逐字段说明覆盖模板的每个键', () => {
    expect(INGEST_FIELDS.map((field) => field.key).sort()).toEqual(
      Object.keys(buildIngestBodyTemplate()).sort(),
    );
  });
});
