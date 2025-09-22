export type SeriesRow = { date: string; value: number };
export type MacroMap = Record<string, SeriesRow[]>;

export const latestValue = (rows: SeriesRow[] | undefined | null): number | null => {
  if (!rows || !rows.length) return null;
  const last = rows
    .map((row) => ({ row, time: new Date(row.date).getTime() }))
    .filter((entry) => Number.isFinite(entry.time) && Number.isFinite(entry.row.value))
    .sort((a, b) => b.time - a.time)[0];
  return last ? Number(last.row.value) : null;
};

export const computeSpreads = (macros: MacroMap | undefined, topHysaApy: number | null) => {
  if (!macros) {
    return {
      Spread_EFFR_minus_SNDR: null,
      Spread_DGS3MO_minus_TopHYSA: null,
      Spread_DGS1_minus_TopHYSA: null,
    };
  }
  const effr = latestValue(macros.EFFR ?? macros.FEDFUNDS);
  const sndr = latestValue(macros.SNDR);
  const dgs3 = latestValue(macros.DGS3MO);
  const dgs1 = latestValue(macros.DGS1);
  const top = Number.isFinite(topHysaApy ?? NaN) ? Number(topHysaApy) : null;

  return {
    Spread_EFFR_minus_SNDR: effr !== null && sndr !== null ? effr - sndr : null,
    Spread_DGS3MO_minus_TopHYSA: dgs3 !== null && top !== null ? dgs3 - top : null,
    Spread_DGS1_minus_TopHYSA: dgs1 !== null && top !== null ? dgs1 - top : null,
  };
};
