import { useQuery } from '@tanstack/react-query';
import { assetService } from '@/services/assets';
import { ASSET_STALE_TIME } from '@/utils/constants';

/** Hook to fetch all known PHICOIN assets */
export function useAssets() {
  return useQuery({
    queryKey: ['assets'],
    queryFn: () => assetService.listAssets(),
    staleTime: ASSET_STALE_TIME,
  });
}
