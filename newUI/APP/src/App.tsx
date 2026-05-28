import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useRealtimeUpdates, useSyncStatus } from '@/hooks';
import { useWalletStore } from '@/stores';
import { Sidebar } from '@/components/common/Sidebar';
import { Navbar } from '@/components/common/Navbar';
import { ToastProvider } from '@/components/common/Toast';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Overview } from '@/pages/Overview';
import { Unlock } from '@/pages/Unlock';
import { CreateWallet } from '@/pages/CreateWallet';
import { BackupVerify } from '@/pages/BackupVerify';
import { hasWallet, isUnlocked, tryAutoUnlock, lockWallet } from '@/services/auth';
import { useWalletHDKeyStore } from '@/stores';
import { IDLE_AUTOLOCK_MS } from '@/utils/constants';

// Lazy-load heavy pages to reduce initial bundle
const RPCConsole = lazy(() => import('@/pages/RPCConsole'));
const Mining = lazy(() => import('@/pages/Mining'));
const Settings = lazy(() => import('@/pages/Settings'));
const ManageAssets = lazy(() => import('@/pages/ManageAssets'));
const SignVerify = lazy(() => import('@/pages/SignVerify'));
const BackupWallet = lazy(() => import('@/pages/BackupWallet'));
const ImportWallet = lazy(() => import('@/pages/ImportWallet'));
const AddressBook = lazy(() => import('@/pages/AddressBook'));

// Lazy-load post-auth feature pages: not needed for first paint (landing/auth
// path renders Overview/Unlock/CreateWallet/BackupVerify only). These modules
// export named components, so map the named export onto the `default` key that
// React.lazy() expects.
const Send = lazy(() => import('@/pages/Send').then((m) => ({ default: m.Send })));
const Receive = lazy(() => import('@/pages/Receive').then((m) => ({ default: m.Receive })));
const Wallet = lazy(() => import('@/pages/Wallet').then((m) => ({ default: m.Wallet })));
const Assets = lazy(() => import('@/pages/Assets').then((m) => ({ default: m.Assets })));
const Transactions = lazy(() =>
  import('@/pages/Transactions').then((m) => ({ default: m.Transactions }))
);
const RestrictedAssets = lazy(() =>
  import('@/pages/RestrictedAssets').then((m) => ({ default: m.RestrictedAssets }))
);
const CreateAsset = lazy(() =>
  import('@/pages/CreateAsset').then((m) => ({ default: m.CreateAsset }))
);

/** Suspense boundary with a lightweight loading fallback */
const LazyRoute: React.FC<{ component: React.LazyExoticComponent<React.FC> }> = (props) => {
  const Component = props.component;
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-phi-purple border-t-transparent" />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
};

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/send', label: 'Send' },
  { path: '/receive', label: 'Receive' },
  { path: '/wallet', label: 'Wallet' },
  { path: '/assets', label: 'Assets' },
  { path: '/create-asset', label: 'Create Asset' },
  { path: '/manage-assets', label: 'Manage Assets' },
  { path: '/restricted', label: 'Restricted' },
  { path: '/transactions', label: 'Transactions' },
  { path: '/addressbook', label: 'Address Book' },
  { path: '/mining', label: 'Mining' },
  { path: '/rpc', label: 'RPC Console' },
  { path: '/settings', label: 'Settings' },
  { path: '/backup', label: 'Backup' },
  { path: '/sign-verify', label: 'Sign & Verify' },
];

const PAGES = [
  { path: '/', element: <Overview /> },
  { path: '/send', element: <LazyRoute component={Send} /> },
  { path: '/receive', element: <LazyRoute component={Receive} /> },
  { path: '/wallet', element: <LazyRoute component={Wallet} /> },
  { path: '/assets', element: <LazyRoute component={Assets} /> },
  { path: '/create-asset', element: <LazyRoute component={CreateAsset} /> },
  {
    path: '/manage-assets',
    element: <LazyRoute component={ManageAssets} />,
  },
  { path: '/restricted', element: <LazyRoute component={RestrictedAssets} /> },
  { path: '/transactions', element: <LazyRoute component={Transactions} /> },
  {
    path: '/addressbook',
    element: <LazyRoute component={AddressBook} />,
  },
  {
    path: '/mining',
    element: <LazyRoute component={Mining} />,
  },
  {
    path: '/rpc',
    element: <LazyRoute component={RPCConsole} />,
  },
  {
    path: '/settings',
    element: <LazyRoute component={Settings} />,
  },
  {
    path: '/backup',
    element: <LazyRoute component={BackupWallet} />,
  },
  {
    path: '/import',
    element: <LazyRoute component={ImportWallet} />,
  },
  { path: '/backup-verify', element: <BackupVerify /> },
  {
    path: '/sign-verify',
    element: <LazyRoute component={SignVerify} />,
  },
];

