import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LatestData } from '../types';

const COLORS = ['#38BDF8', '#F97316', '#A855F7', '#22C55E', '#FACC15', '#F472B6', '#2DD4BF'];

type Props = {
  data: LatestData;
  selectedBanks: string[];
  showFed: boolean;
  onToggleBank: (bank: string) => void;
  onClearBanks: () => void;
  onToggleFed: (value: boolean) => void;
};

const formatDate = (isoDate: string) => new Date(isoDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

const RateChart = ({ data, selectedBanks, showFed, onToggleBank, onClearBanks, onToggleFed }: Props) => {
  const { series, banks_tracked, primary_bank } = data;
  const map = new Map<string, Record<string, number | string>>();

  const appendSeries = (key: string, points: { date: string; value: number }[]) => {
    points.forEach(({ date, value }) => {
      const existing = map.get(date) ?? { date };
      existing[key] = value;
      map.set(date, existing);
    });
  };

  appendSeries('fed_effective', series.fed_effective);
  appendSeries('peer_median_hysa', series.peer_median_hysa);
  appendSeries('peer_p75_hysa', series.peer_p75_hysa);
  Object.entries(series.bank_apys).forEach(([bank, points]) => appendSeries(bank, points));

  const chartData = Array.from(map.values()).sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime());

  const banksToRender = selectedBanks.length ? selectedBanks : banks_tracked;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl" aria-labelledby="rate-chart-title">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h3 id="rate-chart-title" className="text-lg font-semibold text-slate-100">10-year APY vs. Fed benchmark</h3>
          <p className="text-xs text-slate-400">Toggle peers to focus the view. American Express remains highlighted.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 rounded border border-slate-600 bg-slate-800"
              checked={showFed}
              onChange={(event) => onToggleFed(event.target.checked)}
            />
            Show Fed Effective Rate
          </label>
          <button
            type="button"
            onClick={onClearBanks}
            className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 transition hover:border-primary hover:text-primary"
          >
            Show all banks
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {banks_tracked.map((bank) => {
          const checked = selectedBanks.includes(bank) || (!selectedBanks.length && banks_tracked.includes(bank));
          return (
            <label key={bank} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-200">
              <input
                type="checkbox"
                className="size-4 rounded border border-slate-600 bg-slate-800 accent-primary"
                checked={checked}
                onChange={() => onToggleBank(bank)}
              />
              {bank}
            </label>
          );
        })}
      </div>
      <div className="mt-6 h-80 w-full">
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 10 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={formatDate} stroke="#94a3b8" fontSize={12} />
            <YAxis stroke="#94a3b8" fontSize={12} domain={[0, 'auto']} unit="%" width={60} />
            <Tooltip
              formatter={(value: number) => `${value.toFixed(2)}%`}
              labelFormatter={(label) => formatDate(label as string)}
              contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '0.75rem' }}
            />
            <Legend verticalAlign="bottom" height={36} />
            {showFed && (
              <Line
                type="monotone"
                dataKey="fed_effective"
                name="Fed Effective"
                stroke="#facc15"
                strokeWidth={2}
                dot={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="peer_median_hysa"
              name="Peer median"
              stroke="#38BDF8"
              strokeDasharray="4 4"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="peer_p75_hysa"
              name="Peer p75"
              stroke="#F97316"
              strokeDasharray="2 6"
              strokeWidth={2}
              dot={false}
            />
            {banksToRender.map((bank, index) => (
              <Line
                key={bank}
                type="monotone"
                dataKey={bank}
                name={bank}
                stroke={bank === primary_bank ? '#22C55E' : COLORS[index % COLORS.length]}
                strokeWidth={bank === primary_bank ? 3 : 2}
                dot={false}
                activeDot={bank === primary_bank ? { r: 6 } : { r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};

export default RateChart;
