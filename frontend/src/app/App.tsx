import { CssBaseline } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { ThemeModeProvider } from '@/theme/ThemeModeProvider';

import { createQueryClient } from './queryClient';
import { router } from './router';

export default function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeModeProvider>
          <CssBaseline enableColorScheme />
          <RouterProvider router={router} />
        </ThemeModeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export { App };
