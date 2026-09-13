/** 兼容层：个别调用点使用 `@/api/http`。等价于 `@/api/client`。 */
export {
  ApiError,
  api,
  buildQueryString,
  isApiError,
  request,
  setUnauthorizedHandler,
  API_PREFIX,
  type Query,
  type QueryValue,
  type RequestOptions,
} from './client';

import { api } from './client';

export const http = api;
export default api;
