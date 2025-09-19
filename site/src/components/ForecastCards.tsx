import type { Forecasts } from '../types';

type Props = {
  forecasts: Forecasts;
};

const formatBand = (low: number, high: number, unit: '%' | 'idx' = '%') => {
  const suffix = unit === '%' ? '%' : '';
  return `${low.toFixed(2)}${suffix} – ${high.toFixed(2)}${suffix}`;
};

const ForecastCards = ({ forecasts }: Props) => {
  const horizons = forecasts.horizons;
  const { cost_of_funds, deposit_volume, nim } = forecasts.metrics;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl" aria-labelledby="forecast-cards-title">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 id="forecast-cards-title" className="text-lg font-semibold text-slate-100">Outlook (P50 with bands)</h3>
          <p className="text-xs text-slate-400">Forecast intervals derived from SARIMAX with peer &amp; Fed drivers.</p>
        </div>
        <div className="text-xs text-slate-400">
          β: {forecasts.assumptions.beta.toFixed(2)} · Elasticity: {forecasts.assumptions.elasticity.toFixed(2)}
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {horizons.map((horizon, index) => (
          <article key={horizon} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{horizon}</h4>
            <div className="mt-3 space-y-3 text-sm text-slate-200">
              <div>
                <span className="text-xs uppercase text-slate-500">Cost of funds (P50)</span>
                <p className="text-xl font-semibold text-primary">{cost_of_funds.p50[index].toFixed(2)}%</p>
                <p className="text-xs text-slate-400">Band: {formatBand(cost_of_funds.p10[index], cost_of_funds.p90[index])}</p>
              </div>
              <div>
                <span className="text-xs uppercase text-slate-500">Deposit index</span>
                <p className="text-xl font-semibold text-emerald-300">{deposit_volume.p50[index].toFixed(1)}</p>
                <p className="text-xs text-slate-400">Band: {formatBand(deposit_volume.p10[index], deposit_volume.p90[index], 'idx')}</p>
              </div>
              <div>
                <span className="text-xs uppercase text-slate-500">Net interest margin</span>
                <p className="text-xl font-semibold text-amber-300">{nim.p50[index].toFixed(2)}%</p>
                <p className="text-xs text-slate-400">Band: {formatBand(nim.p10[index], nim.p90[index])}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

export default ForecastCards;
