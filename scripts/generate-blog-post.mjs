/**
 * Generate SleepMedic Blog Post using GPT-4o-mini
 * Creates complete HTML blog post from template
 */

import OpenAI from 'openai';
import fs from 'fs/promises';
import yaml from 'yaml';
import chalk from 'chalk';
import { checkForDuplicate } from './check-duplicate-titles.mjs';

// Initialize OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!OPENAI_API_KEY) {
  console.error(chalk.red('❌ OPENAI_API_KEY environment variable is required'));
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/**
 * Slugify string for URLs
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

/**
 * Get ISO week number
 */
function getWeekNumber() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

/**
 * Load recent topic history
 */
async function loadRecentTopics() {
  try {
    const historyData = await fs.readFile('tmp/recent-topics.json', 'utf8');
    return JSON.parse(historyData);
  } catch {
    return [];
  }
}

/**
 * Save topic to history
 */
async function saveTopicToHistory(topic) {
  try {
    await fs.mkdir('tmp', { recursive: true });
    let recentTopics = await loadRecentTopics();

    recentTopics.push({
      topic,
      generatedAt: new Date().toISOString()
    });

    recentTopics = recentTopics.slice(-10); // Keep last 10
    await fs.writeFile('tmp/recent-topics.json', JSON.stringify(recentTopics, null, 2));
  } catch (error) {
    console.warn(chalk.yellow('⚠️  Could not save topic history:', error.message));
  }
}

/**
 * Select topic from rotation
 */
async function selectTopic() {
  const topicsYaml = await fs.readFile('scripts/editorial/topics.yaml', 'utf8');
  const { buckets } = yaml.parse(topicsYaml);

  const recentTopics = await loadRecentTopics();
  const recentTopicNames = recentTopics.map(t => t.topic);

  const week = getWeekNumber();
  let bucket = buckets[week % buckets.length];
  let topicIndex = Math.floor(week / buckets.length) % bucket.topics.length;
  let topic = bucket.topics[topicIndex];

  // Anti-repetition logic
  let attempts = 0;
  const maxAttempts = 20;

  while (recentTopicNames.includes(topic) && attempts < maxAttempts) {
    attempts++;
    topicIndex = (topicIndex + 1) % bucket.topics.length;

    if (topicIndex === 0) {
      const nextBucketIndex = (buckets.indexOf(bucket) + 1) % buckets.length;
      bucket = buckets[nextBucketIndex];
    }

    topic = bucket.topics[topicIndex];
  }

  if (recentTopicNames.includes(topic)) {
    console.log(chalk.yellow(`⚠️  Warning: Topic "${topic}" was used recently, but no unused topics available`));
  } else if (attempts > 0) {
    console.log(chalk.cyan(`✨ Skipped ${attempts} recently-used topic(s), selected fresh topic\n`));
  }

  console.log(chalk.bold(`📝 Selected topic: "${topic}"`));
  console.log(`   Tag: ${bucket.tag}`);
  console.log(`   Bucket: ${bucket.name}`);

  if (recentTopics.length > 0) {
    console.log(`   Recent: ${recentTopicNames.slice(-3).join(', ')}\n`);
  } else {
    console.log();
  }

  await saveTopicToHistory(topic);

  return {
    topic,
    tag: bucket.tag,
    bucketName: bucket.name
  };
}

/**
 * Load editorial guidelines
 */
async function loadGuidelines() {
  return await fs.readFile('scripts/editorial/style_guidelines.md', 'utf8');
}

/**
 * Calculate template format based on week
 */
function getTemplateFormat(week) {
  const formats = [
    'Story-First',
    'Science-First',
    'Myth-Busting',
    'Field Manual',
    'Q&A',
    'History/Philosophy Lens'
  ];
  return formats[week % formats.length];
}

/**
 * Generate blog content using GPT-4o-mini
 */
