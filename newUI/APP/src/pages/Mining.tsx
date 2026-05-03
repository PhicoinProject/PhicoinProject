import React from 'react';
import { rpc } from '@/services/rpc';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/common/Badge';

/** Mining info page -- hash rate, difficulty, reward distribution */
export const Mining: React.FC = () => {
  const {
    data: miningInfo,
    isLoading: miningLoading,
    isError: miningError,
  } = useQuery({
    queryKey: ['miningInfo'],
    queryFn: () => rpc.getMiningInfo(),
    refetchInterval: 30_000,
  });

  const { data: networkHash, isLoading: hashLoading } = useQuery({
    queryKey: ['networkHash'],
    queryFn: () => rpc.raw<number>('getnetworkhashps'),
    refetchInterval: 60_000,
  });

  const { data: mempoolInfo } = useQuery({
    queryKey: ['mempoolInfo'],
    queryFn: () => rpc.getMempoolInfo(),
    refetchInterval: 30_000,
  });

  const formatHashRate = (hashes: number): string => {
    if (!hashes) return 'N/A';
    const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
    let i = 0;
    let val = hashes;
    while (val >= 1000 && i < units.length - 1) {
      val /= 1000;
      i++;
    }
    return `${val.toFixed(2)} ${units[i]}`;
  };

  const info = miningInfo as Record<string, unknown> | undefined;
  const mempool = mempoolInfo as Record<string, unknown> | undefined;

  const blocks = Number(info?.blocks ?? 0);
  const difficulty = Number(info?.difficulty ?? 0);
  const networkDiff = Number(info?.networkhashps ?? 0);
  const connections = Number(info?.connections ?? 0);
  const errors = String(info?.errors ?? '');
  const genProcLimit = Number(info?.genproclimit ?? 0);

  if (miningLoading || hashLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Mining</h1>

      {miningError && (
        <div className="rounded-lg border border-red-200 dark:border-red-600 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
          Failed to load mining info. Is the RPC node reachable?
        </div>
      )}

      {/* Error banner if node has errors */}
      {errors && errors !== '' && (
        <div className="rounded-lg border border-yellow-200 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 p-4 text-sm text-yellow-700 dark:text-yellow-300">
          Node errors: {errors}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-dark-mutedText">Block Height</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-dark-text">
            {blocks.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-dark-mutedText">Network Hash Rate</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-dark-text">
            {formatHashRate(networkHash ?? networkDiff)}
          </p>
        </div>
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-dark-mutedText">Difficulty</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-dark-text">
            {difficulty.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-dark-mutedText">Connections</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-dark-text">{connections}</p>
        </div>
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-dark-mutedText">Mining Status</p>
          <p className="mt-2 flex items-center gap-2">
            {genProcLimit > 0 ? (
              <>
                <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
                <span className="text-2xl font-bold text-green-600">Enabled</span>
              </>
            ) : (
              <>
                <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
                <span className="text-2xl font-bold text-red-600">Disabled</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Mining details */}
      <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">Mining Details</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-500 dark:text-dark-mutedText">Blocks</span>
            <span className="font-medium">{blocks}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-500 dark:text-dark-mutedText">Chain</span>
            <span className="font-medium">{String(info?.chain ?? 'main')}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-500 dark:text-dark-mutedText">Difficulty</span>
            <span className="font-medium">{difficulty}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-500 dark:text-dark-mutedText">Network Hash Rate</span>
            <span className="font-medium">{formatHashRate(networkHash ?? networkDiff)}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-500 dark:text-dark-mutedText">Pooled Tx</span>
            <span className="font-medium">{Number(mempool?.size ?? 0)}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-500 dark:text-dark-mutedText">Mempool Bytes</span>
            <span className="font-medium">{Number(mempool?.bytes ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-500 dark:text-dark-mutedText">GenProcLimit</span>
            <span className="font-medium">{genProcLimit}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-500 dark:text-dark-mutedText">Errors</span>
            <span>
              {errors && errors !== '' ? (
                <Badge variant="error">{errors}</Badge>
              ) : (
                <Badge variant="success">None</Badge>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Raw mining info */}
      <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">Raw Mining Info</h2>
        <pre className="mt-4 overflow-x-auto rounded bg-gray-50 dark:bg-dark-elevated p-4 text-xs text-gray-700 dark:text-dark-secondary">
          {JSON.stringify(info, null, 2)}
        </pre>
      </div>
    </div>
  );
};

export default Mining;
