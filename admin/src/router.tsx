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
          { path: 'order-requests', lazy: page(() => import('@/pages/OrderRequestsPage')) },
          { path: 'order-requests/new', lazy: page(() => import('@/pages/NewOrderRequestPage')) },
          { path: 'orders/:id', lazy: page(() => import('@/pages/OrderDetailPage')) },
          { path: 'inventory', lazy: page(() => import('@/pages/InventoryPage')) },
          { path: 'stock', lazy: page(() => import('@/pages/StockPage')) },
          { path: 'customers', lazy: page(() => import('@/pages/CustomersPage')) },
          { path: 'customers/:key', lazy: page(() => import('@/pages/CustomerDetailPage')) },
          { path: 'payments', lazy: page(() => import('@/pages/PaymentsPage')) },
          { path: 'feedback', lazy: page(() => import('@/pages/FeedbackPage')) },
          { path: 'gst', lazy: page(() => import('@/pages/GstDashboardPage')) },
          { path: 'gst/sales', lazy: page(() => import('@/pages/SalesRegisterPage')) },
          { path: 'gst/invoices/:id', lazy: page(() => import('@/pages/InvoicePage')) },
          { path: 'gst/purchases', lazy: page(() => import('@/pages/PurchaseRegisterPage')) },
          { path: 'gst/gstr1', lazy: page(() => import('@/pages/Gstr1Page')) },
          { path: 'gst/hsn', lazy: page(() => import('@/pages/HsnSummaryPage')) },
          { path: 'gst/payments', lazy: page(() => import('@/pages/GstPaymentsPage')) },
          { path: 'gst/settings', lazy: page(() => import('@/pages/GstSettingsPage')) },
          { path: 'returns', lazy: page(() => import('@/pages/ReturnsDashboardPage')) },
          { path: 'returns/list', lazy: page(() => import('@/pages/ReturnsListPage')) },
          { path: 'returns/requests', lazy: page(() => import('@/pages/ReturnsListPage')) },
          { path: 'returns/replacements', lazy: page(() => import('@/pages/ReturnsListPage')) },
          { path: 'returns/refunds', lazy: page(() => import('@/pages/RefundsPage')) },
          { path: 'returns/reports', lazy: page(() => import('@/pages/ReturnReportsPage')) },
          { path: 'returns/settings', lazy: page(() => import('@/pages/ReturnSettingsPage')) },
          { path: 'returns/new', lazy: page(() => import('@/pages/ReturnEditorPage')) },
          { path: 'returns/:id', lazy: page(() => import('@/pages/ReturnDetailPage')) },
          { path: 'returns/:id/edit', lazy: page(() => import('@/pages/ReturnEditorPage')) },
          { path: 'returns/:id/receipt', lazy: page(() => import('@/pages/ReturnReceiptPage')) },
          { path: 'supplier-returns', lazy: page(() => import('@/pages/SupplierReturnsPage')) },
          { path: 'supplier-returns/new', lazy: page(() => import('@/pages/SupplierReturnPage')) },
          { path: 'supplier-returns/:id', lazy: page(() => import('@/pages/SupplierReturnPage')) },
          { path: 'purchases', lazy: page(() => import('@/pages/PurchasesPage')) },
          { path: 'purchases/new', lazy: page(() => import('@/pages/PurchaseEditorPage')) },
          { path: 'purchases/:id', lazy: page(() => import('@/pages/PurchaseEditorPage')) },
          { path: 'suppliers', lazy: page(() => import('@/pages/SuppliersPage')) },
          { path: 'suppliers/:id', lazy: page(() => import('@/pages/SupplierDetailPage')) },
          { path: 'expenses', lazy: page(() => import('@/pages/ExpensesPage')) },
          { path: 'reports/:view?', lazy: page(() => import('@/pages/ReportsPage')) },
          { path: 'app-users', lazy: page(() => import('@/pages/AppUsersPage')) },
          { path: 'products', lazy: page(() => import('@/pages/ProductsPage')) },
          { path: 'products/new', lazy: page(() => import('@/pages/ProductEditorPage')) },
          { path: 'products/:id', lazy: page(() => import('@/pages/ProductEditorPage')) },
          { path: 'prices', lazy: page(() => import('@/pages/PricesPage')) },
          { path: 'categories', lazy: page(() => import('@/pages/CategoriesPage')) },
          { path: 'price-lists', lazy: page(() => import('@/pages/PriceListsPage')) },
          { path: 'cutlist', lazy: page(() => import('@/pages/CutlistPage')) },
          { path: 'formulas', lazy: page(() => import('@/pages/FormulasPage')) },
          { path: 'sections', lazy: page(() => import('@/pages/SectionsPage')) },
          { path: 'banners', lazy: page(() => import('@/pages/BannersPage')) },
          { path: 'videos', lazy: page(() => import('@/pages/VideosPage')) },
          { path: 'more-apps', lazy: page(() => import('@/pages/MoreAppsPage')) },
          { path: 'media', lazy: page(() => import('@/pages/MediaPage')) },
          { path: 'notifications', lazy: page(() => import('@/pages/NotificationsPage')) },
          { path: 'activity', lazy: page(() => import('@/pages/ActivityPage')) },
          { path: 'staff', lazy: page(() => import('@/pages/StaffPage')) },
          { path: 'settings', lazy: page(() => import('@/pages/SettingsPage')) },
          { path: '*', lazy: page(() => import('@/pages/NotFoundPage')) },
        ],
      },
    ],
  },
]);
