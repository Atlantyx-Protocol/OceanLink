// ---------------------------------------------------------------------------
// Offline matching-engine benchmark.
//
// Replays a CSV of historical bridge deposits through MatchingService and
// reports the matching rate (and a few related metrics) for a grid of
// (window, threshold) configurations.
//
// Time is purely virtual: orders are bucketed by their CSV timestamp, not by
// wall clock. Each bucket is fed to MatchingService.runMatchingPass(), so a
// 1-hour CSV completes in well under a second of CPU.
//
// No DB / wallet / on-chain side effects. The OCEAN_LINK_TESTING flag is set
// before importing OrderStore so DB writes are short-circuited.
//
// Usage:
//   pnpm --filter @ocean-link/backend run bench:matching [csv_path]
//
// Default csv_path: data/bridge_data.mapped.clean.peak_hour.csv (relative to
// the monorepo root).
// ---------------------------------------------------------------------------

process.env.OCEAN_LINK_TESTING = '1';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OrderStore } from '../src/engine/matching/store/orderStore.js';
import { MatchingService } from '../src/engine/matching/service/matchingService.js';
import type { IntentOrder } from '../src/engine/matching/types.js';

// ---------------------------------------------------------------------------
// CSV row → IntentOrder mapping
// ---------------------------------------------------------------------------

const CHAIN_ID: Record<string, number> = {
  ethereum: 1,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  polygon: 137,
  zksync: 324,
  hyperliquid: 999,
};

const CHAIN_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(CHAIN_ID).map(([name, id]) => [id, name])
);

// Lower-bound USD filter for dust deposits (matches the preprocessing
// step described in Chapter 4).
const MIN_AMOUNT_USD = 5;

// Per-order deadline (seconds from creation). Chosen at 15 min so that orders
// have a realistic max wait that still comfortably accommodates the HTLC
// TIME_LOCK of 10 min — past this an order is considered "stale" and would
// be handed off to the Accelerator/Fallback layer in production.
const ORDER_DEADLINE_SEC = 15 * 60;

interface Row {
  ts: number; // unix seconds (virtual time from CSV)
  src: number;
  des: number;
  amount: string;
}

