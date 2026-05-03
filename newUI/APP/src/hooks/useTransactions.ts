import { useQuery } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import { TRANSACTION_POLL_INTERVAL, DATA_STALE_TIME, DEFAULT_PAGE_SIZE } from '@/utils/constants';

/** Hook to fetch recent wallet transactions */
export function useTransactions(count = DEFAULT_PAGE_SIZE) {
  return useQuery({
    queryKey: ['transactions', count],
    queryFn: () => walletService.getTransactions(count),
    refetchInterval: TRANSACTION_POLL_INTERVAL,
    staleTime: DATA_STALE_TIME,
  });
}
