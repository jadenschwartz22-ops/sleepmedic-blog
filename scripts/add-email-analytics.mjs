#!/usr/bin/env node

/**
 * Add email signup and analytics to blog
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ConvertKit form HTML (replace FORM_ID with your actual form ID)
const emailSignupHTML = `
<!-- Email Signup Form -->
<div id="newsletter-form" style="margin-top: 20px;">
  <script async data-uid="YOUR_CONVERTKIT_FORM_ID" src="https://sleepmedic.ck.page/YOUR_FORM_ID/index.js"></script>
</div>

<!-- Alternate: Simple email collection -->
<div id="simple-newsletter" style="display: none;">
  <form action="https://formspree.io/f/YOUR_FORM_ID" method="POST" style="display: flex; gap: 12px; max-width: 400px; margin: 20px auto;">
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

// Google Analytics GA4 code (replace with your measurement ID)
const analyticsHTML = `
<!-- Google Analytics GA4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-YOUR_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-YOUR_MEASUREMENT_ID');

  // Track blog post views
  if (window.location.pathname.includes('/posts/')) {
    gtag('event', 'page_view', {
      page_title: document.title,
      page_location: window.location.href,
      page_path: window.location.pathname,
      content_group: 'blog_post'
    });
  }
</script>

<!-- Simple Privacy-Friendly Analytics Alternative -->
<script defer data-domain="sleepmedic.co" src="https://plausible.io/js/script.js"></script>`;

// Update index.html
function updateIndexHTML() {
  const indexPath = path.join(__dirname, '..', 'blog', 'index.html');
  let content = fs.readFileSync(indexPath, 'utf8');

  // Add analytics to head
  if (!content.includes('gtag') && !content.includes('plausible')) {
    content = content.replace('</head>', `${analyticsHTML}\n</head>`);
  }

  // Replace placeholder newsletter form
  content = content.replace(
    '<p style="color: var(--text-bright); font-size: 0.9rem; opacity: 0.95;">Newsletter signup coming soon!</p>',
    emailSignupHTML
  );

  fs.writeFileSync(indexPath, content);
  console.log('✅ Updated index.html with email and analytics');
}

// Update template for future posts
function updateTemplate() {
  const templatePath = path.join(__dirname, '..', 'blog', '_template.html');
  let content = fs.readFileSync(templatePath, 'utf8');

  // Add analytics to template
  if (!content.includes('gtag') && !content.includes('plausible')) {
    content = content.replace('</head>', `${analyticsHTML}\n</head>`);
  }

  // Add email signup to footer of posts
  const emailFooter = `
  <div style="margin-top: 60px; padding: 32px; background: linear-gradient(135deg, rgba(167, 139, 250, 0.1), rgba(96, 165, 250, 0.08));
              border-radius: 16px; border: 1px solid rgba(167, 139, 250, 0.2); text-align: center;">
    <h3 style="color: var(--text-bright); margin-bottom: 12px;">Get Weekly Sleep Science</h3>
    <p style="color: var(--text); margin-bottom: 20px; opacity: 0.9;">
      Evidence-based tips for shift workers delivered to your inbox.
    </p>
    ${emailSignupHTML}
  </div>`;

  // Add before closing article tag
  if (!content.includes('Get Weekly Sleep Science')) {
    content = content.replace('</article>', `${emailFooter}\n</article>`);
  }

  fs.writeFileSync(templatePath, content);
  console.log('✅ Updated template with email and analytics');
}

// Create a simple tracking script
function createTrackingScript() {
  const trackingScript = `
/**
 * Simple Blog Analytics
 * Tracks page views, read time, and engagement
 */

class BlogAnalytics {
  constructor() {
    this.startTime = Date.now();
    this.scrollDepth = 0;
    this.isEngaged = false;

    this.init();
  }

