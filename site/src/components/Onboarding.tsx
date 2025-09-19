import { useState } from 'react';

type Props = {
  onContinue: () => void;
  primaryBank: string;
  llmProvider: string;
};

const Onboarding = ({ onContinue, primaryBank, llmProvider }: Props) => {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-100">Welcome to the HYSA Benchmark POC</h2>
        <p className="mt-2 text-sm text-slate-300">
          Configure the two required onboarding choices. These settings are stored locally for this session only.
        </p>
        <form className="mt-4 space-y-4" onSubmit={(event) => event.preventDefault()}>
          <label className="block text-sm text-slate-300">
            <span className="mb-1 block font-medium text-slate-200">Primary bank</span>
            <select className="w-full rounded-md border border-slate-600 bg-slate-800 p-2 text-slate-100" defaultValue={primaryBank} disabled>
              <option>{primaryBank} High Yield Savings</option>
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              American Express is pre-selected for this proof of concept.
            </span>
          </label>
          <label className="block text-sm text-slate-300">
            <span className="mb-1 block font-medium text-slate-200">LLM provider</span>
            <select className="w-full rounded-md border border-slate-600 bg-slate-800 p-2 text-slate-100" defaultValue={llmProvider} disabled>
              <option>{llmProvider}</option>
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              API key is managed in CI via GitHub Actions secret; no key is stored client-side.
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="size-4 rounded border border-slate-600 bg-slate-800"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I understand that secrets are handled in GitHub Actions only.</span>
          </label>
          <button
            type="button"
            className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
            onClick={onContinue}
            disabled={!acknowledged}
            aria-disabled={!acknowledged}
          >
            Enter dashboard
          </button>
        </form>
      </div>
    </div>
  );
};

export default Onboarding;
