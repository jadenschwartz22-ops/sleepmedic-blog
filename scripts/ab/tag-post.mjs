// Classify a single post against the A/B schema.
//   node scripts/ab/tag-post.mjs <slug>
//   node scripts/ab/tag-post.mjs <slug> --manual   (opens editor on the tag file)
//
// Reads blog/posts/<slug>.html, asks Gemini to classify it, writes to
// blog/ab-tags.json keyed by slug. Idempotent: re-running overwrites.

import fs from 'fs/promises';
import path from 'path';
import { SCHEMA, bucketForWordCount, validate } from './tag-schema.mjs';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const TAGS_PATH = 'blog/ab-tags.json';

async function loadTags() {
  try { return JSON.parse(await fs.readFile(TAGS_PATH, 'utf8')); }
  catch { return {}; }
}

async function saveTags(tags) {
  await fs.writeFile(TAGS_PATH, JSON.stringify(tags, null, 2));
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBody(html) {
  // grab the article body if present, else full page
  const m = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
         || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  return m ? m[1] : html;
}

async function classify(slug, text, wordCount) {
  const prompt = `Classify this SleepMedic blog post against a fixed taxonomy. Be strict. Pick the SINGLE best value for single-choice fields. For "devices", pick 1-6 that genuinely appear — do not list everything.

POST TEXT:
${text.slice(0, 8000)}

WORD COUNT: ${wordCount}

Return JSON matching this exact shape (do not add keys):
{
  "energy": one of ${JSON.stringify(SCHEMA.energy)},
  "opening_vehicle": one of ${JSON.stringify(SCHEMA.opening_vehicle)},
  "closing_vehicle": one of ${JSON.stringify(SCHEMA.closing_vehicle)},
  "voice_intensity": one of ${JSON.stringify(SCHEMA.voice_intensity)},
  "devices": array of 1-6 from ${JSON.stringify(SCHEMA.devices)},
  "topic_cluster": one of ${JSON.stringify(SCHEMA.topic_cluster)},
  "hook_type": one of ${JSON.stringify(SCHEMA.hook_type)},
  "cta_type": one of ${JSON.stringify(SCHEMA.cta_type)},
  "format": one of ${JSON.stringify(SCHEMA.format)},
  "notes": "one-sentence observation about what makes this post distinct"
}

DEFINITIONS:
- energy: scientist=rigorous curious mechanism-first; monk=still spacious philosophical; warrior=direct hard-ask short sentences; princess=warm permission-giving worth-affirming; hybrid=clearly braids two
- voice_intensity: 0.5=neutral professional; 0.7=clearly styled but restrained; 1.0=fully dialed up with heavy metaphor and declarative punch
- opening_vehicle: scene=specific moment/person; claim=bold assertion; image=evocative object; question=rhetorical Q; quote=literary/research quote; data=stat-shock; confession=I-admit; literary_ref=Aurelius/Ginsberg/etc
- closing_vehicle: question=ends on Q; imperative=command to reader; reframe=flips the frame; quiet_stop=lands on a still image; callback=returns to opening; self_aware=acknowledges the writing itself; checklist=ends in protocol
- hook_type: pain=reader is suffering; curiosity=reader wants to know; permission=reader needs to rest guilt-free; challenge=reader is called out; mystery=reader is intrigued; validation=reader feels seen

Respond with valid JSON only, no prose around it.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: 'application/json' }
    })
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return JSON.parse(raw);
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/ab/tag-post.mjs <slug> [--force]');
    process.exit(1);
  }
  const force = process.argv.includes('--force');

  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY required');
    process.exit(1);
  }

  const htmlPath = path.join('blog/posts', `${slug}.html`);
  const html = await fs.readFile(htmlPath, 'utf8');
  const body = extractBody(html);
  const text = stripHtml(body);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const allTags = await loadTags();
  if (allTags[slug] && !force) {
    console.log(`[skip] ${slug} already tagged (use --force to re-tag)`);
    return;
  }

  console.log(`[classify] ${slug} (${wordCount} words)...`);
  const classified = await classify(slug, text, wordCount);

  const tags = {
    ...classified,
    length_bucket: bucketForWordCount(wordCount),
    word_count: wordCount,
    tagged_at: new Date().toISOString()
  };

  const errors = validate(tags);
  if (errors.length) {
    console.error(`[validation errors]`, errors);
    process.exit(1);
  }

  allTags[slug] = tags;
  await saveTags(allTags);
  console.log(`[ok] ${slug}: ${tags.energy} / ${tags.opening_vehicle} -> ${tags.closing_vehicle} / ${tags.length_bucket}`);
  console.log(`     devices: ${tags.devices.join(', ')}`);
  console.log(`     note: ${tags.notes}`);
}

main().catch(err => { console.error(err); process.exit(1); });
