import { useEffect, useMemo, useState } from "react";

export type MacroSeriesMap = Record<string, Array<{ date: string; value: number }>>;

export type PeerHistory = {
  banks: Array<{ id: string; name: string }>;
  series: Record<string, Array<{ date: string; value: number }>>;
  peer_median_series?: Array<{ date: string; value: number }>;
  peer_p75_series?: Array<{ date: string; value: number }>;
};

type SeriesPoint = { date: Date; value: number };

type Props = {
  macros: MacroSeriesMap | undefined;
  history: PeerHistory | undefined;
};

type HoverEntry = { label: string; color: string; value: number | null };

type LineSeries = {
  id: string;
  label: string;
  color: string;
  points: SeriesPoint[];
  dashed?: boolean;
};

const COLORS = [
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#a855f7",
  "#f97316",
  "#f472b6",
  "#22d3ee",
  "#60a5fa",
];

const toSeries = (rows?: Array<{ date: string; value: number }>, min?: number, max?: number): SeriesPoint[] => {
  if (!rows) return [];
  const points = rows
    .map(({ date, value }) => ({ date: new Date(date), value: Number(value) }))
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.date.getTime()))
    .filter((point) => (min === undefined || point.date.getTime() >= min))
    .filter((point) => (max === undefined || point.date.getTime() <= max))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (points.length === 1 && min !== undefined) {
    const anchor = new Date(min);
    if (anchor.getTime() !== points[0].date.getTime()) {
      points.unshift({ date: anchor, value: points[0].value });
    }
  }
  return points;
};

const formatPercent = (value: number | null, digits = 2) =>
  value === null || Number.isNaN(value) ? "—" : `${value.toFixed(digits)}%`;

