import {
  ArchiveIcon,
  ArrowUUpLeftIcon,
  CashRegisterIcon,
  FilePlusIcon,
  NotePencilIcon,
  PercentIcon,
  SealPercentIcon,
  ArrowsLeftRightIcon,
  ChartBarIcon,
  ChartLineUpIcon,
  CoinsIcon,
  HourglassIcon,
  HandCoinsIcon,
  ListChecksIcon,
  SealCheckIcon,
  BankIcon,
  BellIcon,
  BookOpenIcon,
  CalculatorIcon,
  CaretRightIcon,
  ChatsCircleIcon,
  ClipboardTextIcon,
  ClockCounterClockwiseIcon,
  CurrencyInrIcon,
  DeviceMobileIcon,
  FileTextIcon,
  FolderSimpleIcon,
  GearSixIcon,
  GridFourIcon,
  HashIcon,
  ImagesIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PaperPlaneTiltIcon,
  PlayCircleIcon,
  ReceiptIcon,
  RulerIcon,
  ScalesIcon,
  ScissorsIcon,
  SignOutIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  StorefrontIcon,
  TagIcon,
  TruckIcon,
  UserGearIcon,
  UsersThreeIcon,
  WalletIcon,
  WarehouseIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useNavigation } from 'react-router';

import { IconButton } from '@/components/Button';
import { CommandPalette } from '@/components/CommandPalette';
import { PageMetaContext, type PageMeta } from '@/components/pageMeta';
import { NotificationBell } from '@/components/NotificationBell';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { useApprovalCount } from '@/data/approvalCount';
import { creditDaysOf, isOverdue } from '@/data/payments';
import { useNewFeedback } from '@/data/feedback';
import { useReturnCounts } from '@/data/returnCounts';
import { useRequestNotifications } from '@/data/requestNotifications';
import { editsStock, seesStock, stockAlerts } from '@/data/stock';
import { inOrders } from '@/data/requests';
import { endSession, handlesMoney, movesOrders, readSession } from '@/data/session';
import { useData } from '@/data/useData';
import { initials } from '@/lib/format';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** `alert` shows the count as a red badge on the icon: new updates, not just work waiting. */
type NavItem = { to: string; label: string; icon: Icon; end?: boolean; count?: number; alert?: boolean; alertLabel?: string };

