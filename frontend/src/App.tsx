import { useEffect, useMemo, useState } from "react";

import PeerComparisonChart, {
  type MacroSeriesMap,
  type PeerHistory,
} from "./components/PeerComparisonChart";

type AccountRecord = {
  institution: string;
  apy: string;
  link?: string | null;
  nerdwallet_link?: string | null;
  bank_link?: string | null;
  double_check?: boolean | null;
  fact_check_notes?: string | null;
};

type FetchState = "idle" | "loading" | "success" | "error";

type PeerRow = {
  bank: string;
  apy: number;
  delta_7d: number;
  delta_30d: number;
  url?: string | null;
  key?: string;
};

type PeerSnapshot = {
  as_of: string;
  peer_median: number;
  peer_p75: number;
  rows: PeerRow[];
  history?: PeerHistory;
};

type MacroSnapshot = {
  generated_at?: string;
  macros?: MacroSeriesMap;
  features?: Record<string, number | null>;
};

type ForecastHorizon = {
  months: number;
  p50: number;
  low: number;
  high: number;
  deposit_index?: number;
  nim?: number;
};

type ForecastSnapshot = {
  as_of: string;
  horizons: ForecastHorizon[];
  method: string;
};

type ScenarioSnapshot = {
  as_of: string;
  scenarios: Record<string, Array<{ months: number; value: number; low: number; high: number; deposit_index?: number; nim?: number }>>;
};

type Narrative = {
  title: string;
  period: string;
  bank: string;
  metrics: {
    top_hysa_apy: number;
    peer_median_apy: number;
    peer_p75_apy: number;
    effr: number;
    spread_vs_median_bps: number;
  };
  highlights: string[];
  benchmarking: string;
  forecast_insights: string;
  recommendations: string[];
  risks: string[];
  compliance: string;
};

const BASE_PATH = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");
const dataUrl = (path: string) => {
  if (!BASE_PATH) return `/${path}`;
  return `${BASE_PATH}${BASE_PATH.endsWith("/") ? "" : "/"}${path}`;
};
const SOURCE_SNAPSHOT = dataUrl("data/hysa_accounts.json");

const statusLabel = (value: boolean | null | undefined) => {
  if (value === true) return "Verified";
  if (value === false) return "Mismatch";
  return "Not verified";
};

