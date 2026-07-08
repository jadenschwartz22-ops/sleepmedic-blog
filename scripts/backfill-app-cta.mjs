#!/usr/bin/env node
/**
 * Backfill the tracked app-interest CTA across all blog posts. Idempotent.
 *
 *  1. Add app-interest.js before </body> if missing.
 *  2. Ensure one in-body .app-cta block (tracked) exists.
 *  3. Convert SleepMedic direct App Store links -> tracked CTA.
 *  4. Remove ProtoQuiz cross-promo paragraphs.
 *
 * Run: node scripts/backfill-app-cta.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const POSTS_DIR = 'blog/posts';
const SCRIPT_TAG =
  '  <script src="/assets/app-interest.js" data-pi="https://pi.sleepmedic.co/app-interest"></script>';
const APP_CTA_BLOCK = `      <div class="app-cta">
        <div class="app-cta-icon">SM</div>
        <div class="app-cta-text">
          <p>SleepMedic adapts to your actual schedule -- not a rigid ideal. Track consistency, get smart reminders, and see what's really working.</p>
          <a href="#" data-app-interest="post-cta">Download App</a>
        </div>
      </div>`;
const TRACKED_LINK = '<a href="#" data-app-interest="post-cta">Download App</a>';

// SleepMedic direct App Store link (any attrs) -> tracked CTA
const SM_DIRECT_RE =
  /<a\b[^>]*href="https:\/\/apps\.apple\.com\/[^"]*id6744752786"[^>]*>[^<]*<\/a>/gi;
// Whole ProtoQuiz cross-promo paragraph
const PROTOQUIZ_P_RE =
  /[ \t]*<p><em>Working in EMS\?[\s\S]*?data-ext-link="protoquiz"[\s\S]*?<\/em><\/p>\r?\n?/gi;

const isDupe = (name) => / 2\.html$/.test(name);

async function processFile(file) {
  const orig = await fs.readFile(file, 'utf8');
  let html = orig;
  const actions = [];

  // 4. Remove ProtoQuiz promo (do first so it can't be mistaken for a CTA)
  if (html.match(PROTOQUIZ_P_RE)) {
    html = html.replace(PROTOQUIZ_P_RE, '');
    actions.push('rm-protoquiz');
  }

  // 3. Convert SleepMedic direct link -> tracked CTA
  if (html.match(SM_DIRECT_RE)) {
    html = html.replace(SM_DIRECT_RE, TRACKED_LINK);
    actions.push('convert-direct');
  }

  // 2. Ensure an in-body tracked .app-cta block
  const hasAppCta = /class="app-cta"/.test(html);
  const hasTracked = /data-app-interest/.test(html);
  if (!hasAppCta) {
    // Insert before the newsletter/comments block; else after </article>; else before </main>/</body>
    let anchor = html.match(/[ \t]*<!-- Newsletter CTA -->|[ \t]*<div class="newsletter-cta"|[ \t]*<!-- Comments|[ \t]*<div class="comments-section"/);
    if (anchor) {
      const at = anchor.index;
      html = html.slice(0, at) + APP_CTA_BLOCK + '\n\n' + html.slice(at);
      actions.push('add-cta-block');
    } else if (/<\/article>/.test(html)) {
      html = html.replace('</article>', `</article>\n\n${APP_CTA_BLOCK}\n`);
      actions.push('add-cta-block');
    } else if (/<\/main>/.test(html)) {
      html = html.replace('</main>', `${APP_CTA_BLOCK}\n  </main>`);
      actions.push('add-cta-block');
    } else {
      actions.push('WARN:no-anchor-for-cta');
    }
  } else if (!hasTracked) {
    actions.push('WARN:app-cta-present-but-untracked');
  }

  // 1. Add script before </body>
  if (!/app-interest\.js/.test(html)) {
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${SCRIPT_TAG}\n</body>`);
      actions.push('add-script');
    } else {
      actions.push('WARN:no-body-close');
    }
  }

  if (html !== orig) {
    await fs.writeFile(file, html);
    return actions.length ? actions : ['changed'];
  }
  return [];
}

async function main() {
  const entries = await fs.readdir(POSTS_DIR);
  const posts = entries.filter((f) => f.endsWith('.html') && !isDupe(f)).sort();
  const dupes = entries.filter((f) => isDupe(f));

  let touched = 0;
  for (const f of posts) {
    const acts = await processFile(path.join(POSTS_DIR, f));
    if (acts.length) {
      touched++;
      console.log(`  ${f}\n    -> ${acts.join(', ')}`);
    }
  }
  console.log(`\n${touched} post(s) modified, ${posts.length - touched} already correct.`);

  // Cleanup: delete verified-unreferenced ' 2.html' post dupes
  if (dupes.length) {
    console.log(`\nDeleting ${dupes.length} duplicate file(s):`);
    for (const d of dupes) {
      await fs.unlink(path.join(POSTS_DIR, d));
      console.log(`  removed ${d}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
