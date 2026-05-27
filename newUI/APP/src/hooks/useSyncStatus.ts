import { useEffect } from 'react';
import { rpc } from '@/services/rpc';
import { useWalletStore } from '@/stores';
import { NETWORK_STATUS_POLL_INTERVAL } from '@/utils/constants';

/** Hook to periodically fetch and update sync status */
export function useSyncStatus() {
  const setSyncStatus = useWalletStore((s) => s.setSyncStatus);

  useEffect(() => {
    const fetch = async () => {
      try {
        const blockchainInfo = await rpc.getBlockchainInfo();
        const info = blockchainInfo as Record<string, unknown>;
        const blocks = Number(info.blocks ?? 0);
        const headers = Number(info.headers ?? 0);
        const behind = Math.max(0, headers - blocks);
        setSyncStatus({
          blocks,
          headers,
          synced: behind < 12,
        });
      } catch {
        // RPC unavailable, keep existing state
      }
    };

    // Visibility-aware tick: skip the RPC call while the tab is hidden to
    // avoid pointless background traffic.
    const tick = () => {
      if (document.hidden) return;
      fetch();
    };

    // When the tab becomes visible again, refetch immediately so the user
    // sees fresh data without waiting for the next interval.
    const onVisibilityChange = () => {
      if (!document.hidden) fetch();
    };

    if (!document.hidden) fetch();
    const id = setInterval(tick, NETWORK_STATUS_POLL_INTERVAL);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [setSyncStatus]);
}
