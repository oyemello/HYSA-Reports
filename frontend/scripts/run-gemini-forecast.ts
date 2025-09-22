#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MACRO_PATH = path.resolve(here, '../public/macro.json');
const HYSA_PATH = path.resolve(here, '../public/hysa.json');
const OUTPUT_PATH = path.resolve(here, '../public/forecast.json');

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const stddev = (values: number[]) => {
  if (!values.length) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};
const latest = (rows?: Array<{ date: string; value: number }>) => {
  if (!rows?.length) return null;
  return rows
    .map((row) => ({ time: new Date(row.date).getTime(), value: Number(row.value) }))
    .filter((entry) => Number.isFinite(entry.time) && Number.isFinite(entry.value))
    .sort((a, b) => b.time - a.time)[0]?.value ?? null;
};
const lastNDays = (rows: Array<{ date: string; value: number }>, days: number) => {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows
    .filter((row) => new Date(row.date).getTime() >= cutoff)
    .map((row) => Number(row.value))
    .filter((v) => Number.isFinite(v));
};

async function loadJson(file: string) {
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text);
}

function heuristicsForecast(macro: any, hysa: any) {
  const macros = macro?.macros ?? {};
  const effrSeries = macros.EFFR ?? macros.FEDFUNDS ?? [];
  const dgs3Series = macros.DGS3MO ?? [];
  const dgs1Series = macros.DGS1 ?? [];
  const sndrSeries = macros.SNDR ?? [];
  const topRow = Array.isArray(hysa?.rows) ? hysa.rows.reduce((acc: any, row: any) => (parseFloat(row.apy) > parseFloat(acc?.apy ?? -Infinity) ? row : acc), null) : null;
  const currentTop = topRow ? Number(topRow.apy) : null;
  const currentDgs3 = latest(dgs3Series);
  const currentDgs1 = latest(dgs1Series);
  const avg6Dgs3 = (() => {
    const subset = lastNDays(dgs3Series, 180);
    return subset.length ? subset.reduce((sum, v) => sum + v, 0) / subset.length : currentDgs3;
  })();
  const avg6Dgs1 = (() => {
    const subset = lastNDays(dgs1Series, 180);
    return subset.length ? subset.reduce((sum, v) => sum + v, 0) / subset.length : currentDgs1;
  })();
  const std3 = clamp(stddev(lastNDays(dgs3Series, 90)), 0.15, 0.35);
  const std1 = clamp(stddev(lastNDays(dgs1Series, 90)), 0.15, 0.35);

  const project = (current: number | null, mean: number | null, weight: number) => {
    if (current === null || mean === null) return null;
    return current + weight * (mean - current);
  };
  const projected3 = project(currentDgs3, avg6Dgs3, 0.55);
  const projected6 = project(currentDgs1, avg6Dgs1, 0.65);
  const projected12 = project(currentDgs1, avg6Dgs1, 0.8);

  const delta = (projected: number | null, current: number | null) => (projected !== null && current !== null ? projected - current : null);
  const delta3 = delta(projected3, currentDgs3);
  const delta6 = delta(projected6, currentDgs1);
  const delta12 = delta(projected12, currentDgs1);

  const top = Number.isFinite(currentTop ?? NaN) ? Number(currentTop) : currentDgs3 ?? currentDgs1 ?? 0;
  const multShort = 0.45;
  const multMed = 0.5;
  const forecastValue = (months: number) => {
    if (months === 3 && delta3 !== null) return top + multShort * delta3;
    if (months === 6 && delta6 !== null) return top + multMed * delta6;
    if (months === 12 && delta12 !== null) return top + multMed * delta12;
    return top;
  };
  const assetYield = (() => {
    const base = currentDgs1 ?? currentDgs3 ?? top;
    const spread = Number.isFinite(macro?.features?.Spread_EFFR_minus_SNDR) ? macro.features.Spread_EFFR_minus_SNDR : 0;
    return base + spread;
  })();

  const computeBand = (months: number, p50: number) => {
    const band = months === 3 ? std3 : std1;
    const range = clamp(band, 0.15, 0.35);
    return { low: Math.max(p50 - range, 0), high: p50 + range };
  };

  const depositIndex = (p50: number) => (top > 0 ? (100 * top) / p50 : 100);
  const nim = (p50: number) => assetYield - p50;

  const horizons = [3, 6, 12].map((months) => {
    const p50 = Number(forecastValue(months).toFixed(3));
    const { low, high } = computeBand(months, p50);
    return {
      months,
      p50,
      low: Number(low.toFixed(3)),
      high: Number(high.toFixed(3)),
      deposit_index: Number(depositIndex(p50).toFixed(2)),
      nim: Number(nim(p50).toFixed(3)),
    };
  });

  return { as_of: new Date().toISOString(), horizons, method: 'rules+gemini-v1', meta: { baseline_top_hysa: top, current_dgs3: currentDgs3, current_dgs1: currentDgs1 } };
}

async function refineWithGemini(payload: any, macro: any, hysa: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ...payload, method: 'rules-v1' };
  const body = {
    contents: [
      {
        parts: [
          {
            text: `You are reviewing HYSA forecasts. Provided data: ${JSON.stringify({ macro_summary: { latest_dgs3: payload.meta.current_dgs3, latest_dgs1: payload.meta.current_dgs1 }, spreads: macro.features ?? {}, top_hysa: payload.meta.baseline_top_hysa, horizons: payload.horizons }, null, 2)}\n\nReturn JSON with same shape {horizons:[...]} but adjusted within ±0.10 percentage points if needed.`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned empty response');
    const refined = JSON.parse(text);
    if (!Array.isArray(refined?.horizons)) throw new Error('Gemini response missing horizons');
    const merged = payload.horizons.map((h: any) => {
      const match = refined.horizons.find((r: any) => r.months === h.months);
      if (!match) return h;
      return {
        months: h.months,
        p50: Number(match.p50 ?? h.p50),
        low: Number(match.low ?? h.low),
        high: Number(match.high ?? h.high),
        deposit_index: Number(match.deposit_index ?? h.deposit_index),
        nim: Number(match.nim ?? h.nim),
      };
    });
    return { ...payload, horizons: merged, method: 'rules+gemini-v1' };
  } catch (error) {
    console.warn('Gemini refinement failed:', error);
    return { ...payload, method: 'rules-v1' };
  }
}

async function main() {
  const [macro, hysa] = await Promise.all([loadJson(MACRO_PATH), loadJson(HYSA_PATH)]);
  const base = heuristicsForecast(macro, hysa);
  const refined = await refineWithGemini(base, macro, hysa);
  delete refined.meta;
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(refined, null, 2), 'utf8');
  console.log(`Forecast written to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