async function generateContent(topicInfo, guidelines) {
  const week = getWeekNumber();
  const templateFormat = getTemplateFormat(week);

  console.log(chalk.cyan(`🤖 Generating with GPT-4o-mini (${MODEL})...`));
  console.log(chalk.gray(`   Template: ${templateFormat}\n`));

  const systemPrompt = `You write for **SleepMedic**. Audience: shift workers (EMTs/medics, nurses, first responders) + busy humans.
Voice: warm, direct, science-forward, with a pinch of playful/philosophical. Short paragraphs. No fluff.

${guidelines}

This week's template format: **${templateFormat}**

Write a **non-rigid blog post** (~700–1,000 words). Include:
- Strong hook (scene, stat, or brief story)
- 3–6 sections with clear subheads
- **3–6 evidence points** tied to named mechanisms (circadian phase, homeostatic sleep drive, thermoregulation, etc.)
- Brief history/cultural context where helpful
- Compact actionable checklist or protocol near the end
- **3–5 sources** (CDC, NIH, NIA, NAMS, AASM, ACOG, WHO, Cochrane)
- Brief disclaimer + cover image suggestion

Return ONLY valid JSON:
{
  "title": "6–10 words; concrete benefit or curiosity; no emojis",
  "excerpt": "140–160 character summary",
  "content_html": "Full HTML content (use <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a> tags, <blockquote> for quotes)",
  "keywords": "comma-separated keywords for SEO",
  "image_idea": "One-line conceptual cover image idea (no stock photos)"
}`;

  const userPrompt = `Topic: "${topicInfo.topic}"
Bucket: "${topicInfo.bucketName}"
Tag: ${topicInfo.tag}

Focus on life as a shift worker - how to protect sleep, manage circadian disruption, evidence-based tactics, real-world application.

Make it:
- Science-forward with mechanisms explained
- Practical and actionable
- Evidence-based with citations
- Relevant to shift workers, first responders, busy humans

Return ONLY the JSON object, no other text.`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.65,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    const content = JSON.parse(completion.choices[0].message.content);

    console.log(chalk.green('✅ Content generated successfully\n'));
    console.log(chalk.bold(`   Title: ${content.title}`));
    console.log(`   Word count: ~${content.content_html.split(/\s+/).length}`);
    console.log(`   Image idea: ${content.image_idea}\n`);

    // Check for duplicate titles
    const duplicateCheck = checkForDuplicate(content.title);
    if (duplicateCheck.isDuplicate) {
      console.log(chalk.yellow('⚠️  Title is too similar to existing post, regenerating...\n'));
      // Add existing titles to prompt to avoid them
      const avoidTitles = duplicateCheck.existingTitles.join('\n- ');
      const retryPrompt = userPrompt + `\n\nIMPORTANT: Avoid these existing titles (make yours distinctly different):\n- ${avoidTitles}`;

      // Retry with modified prompt
      const retryCompletion = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0.75, // Higher temperature for more variety
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: retryPrompt }
        ]
      });

      const retryContent = JSON.parse(retryCompletion.choices[0].message.content);

      // Check again
      const secondCheck = checkForDuplicate(retryContent.title);
      if (secondCheck.isDuplicate) {
        console.log(chalk.red('❌ Still duplicate after retry, using anyway but with warning'));
        console.log(chalk.yellow('⚠️  Manual review recommended to avoid confusion'));
      }

      console.log(chalk.green('✅ New unique title generated: ' + retryContent.title));
      return retryContent;
    }

    return content;
  } catch (error) {
    console.error(chalk.red('❌ GPT-4o-mini generation failed:', error.message));
    throw error;
  }
}

/**
 * Create HTML file from template
 */
