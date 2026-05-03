import { useQuery } from '@tanstack/react-query';
import { assetService } from '@/services/assets';
import { ASSET_STALE_TIME } from '@/utils/constants';

/** Hook to fetch assets owned by the wallet */
export function useMyAssets() {
  return useQuery({
    queryKey: ['myAssets'],
    queryFn: () => assetService.listMyAssets(),
    staleTime: ASSET_STALE_TIME,
  });
}
