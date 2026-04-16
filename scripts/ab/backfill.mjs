// Run classify.mjs over every post in posts-index.json.
// Safe to re-run; skips already-tagged slugs unless --force.

import fs from 'fs/promises';
import { spawn } from 'child_process';
import { TAGS_PATH } from './paths.mjs';

const force = process.argv.includes('--force');

async function loadIndex() {
  return JSON.parse(await fs.readFile('blog/posts-index.json', 'utf8'));
}

async function loadTags() {
  try { return JSON.parse(await fs.readFile(TAGS_PATH, 'utf8')); }
  catch { return {}; }
}

function runOne(slug) {
  return new Promise((resolve) => {
    const args = ['scripts/ab/classify.mjs', slug];
    if (force) args.push('--force');
    const child = spawn('node', args, { stdio: 'inherit', env: process.env });
    child.on('close', code => resolve(code === 0));
  });
}

async function main() {
  const posts = await loadIndex();
  const tags = await loadTags();

  const todo = posts.filter(p => force || !tags[p.slug]);
  console.log(`${todo.length} posts to tag (${posts.length - todo.length} already tagged)`);

  let ok = 0, fail = 0;
  for (const p of todo) {
    const success = await runOne(p.slug);
    if (success) ok++; else fail++;
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`\nDone. ${ok} tagged, ${fail} failures.`);
}

main().catch(err => { console.error(err); process.exit(1); });
