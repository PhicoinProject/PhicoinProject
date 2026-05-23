import type { Asset } from '@/types';
import { ASSET_STATUS_ISSUED, ASSET_STATUS_REVOKED } from '@/utils/constants';

interface AssetTableProps {
  assets: Asset[];
  balances?: Record<string, number>;
  onClick?: (asset: Asset) => void;
}

function statusBadge(status: string): string {
  if (status === ASSET_STATUS_ISSUED)
    return 'bg-green-100 dark:bg-green-500 text-green-700 dark:text-white';
  if (status === ASSET_STATUS_REVOKED)
    return 'bg-red-100 dark:bg-red-500 text-red-700 dark:text-white';
  return 'bg-gray-100 dark:bg-dark-elevated text-gray-600 dark:text-dark-mutedText';
}

/** Table displaying a list of assets with balances */
export const AssetTable: React.FC<AssetTableProps> = ({ assets, balances = {}, onClick }) => {
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 dark:bg-dark-elevated text-gray-600 dark:text-dark-mutedText">
        <tr>
          <th className="px-4 py-3 font-medium">Asset</th>
          <th className="px-4 py-3 font-medium">ID</th>
          <th className="px-4 py-3 font-medium">Status</th>
          <th className="px-4 py-3 font-medium">Precision</th>
          <th className="px-4 py-3 font-medium">Balance</th>
        </tr>
      </thead>
      <tbody>
        {assets.length === 0 ? (
          <tr>
            <td
              colSpan={5}
              className="px-4 py-8 text-center text-gray-500 dark:text-dark-mutedText"
            >
              No assets found.
            </td>
          </tr>
        ) : (
          assets.map((asset) => {
            return (
              <tr
                key={asset.assetId}
                onClick={() => onClick?.(asset)}
                className={`border-t ${onClick ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-dark-elevated'}`}
              >
                <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800 dark:text-dark-secondary">
                  {asset.assetLabel}
                  {asset.isOwner && (
                    <span className="ml-1 inline-flex items-center rounded bg-blue-100 dark:bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-white">
                      OWNER
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                  {asset.assetId}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(asset.status)}`}
                  >
                    {asset.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-dark-mutedText">
                  {asset.precision}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-phi-primary">
                  {(() => {
                    const raw = balances[asset.assetId];
                    if (raw !== undefined) return (raw / 10 ** asset.precision).toFixed(asset.precision);
                    const amt = asset.previousAmount;
                    if (amt != null && amt > 0) return amt.toFixed(asset.precision);
                    return '—';
                  })()}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
};
