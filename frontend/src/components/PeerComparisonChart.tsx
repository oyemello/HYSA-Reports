import { useEffect, useMemo, useRef, useState } from "react";

type SeriesPoint = { date: Date; value: number };

export type MacroSeriesMap = Record<string, Array<{ date: string; value: number }>>;

export type PeerHistory = {
  banks: Array<{ id: string; name: string }>;
  series: Record<string, Array<{ date: string; value: number }>>;
  peer_median_series?: Array<{ date: string; value: number }>;
  peer_p75_series?: Array<{ date: string; value: number }>;
};

type Props = {
  macros: MacroSeriesMap | undefined;
  history: PeerHistory | undefined;
};

type HoverState = {
  x: number;
  date: Date;
  entries: Array<{ label: string; value: number | null }>;
};

const toSeries = (rows?: Array<{ date: string; value: number }>, minTime?: number, maxTime?: number): SeriesPoint[] => {
  if (!rows) return [];
  return rows
    .map(({ date, value }) => ({ date: new Date(date), value: Number(value) }))
    .filter((pt) => Number.isFinite(pt.value) && Number.isFinite(pt.date.getTime()))
    .filter((pt) => (minTime !== undefined ? pt.date.getTime() >= minTime : true))
    .filter((pt) => (maxTime !== undefined ? pt.date.getTime() <= maxTime : true))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
};

const formatPercent = (value: number | null) => (value === null ? "—" : `${value.toFixed(2)}%`);

