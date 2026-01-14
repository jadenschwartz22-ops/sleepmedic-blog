#!/usr/bin/env node

/**
 * Setup Email Signup & Analytics for SleepMedic Blog
 * Run this to configure email collection and visitor tracking
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function setupEmailSignup() {
  console.log('\n📧 EMAIL SIGNUP CONFIGURATION');
  console.log('================================\n');

  console.log('Choose your email service:');
  console.log('1. Formspree (Simple, free tier available)');
  console.log('2. ConvertKit (More features, free up to 1000 subscribers)');
  console.log('3. Skip email setup for now\n');

  const choice = await question('Enter your choice (1-3): ');

  let emailHTML = '';

  if (choice === '1') {
    console.log('\n📝 Setting up Formspree...');
    console.log('1. Go to https://formspree.io');
    console.log('2. Sign up for free account');
    console.log('3. Create a new form');
    console.log('4. Copy your form ID (looks like: xyzabc123)\n');

    const formId = await question('Enter your Formspree form ID: ');

    emailHTML = `
<!-- Email Signup Form (Formspree) -->
<div id="newsletter-form" style="margin-top: 20px;">
  <form action="https://formspree.io/f/${formId}" method="POST" style="display: flex; gap: 12px; max-width: 400px; margin: 20px auto;">
    <input type="email" name="email" placeholder="Enter your email" required
           style="flex: 1; padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(167, 139, 250, 0.3);
                  background: rgba(15, 23, 42, 0.8); color: white; font-size: 0.95rem;">
    <button type="submit"
            style="padding: 12px 24px; border-radius: 8px; background: linear-gradient(135deg, var(--periwinkle), var(--cyan));
                   border: none; color: white; font-weight: 600; cursor: pointer; transition: transform 0.2s;">
      Subscribe
    </button>
  </form>
</div>`;

  } else if (choice === '2') {
    console.log('\n📝 Setting up ConvertKit...');
    console.log('1. Go to https://convertkit.com');
    console.log('2. Sign up for free account');
    console.log('3. Create a form');
    console.log('4. Get your form UID from the embed code\n');

    const formUid = await question('Enter your ConvertKit form UID: ');

    emailHTML = `
<!-- Email Signup Form (ConvertKit) -->
<div id="newsletter-form" style="margin-top: 20px;">
  <script async data-uid="${formUid}" src="https://sleepmedic.ck.page/${formUid}/index.js"></script>
</div>`;
  }

  return emailHTML;
}

async function setupAnalytics() {
  console.log('\n📊 ANALYTICS CONFIGURATION');
  console.log('================================\n');

  console.log('Choose your analytics service:');
  console.log('1. Google Analytics GA4 (Free, comprehensive)');
  console.log('2. Plausible (Privacy-friendly, paid)');
  console.log('3. Both');
  console.log('4. Skip analytics setup for now\n');

  const choice = await question('Enter your choice (1-4): ');

  let analyticsHTML = '';

  if (choice === '1' || choice === '3') {
    console.log('\n📝 Setting up Google Analytics...');
    console.log('1. Go to https://analytics.google.com');
    console.log('2. Create a new GA4 property');
    console.log('3. Get your Measurement ID (starts with G-)\n');

    const measurementId = await question('Enter your GA4 Measurement ID (G-XXXXXXXXX): ');

    analyticsHTML += `
<!-- Google Analytics GA4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${measurementId}');

  // Track blog post views
  if (window.location.pathname.includes('/posts/')) {
    gtag('event', 'page_view', {
      page_title: document.title,
      page_location: window.location.href,
      page_path: window.location.pathname,
      content_group: 'blog_post'
    });
  }
</script>`;
  }

  if (choice === '2' || choice === '3') {
    console.log('\n📝 Setting up Plausible...');
    console.log('1. Go to https://plausible.io');
    console.log('2. Sign up and add your site');
    console.log('3. Your domain should be: sleepmedic.co\n');

    const domain = await question('Enter your domain (default: sleepmedic.co): ') || 'sleepmedic.co';

    analyticsHTML += `
<!-- Plausible Analytics -->
<script defer data-domain="${domain}" src="https://plausible.io/js/script.js"></script>`;
  }

  return analyticsHTML;
}

async function updateFiles(emailHTML, analyticsHTML) {
  console.log('\n🔧 UPDATING FILES...');
  console.log('================================\n');

  // Update index.html
  const indexPath = path.join(__dirname, '..', 'blog', 'index.html');
  let indexContent = fs.readFileSync(indexPath, 'utf8');

  // Add analytics to head if provided
  if (analyticsHTML) {
    if (!indexContent.includes('gtag') && !indexContent.includes('plausible')) {
      indexContent = indexContent.replace('</head>', `${analyticsHTML}\n</head>`);
      console.log('✅ Added analytics to index.html');
    } else {
      console.log('⚠️  Analytics already present in index.html');
    }
  }

  // Replace newsletter placeholder if email HTML provided
  if (emailHTML) {
    const placeholderPattern = /<p style="color: var\(--text-bright\)[^>]*>Newsletter signup coming soon!<\/p>/;
    if (indexContent.match(placeholderPattern)) {
      indexContent = indexContent.replace(placeholderPattern, emailHTML);
      console.log('✅ Added email signup to index.html');
    } else {
      console.log('⚠️  Could not find newsletter placeholder in index.html');
    }
  }

  fs.writeFileSync(indexPath, indexContent);

  // Update template for future posts
  const templatePath = path.join(__dirname, '..', 'blog', '_template.html');
  if (fs.existsSync(templatePath)) {
    let templateContent = fs.readFileSync(templatePath, 'utf8');

    // Add analytics to template
    if (analyticsHTML && !templateContent.includes('gtag') && !templateContent.includes('plausible')) {
      templateContent = templateContent.replace('</head>', `${analyticsHTML}\n</head>`);
      console.log('✅ Added analytics to template');
    }

    // Add email signup footer to posts
    if (emailHTML && !templateContent.includes('Get Weekly Sleep Science')) {
      const emailFooter = `
  <div style="margin-top: 60px; padding: 32px; background: linear-gradient(135deg, rgba(167, 139, 250, 0.1), rgba(96, 165, 250, 0.08));
              border-radius: 16px; border: 1px solid rgba(167, 139, 250, 0.2); text-align: center;">
    <h3 style="color: var(--text-bright); margin-bottom: 12px;">Get Weekly Sleep Science</h3>
    <p style="color: var(--text); margin-bottom: 20px; opacity: 0.9;">
      Evidence-based tips for shift workers delivered to your inbox.
    </p>
    ${emailHTML}
  </div>`;

      templateContent = templateContent.replace('</article>', `${emailFooter}\n</article>`);
      console.log('✅ Added email signup to post template');
    }

    fs.writeFileSync(templatePath, templateContent);
  }

  // Also update existing posts if requested
  const updateExisting = await question('\nUpdate existing blog posts with analytics/email? (y/n): ');

  if (updateExisting.toLowerCase() === 'y') {
    const postsDir = path.join(__dirname, '..', 'blog', 'posts');
    const posts = fs.readdirSync(postsDir).filter(f => f.endsWith('.html'));

    for (const postFile of posts) {
      const postPath = path.join(postsDir, postFile);
      let postContent = fs.readFileSync(postPath, 'utf8');

      if (analyticsHTML && !postContent.includes('gtag') && !postContent.includes('plausible')) {
        postContent = postContent.replace('</head>', `${analyticsHTML}\n</head>`);
        fs.writeFileSync(postPath, postContent);
      }
    }

    console.log(`✅ Updated ${posts.length} existing posts`);
  }
}

async function main() {
  console.log('🌙 SleepMedic Blog - Email & Analytics Setup\n');

  try {
    const emailHTML = await setupEmailSignup();
    const analyticsHTML = await setupAnalytics();

    if (emailHTML || analyticsHTML) {
      await updateFiles(emailHTML, analyticsHTML);

      console.log('\n✨ SETUP COMPLETE!');
      console.log('================================\n');

      if (emailHTML) {
        console.log('✅ Email signup configured');
      }
      if (analyticsHTML) {
        console.log('✅ Analytics tracking configured');
      }

      console.log('\nNext steps:');
      console.log('1. Test email signup on your website');
      console.log('2. Verify analytics is tracking visits');
      console.log('3. Commit and push changes');
      console.log('\ngit add -A');
      console.log('git commit -m "feat: add email signup and analytics"');
      console.log('git push');
    } else {
      console.log('\n⚠️  No changes made. Run again when ready to configure.');
    }
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
  } finally {
    rl.close();
  }
}

main();