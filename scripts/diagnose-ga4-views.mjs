// One-off diagnostic: compare sitewide GA4 pageviews vs /blog/posts/ pageviews vs the
// blog_post_view custom event, to find where the undercount is (base pageview tracking,
// path-matching, or the custom event script). Prints to workflow logs; not committed output.
import crypto from 'crypto';

const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const CLIENT_EMAIL = process.env.GA4_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GA4_PRIVATE_KEY || '').replace(/\\n/g, '\n');

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken() {
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
  return (await res.json()).access_token;
}

async function ga4Run(token, body) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) { console.error(`GA4 error ${res.status}: ${text.slice(0, 500)}`); return null; }
  return JSON.parse(text);
}

async function main() {
  console.log('PROPERTY_ID:', PROPERTY_ID);
  console.log('CLIENT_EMAIL set:', !!CLIENT_EMAIL);
  console.log('PRIVATE_KEY set:', !!PRIVATE_KEY, 'len:', PRIVATE_KEY.length);

  const token = await getAccessToken();
  const dateRanges = [{ startDate: '400daysAgo', endDate: 'today' }];

  console.log('\n--- 1. Sitewide totals (no path filter) ---');
  const sitewide = await ga4Run(token, {
    dateRanges,
    metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }, { name: 'totalUsers' }, { name: 'eventCount' }]
  });
  console.log(JSON.stringify(sitewide?.rows, null, 2));

  console.log('\n--- 2. Pageviews by top-level path prefix ---');
  const byPath = await ga4Run(token, {
    dateRanges,
    dimensions: [{ name: 'pagePathPlusQueryString' }],
    metrics: [{ name: 'screenPageViews' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 30
  });
  for (const row of (byPath?.rows || [])) {
    console.log(row.dimensionValues[0].value, '->', row.metricValues[0].value);
  }

  console.log('\n--- 3. blog_post_view custom event count ---');
  const evt = await ga4Run(token, {
    dateRanges,
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'blog_post_view' } } }
  });
  console.log(JSON.stringify(evt?.rows, null, 2));

  console.log('\n--- 4. All event names + counts (top 20) ---');
  const allEvents = await ga4Run(token, {
    dateRanges,
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 20
  });
  for (const row of (allEvents?.rows || [])) {
    console.log(row.dimensionValues[0].value, '->', row.metricValues[0].value);
  }

  console.log('\n--- 5. Realtime check (active users right now) ---');
  const rtRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runRealtimeReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metrics: [{ name: 'activeUsers' }] })
  });
  console.log(await rtRes.text());
}

main().catch(err => { console.error(err); process.exit(1); });
