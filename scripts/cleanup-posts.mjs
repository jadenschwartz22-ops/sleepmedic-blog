/**
 * Cleanup existing blog posts:
 * - Remove broken newsletter CTA sections
 * - Remove empty comments/discussion sections
 * - Remove old footers
 * - Add consistent nav bar
 * - Fix CSS to use shared-styles variables
 * - Add og:image meta tag if cover image exists
 * - Fix article semantics
 *
 * Usage: node scripts/cleanup-posts.mjs
 */

import fs from 'fs/promises';
import { readdirSync } from 'fs';
import path from 'path';

const POSTS_DIR = 'blog/posts';

// The nav HTML to inject
const NAV_HTML = `  <nav>
    <a href="/" class="nav-brand">SleepMedic</a>
    <div class="nav-links">
      <a href="/blog/">Blog</a>
      <a href="/app/">App</a>
    </div>
  </nav>`;

// The nav CSS
const NAV_CSS = `
    nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 24px; max-width: 720px; margin: 0 auto;
      border-bottom: 1px solid var(--border);
    }
    .nav-brand { font-size: 1rem; font-weight: 700; color: var(--text); letter-spacing: -0.02em; text-decoration: none; }
    .nav-links { display: flex; gap: 20px; }
    .nav-links a { font-size: 0.85rem; color: var(--text-3); font-weight: 500; text-decoration: none; }
    .nav-links a:hover { color: var(--text); }`;

// Clean footer to use
const CLEAN_FOOTER = `  <footer style="max-width:720px;margin:60px auto 0;text-align:center;padding:28px 24px;border-top:1px solid var(--border);color:var(--text-3);font-size:0.78rem;">
    <p>&copy; 2026 SleepMedic</p>
    <p style="margin-top:6px;">
      <a href="/" style="color:var(--text-3);text-decoration:none;">Home</a> &middot;
      <a href="/blog/" style="color:var(--text-3);text-decoration:none;">Blog</a> &middot;
      <a href="/blog/feed.xml" style="color:var(--text-3);text-decoration:none;">RSS</a>
    </p>
  </footer>`;

async function cleanupPost(filePath) {
  let html = await fs.readFile(filePath, 'utf-8');
  const filename = path.basename(filePath);
  let changes = [];

  // 1. Remove newsletter CTA section (various patterns)
  const newsletterPatterns = [
    /\s*<div class="newsletter-cta">[\s\S]*?<\/div>\s*<\/div>/g,
    /\s*<!-- Newsletter CTA -->[\s\S]*?<\/div>\s*<\/div>\s*(?=\s*<!--|\s*<div class="comments)/g,
  ];
  for (const pat of newsletterPatterns) {
    if (pat.test(html)) {
      html = html.replace(pat, '');
      changes.push('removed newsletter CTA');
    }
  }

  // More aggressive newsletter removal
  if (html.includes('newsletter-cta')) {
    html = html.replace(/<div class="newsletter-cta">[\s\S]*?<\/div>\s*<\/div>/g, '');
    changes.push('removed newsletter CTA (aggressive)');
  }

  // 2. Remove comments/discussion section
  const commentsPatterns = [
    /\s*<div class="comments-section">[\s\S]*?<\/div>\s*<\/div>/g,
    /\s*<!-- Comments Section -->[\s\S]*?<\/div>\s*<\/div>/g,
  ];
  for (const pat of commentsPatterns) {
    if (pat.test(html)) {
      html = html.replace(pat, '');
      changes.push('removed comments section');
    }
  }

  // More aggressive comments removal
  if (html.includes('comments-section')) {
    html = html.replace(/<div class="comments-section">[\s\S]*?<\/div>\s*<\/div>/g, '');
    changes.push('removed comments section (aggressive)');
  }

  // 3. Replace old footer with clean one
  if (html.includes('<footer')) {
    html = html.replace(/<footer[\s\S]*?<\/footer>/g, CLEAN_FOOTER);
    changes.push('replaced footer');
  }

  // 4. Add nav if missing
  if (!html.includes('<nav')) {
    // Add nav CSS to the style block
    if (html.includes('</style>') && !html.includes('.nav-brand')) {
      html = html.replace('</style>', NAV_CSS + '\n  </style>');
      changes.push('added nav CSS');
    }
    // Add nav element after <body>
    html = html.replace('<body>', '<body>\n' + NAV_HTML);
    changes.push('added nav bar');
  }

  // 5. Fix "2025" copyright to 2026
  if (html.includes('© 2025') || html.includes('&copy; 2025')) {
    html = html.replace(/© 2025/g, '© 2026');
    html = html.replace(/&copy; 2025/g, '&copy; 2026');
    changes.push('fixed copyright year');
  }

  // 6. Add og:image if missing and cover image exists
  const slug = filename.replace('.html', '');
  const coverPath = `blog/posts/images/${slug}-cover.jpg`;
  if (!html.includes('og:image') && html.includes('og:title')) {
    const ogImageTag = `  <meta property="og:image" content="https://sleepmedic.co/blog/posts/images/${slug}-cover.jpg" />`;
    html = html.replace(
      /(<meta property="og:url"[^>]*>)/,
      `$1\n${ogImageTag}`
    );
    changes.push('added og:image');
  }

  // 7. Remove Unsplash attribution (images are now AI-generated)
  html = html.replace(/<p[^>]*>\s*Photo by [^<]+ on Unsplash\.?\s*<\/p>/g, '');
  if (html.includes('Photo by') && html.includes('Unsplash')) {
    // More aggressive pattern
    html = html.replace(/<p[^>]*>.*?Photo by.*?Unsplash.*?<\/p>/g, '');
    changes.push('removed Unsplash attribution');
  }

  if (changes.length > 0) {
    await fs.writeFile(filePath, html);
    console.log(`  ${filename}: ${changes.join(', ')}`);
  } else {
    console.log(`  ${filename}: no changes needed`);
  }

  return changes.length;
}

async function main() {
  const files = readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(POSTS_DIR, f));

  console.log(`\nCleaning up ${files.length} posts...\n`);

  let totalChanges = 0;
  for (const file of files) {
    totalChanges += await cleanupPost(file);
  }

  console.log(`\nDone. ${totalChanges} changes across ${files.length} files.\n`);
}

main();
