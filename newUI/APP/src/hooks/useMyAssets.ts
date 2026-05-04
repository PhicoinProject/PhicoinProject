import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetService } from '@/services/assets';
import { walletService } from '@/services/wallet';
import { ASSET_STALE_TIME } from '@/utils/constants';

/** Hook to fetch assets owned by the wallet */
export function useMyAssets(addresses?: string[]) {
  const addrList = useMemo(() => {
    if (addresses && addresses.length > 0) return addresses;
    return walletService.getDerivedAddressPool().map((a) => a.address);
  }, [addresses]);

  return useQuery({
    queryKey: ['myAssets', addrList.join(',')],
    queryFn: () => assetService.listMyAssets(addrList),
    staleTime: ASSET_STALE_TIME,
    enabled: addrList.length > 0,
  });
}
