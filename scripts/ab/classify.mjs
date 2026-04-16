// Classify a SleepMedic blog post against the A/B schema.
//   node scripts/ab/classify.mjs <slug> [--force]

import fs from 'fs/promises';
import path from 'path';
import { SCHEMA, bucketForWordCount, validate } from './tag-schema.mjs';
import { TAGS_PATH } from './paths.mjs';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';

async function loadTags() {
  try { return JSON.parse(await fs.readFile(TAGS_PATH, 'utf8')); }
  catch { return {}; }
}

async function saveTags(tags) {
  await fs.mkdir(path.dirname(TAGS_PATH), { recursive: true });
  await fs.writeFile(TAGS_PATH, JSON.stringify(tags, null, 2));
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPostContent(html) {
  const openRx = /<div\s+class="post-content"[^>]*>/i;
  const start = html.search(openRx);
  if (start === -1) return null;
  const openMatch = html.slice(start).match(openRx);
  let i = start + openMatch[0].length;
  let depth = 1;
  const divOpen = /<div\b/gi;
  const divClose = /<\/div>/gi;
  while (depth > 0 && i < html.length) {
    divOpen.lastIndex = i;
    divClose.lastIndex = i;
    const o = divOpen.exec(html);
    const c = divClose.exec(html);
    if (!c) break;
    if (o && o.index < c.index) { depth++; i = o.index + o[0].length; }
    else { depth--; i = c.index + c[0].length; if (depth === 0) return html.slice(start + openMatch[0].length, c.index); }
  }
  return html.slice(start + openMatch[0].length);
}

function extractBody(html) {
  const content = extractPostContent(html);
  if (content && content.length > 500) return content;
  const art = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (art && art[1].length > 500) return art[1];
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main) return main[1];
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return body ? body[1] : html;
}

function repairJson(str) {
  let s = String(str).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let inStr = false, escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') inStr = !inStr;
  }
  if (inStr) s += '"';
  let braces = 0, brackets = 0;
  inStr = false; escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }
  s = s.replace(/,\s*$/, '');
  while (brackets > 0) { s += ']'; brackets--; }
  while (braces > 0) { s += '}'; braces--; }
  return s;
}

function parseModelJson(raw) {
  if (!raw) throw new Error('empty response');
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
    try { return JSON.parse(repairJson(objMatch[0])); } catch {}
  }
  try { return JSON.parse(repairJson(cleaned)); } catch (e) {
    throw new Error(`unparseable model response: ${cleaned.slice(0, 200)}`);
  }
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' }
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, attempt * 3000));
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.filter(p => p.text).map(p => p.text).join('');
  }
  throw new Error('Gemini unavailable after 3 attempts');
}

async function classify(text, wordCount) {
  const prompt = `Classify this SleepMedic blog post against a fixed taxonomy. Pick the SINGLE best value for single-choice fields. For devices, pick 1-6 that genuinely appear.

POST TEXT (${wordCount} words):
${text.slice(0, 8000)}

Return JSON with this exact shape:
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
  "notes": "one-sentence observation (max 120 chars)"
}

DEFINITIONS:
- energy: scientist=rigorous curious mechanism-first; monk=still spacious philosophical; warrior=direct hard-ask short sentences; princess=warm permission-giving worth-affirming; hybrid=clearly braids two
- voice_intensity: 0.5=neutral professional; 0.7=clearly styled but restrained; 1.0=fully dialed up with heavy metaphor and declarative punch
- opening_vehicle: scene=specific moment/person; claim=bold assertion; image=evocative object; question=rhetorical Q; quote=literary/research quote; data=stat shock; confession=I-admit; literary_ref=Aurelius/Ginsberg/etc
- closing_vehicle: question=ends on Q; imperative=command; reframe=flips frame; quiet_stop=still image; callback=returns to opening; self_aware=acknowledges writing itself; checklist=ends in protocol
- hook_type: pain=reader is suffering; curiosity=reader wants to know; permission=reader needs to rest guilt-free; challenge=reader called out; mystery=intriguing; validation=reader feels seen

Valid JSON only. No prose around it. Keep notes under 120 characters.`;

  const raw = await callGemini(prompt);
  return parseModelJson(raw);
}

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error('Usage: node scripts/ab/classify.mjs <slug> [--force]'); process.exit(1); }
  const force = process.argv.includes('--force');
  if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }

  const htmlPath = path.join('blog/posts', `${slug}.html`);
  const html = await fs.readFile(htmlPath, 'utf8');
  const body = extractBody(html);
  const text = stripHtml(body);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (wordCount < 100) {
    console.error(`[fail] ${slug}: only ${wordCount} words extracted — HTML selector is wrong`);
    process.exit(1);
  }

  const allTags = await loadTags();
  if (allTags[slug] && !force) {
    console.log(`[skip] ${slug} already tagged (--force to re-tag)`);
    return;
  }

  console.log(`[classify] ${slug} (${wordCount} words)...`);
  let classified;
  try {
    classified = await classify(text, wordCount);
  } catch (err) {
    console.error(`[fail] ${slug}: ${err.message}`);
    process.exit(1);
  }

  const tags = {
    ...classified,
    length_bucket: bucketForWordCount(wordCount),
    word_count: wordCount,
    tagged_at: new Date().toISOString()
  };

  const errors = validate(tags);
  if (errors.length) {
    console.error(`[validation] ${slug}: ${errors.join('; ')}`);
    process.exit(1);
  }

  allTags[slug] = tags;
  await saveTags(allTags);
  console.log(`[ok] ${slug}: ${tags.energy} / ${tags.opening_vehicle} -> ${tags.closing_vehicle} / ${tags.length_bucket} / v${tags.voice_intensity}`);
  console.log(`     devices: ${tags.devices.join(', ')}`);
  console.log(`     note: ${tags.notes}`);
}

main().catch(err => { console.error(err); process.exit(1); });
