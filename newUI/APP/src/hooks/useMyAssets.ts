import { useQuery } from '@tanstack/react-query';
import { assetService } from '@/services/assets';
import { walletService } from '@/services/wallet';
import { ASSET_STALE_TIME, DERIVED_POOL_STALE_TIME } from '@/utils/constants';

/** Hook to fetch assets owned by the wallet */
export function useMyAssets(addresses?: string[]) {
  // Discover the wallet's used addresses on BOTH chains via the async pool, so assets held
  // on change addresses are included. If explicit addresses are passed, use those instead.
  const useExplicit = !!addresses && addresses.length > 0;
  const { data: pool, isLoading: poolLoading } = useQuery({
    queryKey: ['derivedPoolAsync'],
    queryFn: () => walletService.getDerivedAddressPoolAsync(),
    staleTime: DERIVED_POOL_STALE_TIME,
    enabled: !useExplicit,
  });

  const addrList = useExplicit ? (addresses as string[]) : (pool ?? []).map((a) => a.address);

  const query = useQuery({
    queryKey: ['myAssets', addrList.join(',')],
    queryFn: () => assetService.listMyAssets(addrList),
    staleTime: ASSET_STALE_TIME,
    enabled: addrList.length > 0,
  });

  // Pool discovery counts as loading too, so consumers don't render an empty state
  // ("No assets found.") while the address pool is still being resolved.
  return { ...query, isLoading: (!useExplicit && poolLoading) || query.isLoading } as typeof query;
}