const PeerComparisonChart = ({ macros, history }: Props) => {
  const hasData = Boolean(macros && history);
  const today = useMemo(() => new Date(), []);
  const minDate = useMemo(() => {
    const d = new Date(today);
    d.setFullYear(today.getFullYear() - 10);
    return d;
  }, [today]);

  const baselineSeries: LineSeries[] = useMemo(() => {
    const fed = toSeries(macros?.EFFR ?? macros?.FEDFUNDS, minDate.getTime(), today.getTime());
    const peerMedian = toSeries(history?.peer_median_series, minDate.getTime(), today.getTime());
    const peerP75 = toSeries(history?.peer_p75_series, minDate.getTime(), today.getTime());
    return [
      { id: "fed", label: "Fed effective rate", color: "#38bdf8", points: fed },
      { id: "peer_median", label: "Peer median", color: "#34d399", points: peerMedian },
      { id: "peer_p75", label: "Peer 75th percentile", color: "#fbbf24", points: peerP75, dashed: true },
    ];
  }, [macros, history, minDate, today]);

  const [selectedPeers, setSelectedPeers] = useState<string[]>([]);
  useEffect(() => {
    if (!history?.banks?.length) return;
    setSelectedPeers((prev) => {
      if (prev.length) {
        return prev.filter((id) => history.banks.some((bank) => bank.id === id));
      }
      const prioritized = history.banks.slice(0, 5);
      const amex = history.banks.find((bank) => /american-express/i.test(bank.name));
      const seed = amex
        ? [amex.id, ...prioritized.filter((bank) => bank.id !== amex.id).map((bank) => bank.id)]
        : prioritized.map((bank) => bank.id);
      return seed.slice(0, 4);
    });
  }, [history]);

  const competitorSeries: LineSeries[] = useMemo(() => {
    if (!history) return [];
    return selectedPeers.map((id, index) => ({
      id,
      label: history.banks.find((bank) => bank.id === id)?.name ?? id,
      color: COLORS[(index + baselineSeries.length) % COLORS.length],
      points: toSeries(history.series[id], minDate.getTime(), today.getTime()),
    }));
  }, [history, selectedPeers, baselineSeries.length, minDate, today]);

  const allSeries = useMemo(() => [...baselineSeries, ...competitorSeries], [baselineSeries, competitorSeries]);
  const allDates = useMemo(() => {
    const set = new Set<number>();
    allSeries.forEach((series) => series.points.forEach((point) => set.add(point.date.getTime())));
    return [...set].sort((a, b) => a - b).map((time) => new Date(time));
  }, [allSeries]);

  const yValues = useMemo(() => {
    const values: number[] = [];
    allSeries.forEach((series) => series.points.forEach((point) => values.push(point.value)));
    return values.length ? values : [0, 1];
  }, [allSeries]);

  const width = 920;
  const height = 380;
  const margin = { top: 36, right: 28, bottom: 52, left: 80 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xMin = allDates[0]?.getTime() ?? minDate.getTime();
  const xMax = allDates[allDates.length - 1]?.getTime() ?? today.getTime();
  const yMin = Math.min(...yValues) - 0.25;
  const yMax = Math.max(...yValues) + 0.25;

  const scaleX = (date: Date) => margin.left + ((date.getTime() - xMin) / Math.max(1, xMax - xMin)) * innerWidth;
  const scaleY = (value: number) => margin.top + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * innerHeight;

  const buildPath = (points: SeriesPoint[]) =>
    points
      .map((point, index) => `${index === 0 ? "M" : "L"}${scaleX(point.date)} ${scaleY(point.value)}`)
      .join(" ");

  const [showFed, setShowFed] = useState(true);
  const [showPeers, setShowPeers] = useState(true);
  const [hover, setHover] = useState<{ x: number; date: Date; entries: HoverEntry[] } | null>(null);

  const togglePeer = (id: string) => {
    setSelectedPeers((prev) => (prev.includes(id) ? prev.filter((peer) => peer !== id) : [...prev, id]));
  };

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!allDates.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = event.clientX - rect.left - margin.left;
    const clampedX = Math.min(innerWidth, Math.max(0, relativeX));
    const ratio = innerWidth > 0 ? clampedX / innerWidth : 0;
    const target = xMin + ratio * (xMax - xMin);
    const nearest = allDates.reduce((prev, curr) =>
      Math.abs(curr.getTime() - target) < Math.abs(prev.getTime() - target) ? curr : prev,
    allDates[0]);

    const entries: HoverEntry[] = [];
    const lookup = (series: SeriesPoint[]) => series.find((pt) => pt.date.getTime() === nearest.getTime())?.value ?? null;

    allSeries.forEach((series) => {
      const isBaselineFed = series.id === "fed";
      const isBaselinePeer = series.id === "peer_median" || series.id === "peer_p75";
      if (!showFed && isBaselineFed) return;
      if (!showPeers && isBaselinePeer) return;
      entries.push({ label: series.label, color: series.color, value: lookup(series.points) });
    });

    setHover({ x: scaleX(nearest), date: nearest, entries });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={showFed} onChange={(event) => setShowFed(event.target.checked)} /> Show Fed
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={showPeers} onChange={(event) => setShowPeers(event.target.checked)} /> Show peers
        </label>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-slate-300">
        <p className="self-center text-[0.7rem] uppercase tracking-wide text-slate-500">Peers</p>
        <div className="flex flex-wrap gap-2">
          {(history?.banks ?? []).map((bank, index) => {
            const active = selectedPeers.includes(bank.id);
            const color = COLORS[(index + baselineSeries.length) % COLORS.length];
            return (
              <button
                key={bank.id}
                type="button"
                onClick={() => togglePeer(bank.id)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 transition ${
                  active
                    ? "border border-transparent bg-slate-800 text-slate-50"
                    : "border border-slate-700 bg-slate-900 text-slate-500 hover:border-slate-600 hover:text-slate-300"
                }`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {bank.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
        {!hasData ? (
          <p className="text-xs text-slate-500">Run `npm run macro` and `npm run peers` to populate chart data.</p>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Fed versus peers over ten years"
            className="h-auto w-full select-none"
            onPointerMove={handlePointer}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="chartBackground" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(15,23,42,0.95)" />
                <stop offset="100%" stopColor="rgba(2,6,23,0.8)" />
              </linearGradient>
            </defs>
            <rect x={0} y={0} width={width} height={height} fill="transparent" />
            <rect x={margin.left} y={margin.top} width={innerWidth} height={innerHeight} rx={12} fill="url(#chartBackground)" stroke="rgba(148,163,184,0.15)" />

            {Array.from({ length: 5 }).map((_, index) => {
              const value = yMin + ((yMax - yMin) / 4) * index;
              const y = scaleY(value);
              return (
                <g key={`y-${index}`}>
                  <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke="rgba(148,163,184,0.12)" strokeDasharray="4 6" />
                  <text x={margin.left - 12} y={y + 4} textAnchor="end" fill="rgba(148,163,184,0.7)" fontSize={11}>
                    {value.toFixed(2)}%
                  </text>
                </g>
              );
            })}

            {Array.from({ length: 6 }).map((_, index) => {
              const ratio = index / 5;
              const time = xMin + ratio * (xMax - xMin);
              const date = new Date(time);
              const x = scaleX(date);
              return (
                <g key={`x-${index}`}>
                  <line x1={x} y1={margin.top} x2={x} y2={height - margin.bottom} stroke="rgba(148,163,184,0.08)" />
                  <text x={x} y={height - margin.bottom + 20} textAnchor="middle" fill="rgba(148,163,184,0.6)" fontSize={11}>
                    {date.getFullYear()}
                  </text>
                </g>
              );
            })}

            {allSeries.map((series) => {
              const isFed = series.id === "fed";
              const isPeerLine = series.id === "peer_median" || series.id === "peer_p75";
              if (!showFed && isFed) return null;
              if (!showPeers && isPeerLine) return null;

              if (series.points.length > 1) {
                return (
                  <g key={series.id}>
                    <path
                      d={buildPath(series.points)}
                      fill="none"
                      stroke={series.color}
                      strokeWidth={series.id === "peer_median" ? 3 : 2.5}
                      strokeDasharray={series.dashed ? "6 4" : undefined}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {series.points.map((point, index) => (
                      <circle
                        key={`${series.id}-${index}`}
                        cx={scaleX(point.date)}
                        cy={scaleY(point.value)}
                        r={3}
                        fill={series.color}
                        opacity={0.7}
                      />
                    ))}
                  </g>
                );
              }

              return series.points.map((point, index) => (
                <circle
                  key={`${series.id}-${index}`}
                  cx={scaleX(point.date)}
                  cy={scaleY(point.value)}
                  r={5}
                  fill={series.color}
                  opacity={0.7}
                />
              ));
            })}

            {hover && (
              <g>
                <line x1={hover.x} y1={margin.top} x2={hover.x} y2={height - margin.bottom} stroke="rgba(148,163,184,0.3)" strokeWidth={1} />
                <rect
                  x={Math.min(hover.x + 16, width - 220)}
                  y={margin.top + 16}
                  width={210}
                  height={hover.entries.length * 18 + 42}
                  rx={12}
                  fill="rgba(15,23,42,0.96)"
                  stroke="rgba(148,163,184,0.2)"
                />
                <text x={Math.min(hover.x + 28, width - 200)} y={margin.top + 36} fill="#e2e8f0" fontSize={12} fontWeight={600}>
                  {hover.date.toLocaleDateString()}
                </text>
                {hover.entries.map((entry, index) => (
                  <text
                    key={entry.label}
                    x={Math.min(hover.x + 28, width - 200)}
                    y={margin.top + 56 + index * 18}
                    fill={entry.color}
                    fontSize={11}
                  >
                    {entry.label}: {formatPercent(entry.value)}
                  </text>
                ))}
              </g>
            )}
          </svg>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-[0.7rem] text-slate-400">
        {baselineSeries.map((series) => (
          <span key={series.id} className="inline-flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: series.color }} />
            {series.label}
          </span>
        ))}
        {competitorSeries.map((series) => (
          <span key={series.id} className="inline-flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: series.color }} />
            {series.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export default PeerComparisonChart;
