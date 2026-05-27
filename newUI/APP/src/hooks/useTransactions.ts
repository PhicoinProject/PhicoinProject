import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import { getTransactionHistory } from '@/services/txHistory';
import type { TxHistoryFilters } from '@/services/txHistory';
import { TRANSACTION_POLL_INTERVAL, DATA_STALE_TIME, DEFAULT_PAGE_SIZE, ASSET_STALE_TIME } from '@/utils/constants';

/** Hook to fetch and filter wallet transactions using the txHistory service */
export function useTransactions(filters?: TxHistoryFilters) {
  const count = filters?.count ?? DEFAULT_PAGE_SIZE;

  // Use the ASYNC pool (gap-limit RPC discovery), shared with useMyAssets via the
  // ['derivedPoolAsync'] cache key. The old sync pool only covered indices 0-9, so
  // transactions on addresses beyond that window never appeared in history (R2).
  const { data: poolAddrs = [] } = useQuery({
    queryKey: ['derivedPoolAsync'],
    queryFn: () => walletService.getDerivedAddressPoolAsync(),
    staleTime: ASSET_STALE_TIME, // match useMyAssets so the shared query key has one TTL
  });
  const addrList = useMemo(() => poolAddrs.map((a) => a.address), [poolAddrs]);

  return useQuery({
    queryKey: ['transactions', addrList.join(','), JSON.stringify(filters)],
    queryFn: async () => {
      if (!addrList.length) return [];
      return getTransactionHistory(addrList, { ...filters, count });
    },
    refetchInterval: TRANSACTION_POLL_INTERVAL,
    staleTime: DATA_STALE_TIME,
    enabled: addrList.length > 0,
  });
}

/**
 * Legacy hook signature: useTransactions(addresses, count) or useTransactions(count).
 * Preserved for backward compatibility with existing callers.
 */
export function useLegacyTransactions(addressesOrCount?: string[] | number, countOrUndef?: number) {
  let addresses: string[] | undefined;
  let count: number;

  if (Array.isArray(addressesOrCount)) {
    addresses = addressesOrCount;
    count = countOrUndef ?? DEFAULT_PAGE_SIZE;
  } else if (typeof addressesOrCount === 'number') {
    addresses = undefined;
    count = addressesOrCount;
  } else {
    addresses = undefined;
    count = DEFAULT_PAGE_SIZE;
  }

  const addrList = useMemo(() => {
    if (addresses && addresses.length > 0) return addresses;
    return walletService.getDerivedAddressPool().map((a) => a.address);
  }, [addresses]);

  return useQuery({
    queryKey: ['transactions', addrList.join(','), count],
    queryFn: async () => {
      if (!addrList.length) return [];
      return getTransactionHistory(addrList, { count });
    },
    refetchInterval: TRANSACTION_POLL_INTERVAL,
    staleTime: DATA_STALE_TIME,
    enabled: addrList.length > 0,
  });
}
