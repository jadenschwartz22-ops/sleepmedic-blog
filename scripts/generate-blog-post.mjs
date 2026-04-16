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
  const fullPrompt = `Generate a professional editorial blog cover photograph: ${prompt}. Warm natural tones, soft ambient lighting, atmospheric depth. No text overlay, no watermarks. If people appear, show them from behind, from the side, or at a distance -- never show a full face directly facing the camera. Landscape 16:9 composition. Photorealistic style. IMPORTANT: Generate diverse, visually distinct editorial imagery. Could be: atmospheric landscapes (misty mountains at dawn, ocean at blue hour), science/biology visualizations (neurons firing, circadian rhythm diagrams rendered beautifully), lifestyle moments (morning coffee ritual, stretching at golden hour), workplace scenes (hospital corridor, fire station, cockpit), nature (forest canopy light, desert starscape, rain on glass), abstract light studies (light through blinds, neon reflections on wet pavement), macro photography (clock gears, condensation drops, plant tendrils), urban scenes at unusual hours (empty streets at 4am, city skyline at twilight). AVOID: generic bedrooms, beds, pillows, sleeping people. Each image should be visually surprising and distinct.`;
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
  const useOriginalTopic = Math.random() < 0.5;

  let topic, tag, bucketName;

  if (useOriginalTopic) {
    // Generate an original topic via LLM -- not limited to predefined buckets
    logDetail('Generating original topic (not from predefined list)...');
    const bucketNames = buckets.map(b => `${b.name} (${b.tag})`).join(', ');
    const recentList = recent.slice(-15).join('; ');

    const generated = await gemini(
      `You are the editorial director for SleepMedic, a sleep science blog.
Your audience: anyone with sleep problems, with a core niche of shift workers.

EXISTING TOPIC BUCKETS (for reference, not a constraint): ${bucketNames}
RECENTLY COVERED (avoid overlap): ${recentList || 'none yet'}

Generate a completely ORIGINAL blog topic that goes BEYOND the predefined buckets above.
Consider:
- Emerging sleep science research or findings from the last 1-2 years
- Underserved questions people ask about sleep that lack authoritative answers online
- Niche intersections (sleep + specific professions, sleep + mental health conditions, sleep + medications, sleep + age groups, sleep + seasons/travel/altitude)
- What sleep-related questions have HIGH SEARCH INTEREST but FEW authoritative answers?
- Topics trending in sleep medicine forums, Reddit r/sleep, or health Q&A sites

The topic must be specific enough for a focused 800-1200 word article. Not a broad overview.

Return JSON:
{
  "topic": "the specific topic (5-12 words)",
  "tag": "closest category tag: shift-work | circadian | sleep-hygiene | conditions | supplements | tools",
  "bucketName": "closest bucket name"
}`,
      { json: true, temp: 0.9, search: true }
    );

    topic = generated.topic;
    tag = generated.tag || 'sleep-hygiene';
    bucketName = generated.bucketName || 'General';
    logDetail(`Original topic generated: "${topic}"`);
  } else {
    // Pick from predefined topic buckets
    const execIndex = (await loadRecentTopics()).length;
    let bucket = buckets[(execIndex + offset) % buckets.length];
    let idx = Math.floor((execIndex + offset) / buckets.length) % bucket.topics.length;
    topic = bucket.topics[idx];

    for (let i = 0; i < 40 && recent.includes(topic); i++) {
      idx = (idx + 1) % bucket.topics.length;
      if (idx === 0) bucket = buckets[(buckets.indexOf(bucket) + 1) % buckets.length];
      topic = bucket.topics[idx];
    }

    tag = bucket.tag;
    bucketName = bucket.name;
    logDetail(`Picked from bucket: "${bucketName}"`);
  }

  // LLM generates a specific angle on the topic with SEO awareness
  const angleData = await gemini(
    `Topic: "${topic}"
Category: ${bucketName} (${tag})

Generate a specific, compelling angle for a blog post on this topic.
Think: what's the one question someone would Google at 2am about this?
Consider: what related search queries have high interest but few quality results?

Return JSON:
{
  "angle": "specific angle (1 sentence)",
  "audience_segment": "who this helps most (e.g., 'night shift nurses', 'anxious sleepers', 'new parents')",
  "emotional_hook": "the feeling or frustration that drives someone to search for this (1 sentence)",
  "search_query": "what someone would actually type into Google",
  "seo_gap": "a related question with high search interest but few authoritative answers"
}`,
    { json: true, temp: 0.8 }
  );

  await saveTopicToHistory(topic);

  const result = { topic, tag, bucketName, ...angleData };
  logDetail(`Topic: "${topic}" [${tag}]`);
  logDetail(`Angle: ${angleData.angle}`);
  logDetail(`Audience: ${angleData.audience_segment}`);
  if (angleData.seo_gap) logDetail(`SEO gap: ${angleData.seo_gap}`);
  return result;
}