async function createHtmlFile(content, topicInfo) {
  const template = await fs.readFile('blog/_template.html', 'utf8');

  const now = new Date();
  const dateISO = now.toISOString().split('T')[0];
  const dateFormatted = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const slug = `${dateISO}-${slugify(content.title)}`;
  const readTime = Math.ceil(content.content_html.split(/\s+/).length / 200);

  let html = template
    .replace(/{{TITLE}}/g, content.title)
    .replace(/{{EXCERPT}}/g, content.excerpt)
    .replace(/{{SLUG}}/g, slug)
    .replace(/{{DATE_ISO}}/g, dateISO)
    .replace(/{{DATE_FORMATTED}}/g, dateFormatted)
    .replace(/{{CATEGORY}}/g, topicInfo.tag)
    .replace(/{{KEYWORDS}}/g, content.keywords)
    .replace(/{{READ_TIME}}/g, readTime)
    .replace(/{{CONTENT}}/g, content.content_html);

  const filename = `${slug}.html`;
  const filepath = `blog/posts/${filename}`;

  await fs.writeFile(filepath, html, 'utf8');

  console.log(chalk.green(`✅ Created: ${filepath}\n`));

  // Save metadata for PR description
  await fs.mkdir('tmp', { recursive: true });
  await fs.writeFile('tmp/post-metadata.json', JSON.stringify({
    title: content.title,
    excerpt: content.excerpt,
    filename,
    slug,
    date: dateISO,
    topic: topicInfo.topic,
    tag: topicInfo.tag,
    readTime,
    imageIdea: content.image_idea
  }, null, 2));

  return { filename, slug, dateISO, readTime };
}

/**
 * Update blog index with new post
 */
async function updateBlogIndex(postMeta, content, topicInfo) {
  const indexPath = 'blog/index.html';
  let indexHtml = await fs.readFile(indexPath, 'utf8');

  // Find the posts array in the script
  const postsArrayMatch = indexHtml.match(/const posts = \[([\s\S]*?)\];/);

  const newPost = {
    title: content.title,
    excerpt: content.excerpt,
    slug: postMeta.slug,
    date: postMeta.dateISO,
    dateFormatted: new Date(postMeta.dateISO).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    category: topicInfo.tag.toLowerCase(),
    categoryLabel: topicInfo.tag,
    readTime: postMeta.readTime
  };

  let postsArray = [];
  if (postsArrayMatch && postsArrayMatch[1].trim()) {
    try {
      postsArray = JSON.parse(`[${postsArrayMatch[1]}]`);
    } catch {
      postsArray = [];
    }
  }

  // Add new post to beginning
  postsArray.unshift(newPost);

  // Replace posts array in HTML
  const newPostsCode = `const posts = ${JSON.stringify(postsArray, null, 2)};`;
  indexHtml = indexHtml.replace(/const posts = \[[\s\S]*?\];/, newPostsCode);

  await fs.writeFile(indexPath, indexHtml, 'utf8');

  console.log(chalk.green('✅ Updated blog/index.html\n'));
}

/**
 * Main execution
 */
async function main() {
  console.log(chalk.bold.cyan('\n🌙 SleepMedic Blog Post Generator\n'));
  console.log(chalk.gray('═'.repeat(50) + '\n'));

  try {
    // 1. Select topic
    const topicInfo = await selectTopic();

    // 2. Load guidelines
    const guidelines = await loadGuidelines();

    // 3. Generate content
    const content = await generateContent(topicInfo, guidelines);

    // 4. Create HTML file
    const postMeta = await createHtmlFile(content, topicInfo);

    // 5. Update blog index
    await updateBlogIndex(postMeta, content, topicInfo);

    console.log(chalk.gray('═'.repeat(50)));
    console.log(chalk.bold.green('\n✨ Blog post generated successfully!\n'));
    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.gray('  1. Run: npm run blog:rss'));
    console.log(chalk.gray('  2. Review: blog/posts/' + postMeta.filename));
    console.log(chalk.gray('  3. Commit and push\n'));

  } catch (error) {
    console.error(chalk.red('\n❌ Generation failed:', error.message));
    process.exit(1);
  }
}

main();
