/**
 * SleepMedic Multi-Agent Blog Generator v2
 *
 * 10-Stage Pipeline:
 *  1. Topic Selector    - Rotation + LLM angle generation
 *  2. Researcher        - Gemini grounded search for real studies/stats
 *  3. Planner           - Structured outline with research refs
 *  4. Section Writers   - One call per section, varied temperature
 *  5. Assembler         - Programmatic join + inline image slot selection
 *  6. Editor            - Polish, remove AI-isms, fix transitions
 *  7. Humanizer         - Conversational pass, rhetorical Qs, micro-stories
 *  8. Cross-Linker      - Internal links to related posts
 *  9. Image Generation  - Cover + 1-2 inline images
 * 10. HTML Builder      - Template assembly + metadata
 */

import fs from 'fs/promises';
import yaml from 'yaml';
import chalk from 'chalk';
import ContentMemory from './content-memory-system.mjs';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';

if (!GEMINI_API_KEY) {
  console.error(chalk.red('GEMINI_API_KEY environment variable is required'));
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function getWeekNumber() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function stripCodeFences(text) {
  return text.replace(/^```(?:json|html|xml)?\s*\n?/m, '').replace(/\n?\s*```\s*$/m, '').trim();
}

function nowMT() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }));
}
function dateISOmt() { return nowMT().toISOString().split('T')[0]; }
function dateFormattedMT() {
  return nowMT().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Attempt to repair truncated JSON by closing open structures */
function repairJson(str) {
  let s = str.trim();
  // Close any unterminated string
  const quotes = (s.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2 !== 0) s += '"';
  // Count and close open brackets/braces
  let braces = 0, brackets = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) { inStr = !inStr; continue; }
    if (inStr) continue;
    if (s[i] === '{') braces++;
    else if (s[i] === '}') braces--;
    else if (s[i] === '[') brackets++;
    else if (s[i] === ']') brackets--;
  }
  // Remove trailing comma before closing
  s = s.replace(/,\s*$/, '');
  while (brackets > 0) { s += ']'; brackets--; }
  while (braces > 0) { s += '}'; braces--; }
  return s;
}

function log(stage, msg) { console.log(chalk.cyan(`[Stage ${stage}] `) + msg); }
function logDetail(msg) { console.log(chalk.gray(`  ${msg}`)); }

// ── Gemini Text API (with retry) ─────────────────────

async function gemini(prompt, { system, json = false, temp = 0.7, maxTokens = 8192, search = false } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // Gemini doesn't support JSON responseMimeType + google_search tool together
  const useJsonMime = json && !search;

  const body = {
    contents: [{ role: 'user', parts: [{ text: search && json ? prompt + '\n\nRespond with valid JSON only, no markdown fences.' : prompt }] }],
    generationConfig: {
      temperature: temp,
      maxOutputTokens: maxTokens,
      ...(useJsonMime && { responseMimeType: 'application/json' })
    }
  };
  if (system) body.system_instruction = { parts: [{ text: system }] };
  if (search) {
    body.tools = [{ google_search: {} }];
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.status === 429 || res.status >= 500) {
        const wait = attempt * 5000 + Math.random() * 2000;
        console.warn(chalk.yellow(`  Gemini ${res.status}, retry ${attempt}/3 in ${(wait / 1000).toFixed(1)}s...`));
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
      }

      const data = await res.json();
      // Concatenate all text parts (google_search responses may split across parts)
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.filter(p => p.text).map(p => p.text).join('');
      if (!text) throw new Error('Empty Gemini response');

      const cleaned = stripCodeFences(text);
      if (!json) return cleaned;

      // For JSON: extract the JSON object/array from the response text
      try {
        return JSON.parse(cleaned);
      } catch {
        // Try to find JSON object in the text (model may add prose around it)
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          try { return JSON.parse(match[0]); } catch { /* fall through */ }
          // Try to repair truncated JSON by closing open structures
          try { return JSON.parse(repairJson(match[0])); } catch { /* fall through */ }
        }
        throw new Error(`Unterminated string in JSON at position ${cleaned.length}`);
      }
    } catch (err) {
      if (attempt === 3) throw err;
      const wait = attempt * 3000;
      console.warn(chalk.yellow(`  Error: ${err.message}, retry ${attempt}/3...`));
      await sleep(wait);
    }
  }
}

