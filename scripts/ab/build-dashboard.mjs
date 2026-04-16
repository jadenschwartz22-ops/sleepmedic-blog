// Render private/ab-dashboard.html from private/ab-tags.json (+ ab-analytics.json if present).

import fs from 'fs/promises';
import path from 'path';
import { TAGS_PATH, ANALYTICS_PATH, DASHBOARD_PATH } from './paths.mjs';

async function loadJson(p, fallback = null) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}

function count(items, getKey) {
  const c = {};
  for (const it of items) {
    const keys = Array.isArray(getKey(it)) ? getKey(it) : [getKey(it)];
    for (const k of keys) {
      if (k == null) continue;
      c[k] = (c[k] || 0) + 1;
    }
  }
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function sum(xs) { return xs.reduce((a, b) => a + b, 0); }

function pivot(rows, dim, metric) {
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
  const out = Object.entries(groups).map(([k, xs]) => ({ value: k, n: xs.length, mean: mean(xs), total: sum(xs) }));
  const rateMetric = metric.endsWith('_rate') || metric.startsWith('avg_');
  out.sort((a, b) => rateMetric ? b.mean - a.mean : b.total - a.total);
  return out;
}

function fmt(metric, x) {
  if (metric.endsWith('_rate')) return (x * 100).toFixed(2) + '%';
  if (metric.startsWith('avg_')) return x.toFixed(1) + 's';
  return Math.round(x).toString();
}

function distTable(data, title) {
  const max = data[0] ? data[0][1] : 1;
  const total = data.reduce((a, [, v]) => a + v, 0);
  const rows = data.map(([k, n]) => {
    const pct = ((n / total) * 100).toFixed(0);
    const bar = '█'.repeat(Math.round((n / max) * 30));
    return `<tr><td>${k}</td><td class="num">${n}</td><td class="num">${pct}%</td><td class="bar">${bar}</td></tr>`;
  }).join('');
  return `
    <section>
      <h3>${title}</h3>
      <table><thead><tr><th>value</th><th>n</th><th>share</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
}

function pivotTable(data, metric, dim) {
  if (!data.length) return '';
  const rows = data.map(r => `<tr><td>${r.value}</td><td class="num">${r.n}</td><td class="num">${fmt(metric, r.mean)}</td><td class="num">${fmt(metric, r.total)}</td></tr>`).join('');
  return `
    <section>
      <h4>${dim} × ${metric}</h4>
      <table><thead><tr><th>${dim}</th><th>n</th><th>mean</th><th>total</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
}

function render({ tags, analytics, generated }) {
  const tagged = Object.values(tags);
  const n = tagged.length;

  const distributions = [
    ['Energy', it => it.energy],
    ['Voice intensity', it => it.voice_intensity],
    ['Length bucket', it => it.length_bucket],
    ['Opening vehicle', it => it.opening_vehicle],
    ['Closing vehicle', it => it.closing_vehicle],
    ['Topic cluster', it => it.topic_cluster],
    ['Hook type', it => it.hook_type],
    ['Format', it => it.format],
    ['Devices (multi)', it => it.devices],
  ].map(([title, fn]) => distTable(count(tagged, fn), title)).join('\n');

  let pivotsBlock = '';
  if (analytics && analytics.length) {
    const taggedAnalytics = analytics.filter(a => a.tagged);
    const metrics = ['views', 'avg_engagement_seconds', 'subscribe_rate', 'app_click_rate'];
    const dims = ['energy', 'voice_intensity', 'length_bucket', 'opening_vehicle', 'closing_vehicle', 'topic_cluster', 'hook_type', 'devices'];
    const blocks = [];
    for (const metric of metrics) {
      const parts = dims.map(d => pivotTable(pivot(taggedAnalytics, d, metric), metric, d)).join('\n');
      blocks.push(`<section class="metric-block"><h3>Ranked by ${metric}</h3>${parts}</section>`);
    }
    pivotsBlock = `
      <h2>Pivots (tagged posts joined to GA4)</h2>
      <p class="sub">${taggedAnalytics.length} tagged posts with analytics. Ignore any bucket where n &lt; 5.</p>
      ${blocks.join('\n')}`;
  } else {
    pivotsBlock = `
      <h2>Pivots</h2>
      <p class="sub">No GA4 data joined yet. Wire GA4 secrets (see AB.md) and the weekly workflow will populate pivots.</p>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>SleepMedic A/B Dashboard (internal)</title>
<style>
  body { font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 980px; margin: 24px auto; padding: 0 20px; color: #222; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 36px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
  h3 { font-size: 14px; margin: 18px 0 6px; color: #555; text-transform: uppercase; letter-spacing: 0.05em; }
  h4 { font-size: 13px; margin: 10px 0 4px; color: #888; font-weight: 600; }
  .sub { color: #666; font-size: 13px; margin: 4px 0 12px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #eee; font-size: 13px; }
  th { color: #888; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.num { text-align: right; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  td.bar { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #4a7; letter-spacing: -1px; }
  .metric-block { margin: 18px 0 36px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px 32px; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
  .meta { color: #888; font-size: 12px; }
  .banner { background: #fff8e1; border-left: 3px solid #f0a500; padding: 8px 14px; font-size: 12px; margin: 10px 0 20px; color: #6a4e00; border-radius: 0 4px 4px 0; }
</style>
</head>
<body>

<h1>SleepMedic A/B Dashboard</h1>
<p class="banner">Internal. Not linked from the public site, noindex, disallowed in robots.txt. Readers of the blog never see the voice labels.</p>
<p class="meta">Generated ${generated}. ${n} tagged posts.</p>

<h2>Current tag distributions</h2>
<p class="sub">What you've shipped so far, bucketed. Uneven buckets are where you have blind spots — go write a post that lives there.</p>
<div class="grid">
${distributions}
</div>

${pivotsBlock}

<h2>How to read this</h2>
<ul>
<li>For <strong>rate metrics</strong> (subscribe_rate, avg_engagement_seconds), sort by <code>mean</code>.</li>
<li>For <strong>count metrics</strong> (views), sort by <code>total</code>.</li>
<li>Ignore any row where <code>n &lt; 5</code>. Not enough signal.</li>
<li>Winners compound — if <em>monk × long × literary_ref</em> wins on three metrics, write more of those.</li>
</ul>

</body>
</html>`;
}

async function main() {
  const tags = await loadJson(TAGS_PATH, {});
  const analytics = await loadJson(ANALYTICS_PATH, null);
  if (!Object.keys(tags).length) {
    console.error(`No tags found at ${TAGS_PATH}. Run backfill.mjs first.`);
    process.exit(1);
  }
  const html = render({ tags, analytics, generated: new Date().toISOString() });
  await fs.mkdir(path.dirname(DASHBOARD_PATH), { recursive: true });
  await fs.writeFile(DASHBOARD_PATH, html);
  console.log(`Dashboard -> ${DASHBOARD_PATH} (${Object.keys(tags).length} tagged, analytics: ${analytics ? 'yes' : 'no'})`);
}

main().catch(err => { console.error(err); process.exit(1); });
