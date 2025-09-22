import { useEffect, useMemo, useState } from "react";

type PeerRow = {
  bank: string;
  apy: number;
  delta_7d: number;
  delta_30d: number;
  url?: string | null;
};

type PeerSnapshot = {
  as_of: string;
  peer_median: number;
  peer_p75: number;
  rows: PeerRow[];
};

type MacroFeatures = {
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

type AccountRecord = {
  institution: string;
  apy: string;
  // Backward-compat: some older JSON may still have `link`
  link?: string | null;
  nerdwallet_link?: string | null;
  bank_link?: string | null;
  double_check?: boolean | null;
  fact_check_notes?: string | null;
};

type FetchState = "idle" | "loading" | "success" | "error";

// Respect GitHub Pages base path in production builds
const BASE_PATH = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");
const dataUrl = (path: string) => `${BASE_PATH}/${path}`.replace(/\/+/, "/");
const DATA_ENDPOINT = dataUrl("data/hysa_accounts.json");

const statusLabel = (value: boolean | null | undefined) => {
  if (value === true) return "Double checked";
  if (value === false) return "Mismatch";
  return "Not verified";
};

const DoubleCheckIcon = ({ value }: { value: boolean | null | undefined }) => {
  if (value === true) {
    return (
      <svg
        className="h-6 w-6 text-emerald-500"
        viewBox="0 0 24 24"
        stroke="currentColor"
        fill="none"
        strokeWidth="2"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (value === false) {
    return (
      <svg
        className="h-6 w-6 text-red-500"
        viewBox="0 0 24 24"
        stroke="currentColor"
        fill="none"
        strokeWidth="2"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  return (
    <svg
      className="h-6 w-6 text-amber-500"
      viewBox="0 0 24 24"
      stroke="currentColor"
      fill="none"
      strokeWidth="2"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 7v5" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
};

function App() {
  const [records, setRecords] = useState<AccountRecord[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [peerSnapshot, setPeerSnapshot] = useState<PeerSnapshot | null>(null);
  const [macroFeatures, setMacroFeatures] = useState<MacroFeatures | null>(null);
  const [forecast, setForecast] = useState<ForecastSnapshot | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSnapshot | null>(null);
  const [narrative, setNarrative] = useState<Narrative | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setFetchState("loading");
      try {
        const response = await fetch(DATA_ENDPOINT, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Fetching data failed with status ${response.status}`);
        }
        const payload: AccountRecord[] = await response.json();
        setRecords(payload);
        setFetchState("success");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setErrorMessage(message);
        setFetchState("error");
      }
    };

    fetchData();
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
        fetchJson<MacroFeatures>("macro.json"),
        fetchJson<ForecastSnapshot>("forecast.json"),
        fetchJson<ScenarioSnapshot>("scenarios.json"),
        fetchJson<Narrative>("narrative.json"),
      ]);
      setPeerSnapshot(peer);
      setMacroFeatures(macro);
      setForecast(forecastData);
      setScenarios(scenarioData);
      setNarrative(narrativeData);
    })();
  }, []);

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => a.institution.localeCompare(b.institution));
  }, [records]);

  const formatPercent = (value: number | null | undefined, digits = 2) =>
    Number.isFinite(value ?? NaN) ? `${Number(value).toFixed(digits)}%` : "—";

  const formatDelta = (value: number | null | undefined) => {
    if (!Number.isFinite(value ?? NaN)) return "—";
    const formatted = Number(value).toFixed(2);
    const prefix = Number(value) > 0 ? "+" : "";
    return `${prefix}${formatted}pp`;
  };

  return (
    <div className="bg-gradient-to-br from-amex-blueDark via-amex-blue to-amex-blueDark text-amex-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-16">
        <header className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            AMEX HYSA APY Navigator
          </h1>
          <p className="mt-4 text-lg text-amex-blueLight">
            Generates HYSA APY Reports by comparing with other financial institutions.
          </p>
        </header>

        <main className="mt-12 flex-1">
          <div className="overflow-hidden rounded-3xl bg-amex-white text-amex-blueDark shadow-2xl shadow-amex-blue/40">
            <div className="flex items-center justify-between border-b border-amex-blue/10 bg-amex-blue p-6 text-amex-white">
              <div>
                <h2 className="text-2xl font-semibold">Featured Institutions</h2>
                <p className="text-sm text-amex-blueLight">
                  Top 13 Institutions with Highest APYs
                </p>
              </div>
              <span className="rounded-full bg-amex-white/20 px-4 py-2 text-sm font-medium">
                Updated via NerdWallet
              </span>
            </div>

            {fetchState === "loading" && (
              <div className="p-8 text-center text-amex-blue">
                Fetching the latest rates...
              </div>
            )}

            {fetchState === "error" && (
              <div className="p-8 text-center text-red-600">
                Unable to load data. {errorMessage}
              </div>
            )}

            {fetchState === "success" && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-amex-blue/10 text-sm">
                  <thead className="bg-amex-blue text-amex-white">
                    <tr>
                      <th scope="col" className="px-6 py-4 text-left font-medium uppercase tracking-wide">
                        Institution
                      </th>
                      <th scope="col" className="px-6 py-4 text-left font-medium uppercase tracking-wide">
                        APY
                      </th>
                      <th scope="col" className="px-6 py-4 text-left font-medium uppercase tracking-wide">
                        Link
                      </th>
                      <th scope="col" className="px-6 py-4 text-left font-medium uppercase tracking-wide">
                        Verified
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amex-blue/10">
                    {sortedRecords.map((record) => (
                      <tr key={`${record.institution}-${record.apy}`} className="hover:bg-amex-blueLight/40">
                        <td className="px-6 py-4 text-base font-medium">{record.institution}</td>
                        <td className="px-6 py-4 text-base font-semibold">{record.apy}</td>
                        <td className="px-6 py-4 text-base">
                          {(() => {
                            const verifiedBank = record.double_check === true && record.bank_link;
                            const fallback = record.nerdwallet_link || record.link || null;
                            const href = (verifiedBank || fallback) as string | null;
                            if (!href) return <span className="text-sm text-amex-blueDark/70">Not provided</span>;
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 font-medium text-amex-blue hover:text-amex-blueDark"
                              >
                                {verifiedBank ? "Visit bank" : "View source"}
                                <svg
                                  className="h-4 w-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden
                                >
                                  <path d="M7 17l10-10" />
                                  <path d="M7 7h10v10" />
                                </svg>
                              </a>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4 text-base">
                          <span
                            className="inline-flex items-center"
                            title={record.fact_check_notes ?? statusLabel(record.double_check)}
                          >
                            <DoubleCheckIcon value={record.double_check} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {fetchState === "success" && sortedRecords.length === 0 && (
              <div className="p-8 text-center text-amex-blue">
                No accounts were extracted. Run the scraper to populate fresh data.
              </div>
            )}
          </div>
          {/* Feature roadmap cards */}
          <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl bg-amex-white text-amex-blueDark shadow-lg shadow-amex-blue/20">
              <div className="border-b border-amex-blue/10 bg-amex-blue px-5 py-3 text-amex-white">
                <h3 className="text-sm font-semibold uppercase tracking-wide">
                  PEER STATS + DELTAS (FOR TABLE + BADGES)
                </h3>
              </div>
              <div className="p-5 text-sm text-amex-blueDark/80">
                {peerSnapshot ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-3">
                      <span className="rounded-full bg-amex-blueLight px-3 py-1 text-xs font-semibold text-amex-blueDark">
                        Median: {formatPercent(peerSnapshot.peer_median)}
                      </span>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                        P75: {formatPercent(peerSnapshot.peer_p75)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        Updated {new Date(peerSnapshot.as_of).toLocaleDateString()}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-amex-blueDark/60">Top movers</p>
                      <ul className="mt-1 space-y-1 text-sm">
                        {peerSnapshot.rows
                          .slice()
                          .sort((a, b) => Math.abs(b.delta_7d) - Math.abs(a.delta_7d))
                          .slice(0, 3)
                          .map((row) => (
                            <li key={row.bank} className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium">{row.bank}</span>
                              <span className="text-xs text-amex-blueDark/70">
                                Δ7d: {formatDelta(row.delta_7d)} · Δ30d: {formatDelta(row.delta_30d)}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-amex-blueDark/60">Run `npm run peers` to refresh peer snapshot.</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-amex-white text-amex-blueDark shadow-lg shadow-amex-blue/20">
              <div className="border-b border-amex-blue/10 bg-amex-blue px-5 py-3 text-amex-white">
                <h3 className="text-sm font-semibold uppercase tracking-wide">10-YEAR CHART (FED VS PEERS)</h3>
              </div>
              <div className="p-5 text-sm text-amex-blueDark/80">
                <p>
                  Interactive SVG chart compares the Fed effective rate with peer HYSA medians. Toggle series using the checkboxes
                  above the chart.
                </p>
                <a
                  className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-amex-blue hover:text-amex-blueDark"
                  href="#fed-peer-card"
                >
                  Jump to chart
                  <span aria-hidden>↘</span>
                </a>
              </div>
            </div>

            <div className="rounded-2xl bg-amex-white text-amex-blueDark shadow-lg shadow-amex-blue/20">
              <div className="border-b border-amex-blue/10 bg-amex-blue px-5 py-3 text-amex-white">
                <h3 className="text-sm font-semibold uppercase tracking-wide">
                  SPREADS (PROFITABILITY PROXIES) — FEEDS FORECASTS
                </h3>
              </div>
              <div className="p-5 text-sm text-amex-blueDark/80">
                {macroFeatures?.features ? (
                  <ul className="space-y-2">
                    {Object.entries(macroFeatures.features).map(([name, value]) => (
                      <li key={name} className="flex items-center justify-between text-xs">
                        <span className="font-semibold uppercase tracking-wide">{name.replace(/_/g, ' ')}</span>
                        <span>{formatPercent(value)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-amex-blueDark/60">Run `npm run macro` to refresh spread metrics.</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-amex-white text-amex-blueDark shadow-lg shadow-amex-blue/20">
              <div className="border-b border-amex-blue/10 bg-amex-blue px-5 py-3 text-amex-white">
                <h3 className="text-sm font-semibold uppercase tracking-wide">FORECASTS (3/6/12 MONTHS)</h3>
              </div>
              <div className="p-5 text-sm text-amex-blueDark/80">
                {forecast ? (
                  <div className="space-y-2">
                    <p className="text-xs text-amex-blueDark/60">
                      Method: {forecast.method} · Updated {new Date(forecast.as_of).toLocaleDateString()}
                    </p>
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-amex-blueDark/60">
                          <th className="py-1 text-left">Horizon</th>
                          <th className="py-1 text-right">P50</th>
                          <th className="py-1 text-right">Low</th>
                          <th className="py-1 text-right">High</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecast.horizons.map((row) => (
                          <tr key={row.months}>
                            <td className="py-1 font-semibold">{row.months} mo</td>
                            <td className="py-1 text-right">{formatPercent(row.p50)}</td>
                            <td className="py-1 text-right">{formatPercent(row.low)}</td>
                            <td className="py-1 text-right">{formatPercent(row.high)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-amex-blueDark/60">Run `npm run forecast` to generate outlook.</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-amex-white text-amex-blueDark shadow-lg shadow-amex-blue/20">
              <div className="border-b border-amex-blue/10 bg-amex-blue px-5 py-3 text-amex-white">
                <h3 className="text-sm font-semibold uppercase tracking-wide">
                  SCENARIO PRESETS (BASELINE / HAWKISH / DOVISH)
                </h3>
              </div>
              <div className="p-5 text-sm text-amex-blueDark/80">
                {scenarios ? (
                  <div className="space-y-2">
                    <p className="text-xs text-amex-blueDark/60">
                      Updated {new Date(scenarios.as_of).toLocaleDateString()}
                    </p>
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-amex-blueDark/60">
                          <th className="py-1 text-left">Horizon</th>
                          <th className="py-1 text-right">Baseline</th>
                          <th className="py-1 text-right">Hawkish</th>
                          <th className="py-1 text-right">Dovish</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(scenarios.scenarios.baseline ?? []).map((row, index) => {
                          const months = row.months;
                          const hawk = scenarios.scenarios.hawkish?.[index];
                          const dove = scenarios.scenarios.dovish?.[index];
                          return (
                            <tr key={months}>
                              <td className="py-1 font-semibold">{months} mo</td>
                              <td className="py-1 text-right">{formatPercent(row.value)}</td>
                              <td className="py-1 text-right">{formatPercent(hawk?.value ?? null)}</td>
                              <td className="py-1 text-right">{formatPercent(dove?.value ?? null)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-amex-blueDark/60">Run `npm run scenarios` to build presets.</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-amex-white text-amex-blueDark shadow-lg shadow-amex-blue/20">
              <div className="border-b border-amex-blue/10 bg-amex-blue px-5 py-3 text-amex-white">
                <h3 className="text-sm font-semibold uppercase tracking-wide">
                  EXECUTIVE NARRATIVE (MEDIUM, DETAILED)
                </h3>
              </div>
              <div className="p-5 space-y-3 text-sm text-amex-blueDark/80">
                {narrative ? (
                  <>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-amex-blueDark/60">
                        {narrative.title} · {narrative.period}
                      </p>
                      <p className="text-xs text-amex-blueDark/60">Bank: {narrative.bank}</p>
                    </div>
                    <ul className="space-y-1 text-xs">
                      {narrative.highlights.slice(0, 3).map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span aria-hidden>•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="text-[0.7rem] text-amex-blueDark/70">
                      <p className="font-semibold">Compliance</p>
                      <p>{narrative.compliance}</p>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-amex-blueDark/60">
                    Run `npm run narrative` (requires GEMINI_API_KEY) to generate the executive brief.
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>

        <footer className="mt-10 text-center text-xs text-amex-blueLight">
          American Express Internal Tool. Data generated via Firecrawl scraping &amp; Gemini fact checking. Refresh after rerunning the scraper.
        </footer>
      </div>
    </div>
  );
}

export default App;
