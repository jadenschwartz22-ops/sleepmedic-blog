/**
 * SleepMedic Distribution Service (Raspberry Pi)
 *
 * Runs on Pi as a persistent Node.js service. Three jobs:
 * 1. Newsletter: accepts email signups, stores in subscribers.json, sends via Resend
 * 2. RSS Watcher: polls RSS feed every 30min, detects new posts, triggers distribution
 * 3. Distribution: on new post -> send newsletter + post to X (Twitter)
 *
 * Setup:
 *   npm install
 *   cp .env.example .env   # fill in API keys
 *   node server.mjs         # or use pm2: pm2 start server.mjs --name sleepmedic
 *
 * Endpoints:
 *   POST /subscribe         { email }
 *   POST /unsubscribe       { email }
 *   GET  /subscribers       (admin, requires ?key=ADMIN_KEY)
 *   POST /trigger-send      (webhook from GitHub Actions, requires ?key=ADMIN_KEY)
 *   GET  /health
 */

import http from 'http';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ───────────────────────────────────────────

const PORT = process.env.PORT || 3847;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN || '';
const TWITTER_API_KEY = process.env.TWITTER_API_KEY || '';
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET || '';
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN || '';
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'SleepMedic <blog@sleepmedic.co>';
const RSS_URL = 'https://sleepmedic.co/blog/feed.xml';
const POLL_INTERVAL = 30 * 60 * 1000; // 30 minutes
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

const SUBS_PATH = path.join(__dirname, 'subscribers.json');
const LAST_POST_PATH = path.join(__dirname, '.last-post-guid.txt');
const APP_INTEREST_PATH = path.join(__dirname, 'app-interest.json');

// ── Subscribers Store ────────────────────────────────

async function loadSubscribers() {
  try { return JSON.parse(await fs.readFile(SUBS_PATH, 'utf8')); }
  catch { return []; }
}

async function saveSubscribers(subs) {
  await fs.writeFile(SUBS_PATH, JSON.stringify(subs, null, 2));
}

async function addSubscriber(email) {
  email = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid email' };
  const subs = await loadSubscribers();
  if (subs.find(s => s.email === email)) return { ok: true, already: true };
  subs.push({ email, subscribedAt: new Date().toISOString() });
  await saveSubscribers(subs);
  console.log(`+ subscriber: ${email} (total: ${subs.length})`);
  notifyDiscord(`**[NEWSLETTER] New subscriber** \`${email}\` \u2014 **total: ${subs.length}**`);
  return { ok: true };
}

async function removeSubscriber(email) {
  email = email.toLowerCase().trim();
  const subs = await loadSubscribers();
  const filtered = subs.filter(s => s.email !== email);
  await saveSubscribers(filtered);
  return { ok: true, removed: subs.length - filtered.length };
}

// ── Discord Notifications ────────────────────────────

async function notifyDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, username: 'SleepMedic' })
    });
  } catch (err) {
    console.error(`Discord notify failed: ${err.message}`);
  }
}

// ── App Interest Store (smokescreen Download App button) ──

async function loadAppInterest() {
  try { return JSON.parse(await fs.readFile(APP_INTEREST_PATH, 'utf8')); }
  catch { return { clicks: 0, emails: [], events: [] }; }
}

async function saveAppInterest(data) {
  await fs.writeFile(APP_INTEREST_PATH, JSON.stringify(data, null, 2));
}

async function recordAppInterest({ type, email, location, path: refPath, referrer, ip, ua }) {
  const data = await loadAppInterest();
  const ts = new Date().toISOString();

  if (type === 'click') {
    data.clicks = (data.clicks || 0) + 1;
  } else if (type === 'email' && email) {
    email = email.toLowerCase().trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !data.emails.find(e => e.email === email)) {
      data.emails.push({ email, firstSeen: ts, location });
    }
  }

  // Keep last 500 events only
  data.events = (data.events || []).slice(-499);
  data.events.push({ ts, type, email: email || null, location: location || null, path: refPath || null, referrer: referrer || null, ip: ip || null, ua: ua || null });

  await saveAppInterest(data);

  const total = type === 'click' ? data.clicks : data.emails.length;
  const msg = type === 'click'
    ? `**[APP-INTEREST] Click** from \`${refPath || '?'}\` \u2014 location: \`${location || '?'}\` \u2014 **total clicks: ${total}**`
    : `**[APP-INTEREST] Email captured** \`${email}\` \u2014 location: \`${location || '?'}\` \u2014 **total emails: ${total}**`;
  notifyDiscord(msg);

  return { ok: true, clicks: data.clicks, emails: data.emails.length };
}

