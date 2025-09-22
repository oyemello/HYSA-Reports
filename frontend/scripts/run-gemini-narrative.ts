#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { narrativeSchema } from '../src/narrativeSchema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MACRO_PATH = path.resolve(here, '../public/macro.json');
const FORECAST_PATH = path.resolve(here, '../public/forecast.json');
const HYSA_PATH = path.resolve(here, '../public/hysa.json');
const SCENARIOS_PATH = path.resolve(here, '../public/scenarios.json');
const OUTPUT_PATH = path.resolve(here, '../public/narrative.json');

const loadJson = async (file: string) => {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

const fallbackNarrative = (data: any) => {
  const top = Number(data?.hysa?.peer_median ?? 0);
  const effr = Number(data?.macro?.macros?.EFFR?.slice(-1)[0]?.value ?? 0);
  return narrativeSchema.parse({
    title: 'Executive HYSA Outlook',
    period: new Date().toISOString().slice(0, 10),
    bank: 'American Express',
    metrics: {
      top_hysa_apy: Number(data?.hysa?.rows?.[0]?.apy ?? top) || 0,
      peer_median_apy: Number(data?.hysa?.peer_median ?? 0) || 0,
      peer_p75_apy: Number(data?.hysa?.peer_p75 ?? 0) || 0,
      effr,
      spread_vs_median_bps: Number((((data?.hysa?.rows?.[0]?.apy ?? 0) - (data?.hysa?.peer_median ?? 0)) * 100).toFixed(1)),
    },
    highlights: [
      'Peer median APY remains stable compared with last week.',
      'Fed effective rate provides a supportive backdrop for high-yield deposits.',
      'Liquidity spreads versus peers are within historical bounds.',
    ],
    benchmarking:
      'American Express tracks closely with the peer median HYSA yields; the current spread versus the 75th percentile remains manageable.',
    forecast_insights:
      'Baseline projections suggest limited volatility over the next year, with deposit costs trending gradually higher in tandem with the front-end Treasury curve.',
    recommendations: [
      'Maintain competitive HYSA offers while monitoring peer adjustments weekly.',
      'Evaluate promotional levers if peer p75 gaps widen beyond 20 bps.',
    ],
    risks: [
      'Faster-than-expected Fed cuts could compress spreads.',
      'Aggressive peer repricing may pressure new inflow targets.',
    ],
    compliance: 'For internal planning purposes only; not for external distribution.',
  });
};

const buildPrompt = (data: any) => {
  const payload = {
    metrics: {
      top_hysa: Number(data?.hysa?.rows?.[0]?.apy ?? 0),
      peer_median: Number(data?.hysa?.peer_median ?? 0),
      peer_p75: Number(data?.hysa?.peer_p75 ?? 0),
      effr: Number(data?.macro?.macros?.EFFR?.slice(-1)[0]?.value ?? 0),
      spreads: data?.macro?.features ?? {},
    },
    forecast: data?.forecast?.horizons ?? [],
    scenarios: data?.scenarios?.scenarios ?? null,
  };
  return JSON.stringify(payload, null, 2);
};

const callGemini = async (prompt: string) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const body = {
    systemInstruction: {
      role: 'system',
      parts: [
        {
          text: 'Medium-length, objective, analytical; strict JSON per schema; concise numbers & bps.',
        },
      ],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `DATA:\n${prompt}\n\nPlease respond with strict JSON matching the schema (title, period, bank, metrics, highlights[3-6], benchmarking (2-4 sentences), forecast_insights (2-4 sentences), recommendations[2-5], risks[2-5], compliance (1 sentence)).`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini request failed: ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text;
};

(async () => {
  const [macro, forecast, hysa, scenarios] = await Promise.all([
    loadJson(MACRO_PATH),
    loadJson(FORECAST_PATH),
    loadJson(HYSA_PATH),
    loadJson(SCENARIOS_PATH),
  ]);
  const prompt = buildPrompt({ macro, forecast, hysa, scenarios });
  let narrative;
  try {
    const responseText = await callGemini(prompt);
    if (!responseText) throw new Error('Gemini not configured');
    const parsed = JSON.parse(responseText);
    narrative = narrativeSchema.parse(parsed);
  } catch (error) {
    console.warn('Gemini narrative generation failed, falling back:', error);
    narrative = fallbackNarrative({ macro, forecast, hysa, scenarios });
  }
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(narrative, null, 2), 'utf8');
  console.log(`Narrative written to ${OUTPUT_PATH}`);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
