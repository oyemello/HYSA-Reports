import type { Forecasts } from '../types';

type Props = {
  scenarios: Forecasts['scenarios'];
  horizons: string[];
};

const ScenarioPanel = ({ scenarios, horizons }: Props) => {
  const entries = Object.entries(scenarios);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl" aria-labelledby="scenario-panel-title">
      <div className="flex items-baseline justify-between">
        <h3 id="scenario-panel-title" className="text-lg font-semibold text-slate-100">Scenario presets</h3>
        <p className="text-xs text-slate-400">Read-only templates derived from futures &amp; industry priors.</p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {entries.map(([scenario, detail]) => (
          <article key={scenario} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{scenario}</h4>
            <p className="mt-2 text-sm text-slate-300">{detail.description}</p>
            <div className="mt-3 text-xs text-slate-400">
              {detail.fed_path.map((value, index) => (
                <div key={index} className="flex items-center justify-between border-b border-slate-800 py-1">
                  <span>{horizons[index]}</span>
                  <span>{value.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

export default ScenarioPanel;
