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
        const walletInfo = await rpc.getWalletInfo();
        const info = walletInfo as Record<string, unknown>;
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

    fetch();
    const id = setInterval(fetch, NETWORK_STATUS_POLL_INTERVAL);
    return () => clearInterval(id);
  }, [setSyncStatus]);
}
