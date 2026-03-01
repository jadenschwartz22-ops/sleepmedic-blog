/**
 * Multi-Agent SleepMedic Blog Generator
 *
 * Pipeline:
 * 1. Topic Selection    - Rotates through editorial calendar
 * 2. Planner Agent      - Creates outline (title, sections, image prompt)
 * 3. Section Writers    - One Gemini call per section, builds on previous context
 * 4. Editor Agent       - Reviews full draft, removes AI-isms, polishes
 * 5. Cross-Linker Agent - Adds internal links to related existing posts
 * 6. Imagen 3           - Generates cover image
 * 7. HTML Builder       - Assembles final post from template
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
  return text.toLowerCase().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
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

// ── Gemini Text API ────────────────────────────────────

async function gemini(prompt, { system, json = false, temp = 0.7, maxTokens = 8192 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temp,
      maxOutputTokens: maxTokens,
      ...(json && { responseMimeType: 'application/json' })
    }
  };

  if (system) {
    body.system_instruction = { parts: [{ text: system }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');

  const cleaned = stripCodeFences(text);
  return json ? JSON.parse(cleaned) : cleaned;
}

// ── Imagen 3 Image Generation ──────────────────────────

async function generateImage(scenePrompt, outputPath) {
  console.log(chalk.cyan('  Generating cover image with Imagen 3...'));

  const prompt = `Professional editorial blog cover photograph: ${scenePrompt}. Warm natural tones, soft ambient lighting, atmospheric depth. No text overlay, no watermarks, no human faces. Landscape composition.`;

  // Try multiple endpoint formats for compatibility
  const attempts = [
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${GEMINI_API_KEY}`,
      body: { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: '16:9' } },
      extract: d => d.predictions?.[0]?.bytesBase64Encoded
    },
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImages?key=${GEMINI_API_KEY}`,
      body: { prompt, config: { numberOfImages: 1, aspectRatio: '16:9', outputOptions: { mimeType: 'image/jpeg' } } },
      extract: d => d.generatedImages?.[0]?.image?.imageBytes
    },
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${GEMINI_API_KEY}`,
      body: { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: '16:9' } },
      extract: d => d.predictions?.[0]?.bytesBase64Encoded
    }
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt.body)
      });

      if (!res.ok) continue;

      const data = await res.json();
      const base64 = attempt.extract(data);
      if (!base64) continue;

      await fs.mkdir('blog/posts/images', { recursive: true });
      await fs.writeFile(outputPath, Buffer.from(base64, 'base64'));
      console.log(chalk.green('  Cover image saved'));
      return outputPath;
    } catch {
      continue;
    }
  }

  console.warn(chalk.yellow('  Image generation unavailable, proceeding without cover image'));
  return null;
}

// ── Topic Selection ────────────────────────────────────

async function loadRecentTopics() {
  try { return JSON.parse(await fs.readFile('tmp/recent-topics.json', 'utf8')); }
  catch { return []; }
}

async function saveTopicToHistory(topic) {
  try {
    await fs.mkdir('tmp', { recursive: true });
    let recent = await loadRecentTopics();
    recent.push({ topic, generatedAt: new Date().toISOString() });
    await fs.writeFile('tmp/recent-topics.json', JSON.stringify(recent.slice(-10), null, 2));
  } catch {}
}

async function selectTopic() {
  const { buckets } = yaml.parse(await fs.readFile('scripts/editorial/topics.yaml', 'utf8'));
  const recent = (await loadRecentTopics()).map(t => t.topic);
  const week = getWeekNumber();

  let bucket = buckets[week % buckets.length];
  let idx = Math.floor(week / buckets.length) % bucket.topics.length;
  let topic = bucket.topics[idx];

  for (let i = 0; i < 20 && recent.includes(topic); i++) {
    idx = (idx + 1) % bucket.topics.length;
    if (idx === 0) bucket = buckets[(buckets.indexOf(bucket) + 1) % buckets.length];
    topic = bucket.topics[idx];
  }

  console.log(chalk.bold(`Selected topic: "${topic}" [${bucket.tag}]\n`));
  await saveTopicToHistory(topic);

  return { topic, tag: bucket.tag, bucketName: bucket.name };
}

function getTemplateFormat() {
  const formats = ['Story-First', 'Science-First', 'Myth-Busting', 'Field Manual', 'Q&A', 'History/Philosophy Lens'];
  return formats[getWeekNumber() % formats.length];
}

// ── Agent 1: Planner ───────────────────────────────────

async function planPost(topicInfo, guidelines) {
  console.log(chalk.cyan('[Agent 1] Planning post structure...'));

  const format = getTemplateFormat();

  const system = `You are a blog editor for SleepMedic, a sleep science publication.
Primary audience: anyone struggling with sleep (insomnia, anxiety, bad habits, schedule chaos).
Core niche: shift workers (EMTs, nurses, firefighters) who can't follow rigid sleep advice.
Secondary: health optimizers, wearable users, parents, students, travelers.

Write for the broadest relevant audience. Add shift-worker tips where they naturally fit, but don't force every post to be about shift work. If the topic IS shift-work specific, write directly for that audience.

${guidelines}

This week's template format: ${format}`;

  const prompt = `Plan a blog post on: "${topicInfo.topic}"
Category: ${topicInfo.bucketName} (${topicInfo.tag})

The post should be ~700-1000 words total across all sections.

Return JSON:
{
  "title": "6-10 words, specific and concrete. No AI cliches like 'Ultimate Guide' or 'Everything You Need'",
  "excerpt": "140-160 char compelling summary",
  "keywords": "comma-separated SEO keywords matching what people actually Google",
  "sections": [
    {
      "heading": "Specific section heading",
      "angle": "What this section covers and why it matters",
      "keyPoints": ["specific point 1", "specific point 2"],
      "mechanisms": ["named physiological mechanism if applicable"],
      "targetWords": 150
    }
  ],
  "imagePrompt": "Specific atmospheric scene description for AI image generation. Example: 'dimly lit bedroom at 3am, phone glowing on nightstand, tangled sheets'. NOT generic stock photo language.",
  "closingLine": "Short grounded closing line like 'Rest well. Rise ready.'"
}

RULES:
- 4-6 sections including intro hook and closing protocol/checklist
- First section: strong hook (scene, stat, or brief story), NOT a generic intro
- Include at least one section with a decision tree, protocol, or checklist
- Last section: sources (3-5 real URLs from CDC/NIH/AASM/WHO/Cochrane) + disclaimer
- Image prompt: describe a specific scene, not generic wellness imagery
- Title: be specific to THIS topic. Avoid "What You Need to Know" and "Evidence-Based" patterns
- Write for the GENERAL audience unless the topic is specifically about shift work`;

  return await gemini(prompt, { system, json: true, temp: 0.75 });
}

// ── Agent 2: Section Writers ───────────────────────────

async function writeSections(outline) {
  console.log(chalk.cyan(`\n[Agent 2] Writing ${outline.sections.length} sections...`));

  const system = `You write for SleepMedic, a sleep science blog.
Primary audience: anyone struggling with sleep (insomnia, anxiety, bad habits, schedule chaos).
Core niche: shift workers (EMTs, nurses, firefighters) who can't follow rigid sleep advice.
Secondary: health optimizers, wearable users, parents, students, travelers.

Voice: warm, direct, expert. Write like a sleep researcher who genuinely wants to help.
Write for the broadest relevant audience. Add shift-worker angles where they naturally fit, but don't force it. If the topic IS shift-work specific, write directly for that audience.

ANTI-AI RULES (critical):
- NEVER use: "Let's dive in", "In conclusion", "It's important to note", "It's worth noting", "As we've seen", "Whether you're a", "game-changer", "navigate", "landscape", "robust", "leverage", "holistic", "unpack", "Here's the thing", "The reality is", "At the end of the day", "Studies have shown", "Research suggests", "Experts agree", "In today's fast-paced world"
- Vary sentence length dramatically. Short punch. Then a longer observation with a specific detail or mechanism explained clearly.
- Use "you" directly. Never "one should" or "it is recommended that"
- Include specific numbers: temperatures in Fahrenheit, durations in minutes, percentages, doses
- Use contractions naturally (don't, you'll, it's, can't)
- No filler paragraphs. Every sentence earns its place.
- Never start two consecutive paragraphs the same way
- No summary sentences that repeat what you just said`;

  const sections = [];
  let prevContext = '';

  for (let i = 0; i < outline.sections.length; i++) {
    const section = outline.sections[i];
    const isFirst = i === 0;
    const isLast = i === outline.sections.length - 1;
    const temp = isFirst ? 0.8 : isLast ? 0.5 : 0.65;

    let prompt = `Write the "${section.heading}" section for a blog post titled "${outline.title}".

This section's job: ${section.angle}
Key points: ${section.keyPoints.join('; ')}
${section.mechanisms?.length ? `Mechanisms to name and explain: ${section.mechanisms.join(', ')}` : ''}
Target: ~${section.targetWords || 150} words.`;

    if (isFirst) {
      prompt += `\n\nThis is the OPENING. Start with a strong hook: a scene, a striking number, or a two-sentence story. Jump right in. No generic intro like "Sleep is important" or "As shift workers, we all know..."`;
    }

    if (prevContext) {
      prompt += `\n\nPrevious section ended with:\n"${prevContext}"\nContinue so it flows naturally.`;
    }

    if (isLast) {
      prompt += `\n\nThis is the CLOSING section. Include:
1. A compact protocol, checklist, or decision tree (3-7 actionable items)
2. Sources section with 3-5 inline-linked citations (CDC, NIH, AASM, WHO, Cochrane) using real URLs
3. One-line disclaimer: "This is not medical advice. Talk to your provider."
4. End with: "${outline.closingLine || 'Rest well. Rise ready.'}"`;
    }

    prompt += `\n\nReturn ONLY the HTML for this section. Tags: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a>, <blockquote>. No wrapper divs. No title. CRITICAL: Every paragraph of text MUST be wrapped in <p> tags. No bare text outside of tags.`;

    const html = await gemini(prompt, { system, temp });
    sections.push(html);

    // Extract tail for context continuity
    const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = plainText.split(' ');
    prevContext = words.slice(-40).join(' ');

    console.log(chalk.gray(`  ${i + 1}/${outline.sections.length}: "${section.heading}" (${words.length} words)`));
  }

  return sections.join('\n\n');
}

// ── Agent 3: Editor ────────────────────────────────────

async function editPost(rawHtml, outline) {
  console.log(chalk.cyan('\n[Agent 3] Editing and polishing...'));

  const system = `You are a senior editor at SleepMedic. Polish this draft so it reads like a knowledgeable human wrote it, not AI.

WHAT TO FIX:
- Remove ANY phrase that sounds AI-generated (hedging, filler, generic transitions)
- Ensure sections flow naturally (no abrupt topic jumps, no repetitive openings)
- Vary paragraph length: some 1 sentence, some 3-4 sentences
- Vary sentence structure throughout the piece
- Opening hook must grab attention in the first line
- All citations must have inline <a> links
- Advice must be specific (exact temps, durations, protocols)
- Fix any redundancy between sections

BANNED PHRASES (rewrite or remove on sight):
"Let's dive in", "In conclusion", "It's worth noting", "As we've seen",
"In today's post", "Whether you're a", "Look no further", "game-changer",
"dive deep", "unpack", "navigate the landscape", "robust", "leverage",
"holistic approach", "synergy", "optimize your", "hack your sleep",
"Here's the thing", "The reality is", "At the end of the day",
"Studies have shown", "Research suggests", "Experts agree",
"In today's fast-paced world", "When it comes to", "It goes without saying"

KEEP INTACT:
- Specific mechanism names (circadian phase, homeostatic sleep drive, thermoregulation)
- Exact numbers and protocols
- The warm, direct, expert tone
- All citation links and source URLs
- Section headings (h2/h3 tags)`;

  const prompt = `Polish this blog post draft. Title: "${outline.title}"

${rawHtml}

Return ONLY the polished HTML body content. Same tag set: h2, h3, p, ul, li, strong, a, blockquote.
Do NOT include the title, any wrapper divs, or meta commentary. Just the article body.
CRITICAL: Every paragraph of text MUST be wrapped in <p> tags. No bare text outside of HTML tags.`;

  return await gemini(prompt, { system, temp: 0.4, maxTokens: 8192 });
}

// ── Agent 4: Cross-Linker ──────────────────────────────

async function addCrossLinks(html, outline) {
  console.log(chalk.cyan('\n[Agent 4] Adding internal links to related posts...'));

  let postsIndex;
  try {
    postsIndex = JSON.parse(await fs.readFile('blog/posts-index.json', 'utf8'));
  } catch {
    console.log(chalk.gray('  No posts index found, skipping'));
    return html;
  }

  if (!postsIndex.length) {
    console.log(chalk.gray('  No existing posts to link to'));
    return html;
  }

  const posts = postsIndex.map(p => `- "${p.title}" -> ../posts/${p.slug}.html\n  ${p.excerpt}`).join('\n');

  const system = `You add internal links to SleepMedic blog posts. You receive a post and a list of existing posts. Find 1-3 natural places to link to related content.`;

  const prompt = `Current post title: "${outline.title}"

EXISTING POSTS:
${posts}

CURRENT POST HTML:
${html}

Add 1-3 internal links where the current post discusses a topic covered in an existing post.

RULES:
- Only link where it genuinely adds value for the reader
- Use natural anchor text (2-5 words), not the full title. Example: <a href="../posts/slug.html">our earlier post on wake consistency</a>
- Don't link in the first paragraph (let the hook stand alone)
- Don't link in the sources/citation list
- Maximum 3 links total
- If no good link fits exist, return the content EXACTLY as-is
- Don't add new sentences just to create a link opportunity
- Don't change any existing text beyond inserting the <a> tag

Return the FULL HTML content with links inserted (or unchanged).`;

  return await gemini(prompt, { system, temp: 0.3 });
}

// ── HTML Builder ───────────────────────────────────────

async function createHtmlFile(content, topicInfo, outline, imagePath) {
  const template = await fs.readFile('blog/_template.html', 'utf8');

  const now = new Date();
  const dateISO = now.toISOString().split('T')[0];
  const dateFormatted = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const slug = `${dateISO}-${slugify(outline.title)}`;
  const wordCount = content.replace(/<[^>]+>/g, '').split(/\s+/).length;
  const readTime = Math.ceil(wordCount / 200);

  let html = template
    .replace(/\{\{TITLE\}\}/g, outline.title)
    .replace(/\{\{EXCERPT\}\}/g, outline.excerpt)
    .replace(/\{\{SLUG\}\}/g, slug)
    .replace(/\{\{DATE_ISO\}\}/g, dateISO)
    .replace(/\{\{DATE_FORMATTED\}\}/g, dateFormatted)
    .replace(/\{\{CATEGORY\}\}/g, topicInfo.tag)
    .replace(/\{\{KEYWORDS\}\}/g, outline.keywords)
    .replace(/\{\{READ_TIME\}\}/g, readTime)
    .replace(/\{\{CONTENT\}\}/g, content);

  // Insert cover image before post-content div (same position as old Unsplash workflow)
  if (imagePath) {
    const imageRelPath = `images/${slug}-cover.jpg`;
    const coverHtml = `      <div style="margin-bottom: 40px;">
        <img src="${imageRelPath}" alt="Cover image for ${outline.title}" style="width: 100%; max-height: 400px; object-fit: cover; border-radius: 24px;" loading="lazy">
        <p style="text-align: center; font-size: 0.85rem; color: var(--muted); margin-top: 8px;">Image by SleepMedic AI</p>
      </div>\n`;
    html = html.replace('<div class="post-content">', coverHtml + '      <div class="post-content">');
  }

  const filename = `${slug}.html`;
  const filepath = `blog/posts/${filename}`;
  await fs.writeFile(filepath, html, 'utf8');

  console.log(chalk.green(`\nCreated: ${filepath}`));
  console.log(chalk.gray(`  ${wordCount} words, ${readTime} min read\n`));

  // Save metadata for CI/workflow
  await fs.mkdir('tmp', { recursive: true });
  await fs.writeFile('tmp/post-metadata.json', JSON.stringify({
    title: outline.title,
    excerpt: outline.excerpt,
    filename,
    slug,
    date: dateISO,
    topic: topicInfo.topic,
    tag: topicInfo.tag,
    readTime,
    hasAiImage: !!imagePath
  }, null, 2));

  return { filename, slug, dateISO, readTime };
}

// ── Update Blog Index ──────────────────────────────────

async function updateBlogIndex(postMeta, outline, topicInfo) {
  const indexPath = 'blog/index.html';
  let indexHtml = await fs.readFile(indexPath, 'utf8');

  const slug = postMeta.slug;
  const newPost = {
    title: outline.title,
    excerpt: outline.excerpt,
    slug,
    date: postMeta.dateISO,
    dateFormatted: new Date(postMeta.dateISO).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    category: topicInfo.tag.toLowerCase(),
    categoryLabel: topicInfo.tag,
    readTime: postMeta.readTime,
    coverImage: `posts/images/${slug}-cover.jpg`
  };

  let postsArray = [];
  const match = indexHtml.match(/const posts = \[([\s\S]*?)\];/);
  if (match?.[1]?.trim()) {
    try { postsArray = JSON.parse(`[${match[1]}]`); } catch {}
  }

  postsArray.unshift(newPost);
  indexHtml = indexHtml.replace(/const posts = \[[\s\S]*?\];/, `const posts = ${JSON.stringify(postsArray, null, 2)};`);

  await fs.writeFile(indexPath, indexHtml, 'utf8');
  console.log(chalk.green('Updated blog/index.html\n'));
}

// ── Main Pipeline ──────────────────────────────────────

async function main() {
  console.log(chalk.bold.cyan('\nSleepMedic Multi-Agent Blog Generator\n'));
  console.log(chalk.gray('='.repeat(50) + '\n'));

  try {
    // 1. Select topic
    const topicInfo = await selectTopic();

    // 2. Load editorial guidelines
    const guidelines = await fs.readFile('scripts/editorial/style_guidelines.md', 'utf8');

    // 3. Agent 1: Plan the post
    const outline = await planPost(topicInfo, guidelines);
    console.log(chalk.bold(`  Title: ${outline.title}`));
    console.log(chalk.gray(`  Sections: ${outline.sections.length}`));
    console.log(chalk.gray(`  Image: ${outline.imagePrompt}\n`));

    // Novelty check
    const memory = new ContentMemory();
    const novelty = memory.checkTitleNovelty(outline.title);

    if (novelty.noveltyScore < 20) {
      console.log(chalk.yellow(`  Title novelty low (${novelty.noveltyScore}/100), retrying...`));
      const retry = await planPost(topicInfo, guidelines);
      const retryNovelty = memory.checkTitleNovelty(retry.title);
      if (retryNovelty.noveltyScore > novelty.noveltyScore) {
        Object.assign(outline, retry);
        console.log(chalk.green(`  New title: "${outline.title}" (${retryNovelty.noveltyScore}/100)`));
      }
    } else {
      console.log(chalk.green(`  Novelty: ${novelty.noveltyScore}/100`));
    }

    // 4. Agent 2: Write each section
    const rawContent = await writeSections(outline);

    // 5. Agent 3: Edit and polish
    const polishedContent = await editPost(rawContent, outline);

    // 6. Agent 4: Add cross-links to existing posts
    const linkedContent = await addCrossLinks(polishedContent, outline);

    // 7. Generate cover image with Imagen 3
    const slug = `${new Date().toISOString().split('T')[0]}-${slugify(outline.title)}`;
    const imagePath = `blog/posts/images/${slug}-cover.jpg`;
    const imageResult = await generateImage(outline.imagePrompt, imagePath);

    // 8. Build HTML file
    const postMeta = await createHtmlFile(linkedContent, topicInfo, outline, imageResult);

    // 9. Update blog index
    await updateBlogIndex(postMeta, outline, topicInfo);

    console.log(chalk.gray('='.repeat(50)));
    console.log(chalk.bold.green('\nBlog post generated successfully!\n'));
    console.log(chalk.gray('  File: blog/posts/' + postMeta.filename));
    console.log(chalk.gray('  Next: npm run blog:rss\n'));

  } catch (error) {
    console.error(chalk.red('\nGeneration failed:', error.message));
    if (error.stack) console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

main();
