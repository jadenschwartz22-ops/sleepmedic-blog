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
 *   POST /plan-lead         { email, answers }  quiz -> free personalized plan
 *   POST /unsubscribe       { email }
 *   GET  /plan-leads        (admin, requires ?key=ADMIN_KEY)
 *   GET  /subscribers       (admin, requires ?key=ADMIN_KEY)
 *   POST /trigger-send      (webhook from GitHub Actions, requires ?key=ADMIN_KEY)
 *   GET  /health
 */

import http from 'http';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildPlan } from '../plan/engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ───────────────────────────────────────────

const PORT = process.env.PORT || 3847;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const FROM_EMAIL = process.env.FROM_EMAIL || 'SleepMedic <blog@sleepmedic.co>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ''; // receives daily subscriber-list backups
const PUBLIC_BASE = 'https://pi.sleepmedic.co';
const PLAN_URL = 'https://www.sleepmedic.co/plan/';
const RSS_URL = 'https://sleepmedic.co/blog/feed.xml';
const POLL_INTERVAL = 30 * 60 * 1000; // 30 minutes
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

const SUBS_PATH = path.join(__dirname, 'subscribers.json');
const LAST_POST_PATH = path.join(__dirname, '.last-post-guid.txt');
const APP_INTEREST_PATH = path.join(__dirname, 'app-interest.json');
const PLAN_LEADS_PATH = path.join(__dirname, 'plan-leads.json');

// Plan copy is engine-generated, but it lands in an HTML email — escape anyway.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Subscribers Store ────────────────────────────────

async function loadSubscribers() {
  try { return JSON.parse(await fs.readFile(SUBS_PATH, 'utf8')); }
  catch { return []; }
}

async function saveSubscribers(subs) {
  await fs.writeFile(SUBS_PATH, JSON.stringify(subs, null, 2));
}

