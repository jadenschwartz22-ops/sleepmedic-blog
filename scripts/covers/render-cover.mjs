#!/usr/bin/env node
// SVG cover -> JPG at 1200x630 (og:image). macOS only: qlmanage renders, sips converts.
// Usage: node scripts/covers/render-cover.mjs <slug> <category> [--motif=name]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coverSVG } from './make-cover.mjs';

const argv = process.argv.slice(2);
const motif = argv.find(a => a.startsWith('--motif='))?.split('=')[1];
const [slug, category] = argv.filter(a => !a.startsWith('--'));
if (!slug) { console.error('usage: render-cover.mjs <slug> <category> [--motif=name]'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-'));
const svg = path.join(tmp, `${slug}.svg`);
// qlmanage always thumbnails into a SQUARE canvas and does not letterbox
// predictably, so pad the art into a square ourselves: the 1200x630 cover is
// centred in a 1200x1200 field, and the known padding is cropped back off.
const art = coverSVG(slug, category || 'science', motif)
  .replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const PAD = (1200 - 630) / 2;
fs.writeFileSync(svg, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">` +
  `<rect width="1200" height="1200" fill="#0a0a0c"/>` +
  `<g transform="translate(0 ${PAD})">${art}</g></svg>\n`);

// qlmanage renders into a square canvas, letterboxing the 1200x630 art.
// Render at 2x for a clean downscale, then CROP the padding away (-c keeps
// aspect by cutting, unlike -z which stretches).
execFileSync('qlmanage', ['-t', '-s', '2400', '-o', tmp, svg], { stdio: 'ignore' });
const png = path.join(tmp, `${slug}.svg.png`);
if (!fs.existsSync(png)) throw new Error(`qlmanage produced no thumbnail for ${svg}`);

const out = path.join('blog', 'posts', 'images', `${slug}-cover.jpg`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const w = Number(execFileSync('sips', ['-g', 'pixelWidth', png]).toString().match(/pixelWidth: (\d+)/)[1]);
execFileSync('sips', ['-c', String(Math.round(w * 630 / 1200)), String(w), png], { stdio: 'ignore' });
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
  '--resampleWidth', '1200', png, '--out', out], { stdio: 'ignore' });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(out);
