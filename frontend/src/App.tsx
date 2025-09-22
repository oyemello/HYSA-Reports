import { useEffect, useMemo, useState } from "react";

type AccountRecord = {
  institution: string;
  apy: string;
  link?: string | null;
  double_check?: boolean | null;
  fact_check_notes?: string | null;
};

type FetchState = "idle" | "loading" | "success" | "error";

const DATA_ENDPOINT = "/data/hysa_accounts.json";

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

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => a.institution.localeCompare(b.institution));
  }, [records]);

  return (
    <div className="bg-gradient-to-br from-amex-blueDark via-amex-blue to-amex-blueDark text-amex-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-16">
        <header className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            High-Yield Savings Account Tracker
          </h1>
          <p className="mt-4 text-lg text-amex-blueLight">
            Live snapshot of NerdWallet&apos;s featured institutions, scraped via Firecrawl and
            fact-checked with Gemini.
          </p>
        </header>

        <main className="mt-12 flex-1">
          <div className="overflow-hidden rounded-3xl bg-amex-white text-amex-blueDark shadow-2xl shadow-amex-blue/40">
            <div className="flex items-center justify-between border-b border-amex-blue/10 bg-amex-blue p-6 text-amex-white">
              <div>
                <h2 className="text-2xl font-semibold">Featured Institutions</h2>
                <p className="text-sm text-amex-blueLight">
                  Scraped from NerdWallet&apos;s best high-yield savings accounts roundup.
                </p>
              </div>
              <span className="rounded-full bg-amex-white/20 px-4 py-2 text-sm font-medium">
                Updated with Firecrawl
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
                        Double Check
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amex-blue/10">
                    {sortedRecords.map((record) => (
                      <tr key={`${record.institution}-${record.apy}`} className="hover:bg-amex-blueLight/40">
                        <td className="px-6 py-4 text-base font-medium">{record.institution}</td>
                        <td className="px-6 py-4 text-base font-semibold">{record.apy}</td>
                        <td className="px-6 py-4 text-base">
                          {record.link ? (
                            <a
                              href={record.link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 font-medium text-amex-blue hover:text-amex-blueDark"
                            >
                              Visit site
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
                          ) : (
                            <span className="text-sm text-amex-blueDark/70">Not provided</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-base">
                          <span
                            className="inline-flex items-center gap-3"
                            title={record.fact_check_notes ?? statusLabel(record.double_check)}
                          >
                            <DoubleCheckIcon value={record.double_check} />
                            <span className="text-sm text-amex-blueDark/70">
                              {statusLabel(record.double_check)}
                            </span>
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
        </main>

        <footer className="mt-10 text-center text-xs text-amex-blueLight">
          Data generated via Firecrawl scraping &amp; Gemini fact checking. Refresh after rerunning the scraper.
        </footer>
      </div>
    </div>
  );
}

export default App;