// opts.skipWelcome: caller sends its own asset email instead (e.g. plan leads,
// who get the plan itself rather than the generic welcome).
async function addSubscriber(email, opts = {}) {
  email = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid email' };
  const subs = await loadSubscribers();
  if (subs.find(s => s.email === email)) return { ok: true, already: true };
  subs.push({ email, subscribedAt: new Date().toISOString(), source: opts.source || 'newsletter' });
  await saveSubscribers(subs);
  console.log(`+ subscriber: ${email} (total: ${subs.length})`);
  notifyDiscord(`**[NEWSLETTER] New subscriber** \`${email}\` \u2014 **total: ${subs.length}**`);
  if (!opts.skipWelcome) {
    sendWelcomeEmail(email).catch(err => console.error(`Welcome email failed for ${email}: ${err.message}`));
  }
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

// ── Plan Leads (quiz -> free personalized plan) ──────

async function loadPlanLeads() {
  try { return JSON.parse(await fs.readFile(PLAN_LEADS_PATH, 'utf8')); }
  catch { return []; }
}

// Append, dedupe by email keeping the latest answers.
async function savePlanLead(email, answers) {
  const leads = await loadPlanLeads();
  const existing = leads.findIndex(l => l.email === email);
  const entry = { email, answers, updatedAt: new Date().toISOString() };
  if (existing >= 0) {
    entry.firstSeen = leads[existing].firstSeen;
    leads[existing] = entry;
  } else {
    entry.firstSeen = entry.updatedAt;
    leads.push(entry);
  }
  await fs.writeFile(PLAN_LEADS_PATH, JSON.stringify(leads, null, 2));
  return { count: leads.length, returning: existing >= 0 };
}

// Compact email version of the plan. Same computed numbers as the web page —
// the engine runs again here rather than trusting anything from the client.
function planEmailHtml(plan, email) {
  const p = 'font-size:15px;line-height:1.6;margin:0 0 10px;';
  const muted = 'font-size:13px;line-height:1.55;color:#666;margin:0 0 4px;';

  const dayHtml = plan.days.map(d => `
    <h3 style="font-size:16px;margin:26px 0 2px;color:#111;">${esc(d.name)}</h3>
    <p style="${muted}">${esc(d.when)}</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:10px;">
      ${d.blocks.map(b => `
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;white-space:nowrap;font-size:14px;font-weight:600;color:#6d4bd8;">${esc(b.time)}</td>
        <td style="padding:8px 0;vertical-align:top;">
          <div style="font-size:14px;font-weight:600;color:#111;">${esc(b.title)}</div>
          <div style="font-size:14px;line-height:1.55;color:#333;">${esc(b.detail)}</div>
        </td>
      </tr>`).join('')}
    </table>`).join('');

  const struggleHtml = plan.struggleSections.map(s => `
    <h3 style="font-size:16px;margin:26px 0 6px;color:#111;">${esc(s.title)}</h3>
    <p style="${p}">${esc(s.body)}</p>
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${s.steps.map(x => `<li style="font-size:14px;line-height:1.6;color:#333;margin-bottom:4px;">${esc(x)}</li>`).join('')}
    </ul>`).join('');

  return `
    <div style="max-width:600px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#333;">
      <h2 style="margin-bottom:6px;color:#111;">${esc(plan.headline)}</h2>
      <p style="${muted}">${esc(plan.subhead)}</p>

      <table cellpadding="0" cellspacing="0" style="margin:20px 0;border-collapse:collapse;">
        <tr>
          <td style="padding-right:32px;">
            <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#888;font-weight:600;">Work day anchor</div>
            <div style="font-size:24px;font-weight:700;color:#6d4bd8;">${esc(plan.anchors.work)}</div>
          </td>
          <td>
            <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#888;font-weight:600;">Rest day anchor</div>
            <div style="font-size:24px;font-weight:700;color:#6d4bd8;">${esc(plan.anchors.rest)}</div>
          </td>
        </tr>
      </table>
      <p style="${muted}">${esc(plan.anchors.note)}</p>

      ${dayHtml}

      <h3 style="font-size:16px;margin:26px 0 6px;color:#111;">${esc(plan.patternNote.title)}</h3>
      <p style="${p}">${esc(plan.patternNote.body)}</p>

      ${struggleHtml}
      ${plan.caffeineNote ? `<p style="${p}padding:12px;background:#f5f3ff;border-radius:8px;">${esc(plan.caffeineNote.text)}</p>` : ''}

      <h3 style="font-size:16px;margin:26px 0 6px;color:#111;">${esc(plan.consistency.title)}</h3>
      <p style="${p}">${esc(plan.consistency.body)}</p>

      <p style="margin:28px 0;">
        <a href="${PLAN_URL}" style="display:inline-block;padding:12px 24px;background:#a78bfa;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">View or reprint your plan</a>
      </p>
      <p style="${muted}">Every time above is calculated from the two wake times you gave us. This is general guidance for healthy adults, not medical advice.</p>

      <hr style="margin:32px 0;border:none;border-top:1px solid #eee;">
      ${unsubFooter(email)}
    </div>
  `;
}

async function sendPlanEmail(email, plan) {
  await sendEmail(email, 'Your SleepMedic sleep plan', planEmailHtml(plan, email));
  console.log(`Plan email sent to ${email}`);
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

  // Plan lead: quiz completion -> store, subscribe, email the plan
  if (url.pathname === '/plan-lead' && req.method === 'POST') {
    const body = await parseBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { json(res, 400, { error: 'invalid email' }); return; }

    // The answers must produce a real plan before we accept the lead.
    const plan = buildPlan(body.answers || {});
    if (!plan.ok) { json(res, 400, { error: 'invalid answers', fields: plan.errors }); return; }

    const { count, returning } = await savePlanLead(email, plan.answers);
    // skipWelcome: plan leads get the plan, not the generic welcome.
    await addSubscriber(email, { skipWelcome: true, source: 'plan' });

    json(res, 200, { ok: true, emailed: true });
    notifyDiscord(`**[PLAN] Quiz completed** \`${email}\` — pattern: \`${plan.answers.pattern}\`, struggle: \`${plan.answers.struggle}\`${returning ? ' (repeat)' : ''} — **total plan leads: ${count}**`);
    sendPlanEmail(email, plan).catch(err => console.error(`Plan email failed for ${email}: ${err.message}`));
    return;
  }

  // Admin: plan leads
  if (url.pathname === '/plan-leads' && url.searchParams.get('key') === ADMIN_KEY) {
    const leads = await loadPlanLeads();
    json(res, 200, { count: leads.length, leads });
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
  console.log(`  Plan lead:    POST http://localhost:${PORT}/plan-lead`);
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
