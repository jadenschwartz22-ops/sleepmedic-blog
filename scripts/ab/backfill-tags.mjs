// Tag every post in posts-index.json that isn't already tagged.
// Safe to re-run — skips tagged slugs unless --force.
//
//   node scripts/ab/backfill-tags.mjs
//   node scripts/ab/backfill-tags.mjs --force

import fs from 'fs/promises';
import { spawn } from 'child_process';

const force = process.argv.includes('--force');

async function loadIndex() {
  return JSON.parse(await fs.readFile('blog/posts-index.json', 'utf8'));
}

async function loadTags() {
  try { return JSON.parse(await fs.readFile('blog/ab-tags.json', 'utf8')); }
  catch { return {}; }
}

function runTag(slug) {
  return new Promise((resolve, reject) => {
    const args = ['scripts/ab/tag-post.mjs', slug];
    if (force) args.push('--force');
    const child = spawn('node', args, { stdio: 'inherit', env: process.env });
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`tag-post exit ${code}`)));
  });
}

async function main() {
  const posts = await loadIndex();
  const tags = await loadTags();

  const todo = posts.filter(p => force || !tags[p.slug]);
  console.log(`${todo.length} posts to tag (${posts.length - todo.length} already tagged)`);

  let failures = 0;
  for (const p of todo) {
    try {
      await runTag(p.slug);
      await new Promise(r => setTimeout(r, 1500)); // gentle on the API
    } catch (err) {
      console.error(`[fail] ${p.slug}: ${err.message}`);
      failures++;
    }
  }
  console.log(`\nDone. ${todo.length - failures} tagged, ${failures} failures.`);
}

main().catch(err => { console.error(err); process.exit(1); });
