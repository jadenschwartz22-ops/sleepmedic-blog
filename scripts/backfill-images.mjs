/**
 * Backfill missing/broken cover images for blog posts.
 *
 * Pipeline:
 *   1. Generate image with gemini-2.5-flash-image
 *   2. QA pass: gemini-2.5-flash (vision) scores it against a strict rubric
 *   3. If rejected and attempts left, regenerate with retry_hint appended
 *   4. Hard cap: MAX_ATTEMPTS (default 3)
 *
 * Injects cover <img> and og:image meta into post HTML if missing.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx node scripts/backfill-images.mjs
 *   GEMINI_API_KEY=xxx node scripts/backfill-images.mjs --force
 *   GEMINI_API_KEY=xxx node scripts/backfill-images.mjs --dry-run
 */

import fs from 'fs/promises';
import { existsSync, statSync } from 'fs';

const API_KEY = process.env.GEMINI_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

if (!API_KEY && !DRY_RUN) { console.error('GEMINI_API_KEY required (or pass --dry-run)'); process.exit(1); }

const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || '3', 10);
const MIN_SIZE = 5000;

// Rough cost estimates for reporting (USD)
const COST_IMAGE = 0.04;
const COST_VISION = 0.002;
let totalCost = 0;

const BASE_RULES = `Professional editorial blog cover photograph, landscape 16:9, photorealistic.
Hard constraints (MUST all be true):
- No clocks, no watches, no visible time displays of any kind.
- Lighting MUST match the implied time of day (morning = warm dawn light, night = dark with lamp/moon light, dusk = purple/orange).
- No text, no typography, no watermarks, no logos, no UI overlays.
- No visible human faces; hands, silhouettes, or body parts from behind are OK.
- No extra fingers, no melted or impossible geometry, no AI artifacts.
- Calm, editorial aesthetic. Shallow depth of field OK.`;

// Scene prompts -- slug -> scene description (BASE_RULES is appended automatically)
const scenePrompts = {
  '2026-04-06-sleepy-girl-mocktail-decoding-the-trend-for-better-sleep':
    'A single mocktail glass on a dark wooden nightstand, garnished with a tart cherry and a mint sprig, condensation on the glass, a small bowl of magnesium powder nearby, soft warm lamp light from the side, moody low-key bedroom atmosphere, deep blues and warm amber tones.',

  '2026-03-30-reclaiming-your-rest-debunking-myths-to-fix-a-destroyed-sleep-schedule':
    'Rumpled white linen sheets on an unmade bed, soft early-morning sunlight streaming diagonally through a window, a half-open journal and pen resting on the bedside, fresh start atmosphere, pale amber and cool grey palette, calm and hopeful mood.',

  '2026-03-23-box-breathing-4-7-8-simple-techniques-for-faster-sleep':
    'Top-down view of a person\'s hands folded calmly over the chest during a slow deep breath, only torso and hands visible, soft bedding beneath, cool blue pre-sleep lighting from a single window, meditative stillness, editorial photography.',

  // Legacy prompts kept for re-runs with --force
  '2026-03-01-sleepmaxxing-decoding-the-trend-science-and-actionable-steps':
    'Cozy bedroom at dawn, diffused golden light through sheer curtains, rumpled white linen sheets, a sleep tracker device on the nightstand next to a glass of water, warm muted tones, shallow depth of field.',
  '2026-02-23-harnessing-nsdr-and-yoga-nidra-for-better-sleep':
    'A yoga mat in a dimly lit room with warm amber light, soft blanket draped, candle glow in background, peaceful meditative atmosphere, no person visible.',
  '2026-02-02-what-time-should-i-sleep-and-wake':
    'Split editorial composition: left half shows warm sunset through a window over a neat bedroom, right half shows soft morning light through the same window. No clocks. Clean minimal bedroom.',
  '2026-01-26-box-breathing-and-4-7-8-technique-for-better-sleep':
    'Close-up of hands resting on a chest during a deep breath, soft blue moonlight filtering through a window, calm bedroom scene, muted navy and warm tones.',
  '2026-01-19-the-unexpected-connection-between-memory-consolidation-during-rem-vs-deep-sleep-':
    'Abstract visualization of brain waves during sleep, soft glowing neural pathways in deep blue and purple against a dark background, scientific yet calming.'
};

// ─── Gemini calls ────────────────────────────────────────

async function generateImage(scenePrompt, retryHint) {
  const fullPrompt = `${BASE_RULES}\n\nScene: ${scenePrompt}${retryHint ? `\n\nIMPORTANT FIX FROM PRIOR ATTEMPT: ${retryHint}` : ''}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9' }
      }
    })
  });

  totalCost += COST_IMAGE;

  if (!res.ok) throw new Error(`image API ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart) throw new Error('no image in response');
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

