// Fetch per-post pageviews via the GA4 Data API and write blog/data/views.json —
// a public, static {slug: views} map read client-side by blog/index.html and
// blog/_template.html to show view counts (replaces the dead GoatCounter widget).
//
// Required env: GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY
//
//   node scripts/fetch-public-views.mjs

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const CLIENT_EMAIL = process.env.GA4_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GA4_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const OUT_PATH = 'blog/data/views.json';
// GA4 stream (G-717M9L2RTM) went live 2026-04-15; asking for more history is harmless.
const DAYS = 400;

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

function slugFromPath(p) {
  if (!p) return null;
  const m = p.match(/\/blog\/posts\/([^/?#.]+)(?:\.html)?/);
  return m ? m[1] : null;
}

async function main() {
  if (!PROPERTY_ID) { console.error('GA4_PROPERTY_ID required — skipping (views.json left as-is)'); process.exit(0); }

  const token = await getAccessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${DAYS}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { value: '/blog/posts/', matchType: 'CONTAINS' } } },
      limit: 1000
    })
  });
  if (!res.ok) throw new Error(`ga4 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();

  const views = {};
  for (const row of (data.rows || [])) {
    const slug = slugFromPath(row.dimensionValues[0].value);
    if (!slug) continue;
    const n = Number(row.metricValues[0].value) || 0;
    views[slug] = (views[slug] || 0) + n;
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), views }, null, 2));
  console.log(`Wrote ${Object.keys(views).length} posts -> ${OUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