// ── Image Generation (Gemini native, with retry) ─────

async function generateImage(prompt, outputPath) {
  const fullPrompt = `Generate a professional editorial blog cover photograph: ${prompt}. Warm natural tones, soft ambient lighting, atmospheric depth. No text overlay, no watermarks. If people appear, show them from behind, from the side, or at a distance -- never show a full face directly facing the camera. Landscape 16:9 composition. Photorealistic style. IMPORTANT: Do NOT default to generic bedroom or bed imagery. Show the real world -- workplaces, hallways, break rooms, outdoor scenes, hands on equipment, cityscapes at dawn, dimly lit fire stations, hospital corridors, coffee on a desk at 3am. Varied, specific, and editorial.`;
  const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } }
        })
      });

      if (!res.ok) {
        console.warn(chalk.yellow(`  Image API ${res.status}: ${(await res.text()).slice(0, 100)}`));
        if (attempt < 2) { await sleep(3000); continue; }
        return null;
      }

      const data = await res.json();
      const imagePart = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.mimeType?.startsWith('image/'));
      if (!imagePart) {
        console.warn(chalk.yellow('  No image in response'));
        if (attempt < 2) { await sleep(2000); continue; }
        return null;
      }

      await fs.mkdir('blog/posts/images', { recursive: true });
      await fs.writeFile(outputPath, Buffer.from(imagePart.inlineData.data, 'base64'));
      return outputPath;
    } catch (err) {
      console.warn(chalk.yellow(`  Image gen failed: ${err.message}`));
      if (attempt < 2) { await sleep(2000); continue; }
      return null;
    }
  }
  return null;
}

// ── Banned phrases ───────────────────────────────────

const BANNED_PHRASES = [
  "Let's dive in", "dive deep", "dive into", "In conclusion", "To conclude",
  "It's important to note", "It's worth noting", "It's worth mentioning",
  "As we've seen", "As mentioned earlier", "In today's post", "In this article",
  "Whether you're a", "Look no further", "game-changer", "game changer",
  "navigate", "landscape", "robust", "leverage", "holistic approach",
  "synergy", "optimize your", "hack your sleep", "hack your",
  "Here's the thing", "The reality is", "At the end of the day",
  "Studies have shown", "Research suggests", "Experts agree",
  "In today's fast-paced world", "When it comes to", "It goes without saying",
  "without further ado", "So without", "buckle up",
  "Harnessing", "Harness the power", "Unlocking", "Unlock the",
  "Discover how", "Discover the", "The Ultimate Guide", "Everything You Need",
  "What You Need to Know", "game-changing", "life-changing",
  "revolutionary", "Transform your", "Supercharge your",
  "The surprising truth", "You won't believe", "Scientists say",
  "A growing body of research", "Recent studies suggest",
  "unpack", "unpacking", "Let's explore", "Let's take a look",
  "In recent years", "Over the past decade",
  "delve", "delving", "embark", "embarking", "foster",
  "resonate", "resonating", "tapestry", "paradigm", "paradigm shift",
  "myriad", "plethora", "comprehensive guide", "evidence-based guide",
  "In the realm of", "In the world of", "beacon", "cornerstone",
  "Furthermore", "Moreover", "Additionally", "Consequently"
].map(p => p.toLowerCase());

function bannedPhrasesBlock() {
  return `BANNED PHRASES (rewrite or delete on sight):\n${BANNED_PHRASES.map(p => `"${p}"`).join(', ')}`;
}

// ── Topic History ────────────────────────────────────

const TOPIC_HISTORY_PATH = '.topic-history.json';

async function loadRecentTopics() {
  try { return JSON.parse(await fs.readFile(TOPIC_HISTORY_PATH, 'utf8')); }
  catch { return []; }
}