function parseCsv(filePath: string): Row[] {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header) throw new Error('empty CSV');

  const rows: Row[] = [];
  let skipped = 0;

  for (const line of lines) {
    const [tsStr, src, des, amtStr] = line.split(',');
    if (!tsStr || !src || !des || !amtStr) {
      skipped++;
      continue;
    }
    const amt = Number(amtStr);
    if (!Number.isFinite(amt) || amt < MIN_AMOUNT_USD) {
      skipped++;
      continue;
    }
    const srcId = CHAIN_ID[src.trim()];
    const desId = CHAIN_ID[des.trim()];
    if (!srcId || !desId || srcId === desId) {
      skipped++;
      continue;
    }
    // "2026-04-10 12:18:39.000 UTC" → ISO
    const iso = tsStr.replace(' UTC', 'Z').replace(' ', 'T');
    const tMs = Date.parse(iso);
    if (Number.isNaN(tMs)) {
      skipped++;
      continue;
    }
    rows.push({
      ts: Math.floor(tMs / 1000),
      src: srcId,
      des: desId,
      amount: String(amt),
    });
  }

  rows.sort((a, b) => a.ts - b.ts);
  if (skipped > 0) {
    console.log(`[parseCsv] skipped ${skipped} malformed/zero rows`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Route distribution (symmetric pairs)
// ---------------------------------------------------------------------------

function reportRouteDistribution(rows: Row[]): void {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const a = CHAIN_NAME[r.src] ?? `chain${r.src}`;
    const b = CHAIN_NAME[r.des] ?? `chain${r.des}`;
    const key = a < b ? `${a}<->${b}` : `${b}<->${a}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = rows.length;
  const sorted = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  console.log('\n=== Route distribution (symmetric pairs) ===');
  for (const [route, n] of sorted) {
    console.log(`  ${route.padEnd(24)}  ${String(n).padStart(5)}   ${((100 * n) / total).toFixed(1)}%`);
  }
  console.log(`  ${'TOTAL'.padEnd(24)}  ${String(total).padStart(5)}   100.0%`);
}

// ---------------------------------------------------------------------------
// Single bench run
// ---------------------------------------------------------------------------

interface BenchResult {
  total: number;
  matched: number;
  partial: number;
  queued: number;
  expired: number;
  matchedVolumeUsd: number;
  totalVolumeUsd: number;
  expiredVolumeUsd: number;
  ticks: number;
  avgLatencySec: number; // mean (matchedAt - createdAt) for matched orders
  p50LatencySec: number;
  p95LatencySec: number;
  cyclesByLength: Record<number, number>;
  elapsedMs: number;
}

function bench(rows: Row[], windowSec: number, threshold: number): BenchResult {
  const t0 = Date.now();
  const store = new OrderStore();
  const service = new MatchingService(store, undefined, threshold);

  const baseTs = rows[0]!.ts;
  let bucketIdx = 0;
  let i = 0;
  let ticks = 0;

  // Track creation times so we can compute matching latency from match results
  const createdAtById = new Map<string, number>();
  const insertOrder = (row: Row, idx: number, virtualNow: number) => {
    const order: IntentOrder = {
      orderId: `r${idx}`,
      srcChain: row.src,
      desChain: row.des,
      amount: row.amount,
      deadline: virtualNow + ORDER_DEADLINE_SEC,
      createdAt: virtualNow,
      status: 'QUEUED',
      userAddress: '0xbenchuser',
    };
    createdAtById.set(order.orderId, virtualNow);
    store.add(order);
  };

  // Virtual-clock expiry: order.deadline is in virtual seconds, but
  // store.expireStale() uses wall clock (Date.now). Walk the internal map and
  // flip stale ones to EXPIRED ourselves, against the current bucket boundary.
  const expireStaleVirtual = (now: number): number => {
    const internal = (store as unknown as { orders: Map<string, IntentOrder> }).orders;
    let n = 0;
    for (const o of internal.values()) {
      if ((o.status === 'QUEUED' || o.status === 'PARTIAL') && o.deadline < now) {
        o.status = 'EXPIRED';
        store.removeFromPairIndex(o.orderId);
        n++;
      }
    }
    return n;
  };

  while (i < rows.length) {
    const bucketEnd = baseTs + (bucketIdx + 1) * windowSec;
    while (i < rows.length && rows[i]!.ts < bucketEnd) {
      insertOrder(rows[i]!, i, rows[i]!.ts);
      i++;
    }

    expireStaleVirtual(bucketEnd);

    const active = store.getActiveOrders();
    if (active.length > 0) {
      // The matching service stamps matchedAt with Date.now()/1000 internally,
      // which is wall-clock — it's the only impure part. We capture the result
      // and overwrite matchedAt with our virtual tick boundary so latency
      // measurements stay in virtual time.
      const results = service.runMatchingPass(active);
      const virtualMatchedAt = bucketEnd;
      for (const r of results) {
        r.matchedAt = virtualMatchedAt;
      }
    }
    bucketIdx++;
    ticks++;
  }

  // Final sweep: any orders whose deadline passed during the last bucket(s)
  // still need to be flipped to EXPIRED before tallying.
  const finalNow = baseTs + bucketIdx * windowSec;
  expireStaleVirtual(finalNow);

  // Tally outcomes from the OrderStore + match-result history.
  let matched = 0;
  let partial = 0;
  let queued = 0;
  let expired = 0;
  let matchedVolume = 0;
  let totalVolume = 0;
  let expiredVolume = 0;
  const allOrders: IntentOrder[] = (store as unknown as { orders: Map<string, IntentOrder> }).orders
    ? [...(store as unknown as { orders: Map<string, IntentOrder> }).orders.values()]
    : [];
  for (const o of allOrders) {
    totalVolume += Number(o.amount); // for partial / queued this is the *remaining* amount
    if (o.status === 'MATCHED') matched++;
    else if (o.status === 'PARTIAL') partial++;
    else if (o.status === 'EXPIRED') {
      expired++;
      expiredVolume += Number(o.amount);
    } else queued++;
  }
  // For a true volume baseline, sum the original amounts from the CSV.
  const baselineVolume = rows.reduce((s, r) => s + Number(r.amount), 0);

  // Latency + cycle-length distribution from match-result history.
  const matchResults = store.getMatchResults(1, Number.MAX_SAFE_INTEGER).data;
  const latencies: number[] = [];
  const cyclesByLength: Record<number, number> = {};
  for (const mr of matchResults) {
    for (const entry of mr.orders) {
      if (entry.status === 'MATCHED') {
        const created = createdAtById.get(entry.orderId);
        if (created !== undefined) latencies.push(mr.matchedAt - created);
        matchedVolume += Number(entry.matchedAmount);
      } else if (entry.status === 'PARTIAL') {
        matchedVolume += Number(entry.matchedAmount);
      }
    }
    for (const c of mr.rawCycles) {
      cyclesByLength[c.length] = (cyclesByLength[c.length] ?? 0) + 1;
    }
  }
  latencies.sort((a, b) => a - b);
  const pick = (q: number): number =>
    latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))]! : 0;

  return {
    total: rows.length,
    matched,
    partial,
    queued,
    expired,
    matchedVolumeUsd: matchedVolume,
    totalVolumeUsd: baselineVolume,
    expiredVolumeUsd: expiredVolume,
    ticks,
    avgLatencySec: latencies.length
      ? latencies.reduce((s, x) => s + x, 0) / latencies.length
      : 0,
    p50LatencySec: pick(0.5),
    p95LatencySec: pick(0.95),
    cyclesByLength,
    elapsedMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Main: load CSV + sweep grid
// ---------------------------------------------------------------------------

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '../../../');
  const defaultCsv = path.join(
    repoRoot,
    'data',
    'bridge_data.mapped.clean.peak_hour.csv'
  );
  const csvPath = process.argv[2] ?? defaultCsv;

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`Loading ${csvPath}`);
  const rows = parseCsv(csvPath);
  if (rows.length === 0) {
    console.error('No usable rows.');
    process.exit(1);
  }
  const durationSec = rows[rows.length - 1]!.ts - rows[0]!.ts;
  const totalVol = rows.reduce((s, r) => s + Number(r.amount), 0);
  console.log(
    `Loaded ${rows.length} rows over ${durationSec}s (~${(durationSec / 60).toFixed(1)} min), ` +
      `total volume = $${totalVol.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  );

  reportRouteDistribution(rows);

  const windows = [5, 30, 60, 120];
  const thresholds = [0, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95];

  // Run every (window, threshold) combo once and reuse for both tables.
  type Cell = { match: string; volume: string };
  const cells: Map<string, Cell> = new Map();
  for (const w of windows) {
    for (const t of thresholds) {
      const r = bench(rows, w, t);
      cells.set(`${w}-${t}`, {
        match: `${((100 * r.matched) / r.total).toFixed(1)}%`.padEnd(7),
        volume: `${((100 * r.matchedVolumeUsd) / r.totalVolumeUsd).toFixed(1)}%`.padEnd(7),
      });
      process.stdout.write(`  w=${w}s x=${t}: ${r.matched}/${r.total} (${((100 * r.matched) / r.total).toFixed(1)}%) in ${r.elapsedMs}ms\n`);
    }
  }

  const header = 'window  | ' + thresholds.map((t) => `x=${t}`.padEnd(7)).join(' ');

  console.log('\n=== Matching rate by (window × threshold) — % of orders MATCHED ===');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const w of windows) {
    const row = thresholds.map((t) => cells.get(`${w}-${t}`)!.match).join(' ');
    console.log(`${(w + 's').padStart(6)}  | ${row}`);
  }

  console.log('\n=== Matched volume rate by (window × threshold) — % of $-volume settled ===');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const w of windows) {
    const row = thresholds.map((t) => cells.get(`${w}-${t}`)!.volume).join(' ');
    console.log(`${(w + 's').padStart(6)}  | ${row}`);
  }

  // ---------- Detailed breakdown for a few representative configs ----------
  console.log('\n=== Detailed breakdown for representative configs ===');
  const configs: Array<[number, number]> = [
    [60, 0.3],
    [60, 0.5],
    [30, 0.3],
    [120, 0.3],
  ];
  for (const [w, t] of configs) {
    const r = bench(rows, w, t);
    const cyclesStr =
      Object.entries(r.cyclesByLength)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([len, n]) => `${len}-cycle:${n}`)
        .join(', ') || '(none)';
    console.log(
      `\n  window=${w}s threshold=${t}` +
        `\n    matched=${r.matched}/${r.total} (${((100 * r.matched) / r.total).toFixed(1)}%)` +
        `, partial=${r.partial}, queued=${r.queued}, expired=${r.expired}` +
        `\n    volume settled = $${r.matchedVolumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} / $${r.totalVolumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} ` +
        `(${((100 * r.matchedVolumeUsd) / r.totalVolumeUsd).toFixed(1)}%)` +
        `\n    volume expired = $${r.expiredVolumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} ` +
        `(${((100 * r.expiredVolumeUsd) / r.totalVolumeUsd).toFixed(1)}%)` +
        `\n    latency: avg=${r.avgLatencySec.toFixed(1)}s, p50=${r.p50LatencySec}s, p95=${r.p95LatencySec}s` +
        `\n    cycles: ${cyclesStr}` +
        `\n    ticks=${r.ticks}, runtime=${r.elapsedMs}ms`
    );
  }
}

main();
