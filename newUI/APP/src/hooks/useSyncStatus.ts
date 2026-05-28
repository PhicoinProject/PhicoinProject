import { useEffect } from 'react';
import { rpc } from '@/services/rpc';
import { useWalletStore } from '@/stores';
import { NETWORK_STATUS_POLL_INTERVAL } from '@/utils/constants';

// getblockchaininfo is ~6s on a large chain (it also computes verificationprogress,
// size_on_disk, softforks) and holds cs_main for that whole time, which starves the
// asset/balance RPCs on first paint. We only need `blocks` + `headers` here, so:
//  - `blocks` comes from getblockcount (~3ms), polled at the normal cadence;
//  - `headers` comes from getblockchaininfo, but DEFERRED off first paint and polled
//    rarely (sync status changes slowly). On a tip-synced node blocks≈headers anyway.
const HEADERS_REFRESH_INTERVAL = 60_000;
const HEADERS_FIRST_DELAY = 4_000;

/** Hook to periodically fetch and update sync status */
export function useSyncStatus() {
  const setSyncStatus = useWalletStore((s) => s.setSyncStatus);

  useEffect(() => {
    // Last best-header height seen from the (slow) getblockchaininfo call. Until we have
    // one, treat the chain as at-tip (headers >= blocks) so the cheap path can compute a
    // sensible "synced" without paying for getblockchaininfo on the hot path.
    let lastHeaders = 0;

    // Cheap, frequent: block height via getblockcount (~3ms, no size_on_disk/progress).
    const fetchBlocks = async () => {
      try {
        const blocks = Number(await rpc.getBlockCount());
        const headers = Math.max(lastHeaders, blocks);
        setSyncStatus({ blocks, headers, synced: headers - blocks < 12 });
      } catch {
        // RPC unavailable, keep existing state
      }
    };

    // Expensive, rare: best-header height via getblockchaininfo. Only `headers` is used;
    // kept off the first paint (deferred) and polled slowly so its ~6s cs_main hold never
    // blocks the asset/balance/tx RPCs on page open.
    const fetchHeaders = async () => {
      if (document.hidden) return;
      try {
        const info = (await rpc.getBlockchainInfo()) as Record<string, unknown>;
        lastHeaders = Number(info.headers ?? 0);
        const blocks = Number(info.blocks ?? 0);
        setSyncStatus({ blocks, headers: lastHeaders, synced: lastHeaders - blocks < 12 });
      } catch {
        // keep existing state
      }
    };

    const tickBlocks = () => { if (!document.hidden) fetchBlocks(); };
    const onVisibilityChange = () => { if (!document.hidden) fetchBlocks(); };

    if (!document.hidden) fetchBlocks();
    const blocksId = setInterval(tickBlocks, NETWORK_STATUS_POLL_INTERVAL);
    const headersDeferId = setTimeout(fetchHeaders, HEADERS_FIRST_DELAY);
    const headersId = setInterval(fetchHeaders, HEADERS_REFRESH_INTERVAL);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(blocksId);
      clearInterval(headersId);
      clearTimeout(headersDeferId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [setSyncStatus]);
}
