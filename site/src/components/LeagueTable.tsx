import type { LeagueRow } from '../types';

const formatDelta = (value: number) => {
  if (value === 0) return '0';
  const arrow = value > 0 ? '▲' : '▼';
  return `${arrow} ${Math.abs(value)} bps`;
};

type Props = {
  rows: LeagueRow[];
  primaryBank: string;
};

const LeagueTable = ({ rows, primaryBank }: Props) => {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl" aria-labelledby="league-table-title">
      <div className="flex items-baseline justify-between">
        <h3 id="league-table-title" className="text-lg font-semibold text-slate-100">Current competitor APYs</h3>
        <span className="text-xs text-slate-400">As captured from official bank disclosures</span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Bank</th>
              <th scope="col" className="px-4 py-3 text-right">APY</th>
              <th scope="col" className="px-4 py-3 text-right">7d Δ</th>
              <th scope="col" className="px-4 py-3 text-right">30d Δ</th>
              <th scope="col" className="px-4 py-3 text-left">Promo</th>
              <th scope="col" className="px-4 py-3 text-left">Sources</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row) => (
              <tr key={row.bank} className={row.bank === primaryBank ? 'bg-slate-900/40' : ''}>
                <th scope="row" className="px-4 py-3 text-left font-medium text-slate-100">
                  {row.bank === primaryBank && <span className="mr-2 inline-flex items-center rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">Primary</span>}
                  {row.bank}
                </th>
                <td className="px-4 py-3 text-right font-mono text-sm">{row.apy.toFixed(2)}%</td>
                <td className={`px-4 py-3 text-right font-mono text-xs ${row.delta_7d_bps > 0 ? 'text-emerald-300' : row.delta_7d_bps < 0 ? 'text-rose-300' : 'text-slate-300'}`}>
                  {formatDelta(row.delta_7d_bps)}
                </td>
                <td className={`px-4 py-3 text-right font-mono text-xs ${row.delta_30d_bps > 0 ? 'text-emerald-300' : row.delta_30d_bps < 0 ? 'text-rose-300' : 'text-slate-300'}`}>
                  {formatDelta(row.delta_30d_bps)}
                </td>
                <td className="px-4 py-3 text-left text-xs">
                  {row.promo ? (
                    <span className="inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-200">Promo</span>
                  ) : (
                    <span className="text-slate-400">Steady-state</span>
                  )}
                </td>
                <td className="px-4 py-3 text-left text-xs">
                  <div className="flex flex-col">
                    <a className="text-primary hover:underline" href={row.source_urls.official} target="_blank" rel="noreferrer">
                      Official site
                    </a>
                    <a className="text-primary/80 hover:underline" href={row.source_urls.aggregator} target="_blank" rel="noreferrer">
                      NerdWallet
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default LeagueTable;