const PeerComparisonChart = ({ macros, history }: Props) => {
  const today = useMemo(() => new Date(), []);
  const minDate = useMemo(() => {
    const d = new Date(today);
    d.setFullYear(today.getFullYear() - 10);
    return d;
  }, [today]);
  const fedSeries = useMemo(() => {
    const macroSeries = macros?.EFFR ?? macros?.FEDFUNDS ?? [];
    return toSeries(macroSeries, minDate.getTime(), today.getTime());
  }, [macros, minDate, today]);

  const peerMedianSeries = useMemo(
    () => toSeries(history?.peer_median_series, minDate.getTime(), today.getTime()),
    [history, minDate, today],
  );
  const peerP75Series = useMemo(
    () => toSeries(history?.peer_p75_series, minDate.getTime(), today.getTime()),
    [history, minDate, today],
  );

  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  useEffect(() => {
    if (history?.banks?.length) {
      setSelectedBank((prev) => prev ?? history.banks[0]?.id ?? null);
    }
  }, [history]);

  const competitorSeries = useMemo(() => {
    if (!selectedBank) return [];
    return toSeries(history?.series?.[selectedBank], minDate.getTime(), today.getTime());
  }, [history, selectedBank, minDate, today]);

  const allPoints = useMemo(() => {
    const all = new Set<number>();
    [fedSeries, peerMedianSeries, peerP75Series, competitorSeries].forEach((series) =>
      series.forEach((pt) => all.add(pt.date.getTime())),
    );
    return [...all].sort((a, b) => a - b).map((time) => new Date(time));
  }, [competitorSeries, fedSeries, peerMedianSeries, peerP75Series]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [showFed, setShowFed] = useState(true);
  const [showPeers, setShowPeers] = useState(true);
  const [showCompetitor, setShowCompetitor] = useState(true);

  const width = 840;
  const height = 360;
  const margin = { top: 32, right: 24, bottom: 48, left: 72 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xTimes = useMemo(() => {
    const times = allPoints.length ? allPoints : fedSeries.map((pt) => pt.date);
    return times.length ? times : [minDate, today];
  }, [allPoints, fedSeries, minDate, today]);

  const yValues = useMemo(() => {
    const values: number[] = [];
    [fedSeries, peerMedianSeries, peerP75Series, competitorSeries].forEach((series) =>
      series.forEach((pt) => values.push(pt.value)),
    );
    return values.length ? values : [0, 1];
  }, [competitorSeries, fedSeries, peerMedianSeries, peerP75Series]);

  const yMin = Math.min(...yValues) - 0.25;
  const yMax = Math.max(...yValues) + 0.25;
  const xMin = xTimes[0]?.getTime() ?? minDate.getTime();
  const xMax = xTimes[xTimes.length - 1]?.getTime() ?? today.getTime();

  const scaleX = (date: Date) =>
    margin.left + ((date.getTime() - xMin) / Math.max(1, xMax - xMin)) * innerWidth;
  const scaleY = (value: number) => margin.top + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * innerHeight;

  const buildPath = (series: SeriesPoint[]) =>
    series
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${scaleX(point.date)} ${scaleY(point.value)}`)
      .join(' ');

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const handlePointer = (event: PointerEvent) => {
      const rect = svgEl.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const ratio = Math.min(1, Math.max(0, (x - margin.left) / innerWidth));
      const targetTime = xMin + ratio * (xMax - xMin);
      const nearest = allPoints.reduce((prev, current) =>
        Math.abs(current.getTime() - targetTime) < Math.abs(prev.getTime() - targetTime) ? current : prev,
      allPoints[0] ?? new Date(targetTime));

      const entries: Array<{ label: string; value: number | null }> = [];
      const lookup = (series: SeriesPoint[]) => series.find((pt) => pt.date.getTime() === nearest.getTime())?.value ?? null;
      if (showFed) entries.push({ label: 'Fed Effective Rate', value: lookup(fedSeries) });
      if (showPeers) {
        entries.push({ label: 'Peer Median', value: lookup(peerMedianSeries) });
        entries.push({ label: 'Peer 75th', value: lookup(peerP75Series) });
      }
      if (showCompetitor && selectedBank) {
        const label = history?.banks.find((bank) => bank.id === selectedBank)?.name ?? 'Competitor';
        entries.push({ label, value: lookup(competitorSeries) });
      }
      setHover({ x: scaleX(nearest), date: nearest, entries });
    };

    const reset = () => setHover(null);
    svgEl.addEventListener('pointermove', handlePointer);
    svgEl.addEventListener('pointerleave', reset);
    return () => {
      svgEl.removeEventListener('pointermove', handlePointer);
      svgEl.removeEventListener('pointerleave', reset);
    };
  }, [allPoints, competitorSeries, fedSeries, history, innerWidth, margin.left, selectedBank, showCompetitor, showFed, showPeers, xMax, xMin]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={showFed} onChange={(event) => setShowFed(event.target.checked)} />
          Show Fed effective rate
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={showPeers} onChange={(event) => setShowPeers(event.target.checked)} />
          Show peer medians
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showCompetitor}
            onChange={(event) => setShowCompetitor(event.target.checked)}
            disabled={!history?.banks?.length}
          />
          Show competitor
        </label>
        <label className="ml-auto inline-flex items-center gap-2 text-xs">
          Competitor
          <select
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            value={selectedBank ?? ''}
            onChange={(event) => setSelectedBank(event.target.value || null)}
            disabled={!history?.banks?.length}
          >
            {(history?.banks ?? []).map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Fed vs peers comparison chart" className="h-auto w-full">
          <defs>
            <clipPath id="chart-clip">
              <rect x={margin.left} y={margin.top} width={innerWidth} height={innerHeight} rx={8} />
            </clipPath>
          </defs>
          <rect x={margin.left} y={margin.top} width={innerWidth} height={innerHeight} rx={8} fill="url(#chart-bg)" />
          <defs>
            <linearGradient id="chart-bg" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(20,33,61,0.8)" />
              <stop offset="100%" stopColor="rgba(15,23,42,0.6)" />
            </linearGradient>
          </defs>
          <g stroke="rgba(148, 163, 184, 0.2)" strokeWidth={1} fill="none">
            <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} />
            <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} />
            {Array.from({ length: 5 }).map((_, index) => {
              const value = yMin + ((yMax - yMin) / 4) * index;
              const y = scaleY(value);
              return (
                <g key={index}>
                  <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} strokeDasharray="3 6" />
                  <text x={margin.left - 10} y={y + 4} textAnchor="end" fill="rgba(148, 163, 184, 0.7)" fontSize="11">
                    {value.toFixed(2)}%
                  </text>
                </g>
              );
            })}
            {xTimes.map((date) => (
              <g key={date.toISOString()}>
                <line
                  x1={scaleX(date)}
                  y1={height - margin.bottom}
                  x2={scaleX(date)}
                  y2={height - margin.bottom + 6}
                  stroke="rgba(148, 163, 184, 0.3)"
                />
                <text
                  x={scaleX(date)}
                  y={height - margin.bottom + 22}
                  textAnchor="middle"
                  fill="rgba(148, 163, 184, 0.65)"
                  fontSize="11"
                >
                  {date.getFullYear()}
                </text>
              </g>
            ))}
          </g>

          <g clipPath="url(#chart-clip)">
            {showPeers && peerMedianSeries.length > 1 && (
              <path d={buildPath(peerMedianSeries)} fill="none" stroke="#34d399" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {showPeers && peerP75Series.length > 1 && (
              <path d={buildPath(peerP75Series)} fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6 4" />
            )}
            {showCompetitor && competitorSeries.length > 1 && (
              <path d={buildPath(competitorSeries)} fill="none" stroke="#818cf8" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {showFed && fedSeries.length > 1 && (
              <path d={buildPath(fedSeries)} fill="none" stroke="#0ea5e9" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            )}
          </g>

          {hover && (
            <g>
              <line x1={hover.x} x2={hover.x} y1={margin.top} y2={height - margin.bottom} stroke="rgba(148,163,184,0.4)" strokeWidth={1} strokeDasharray="4 6" />
              <rect
                x={hover.x + 12}
                y={margin.top + 12}
                rx={8}
                width={220}
                height={hover.entries.length * 18 + 32}
                fill="rgba(15, 23, 42, 0.94)"
                stroke="rgba(148, 163, 184, 0.3)"
              />
              <text x={hover.x + 24} y={margin.top + 32} fill="#e2e8f0" fontSize="12">
                {hover.date.toLocaleDateString()}
              </text>
              {hover.entries.map((entry, index) => (
                <text key={entry.label} x={hover.x + 24} y={margin.top + 52 + index * 18} fill="#cbd5f5" fontSize="11">
                  {entry.label}: {formatPercent(entry.value)}
                </text>
              ))}
            </g>
          )}
        </svg>
      </div>
      <div className="flex flex-wrap gap-3 text-[0.7rem] text-slate-400">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-sky-400" /> Fed effective rate
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> Peer median
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-300" /> Peer 75th percentile
        </span>
        {showCompetitor && selectedBank && (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-300" />
            {history?.banks.find((bank) => bank.id === selectedBank)?.name ?? 'Competitor'}
          </span>
        )}
      </div>
    </div>
  );
};

export default PeerComparisonChart;
