#!/usr/bin/env node
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getMacroBundle } from '../src/macros.js';

async function main() {
  const macros = await getMacroBundle();

  const payload = {
    generated_at: new Date().toISOString(),
    topHysa: null as number | null,
    macros,
  };

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outputPath = path.resolve(__dirname, '../public/macro.json');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Macro bundle exported to ${outputPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
