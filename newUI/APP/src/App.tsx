import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useRealtimeUpdates, useSyncStatus } from '@/hooks';
import { useWalletStore } from '@/stores';
import { Sidebar } from '@/components/common/Sidebar';
import { Navbar } from '@/components/common/Navbar';
import { ToastProvider } from '@/components/common/Toast';
import { Overview } from '@/pages/Overview';
import { Send } from '@/pages/Send';
import { Receive } from '@/pages/Receive';
import { Wallet } from '@/pages/Wallet';
import { Assets } from '@/pages/Assets';
import { Transactions } from '@/pages/Transactions';
import { Settings } from '@/pages/Settings';
import { AddressBook } from '@/pages/AddressBook';
import { RestrictedAssets } from '@/pages/RestrictedAssets';
import { CreateAsset } from '@/pages/CreateAsset';
import { ManageAssets } from '@/pages/ManageAssets';
import { RPCConsole } from '@/pages/RPCConsole';
import { Mining } from '@/pages/Mining';
import { Unlock } from '@/pages/Unlock';
import { CreateWallet } from '@/pages/CreateWallet';
import { BackupWallet } from '@/pages/BackupWallet';
import { ImportWallet } from '@/pages/ImportWallet';
import { BackupVerify } from '@/pages/BackupVerify';
import { SignVerify } from '@/pages/SignVerify';
import { hasWallet, isUnlocked } from '@/services/auth';

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
  { path: '/send', element: <Send /> },
  { path: '/receive', element: <Receive /> },
  { path: '/wallet', element: <Wallet /> },
  { path: '/assets', element: <Assets /> },
  { path: '/create-asset', element: <CreateAsset /> },
  { path: '/manage-assets', element: <ManageAssets /> },
  { path: '/restricted', element: <RestrictedAssets /> },
  { path: '/transactions', element: <Transactions /> },
  { path: '/addressbook', element: <AddressBook /> },
  { path: '/mining', element: <Mining /> },
  { path: '/rpc', element: <RPCConsole /> },
  { path: '/settings', element: <Settings /> },
  { path: '/backup', element: <BackupWallet /> },
  { path: '/import', element: <ImportWallet /> },
  { path: '/backup-verify', element: <BackupVerify /> },
  { path: '/sign-verify', element: <SignVerify /> },
];

/**
 * Security gate: re-renders on storage events so that wallet creation / unlock
 * transitions are reactive.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState({ walletExists: hasWallet(), unlocked: isUnlocked() });

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
  useRealtimeUpdates();
  useSyncStatus();

  useEffect(() => {
    const dark = localStorage.getItem('darkMode') === 'true';
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, []);
  const error = useWalletStore((s) => s.error);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
    <ToastProvider>
      <AuthGate>
        <MainApp />
      </AuthGate>
    </ToastProvider>
  );
};
