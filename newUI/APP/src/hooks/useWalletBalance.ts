import { useEffect, useMemo } from 'react';
import { rpc } from '@/services/rpc';
import { walletService } from '@/services/wallet';
import { useWalletStore } from '@/stores';
import { BALANCE_POLL_INTERVAL } from '@/utils/constants';

/** Hook to periodically fetch and update wallet balance for a pool of addresses */
export function useWalletBalance(addresses?: string[], intervalMs = BALANCE_POLL_INTERVAL) {
  const setBalance = useWalletStore((s) => s.setBalance);
  const setError = useWalletStore((s) => s.setError);

  const addrList = useMemo(() => {
    if (addresses && addresses.length > 0) return addresses;
    return walletService.getDerivedAddressPool().map((a) => a.address);
  }, [addresses]);

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

  useEffect(() => {
    fetchBalance();
    const id = setInterval(fetchBalance, intervalMs);
    return () => clearInterval(id);
  }, [addrList, intervalMs, setBalance, setError]);
}