async function saveTopicToHistory(topic) {
  const recent = await loadRecentTopics();
  recent.push({ topic, generatedAt: new Date().toISOString() });
  await fs.writeFile(TOPIC_HISTORY_PATH, JSON.stringify(recent.slice(-30), null, 2));
}

// ════════════════════════════════════════════════════════
// STAGE 1: TOPIC SELECTOR
// ════════════════════════════════════════════════════════

async function stage1_selectTopic() {
  log(1, 'Selecting topic and generating angle...');

  const { buckets } = yaml.parse(await fs.readFile('scripts/editorial/topics.yaml', 'utf8'));
  const recent = (await loadRecentTopics()).map(t => t.topic);
  const week = getWeekNumber();
  const offset = Math.floor(Math.random() * 3);

  let bucket = buckets[(week + offset) % buckets.length];
  let idx = Math.floor((week + offset) / buckets.length) % bucket.topics.length;
  let topic = bucket.topics[idx];

  for (let i = 0; i < 40 && recent.includes(topic); i++) {
    idx = (idx + 1) % bucket.topics.length;
    if (idx === 0) bucket = buckets[(buckets.indexOf(bucket) + 1) % buckets.length];
    topic = bucket.topics[idx];
  }

  // LLM generates a specific angle on the topic
  const angleData = await gemini(
    `Topic: "${topic}"
Category: ${bucket.name} (${bucket.tag})

Generate a specific, compelling angle for a blog post on this topic.
Think: what's the one question someone would Google at 2am about this?

Return JSON:
{
  "angle": "specific angle (1 sentence)",
  "audience_segment": "who this helps most (e.g., 'night shift nurses', 'anxious sleepers', 'new parents')",
  "emotional_hook": "the feeling or frustration that drives someone to search for this (1 sentence)",
  "search_query": "what someone would actually type into Google"
}`,
    { json: true, temp: 0.8 }
  );

  await saveTopicToHistory(topic);

  const result = { topic, tag: bucket.tag, bucketName: bucket.name, ...angleData };
  logDetail(`Topic: "${topic}" [${bucket.tag}]`);
  logDetail(`Angle: ${angleData.angle}`);
  logDetail(`Audience: ${angleData.audience_segment}`);
  return result;
}

function getTemplateFormat() {
  const formats = ['Story-First', 'Science-First', 'Myth-Busting', 'Field Manual', 'Q&A', 'History/Philosophy Lens'];
  const offset = Math.floor(Math.random() * 2);
  return formats[(getWeekNumber() + offset) % formats.length];
}

// ════════════════════════════════════════════════════════
// STAGE 2: RESEARCHER (Gemini with Google Search grounding)
// ════════════════════════════════════════════════════════

async function stage2_research(topicInfo) {
  log(2, 'Researching topic with web search...');

  const researchPrompt = `Research the following sleep science topic thoroughly.

Topic: "${topicInfo.topic}"
Angle: ${topicInfo.angle}
Target audience: ${topicInfo.audience_segment}

Return a JSON object with REAL, VERIFIABLE information. Keep values SHORT -- no long paragraphs.
{
  "studies": [
    { "finding": "one short sentence", "source": "journal or org name", "url": "real URL", "year": 2024, "stat": "specific number" }
  ],
  "key_stats": [
    { "stat": "specific statistic with number", "source": "CDC/NIH/WHO/etc", "url": "real URL" }
  ],
  "surprising_fact": "one short counterintuitive fact",
  "mechanisms": ["mechanism 1", "mechanism 2"],
  "practical_protocols": ["technique name with origin"]
}

RULES:
- 3-5 studies from trusted sources (CDC, NIH, PubMed, AASM, WHO, Cochrane, NHLBI)
- 2-3 statistics with real numbers
- Only include URLs you are confident are real
- Mechanisms must be named physiological processes (circadian phase, homeostatic sleep drive, thermoregulation, etc.)
- Keep ALL string values under 150 characters to avoid truncation`;

  let research;
  try {
    // Try with google_search grounding first
    research = await gemini(researchPrompt, { json: true, temp: 0.3, search: true, maxTokens: 4096 });
  } catch (err) {
    logDetail(`Search grounding failed: ${err.message.slice(0, 100)}`);
    logDetail('Falling back to non-search research...');
    // Fallback: no search tool, just use model knowledge with JSON mode
    research = await gemini(researchPrompt, { json: true, temp: 0.3, maxTokens: 4096 });
  }

  logDetail(`Found ${research.studies?.length || 0} studies, ${research.key_stats?.length || 0} stats`);
  logDetail(`Mechanisms: ${(research.mechanisms || []).join(', ')}`);
  return research;
}

