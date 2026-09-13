/**
 * 头像：URL 工厂 + 上传/删除。
 *
 * 服务端只认重新解码编码后的位图（见 `services/avatar.py`），前端再做一层廉价的
 * 大小/类型预检，拒绝时给出本地错误，不白白 POST。
 */

import { API_PREFIX, api, request } from './client';
import type { UserOut } from './types';

/** 服务端上限的镜像（4MB 原始字节，处理详情在 `services/avatar.py`）。 */
export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

/**
 * 头像可 GET 的 URL；`avatar_updated_at` 指纹拼进 query，更新即失效。
 * 未设置头像返回 undefined（回退到首字母 Avatar）。
 */
export function avatarUrl(user: Pick<UserOut, 'id' | 'has_avatar' | 'avatar_updated_at'>): string | undefined {
  if (!user.has_avatar || !user.avatar_updated_at) return undefined;
  return `${API_PREFIX}/auth/users/${user.id}/avatar?v=${encodeURIComponent(user.avatar_updated_at)}`;
}

/** 本地上传预检：返回错误码（`type` / `too_large`，由调用方查 i18n 文案），null 表示可以上传。 */
export function validateAvatarFile(file: File): 'type' | 'too_large' | null {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return 'type';
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return 'too_large';
  }
  return null;
}

export function uploadAvatar(file: File): Promise<UserOut> {
  return request<UserOut>('PUT', '/auth/me/avatar', file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
}

export function deleteAvatar(): Promise<UserOut> {
  return api.del<UserOut>('/auth/me/avatar');
}
