#!/usr/bin/env node
// Deterministic SVG cover art. No APIs, no stock photos: category color,
// a slug-seeded starfield, and the brand pulse-to-wave line.
// Usage: node scripts/covers/make-cover.mjs <slug> <category> [outPath]
import fs from 'node:fs';
import path from 'node:path';

const CATEGORY_COLORS = {
  science: '#60a5fa', tools: '#34d399', timing: '#fbbf24',
  trending: '#f472b6', troubleshooting: '#fb923c', special: '#a78bfa',
  philosophy: '#c4b5fd', 'shift work': '#a78bfa', 'life stages': '#f472b6',
};

// xorshift PRNG seeded from the slug so covers are stable across rebuilds.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) / 4294967296);
  };
}

export function coverSVG(slug, category) {
  const accent = CATEGORY_COLORS[category] || '#a78bfa';
  const rand = rng(slug);
  const W = 1200, H = 630;

  let stars = '';
  for (let i = 0; i < 46; i++) {
    const x = Math.round(rand() * W);
    const y = Math.round(rand() * H * 0.72);
    const r = (0.8 + rand() * 1.6).toFixed(1);
    const o = (0.15 + rand() * 0.5).toFixed(2);
    stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="#f2ead9" opacity="${o}"/>`;
  }

  // Wave baseline varies a little per post so the set feels alive, not cloned.
  const base = Math.round(H * (0.66 + rand() * 0.12));
  const amp = Math.round(28 + rand() * 26);
  const spikeX = Math.round(W * (0.18 + rand() * 0.18));
  const moonX = Math.round(W * (0.62 + rand() * 0.2));
  const moonY = Math.round(H * (0.2 + rand() * 0.14));
  const moonR = Math.round(52 + rand() * 22);

  let wave = `M-10 ${base} H${spikeX - 60} L${spikeX - 28} ${base - amp * 1.6} L${spikeX + 8} ${base + amp * 1.3} L${spikeX + 32} ${base} H${spikeX + 80}`;
  let x = spikeX + 80;
  let a = amp;
  while (x < W + 40) {
    const w = 110;
    wave += ` C${x + w * 0.33} ${base - a} ${x + w * 0.67} ${base - a} ${x + w} ${base}`;
    wave += ` C${x + w * 1.33} ${base + a * 0.8} ${x + w * 1.67} ${base + a * 0.8} ${x + w * 2} ${base}`;
    x += w * 2;
    a = Math.max(10, a * 0.72);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#0a0a0c"/>
<radialGradient id="g" cx="${(moonX / W).toFixed(2)}" cy="${(moonY / H).toFixed(2)}" r="0.9">
  <stop offset="0" stop-color="${accent}" stop-opacity="0.14"/>
  <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
</radialGradient>
<rect width="${W}" height="${H}" fill="url(#g)"/>
${stars}
<path d="M ${moonX} ${moonY - moonR} A ${moonR} ${moonR} 0 1 0 ${moonX + moonR * 1.04} ${moonY + moonR * 0.17} A ${moonR * 0.79} ${moonR * 0.79} 0 1 1 ${moonX} ${moonY - moonR} Z" fill="#f2ead9" opacity="0.92"/>
<path d="${wave}" fill="none" stroke="${accent}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
</svg>\n`;
}

const [slug, category, outArg] = process.argv.slice(2);
if (slug) {
  const out = outArg || path.join('blog', 'posts', 'images', `${slug}-cover.svg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, coverSVG(slug, category || 'science'));
  console.log(out);
}
