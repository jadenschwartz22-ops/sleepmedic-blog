#!/usr/bin/env node
// Deterministic SVG cover art. No APIs, no stock photos.
// The slug seeds a MOTIF (composition) so covers read as different at card size;
// the category picks the accent. Same slug always yields the same cover.
// Usage: node scripts/covers/make-cover.mjs <slug> <category> [outPath] [--motif=name]
import fs from 'node:fs';
import path from 'node:path';

const CATEGORY_COLORS = {
  science: '#60a5fa', tools: '#34d399', timing: '#fbbf24',
  trending: '#f472b6', troubleshooting: '#fb923c', special: '#a78bfa',
  philosophy: '#c4b5fd', 'shift work': '#a78bfa', 'life stages': '#f472b6',
  conditions: '#f472b6', 'sleep-hygiene': '#38bdf8', meta: '#34d399',
};

const W = 1200, H = 630, INK = '#f2ead9', BG = '#0a0a0c';

// xorshift PRNG seeded from the slug so covers are stable across rebuilds.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) / 4294967296); };
}

const stars = (rand, n, yMax, sizeMax) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += `<circle cx="${Math.round(rand() * W)}" cy="${Math.round(rand() * H * yMax)}" r="${(0.8 + rand() * sizeMax).toFixed(1)}" fill="${INK}" opacity="${(0.15 + rand() * 0.5).toFixed(2)}"/>`;
  }
  return s;
};

const moon = (x, y, r, o = 0.92) =>
  `<path d="M ${x} ${y - r} A ${r} ${r} 0 1 0 ${x + r * 1.04} ${y + r * 0.17} A ${r * 0.79} ${r * 0.79} 0 1 1 ${x} ${y - r} Z" fill="${INK}" opacity="${o}"/>`;

// A run of sine humps from x0 to x1, decaying toward calm.
const humps = (x0, x1, base, amp, w = 110, decay = 0.78) => {
  let d = '', x = x0, a = amp;
  while (x < x1) {
    d += ` C${x + w * 0.33} ${base - a} ${x + w * 0.67} ${base - a} ${x + w} ${base}`;
    d += ` C${x + w * 1.33} ${base + a * 0.8} ${x + w * 1.67} ${base + a * 0.8} ${x + w * 2} ${base}`;
    x += w * 2; a = Math.max(9, a * decay);
  }
  return d;
};

const qrs = (x, base, amp) =>
  `L${x - 28} ${base - amp * 1.6} L${x + 8} ${base + amp * 1.3} L${x + 32} ${base}`;

