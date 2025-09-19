import type { LatestData } from '../types';

const formatTimestamp = (timestamp: string) => new Date(timestamp).toLocaleString();

type Props = {
  audit: LatestData['audit'];
  asOf: string;
};

const ComplianceBlock = ({ audit, asOf }: Props) => {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl" aria-labelledby="compliance-block-title">
      <h3 id="compliance-block-title" className="text-lg font-semibold text-slate-100">Compliance &amp; methodology</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-3 text-sm text-slate-300">
          <p className="text-xs uppercase text-slate-500">As of</p>
          <p className="text-lg font-semibold text-primary">{formatTimestamp(asOf)}</p>
          <div>
            <p className="text-xs uppercase text-slate-500">Data freshness</p>
            <ul className="mt-1 space-y-1 text-xs text-slate-400">
              <li>Competitor capture: {formatTimestamp(audit.data_freshness.competitor_rates)}</li>
              <li>Fed series update: {formatTimestamp(audit.data_freshness.fed_series)}</li>
            </ul>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Sources</p>
            <ul className="mt-1 space-y-1 text-xs text-primary">
              {audit.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {source.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="space-y-3 text-sm text-slate-300">
          <p className="text-xs uppercase text-slate-500">Discrepancies</p>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
            {audit.discrepancies.length === 0 ? (
              <p>No aggregator vs. official discrepancies flagged in this run.</p>
            ) : (
              <ul className="space-y-2">
                {audit.discrepancies.map((item) => (
                  <li key={item.bank}>
                    <span className="font-semibold text-slate-200">{item.bank}</span>: {item.note}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Robots.txt respected, rate limits applied, promotional language flagged where detected. Stale entries auto-suppressed unless toggled.
          </p>
        </div>
      </div>
    </section>
  );
};

export default ComplianceBlock;
