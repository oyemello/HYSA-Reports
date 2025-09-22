#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildScenarios } from '../src/scenarios.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FORECAST_PATH = path.resolve(here, '../public/forecast.json');
const CONFIG_PATH = path.resolve(here, '../config/metrics.json');
const OUTPUT_PATH = path.resolve(here, '../public/scenarios.json');

const loadJson = async (file: string) => {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

(async () => {
  const [forecast, config] = await Promise.all([loadJson(FORECAST_PATH), loadJson(CONFIG_PATH)]);
  if (!forecast || !Array.isArray(forecast.horizons)) {
    throw new Error('Forecast data unavailable. Run npm run forecast first.');
  }
  const scenarios = buildScenarios(forecast.horizons, config ?? {});
  const payload = {
    as_of: forecast.as_of ?? new Date().toISOString(),
    scenarios,
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Scenario presets written to ${OUTPUT_PATH}`);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
