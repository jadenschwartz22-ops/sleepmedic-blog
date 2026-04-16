// Fetch GA4 metrics via the Data API and produce blog/ab-analytics.json
// joined against blog/ab-tags.json.
//
// Required env:
//   GA4_PROPERTY_ID   e.g. "532856345" (the numeric ID, not the G-XXX stream ID)
//   GA4_CLIENT_EMAIL  service account email
//   GA4_PRIVATE_KEY   service account private key (with literal \n preserved)
//
// The service account must have "Viewer" role on the GA4 property
// (GA4 Admin > Property Access Management).
//
// Usage:
//   node scripts/ab/fetch-ga4.mjs            # last 90 days
//   node scripts/ab/fetch-ga4.mjs --days 30  # custom window

import fs from 'fs/promises';
import crypto from 'crypto';

const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const CLIENT_EMAIL = process.env.GA4_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GA4_PRIVATE_KEY || '').replace(/\\n/g, '\n');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const DAYS = parseInt(arg('--days', '90'));

// ── JWT for service account auth (no google-auth-library dep) ──
function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken() {
  if (!CLIENT_EMAIL || !PRIVATE_KEY) throw new Error('GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY must be set');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(PRIVATE_KEY);
  const jwt = `${unsigned}.${base64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

async function ga4Run(token, body) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`ga4 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function slugFromPath(p) {
  if (!p) return null;
  const m = p.match(/\/blog\/posts\/([^/?#.]+)(?:\.html)?/);
  return m ? m[1] : null;
}

async function main() {
  if (!PROPERTY_ID) { console.error('GA4_PROPERTY_ID required'); process.exit(1); }

  const token = await getAccessToken();
  const dateRanges = [{ startDate: `${DAYS}daysAgo`, endDate: 'today' }];

  // 1) Pages report
  const pages = await ga4Run(token, {
    dateRanges,
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'userEngagementDuration' },
      { name: 'sessions' }
    ],
    dimensionFilter: {
      filter: { fieldName: 'pagePath', stringFilter: { value: '/blog/posts/', matchType: 'CONTAINS' } }
    },
    limit: 1000
  });

  // 2) Events report (our 4 custom events per ANALYTICS.md)
  const events = await ga4Run(token, {
    dateRanges,
    dimensions: [{ name: 'pagePath' }, { name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: { expressions: [
        { filter: { fieldName: 'pagePath', stringFilter: { value: '/blog/posts/', matchType: 'CONTAINS' } } },
        { filter: { fieldName: 'eventName', inListFilter: { values: ['newsletter_subscribe', 'app_interest_click', 'app_interest_email', 'blog_post_view'] } } }
      ]}
    },
    limit: 1000
  });

  const tags = JSON.parse(await fs.readFile('blog/ab-tags.json', 'utf8'));

  const bySlug = {};
  for (const row of (pages.rows || [])) {
    const slug = slugFromPath(row.dimensionValues[0].value);
    if (!slug) continue;
    const views = Number(row.metricValues[0].value) || 0;
    const users = Number(row.metricValues[1].value) || 0;
    const totalEng = Number(row.metricValues[2].value) || 0;
    const sessions = Number(row.metricValues[3].value) || 0;
    if (!bySlug[slug]) bySlug[slug] = { slug, views: 0, users: 0, sessions: 0, _engTotal: 0 };
    bySlug[slug].views += views;
    bySlug[slug].users += users;
    bySlug[slug].sessions += sessions;
    bySlug[slug]._engTotal += totalEng;
  }
  for (const s of Object.values(bySlug)) {
    s.avg_engagement_seconds = s.sessions > 0 ? s._engTotal / s.sessions : 0;
    delete s._engTotal;
  }

  for (const row of (events.rows || [])) {
    const slug = slugFromPath(row.dimensionValues[0].value);
    const ev = row.dimensionValues[1].value;
    if (!slug || !bySlug[slug]) continue;
    const n = Number(row.metricValues[0].value) || 0;
    if (ev === 'newsletter_subscribe') bySlug[slug].newsletter_subscribes = (bySlug[slug].newsletter_subscribes || 0) + n;
    else if (ev === 'app_interest_click') bySlug[slug].app_interest_clicks = (bySlug[slug].app_interest_clicks || 0) + n;
    else if (ev === 'app_interest_email') bySlug[slug].app_interest_emails = (bySlug[slug].app_interest_emails || 0) + n;
  }

  const rows = [];
  for (const [slug, m] of Object.entries(bySlug)) {
    const t = tags[slug] || {};
    const merged = { ...m, ...t, tagged: !!tags[slug] };
    merged.subscribe_rate = merged.views > 0 ? (merged.newsletter_subscribes || 0) / merged.views : 0;
    merged.app_click_rate = merged.views > 0 ? (merged.app_interest_clicks || 0) / merged.views : 0;
    rows.push(merged);
  }

  rows.sort((a, b) => b.views - a.views);
  await fs.writeFile('blog/ab-analytics.json', JSON.stringify(rows, null, 2));

  const tagged = rows.filter(r => r.tagged).length;
  console.log(`Fetched ${rows.length} posts over ${DAYS} days (${tagged} tagged) -> blog/ab-analytics.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
