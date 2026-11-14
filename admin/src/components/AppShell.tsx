import {
  BookOpenIcon,
  CalculatorIcon,
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  DeviceMobileIcon,
  GearSixIcon,
  ImagesIcon,
  InfoIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PlayCircleIcon,
  ReceiptIcon,
  RulerIcon,
  ScissorsIcon,
  SignOutIcon,
  SquaresFourIcon,
  TagIcon,
  UserGearIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigation } from 'react-router';

import { IconButton } from '@/components/Button';
import { CommandPalette } from '@/components/CommandPalette';
import { PageMetaContext, type PageMeta } from '@/components/pageMeta';
import { endSession, readSession } from '@/data/session';
import { useData } from '@/data/useData';
import { initials } from '@/lib/format';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

type NavItem = { to: string; label: string; icon: Icon; end?: boolean; count?: number };

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
  const newOrders = db.orders.filter((order) => order.status === 'placed').length;

  const groups: { title: string; items: NavItem[] }[] = [
    { title: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: SquaresFourIcon, end: true }] },
    {
      title: 'Sales',
      items: [
        { to: '/orders', label: 'Orders', icon: ReceiptIcon, count: newOrders },
        { to: '/customers', label: 'Customers', icon: UsersThreeIcon },
        ...(session?.role === 'catalogue' ? [] : [{ to: '/app-users', label: 'App Users', icon: DeviceMobileIcon }]),
      ],
    },
    {
      title: 'Catalogue',
      items: [
        { to: '/products', label: 'Products', icon: PackageIcon },
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
      ],
    },
    {
      title: 'System',
      items: [
        { to: '/activity', label: 'Activity', icon: ClockCounterClockwiseIcon },
        ...(session?.role === 'owner' ? [{ to: '/staff', label: 'Staff', icon: UserGearIcon }] : []),
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
              <span className="brand-sub">Admin</span>
            </span>
          </Link>

          <nav aria-label="Main">
            {groups.map((group) => (
              <div key={group.title} className="nav-group">
                <p className="nav-group__title" id={`nav-${group.title}`}>
                  {group.title}
                </p>
                <ul className="nav-list" aria-labelledby={`nav-${group.title}`}>
                  {group.items.map(({ to, label, icon: ItemIcon, end, count }) => (
                    <li key={to}>
                      <NavLink to={to} end={end} className="nav-link">
                        <ItemIcon size={18} aria-hidden />
                        {label}
                        {count ? (
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
            <IconButton
              icon={ListIcon}
              label={menuOpen ? 'Close menu' : 'Open menu'}
              className="topbar__menu"
              aria-expanded={menuOpen}
              aria-controls="sidebar"
              onClick={() => setMenuOpen((open) => !open)}
            />
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
            <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
              <MagnifyingGlassIcon size={16} aria-hidden />
              <span className="search-trigger__text">Search</span>
              <kbd className="kbd search-trigger__kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            {navigation.state === 'loading' && <span className="spinner" style={{ color: 'var(--tint)' }} role="status" aria-label="Loading page" />}
            <Link to="/settings#preview-data" className="preview-pill" title="Orders and the catalogue are saved on the server. Other edits are saved in this browser only, until their modules reach the server.">
              <InfoIcon size={14} weight="bold" aria-hidden />
              <span className="preview-pill__text">Preview data</span>
              <span className="visually-hidden">: some edits are saved in this browser only</span>
            </Link>
          </header>

          <main id="main" ref={mainRef} className="main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} destinations={destinations} />
    </PageMetaContext.Provider>
  );
}
