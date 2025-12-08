# SleepMedic Blog Setup Guide

Welcome to your automated sleep science blog system!

## ✅ What's Been Built

Your blog system includes:

- **Blog Homepage** - `blog/index.html` with category filtering
- **Post Template** - `blog/_template.html` with comments placeholder
- **Shared Styles** - `blog/_shared-styles.css` matching SleepMedic brand
- **GPT-4o-mini Generator** - `scripts/generate-blog-post.mjs` using OpenAI
- **RSS Feed Generator** - `scripts/generate-rss-feed.mjs` for Follow.it
- **Editorial System** - `scripts/editorial/` with 50+ sleep topics and proven style guidelines
- **GitHub Actions** - `.github/workflows/weekly-blog-draft.yml` for automation

## 🚀 Setup Steps

### 1. Install Dependencies

```bash
cd ~/Desktop/sleepmedic-blog
npm install
```

This installs:
- `openai` - GPT-4o-mini API
- `yaml` - Topic rotation parser
- `chalk` - Pretty terminal output

### 2. Configure GitHub Secrets

Go to your GitHub repo settings: `https://github.com/[YOUR-USERNAME]/sleepmedic-blog/settings/secrets/actions`

Add these secrets:

#### Required Secrets

**OPENAI_API_KEY**
- Get from: https://platform.openai.com/api-keys
- Cost: ~$0.02-0.05 per post (52 posts/year = $1-2.50/year)
- Model: gpt-4o-mini (proven for SleepMedic voice)

### 3. Enable GitHub Discussions (for Giscus comments)

1. Go to: `https://github.com/[YOUR-USERNAME]/sleepmedic-blog/settings`
2. Scroll to "Features"
3. Check ✅ "Discussions"
4. Click "Set up discussions"

### 4. Configure Giscus (Comments System)

1. Go to: https://giscus.app
2. Fill in:
   - **Repository:** `[YOUR-USERNAME]/sleepmedic-blog`
   - **Page ↔️ Discussions Mapping:** `pathname`
   - **Discussion Category:** Create "Blog Comments"
   - **Features:** Enable reactions
   - **Theme:** `dark`
3. Copy the script tag
4. Replace the `#giscus-comments` div in `blog/_template.html` with the Giscus script

### 5. Install Giscus GitHub App

1. Go to: https://github.com/apps/giscus
2. Click "Install"
3. Select "Only select repositories"
4. Choose `sleepmedic-blog`
5. Click "Install"

### 6. Set Up Follow.it (Email Subscriptions)

1. Go to: https://follow.it
2. Sign up (100% free, unlimited subscribers)
3. Click "Set up your feed"
4. Enter feed URL: `https://sleepmedic.co/blog/feed.xml`
5. Customize email design (SleepMedic colors)
6. Copy embed code
7. Replace `#newsletter-form` in `blog/index.html` with Follow.it code
8. Replace `#newsletter-form-inline` in `blog/_template.html` with Follow.it code

### 7. Test Locally (Optional)

Generate your first post manually:

```bash
cd ~/Desktop/sleepmedic-blog

# Set environment variable
export OPENAI_API_KEY="your_api_key_here"

# Run the full workflow
npm run blog:full
```

This will:
1. Generate a blog post with GPT-4o-mini
2. Create `blog/posts/YYYY-MM-DD-slug.html`
3. Update `blog/index.html`
4. Generate RSS feed

Open `blog/index.html` in your browser to preview.

## 📅 How It Works

### Weekly Automation

**Schedule:** Every Monday at 9:00 AM Mountain Time

**What Happens:**
1. GitHub Actions triggers
2. Selects topic from rotation (50+ topics, anti-repetition)
3. Determines template format (Story-First, Science-First, Myth-Busting, etc.)
4. Generates post with GPT-4o-mini
5. Creates HTML file from template
6. Updates blog index
7. Generates RSS feed
8. Creates pull request for your review
9. Assigns to you + creates GitHub issue notification

**Your Workflow:**
1. Receive GitHub notification (email + in-app)
2. Review PR within 7 days
3. Edit content directly in PR if needed
4. Approve and merge
5. GitHub Pages auto-deploys to `sleepmedic.co/blog`
6. Follow.it detects RSS update and emails subscribers (~30 min)

### Topic Rotation

Topics rotate through 4 buckets (50+ total topics):
1. **Why sleep matters (science)** - Mechanisms, memory, recovery, hormones
2. **How to sleep better / tools** - Habits, light, timing, exercise
3. **When/where to sleep** - Naps, environment, tracking, timing
4. **Special considerations** - Shift work, menopause, pregnancy, travel

See all topics in `scripts/editorial/topics.yaml`

### Template Formats

Format rotates weekly (deterministic based on week number):
- **Story-First** - Lived moment → mechanism → protocol
- **Science-First** - Cold stat → explain → apply
- **Myth-Busting** - 3-5 myths → evidence → what to do
- **Field Manual** - Problem → decision-tree → protocol
- **Q&A** - 5-7 questions → concise answers → checklist
- **History/Philosophy** - Vignette → modern physiology → practice

## 🔧 Manual Generation

### Generate On-Demand

```bash
cd ~/Desktop/sleepmedic-blog

# Full workflow
npm run blog:full

# Just generation
npm run blog:generate

# Just RSS update
npm run blog:rss
```