// ── Resend Email ─────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY not set, skipping email'); return; }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Resend error for ${to}: ${err.slice(0, 200)}`);
  }
}

async function sendNewsletter(post) {
  const subs = await loadSubscribers();
  if (!subs.length) { console.log('No subscribers, skipping newsletter'); return; }

  const subject = `New from SleepMedic: ${post.title}`;
  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#333;">
      <h2 style="margin-bottom:8px;">${post.title}</h2>
      <p style="color:#666;font-size:14px;margin-bottom:16px;">${post.date}</p>
      <p style="font-size:16px;line-height:1.6;margin-bottom:24px;">${post.excerpt}</p>
      <a href="${post.link}" style="display:inline-block;padding:12px 24px;background:#a78bfa;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Read the full post</a>
      <hr style="margin:32px 0;border:none;border-top:1px solid #eee;">
      <p style="font-size:12px;color:#999;">You signed up at sleepmedic.co. <a href="https://your-pi.sleepmedic.co/unsubscribe?email=${encodeURIComponent('{{email}}')}" style="color:#999;">Unsubscribe</a></p>
    </div>
  `;

  console.log(`Sending newsletter to ${subs.length} subscribers...`);
  let sent = 0;
  for (const sub of subs) {
    try {
      await sendEmail(sub.email, subject, html.replace('{{email}}', sub.email));
      sent++;
      // Resend free tier: 2 emails/second
      if (sent % 2 === 0) await new Promise(r => setTimeout(r, 1100));
    } catch (err) {
      console.error(`Failed to send to ${sub.email}: ${err.message}`);
    }
  }
  console.log(`Newsletter sent to ${sent}/${subs.length}`);
}

// ── Twitter/X Post ───────────────────────────────────

async function postToTwitter(post) {
  if (!TWITTER_ACCESS_TOKEN) { console.log('Twitter not configured, skipping'); return; }

  // OAuth 1.0a is complex -- use the v2 endpoint with Bearer or OAuth
  // For simplicity, using the npm twitter-api-v2 would be better,
  // but here we use the v2 REST API with OAuth 2.0 User Context
  // In practice, install twitter-api-v2 and use it.
  // This is a placeholder for the API call structure.

  const text = `${post.title}\n\n${post.excerpt}\n\n${post.link}`;

  try {
    // You'll want to use twitter-api-v2 package for proper OAuth 1.0a
    // npm install twitter-api-v2
    // This is the call structure:
    console.log(`Would post to X: "${text.slice(0, 100)}..."`);
    console.log('Install twitter-api-v2 and uncomment the Twitter code to enable');

    // const { TwitterApi } = await import('twitter-api-v2');
    // const client = new TwitterApi({
    //   appKey: TWITTER_API_KEY,
    //   appSecret: TWITTER_API_SECRET,
    //   accessToken: TWITTER_ACCESS_TOKEN,
    //   accessSecret: TWITTER_ACCESS_SECRET
    // });
    // await client.v2.tweet(text);
    // console.log('Posted to X successfully');
  } catch (err) {
    console.error(`Twitter post failed: ${err.message}`);
  }
}

// ── RSS Watcher ──────────────────────────────────────

async function getLastPostGuid() {
  try { return (await fs.readFile(LAST_POST_PATH, 'utf8')).trim(); }
  catch { return ''; }
}

async function setLastPostGuid(guid) {
  await fs.writeFile(LAST_POST_PATH, guid);
}

async function checkForNewPost() {
  try {
    const res = await fetch(RSS_URL);
    if (!res.ok) return null;
    const xml = await res.text();

    // Simple XML parsing for RSS (no dependency needed)
    const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
    if (!itemMatch) return null;

    const item = itemMatch[1];
    const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const guid = item.match(/<guid>(.*?)<\/guid>/)?.[1] || link;
    const desc = item.match(/<description>(.*?)<\/description>/)?.[1] || '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

    const lastGuid = await getLastPostGuid();
    if (guid === lastGuid) return null;

    return {
      title: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
      link,
      guid,
      excerpt: desc.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').slice(0, 200),
      date: pubDate
    };
  } catch (err) {
    console.error(`RSS check failed: ${err.message}`);
    return null;
  }
}

async function distribute(post) {
  console.log(`\nNew post detected: "${post.title}"`);
  await setLastPostGuid(post.guid);

  // Send newsletter
  await sendNewsletter(post);

  // Post to X
  await postToTwitter(post);

  console.log('Distribution complete\n');
}

// ── HTTP Server ──────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') { json(res, 200, {}); return; }

  // Health check
  if (url.pathname === '/health') {
    const subs = await loadSubscribers();
    json(res, 200, { status: 'ok', subscribers: subs.length, uptime: process.uptime() });
    return;
  }

  // Subscribe
  if (url.pathname === '/subscribe' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body.email) { json(res, 400, { error: 'email required' }); return; }
    const result = await addSubscriber(body.email);
    json(res, result.ok ? 200 : 400, result);
    return;
  }

  // Unsubscribe
  if (url.pathname === '/unsubscribe') {
    const email = url.searchParams.get('email');
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const result = await removeSubscriber(body.email || email);
      json(res, 200, result);
    } else if (email) {
      await removeSubscriber(email);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2>Unsubscribed</h2><p>You have been removed from the SleepMedic mailing list.</p>');
    } else {
      json(res, 400, { error: 'email required' });
    }
    return;
  }

  // Admin: list subscribers
  if (url.pathname === '/subscribers' && url.searchParams.get('key') === ADMIN_KEY) {
    const subs = await loadSubscribers();
    json(res, 200, { count: subs.length, subscribers: subs });
    return;
  }

  // App interest (smokescreen Download App tracker)
  if (url.pathname === '/app-interest' && req.method === 'POST') {
    const body = await parseBody(req);
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    const ua = (req.headers['user-agent'] || '').slice(0, 200);
    const result = await recordAppInterest({
      type: body.type === 'email' ? 'email' : 'click',
      email: body.email,
      location: body.location,
      path: body.path,
      referrer: body.referrer,
      ip, ua
    });
    json(res, 200, result);
    return;
  }

  // Admin: app interest dashboard
  if (url.pathname === '/app-interest/stats' && url.searchParams.get('key') === ADMIN_KEY) {
    const data = await loadAppInterest();
    json(res, 200, {
      clicks: data.clicks || 0,
      emails: data.emails || [],
      emailCount: (data.emails || []).length,
      recentEvents: (data.events || []).slice(-50).reverse()
    });
    return;
  }

  // Admin: unified stats
  if (url.pathname === '/stats' && url.searchParams.get('key') === ADMIN_KEY) {
    const [subs, interest] = await Promise.all([loadSubscribers(), loadAppInterest()]);
    json(res, 200, {
      newsletter: { count: subs.length },
      appInterest: { clicks: interest.clicks || 0, emails: (interest.emails || []).length },
      uptime: process.uptime()
    });
    return;
  }

  // Webhook: trigger distribution manually (from GitHub Actions)
  if (url.pathname === '/trigger-send' && req.method === 'POST') {
    if (url.searchParams.get('key') !== ADMIN_KEY) { json(res, 401, { error: 'unauthorized' }); return; }
    const body = await parseBody(req);
    if (body.title && body.link) {
      json(res, 200, { ok: true, queued: true });
      // Fire and forget
      distribute(body).catch(err => console.error('Distribute error:', err.message));
    } else {
      json(res, 400, { error: 'title and link required' });
    }
    return;
  }

  json(res, 404, { error: 'not found' });
});

// ── Start ────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`SleepMedic Distribution Service running on :${PORT}`);
  console.log(`  Health:       http://localhost:${PORT}/health`);
  console.log(`  Subscribe:    POST http://localhost:${PORT}/subscribe`);
  console.log(`  App interest: POST http://localhost:${PORT}/app-interest`);
  console.log(`  Stats:        GET http://localhost:${PORT}/stats?key=...`);
  console.log(`  RSS poll:     every ${POLL_INTERVAL / 60000} minutes`);
  console.log(`  Discord:      ${DISCORD_WEBHOOK_URL ? 'enabled' : 'disabled (set DISCORD_WEBHOOK_URL)'}`);
  console.log('');
});

// Poll RSS for new posts
async function pollLoop() {
  const post = await checkForNewPost();
  if (post) await distribute(post);
}

pollLoop(); // Check immediately on start
setInterval(pollLoop, POLL_INTERVAL);