async function qaImage(imageBuffer, scenePrompt) {
  const rubric = `You are a strict image QA for an evidence-based sleep blog. Evaluate this image against the brief.

Brief: ${scenePrompt}

Reject if ANY are true:
1. A clock, watch, phone time display, or any specific time is visible.
2. Lighting contradicts the implied time of day (e.g., bright daylight outside a window when scene implies night).
3. Text, watermarks, logos, or UI overlays appear.
4. A human face is visible.
5. Obvious AI artifacts: extra fingers, melted objects, incorrect anatomy, impossible geometry.
6. The subject meaningfully mismatches the brief.
7. Low quality, blurry in a non-intentional way, or clearly amateur.

Respond with ONLY a JSON object (no markdown):
{"approved": boolean, "issues": [string], "retry_hint": string}
Keep retry_hint under 200 chars and phrase as a corrective instruction.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: rubric },
          { inlineData: { mimeType: 'image/jpeg', data: imageBuffer.toString('base64') } }
        ]
      }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
    })
  });

  totalCost += COST_VISION;

  if (!res.ok) {
    console.warn(`    QA call failed (${res.status}) — auto-approving`);
    return { approved: true, issues: [], retry_hint: '' };
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  try { return JSON.parse(text); }
  catch { return { approved: true, issues: ['QA parse failed'], retry_hint: '' }; }
}

// ─── HTML injection ──────────────────────────────────────

async function ensureImageInHtml(slug) {
  const htmlPath = `blog/posts/${slug}.html`;
  if (!existsSync(htmlPath)) return false;

  let html = await fs.readFile(htmlPath, 'utf8');
  const before = html;
  const coverRel = `images/${slug}-cover.jpg`;
  const coverAbs = `https://sleepmedic.co/blog/posts/${coverRel}`;

  // og:image
  if (!/<meta property="og:image"/.test(html)) {
    html = html.replace(
      /(<meta property="og:url"[^>]*>)/,
      `$1\n  <meta property="og:image" content="${coverAbs}" />\n  <meta name="twitter:image" content="${coverAbs}" />`
    );
  }

  // Visible <img> right after <article class="post-header"> or first <h1>
  if (!/<img[^>]+-cover\.jpg/.test(html)) {
    const imgTag = `\n        <img src="${coverRel}" alt="Cover image for post" style="width:100%;max-height:400px;object-fit:cover;border-radius:24px;margin-bottom:24px;" loading="lazy">`;
    if (/<article class="post-header">/.test(html)) {
      html = html.replace(/(<article class="post-header">)/, `${imgTag}\n      $1`);
    } else if (/<h1[^>]*>/.test(html)) {
      html = html.replace(/(<h1[^>]*>)/, `${imgTag}\n        $1`);
    }
  }

  if (html !== before) {
    await fs.writeFile(htmlPath, html);
    return true;
  }
  return false;
}

// ─── Main ────────────────────────────────────────────────

async function processSlug(slug, scenePrompt) {
  const imgPath = `blog/posts/images/${slug}-cover.jpg`;
  const exists = existsSync(imgPath);
  const size = exists ? statSync(imgPath).size : 0;

  if (!FORCE && exists && size >= MIN_SIZE) {
    console.log(`SKIP   ${slug.slice(0, 60)}  (${(size/1024).toFixed(0)}KB)`);
    const injected = await ensureImageInHtml(slug);
    if (injected) console.log(`       HTML updated with cover/og:image`);
    return;
  }

  console.log(`\nGEN    ${slug.slice(0, 60)}${FORCE && exists ? ' (forced)' : ''}`);

  if (DRY_RUN) { console.log('       [dry-run, skipping API]'); return; }

  let retryHint = '';
  let lastBuffer = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`       attempt ${attempt}/${MAX_ATTEMPTS}${retryHint ? ` (hint: ${retryHint.slice(0,80)})` : ''}`);
      const buffer = await generateImage(scenePrompt, retryHint);
      lastBuffer = buffer;

      const qa = await qaImage(buffer, scenePrompt);
      if (qa.approved) {
        console.log(`       QA PASS (${(buffer.length/1024).toFixed(0)}KB)`);
        break;
      } else {
        console.log(`       QA FAIL: ${(qa.issues || []).join('; ')}`);
        retryHint = qa.retry_hint || (qa.issues || []).join('; ');
        if (attempt === MAX_ATTEMPTS) console.log(`       hit max attempts, saving last image`);
      }
    } catch (err) {
      console.error(`       ERROR: ${err.message}`);
      if (attempt === MAX_ATTEMPTS && !lastBuffer) return;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (lastBuffer) {
    await fs.mkdir('blog/posts/images', { recursive: true });
    await fs.writeFile(imgPath, lastBuffer);
    const injected = await ensureImageInHtml(slug);
    console.log(`       saved -> ${imgPath}${injected ? ' + HTML updated' : ''}`);
  }
}

async function main() {
  console.log(`\nBackfill images  (image=${IMAGE_MODEL}, vision=${VISION_MODEL}, max_attempts=${MAX_ATTEMPTS}${FORCE ? ', FORCE' : ''}${DRY_RUN ? ', DRY-RUN' : ''})\n`);

  // Determine which slugs to process: explicit map + any post whose image is missing or broken
  const postsDir = 'blog/posts';
  const allPosts = (await fs.readdir(postsDir)).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, ''));

  const targets = new Set();
  for (const slug of allPosts) {
    const p = `${postsDir}/images/${slug}-cover.jpg`;
    if (FORCE || !existsSync(p) || statSync(p).size < MIN_SIZE) targets.add(slug);
  }

  // Process only slugs we have prompts for; warn about any missing prompts
  const withPrompts = [...targets].filter(s => scenePrompts[s]);
  const withoutPrompts = [...targets].filter(s => !scenePrompts[s]);
  if (withoutPrompts.length) {
    console.log(`Needs prompt (add to scenePrompts): ${withoutPrompts.join(', ')}\n`);
  }

  for (const slug of withPrompts) {
    await processSlug(slug, scenePrompts[slug]);
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\nDone. Estimated cost: $${totalCost.toFixed(3)}`);
  console.log('Next: node scripts/generate-posts-index.mjs && node scripts/generate-rss-feed.mjs\n');
}

main().catch(err => { console.error(err); process.exit(1); });
