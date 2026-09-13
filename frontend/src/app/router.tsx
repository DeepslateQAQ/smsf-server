import { Box, CircularProgress } from '@mui/material';
import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Outlet, createBrowserRouter, useLocation, type RouteObject } from 'react-router';

import { useSetupStatus } from '@/api/queries';
import LoadingBoundary from '@/components/LoadingBoundary';
import LoginPage from '@/features/auth/LoginPage';
import RegisterPage from '@/features/auth/RegisterPage';
import SetupPage from '@/features/auth/SetupPage';
import { useAuth } from '@/features/auth/AuthProvider';
import { useT } from '@/i18n';

import Layout from './Layout';
import RouteError from './RouteError';

// 功能页按需加载：登录/初始化页不下载消息、设备、管理页面的代码
const MessagesPage = lazy(() => import('@/features/messages/MessagesPage'));
const DevicesPage = lazy(() => import('@/features/devices/DevicesPage'));
const AdminPage = lazy(() => import('@/features/admin/AdminPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));

function PageFallback() {
  return (
    <LoadingBoundary loading>
      <Box />
    </LoadingBoundary>
  );
}

function withSuspense(node: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{node}</Suspense>;
}

function FullPageLoader() {
  const t = useT();
  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label={t('app.loading')}
      sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}
    >
      <CircularProgress />
    </Box>
  );
}

/** 未初始化时强制跳到 /setup；已初始化时 /setup 自身会跳转。 */
function BootstrapGate() {
  const { loading } = useAuth();
  const setupStatus = useSetupStatus();
  const location = useLocation();

  if (loading || setupStatus.isLoading) return <FullPageLoader />;
  if (setupStatus.data?.setup_required && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }
  return <Outlet />;
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!user) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from: from === '/' ? undefined : from }} />;
  }
  return <Outlet />;
}

function RequireAdmin() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user?.is_admin) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** 路由表：生产用 `createBrowserRouter`，测试用 `createMemoryRouter`。 */
export const appRoutes: RouteObject[] = [
  {
    element: <BootstrapGate />,
    children: [
      { path: '/setup', element: <SetupPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <Layout />,
            errorElement: <RouteError />,
            children: [
              { index: true, element: withSuspense(<MessagesPage />) },
              { path: 'devices', element: withSuspense(<DevicesPage />) },
              { path: 'settings', element: withSuspense(<SettingsPage />) },
              {
                element: <RequireAdmin />,
                children: [{ path: 'admin', element: withSuspense(<AdminPage />) }],
              },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);

export default router;
