import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import { getTransactionHistory } from '@/services/txHistory';
import type { TxHistoryFilters } from '@/services/txHistory';
import { TRANSACTION_POLL_INTERVAL, DATA_STALE_TIME, DEFAULT_PAGE_SIZE } from '@/utils/constants';

/** Hook to fetch and filter wallet transactions using the txHistory service */
export function useTransactions(filters?: TxHistoryFilters) {
  const count = filters?.count ?? DEFAULT_PAGE_SIZE;

  const addrList = useMemo(() => {
    return walletService.getDerivedAddressPool().map((a) => a.address);
  }, []);

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
