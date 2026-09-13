/**
 * messages 功能内的剪贴板入口：实现已上收到 `@/lib/clipboard` 的唯一实现，
 * 这里只保留原有导出名 `copyToClipboard` 供既有调用方使用。
 */

export { copyText, copyText as copyToClipboard } from '@/lib/clipboard';
