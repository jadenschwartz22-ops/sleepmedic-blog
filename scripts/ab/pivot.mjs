// Pivot the A/B analytics by each tag dimension.
//   node scripts/ab/pivot.mjs
//   node scripts/ab/pivot.mjs --metric subscribe_rate
//   node scripts/ab/pivot.mjs --dim energy,opening_vehicle
//
// Reads blog/ab-analytics.json, prints per-dimension tables ranked by the
// chosen metric. Single-value dims pivot directly; array dims (devices)
// explode one-row-per-value.

import fs from 'fs/promises';

const METRICS = ['views', 'avg_engagement_seconds', 'newsletter_subscribes',
                 'app_interest_clicks', 'subscribe_rate', 'app_click_rate'];
const DEFAULT_DIMS = ['energy', 'opening_vehicle', 'closing_vehicle',
                      'length_bucket', 'voice_intensity', 'topic_cluster',
                      'hook_type', 'format', 'devices'];

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function sum(xs) { return xs.reduce((a, b) => a + b, 0); }

function table(rows, dim, metric) {
  const groups = {};
  for (const r of rows) {
    if (!r.tagged) continue;
    const values = Array.isArray(r[dim]) ? r[dim] : [r[dim]];
    for (const v of values) {
      if (v == null) continue;
      groups[v] = groups[v] || [];
      groups[v].push(r[metric] || 0);
    }
  }
  const out = Object.entries(groups).map(([k, xs]) => ({
    value: k,
    n: xs.length,
    mean: mean(xs),
    total: sum(xs)
  }));
  // rank by mean for rates, by total for counts
  const rateMetric = metric.endsWith('_rate') || metric.startsWith('avg_');
  out.sort((a, b) => rateMetric ? b.mean - a.mean : b.total - a.total);
  return { dim, metric, rows: out };
}

function printTable(t) {
  console.log(`\n=== ${t.dim} by ${t.metric} ===`);
  const fmt = t.metric.endsWith('_rate') ? (x => (x * 100).toFixed(2) + '%')
            : t.metric.startsWith('avg_') ? (x => x.toFixed(1) + 's')
            : (x => Math.round(x).toString());
  const maxLen = Math.max(...t.rows.map(r => r.value.length), 10);
  console.log(`${'value'.padEnd(maxLen)}  ${'n'.padStart(4)}  ${'mean'.padStart(10)}  ${'total'.padStart(10)}`);
  console.log('-'.repeat(maxLen + 32));
  for (const r of t.rows) {
    console.log(`${r.value.padEnd(maxLen)}  ${String(r.n).padStart(4)}  ${fmt(r.mean).padStart(10)}  ${fmt(r.total).padStart(10)}`);
  }
}

async function main() {
  const rows = JSON.parse(await fs.readFile('blog/ab-analytics.json', 'utf8'));
  const metric = arg('--metric', 'avg_engagement_seconds');
  if (!METRICS.includes(metric)) {
    console.error(`Unknown metric. Choose: ${METRICS.join(', ')}`);
    process.exit(1);
  }
  const dimsArg = arg('--dim');
  const dims = dimsArg ? dimsArg.split(',') : DEFAULT_DIMS;

  const tagged = rows.filter(r => r.tagged).length;
  console.log(`A/B PIVOT — ${rows.length} posts (${tagged} tagged), metric: ${metric}`);
  console.log('='.repeat(60));

  for (const d of dims) printTable(table(rows, d, metric));

  // quick co-occurrence: which two-tag combos dominate the top 5?
  const topN = [...rows].filter(r => r.tagged).sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).slice(0, 5);
  console.log(`\n=== top 5 posts by ${metric} ===`);
  for (const r of topN) {
    const fmt = metric.endsWith('_rate') ? ((r[metric] || 0) * 100).toFixed(2) + '%'
             : metric.startsWith('avg_') ? (r[metric] || 0).toFixed(1) + 's'
             : Math.round(r[metric] || 0);
    console.log(`  ${fmt.padStart(10)}  ${r.slug}`);
    console.log(`             ${r.energy} / ${r.opening_vehicle} -> ${r.closing_vehicle} / ${r.length_bucket} / v${r.voice_intensity}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
