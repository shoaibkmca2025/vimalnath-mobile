import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { BootScreen } from '@/components/BootScreen';
import { RequireSession } from '@/components/RequireSession';
import { restoreSession } from '@/data/session';
import LoginPage from '@/pages/LoginPage';

/** Every page is its own chunk, loaded when it's first visited. */
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({ Component: (await load()).default });

export const router = createBrowserRouter([
  { path: '/login', Component: LoginPage, loader: restoreSession, HydrateFallback: BootScreen },
  { path: '/set-password', lazy: page(() => import('@/pages/SetPasswordPage')), HydrateFallback: BootScreen },
  {
    Component: RequireSession,
    loader: restoreSession,
    HydrateFallback: BootScreen,
    children: [
      {
        Component: AppShell,
        children: [
          { index: true, lazy: page(() => import('@/pages/DashboardPage')) },
          { path: 'orders', lazy: page(() => import('@/pages/OrdersPage')) },
          { path: 'orders/:id', lazy: page(() => import('@/pages/OrderDetailPage')) },
          { path: 'customers', lazy: page(() => import('@/pages/CustomersPage')) },
          { path: 'customers/:key', lazy: page(() => import('@/pages/CustomerDetailPage')) },
          { path: 'app-users', lazy: page(() => import('@/pages/AppUsersPage')) },
          { path: 'products', lazy: page(() => import('@/pages/ProductsPage')) },
          { path: 'products/new', lazy: page(() => import('@/pages/ProductEditorPage')) },
          { path: 'products/:id', lazy: page(() => import('@/pages/ProductEditorPage')) },
          { path: 'categories', lazy: page(() => import('@/pages/CategoriesPage')) },
          { path: 'price-lists', lazy: page(() => import('@/pages/PriceListsPage')) },
          { path: 'cutlist', lazy: page(() => import('@/pages/CutlistPage')) },
          { path: 'formulas', lazy: page(() => import('@/pages/FormulasPage')) },
          { path: 'sections', lazy: page(() => import('@/pages/SectionsPage')) },
          { path: 'banners', lazy: page(() => import('@/pages/BannersPage')) },
          { path: 'videos', lazy: page(() => import('@/pages/VideosPage')) },
          { path: 'activity', lazy: page(() => import('@/pages/ActivityPage')) },
          { path: 'staff', lazy: page(() => import('@/pages/StaffPage')) },
          { path: 'settings', lazy: page(() => import('@/pages/SettingsPage')) },
          { path: '*', lazy: page(() => import('@/pages/NotFoundPage')) },
        ],
      },
    ],
  },
]);
