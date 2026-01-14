#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function checkBlogHealth() {
  const postsDir = path.join(__dirname, '..', 'blog', 'posts');
  const posts = fs.readdirSync(postsDir)
    .filter(f => f.endsWith('.html'))
    .sort()
    .reverse();

  const now = new Date();
  const latestPost = posts[0];

  if (!latestPost) {
    console.error('❌ No blog posts found!');
    process.exit(1);
  }

  // Extract date from filename (YYYY-MM-DD format)
  const dateMatch = latestPost.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) {
    console.error('❌ Cannot parse date from latest post:', latestPost);
    process.exit(1);
  }

  const postDate = new Date(dateMatch[1], dateMatch[2] - 1, dateMatch[3]);
  const daysSinceLastPost = Math.floor((now - postDate) / (1000 * 60 * 60 * 24));

  console.log('📊 Blog Health Report');
  console.log('====================');
  console.log(`Total posts: ${posts.length}`);
  console.log(`Latest post: ${latestPost}`);
  console.log(`Days since last post: ${daysSinceLastPost}`);

  // Check for duplicate images in recent posts
  const recentPosts = posts.slice(0, 5);
  console.log('\n📸 Checking for duplicate images in recent posts...');

  for (const postFile of recentPosts) {
    const postPath = path.join(postsDir, postFile);
    const content = fs.readFileSync(postPath, 'utf8');

    // Count occurrences of cover images
    const imgMatches = content.match(/<img[^>]+src="images\/[^"]+cover[^"]*"/g) || [];
    if (imgMatches.length > 1) {
      console.warn(`⚠️  ${postFile} has ${imgMatches.length} cover images (should have 1)`);
    }
  }

  // Health status
  console.log('\n📋 Status Summary:');

  if (daysSinceLastPost > 10) {
    console.error(`❌ CRITICAL: No posts in ${daysSinceLastPost} days! Blog automation may be broken.`);
    process.exit(1);
  } else if (daysSinceLastPost > 7) {
    console.warn(`⚠️  WARNING: No posts in ${daysSinceLastPost} days. Check if weekly automation is working.`);
  } else {
    console.log(`✅ Blog is healthy. Last post was ${daysSinceLastPost} days ago.`);
  }

  // Show posting frequency
  console.log('\n📅 Recent Posting Activity:');
  const last10Posts = posts.slice(0, 10);
  for (const post of last10Posts) {
    const dateMatch = post.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
      console.log(`  - ${dateMatch[0]}: ${post.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.html', '')}`)
    }
  }

  // Check for upcoming scheduled posts
  console.log('\n⏰ Next scheduled post: Every Monday at 9:00 AM MT');

  const today = now.getDay();
  const daysUntilMonday = today === 0 ? 1 : (8 - today) % 7;
  console.log(`  Days until next auto-post: ${daysUntilMonday}`);

  return daysSinceLastPost <= 10 ? 0 : 1;
}

// Run health check
const exitCode = checkBlogHealth();
process.exit(exitCode);