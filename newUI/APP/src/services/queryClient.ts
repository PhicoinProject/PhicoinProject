import { QueryClient } from '@tanstack/react-query';

/**
 * The app's single React Query client.
 *
 * Exported from a module (rather than created inline in main.tsx) so non-React code — notably
 * auth.lockWallet() — can clear cached wallet data (balances, transactions, assets) on lock.
 * Without that, the previous wallet's cached data could be served on the next unlock or, worse,
 * briefly shown after a different wallet is imported.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 10_000,
    },
  },
});