function getTemplateFormat() {
  const formats = ['Story-First', 'Science-First', 'Myth-Busting', 'Field Manual', 'Q&A', 'History/Philosophy Lens'];
  return formats[Math.floor(Math.random() * formats.length)];
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
${topicInfo.seo_gap ? `SEO gap to address: ${topicInfo.seo_gap}` : ''}

Also research: What are people actively searching for related to "${topicInfo.topic}"? Find related queries with high search interest that this article should address.

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
  "practical_protocols": ["technique name with origin"],
  "seo_angles": ["related search query people actually type 1", "related search query 2", "related search query 3"]
}

RULES:
- 3-5 studies from trusted sources (CDC, NIH, PubMed, AASM, WHO, Cochrane, NHLBI)
- 2-3 statistics with real numbers
- Only include URLs you are confident are real
- Mechanisms must be named physiological processes (circadian phase, homeostatic sleep drive, thermoregulation, etc.)
- seo_angles: 2-4 real search queries people use related to this topic (think Google autocomplete, "People also ask", related searches)
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
  if (research.seo_angles?.length) logDetail(`SEO angles: ${research.seo_angles.join('; ')}`);
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

  const planPrompt = `Plan a blog post.

TOPIC: "${topicInfo.topic}"
ANGLE: ${topicInfo.angle}
AUDIENCE: ${topicInfo.audience_segment}
EMOTIONAL HOOK: ${topicInfo.emotional_hook}
SEARCH QUERY: ${topicInfo.search_query}
${topicInfo.seo_gap ? `SEO GAP: ${topicInfo.seo_gap}` : ''}
${research.seo_angles?.length ? `RELATED SEARCHES TO ADDRESS: ${research.seo_angles.join('; ')}` : ''}

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
  "imagePrompt": "a visually distinct, editorial scene. Be creative and varied. Examples: misty mountain ridge at first light, neurons firing in a stylized brain cross-section, rain streaking down a kitchen window at dawn, a lone jogger on an empty bridge at blue hour, macro shot of an espresso surface, city skyline shifting from night to sunrise, a lab bench with a circadian rhythm chart, golden light filtering through forest canopy, hands wrapped around a thermos on a cold morning, neon pharmacy sign reflected in a rain puddle. Avoid: beds, bedrooms, pillows, generic sleeping scenes. Each post should look completely different.",
  "cover_alt": "80-125 char descriptive alt text for cover image including primary keyword",
  "inline_image_after_section": 2,
  "inline_image_prompt": "a second editorial image tied to this section's content. Be visually creative -- nature, science, workplace, urban, or abstract. NOT a bedroom or bed.",
  "inline_alt": "80-125 char descriptive alt text for inline image including primary keyword",
  "closingLine": "short grounded closing line"
}

RULES:
- 4-6 sections including intro hook and closing protocol
- research_refs are indices into the studies array -- assign each study to a section
- First section: strong hook (scene, stat, or story)
- Last section: protocol/checklist (3-7 items) + sources + disclaimer
- Section headings: specific to THIS topic, never generic
- inline_image_after_section: pick the section index where a visual would help most
- Title must match what someone would search for. No clickbait.
- cover_alt and inline_alt: descriptive, 80-125 chars, include the primary keyword phrase
- If RELATED SEARCHES are provided, work at least 1-2 into section headings or content angles (these are real queries people type).`;

  let outline = await gemini(planPrompt, { system, json: true, temp: 0.7 });

  // Validate title contains at least one token from seo_angles or topic
  const seoTokens = [
    ...(research.seo_angles || []),
    topicInfo.topic
  ].flatMap(s => s.toLowerCase().split(/\s+/)).filter(t => t.length > 3);
  const titleLower = (outline.title || '').toLowerCase();
  const titleHasToken = seoTokens.some(t => titleLower.includes(t));

  // Validate excerpt length (140-160 chars) and contains primary keyword
  const primaryKw = (topicInfo.search_query || topicInfo.topic).toLowerCase().split(/\s+/).slice(0, 3).join(' ');
  const excerptLen = (outline.excerpt || '').length;
  const excerptValid = excerptLen >= 140 && excerptLen <= 160 && (outline.excerpt || '').toLowerCase().includes(primaryKw.split(' ')[0]);

  if (!titleHasToken || !excerptValid) {
    if (!titleHasToken) logDetail(`Title missing SEO token, retrying stage 3...`);
    if (!excerptValid) logDetail(`Excerpt length ${excerptLen} or missing keyword, retrying stage 3...`);
    const retry = await gemini(planPrompt, { system, json: true, temp: 0.7 });
    outline = retry;
  }

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