// ════════════════════════════════════════════════════════
// STAGE 3: PLANNER
// ════════════════════════════════════════════════════════

async function stage3_plan(topicInfo, research, guidelines) {
  log(3, 'Planning post structure...');
  const format = getTemplateFormat();

  const system = `You are a blog editor for SleepMedic, a sleep science publication.
Primary audience: anyone struggling with sleep.
Core niche: shift workers (EMTs, nurses, firefighters).
Secondary: health optimizers, wearable users, parents, students.

${guidelines}

This week's template format: ${format}`;

  const researchSummary = JSON.stringify(research, null, 2);

  const outline = await gemini(
    `Plan a blog post.

TOPIC: "${topicInfo.topic}"
ANGLE: ${topicInfo.angle}
AUDIENCE: ${topicInfo.audience_segment}
EMOTIONAL HOOK: ${topicInfo.emotional_hook}
SEARCH QUERY: ${topicInfo.search_query}

RESEARCH DATA (use this -- do not invent citations):
${researchSummary}

The post should be ~800-1200 words across all sections.

Return JSON:
{
  "title": "6-10 words, specific and concrete. Answers the search query.",
  "excerpt": "140-160 char summary that makes someone click",
  "keywords": "comma-separated SEO keywords",
  "template_type": "${format}",
  "sections": [
    {
      "heading": "specific heading (never generic)",
      "angle": "what this section covers and why",
      "keyPoints": ["point 1", "point 2"],
      "research_refs": [0, 1],
      "mechanisms": ["named mechanism if relevant"],
      "targetWords": 180,
      "tone_note": "e.g., 'open with tension', 'matter-of-fact', 'empathetic'"
    }
  ],
  "imagePrompt": "specific atmospheric scene showing the WORLD of the reader, not a bed. Examples: nurse in scrubs walking a dim hospital corridor at shift change, firefighter boots by a bunk room door, coffee mug and stethoscope on a break room table at 4am, sunrise through an ambulance windshield, hands gripping a steering wheel on a dark highway. Show the environment, the work, the struggle -- not a pillow.",
  "inline_image_after_section": 2,
  "inline_image_prompt": "specific scene tied to this section -- workplace, tool, or environmental detail. NOT a bedroom.",
  "closingLine": "short grounded closing line"
}

RULES:
- 4-6 sections including intro hook and closing protocol
- research_refs are indices into the studies array -- assign each study to a section
- First section: strong hook (scene, stat, or story)
- Last section: protocol/checklist (3-7 items) + sources + disclaimer
- Section headings: specific to THIS topic, never generic
- inline_image_after_section: pick the section index where a visual would help most
- Title must match what someone would search for. No clickbait.`,
    { system, json: true, temp: 0.7 }
  );

  logDetail(`Title: "${outline.title}"`);
  logDetail(`Sections: ${outline.sections.length}`);
  logDetail(`Format: ${format}`);
  return outline;
}

// ════════════════════════════════════════════════════════
// STAGE 4: SECTION WRITERS
// ════════════════════════════════════════════════════════

