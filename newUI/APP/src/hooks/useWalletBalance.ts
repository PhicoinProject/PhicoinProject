import { useEffect } from 'react';
import { useWalletStore } from '@/stores';
import { walletService } from '@/services/wallet';
import { BALANCE_POLL_INTERVAL } from '@/utils/constants';

/** Hook to periodically fetch and update wallet balance */
export function useWalletBalance(intervalMs = BALANCE_POLL_INTERVAL) {
  const setBalance = useWalletStore((s) => s.setBalance);
  const setError = useWalletStore((s) => s.setError);

  const fetchBalance = async () => {
    try {
      const balance = await walletService.getBalance();
      setBalance(balance);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch balance';
      setError(message);
    }
  };

  useEffect(() => {
    fetchBalance();
    const id = setInterval(fetchBalance, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, setBalance, setError]);
}
