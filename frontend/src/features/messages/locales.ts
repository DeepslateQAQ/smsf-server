/**
 * messages 功能模块的局部文案（不修改 `src/i18n/**`）。
 *
 * 只放基础文案里没有的键；组件通过 `useMessagesT()` 先查本表、再回落到 shell 的 `useT()`。
 * 支持 `{{name}}` 插值，语义与全局 i18n 一致。
 */

import { useCallback } from 'react';

import { currentLocale, useT } from '@/i18n';

export type MessagesTranslate = (key: string, vars?: Record<string, unknown>) => string;

const zh = {
  messages: {
    density: '显示密度',
    densityCompact: '紧凑',
    densityComfortable: '舒适',


    quickTime: '时间范围',
    quickToday: '今天',
    quick7d: '近 7 天',
    quick30d: '近 30 天',
    quickAll: '全部',


    kindFilter: '类型',
    kindAll: '全部类型',
    sortBy: '排序',
    sortReceivedAt: '接收时间',
    sortIngestedAt: '入库时间',
    sortOrder: '方向',
    orderDesc: '新→旧',
    orderAsc: '旧→新',

    clearAll: '清除全部',
    filterBadge: '{{count}} 个条件',
    deviceFilter: '设备',
    senderFilter: '发件人',
    senderSearch: '搜索发件人',
    deviceSearch: '搜索设备',
    codeOnly: '只看验证码',
    allDevices: '全部设备',
    allSenders: '全部发件人',

    codeMore: '+{{count}}',
    codeCopyHint: '点击复制验证码',
    codeCopied: '验证码已复制',
    codeCopyFailed: '复制失败，请手动选择文本',
    noCode: '无验证码',
    candidatesTitle: '候选验证码（{{count}}）',
    candidatePrimary: '推荐',
    candidateConfidence: '置信度 {{value}}%',
    candidateCopy: '复制 {{code}}',

    deleteSharedTitle: '删除共享设备上的消息？',
    deleteSharedWarning: '此操作会影响设备归属者。',
    deleteSharedBody: '「{{device}}」由 {{owner}} 共享给你，删除后对方也看不到这条消息。',
    deleteSharedConfirm: '仍然删除',
    deleteOwnBody: '删除后无法恢复。',
    noDeletePermission: '你没有删除这条消息的权限',

    purgePreserve: '保留最近',
    purgeDays: '{{count}} 天',
    purgeOwnOnly: '一键清理只作用于你拥有的设备，共享设备不会被删除。',
    purgeScopeFilter: '仅清理当前筛选的设备',
    purgeConfirmTitle: '再次确认清理',
    purgeConfirmBody: '将永久删除 {{days}} 天之前的消息（{{scope}}），操作不可撤销。',
    purgeScopeNone: '当前筛选范围内没有属于你的设备，未执行清理',
    purgeScopeOwned: '全部自有设备',
    purgeScopeChosen: '当前筛选的 {{count}} 台自有设备',
    purgeDone: '已清理 {{count}} 条消息',
    purgeEmpty: '没有符合条件的消息被删除',

    exportTitle: '导出',
    exportCsv: '导出 CSV',
    exportJson: '导出 JSON',
    exportHint: '导出当前筛选结果',

    liveRetrying: '连接断开，{{seconds}}s 后重连',
    liveOffline: '实时推送未连接',
    refreshNow: '立即刷新',

    summaryEmpty: '（无正文）',
    deviceShared: '共享',
    deviceOwned: '自有',
    ownerLabel: '归属者',
    rowActions: '操作',
    codeExpiresIn: '{{time}} 后失效',
  },
};

const en: typeof zh = {
  messages: {
    density: 'Density',
    densityCompact: 'Compact',
    densityComfortable: 'Comfortable',


    quickTime: 'Time range',
    quickToday: 'Today',
    quick7d: 'Last 7 days',
    quick30d: 'Last 30 days',
    quickAll: 'All',


    kindFilter: 'Type',
    kindAll: 'All types',
    sortBy: 'Sort by',
    sortReceivedAt: 'Received',
    sortIngestedAt: 'Ingested',
    sortOrder: 'Direction',
    orderDesc: 'Newest first',
    orderAsc: 'Oldest first',

    clearAll: 'Clear all',
    filterBadge: '{{count}} filters',
    deviceFilter: 'Device',
    senderFilter: 'Sender',
    senderSearch: 'Search senders',
    deviceSearch: 'Search devices',
    codeOnly: 'With code only',
    allDevices: 'All devices',
    allSenders: 'All senders',

    codeMore: '+{{count}}',
    codeCopyHint: 'Click to copy the code',
    codeCopied: 'Code copied',
    codeCopyFailed: 'Copy failed, select the text manually',
    noCode: 'No code',
    candidatesTitle: 'Candidate codes ({{count}})',
    candidatePrimary: 'Best',
    candidateConfidence: 'Confidence {{value}}%',
    candidateCopy: 'Copy {{code}}',

    deleteSharedTitle: 'Delete a message on a shared device?',
    deleteSharedWarning: 'This also affects the device owner.',
    deleteSharedBody: '“{{device}}” is shared with you by {{owner}}; they will lose this message too.',
    deleteSharedConfirm: 'Delete anyway',
    deleteOwnBody: 'This cannot be undone.',
    noDeletePermission: 'You cannot delete this message',

    purgePreserve: 'Keep the last',
    purgeDays: '{{count}} days',
    purgeOwnOnly: 'Cleanup only touches devices you own; shared devices are never deleted.',
    purgeScopeFilter: 'Only devices in the current filter',
    purgeConfirmTitle: 'Confirm cleanup',
    purgeConfirmBody: 'Messages older than {{days}} days will be deleted ({{scope}}). This cannot be undone.',
    purgeScopeNone: 'No devices you own match the current filter; purge aborted',
    purgeScopeOwned: 'all owned devices',
    purgeScopeChosen: '{{count}} filtered owned devices',
    purgeDone: 'Deleted {{count}} messages',
    purgeEmpty: 'Nothing matched, no message was deleted',

    exportTitle: 'Export',
    exportCsv: 'Export CSV',
    exportJson: 'Export JSON',
    exportHint: 'Export the current filter result',

    liveRetrying: 'Disconnected, retrying in {{seconds}}s',
    liveOffline: 'Live updates offline',
    refreshNow: 'Refresh now',

    summaryEmpty: '(no body)',
    deviceShared: 'Shared',
    deviceOwned: 'Owned',
    ownerLabel: 'Owner',
    rowActions: 'Actions',
    codeExpiresIn: 'expires in {{time}}',
  },
};

export const messagesLocales = { zh, en };

export function messagesCopy(locale: 'zh' | 'en') {
  return locale === 'en' ? messagesLocales.en : messagesLocales.zh;
}

function lookupString(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** 非组件环境使用；找不到时返回 `key` 本身。 */
export function translateMessages(key: string, vars?: Record<string, unknown>, locale: 'zh' | 'en' = 'zh'): string {
  const template = lookupString(messagesCopy(locale), key);
  return template === undefined ? key : interpolate(template, vars);
}

/** 组件内：本表优先，未命中的键回落到 shell 的全局文案。 */
export function useMessagesT(): MessagesTranslate {
  const fallback = useT();
  const locale = currentLocale();
  return useCallback<MessagesTranslate>(
    (key, vars) => {
      const template = lookupString(messagesCopy(locale === 'en' ? 'en' : 'zh'), key);
      return template === undefined ? fallback(key, vars) : interpolate(template, vars);
    },
    [fallback, locale],
  );
}