async function stage4_writeSections(outline, research, guidelines) {
  log(4, `Writing ${outline.sections.length} sections...`);

  const system = `You write for SleepMedic, a sleep science blog.
Primary audience: anyone struggling with sleep.
Core niche: shift workers (EMTs, nurses, firefighters).

${guidelines}

Voice: warm, direct, expert. Like a sleep researcher explaining to a friend over coffee.

${bannedPhrasesBlock()}

STYLE:
- Vary sentence length dramatically. Short punch. Then longer with detail.
- Use "you" directly. Never "one should."
- Specific numbers: temps in F, durations in minutes, percentages.
- Use contractions (don't, you'll, it's, can't).
- No filler. Every sentence earns its place.
- Never start two consecutive paragraphs the same way.
- Name the mechanism, explain simply, give the actionable takeaway.`;

  const sections = [];
  let prevContext = '';

  for (let i = 0; i < outline.sections.length; i++) {
    const section = outline.sections[i];
    const isFirst = i === 0;
    const isLast = i === outline.sections.length - 1;
    const temp = isFirst ? 0.85 : isLast ? 0.5 : 0.7;

    // Build research context for this section
    let researchContext = '';
    if (section.research_refs?.length && research.studies) {
      const refs = section.research_refs
        .filter(idx => research.studies[idx])
        .map(idx => research.studies[idx]);
      if (refs.length) {
        researchContext = `\nRESEARCH TO WEAVE IN (cite with inline links):\n${refs.map(r =>
          `- ${r.finding} (${r.source}${r.year ? `, ${r.year}` : ''})${r.url ? ` [${r.url}]` : ''}${r.stat ? ` -- stat: ${r.stat}` : ''}`
        ).join('\n')}`;
      }
    }

    let prompt = `Write the "${section.heading}" section for a blog post titled "${outline.title}".

This section's job: ${section.angle}
Key points: ${section.keyPoints.join('; ')}
${section.mechanisms?.length ? `Mechanisms: ${section.mechanisms.join(', ')}` : ''}
Tone: ${section.tone_note || 'direct and helpful'}
Target: ~${section.targetWords || 180} words.
${researchContext}`;

    if (isFirst) {
      prompt += `\n\nOPENING SECTION. Start with a strong hook -- a scene, a striking number, or a two-sentence story. Jump in. No generic intros.`;
    }

    if (prevContext) {
      prompt += `\n\nPrevious section ended with: "${prevContext}"\nFlow naturally from there.`;
    }

    if (isLast) {
      // Build sources from all research
      const allSources = (research.studies || [])
        .filter(s => s.url)
        .map(s => `${s.source}${s.year ? ` (${s.year})` : ''}: ${s.url}`)
        .slice(0, 5);

      prompt += `\n\nCLOSING SECTION. Include:
1. Compact protocol or checklist (3-7 actionable items, commands not suggestions)
2. Sources section with these real links:\n${allSources.map(s => `   - ${s}`).join('\n')}
3. One-line disclaimer: "This is not medical advice. Talk to your provider."
4. Close with: "${outline.closingLine || 'Rest well. Rise ready.'}"`;
    }

    prompt += `\n\nReturn ONLY HTML. Tags: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a>, <blockquote>. No wrapper divs. Every paragraph in <p> tags.`;

    const html = await gemini(prompt, { system, temp });
    sections.push({ html, index: i });

    const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = plainText.split(' ');
    prevContext = words.slice(-40).join(' ');

    logDetail(`${i + 1}/${outline.sections.length}: "${section.heading}" (${words.length} words)`);
  }

  return sections;
}

// ════════════════════════════════════════════════════════
// STAGE 5: ASSEMBLER (programmatic)
// ════════════════════════════════════════════════════════

function stage5_assemble(sections, outline) {
  log(5, 'Assembling sections...');

  const inlineSlot = outline.inline_image_after_section ?? Math.min(2, sections.length - 2);

  let fullHtml = '';
  let inlineImagePosition = null;

  for (const { html, index } of sections) {
    fullHtml += html + '\n\n';
    if (index === inlineSlot) {
      fullHtml += '<!-- INLINE_IMAGE_SLOT -->\n\n';
      inlineImagePosition = fullHtml.indexOf('<!-- INLINE_IMAGE_SLOT -->');
    }
  }

  const wordCount = fullHtml.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
  logDetail(`Assembled ${wordCount} words, inline image after section ${inlineSlot}`);

  return { fullHtml, inlineImageSlot: inlineSlot, inlineImagePrompt: outline.inline_image_prompt };
}

