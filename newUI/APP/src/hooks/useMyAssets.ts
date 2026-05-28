import { useQuery } from '@tanstack/react-query';
import { assetService } from '@/services/assets';
import { walletService } from '@/services/wallet';
import { ASSET_STALE_TIME, DERIVED_POOL_STALE_TIME } from '@/utils/constants';

/** Hook to fetch assets owned by the wallet */
export function useMyAssets(addresses?: string[]) {
  // Discover the wallet's used addresses on BOTH chains via the async pool, so assets held
  // on change addresses are included. If explicit addresses are passed, use those instead.
  const useExplicit = !!addresses && addresses.length > 0;
  const { data: pool } = useQuery({
    queryKey: ['derivedPoolAsync'],
    queryFn: () => walletService.getDerivedAddressPoolAsync(),
    staleTime: DERIVED_POOL_STALE_TIME,
    enabled: !useExplicit,
  });

  const addrList = useExplicit ? (addresses as string[]) : (pool ?? []).map((a) => a.address);

  return useQuery({
    queryKey: ['myAssets', addrList.join(',')],
    queryFn: () => assetService.listMyAssets(addrList),
    staleTime: ASSET_STALE_TIME,
    enabled: addrList.length > 0,
  });
}
