import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/services/rpc';
import { walletService } from '@/services/wallet';
import { pollMempool } from '@/services/chainScanner';
import { notificationManager } from '@/services/notifications';
import { useWalletStore, useWalletHDKeyStore } from '@/stores';
import { useToast } from '@/components/common/Toast';
import {
  MEMPOOL_POLL_INTERVAL,
  BLOCK_HEIGHT_POLL_INTERVAL,
  BALANCE_POLL_INTERVAL,
} from '@/utils/constants';

/**
 * Hook that coordinates all real-time polling for the wallet.
 *
 * Manages three independent polling loops:
 *  1. Mempool polling (every 15s) -- detects new unconfirmed txs.
 *  2. Block height polling (every 15s) -- detects new blocks and triggers
 *     React Query cache invalidation for transactions.
 *  3. Balance polling (every 15s) -- keeps the wallet balance current.
 *
 * On new blocks, it invalidates the ['transactions'] and ['networkStatus']
 * query keys so dependent components refetch fresh data.
 *
 * On new mempool transactions, it fires a toast notification and invalidates
 * the ['transactions'] query key.
 *
 * The hook derives addresses from the HDKey asynchronously. Polling loops
 * only start once addresses are available (ready === true), preventing
 * race conditions when the wallet auto-unlocks on page refresh.
 *
 * Address derivation runs once on mount. The address pool is never re-derived
 * unless the HDKey changes (wallet unlock/relock).
 *
 * @param addresses - Optional explicit address list. If omitted, derives
 *   from the wallet's HDKey using walletService.
 */
export function useRealtimeUpdates(addresses?: string[]) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const setBalance = useWalletStore((s) => s.setBalance);
  const setError = useWalletStore((s) => s.setError);
  const setWalletState = useWalletStore((s) => s.setWalletState);

  // Stable address list from explicit param, or null to derive from HDKey.
  const explicitAddresses = addresses && addresses.length > 0 ? addresses : null;

  // Derive addresses once HDKey is available (or use explicit addresses).
  const [addrList, setAddrList] = useState<string[]>(() => {
    if (explicitAddresses) return explicitAddresses;
    return walletService.getDerivedAddressPool().map((a) => a.address);
  });

  // Track whether we have a valid address list so polling loops can guard
  // against starting before addresses are ready (race condition with auto-unlock).
  const [ready, setReady] = useState(!!(explicitAddresses || addrList.length > 0));

  // Derive addresses once on mount when HDKey is available.
  // Only re-derive if HDKey changes (wallet unlock/relock).
  useEffect(() => {
    if (explicitAddresses) {
      setAddrList(explicitAddresses);
      setReady(true);
      return;
    }

    // Immediate check: if HDKey is already set, derive now
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (hdKey) {
      const newAddrs = walletService.getDerivedAddressPool().map((a) => a.address);
      if (newAddrs.length > 0) {
        setAddrList(newAddrs);
        setReady(true);
      }
    }

    // Subscribe to HDKey changes: when wallet unlocks, re-derive addresses.
    const unsubscribe = useWalletHDKeyStore.subscribe((state) => {
      if (state.hdKey) {
        const newAddrs = walletService.getDerivedAddressPool().map((a) => a.address);
        if (newAddrs.length > 0) {
          setAddrList(newAddrs);
          setReady(true);
        }
      }
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- explicitAddresses is derived from stable `addresses` param; adding it causes re-subscriptions
  }, []);

  // Expand the address pool asynchronously once ready: discovers used-address
  // count via RPC so balances on addresses beyond the default window (and on
  // change addresses) are included. Falls back silently to the sync pool.
  useEffect(() => {
    if (explicitAddresses || !ready) return;
    let cancelled = false;
    (async () => {
      try {
        const fullAddrs = (await walletService.getDerivedAddressPoolAsync()).map((a) => a.address);
        if (!cancelled && fullAddrs.length > addrListRef.current.length) {
          setAddrList(fullAddrs);
        }
      } catch {
        // Keep the sync pool; next unlock/refresh will retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- addrListRef avoids re-running on every addrList change
  }, [ready, explicitAddresses]);

  // Refs to avoid re-creating intervals on every render when queryClient
  // or showToast change identity.
  const queryClientRef = useRef(queryClient);
  const showToastRef = useRef(showToast);
  queryClientRef.current = queryClient;
  showToastRef.current = showToast;

  // Latest address list, read inside the async pool-expansion effect without
  // making addrList a dependency (which would re-trigger the effect).
  const addrListRef = useRef(addrList);
  addrListRef.current = addrList;

  // ---- Mempool polling ----
  useEffect(() => {
    if (!ready) return;

    const fetchMempool = async () => {
      try {
        const result = await pollMempool(addrList);
        notificationManager.processMempool(result.txIds);
      } catch {
        // Silently ignore -- next poll will retry
      }
    };

    fetchMempool();
    const id = setInterval(fetchMempool, MEMPOOL_POLL_INTERVAL);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- addrList is the source of truth; explicitAddresses is derived from stable `addresses` param
  }, [addrList]);

  // ---- Block height polling ----
  useEffect(() => {
    let lastHeight = -1;

    const fetchBlockHeight = async () => {
      try {
        const height = await rpc.getBlockCount();

        if (height > lastHeight && lastHeight >= 0) {
          // New block detected -- invalidate dependent queries
          const qc = queryClientRef.current;
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['networkStatus'] });
        }

        lastHeight = height;
        setWalletState({ lastBlockHeight: height });
      } catch {
        // Silently ignore -- next poll will retry
      }
    };

    fetchBlockHeight();
    const id = setInterval(fetchBlockHeight, BLOCK_HEIGHT_POLL_INTERVAL);
    return () => clearInterval(id);
  }, [setWalletState]);

  // ---- Balance polling ----
  useEffect(() => {
    if (!ready) return; // Don't start polling until addresses are ready

    const fetchBalance = async () => {
      try {
        const totalSat = await rpc.getAddressBalanceBatch(addrList);
        let totalBalance = 0;
        for (const addr of addrList) {
          const entry = totalSat[addr];
          if (
            entry &&
            typeof entry === 'object' &&
            !('balance' in (entry as Record<string, unknown>) === false)
          ) {
            totalBalance += Number((entry as Record<string, unknown>).balance ?? ((entry as Record<string, unknown>).result as Record<string, unknown>)?.balance ?? 0);
          }
        }
        setBalance(totalBalance / 1e8);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch balance';
        setError(message);
      }
    };

    fetchBalance();
    const id = setInterval(fetchBalance, BALANCE_POLL_INTERVAL);
    return () => clearInterval(id);
  }, [addrList, ready, setBalance, setError]);

  // ---- New transaction notification listener ----
  useEffect(() => {
    const unsubscribe = notificationManager.onNewTransaction((txIds) => {
      if (txIds.length > 0) {
        const count = txIds.length;
        const summary =
          count === 1
            ? `New transaction detected: ${txIds[0].slice(0, 10)}...`
            : `${count} new transactions detected`;

        showToastRef.current(summary, 'info');
        queryClientRef.current.invalidateQueries({ queryKey: ['transactions'] });
      }
    });
    return unsubscribe;
  }, []);

  // ---- New block notification listener ----
  useEffect(() => {
    const unsubscribe = notificationManager.onNewBlock((height) => {
      showToastRef.current(`New block: #${height}`, 'info');
    });
    return unsubscribe;
  }, []);

  return {
    /** Current wallet addresses being monitored. */
    addresses: addrList,
  };
}
