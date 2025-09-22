#!/usr/bin/env node
import { promises as fs } from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.resolve(base, '../public/data/hysa_accounts.json');
const HISTORY = path.resolve(base, '../data/history.jsonl');
const OUTPUT = path.resolve(base, '../public/hysa.json');
const parse = (v: unknown) => { const n = Number.parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; };
const stat = (vals: number[], pct?: number) => { if (!vals.length) return 0; const sorted = [...vals].sort((a, b) => a - b); if (pct === undefined) { const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; } const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((pct / 100) * (sorted.length - 1)))); return sorted[idx]; };
const readHistory = async () => { try { return (await fs.readFile(HISTORY, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } };

(async () => {
  const now = new Date();
  const [snapshotText, history] = await Promise.all([fs.readFile(SNAPSHOT, 'utf8'), readHistory()]);
  const current = (JSON.parse(snapshotText) as Array<any>).map((row) => ({ bank: row.institution, key: String(row.institution ?? '').toLowerCase(), apy: parse(row.apy) ?? 0, url: row.bank_link ?? row.link ?? row.nerdwallet_link ?? null }));
  const hist = history.map((entry) => ({ time: new Date(entry.as_of ?? entry.date ?? 0).getTime(), rows: entry.rows ?? entry.accounts ?? [] })).filter((entry) => Number.isFinite(entry.time)).sort((a, b) => b.time - a.time);
  const lookup = (bank: string, days: number) => { const target = new Date(now); target.setDate(target.getDate() - days); const cutoff = target.getTime(); for (const entry of hist) { if (entry.time <= cutoff) { const match = entry.rows.find((row: any) => String(row.bank ?? row.institution ?? '').toLowerCase() === bank); const val = parse(match?.apy ?? match?.value); if (val !== null) return val; } } return null; };
  const rows = current.map(({ bank, key, apy, url }) => { const week = lookup(key, 7); const month = lookup(key, 30); return { bank, apy, delta_7d: week !== null ? apy - week : 0, delta_30d: month !== null ? apy - month : 0, url }; });
  const peerValues = rows.map((r) => r.apy).filter((v) => Number.isFinite(v));
  await fs.writeFile(OUTPUT, JSON.stringify({ as_of: now.toISOString(), peer_median: stat(peerValues), peer_p75: stat(peerValues, 75), rows }, null, 2));
  console.log(`HYSA peers snapshot written to ${OUTPUT}`);
})().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
