import type { Narrative as NarrativeType } from '../types';

type Props = {
  narrative: NarrativeType;
};

const Narrative = ({ narrative }: Props) => {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl" aria-labelledby="narrative-title">
      <div className="flex items-baseline justify-between">
        <h3 id="narrative-title" className="text-lg font-semibold text-slate-100">Executive narrative</h3>
        <span className="text-xs text-slate-400">Gemini generated (JSON schema enforced)</span>
      </div>
      <div className="mt-4 space-y-4 text-sm text-slate-200">
        <h4 className="text-xl font-semibold text-slate-100">{narrative.title}</h4>
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Summary</h5>
          <p className="mt-1 text-slate-300">{narrative.summary}</p>
        </div>
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Highlights</h5>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
            {narrative.highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Methodology</h5>
          <p className="mt-1 text-slate-400">{narrative.methodology}</p>
        </div>
      </div>
    </section>
  );
};

export default Narrative;