// ════════════════════════════════════════════════════════
// STAGE 6: EDITOR
// ════════════════════════════════════════════════════════

async function stage6_edit(fullHtml, outline, guidelines) {
  log(6, 'Editing and polishing...');

  const system = `You are a senior editor at SleepMedic. Polish this draft so it reads like a knowledgeable human wrote it, not AI.

${guidelines}

WHAT TO FIX:
- Remove ANY phrase that sounds AI-generated
- Ensure sections flow naturally (no repetitive openings, no abrupt jumps)
- Vary paragraph length: some 1 sentence, some 3-4
- Opening hook must grab in the first line
- All citations must have inline <a> links to real URLs
- Advice must be specific (exact temps, durations, protocols)
- Fix redundancy between sections
- Remove any sentence that could appear in any blog post

${bannedPhrasesBlock()}

KEEP INTACT:
- Specific mechanism names
- Exact numbers and protocols
- Citation links and URLs
- Section headings
- The <!-- INLINE_IMAGE_SLOT --> comment (do not remove)`;

  const result = await gemini(
    `Polish this blog post. Title: "${outline.title}"\n\n${fullHtml}\n\nReturn ONLY the polished HTML body. Same tags. No title, no wrapper divs.`,
    { system, temp: 0.4, maxTokens: 10000 }
  );

  logDetail('Edit pass complete');
  return result;
}

// ════════════════════════════════════════════════════════
// STAGE 7: HUMANIZER
// ════════════════════════════════════════════════════════

async function stage7_humanize(html, outline, guidelines) {
  log(7, 'Humanizing...');

  const result = await gemini(
    `You are a writing coach. This blog post is good but still reads slightly like AI wrote it. Make it sound like a real human expert.

Title: "${outline.title}"

${html}

YOUR TASKS:
1. Replace any remaining formal/stiff phrasing with conversational tone
2. Add 1-2 rhetorical questions where they feel natural (not forced)
3. If there's no concrete scene or micro-story in the opening, add one (2-3 sentences max)
4. Vary paragraph lengths more aggressively -- some should be just 1 sentence
5. Remove hedge words: "may", "might", "could potentially", "it is possible that"
6. Replace passive voice with active where possible
7. Make sure transitions between sections feel like natural thought progression, not "Next, let's discuss..."
8. Keep all factual content, citations, protocols, and numbers exactly as they are
9. Keep the <!-- INLINE_IMAGE_SLOT --> comment (do not remove)

${bannedPhrasesBlock()}

Return ONLY the improved HTML body. Same tag set. No meta commentary.`,
    {
      system: `You write for SleepMedic. Voice: warm, direct, expert. Like explaining to a smart friend. ${guidelines.slice(0, 500)}`,
      temp: 0.6,
      maxTokens: 10000
    }
  );

  logDetail('Humanizer pass complete');
  return result;
}

// ════════════════════════════════════════════════════════
// STAGE 8: CROSS-LINKER
// ════════════════════════════════════════════════════════

async function stage8_crossLink(html, outline) {
  log(8, 'Adding internal links...');

  let postsIndex;
  try { postsIndex = JSON.parse(await fs.readFile('blog/posts-index.json', 'utf8')); }
  catch { logDetail('No posts index, skipping'); return html; }

  if (!postsIndex.length) { logDetail('No existing posts'); return html; }

  const posts = postsIndex.map(p => `- "${p.title}" -> ../posts/${p.slug}.html\n  ${p.excerpt}`).join('\n');

  const result = await gemini(
    `Current post: "${outline.title}"

EXISTING POSTS:
${posts}

CURRENT POST HTML:
${html}

Add 2-4 internal links where the current post discusses a topic covered in an existing post.

RULES:
- Only link where genuinely valuable
- Natural anchor text (2-5 words), not full titles
- Don't link in first paragraph or sources section
- Maximum 4 links
- If no good fit, return content EXACTLY unchanged
- Don't add new sentences just to create links
- Don't modify any existing text beyond inserting <a> tags
- Keep the <!-- INLINE_IMAGE_SLOT --> comment

Return the FULL HTML with links inserted.`,
    { system: 'You add internal links to blog posts. Be precise and conservative.', temp: 0.3 }
  );

  logDetail('Cross-linking complete');
  return result;
}

