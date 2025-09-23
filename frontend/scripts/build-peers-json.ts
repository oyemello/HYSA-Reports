#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.resolve(base, '../public/data/hysa_accounts.json');
const HISTORY = path.resolve(base, '../data/history.jsonl');
const OUTPUT = path.resolve(base, '../public/hysa.json');

const parse = (value: unknown) => {
  const n = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Number(n.toFixed(3)) : null;
};

const stat = (values: number[], pct?: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (pct === undefined) {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(3));
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((pct / 100) * (sorted.length - 1))));
  return sorted[index];
};

const readHistory = async () => {
  try {
    return (await fs.readFile(HISTORY, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

(async () => {
  const now = new Date();
  const tenYearsAgo = new Date(now);
  tenYearsAgo.setFullYear(now.getFullYear() - 10);
  const minTime = tenYearsAgo.getTime();

  const [snapshotText, historyRaw] = await Promise.all([fs.readFile(SNAPSHOT, 'utf8'), readHistory()]);
  const currentRows = (JSON.parse(snapshotText) as Array<any>).map((row) => ({
    bank: row.institution,
    key: slug(String(row.institution ?? '')) || 'unknown',
    apy: parse(row.apy) ?? 0,
    url: row.bank_link ?? row.link ?? row.nerdwallet_link ?? null,
  }));

  const historyEntries = historyRaw
    .map((entry) => ({
      time: new Date(entry.as_of ?? entry.date ?? 0).getTime(),
      rows: entry.rows ?? entry.accounts ?? [],
    }))
    .filter((entry) => Number.isFinite(entry.time) && entry.time >= minTime)
    .sort((a, b) => a.time - b.time);

  const historyMap = new Map<string, Array<{ date: string; value: number }>>();
  const ensure = (key: string) => {
    if (!historyMap.has(key)) historyMap.set(key, []);
    return historyMap.get(key)!;
  };
  const pushPoint = (key: string, date: string, value: number | null) => {
    if (value === null) return;
    const points = ensure(key);
    if (!points.length || points[points.length - 1].date !== date) points.push({ date, value });
  };

  const medianSeries: Array<{ date: string; value: number }> = [];
  const p75Series: Array<{ date: string; value: number }> = [];

  historyEntries.forEach((entry) => {
    const date = isoDate(entry.time);
    const values: number[] = [];
    entry.rows.forEach((row: any) => {
      const name = String(row.bank ?? row.institution ?? '').trim();
      if (!name) return;
      const value = parse(row.apy ?? row.value);
      if (value === null) return;
      values.push(value);
      pushPoint(slug(name), date, value);
    });
    if (values.length) {
      medianSeries.push({ date, value: stat(values) });
      p75Series.push({ date, value: stat(values, 75) });
    }
  });

  const todayIso = isoDate(now.getTime());
  currentRows.forEach((row) => pushPoint(row.key, todayIso, row.apy));
  const peerValues = currentRows.map((row) => row.apy).filter((value) => Number.isFinite(value));
  const todayMedian = stat(peerValues);
  const todayP75 = stat(peerValues, 75);

  const ensureBaseline = (points: Array<{ date: string; value: number }>, value: number) => {
    if (!points.length || points[points.length - 1].date !== todayIso) {
      points.push({ date: todayIso, value });
    }
    if (points.length === 1) {
      const anchorDate = isoDate(minTime);
      if (points[0].date !== anchorDate) {
        points.unshift({ date: anchorDate, value: points[0].value });
      }
    }
  };

  ensureBaseline(medianSeries, todayMedian);
  ensureBaseline(p75Series, todayP75);

  historyMap.forEach((points, key) => {
    if (!points.length) {
      const current = currentRows.find((row) => row.key === key)?.apy;
      if (current !== undefined) points.push({ date: todayIso, value: current });
    }
    if (points.length === 1) {
      const anchorDate = isoDate(minTime);
      if (points[0].date !== anchorDate) {
        points.unshift({ date: anchorDate, value: points[0].value });
      }
    }
  });

  const historyPayload = {
    banks: currentRows.map((row) => ({ id: row.key, name: row.bank })),
    series: Object.fromEntries([...historyMap.entries()].map(([key, points]) => [key, points])),
    peer_median_series: medianSeries,
    peer_p75_series: p75Series,
  };

  const rows = currentRows.map((row) => {
    const key = row.key;
    const series = historyMap.get(key) ?? [];
    const lookup = (days: number) => {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);
      const compare = isoDate(cutoff.getTime());
      const match = [...series].reverse().find((point) => point.date <= compare);
      return match?.value ?? null;
    };
    const week = lookup(7);
    const month = lookup(30);
    return {
      bank: row.bank,
      apy: row.apy,
      delta_7d: week !== null ? Number((row.apy - week).toFixed(3)) : 0,
      delta_30d: month !== null ? Number((row.apy - month).toFixed(3)) : 0,
      url: row.url,
      key,
    };
  });

  const payload = {
    as_of: now.toISOString(),
    peer_median: stat(peerValues),
    peer_p75: stat(peerValues, 75),
    rows,
    history: historyPayload,
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2));
  console.log(`HYSA peers snapshot written to ${OUTPUT}`);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
