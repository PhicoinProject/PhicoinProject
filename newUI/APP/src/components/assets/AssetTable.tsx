import type { Asset } from '@/types';
import { ASSET_STATUS_ISSUED, ASSET_STATUS_REVOKED } from '@/utils/constants';

interface AssetTableProps {
  assets: Asset[];
  balances?: Record<string, number>;
  onClick?: (asset: Asset) => void;
}

function statusVariant(status: string): { bg: string; text: string } {
  if (status === ASSET_STATUS_ISSUED) return { bg: 'bg-green-100', text: 'text-green-700' };
  if (status === ASSET_STATUS_REVOKED) return { bg: 'bg-red-100', text: 'text-red-700' };
  return { bg: 'bg-gray-100', text: 'text-gray-600' };
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
            <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-dark-mutedText">
              No assets found.
            </td>
          </tr>
        ) : (
          assets.map((asset) => {
            const variant = statusVariant(asset.status);
            return (
              <tr
                key={asset.assetId}
                onClick={() => onClick?.(asset)}
                className={`border-t ${onClick ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-dark-elevated'}`}
              >
                <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800 dark:text-dark-secondary">
                  {asset.assetLabel}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                  {asset.assetId.slice(0, 12)}...
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${variant.bg} ${variant.text}`}
                  >
                    {asset.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-dark-mutedText">
                  {asset.precision}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-phi-primary">
                  {balances[asset.assetId] !== undefined
                    ? (balances[asset.assetId] / 10 ** asset.precision).toFixed(asset.precision)
                    : '—'}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
};
