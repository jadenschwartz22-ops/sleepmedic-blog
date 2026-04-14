/**
 * Backfill missing/broken cover images for existing blog posts.
 * Uses Gemini 2.5 Flash Image to generate cover photos.
 *
 * Usage: GEMINI_API_KEY=xxx node scripts/backfill-images.mjs
 */

import fs from 'fs/promises';
import { existsSync, statSync } from 'fs';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const MIN_SIZE = 5000; // bytes -- anything smaller is a broken placeholder

// Map each post slug to a scene prompt for image generation
const scenePrompts = {
  '2026-03-01-sleepmaxxing-decoding-the-trend-science-and-actionable-steps':
    'Cozy bedroom at dawn, diffused golden light through sheer curtains, rumpled white linen sheets, a sleep tracker on the nightstand next to a glass of water. Warm muted tones, shallow depth of field.',

  '2026-02-23-harnessing-nsdr-and-yoga-nidra-for-better-sleep':
    'A person lying on a yoga mat in a dimly lit room with warm amber light, eyes closed in deep relaxation. Soft blanket draped over legs, candle glow in background. Peaceful, meditative atmosphere.',

  '2026-02-02-what-time-should-i-sleep-and-wake':
    'Split composition: left side shows a warm sunset through a window with an analog clock showing 10pm, right side shows soft morning light with the same clock at 6am. Clean bedroom setting.',

  '2026-01-26-box-breathing-and-4-7-8-technique-for-better-sleep':
    'Close-up of hands resting on a chest during deep breathing, soft blue moonlight filtering through a window. Calm bedroom scene, muted navy and warm tones. Feeling of stillness.',

  '2026-01-19-the-unexpected-connection-between-memory-consolidation-during-rem-vs-deep-sleep-':
    'Abstract visualization of brain waves during sleep - soft glowing neural pathways in deep blue and purple tones against a dark background. Scientific yet calming aesthetic.'
};

async function generateImage(prompt, outputPath) {
  const fullPrompt = `Generate a professional editorial blog cover photograph: ${prompt}. No text overlay, no watermarks, no human faces visible. Landscape 16:9 composition. Photorealistic, editorial quality.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err.slice(0, 150)}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) throw new Error('No image in response');

  await fs.mkdir('blog/posts/images', { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(imagePart.inlineData.data, 'base64'));

  const size = statSync(outputPath).size;
  return size;
}

async function main() {
  console.log(`\nBackfilling cover images using ${MODEL}\n`);

  for (const [slug, prompt] of Object.entries(scenePrompts)) {
    const path = `blog/posts/images/${slug}-cover.jpg`;
    const exists = existsSync(path);
    const size = exists ? statSync(path).size : 0;

    if (exists && size >= MIN_SIZE) {
      console.log(`  SKIP  ${slug.slice(0,50)}... (${(size/1024).toFixed(0)}KB)`);
      continue;
    }

    console.log(`  GEN   ${slug.slice(0,50)}... ${exists ? '(replacing ' + size + 'B placeholder)' : '(new)'}`);

    try {
      const newSize = await generateImage(prompt, path);
      console.log(`        -> ${(newSize/1024).toFixed(0)}KB saved`);
    } catch (err) {
      console.error(`        -> FAILED: ${err.message}`);
    }

    // Rate limit: wait 2s between calls
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\nDone. Run: node scripts/generate-posts-index.mjs\n');
}

main();