// ════════════════════════════════════════════════════════
// STAGE 9: IMAGE GENERATION
// ════════════════════════════════════════════════════════

async function stage9_generateImages(outline, slug) {
  log(9, 'Generating images...');

  const imagesDir = 'blog/posts/images';
  await fs.mkdir(imagesDir, { recursive: true });

  // Cover image
  const coverPath = `${imagesDir}/${slug}-cover.jpg`;
  logDetail('Generating cover image...');
  const coverResult = await generateImage(outline.imagePrompt, coverPath);
  if (coverResult) logDetail('Cover image saved');
  else logDetail('Cover image failed (post will still publish)');

  // Inline image
  let inlinePath = null;
  if (outline.inline_image_prompt) {
    const inlineOutputPath = `${imagesDir}/${slug}-inline-1.jpg`;
    logDetail('Generating inline image...');
    inlinePath = await generateImage(outline.inline_image_prompt, inlineOutputPath);
    if (inlinePath) logDetail('Inline image saved');
    else logDetail('Inline image failed (section will be text-only)');
  }

  return { coverPath: coverResult, inlinePath };
}

// ════════════════════════════════════════════════════════
// STAGE 10: HTML BUILDER
// ════════════════════════════════════════════════════════

async function stage10_buildHtml(content, topicInfo, outline, images) {
  log(10, 'Building HTML...');

  const template = await fs.readFile('blog/_template.html', 'utf8');
  const dateISO = dateISOmt();
  const dateFormatted = dateFormattedMT();
  const slug = `${dateISO}-${slugify(outline.title)}`;
  const wordCount = content.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
  const readTime = Math.ceil(wordCount / 200);

  // Insert inline image at the slot
  if (images.inlinePath) {
    const relPath = `images/${slug}-inline-1.jpg`;
    const imgHtml = `<figure style="margin: 32px 0;">
        <img src="${relPath}" alt="Illustration for ${outline.title}" style="width: 100%; border-radius: 16px; max-height: 360px; object-fit: cover;" loading="lazy">
      </figure>`;
    content = content.replace('<!-- INLINE_IMAGE_SLOT -->', imgHtml);
  } else {
    content = content.replace('<!-- INLINE_IMAGE_SLOT -->', '');
  }

  let html = template
    .replace(/\{\{TITLE\}\}/g, outline.title)
    .replace(/\{\{EXCERPT\}\}/g, outline.excerpt)
    .replace(/\{\{SLUG\}\}/g, slug)
    .replace(/\{\{DATE_ISO\}\}/g, dateISO)
    .replace(/\{\{DATE_FORMATTED\}\}/g, dateFormatted)
    .replace(/\{\{CATEGORY\}\}/g, topicInfo.tag)
    .replace(/\{\{KEYWORDS\}\}/g, outline.keywords)
    .replace(/\{\{READ_TIME\}\}/g, readTime)
    .replace(/\{\{WORD_COUNT\}\}/g, wordCount)
    .replace(/\{\{CONTENT\}\}/g, content);

  // Inject cover image
  if (images.coverPath) {
    const imageRelPath = `images/${slug}-cover.jpg`;
    const ogImageTag = `  <meta property="og:image" content="https://sleepmedic.co/blog/posts/images/${slug}-cover.jpg" />`;

    if (!html.includes('og:image') && html.includes('og:url')) {
      html = html.replace(/(<meta property="og:url"[^>]*>)/, `$1\n${ogImageTag}`);
    }

    const coverHtml = `      <div style="margin-bottom: 40px;">
        <img src="${imageRelPath}" alt="Cover image for ${outline.title}" style="width: 100%; max-height: 400px; object-fit: cover; border-radius: 24px;" loading="lazy">
      </div>\n`;
    html = html.replace('<div class="post-content">', coverHtml + '      <div class="post-content">');
  }

  const filename = `${slug}.html`;
  await fs.writeFile(`blog/posts/${filename}`, html, 'utf8');

  logDetail(`Created: blog/posts/${filename}`);
  logDetail(`${wordCount} words, ${readTime} min read`);

  // Metadata for CI
  await fs.mkdir('tmp', { recursive: true });
  await fs.writeFile('tmp/post-metadata.json', JSON.stringify({
    title: outline.title,
    excerpt: outline.excerpt,
    filename, slug,
    date: dateISO,
    topic: topicInfo.topic,
    tag: topicInfo.tag,
    readTime,
    hasAiImage: !!images.coverPath,
    hasInlineImage: !!images.inlinePath
  }, null, 2));

  return { filename, slug, dateISO, readTime, wordCount };
}

