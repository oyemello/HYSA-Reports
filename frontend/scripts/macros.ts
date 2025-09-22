import { fetchFredSeries, type FredObservation } from './fred.js';

const SERIES_IDS = ['EFFR', 'DGS3MO', 'DGS1', 'SNDR', 'NDR12MCD'] as const;
export type MacroSeriesId = typeof SERIES_IDS[number];

export type MacroBundle = Record<MacroSeriesId, FredObservation[]>;

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function getMacroBundle(): Promise<MacroBundle> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setFullYear(endDate.getFullYear() - 10);

  const start = formatDate(startDate);
  const end = formatDate(endDate);

  const results = await Promise.all(
    SERIES_IDS.map(async (seriesId) => {
      try {
        return await fetchFredSeries(seriesId, start, end);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to fetch ${seriesId}: ${message}`);
      }
    }),
  );

  return SERIES_IDS.reduce<MacroBundle>((acc, seriesId, index) => {
    acc[seriesId] = results[index];
    return acc;
  }, Object.create(null));
}
