import { useState, useEffect } from 'react';
import { hasWallet, isUnlocked } from '@/services/auth';

/** Reactive hook for auth state - polls localStorage every 500ms */
export function useAuthState() {
  const [state, setState] = useState({ walletExists: hasWallet(), unlocked: isUnlocked() });

  useEffect(() => {
    const tick = () => setState({ walletExists: hasWallet(), unlocked: isUnlocked() });
    window.addEventListener('storage', tick);
    const interval = setInterval(tick, 500);
    return () => {
      window.removeEventListener('storage', tick);
      clearInterval(interval);
    };
  }, []);

  return state;
}