// ════════════════════════════════════════════════════════
// MAIN PIPELINE
// ════════════════════════════════════════════════════════

async function main() {
  console.log(chalk.bold.cyan('\nSleepMedic Blog Generator v2\n'));
  console.log(chalk.gray('='.repeat(50) + '\n'));

  try {
    const guidelines = await fs.readFile('scripts/editorial/style_guidelines.md', 'utf8');
    const memory = new ContentMemory();

    // Stage 1: Topic + Angle
    const topicInfo = await stage1_selectTopic();

    // Stage 2: Research
    const research = await stage2_research(topicInfo);

    // Stage 3: Plan
    const outline = await stage3_plan(topicInfo, research, guidelines);

    // Novelty check
    const novelty = memory.checkTitleNovelty(outline.title);
    if (novelty.noveltyScore < 20) {
      logDetail(`Title novelty low (${novelty.noveltyScore}/100), retrying...`);
      const retry = await stage3_plan(topicInfo, research, guidelines);
      const retryNovelty = memory.checkTitleNovelty(retry.title);
      if (retryNovelty.noveltyScore > novelty.noveltyScore) {
        Object.assign(outline, retry);
        logDetail(`New title: "${outline.title}" (${retryNovelty.noveltyScore}/100)`);
      }
    } else {
      logDetail(`Novelty: ${novelty.noveltyScore}/100`);
    }

    // Stage 4: Write sections
    const sections = await stage4_writeSections(outline, research, guidelines);

    // Stage 5: Assemble
    const { fullHtml, inlineImagePrompt } = stage5_assemble(sections, outline);

    // Stage 6: Edit
    const edited = await stage6_edit(fullHtml, outline, guidelines);

    // Stage 7: Humanize
    const humanized = await stage7_humanize(edited, outline, guidelines);

    // Stage 8: Cross-link
    const linked = await stage8_crossLink(humanized, outline);

    // Stage 9: Images
    const slug = `${dateISOmt()}-${slugify(outline.title)}`;
    const images = await stage9_generateImages(outline, slug);

    // Stage 10: Build HTML
    const postMeta = await stage10_buildHtml(linked, topicInfo, outline, images);

    // Record to content memory
    try {
      memory.recordPost({
        title: outline.title,
        date: postMeta.dateISO,
        excerpt: outline.excerpt,
        content: linked.replace(/<[^>]+>/g, ' '),
        topic: topicInfo.topic
      });
      logDetail('Recorded to content memory');
    } catch (err) {
      console.warn(chalk.yellow(`  Memory recording failed: ${err.message}`));
    }

    console.log(chalk.gray('\n' + '='.repeat(50)));
    console.log(chalk.bold.green('\nBlog post generated successfully!\n'));
    console.log(chalk.gray(`  File: blog/posts/${postMeta.filename}`));
    console.log(chalk.gray(`  Next: npm run blog:rss\n`));

  } catch (error) {
    console.error(chalk.red('\nGeneration failed:', error.message));
    if (error.stack) console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

main();
