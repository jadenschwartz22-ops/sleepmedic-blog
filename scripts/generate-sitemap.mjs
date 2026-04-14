/**
 * Generate XML Sitemap for SleepMedic
 * Reads posts-index.json and outputs sitemap.xml at repo root.
 */

import fs from 'fs/promises';
import chalk from 'chalk';

const BASE = 'https://sleepmedic.co';

const STATIC_PAGES = [
  { loc: '/',        priority: '1.0', changefreq: 'monthly' },
  { loc: '/blog/',   priority: '0.9', changefreq: 'weekly' },
  { loc: '/app/',    priority: '0.5', changefreq: 'monthly' },
  { loc: '/privacy/', priority: '0.3', changefreq: 'yearly' },
];

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  let xml = `  <url>\n    <loc>${escapeXml(loc)}</loc>`;
  if (lastmod)    xml += `\n    <lastmod>${lastmod}</lastmod>`;
  if (changefreq) xml += `\n    <changefreq>${changefreq}</changefreq>`;
  if (priority)   xml += `\n    <priority>${priority}</priority>`;
  return xml + '\n  </url>';
}

async function main() {
  let posts = [];
  try {
    posts = JSON.parse(await fs.readFile('blog/posts-index.json', 'utf8'));
  } catch {
    console.log(chalk.yellow('No posts-index.json found -- generating sitemap with static pages only'));
  }

  const entries = [
    ...STATIC_PAGES.map(p => urlEntry({ loc: `${BASE}${p.loc}`, changefreq: p.changefreq, priority: p.priority })),
    ...posts.map(p => urlEntry({
      loc: `${BASE}/blog/posts/${p.slug}.html`,
      lastmod: p.date,
      changefreq: 'monthly',
      priority: '0.7',
    })),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');

  await fs.writeFile('sitemap.xml', xml, 'utf8');
  console.log(chalk.green(`Sitemap generated with ${STATIC_PAGES.length} static pages + ${posts.length} blog posts`));
}

main().catch(err => { console.error(chalk.red('Sitemap generation failed:'), err); process.exit(1); });
