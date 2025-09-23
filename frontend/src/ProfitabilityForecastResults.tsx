import { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export default function ProfitabilityForecastResults() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${import.meta.env.BASE_URL}data/forecast.json`)
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
  let scenarios: any[] = [];
  if (data.forecast && data.forecast.federal_rate && data.forecast.amex) {
    scenarioTable.push([
      "Scenario", "3mo Bal", "3mo NIM", "3mo Profit", "6mo Bal", "6mo NIM", "6mo Profit", "12mo Bal", "12mo NIM", "12mo Profit"
    ]);
    const balances = data.forecast.federal_rate.balances;
    // Federal Rate scenario
    scenarioTable.push([
      "Federal Rate",
      balances[0], data.forecast.federal_rate.nim[0], data.forecast.federal_rate.profit[0],
      balances[1], data.forecast.federal_rate.nim[1], data.forecast.federal_rate.profit[1],
      balances[2], data.forecast.federal_rate.nim[2], data.forecast.federal_rate.profit[2]
    ]);
    // American Express scenario
    scenarioTable.push([
      "American Express",
      balances[0], data.forecast.amex.nim[0], data.forecast.amex.profit[0],
      balances[1], data.forecast.amex.nim[1], data.forecast.amex.profit[1],
      balances[2], data.forecast.amex.nim[2], data.forecast.amex.profit[2]
    ]);
    scenarios = [
      { label: "Federal Rate", ...data.forecast.federal_rate },
      { label: "American Express", ...data.forecast.amex }
    ];
  }

  // Prepare chart data for both scenarios
  let chartData = null;
  let chartHasData = false;
  if (scenarios.length === 2) {
    const months = scenarios[0].months.map((m: number) => `${m} mo`);
    chartHasData = scenarios.some(s => s.profit.some((v: any) => v !== null && v !== 0));
    chartData = {
      labels: months,
      datasets: [
        {
          label: "Profit ($) - Federal Rate",
          data: scenarios[0].profit,
          borderColor: "#006FCF",
          backgroundColor: "rgba(0,111,207,0.2)",
          tension: 0.3,
          fill: true,
        },
        {
          label: "Profit ($) - American Express",
          data: scenarios[1].profit,
          borderColor: "#F59E42",
          backgroundColor: "rgba(245,158,66,0.1)",
          tension: 0.3,
          fill: true,
        },
        {
          label: "NIM (%) - Federal Rate",
          data: scenarios[0].nim,
          borderColor: "#006FCF",
          borderDash: [6, 4],
          backgroundColor: "rgba(0,111,207,0.05)",
          yAxisID: 'y1',
          tension: 0.3,
        },
        {
          label: "NIM (%) - American Express",
          data: scenarios[1].nim,
          borderColor: "#F59E42",
          borderDash: [6, 4],
          backgroundColor: "rgba(245,158,66,0.05)",
          yAxisID: 'y1',
          tension: 0.3,
        },
      ],
    };
  }

  return (
    <section className="mt-16" id="profitability-forecast-results">
      <h2 className="text-2xl font-bold mb-4">Profitability Forecast Results</h2>
      {chartData && chartHasData ? (
        <div className="mb-8">
          <h3 className="text-xl font-semibold mb-2">Forecast Line Chart</h3>
          <Line
            data={chartData}
            options={{
              responsive: true,
              plugins: {
                legend: { position: "top" },
                title: { display: false },
              },
              scales: {
                y: { title: { display: true, text: 'Profit ($)' } },
                y1: {
                  position: 'right',
                  title: { display: true, text: 'NIM (%)' },
                  grid: { drawOnChartArea: false },
                },
              },
            }}
            height={300}
          />
        </div>
      ) : (
        <div className="mb-8 text-amex-blue">No forecast data available for chart.</div>
      )}
      {data.summary && (
        <div className="mb-6">
          <h3 className="text-xl font-semibold mb-2">Executive Summary</h3>
          <div className="bg-slate-900 text-slate-100 p-4 rounded overflow-x-auto text-sm whitespace-pre-wrap prose prose-invert">
            {data.summary}
          </div>
        </div>
      )}
      {scenarioTable.length > 1 ? (
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
      ) : (
        <div className="mb-6 text-amex-blue">No scenario data available.</div>
      )}
    </section>
  );
}