export function AppShell() {
  const { db } = useData();
  const session = readSession();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [meta, setMetaState] = useState<PageMeta>({ title: '', crumbs: [] });
  const mainRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);

  const setMeta = useCallback((next: PageMeta) => setMetaState(next), []);
  // Orders still on their way to the customer: new, confirmed, packed or dispatched. Each drops off once delivered.
  const undelivered = db.orders.filter((order) => inOrders(order) && ['placed', 'confirmed', 'packed', 'dispatched'].includes(order.status)).length;
  // Customers answering or receiving order requests since this person last opened Order Requests.
  const { count: requestUpdates } = useRequestNotifications(db.orders);
  // Bills still unpaid after their due day: delivery for cash, the credit period after it for credit. Each drops off once paid.
  const overdue = db.orders.filter((order) => isOverdue(order, creditDaysOf(db.settings))).length;
  // Orders still with the inventory team (pending, packed or dispatched); each drops off once delivered.
  const withInventory = db.orders.filter((order) => order.status === 'confirmed' || order.status === 'packed' || order.status === 'dispatched').length;
  // Every count is a red notification badge, the same everywhere.
  const inventoryItem: NavItem = { to: '/inventory', label: 'Inventory', icon: WarehouseIcon, count: withInventory, alert: true, alertLabel: 'not delivered yet' };
  // Items at or below their minimum, or out: red for those who restock (Owners, the inventory team), a plain link for Sales.
  const lowStock = stockAlerts(db.stock);
  const stockItem: NavItem = {
    to: '/stock',
    label: 'Stock',
    icon: ArchiveIcon,
    ...(editsStock(session?.role) ? { count: lowStock.low + lowStock.out, alert: true, alertLabel: 'low or out of stock' } : {}),
  };
  // What customers send from the app's menu; Owners and Sales read it.
  const seesFeedback = session?.role === 'owner' || session?.role === 'sales';
  const newFeedback = useNewFeedback(seesFeedback);
  // The inventory team only works on its own panel, the stock, returned goods to receive and check (and its password, under Settings).
  const inventoryOnly = session?.role === 'inventory';
  // Returns: Owners and Sales see the module; the inventory team the goods it receives and checks.
  const accountant = session?.role === 'accountant';
  const money = handlesMoney(session?.role);
  const seesReturns = session?.role === 'owner' || session?.role === 'sales' || inventoryOnly || accountant;
  const returnCounts = useReturnCounts(seesReturns);
  const returnsGroup = {
    title: 'Returns & Replacements',
    items: [
      { to: '/returns', label: 'Returns Dashboard', icon: ChartBarIcon, end: true },
      { to: '/returns/list', label: 'Customer Returns', icon: ArrowUUpLeftIcon, count: returnCounts.receive + returnCounts.inspect, alert: true, alertLabel: 'goods to receive or check' },
      { to: '/returns/replacements', label: 'Product Replacements', icon: ArrowsLeftRightIcon },
      { to: '/returns/refunds', label: 'Refund Management', icon: HandCoinsIcon, ...(money ? { count: returnCounts.refunds, alert: true, alertLabel: 'refunds in progress' } : {}) },
      { to: '/returns/requests', label: 'Return Requests', icon: SealCheckIcon, ...(session?.role === 'owner' ? { count: returnCounts.decide, alert: true, alertLabel: 'waiting for a decision' } : {}) },
      ...(money ? [{ to: '/supplier-returns', label: 'Supplier Returns', icon: StorefrontIcon }] : []),
      { to: '/returns/reports', label: 'Return Reports', icon: ListChecksIcon },
      ...(session?.role === 'owner' ? [{ to: '/returns/settings', label: 'Return Settings', icon: SlidersHorizontalIcon }] : []),
    ] as NavItem[],
  };

  // Counter billing: Owners and Sales bill; the Accountant reads the bills and handles their money.
  const bills = session?.role === 'owner' || session?.role === 'sales' || accountant;
  const makesBills = session?.role === 'owner' || session?.role === 'sales';
  const pendingApprovals = useApprovalCount(bills);
  const billingGroup = {
    title: 'Billing',
    items: [
      { to: '/billing', label: 'Billing', icon: CashRegisterIcon, end: true },
      ...(makesBills ? [{ to: '/billing/new', label: 'New Bill', icon: FilePlusIcon }] : []),
      { to: '/billing/quotations', label: 'Quotations', icon: NotePencilIcon },
      { to: '/billing/approvals', label: 'Discount Approvals', icon: SealPercentIcon, count: pendingApprovals, alert: true, alertLabel: 'waiting for approval' },
      { to: '/billing/discounts', label: 'Discount Management', icon: PercentIcon },
      { to: '/billing/discount-report', label: 'Discount Report', icon: ChartBarIcon },
      ...(session?.role === 'owner' ? [{ to: '/billing/settings', label: 'Invoice Settings', icon: SlidersHorizontalIcon }] : []),
    ] as NavItem[],
  };

  const groups: { title: string; items: NavItem[] }[] = inventoryOnly
    ? [
        { title: 'Inventory', items: [{ ...inventoryItem, label: 'Orders to Pack' }, stockItem, { to: '/returns/list', label: 'Returned Goods', icon: ArrowUUpLeftIcon, count: returnCounts.receive + returnCounts.inspect, alert: true, alertLabel: 'goods to receive or check' }] },
        { title: 'System', items: [{ to: '/settings', label: 'Settings', icon: GearSixIcon }] },
      ]
    : [
    { title: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: SquaresFourIcon, end: true }] },
    {
      title: 'Sales',
      items: [
        { to: '/orders', label: 'Orders', icon: ReceiptIcon, count: undelivered, alert: true, alertLabel: 'not delivered yet' },
        ...(movesOrders(session?.role) ? [{ to: '/order-requests', label: 'Order Requests', icon: PaperPlaneTiltIcon, count: requestUpdates, alert: true }, inventoryItem] : []),
        { to: '/customers', label: 'Customers', icon: UsersThreeIcon },
        ...(session?.role === 'catalogue' ? [] : [{ to: '/payments', label: 'Payments', icon: WalletIcon, count: overdue, alert: true, alertLabel: 'overdue' }]),
        ...(movesOrders(session?.role) ? [{ to: '/app-users', label: 'App Users', icon: DeviceMobileIcon }] : []),
        ...(seesFeedback ? [{ to: '/feedback', label: 'Feedback', icon: ChatsCircleIcon, count: newFeedback, alert: true, alertLabel: 'new' }] : []),
      ],
    },
    ...(bills ? [billingGroup] : []),
    ...(seesReturns ? [returnsGroup] : []),
    // The Owner and the Accountant; GST Settings, the shop's registration, stays the Owner's.
    ...(money
      ? [
          {
            title: 'Purchases',
            items: [
              { to: '/purchases', label: 'Purchases', icon: TruckIcon },
              { to: '/suppliers', label: 'Suppliers', icon: StorefrontIcon },
              { to: '/expenses', label: 'Expenses', icon: ReceiptIcon },
            ],
          },
          {
            title: 'Reports',
            items: [
              { to: '/reports', label: 'Profit & Loss', icon: ChartLineUpIcon, end: true },
              { to: '/reports/sales', label: 'Sales Report', icon: ChartBarIcon },
              { to: '/reports/purchases', label: 'Purchase Report', icon: ChartBarIcon },
              { to: '/reports/stock', label: 'Stock Report', icon: PackageIcon },
              { to: '/reports/cash-bank', label: 'Cash & Bank', icon: CoinsIcon },
              { to: '/reports/outstanding', label: 'Outstanding', icon: HourglassIcon },
            ],
          },
          {
            title: 'GST',
            items: [
              { to: '/gst', label: 'GST Dashboard', icon: ScalesIcon, end: true },
              { to: '/gst/sales', label: 'Sales Register', icon: FileTextIcon },
              { to: '/gst/purchases', label: 'Purchase Register', icon: ClipboardTextIcon },
              { to: '/gst/gstr1', label: 'GSTR-1', icon: FileTextIcon },
              { to: '/gst/hsn', label: 'HSN Summary', icon: HashIcon },
              { to: '/gst/payments', label: 'GST Payments', icon: BankIcon },
              ...(session?.role === 'owner' ? [{ to: '/gst/settings', label: 'GST Settings', icon: SlidersHorizontalIcon }] : []),
            ],
          },
        ]
      : []),
    // The Accountant keeps the books, not the catalogue or the app's content.
    ...(accountant
      ? []
      : [
    {
      title: 'Catalogue',
      items: [
        { to: '/products', label: 'Products', icon: PackageIcon },
        ...(seesStock(session?.role) ? [stockItem] : []),
        { to: '/prices', label: 'Prices', icon: CurrencyInrIcon },
        { to: '/categories', label: 'Categories', icon: TagIcon },
        { to: '/price-lists', label: 'Price Lists', icon: BookOpenIcon },
      ],
    },
    {
      title: 'Calculators',
      items: [
        { to: '/cutlist', label: 'Cutlist Systems', icon: ScissorsIcon },
        { to: '/formulas', label: 'Glass Formulas', icon: CalculatorIcon },
        { to: '/sections', label: 'Bar Sections', icon: RulerIcon },
      ],
    },
    {
      title: 'App Content',
      items: [
        { to: '/banners', label: 'Home Banners', icon: ImagesIcon },
        { to: '/videos', label: 'Installation Videos', icon: PlayCircleIcon },
        { to: '/more-apps', label: 'More Apps', icon: GridFourIcon },
        // Uploading is for Owners and Catalogue editors, so the library is too.
        ...(session?.role === 'sales' ? [] : [{ to: '/media', label: 'Media Library', icon: FolderSimpleIcon }]),
      ],
    },
        ]),
    {
      title: 'System',
      items: [
        { to: '/activity', label: 'Activity', icon: ClockCounterClockwiseIcon },
        ...(session?.role === 'owner'
          ? [
              { to: '/staff', label: 'Staff', icon: UserGearIcon },
              { to: '/notifications', label: 'Notifications', icon: BellIcon },
            ]
          : []),
        { to: '/settings', label: 'Settings', icon: GearSixIcon },
      ],
    },
  ];
  const destinations = groups.flatMap((group) => group.items.map((item) => ({ to: item.to, label: item.label, icon: item.icon, group: group.title })));

  // New page: close the phone menu, start at the top, and move focus to the content for screen readers.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (location.pathname !== lastPath) {
    setLastPath(location.pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>('a[aria-current="page"], a')?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // ⌘K on a Mac, Ctrl+K elsewhere, opens search from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // On a phone the sidebar is hidden, so the menu button carries a red dot while any count in it is above zero.
  const alerts = groups.flatMap((group) => group.items).reduce((sum, item) => sum + (item.alert ? (item.count ?? 0) : 0), 0);
  // The top-right bell lists each order not delivered yet (for the inventory team, the ones with them).
  const bellOrders = db.orders.filter((order) =>
    inventoryOnly ? ['confirmed', 'packed', 'dispatched'].includes(order.status) : inOrders(order) && ['placed', 'confirmed', 'packed', 'dispatched'].includes(order.status),
  );

  const under = (pages: string[]) => pages.some((page) => location.pathname === page || location.pathname.startsWith(`${page}/`));
  const allowed = inventoryOnly
    ? ['/inventory', '/stock', '/settings', '/returns/list', '/returns/'].some((path) => location.pathname.startsWith(path)) && !['/returns/settings', '/returns/reports', '/returns/refunds', '/returns/new'].some((path) => location.pathname.startsWith(path))
    : accountant
      ? // The Accountant's pages; anything else typed in or linked to goes to the dashboard.
        location.pathname === '/' ||
        (under(['/orders', '/customers', '/payments', '/purchases', '/suppliers', '/supplier-returns', '/expenses', '/reports', '/gst', '/returns', '/billing', '/activity', '/settings']) &&
          !under(['/gst/settings', '/returns/settings', '/returns/new', '/billing/new', '/billing/settings']) &&
          !/^\/billing\/(quotations\/)?[^/]+\/edit$/.test(location.pathname))
      : // The books are the Owner's and the Accountant's; bills, the Owner's and Sales'.
        (money || !under(['/gst', '/purchases', '/suppliers', '/supplier-returns', '/expenses', '/reports'])) && (bills || !under(['/billing']));

  const signOut = async () => {
    await endSession();
    navigate('/login', { replace: true });
  };

  return (
    <PageMetaContext.Provider value={setMeta}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app">
        <aside ref={sidebarRef} id="sidebar" className="sidebar" data-open={menuOpen} aria-label="Admin navigation">
          <Link to="/" className="sidebar__brand" aria-label="Vimalnath Admin, dashboard">
            <img className="brand-mark" src={db.settings.logo} alt="" width={34} height={34} />
            <span>
              <span className="brand-name">
                Vimalnath
              </span>
              <span className="brand-sub">{inventoryOnly ? 'Inventory' : 'Admin'}</span>
            </span>
          </Link>

          <nav aria-label="Main">
            {groups.map((group) => (
              <div key={group.title} className="nav-group">
                <p className="nav-group__title" id={`nav-${group.title}`}>
                  {group.title}
                </p>
                <ul className="nav-list" aria-labelledby={`nav-${group.title}`}>
                  {group.items.map(({ to, label, icon: ItemIcon, end, count, alert, alertLabel }) => (
                    <li key={to}>
                      <NavLink to={to} end={end} className="nav-link">
                        <ItemIcon size={18} aria-hidden />
                        {label}
                        {alert && count ? (
                          <>
                            <span className="visually-hidden"> ({alertLabel ? `${count} ${alertLabel}` : count === 1 ? '1 new update' : `${count} new updates`})</span>
                            <span className="nav-link__alert num" aria-hidden>
                              {count > 99 ? '99+' : count}
                            </span>
                          </>
                        ) : null}
                        {!alert && count ? (
                          <span className="nav-link__count num" aria-label={`${count} new`}>
                            {count}
                          </span>
                        ) : null}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="sidebar__footer">
            <div className="account">
              <span className="avatar" aria-hidden>
                {initials(session?.name ?? 'Admin')}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="account__name">
                  {session?.name ?? 'Admin'}
                </span>
                <span className="account__email">
                  {session?.email}
                </span>
              </span>
              <IconButton icon={SignOutIcon} label="Sign out" onClick={signOut} />
            </div>
          </div>
        </aside>

        {menuOpen && <button type="button" className="sidebar-scrim" aria-label="Close menu" tabIndex={-1} onClick={() => setMenuOpen(false)} />}

        <div className="content">
          <header className="topbar">
            <span className="topbar__menu-wrap">
              <IconButton
                icon={ListIcon}
                label={menuOpen ? 'Close menu' : alerts ? `Open menu, ${alerts} ${alerts === 1 ? 'notification' : 'notifications'}` : 'Open menu'}
                className="topbar__menu"
                aria-expanded={menuOpen}
                aria-controls="sidebar"
                onClick={() => setMenuOpen((open) => !open)}
              />
              {alerts > 0 && !menuOpen && <span className="alert-dot" aria-hidden />}
            </span>
            <nav aria-label="Breadcrumb" style={{ minWidth: 0, flex: 1 }}>
              <ol className="breadcrumbs">
                {meta.crumbs.map((crumb) => (
                  <li key={crumb.label}>
                    {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : crumb.label}
                    <CaretRightIcon size={12} aria-hidden />
                  </li>
                ))}
                <li aria-current="page">{meta.title}</li>
              </ol>
            </nav>
            <ThemeSwitch />
            <NotificationBell orders={bellOrders} linkTo={(order) => (inventoryOnly ? (order.status === 'confirmed' ? '/inventory' : `/inventory?stage=${order.status}`) : `/orders/${order.id}`)} requestUpdates={inventoryOnly ? 0 : requestUpdates} />
            <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
              <MagnifyingGlassIcon size={16} aria-hidden />
              <span className="search-trigger__text">Search</span>
              <kbd className="kbd search-trigger__kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            {navigation.state === 'loading' && <span className="spinner" style={{ color: 'var(--tint)' }} role="status" aria-label="Loading page" />}
          </header>

          <main id="main" ref={mainRef} className="main" tabIndex={-1}>
            {allowed ? <Outlet /> : <Navigate to={inventoryOnly ? '/inventory' : '/'} replace />}
          </main>
        </div>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} destinations={destinations} />
    </PageMetaContext.Provider>
  );
}