const wavePath = (d, accent, width = 7, opacity = 0.9) =>
  `<path d="${d}" fill="none" stroke="${accent}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;

// ── Motifs ──────────────────────────────────────────────────────────────────
// Each returns the scene between the background wash and nothing else.
// They differ in silhouette, not just in jitter, so a row of cards reads varied.
const MOTIFS = {
  // The original: one spike settling into a long calm wave, moon high right.
  settle(rand, accent) {
    const base = Math.round(H * 0.74), amp = 34, spike = Math.round(W * 0.27);
    const d = `M-10 ${base} H${spike - 60} ${qrs(spike, base, amp)} H${spike + 80}` + humps(spike + 80, W + 40, base, amp);
    return stars(rand, 46, 0.72, 1.6) + moon(Math.round(W * 0.7), Math.round(H * 0.26), 58) + wavePath(d, accent);
  },

  // Two sleep blocks with a waking gap between them. For split/segmented sleep.
  split(rand, accent) {
    const base = Math.round(H * 0.7), amp = 40;
    const a = `M-10 ${base}` + humps(0, W * 0.4, base, amp, 100, 0.94);
    const b = `M${Math.round(W * 0.6)} ${base}` + humps(W * 0.6, W + 40, base, amp, 100, 0.94);
    const gap = `<path d="M${Math.round(W * 0.42)} ${base} H${Math.round(W * 0.58)}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity="0.28" stroke-dasharray="2 16"/>`;
    return stars(rand, 34, 0.62, 1.4) + moon(Math.round(W * 0.5), Math.round(H * 0.26), 46) + wavePath(a, accent) + gap + wavePath(b, accent);
  },

  // A stack of bars of different lengths: menus, options, doses, durations.
  menu(rand, accent) {
    const lens = [0.5, 0.30, 0.68, 0.20];
    const x = Math.round(W * 0.16), gap = 74;
    // Centre the stack on the frame: its height is the span between first and
    // last bar, so the top starts half that span above the midline.
    const top = Math.round(H * 0.58 - (gap * (lens.length - 1)) / 2);
    let bars = '';
    lens.forEach((f, i) => {
      const y = top + i * gap;
      bars += `<path d="M${x} ${y} H${Math.round(x + W * f)}" stroke="${accent}" stroke-width="12" stroke-linecap="round" opacity="${(0.95 - i * 0.14).toFixed(2)}"/>`;
    });
    return stars(rand, 30, 0.28, 1.3) + moon(Math.round(W * 0.84), Math.round(H * 0.19), 40, 0.8) + bars;
  },

  // A flat, guarded line under an arc: protection, defense, holding a window.
  guard(rand, accent) {
    const base = Math.round(H * 0.78);
    const line = `<path d="M${Math.round(W * 0.12)} ${base} H${Math.round(W * 0.88)}" fill="none" stroke="${accent}" stroke-width="9" stroke-linecap="round"/>`;
    const arcR = Math.round(W * 0.38);
    const arc = `<path d="M${Math.round(W / 2 - arcR)} ${base - 30} A ${arcR} ${Math.round(arcR * 0.50)} 0 0 1 ${Math.round(W / 2 + arcR)} ${base - 30}" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" opacity="0.45"/>`;
    const ticks = [0.12, 0.88].map(f =>
      `<path d="M${Math.round(W * f)} ${base - 34} V${base + 34}" stroke="${accent}" stroke-width="6" stroke-linecap="round" opacity="0.8"/>`).join('');
    return stars(rand, 38, 0.5, 1.5) + line + arc + ticks;
  },

  // Sun low on the horizon, glow rising: light, morning, day-sleep, inertia.
  horizon(rand, accent) {
    const hy = Math.round(H * 0.72), sx = Math.round(W * 0.31), r = 62;
    const glow = `<radialGradient id="hz" cx="${(sx / W).toFixed(2)}" cy="${(hy / H).toFixed(2)}" r="0.62">
  <stop offset="0" stop-color="${accent}" stop-opacity="0.42"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<rect width="${W}" height="${H}" fill="url(#hz)"/>`;
    const disc = `<circle cx="${sx}" cy="${hy}" r="${r}" fill="${INK}" opacity="0.9"/>`;
    const land = `<path d="M0 ${hy} H${W}" stroke="${accent}" stroke-width="7" stroke-linecap="round" opacity="0.9"/>`;
    return glow + stars(rand, 22, 0.42, 1.2) + disc + land;
  },

  // A descending stair: winding down, decay, tapering caffeine or light.
  descend(rand, accent) {
    const x0 = Math.round(W * 0.12), y0 = Math.round(H * 0.34);
    const steps = 5, dx = Math.round((W * 0.76) / steps), dy = Math.round((H * 0.34) / steps);
    let d = `M${x0} ${y0}`;
    for (let i = 0; i < steps; i++) d += ` h${dx} v${dy}`;
    return stars(rand, 40, 0.55, 1.5) + moon(Math.round(W * 0.2), Math.round(H * 0.16), 40, 0.8) + wavePath(d, accent, 8);
  },

  // Nested arcs radiating from a single point: cycles, rotation, circadian.
  orbit(rand, accent) {
    const cx = Math.round(W * 0.28), cy = Math.round(H * 0.56);
    let rings = '';
    [90, 160, 235, 315].forEach((r, i) => {
      rings += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-width="${i === 0 ? 8 : 4}" opacity="${(0.75 - i * 0.15).toFixed(2)}"/>`;
    });
    return stars(rand, 42, 0.85, 1.5) + rings + moon(Math.round(W * 0.78), Math.round(H * 0.28), 52);
  },
};

const MOTIF_NAMES = Object.keys(MOTIFS);

export function coverSVG(slug, category, motifName) {
  const accent = CATEGORY_COLORS[String(category || '').toLowerCase()] || '#a78bfa';
  const rand = rng(slug);
  const pick = motifName || MOTIF_NAMES[Math.floor(rand() * MOTIF_NAMES.length)];
  const motif = MOTIFS[pick];
  if (!motif) throw new Error(`unknown motif "${pick}" (have: ${MOTIF_NAMES.join(', ')})`);

  // Ambient wash keyed to the accent, positioned per slug.
  const gx = (0.3 + rand() * 0.45).toFixed(2), gy = (0.18 + rand() * 0.3).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${BG}"/>
<radialGradient id="g" cx="${gx}" cy="${gy}" r="0.9">
  <stop offset="0" stop-color="${accent}" stop-opacity="0.16"/>
  <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
</radialGradient>
<rect width="${W}" height="${H}" fill="url(#g)"/>
${motif(rand, accent)}
</svg>\n`;
}

export const motifs = MOTIF_NAMES;

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const motifArg = argv.find(a => a.startsWith('--motif='))?.split('=')[1];
  const [slug, category, outArg] = argv.filter(a => !a.startsWith('--'));
  if (!slug) {
    console.error('usage: make-cover.mjs <slug> <category> [outPath] [--motif=name]');
    console.error(`motifs: ${MOTIF_NAMES.join(', ')}`);
    process.exit(1);
  }
  const out = outArg || path.join('blog', 'posts', 'images', `${slug}-cover.svg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, coverSVG(slug, category || 'science', motifArg));
  console.log(out);
}
