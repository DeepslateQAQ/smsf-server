import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';

/** 统一的 QueryClient 配置：4xx 不重试，网络/5xx 最多重试 2 次。 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            if (error.status === 0) return failureCount < 2;
            if (error.status < 500) return false;
          }
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
