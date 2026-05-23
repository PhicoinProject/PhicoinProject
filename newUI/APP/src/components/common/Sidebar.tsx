import { Link, useLocation } from 'react-router-dom';
import { APP_VERSION } from '@/utils/constants';

const ICON_PATHS: Record<string, string> = {
  Dashboard:
    'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  Send: 'M3 10l1.51-3.02a.75.75 0 011.42.19l.9 4.5a.75.75 0 001.08.43l5.5-3a.75.75 0 011.1.67v5.5a.75.75 0 01-1.1.67l-5.5-3a.75.75 0 00-1.08.43l-.9 4.5a.75.75 0 01-1.42.19L3 14V10z',
  Receive:
    'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3',
  Wallet:
    'M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3',
  Assets:
    'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z',
  Restricted:
    'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
  'Address Book':
    'M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z',
  Transactions: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  Mining:
    'M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6c0-.98.626-1.813 1.5-2.122',
  'RPC Console':
    'M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 6v12a2.25 2.25 0 002.25 2.25zm10.5-5.25h.008v.008h-.008v-.008zm-3 0h.008v.008h-.008v-.008z',
  Settings:
    'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z',
  Backup:
    'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5',
  'Sign & Verify':
    'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10',
  'Create Asset': 'M12 6v6m0 0v6m0-6h6m-6 0H6',
  'Manage Assets':
    'M11.412 15.001L9.37 18.185c-.426.694-1.508.694-1.934 0l-2.042-3.184a2.23 2.23 0 01.457-2.635l2.042-2.334c.426-.486.426-1.26 0-1.746l-2.042-2.334a2.23 2.23 0 01-.457-2.635l2.042-3.184c.426-.694 1.508-.694 1.934 0l2.042 3.184c.426.694 1.508.694 1.934 0l2.042-3.184c.426-.694 1.508-.694 1.934 0l2.042 3.184c.426.694.426 1.468 0 2.162l-2.042 2.334c-.426.486-.426 1.26 0 1.746l2.042 2.334c.426.694.426 1.468 0 2.162l-2.042 3.184c-.426.694-1.508.694-1.934 0l-2.042-3.185a2.23 2.23 0 01-.457-2.635l2.042-2.334c.426-.486.426-1.26 0-1.746L11.412 6z M12.75 12h.008v.008H12.75V12zm0 3h.008v.008H12.75V15z',
};

export interface SidebarItem {
  path: string;
  label: string;
}

export interface SidebarProps {
  items: SidebarItem[];
  currentPath?: string;
  isOpen: boolean;
  isMobileOpen: boolean;
  onToggle: () => void;
  onMobileClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  items,
  isOpen,
  isMobileOpen,
  onToggle,
  onMobileClose,
}) => {
  const location = useLocation();

  const renderLogo = () => (
    <div className="flex items-center gap-2">
      <img src="/logo.png" alt="PHICOIN" className="h-8 w-8" />
      <span className="text-lg font-bold text-gray-900 dark:text-dark-text">PHICOIN</span>
    </div>
  );

  const renderNav = () => (
    <nav className="flex-1 space-y-1 px-2 py-4 overflow-y-auto">
      {items.map((item) => {
        const isActive = location.pathname === item.path;

        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={onMobileClose}
            className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-phi-primary/10 text-phi-primary'
                : 'text-gray-600 dark:text-dark-mutedText hover:bg-gray-50 dark:hover:bg-dark-elevated hover:text-gray-900 dark:hover:text-dark-text'
            }`}
          >
            <svg
              className={`h-5 w-5 ${isActive ? 'text-phi-primary' : 'text-gray-400 dark:text-dark-mutedText group-hover:text-gray-500 dark:group-hover:text-dark-secondary'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={ICON_PATHS[item.label] || 'M5 12h14'}
              />
            </svg>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const renderFooter = () => (
    <div className="border-t border-gray-200 dark:border-dark-border p-4">
      <p className="text-xs text-gray-500 dark:text-dark-mutedText">PHICOIN Wallet {APP_VERSION}</p>
    </div>
  );

  // Mobile overlay sidebar
  if (isMobileOpen) {
    return (
      <>
        {/* Backdrop */}
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onMobileClose} />
        {/* Sidebar */}
        <aside className="fixed inset-y-0 left-0 z-50 flex w-56 flex-col bg-white dark:bg-dark-surface shadow-xl md:hidden">
          <div className="flex h-16 items-center justify-between px-4">
            {renderLogo()}
            <button
              onClick={onMobileClose}
              className="rounded-md p-1 text-gray-400 hover:text-gray-600"
              aria-label="Close sidebar"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          {renderNav()}
          {renderFooter()}
        </aside>
      </>
    );
  }

  // Collapsed sidebar (icons only) on desktop
  if (!isOpen) {
    return (
      <div className="hidden md:flex h-screen w-12 flex-col items-center border-r border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface py-4">
        <button
          onClick={onToggle}
          className="mb-4 rounded-md p-2 text-gray-500 dark:text-dark-mutedText hover:bg-gray-100 dark:hover:bg-dark-elevated"
          aria-label="Expand sidebar"
        >
          <img src="/logo.png" alt="PHICOIN" className="h-6 w-6" />
        </button>
        <div className="flex flex-1 flex-col items-center space-y-2 py-4 overflow-y-auto">
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`rounded-md p-2 transition-colors ${
                  isActive
                    ? 'bg-phi-primary/10 text-phi-primary'
                    : 'text-gray-400 dark:text-dark-mutedText hover:bg-gray-100 dark:hover:bg-dark-elevated hover:text-gray-600 dark:hover:text-dark-secondary'
                }`}
                title={item.label}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={ICON_PATHS[item.label] || 'M5 12h14'}
                  />
                </svg>
              </Link>
            );
          })}
        </div>
        <button
          onClick={onToggle}
          className="mt-auto rounded-md p-2 text-gray-400 dark:text-dark-mutedText hover:bg-gray-100 dark:hover:bg-dark-elevated"
          aria-label="Expand sidebar"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    );
  }

  // Full sidebar on desktop
  return (
    <aside className="hidden md:flex h-screen w-56 flex-col border-r border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface">
      <div className="flex h-16 items-center justify-between px-4">
        {renderLogo()}
        <button
          onClick={onToggle}
          className="rounded-md p-1 text-gray-400 dark:text-dark-mutedText hover:text-gray-600 dark:hover:text-dark-secondary"
          aria-label="Collapse sidebar"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </div>
      {renderNav()}
      {renderFooter()}
    </aside>
  );
};
