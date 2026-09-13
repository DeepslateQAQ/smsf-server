/**
 * 剪贴板复制：优先 `navigator.clipboard.writeText`，失败时退回
 * `document.execCommand('copy')` 的 textarea 方案。
 *
 * 这是全站唯一的实现；`components/CopyButton.tsx` 与 messages 的
 * `features/messages/clipboard.ts` 都以这里为准。
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* 继续尝试兜底方案 */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