// ── Heading hierarchy lint ────────────────────────────
function fixHeadingHierarchy(html) {
  // Strip any <h1> in body content (template provides the page H1)
  html = html.replace(/<h1([^>]*)>([\s\S]*?)<\/h1>/gi, '<h2$1>$2</h2>');
  // Promote orphan <h3> that have no preceding <h2> in the same content
  let hasH2 = false;
  html = html.replace(/<(\/?)h([23])([^>]*)>/gi, (match, close, level, attrs) => {
    if (level === '2') { if (!close) hasH2 = true; return match; }
    if (level === '3') {
      if (!hasH2) return `<${close}h2${attrs}>`;
    }
    return match;
  });
  return html;
}

async function stage10_buildHtml(content, topicInfo, outline, images) {
  log(10, 'Building HTML...');

  const template = await fs.readFile('blog/_template.html', 'utf8');
  const dateISO = dateISOmt();
  const dateFormatted = dateFormattedMT();
  const slug = `${dateISO}-${slugify(outline.title)}`;

  // Heading hierarchy lint pass
  content = fixHeadingHierarchy(content);

  const wordCount = content.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
  const readTime = Math.ceil(wordCount / 200);

  // Insert inline image at the slot
  if (images.inlinePath) {
    const relPath = `images/${slug}-inline-1.jpg`;
    const inlineAlt = outline.inline_alt || `Illustration for ${outline.title}`;
    const imgHtml = `<figure style="margin: 32px 0;">
        <img src="${relPath}" alt="${inlineAlt}" style="width: 100%; border-radius: 16px; max-height: 360px; object-fit: cover;" loading="lazy">
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

    const coverAlt = outline.cover_alt || `Cover image for ${outline.title}`;
    const coverHtml = `      <div style="margin-bottom: 40px;">
        <img src="${imageRelPath}" alt="${coverAlt}" style="width: 100%; max-height: 400px; object-fit: cover; border-radius: 24px;" loading="lazy">
      </div>\n`;
    html = html.replace('<div class="post-content">', coverHtml + '      <div class="post-content">');
  }

  // ── FAQ + HowTo schema injection ──────────────────────
  const extraSchemas = [];

  // FAQPage: Q&A template type OR 3+ h2s ending with ?
  const faqH2s = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  const questionH2s = faqH2s.filter(h => h.endsWith('?'));
  if (outline.template_type === 'Q&A' || questionH2s.length >= 3) {
    const mainEntity = questionH2s.map(q => {
      // Extract text of paragraphs between this h2 and the next heading
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = html.match(new RegExp(`<h2[^>]*>${escaped}<\\/h2>([\\s\\S]*?)(?=<h[23]|$)`, 'i'));
      const answerText = match ? match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
      return { '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: answerText } };
    });
    if (mainEntity.length >= 3) {
      extraSchemas.push(JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity }, null, 2));
      logDetail(`FAQPage schema: ${mainEntity.length} questions`);
    }
  }

  // HowTo: Field Manual template type OR first <ol> with 3+ <li>
  const olMatch = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i);
  if (outline.template_type === 'Field Manual' || olMatch) {
    const olHtml = olMatch ? olMatch[1] : '';
    const liItems = [...olHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (liItems.length >= 3) {
      const steps = liItems.map((text, i) => ({
        '@type': 'HowToStep',
        name: text.slice(0, 80),
        text: text.slice(0, 300)
      }));
      extraSchemas.push(JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: outline.title,
        step: steps
      }, null, 2));
      logDetail(`HowTo schema: ${steps.length} steps`);
    }
  }

  if (extraSchemas.length) {
    const injection = extraSchemas.map(s => `  <script type="application/ld+json">\n  ${s}\n  </script>`).join('\n');
    html = html.replace('</head>', `${injection}\n</head>`);
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