  init() {
    // Track page view
    this.trackPageView();

    // Track scroll depth
    window.addEventListener('scroll', this.throttle(() => {
      this.trackScrollDepth();
    }, 1000));

    // Track read time
    window.addEventListener('beforeunload', () => {
      this.trackReadTime();
    });

    // Track link clicks
    document.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', (e) => {
        this.trackLinkClick(e.currentTarget.href);
      });
    });
  }

  trackPageView() {
    const data = {
      event: 'blog_view',
      page: window.location.pathname,
      title: document.title,
      timestamp: new Date().toISOString()
    };

    // Send to analytics
    if (typeof gtag !== 'undefined') {
      gtag('event', 'page_view', data);
    }

    // Or send to your own endpoint
    this.sendAnalytics(data);
  }

  trackScrollDepth() {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = window.scrollY;

    const currentDepth = Math.round((scrollTop + windowHeight) / documentHeight * 100);

    if (currentDepth > this.scrollDepth) {
      this.scrollDepth = currentDepth;

      // Track milestones
      if ([25, 50, 75, 90, 100].includes(currentDepth)) {
        this.sendAnalytics({
          event: 'scroll_depth',
          depth: currentDepth,
          page: window.location.pathname
        });
      }
    }
  }

  trackReadTime() {
    const timeSpent = Math.round((Date.now() - this.startTime) / 1000);

    if (timeSpent > 10) { // Only track if more than 10 seconds
      this.sendAnalytics({
        event: 'read_time',
        seconds: timeSpent,
        scrollDepth: this.scrollDepth,
        page: window.location.pathname
      });
    }
  }

  trackLinkClick(url) {
    this.sendAnalytics({
      event: 'link_click',
      url: url,
      page: window.location.pathname
    });
  }

  throttle(func, delay) {
    let timeout;
    let lastRun = 0;

    return function() {
      const now = Date.now();

      if (now - lastRun >= delay) {
        func.apply(this, arguments);
        lastRun = now;
      } else {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          func.apply(this, arguments);
          lastRun = Date.now();
        }, delay - (now - lastRun));
      }
    };
  }

  sendAnalytics(data) {
    // Send to your analytics endpoint
    if (window.location.hostname !== 'localhost') {
      fetch('https://your-analytics-endpoint.com/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          site: 'sleepmedic',
          referrer: document.referrer,
          userAgent: navigator.userAgent
        })
      }).catch(() => {}); // Fail silently
    }

    // Log to console in dev
    if (window.location.hostname === 'localhost') {
      console.log('Analytics:', data);
    }
  }
}

// Initialize analytics
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new BlogAnalytics());
} else {
  new BlogAnalytics();
}`;

  const scriptPath = path.join(__dirname, '..', 'blog', 'analytics.js');
  fs.writeFileSync(scriptPath, trackingScript);
  console.log('✅ Created analytics.js tracking script');
}

// Instructions for setup
function printInstructions() {
  console.log(`
📧 EMAIL SIGNUP SETUP:
1. Sign up for ConvertKit (free): https://convertkit.com
2. Create a form and get your form ID
3. Replace YOUR_CONVERTKIT_FORM_ID in the code

   OR

1. Sign up for Formspree (free): https://formspree.io
2. Create a form and get your form ID
3. Replace YOUR_FORM_ID in the code

📊 ANALYTICS SETUP:
1. Go to Google Analytics: https://analytics.google.com
2. Create a new GA4 property for sleepmedic.co
3. Get your Measurement ID (starts with G-)
4. Replace G-YOUR_MEASUREMENT_ID in the code

   OR (Privacy-friendly alternative)

1. Sign up for Plausible: https://plausible.io
2. Add sleepmedic.co as a site
3. The script is already configured

📈 WHAT YOU'LL TRACK:
- Page views and unique visitors
- Which posts are most popular
- How long people read
- Scroll depth (engagement)
- Email signups
- Traffic sources

To implement:
1. Update the IDs in this script
2. Run: node scripts/add-email-analytics.mjs
3. Commit and push changes
`);
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 Adding email signup and analytics to blog...\n');

  updateIndexHTML();
  updateTemplate();
  createTrackingScript();

  console.log('\n');
  printInstructions();
}