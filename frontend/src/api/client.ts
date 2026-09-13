/**
 * HTTP 客户端：fetch + credentials: "include"。
 *
 * 约定：
 * - 路径可以写成 `/auth/me`（自动加 `/api` 前缀），也可以写成完整 `/api/auth/me`。
 * - 数组 query 会展开成重复参数：`{ device_ids: [1, 2] }` -> `?device_ids=1&device_ids=2`
 * - 非 2xx 响应抛 `ApiError`，`detail` 取响应 JSON 的 `detail` 字段。
 */

export type QueryValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | Array<string | number>;

export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** 401 时的全局回调（AuthProvider 注册：清理用户状态并跳转登录）。 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export const API_PREFIX = '/api';

function resolveUrl(path: string, query?: Query): string {
  let url = path;
  if (!/^https?:\/\//i.test(url)) {
    if (!url.startsWith('/')) url = `/${url}`;
    if (!url.startsWith(`${API_PREFIX}/`) && url !== API_PREFIX) url = `${API_PREFIX}${url}`;
  }
  const search = buildQueryString(query);
  return search ? `${url}${url.includes('?') ? '&' : '?'}${search}` : url;
}

export function buildQueryString(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value === 'string' && value === '') continue;
      params.append(key, String(value));
    }
  }
  return params.toString();
}

function normalizeDetail(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object') {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          if (item && typeof item === 'object') {
            const rec = item as { msg?: unknown; loc?: unknown };
            const loc = Array.isArray(rec.loc) ? rec.loc.join('.') : '';
            const msg = typeof rec.msg === 'string' ? rec.msg : JSON.stringify(item);
            return loc ? `${loc}: ${msg}` : msg;
          }
          return String(item);
        })
        .filter(Boolean);
      if (parts.length) return parts.join('; ');
    }
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return `HTTP ${status}`;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let payload: BodyInit | undefined;

  if (body !== undefined && body !== null) {
    if (
      typeof body === 'string' ||
      body instanceof FormData ||
      body instanceof URLSearchParams ||
      body instanceof Blob ||
      body instanceof ArrayBuffer
    ) {
      payload = body as BodyInit;
      if (typeof body === 'string' && !('Content-Type' in headers)) {
        headers['Content-Type'] = 'text/plain;charset=UTF-8';
      }
    } else {
      payload = JSON.stringify(body);
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    }
  }

  let response: Response;
  try {
    response = await fetch(resolveUrl(path, options.query), {
      method,
      headers,
      body: payload,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, error instanceof Error ? error.message : String(error));
  }

  const data = await parseBody(response);

  if (!response.ok) {
    if (response.status === 401 && unauthorizedHandler) {
      try {
        unauthorizedHandler();
      } catch {
        /* 回调异常不应覆盖原始错误 */
      }
    }
    throw new ApiError(response.status, normalizeDetail(data, response.status));
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query, options?: Omit<RequestOptions, 'query'>) =>
    request<T>('GET', path, undefined, { ...options, query }),
  post: <T>(path: string, body?: unknown, query?: Query, options?: Omit<RequestOptions, 'query'>) =>
    request<T>('POST', path, body, { ...options, query }),
  patch: <T>(path: string, body?: unknown, query?: Query, options?: Omit<RequestOptions, 'query'>) =>
    request<T>('PATCH', path, body, { ...options, query }),
  del: <T>(path: string, body?: unknown, query?: Query, options?: Omit<RequestOptions, 'query'>) =>
    request<T>('DELETE', path, body, { ...options, query }),
  request,
};

export default api;
