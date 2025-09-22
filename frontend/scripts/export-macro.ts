#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeSpreads } from '../src/features.js';
import { getMacroBundle } from './macros.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.resolve(__dirname, '../public/macro.json');

async function main() {
  const macros = await getMacroBundle();
  const topHysa = null;
  const features = computeSpreads(macros, topHysa);

  const payload = {
    generated_at: new Date().toISOString(),
    topHysa,
    macros,
    features,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Macro bundle exported to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