const DoubleCheckIcon = ({ value }: { value: boolean | null | undefined }) => {
  if (value === true) {
    return (
      <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (value === false) {
    return (
      <svg className="h-5 w-5 text-rose-400" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  return (
    <svg className="h-5 w-5 text-amber-400" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 7v5" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
};

const formatPercent = (value: number | null | undefined, digits = 2) =>
  Number.isFinite(value ?? NaN) ? `${Number(value).toFixed(digits)}%` : "—";

const formatDelta = (value: number | null | undefined) => {
  if (!Number.isFinite(value ?? NaN)) return "—";
  const formatted = Number(value).toFixed(2);
  return `${Number(value) > 0 ? "+" : ""}${formatted}pp`;
};

function App() {
  const [records, setRecords] = useState<AccountRecord[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [peerSnapshot, setPeerSnapshot] = useState<PeerSnapshot | null>(null);
  const [macroSnapshot, setMacroSnapshot] = useState<MacroSnapshot | null>(null);
  const [forecast, setForecast] = useState<ForecastSnapshot | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSnapshot | null>(null);
  const [narrative, setNarrative] = useState<Narrative | null>(null);

  useEffect(() => {
    const fetchSnapshot = async () => {
      setFetchState("loading");
      try {
        const response = await fetch(SOURCE_SNAPSHOT, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload: AccountRecord[] = await response.json();
        setRecords(payload);
        setFetchState("success");
      } catch (error) {
        setFetchState("error");
        setErrorMessage(error instanceof Error ? error.message : "Unknown error");
      }
    };
    fetchSnapshot();
  }, []);

  useEffect(() => {
    const fetchJson = async <T,>(path: string): Promise<T | null> => {
      try {
        const response = await fetch(dataUrl(path), { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as T;
      } catch (error) {
        console.warn(`Unable to load ${path}:`, error);
        return null;
      }
    };

    (async () => {
      const [peer, macro, forecastData, scenarioData, narrativeData] = await Promise.all([
        fetchJson<PeerSnapshot>("hysa.json"),
        fetchJson<MacroSnapshot>("macro.json"),
        fetchJson<ForecastSnapshot>("forecast.json"),
        fetchJson<ScenarioSnapshot>("scenarios.json"),
        fetchJson<Narrative>("narrative.json"),
      ]);
      setPeerSnapshot(peer);
      setMacroSnapshot(macro);
      setForecast(forecastData);
      setScenarios(scenarioData);
      setNarrative(narrativeData);
    })();
  }, []);

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => a.institution.localeCompare(b.institution)),
    [records],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-36 top-[-20%] h-[420px] w-[420px] rounded-full bg-sky-500/20 blur-3xl" />
        <div className="absolute right-[-10%] top-1/3 h-[520px] w-[520px] rounded-full bg-indigo-500/20 blur-3xl" />
      </div>
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-12">
        <header className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 px-4 py-1 text-xs uppercase tracking-[0.35em] text-slate-400">
            HYSA CONTROL CENTER
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
            AMEX HYSA APY Navigator
          </h1>
          <p className="mt-3 text-base text-slate-400">
            Monitor high-yield savings performance, spreads, and forecasts across the competitive landscape.
          </p>
        </header>

        <main className="mt-12 flex-1 space-y-12">
          <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.75)]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/70 px-6 py-5">
              <div>
                <h2 className="text-xl font-semibold text-slate-100">Featured Institutions</h2>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Top 13 institutions by listed APY · Updated via NerdWallet
                </p>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-800/70 px-4 py-1 text-xs font-medium text-slate-300">
                {fetchState === "success" ? `${sortedRecords.length} institutions` : "Refreshing"}
              </span>
            </div>

            {fetchState === "loading" && (
              <div className="p-8 text-center text-slate-400">Fetching the latest rates…</div>
            )}

            {fetchState === "error" && (
              <div className="p-8 text-center text-rose-400">
                Unable to load data. {errorMessage}
              </div>
            )}

            {fetchState === "success" && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
                  <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left">Institution</th>
                      <th scope="col" className="px-6 py-3 text-left">APY</th>
                      <th scope="col" className="px-6 py-3 text-left">Link</th>
                      <th scope="col" className="px-6 py-3 text-left">Verified</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {sortedRecords.map((record) => (
                      <tr key={`${record.institution}-${record.apy}`} className="bg-slate-900/60 transition hover:bg-slate-900">
                        <td className="px-6 py-3 text-sm font-medium text-slate-100">{record.institution}</td>
                        <td className="px-6 py-3 text-sm font-semibold text-slate-200">{record.apy}</td>
                        <td className="px-6 py-3 text-sm">
                          {(() => {
                            const verifiedBank = record.double_check === true && record.bank_link;
                            const fallback = record.nerdwallet_link || record.link || null;
                            const href = (verifiedBank || fallback) as string | null;
                            if (!href) return <span className="text-slate-500">Not provided</span>;
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 text-sky-300 transition hover:text-sky-100"
                              >
                                {verifiedBank ? "Visit bank" : "View source"}
                                <span aria-hidden>↗</span>
                              </a>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-3 text-sm text-slate-300">
                          <span className="inline-flex items-center gap-2" title={record.fact_check_notes ?? statusLabel(record.double_check)}>
                            <DoubleCheckIcon value={record.double_check} />
                            <span className="hidden text-xs text-slate-500 sm:inline">{statusLabel(record.double_check)}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Peer Stats + Deltas (for table + badges)
              </h3>
              <div className="mt-3 space-y-4 text-sm text-slate-200">
                {peerSnapshot ? (
                  <>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className="rounded-full bg-slate-800 px-3 py-1 font-semibold text-slate-200">
                        Median: {formatPercent(peerSnapshot.peer_median)}
                      </span>
                      <span className="rounded-full bg-emerald-600/20 px-3 py-1 font-semibold text-emerald-200">
                        P75: {formatPercent(peerSnapshot.peer_p75)}
                      </span>
                      <span className="rounded-full bg-slate-800 px-3 py-1 font-semibold text-slate-300">
                        Updated {new Date(peerSnapshot.as_of).toLocaleDateString()}
                      </span>
                    </div>
                    <div>
                      <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">Top movers (Δ7d)</p>
                      <ul className="mt-2 space-y-1 text-xs">
                        {peerSnapshot.rows
                          .slice()
                          .sort((a, b) => Math.abs(b.delta_7d) - Math.abs(a.delta_7d))
                          .slice(0, 3)
                          .map((row) => (
                            <li key={row.bank} className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium">{row.bank}</span>
                              <span className="text-slate-400">
                                {formatDelta(row.delta_7d)} · 30d {formatDelta(row.delta_30d)}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Run `npm run peers` to refresh peer snapshot.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                10-Year Chart (Fed vs Peers)
              </h3>
              <div className="mt-3 text-sm text-slate-200">
                <p>
                  Interactive SVG chart comparing the Fed effective rate, peer medians, and a selected competitor APY.
                  Use the toggles below to customise the view.
                </p>
                <a className="mt-3 inline-flex items-center gap-2 text-xs text-sky-300 hover:text-sky-100" href="#fed-peer-card">
                  Jump to chart <span aria-hidden>↘</span>
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Spreads (profitability proxies) — feeds forecasts
              </h3>
              <div className="mt-3 text-sm text-slate-200">
                {macroSnapshot?.features ? (
                  <ul className="space-y-2 text-xs">
                    {Object.entries(macroSnapshot.features).map(([name, value]) => (
                      <li key={name} className="flex items-center justify-between gap-3">
                        <span className="uppercase tracking-wide text-slate-400">{name.replace(/_/g, " ")}</span>
                        <span>{formatPercent(value)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">Run `npm run macro` to refresh spread metrics.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Forecasts (3/6/12 months)</h3>
              <div className="mt-3 text-sm text-slate-200">
                {forecast ? (
                  <>
                    <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">
                      Method: {forecast.method} · Updated {new Date(forecast.as_of).toLocaleDateString()}
                    </p>
                    <table className="mt-2 min-w-full text-xs">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="py-1 text-left">Horizon</th>
                          <th className="py-1 text-right">P50</th>
                          <th className="py-1 text-right">Low</th>
                          <th className="py-1 text-right">High</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecast.horizons.map((row) => (
                          <tr key={row.months}>
                            <td className="py-1 font-semibold text-slate-200">{row.months} mo</td>
                            <td className="py-1 text-right text-slate-300">{formatPercent(row.p50)}</td>
                            <td className="py-1 text-right text-slate-500">{formatPercent(row.low)}</td>
                            <td className="py-1 text-right text-slate-500">{formatPercent(row.high)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Run `npm run forecast` to generate outlook.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Scenario presets (Baseline / Hawkish / Dovish)
              </h3>
              <div className="mt-3 text-sm text-slate-200">
                {scenarios ? (
                  <>
                    <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">
                      Updated {new Date(scenarios.as_of).toLocaleDateString()}
                    </p>
                    <table className="mt-2 min-w-full text-xs">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="py-1 text-left">Horizon</th>
                          <th className="py-1 text-right">Baseline</th>
                          <th className="py-1 text-right">Hawkish</th>
                          <th className="py-1 text-right">Dovish</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(scenarios.scenarios.baseline ?? []).map((row, index) => {
                          const hawk = scenarios.scenarios.hawkish?.[index];
                          const dove = scenarios.scenarios.dovish?.[index];
                          return (
                            <tr key={row.months}>
                              <td className="py-1 font-semibold text-slate-200">{row.months} mo</td>
                              <td className="py-1 text-right text-slate-300">{formatPercent(row.value)}</td>
                              <td className="py-1 text-right text-amber-300">{formatPercent(hawk?.value ?? null)}</td>
                              <td className="py-1 text-right text-sky-300">{formatPercent(dove?.value ?? null)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Run `npm run scenarios` to build presets.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Executive narrative (medium, detailed)
              </h3>
              <div className="mt-3 space-y-3 text-sm text-slate-200">
                {narrative ? (
                  <>
                    <div>
                      <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">
                        {narrative.title} · {narrative.period}
                      </p>
                      <p className="text-xs text-slate-500">Bank: {narrative.bank}</p>
                    </div>
                    <ul className="space-y-1 text-xs text-slate-300">
                      {narrative.highlights.slice(0, 3).map((item, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <span aria-hidden>•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="text-[0.7rem] text-slate-500">
                      <p className="font-semibold text-slate-300">Compliance</p>
                      <p>{narrative.compliance}</p>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Run `npm run narrative` (requires GEMINI_API_KEY) to generate the executive brief.</p>
                )}
              </div>
            </div>
          </section>

          <section
            id="fed-peer-card"
            className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.75)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-100">10-Year Chart · Fed vs Peers</h2>
                <p className="text-sm text-slate-400">
                  Analyse the front-end rate environment against peer HYSA behaviour. Toggle series and choose any competitor to
                  benchmark against the Fed effective rate.
                </p>
              </div>
            </div>
            <div className="mt-6">
              <PeerComparisonChart macros={macroSnapshot?.macros} history={peerSnapshot?.history} />
            </div>
          </section>
        </main>

        <footer className="mt-16 border-t border-slate-900/60 pt-6 text-center text-xs text-slate-500">
          American Express internal tool. Data generated via Firecrawl scraping, Gemini verification, and rules-based forecasts.
          Refresh after rerunning the CLI pipeline: macro · peers · forecast · scenarios · narrative.
        </footer>
      </div>
    </div>
  );
}

export default App;
