import 'dotenv/config';

export type FredObservation = {
  series: string;
  date: string;
  value: number;
};

const API_URL = 'https://api.stlouisfed.org/fred/series/observations';
const API_KEY = process.env.FRED_API_KEY;

if (!API_KEY) {
  throw new Error('FRED_API_KEY is not set. Add it to your .env file to use the FRED client.');
}

export async function fetchFredSeries(
  seriesId: string,
  startDate: string,
  endDate?: string,
): Promise<FredObservation[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    observation_start: startDate,
    api_key: API_KEY,
    file_type: 'json',
  });
  if (endDate) {
    params.set('observation_end', endDate);
  }

  const response = await fetch(`${API_URL}?${params.toString()}`);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `FRED request failed for ${seriesId}: ${response.status} ${response.statusText} — ${detail}`,
    );
  }

  const payload = (await response.json()) as { observations?: Array<{ date: string; value: string }> };
  const observations = Array.isArray(payload.observations) ? payload.observations : [];

  return observations
    .map((obs) => ({
      series: seriesId,
      date: obs.date,
      raw: obs.value,
    }))
    .filter((obs) => obs.raw !== '.' && obs.raw !== '' && !Number.isNaN(Number(obs.raw)))
    .map((obs) => ({
      series: obs.series,
      date: obs.date,
      value: Number(obs.raw),
    }));
}
