#!/usr/bin/env node

/**
 * Manual Auto-Publish Script
 *
 * Finds cover image selection issues older than 24 hours and auto-publishes them
 * with a randomly selected image.
 *
 * Usage: node scripts/manual-auto-publish.mjs
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function findOldIssues() {
  console.log('🔍 Finding open cover image selection issues...');

  const { stdout } = await execAsync(
    'gh issue list --label "select-cover-image" --state open --json number,title,createdAt'
  );

  const issues = JSON.parse(stdout);
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

  const oldIssues = issues.filter(issue => {
    return new Date(issue.createdAt).getTime() < oneDayAgo;
  });

  console.log(`Found ${oldIssues.length} issue(s) older than 24 hours`);
  return oldIssues;
}

async function getIssueBody(issueNumber) {
  const { stdout } = await execAsync(`gh issue view ${issueNumber} --json body`);
  return JSON.parse(stdout).body;
}

async function getPRInfo(issueBody) {
  const prMatch = issueBody.match(/PR #(\d+)/);
  if (!prMatch) throw new Error('Could not find PR number in issue');

  const prNumber = prMatch[1];
  const { stdout } = await execAsync(
    `gh pr view ${prNumber} --json headRefName,url`
  );
  return { prNumber, ...JSON.parse(stdout) };
}

async function autoPublishIssue(issueNumber) {
  console.log(`\n📝 Processing issue #${issueNumber}...`);

  // Get issue body
  const issueBody = await getIssueBody(issueNumber);

  // Get PR info
  const { prNumber, headRefName, url: prUrl } = await getPRInfo(issueBody);
  console.log(`Found PR #${prNumber}: ${headRefName}`);

  // Random image selection (1-5)
  const imageNum = Math.floor(Math.random() * 5) + 1;
  console.log(`🎲 Randomly selected image #${imageNum}`);

  // Extract image URL from issue body
  const imageRegex = new RegExp(`Image ${imageNum}:[\\s\\S]*?\\[Download: (https://[^\\]]+)\\]`, 'i');
  const imageMatch = issueBody.match(imageRegex);
  if (!imageMatch) throw new Error(`Could not find image #${imageNum} URL`);

  const imageUrl = imageMatch[1];
  console.log(`📥 Downloading: ${imageUrl}`);

  // Extract post filename from edit link
  const postFileMatch = issueBody.match(/Edit Post Text.*?\/([^/]+\.html)/);
  if (!postFileMatch) throw new Error('Could not find post filename');
  const postFile = `blog/posts/${postFileMatch[1]}`;

  // Extract photographer and Unsplash URL
  const photographerRegex = new RegExp(`Image ${imageNum}:[\\s\\S]*?by \\[([^\\]]+)\\]`, 'i');
  const unsplashRegex = new RegExp(`Image ${imageNum}:[\\s\\S]*?\\[Unsplash\\]\\((https://unsplash\\.com/photos/[^)]+)\\)`, 'i');

  const photographerMatch = issueBody.match(photographerRegex);
  const unsplashMatch = issueBody.match(unsplashRegex);

  if (!photographerMatch || !unsplashMatch) {
    throw new Error('Could not find photographer or Unsplash URL');
  }

  const photographer = photographerMatch[1].trim();
  const unsplashUrl = unsplashMatch[1];

  // Checkout PR branch
  console.log(`📦 Checking out branch: ${headRefName}`);
  await execAsync(`git fetch origin ${headRefName}`);
  await execAsync(`git checkout ${headRefName}`);

  // Download image
  console.log('📥 Downloading cover image...');
  await execAsync(`curl -L "${imageUrl}" -o blog/cover-temp.jpg`);

  // Add image to post
  const postSlug = postFile.replace('blog/posts/', '').replace('.html', '');
  const finalImagePath = `blog/posts/images/${postSlug}-cover.jpg`;

  await execAsync(`mv blog/cover-temp.jpg "${finalImagePath}"`);

  console.log('✏️  Adding cover image to post...');
  const imageHtml = `
      <div style="margin-bottom: 40px;">
        <img src="images/${postSlug}-cover.jpg" alt="Cover image" style="width: 100%; max-height: 400px; object-fit: cover; border-radius: 24px;">
        <p style="text-align: center; font-size: 0.85rem; color: var(--muted); margin-top: 8px;">Photo by <a href="${unsplashUrl}" style="color: var(--periwinkle);">${photographer}</a> on Unsplash</p>
      </div>`;

  // Read post file, insert image after header
  const { stdout: postContent } = await execAsync(`cat "${postFile}"`);
  const updatedContent = postContent.replace(
    '<div class="post-content">',
    imageHtml + '\n      <div class="post-content">'
  );

  // Write updated post
  await execAsync(`cat > "${postFile}" << 'EOF'\n${updatedContent}\nEOF`);

  // Commit and push
  console.log('💾 Committing changes...');
  await execAsync('git config user.name "github-actions[bot]"');
  await execAsync('git config user.email "github-actions[bot]@users.noreply.github.com"');
  await execAsync('git add .');
  await execAsync(`git commit -m "Auto-publish: Add random cover image #${imageNum} (manual trigger)"`);
  await execAsync('git push');

  // Merge PR
  console.log('🔀 Merging PR...');
  await execAsync(`gh pr merge ${prNumber} --squash --auto`);

  // Close issue
  console.log('✅ Closing issue...');
  await execAsync(`gh issue close ${issueNumber} --comment "⏰ **Auto-Published (Manual Trigger)**\n\nNo image selection received within 24 hours.\n\nRandomly selected image #${imageNum} and published your blog post! 🎉"`);

  console.log(`\n✨ Successfully auto-published issue #${issueNumber}!`);
  console.log(`📝 PR: ${prUrl}`);
}

async function main() {
  try {
    const oldIssues = await findOldIssues();

    if (oldIssues.length === 0) {
      console.log('✅ No issues to auto-publish');
      return;
    }

    // Process first old issue
    const issue = oldIssues[0];
    console.log(`\n🎯 Auto-publishing: ${issue.title}`);

    await autoPublishIssue(issue.number);

    console.log('\n✅ Done!');

    if (oldIssues.length > 1) {
      console.log(`\n💡 ${oldIssues.length - 1} more issue(s) remaining. Run again to process them.`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