### Trigger via GitHub Actions

1. Go to: `https://github.com/[YOUR-USERNAME]/sleepmedic-blog/actions`
2. Select "Weekly SleepMedic Blog Draft"
3. Click "Run workflow"
4. Click "Run workflow" button

## 🎨 Customization

### Change Posting Frequency

Edit `.github/workflows/weekly-blog-draft.yml`:

```yaml
schedule:
  # Bi-weekly (every other Monday)
  - cron: "0 16 * * 1"  # Change to your preference

  # Daily (every day at 9am MT)
  - cron: "0 16 * * *"

  # Monthly (first Monday)
  - cron: "0 16 1-7 * 1"
```

### Add New Topics

Edit `scripts/editorial/topics.yaml`:

```yaml
buckets:
  - name: Your New Bucket
    tag: YourTag
    topics:
      - Topic 1
      - Topic 2
      - Topic 3
```

### Modify Voice/Tone

Edit `scripts/editorial/style_guidelines.md`

GPT-4o-mini uses these guidelines to generate content.

### Update Template Design

Edit `blog/_template.html` or `blog/_shared-styles.css`

Changes apply to all future posts.

## 🛠️ Troubleshooting

### "OPENAI_API_KEY is required"

**Fix:** Add the secret in GitHub repo settings

### "No posts found"

**Fix:** Run `npm run blog:generate` first to create your first post

### Giscus comments not showing

**Fix:**
1. Verify GitHub Discussions are enabled
2. Check that Giscus app is installed
3. Confirm script is in `blog/_template.html`
4. Make sure "Blog Comments" category exists

### Follow.it not sending emails

**Fix:**
1. Verify RSS feed URL in Follow.it: `https://sleepmedic.co/blog/feed.xml`
2. Wait 30-60 minutes after merge (Follow.it polls periodically)
3. Check spam folders
4. Verify Follow.it account is active

## 📁 File Structure

```
sleepmedic-blog/
├── blog/
│   ├── index.html                    # Blog homepage
│   ├── feed.xml                      # RSS feed (auto-generated)
│   ├── _template.html                # Post template
│   ├── _shared-styles.css            # Shared CSS
│   └── posts/
│       └── YYYY-MM-DD-slug.html      # Individual posts
├── scripts/
│   ├── generate-blog-post.mjs        # GPT-4o-mini generator
│   ├── generate-rss-feed.mjs         # RSS builder
│   └── editorial/
│       ├── topics.yaml               # 50+ topics
│       └── style_guidelines.md       # Voice/tone guide
├── .github/
│   └── workflows/
│       └── weekly-blog-draft.yml     # Automation
├── package.json                      # Dependencies
├── BLOG_SETUP.md                     # This file
└── README.md                         # Quick start
```

## 🚨 Safety Checklist

Before going live:

- [ ] GitHub secrets configured (`OPENAI_API_KEY`)
- [ ] GitHub Discussions enabled
- [ ] Giscus app installed
- [ ] Giscus script added to template
- [ ] Follow.it connected to RSS feed
- [ ] Newsletter forms embedded
- [ ] Test post generated successfully
- [ ] Blog index loads correctly
- [ ] Mobile responsive (test on phone)
- [ ] Domain configured (sleepmedic.co/blog)
- [ ] GitHub Pages enabled

## 📈 Monitoring

### Check Blog Traffic

If you add Google Analytics, track:
- Page views per post
- Category filtering usage
- Newsletter signup conversions

### Check Workflow Status

GitHub Actions: `https://github.com/[YOUR-USERNAME]/sleepmedic-blog/actions`

### Monitor Costs

OpenAI Dashboard: https://platform.openai.com/usage

GPT-4o-mini usage: ~$0.02-0.05 per post (negligible)

### Check Subscribers

Follow.it dashboard provides:
- Subscriber count
- Email open rates
- Click-through rates

### Check Comments

GitHub Discussions: `https://github.com/[YOUR-USERNAME]/sleepmedic-blog/discussions`

Category: "Blog Comments"

## 🎉 You're All Set!

Your blog will now auto-generate posts weekly and create PRs for your review.

**Next Steps:**

1. Complete setup steps above
2. Push repo to GitHub
3. Enable GitHub Pages
4. Configure domain (sleepmedic.co/blog)
5. Manually generate first post to test
6. Wait for first automated PR (or trigger manually)
7. Review and merge
8. Watch your blog grow!

## 💰 Cost Comparison

| Item | Old (Ghost) | New (GitHub) |
|------|-------------|--------------|
| Hosting | $11-25/mo | $0/mo (GitHub Pages) |
| Automation | Manual | $0/mo (GitHub Actions) |
| AI Generation | N/A | ~$0.10/mo (GPT-4o-mini) |
| Email | Add-on fee | $0/mo (Follow.it) |
| Comments | Add-on fee | $0/mo (Giscus) |
| **Total/year** | **$132-300** | **~$1-2** |

**Annual Savings:** $130-298/year

## 📞 Need Help?

If you run into issues:

1. Check this guide first
2. Review GitHub Actions logs
3. Test locally with manual commands
4. Check OpenAI API status
5. Verify all secrets are set correctly

Happy blogging! 🌙
