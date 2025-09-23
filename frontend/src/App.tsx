import { useEffect, useMemo, useState } from "react";

// PeerComparisonChart removed; app shows only Featured Institutions table.

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

function App() {
  const [records, setRecords] = useState<AccountRecord[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Find APY and federal rate from forecast.json
  const [apy, setApy] = useState<number | null>(null);
  const [fedRate, setFedRate] = useState<number | null>(null);

  useEffect(() => {
    fetch(dataUrl("data/forecast.json"), { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json) return;
        setApy(json.inputs?.institution_apy ?? null);
        setFedRate(json.inputs?.FRED?.FEDFUNDS?.value ?? null);
      });
  }, []);

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

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => a.institution.localeCompare(b.institution)),
    [records],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-16">
        <header className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">AMEX HYSA APY Navigator</h1>
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            {apy !== null && (
              <span className="inline-block rounded bg-amex-blue text-amex-white px-4 py-2 font-semibold text-lg">
                American Express APY: {apy.toFixed(2)}%
              </span>
            )}
            {fedRate !== null && (
              <span className="inline-block rounded bg-slate-800 text-amex-blue px-4 py-2 font-semibold text-lg">
                Federal Funds Rate (FRED): {fedRate.toFixed(2)}%
              </span>
            )}
          </div>
          <p className="mt-4 text-lg text-amex-blueLight">
            Generates HYSA APY Reports by comparing with other financial institutions.
          </p>
        </header>

        <main className="mt-12 flex-1">
          <section className="overflow-hidden rounded-3xl bg-amex-white text-amex-blueDark shadow-2xl shadow-amex-blue/40">
            <div className="flex items-center justify-between border-b border-amex-blue/10 bg-amex-blue p-6 text-amex-white">
              <div>
                <h2 className="text-2xl font-semibold">Featured Institutions</h2>
                <p className="text-sm text-amex-blueLight">Top 13 Institutions with Highest APYs</p>
              </div>
              <span className="rounded-full bg-amex-white/20 px-4 py-2 text-sm font-medium">
                Updated via NerdWallet
              </span>
            </div>

            {fetchState === "loading" && (
              <div className="p-8 text-center text-amex-blue">Fetching the latest rates…</div>
            )}

            {fetchState === "error" && (
              <div className="p-8 text-center text-red-600">Unable to load data. {errorMessage}</div>
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
                          <span className="inline-flex items-center" title={record.fact_check_notes ?? statusLabel(record.double_check)}>
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