/**
 * Security gate: re-renders on storage events so that wallet creation / unlock
 * transitions are reactive.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState({ walletExists: hasWallet(), unlocked: isUnlocked() });

  // Auto-unlock on page refresh: attempt secure session recovery
  useEffect(() => {
    const autoUnlock = async () => {
      if (!hasWallet()) return;
      const hdKeyStore = useWalletHDKeyStore.getState();
      if (hdKeyStore.hdKey) return;

      try {
        const recovered = await tryAutoUnlock();
        if (recovered) {
          setAuthState((prev) => ({ ...prev, unlocked: true }));
        }
      } catch (e) {
        console.error('[AutoUnlock] Failed:', e);
      }
    };
    autoUnlock();
  }, []);

  // Warm the lazy route chunks once the app is idle, so in-app navigation doesn't pay
  // a chunk download. On the dev server (and any HTTP/1.1 origin) that download competes
  // with the RPC burst for the browser's ~6 connections and can delay the next page's
  // first paint by many seconds. import() is deduped, so this only primes the cache that
  // React.lazy reads on navigation.
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      void import('@/pages/Assets');
      void import('@/pages/Transactions');
      void import('@/pages/Wallet');
      void import('@/pages/Send');
      void import('@/pages/Receive');
      void import('@/pages/ManageAssets');
      void import('@/pages/CreateAsset');
      void import('@/pages/RestrictedAssets');
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(warm, { timeout: 2500 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const t = setTimeout(warm, 1200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  // Apply dark mode class on mount and when localStorage changes
  useEffect(() => {
    const applyDark = () => {
      const dark = localStorage.getItem('darkMode') === 'true';
      if (dark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    applyDark();
    const interval = setInterval(applyDark, 500);
    return () => clearInterval(interval);
  }, []);

  // Listen for localStorage changes (same tab) and cross-tab storage events
  useEffect(() => {
    const tick = () => setAuthState({ walletExists: hasWallet(), unlocked: isUnlocked() });
    window.addEventListener('storage', tick);
    // Poll every 500ms for same-tab changes (localStorage doesn't fire storage event)
    const interval = setInterval(tick, 500);
    return () => {
      window.removeEventListener('storage', tick);
      clearInterval(interval);
    };
  }, []);

  // Always allow navigation to /import regardless of auth state
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  if (currentPath === '/import') {
    return <>{children}</>;
  }

  if (!authState.walletExists) {
    return <CreateWallet />;
  }

  if (!authState.unlocked) {
    return <Unlock />;
  }

  return <>{children}</>;
}

/** Main app wrapper - only renders after unlock, starts RPC polling here */
function MainApp() {
  // All hooks must come first — no conditionals, no async before hooks.
  const error = useWalletStore((s) => s.error);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (sessionStorage.getItem('phi:unlocked') === 'true') {
        const hdKeyStore = useWalletHDKeyStore.getState();
        if (!hdKeyStore.hdKey) {
          // Use tryAutoUnlock for session recovery (already called in AuthGate)
          // but check as fallback if HDKey was cleared after unlock
          try {
            const recovered = await tryAutoUnlock();
            if (!recovered) {
              console.warn('MainApp: session marked unlocked but HDKey recovery failed');
            }
          } catch (e) {
            console.error('MainApp: HDKey recovery failed:', e);
          }
        }
      }
    };
    init();
  }, []);

  useRealtimeUpdates();
  useSyncStatus();

  useEffect(() => {
    const dark = localStorage.getItem('darkMode') === 'true';
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, []);

  // SECURITY (P6): idle auto-lock. After IDLE_AUTOLOCK_MS with no user
  // interaction, drop the in-memory HD key + session flag (lockWallet). The
  // AuthGate polls isUnlocked() and will route to the Unlock screen, requiring
  // the password again. This bounds the window an unlocked key sits in memory
  // on an unattended tab. We only arm the timer while actually unlocked.
  useEffect(() => {
    if (!useWalletHDKeyStore.getState().hdKey) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => lockWallet(), IDLE_AUTOLOCK_MS);
    };

    const windowEvents: Array<keyof WindowEventMap> = [
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
    ];
    windowEvents.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    // visibilitychange lives on document, not window; treat returning to the
    // tab as activity so a focused tab does not lock mid-use.
    document.addEventListener('visibilitychange', reset);
    reset(); // arm initially

    return () => {
      clearTimeout(timer);
      windowEvents.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);

  const handleToggleSidebar = () => setSidebarOpen((prev) => !prev);
  const handleMobileOpen = () => setMobileSidebarOpen(true);
  const handleMobileClose = () => setMobileSidebarOpen(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar - full on desktop, overlay on mobile */}
      <Sidebar
        items={NAV_ITEMS}
        isOpen={sidebarOpen}
        isMobileOpen={mobileSidebarOpen}
        onToggle={handleToggleSidebar}
        onMobileClose={handleMobileClose}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile & desktop navbar with hamburger */}
        <Navbar onMenuClick={handleMobileOpen} />

        {error && (
          <div className="border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 px-4 py-2 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}
        <main className="flex-1 overflow-y-auto bg-gray-100 dark:bg-dark-bg p-4 md:p-6">
          <Routes>
            {PAGES.map((page) => (
              <Route key={page.path} path={page.path} element={page.element} />
            ))}
          </Routes>
        </main>
      </div>
    </div>
  );
}

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthGate>
          <MainApp />
        </AuthGate>
      </ToastProvider>
    </ErrorBoundary>
  );
};
