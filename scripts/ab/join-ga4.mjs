// Join GA4 CSV export against ab-tags.json to produce ab-analytics.json
// with per-post metrics and tags in one row.
//
// Usage:
//   node scripts/ab/join-ga4.mjs <ga4-pages.csv> [events.csv]
//
// Expects the standard GA4 exports:
//   - Pages and screens: columns "Page path" (or "Page path and screen class"), "Views", "Users", "Average engagement time per session"
//   - Events (optional): columns "Event name", "Event count", "Page path" — for per-post event counts (newsletter_subscribe, app_interest_click)
//
// Output: blog/ab-analytics.json
//   [
//     {
//       slug: "...",
//       views, users, avg_engagement_seconds,
//       newsletter_subscribes, app_interest_clicks,
//       ...all tag fields
//     }
//   ]

import fs from 'fs/promises';
import path from 'path';

function parseCsv(text) {
  // lightweight CSV parser — handles quoted fields with commas
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const rows = [];
  for (const line of lines) {
    const row = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { row.push(cur); cur = ''; continue; }
      cur += ch;
    }
    row.push(cur);
    rows.push(row);
  }
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function slugFromPath(p) {
  if (!p) return null;
  // /blog/posts/2026-04-14-why-the-90-minute-sleep-cycle-myth-leaves-you-tired.html
  const m = p.match(/\/blog\/posts\/([^/?#.]+)(?:\.html)?/);
  return m ? m[1] : null;
}

function num(x) {
  if (x == null) return 0;
  const n = Number(String(x).replace(/[,\s"]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const pagesCsvPath = process.argv[2];
  const eventsCsvPath = process.argv[3];
  if (!pagesCsvPath) {
    console.error('Usage: node scripts/ab/join-ga4.mjs <pages.csv> [events.csv]');
    process.exit(1);
  }

  const tags = JSON.parse(await fs.readFile('blog/ab-tags.json', 'utf8'));

  const pagesRaw = await fs.readFile(pagesCsvPath, 'utf8');
  const pages = parseCsv(pagesRaw.replace(/^#[^\n]*\n/gm, '')); // strip GA4 comment lines

  const pathCol = ['Page path and screen class', 'Page path', 'page_path', 'Page location'].find(c => pages[0] && c in pages[0]);
  const viewsCol = ['Views', 'Screen page views', 'screenPageViews', 'Event count'].find(c => pages[0] && c in pages[0]);
  const usersCol = ['Users', 'Total users', 'totalUsers', 'activeUsers'].find(c => pages[0] && c in pages[0]);
  const engCol = ['Average engagement time per session', 'User engagement', 'averageEngagementTime', 'Average engagement time'].find(c => pages[0] && c in pages[0]);

  if (!pathCol || !viewsCol) {
    console.error('Could not find Page path / Views columns. Headers:', Object.keys(pages[0] || {}));
    process.exit(1);
  }

  // aggregate by slug
  const bySlug = {};
  for (const row of pages) {
    const slug = slugFromPath(row[pathCol]);
    if (!slug) continue;
    if (!bySlug[slug]) bySlug[slug] = { slug, views: 0, users: 0, avg_engagement_seconds: 0, _engWeight: 0 };
    const v = num(row[viewsCol]);
    bySlug[slug].views += v;
    if (usersCol) bySlug[slug].users += num(row[usersCol]);
    if (engCol) {
      bySlug[slug].avg_engagement_seconds += num(row[engCol]) * v;
      bySlug[slug]._engWeight += v;
    }
  }
  for (const s of Object.values(bySlug)) {
    if (s._engWeight > 0) s.avg_engagement_seconds = s.avg_engagement_seconds / s._engWeight;
    delete s._engWeight;
  }

  // optional events join
  if (eventsCsvPath) {
    const eventsRaw = await fs.readFile(eventsCsvPath, 'utf8');
    const events = parseCsv(eventsRaw.replace(/^#[^\n]*\n/gm, ''));
    const eName = ['Event name', 'eventName'].find(c => events[0] && c in events[0]);
    const eCount = ['Event count', 'eventCount'].find(c => events[0] && c in events[0]);
    const ePath = ['Page path', 'Page path and screen class', 'Page location'].find(c => events[0] && c in events[0]);

    if (eName && eCount && ePath) {
      for (const row of events) {
        const slug = slugFromPath(row[ePath]);
        if (!slug || !bySlug[slug]) continue;
        const name = row[eName];
        const n = num(row[eCount]);
        if (name === 'newsletter_subscribe') bySlug[slug].newsletter_subscribes = (bySlug[slug].newsletter_subscribes || 0) + n;
        else if (name === 'app_interest_click') bySlug[slug].app_interest_clicks = (bySlug[slug].app_interest_clicks || 0) + n;
        else if (name === 'app_interest_email') bySlug[slug].app_interest_emails = (bySlug[slug].app_interest_emails || 0) + n;
      }
    } else {
      console.warn('[warn] events CSV missing expected columns, skipping events join');
    }
  }

  // attach tags
  const rows = [];
  for (const [slug, metrics] of Object.entries(bySlug)) {
    rows.push({ ...metrics, ...(tags[slug] || {}), tagged: !!tags[slug] });
  }

  // derived rates
  for (const r of rows) {
    r.subscribe_rate = r.views > 0 ? (r.newsletter_subscribes || 0) / r.views : 0;
    r.app_click_rate = r.views > 0 ? (r.app_interest_clicks || 0) / r.views : 0;
  }

  rows.sort((a, b) => b.views - a.views);
  await fs.writeFile('blog/ab-analytics.json', JSON.stringify(rows, null, 2));

  const tagged = rows.filter(r => r.tagged).length;
  console.log(`Joined ${rows.length} posts (${tagged} tagged) -> blog/ab-analytics.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
