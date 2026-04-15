#!/usr/bin/env node
/**
 * One-time migration: rewrite existing posts to use the app-interest smokescreen
 * and add newsletter/post-view GA4 tracking. Idempotent.
 *
 * Usage: node scripts/migrate-smokescreen.mjs
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '..', 'blog', 'posts');

const OLD_NAV_CSS = `.nav-links { display: flex; gap: 20px; }
    .nav-links a { font-size: 0.85rem; color: var(--text-3); font-weight: 500; }
    .nav-links a:hover { color: var(--text); }`;

const NEW_NAV_CSS = `.nav-links { display: flex; gap: 16px; align-items: center; }
    .nav-links a { font-size: 0.85rem; color: var(--text-3); font-weight: 500; }
    .nav-links a:hover { color: var(--text); }
    .nav-cta { padding: 7px 14px; background: rgba(167,139,250,0.10); border: 1px solid rgba(167,139,250,0.25); border-radius: 8px; color: var(--accent) !important; font-size: 0.8rem !important; font-weight: 600 !important; cursor: pointer; font-family: inherit; }
    .nav-cta:hover { background: rgba(167,139,250,0.18); color: var(--text) !important; }`;

const OLD_NAV = `<div class="nav-links">
      <a href="/blog/">Blog</a>
      <a href="/app/">App</a>
    </div>`;

const NEW_NAV = `<div class="nav-links">
      <a href="/blog/">Blog</a>
      <a href="/blog/feed.xml">RSS</a>
      <button type="button" class="nav-cta" data-app-interest="post-nav">Download App</button>
    </div>`;

const OLD_CTA_LEARN = `<a href="/app/">Learn More</a>`;
const NEW_CTA_LEARN = `<a href="#" data-app-interest="post-cta">Download App</a>`;

const SCRIPT_INJECT = `<script src="/assets/app-interest.js" data-pi="https://pi.sleepmedic.co/app-interest"></script>\n\n  `;

async function migrate() {
  const files = (await fs.readdir(POSTS_DIR)).filter(f => f.endsWith('.html'));
  let touched = 0, skipped = 0;

  for (const f of files) {
    const p = path.join(POSTS_DIR, f);
    let html = await fs.readFile(p, 'utf8');
    const orig = html;

    if (html.includes(OLD_NAV_CSS)) html = html.replace(OLD_NAV_CSS, NEW_NAV_CSS);
    if (html.includes(OLD_NAV)) html = html.replace(OLD_NAV, NEW_NAV);
    if (html.includes(OLD_CTA_LEARN)) html = html.replace(OLD_CTA_LEARN, NEW_CTA_LEARN);

    // Inject the app-interest script once, right before the first non-head <script> block that contains the reading progress
    if (!html.includes('/assets/app-interest.js')) {
      html = html.replace(
        /(  <script>\n    \/\/ Reading progress bar)/,
        SCRIPT_INJECT + '$1'
      );
    }

    if (html !== orig) {
      await fs.writeFile(p, html);
      touched++;
      console.log('migrated:', f);
    } else {
      skipped++;
    }
  }

  console.log(`\nDone. Migrated: ${touched}, already current: ${skipped}`);
}

migrate().catch(err => { console.error(err); process.exit(1); });
