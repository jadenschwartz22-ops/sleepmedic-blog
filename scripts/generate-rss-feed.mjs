/**
 * Generate RSS Feed for SleepMedic Blog
 * Used by Pi + Resend for email notifications
 */

import fs from 'fs/promises';
import chalk from 'chalk';

/**
 * Load posts from posts-index.json (source of truth)
 */
async function extractPosts() {
  try {
    return JSON.parse(await fs.readFile('blog/posts-index.json', 'utf8'));
  } catch {
    console.log(chalk.yellow('No posts-index.json found'));
    return [];
  }
}

/**
 * Generate RSS feed XML
 */
function generateRssFeed(posts) {
  const now = new Date().toUTCString();
  const baseUrl = 'https://sleepmedic.co/blog';

  const items = posts.slice(0, 20).map(post => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${baseUrl}/posts/${post.slug}.html</link>
      <guid isPermaLink="true">${baseUrl}/posts/${post.slug}.html</guid>
      <description>${escapeXml(post.excerpt)}</description>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <category>${escapeXml(post.categoryLabel)}</category>
    </item>
  `).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>SleepMedic Blog</title>
    <link>${baseUrl}/</link>
    <description>Evidence-based sleep science for shift workers, first responders, and busy humans. Weekly posts on circadian health, recovery, and rest.</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>https://sleepmedic.co/logo-256.png</url>
      <title>SleepMedic</title>
      <link>${baseUrl}/</link>
    </image>
${items}
  </channel>
</rss>`;
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Main execution
 */
async function main() {
  console.log(chalk.bold.cyan('\nRSS Feed Generator\n'));

  try {
    // Extract posts
    const posts = await extractPosts();

    if (posts.length === 0) {
      console.log(chalk.yellow('No posts to include in feed'));
      return;
    }

    console.log(chalk.gray(`Found ${posts.length} post(s)\n`));

    // Generate RSS XML
    const rssXml = generateRssFeed(posts);

    // Write to file
    await fs.writeFile('blog/feed.xml', rssXml, 'utf8');

    console.log(chalk.green('RSS feed generated: blog/feed.xml'));
    console.log(chalk.gray(`   Posts included: ${Math.min(posts.length, 20)}`));
    console.log(chalk.gray(`   Feed URL: https://sleepmedic.co/blog/feed.xml\n`));

  } catch (error) {
    console.error(chalk.red('RSS generation failed:', error.message));
    process.exit(1);
  }
}

main();
