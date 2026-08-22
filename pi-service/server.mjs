/**
 * SleepMedic Distribution Service (Raspberry Pi)
 *
 * Runs on Pi as a persistent Node.js service. Three jobs:
 * 1. Newsletter: accepts email signups, stores in subscribers.json, sends via Resend
 * 2. RSS Watcher: polls RSS feed every 30min, detects new posts, triggers distribution
 * 3. Distribution: on new post -> send newsletter
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
const FROM_EMAIL = process.env.FROM_EMAIL || 'SleepMedic <blog@sleepmedic.co>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ''; // receives daily subscriber-list backups
const PUBLIC_BASE = 'https://pi.sleepmedic.co';
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
  sendWelcomeEmail(email).catch(err => console.error(`Welcome email failed for ${email}: ${err.message}`));
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

function unsubFooter(email) {
  return `<p style="font-size:12px;color:#999;">You signed up at sleepmedic.co. <a href="${PUBLIC_BASE}/unsubscribe?email=${encodeURIComponent(email)}" style="color:#999;">Unsubscribe</a></p>`;
}

async function sendWelcomeEmail(email) {
  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#333;">
      <h2 style="margin-bottom:8px;">You're in.</h2>
      <p style="font-size:16px;line-height:1.6;">SleepMedic is sleep science for people who sleep against the clock &mdash; shift workers, night crews, new parents. No 9-to-5 assumptions, every claim cited.</p>
      <p style="font-size:16px;line-height:1.6;">Start with the page readers use most:</p>
      <a href="https://www.sleepmedic.co/blog/posts/shift-worker-sleep-protocol.html" style="display:inline-block;padding:12px 24px;background:#a78bfa;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">The Shift Worker Sleep Protocol</a>
      <p style="font-size:16px;line-height:1.6;margin-top:24px;">From here: one short brief when there's something worth your time. No filler, no daily drip.</p>
      <hr style="margin:32px 0;border:none;border-top:1px solid #eee;">
      ${unsubFooter(email)}
    </div>
  `;
  await sendEmail(email, 'Welcome to SleepMedic', html);
  console.log(`Welcome email sent to ${email}`);
}

// Daily off-card backup: email the subscriber list to ADMIN_EMAIL when it changes.
let lastBackupHash = '';
async function backupSubscribers() {
  if (!ADMIN_EMAIL) return;
  try {
    const subs = await loadSubscribers();
    const payload = JSON.stringify(subs, null, 2);
    const hash = String(payload.length) + ':' + subs.length;
    if (hash === lastBackupHash) return;
    await sendEmail(ADMIN_EMAIL, `[backup] SleepMedic subscribers (${subs.length})`,
      `<p>Daily subscriber-list backup. Save this email; it is the off-device copy.</p><pre style="font-size:12px">${payload.replace(/</g, '&lt;')}</pre>`);
    lastBackupHash = hash;
    console.log(`Subscriber backup emailed (${subs.length} subs)`);
  } catch (err) {
    console.error(`Backup failed: ${err.message}`);
  }
}
setInterval(backupSubscribers, 24 * 60 * 60 * 1000);
setTimeout(backupSubscribers, 60 * 1000); // once shortly after boot

async function sendNewsletter(post) {
  const subs = await loadSubscribers();
  if (!subs.length) { console.log('No subscribers, skipping newsletter'); return; }

  const subject = `New from SleepMedic: ${post.title}`;
  const htmlFor = (email) => `
    <div style="max-width:560px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#333;">
      <h2 style="margin-bottom:8px;">${post.title}</h2>
      <p style="color:#666;font-size:14px;margin-bottom:16px;">${post.date}</p>
      <p style="font-size:16px;line-height:1.6;margin-bottom:24px;">${post.excerpt}</p>
      <a href="${post.link}" style="display:inline-block;padding:12px 24px;background:#a78bfa;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Read the full post</a>
      <hr style="margin:32px 0;border:none;border-top:1px solid #eee;">
      ${unsubFooter(email)}
    </div>
  `;

  console.log(`Sending newsletter to ${subs.length} subscribers...`);
  let sent = 0;
  for (const sub of subs) {
    try {
      await sendEmail(sub.email, subject, htmlFor(sub.email));
      sent++;
      // Resend free tier: 2 emails/second
      if (sent % 2 === 0) await new Promise(r => setTimeout(r, 1100));
    } catch (err) {
      console.error(`Failed to send to ${sub.email}: ${err.message}`);
    }
  }
  console.log(`Newsletter sent to ${sent}/${subs.length}`);
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
