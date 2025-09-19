import { useEffect } from 'react';
import ComplianceBlock from './components/ComplianceBlock';
import DownloadPDFButton from './components/DownloadPDFButton';
import ForecastCards from './components/ForecastCards';
import LeagueTable from './components/LeagueTable';
import Narrative from './components/Narrative';
import Onboarding from './components/Onboarding';
import RateChart from './components/RateChart';
import ScenarioPanel from './components/ScenarioPanel';
import { useDashboardStore } from './state/store';

const App = () => {
  const {
    data,
    status,
    error,
    selectedBanks,
    showFed,
    onboardingComplete,
    primaryBank,
    actions,
  } = useDashboardStore((state) => ({
    data: state.data,
    status: state.status,
    error: state.error,
    selectedBanks: state.selectedBanks,
    showFed: state.showFed,
    onboardingComplete: state.onboardingComplete,
    primaryBank: state.primaryBank,
    actions: state.actions,
  }));

  useEffect(() => {
    if (status === 'idle') {
      actions.initialize();
    }
  }, [actions, status]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <img src="/dls-logo-bluebox-solid.svg" alt="HYSA Bench logo" className="h-10 w-auto" />
            <div>
              <h1 className="text-xl font-semibold">HYSA Benchmarking Hub</h1>
              <p className="text-xs text-slate-400">American Express High Yield Savings vs. national peers</p>
            </div>
          </div>
          <DownloadPDFButton targetId="report-root" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8" id="report-root">
        {status === 'loading' && (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/70">
            <p className="text-sm text-slate-300">Loading latest benchmark snapshot…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-100">
            Failed to load dashboard data: {error}
          </div>
        )}

        {status === 'ready' && data && (
          <>
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl" aria-label="Benchmark summary">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">As of</p>
                  <p className="text-lg font-semibold text-primary">{new Date(data.as_of).toLocaleString()}</p>
                </div>
                <div className="text-right text-sm text-slate-300">
                  <p>Peer median: {data.benchmark_snapshot.peer_median.toFixed(2)}%</p>
                  <p>Peer p75: {data.benchmark_snapshot.peer_p75.toFixed(2)}%</p>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-right text-sm text-emerald-200">
                  <p className="font-semibold text-emerald-300">{primaryBank}</p>
                  <p>{data.benchmark_snapshot.amex.apy.toFixed(2)}% APY</p>
                  <p className="text-xs text-emerald-200/80">Spread vs median: {data.benchmark_snapshot.amex.spread_to_median_bps} bps</p>
                </div>
              </div>
            </section>

            <RateChart
              data={data}
              selectedBanks={selectedBanks}
              showFed={showFed}
              onToggleBank={actions.toggleBank}
              onClearBanks={actions.clearBankFilters}
              onToggleFed={actions.setShowFed}
            />

            <LeagueTable rows={data.league_table} primaryBank={primaryBank} />

            <ForecastCards forecasts={data.forecasts} />

            <ScenarioPanel scenarios={data.forecasts.scenarios} horizons={data.forecasts.horizons} />

            <Narrative narrative={data.narrative} />

            <ComplianceBlock audit={data.audit} asOf={data.as_of} />
          </>
        )}
      </main>

      {status === 'ready' && data && !onboardingComplete && (
        <Onboarding
          onContinue={actions.completeOnboarding}
          primaryBank={`${primaryBank} High Yield Savings`}
          llmProvider="Gemini"
        />
      )}
    </div>
  );
};

export default App;
