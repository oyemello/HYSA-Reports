import { useEffect, useState } from "react";

export default function ProfitabilityForecastResults() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/forecast")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Unknown error");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <section className="mt-16" id="profitability-forecast-results">
        <h2 className="text-2xl font-bold mb-4">Profitability Forecast Results</h2>
        <div className="text-amex-blue">Loading forecast…</div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="mt-16" id="profitability-forecast-results">
        <h2 className="text-2xl font-bold mb-4">Profitability Forecast Results</h2>
        <div className="text-red-500">Error: {error}</div>
      </section>
    );
  }
  if (!data) return null;

  // Scenario table extraction (if present)
  let scenarioTable: any[][] = [];
  if (data.forecast && data.forecast.base) {
    scenarioTable.push([
      "Scenario", "3mo Bal", "3mo NIM", "3mo Profit", "6mo Bal", "6mo NIM", "6mo Profit", "12mo Bal", "12mo NIM", "12mo Profit"
    ]);
    scenarioTable.push([
      "Base",
      data.forecast.base.balances[0], data.forecast.base.nim[0], data.forecast.base.profit[0],
      data.forecast.base.balances[1], data.forecast.base.nim[1], data.forecast.base.profit[1],
      data.forecast.base.balances[2], data.forecast.base.nim[2], data.forecast.base.profit[2]
    ]);
    // Add more scenarios if present
    for (const key of Object.keys(data.forecast)) {
      if (key === "base") continue;
      const s = data.forecast[key];
      if (s && s.balances && s.nim && s.profit) {
        scenarioTable.push([
          key.charAt(0).toUpperCase() + key.slice(1),
          s.balances[0], s.nim[0], s.profit[0],
          s.balances[1], s.nim[1], s.profit[1],
          s.balances[2], s.nim[2], s.profit[2]
        ]);
      }
    }
  }

  return (
    <section className="mt-16" id="profitability-forecast-results">
      <h2 className="text-2xl font-bold mb-4">Profitability Forecast Results</h2>
      <div className="mb-6">
        <pre className="bg-slate-900 text-slate-100 p-4 rounded overflow-x-auto text-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
      {data.summary && (
        <div className="mb-6">
          <h3 className="text-xl font-semibold mb-2">Executive Summary</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded overflow-x-auto text-sm whitespace-pre-wrap">
            {data.summary}
          </pre>
        </div>
      )}
      {scenarioTable.length > 1 && (
        <div className="mb-6">
          <h3 className="text-xl font-semibold mb-2">Scenario Comparison Table</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs border border-slate-700">
              <thead>
                <tr>
                  {scenarioTable[0].map((col, i) => (
                    <th key={i} className="px-2 py-1 border-b border-slate-700 bg-slate-800 text-slate-100">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenarioTable.slice(1).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-2 py-1 border-b border-slate-800 text-slate-200">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
