import { useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/services/rpc';
import { walletService } from '@/services/wallet';
import { pollMempool } from '@/services/chainScanner';
import { notificationManager } from '@/services/notifications';
import { useWalletStore } from '@/stores';
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
 * Callers pass an optional address list; if omitted, the wallet's derived
 * address pool is used.
 */
export function useRealtimeUpdates(addresses?: string[]) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const setBalance = useWalletStore((s) => s.setBalance);
  const setError = useWalletStore((s) => s.setError);
  const setWalletState = useWalletStore((s) => s.setWalletState);

  // Stable address list for the polling loops.
  const addrList = useMemo(() => {
    if (addresses && addresses.length > 0) return addresses;
    return walletService.getDerivedAddressPool().map((a) => a.address);
  }, [addresses]);

  // Refs to avoid re-creating intervals on every render when queryClient
  // or showToast change identity.
  const queryClientRef = useRef(queryClient);
  const showToastRef = useRef(showToast);
  queryClientRef.current = queryClient;
  showToastRef.current = showToast;

  // ---- Mempool polling ----
  useEffect(() => {
    if (!addrList.length) return;

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
    const fetchBalance = async () => {
      try {
        if (!addrList.length) {
          setBalance(0);
          return;
        }
        const result = await rpc.getAddressBalance(addrList);
        const data = result as Record<string, unknown>;
        const balanceSat = Number((data as any).balance ?? 0);
        setBalance(balanceSat / 1e8);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch balance';
        setError(message);
      }
    };

    fetchBalance();
    const id = setInterval(fetchBalance, BALANCE_POLL_INTERVAL);
    return () => clearInterval(id);
  }, [addrList, setBalance, setError]);

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
