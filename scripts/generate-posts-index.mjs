import fs from 'fs/promises';
import path from 'path';

async function extractPostMetadata(filepath) {
  const html = await fs.readFile(filepath, 'utf8');

  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/);
  const excerptMatch = html.match(/<meta name="description" content="(.*?)"/);
  const dateMatch = html.match(/<time datetime="(.*?)">(.*?)<\/time>/);
  const categoryMatch = html.match(/<span class="post-category-badge">(.*?)<\/span>/);
  const readTimeMatch = html.match(/(\d+) min read/);
  const filenameMatch = filepath.match(/(\d{4}-\d{2}-\d{2}-.+)\.html$/);
  const coverImageMatch = html.match(/<img src="images\/(.*?-cover\.jpg)"/);

  if (!titleMatch || !filenameMatch) return null;

  const slug = filenameMatch[1];
  const date = dateMatch ? dateMatch[1] : slug.substring(0, 10);
  const dateFormatted = dateMatch ? dateMatch[2] : new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const categoryMap = {
    'Science': 'science',
    'Tools': 'tools',
    'Tools & Tips': 'tools',
    'Timing': 'timing',
    'Sleep Timing': 'timing',
    'Special': 'special',
    'Special Topics': 'special',
    'Trending': 'trending',
    'Shift Work': 'special',
    'Life Stages': 'special',
    'Troubleshooting': 'tools'
  };

  const categoryLabel = categoryMatch ? categoryMatch[1] : 'Science';
  const category = categoryMap[categoryLabel] || 'science';

  return {
    title: titleMatch[1],
    slug,
    excerpt: excerptMatch ? excerptMatch[1] : '',
    date,
    dateFormatted,
    readTime: readTimeMatch ? parseInt(readTimeMatch[1]) : 3,
    category,
    categoryLabel,
    coverImage: coverImageMatch ? `posts/images/${coverImageMatch[1]}` : null
  };
}

async function generatePostsIndex() {
  const postsDir = 'blog/posts';
  const indexPath = 'blog/posts-index.json';

  // Load existing index to preserve hand-edited fields (pillar, audience, etc.)
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch { /* fresh start */ }
  // Build a lookup by slug for fast field preservation
  const existingBySlug = Object.fromEntries(existing.map(p => [p.slug, p]));

  const files = await fs.readdir(postsDir);
  const htmlFiles = files.filter(f => f.endsWith('.html'));

  const posts = [];
  for (const file of htmlFiles) {
    const filepath = path.join(postsDir, file);
    const metadata = await extractPostMetadata(filepath);
    if (metadata) {
      const prev = existingBySlug[metadata.slug] || {};
      // Preserve pillar and audience if they were set
      if (prev.pillar) metadata.pillar = prev.pillar;
      if (prev.audience) metadata.audience = prev.audience;
      posts.push(metadata);
    }
  }

  // Preserve entries that have no HTML file (e.g. the pillar post placeholder)
  for (const entry of existing) {
    if (!posts.find(p => p.slug === entry.slug)) {
      posts.push(entry);
    }
  }

  posts.sort((a, b) => new Date(b.date) - new Date(a.date));

  await fs.writeFile(indexPath, JSON.stringify(posts, null, 2));

  console.log(`Generated posts index with ${posts.length} posts`);
  console.log(`   Saved to: ${indexPath}`);
}

generatePostsIndex().catch(console.error);
