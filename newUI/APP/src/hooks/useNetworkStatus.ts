import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/services/rpc';
import { NETWORK_STATUS_POLL_INTERVAL, DATA_STALE_TIME } from '@/utils/constants';

/** Hook to fetch current network / sync status */
export function useNetworkStatus() {
  return useQuery({
    queryKey: ['networkStatus'],
    queryFn: async () => {
      const [blockCount, networkInfo] = await Promise.all([
        rpc.getBlockCount(),
        rpc.getNetworkInfo(),
      ]);
      return { blockCount, networkInfo };
    },
    refetchInterval: NETWORK_STATUS_POLL_INTERVAL,
    staleTime: DATA_STALE_TIME,
  });
}
