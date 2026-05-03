import React from 'react';
import { useWalletStore } from '@/stores';
import { useNetworkStatus } from '@/hooks';
import { Badge } from './Badge';

interface NavbarProps {
  onMenuClick: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onMenuClick }) => {
  const phiBalance = useWalletStore((s) => s.phiBalance);
  const currentAddress = useWalletStore((s) => s.currentAddress);
  const network = useWalletStore((s) => s.network);
  const syncStatus = useWalletStore((s) => s.syncStatus);
  const { data: networkData } = useNetworkStatus();

  const shortAddress = currentAddress
    ? `${currentAddress.slice(0, 6)}...${currentAddress.slice(-4)}`
    : '';

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-300 dark:border-dark-border bg-white dark:bg-dark-surface px-4 md:h-16">
      {/* Left side: hamburger (mobile only) + logo (mobile only) */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-md p-2 text-gray-500 dark:text-dark-mutedText hover:bg-gray-100 dark:hover:bg-dark-elevated focus:outline-none focus:ring-2 focus:ring-phi-primary md:hidden"
          aria-label="Toggle menu"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <div className="flex items-center gap-2 md:hidden">
          <img src="/logo.png" alt="PHICOIN" className="h-7 w-7" />
          <span className="text-base font-bold text-gray-900 dark:text-dark-text">PHICOIN</span>
        </div>
      </div>

      {/* Right side: status info */}
      <div className="flex items-center gap-2 md:gap-4">
        <span className="flex items-center gap-1">
          <Badge variant={syncStatus.synced ? 'success' : 'warning'}>
            {syncStatus.synced ? 'Synced' : 'Syncing'}
          </Badge>
          <span className="text-xs text-gray-500 dark:text-dark-mutedText">
            ({Math.max(0, syncStatus.headers - syncStatus.blocks)} behind)
          </span>
        </span>

        {networkData?.blockCount !== undefined && (
          <span className="hidden sm:inline text-xs text-gray-500 dark:text-dark-mutedText">
            Block {networkData.blockCount}
          </span>
        )}

        <Badge variant={network === 'mainnet' ? 'success' : 'info'}>{network}</Badge>

        <span className="text-sm font-medium text-phi-primary">{phiBalance.toFixed(4)} PHI</span>

        {shortAddress && (
          <div className="hidden md:flex items-center gap-2 rounded-md bg-gray-50 dark:bg-dark-elevated px-3 py-1.5">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="font-mono text-xs text-gray-700 dark:text-dark-secondary">
              {shortAddress}
            </span>
          </div>
        )}
      </div>
    </header>
  );
};
