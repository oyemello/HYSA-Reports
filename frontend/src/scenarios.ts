export type ForecastHorizon = {
  months: number;
  p50: number;
  low: number;
  high: number;
  deposit_index?: number;
  nim?: number;
};

export type ScenarioRow = {
  months: number;
  value: number;
  low: number;
  high: number;
  deposit_index?: number;
  nim?: number;
};

export type ScenarioResult = Record<'baseline' | 'hawkish' | 'dovish', ScenarioRow[]>;

export type ScenarioConfig = {
  scenario_adjustments?: {
    hawkish_bps?: Record<string, number>;
    dovish_bps?: Record<string, number>;
  };
};

const adjustmentFor = (config: ScenarioConfig, scenario: 'hawkish_bps' | 'dovish_bps', months: number) => {
  const table = config.scenario_adjustments?.[scenario];
  if (!table) return scenario === 'hawkish_bps' ? 0.15 : -0.15;
  const value = table[String(months)];
  if (typeof value !== 'number' || Number.isNaN(value)) return scenario === 'hawkish_bps' ? 0.15 : -0.15;
  return value;
};

const shiftRow = (row: ForecastHorizon, delta: number): ScenarioRow => ({
  months: row.months,
  value: Number((row.p50 + delta).toFixed(3)),
  low: Number((row.low + delta).toFixed(3)),
  high: Number((row.high + delta).toFixed(3)),
  deposit_index: row.deposit_index,
  nim: row.nim !== undefined ? Number((row.nim - delta).toFixed(3)) : undefined,
});

export const buildScenarios = (horizons: ForecastHorizon[], config: ScenarioConfig = {}): ScenarioResult => {
  const baseline = horizons.map((row) => ({
    months: row.months,
    value: Number(row.p50.toFixed(3)),
    low: Number(row.low.toFixed(3)),
    high: Number(row.high.toFixed(3)),
    deposit_index: row.deposit_index,
    nim: row.nim,
  }));

  const hawkish = horizons.map((row) => {
    const delta = adjustmentFor(config, 'hawkish_bps', row.months);
    return shiftRow(row, delta);
  });

  const dovish = horizons.map((row) => {
    const delta = adjustmentFor(config, 'dovish_bps', row.months);
    return shiftRow(row, delta);
  });

  return { baseline, hawkish, dovish };
};
