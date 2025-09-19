export interface SeriesPoint {
  date: string;
  value: number;
}

export interface SeriesBundle {
  fed_effective: SeriesPoint[];
  peer_median_hysa: SeriesPoint[];
  peer_p75_hysa: SeriesPoint[];
  bank_apys: Record<string, SeriesPoint[]>;
}

export interface LeagueRow {
  bank: string;
  apy: number;
  promo: boolean;
  delta_7d_bps: number;
  delta_30d_bps: number;
  source_urls: {
    aggregator: string;
    official: string;
  };
}

export interface ForecastSeries {
  p10: number[];
  p50: number[];
  p90: number[];
}

export interface Forecasts {
  horizons: string[];
  assumptions: {
    beta: number;
    elasticity: number;
    note: string;
  };
  scenarios: Record<
    string,
    {
      fed_path: number[];
      description: string;
    }
  >;
  metrics: {
    cost_of_funds: ForecastSeries;
    deposit_volume: ForecastSeries;
    nim: ForecastSeries;
  };
}

export interface Narrative {
  title: string;
  highlights: string[];
  benchmarking: string;
  forecast_insights: string;
  recommendations: string;
  risks: string;
  compliance_block: string;
}

export interface AuditRecord {
  name: string;
  url: string;
}

export interface DiscrepancyRecord {
  bank: string;
  aggregator_apy: number;
  official_apy: number;
  note: string;
}

export interface LatestData {
  as_of: string;
  primary_bank: string;
  banks_tracked: string[];
  series: SeriesBundle;
  benchmark_snapshot: {
    leader: { bank: string; apy: number };
    peer_median: number;
    peer_p75: number;
    amex: {
      apy: number;
      rank: number;
      spread_to_median_bps: number;
    };
  };
  league_table: LeagueRow[];
  forecasts: Forecasts;
  narrative: Narrative;
  audit: {
    sources: AuditRecord[];
    discrepancies: DiscrepancyRecord[];
    data_freshness: {
      competitor_rates: string;
      fed_series: string;
    };
  };
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
