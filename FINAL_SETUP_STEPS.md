# 🚀 SleepMedic Blog - Final Setup Steps

Your blog is **95% complete**! Here are the remaining steps to go live.

## ✅ What's Done

- ✅ Full blog repository created
- ✅ Blog homepage with filtering
- ✅ Post template with comments placeholder
- ✅ GPT-4o-mini generator with 50+ topics
- ✅ RSS feed generator
- ✅ GitHub repository created: https://github.com/jadenschwartz22-ops/sleepmedic-blog
- ✅ Code pushed to GitHub
- ✅ All documentation written

## 📋 Remaining Steps (15 minutes)

### Step 1: Add Workflow File (2 min)

The GitHub CLI doesn't have workflow permission. Add it manually:

1. Go to: https://github.com/jadenschwartz22-ops/sleepmedic-blog
2. Click "Add file" → "Create new file"
3. File name: `.github/workflows/weekly-blog-draft.yml`
4. Copy content from: `/Users/jadenschwartz/Desktop/sleepmedic-blog/.github/workflows/weekly-blog-draft.yml`
5. Commit directly to main

**OR** use the web interface:
```bash
# The file is already in your local repo at:
cat ~/Desktop/sleepmedic-blog/.github/workflows/weekly-blog-draft.yml
```

### Step 2: Add GitHub Secret (1 min)

1. Go to: https://github.com/jadenschwartz22-ops/sleepmedic-blog/settings/secrets/actions
2. Click "New repository secret"
3. Name: `OPENAI_API_KEY`
4. Value: Your OpenAI API key (get from https://platform.openai.com/api-keys)
5. Click "Add secret"

### Step 3: Enable GitHub Pages (2 min)

1. Go to: https://github.com/jadenschwartz22-ops/sleepmedic-blog/settings/pages
2. Source: **Deploy from a branch**
3. Branch: **main**
4. Folder: **/ (root)**
5. Click "Save"
6. Wait 2-3 minutes for deployment

Your blog will be live at: `https://jadenschwartz22-ops.github.io/sleepmedic-blog/blog/`

### Step 4: Enable GitHub Discussions (1 min)

1. Go to: https://github.com/jadenschwartz22-ops/sleepmedic-blog/settings
2. Scroll to "Features"
3. Check ✅ "Discussions"
4. Click "Set up discussions"

### Step 5: Configure Giscus (3 min)

1. Install Giscus app: https://github.com/apps/giscus
2. Select "Only select repositories" → Choose `sleepmedic-blog`
3. Click "Install"
4. Go to: https://giscus.app
5. Fill in:
   - Repository: `jadenschwartz22-ops/sleepmedic-blog`
   - Mapping: `pathname`
   - Category: Create "Blog Comments"
   - Theme: `dark`
6. Copy the generated `<script>` tag
7. Replace the `#giscus-comments` div in `blog/_template.html` with the script
8. Commit and push

### Step 6: Set Up Follow.it Email (5 min)

1. Sign up: https://follow.it (free, unlimited subscribers)
2. Click "Set up your feed"
3. Add feed URL: `https://jadenschwartz22-ops.github.io/sleepmedic-blog/blog/feed.xml`
   - **Note:** Update this to `https://sleepmedic.co/blog/feed.xml` after domain setup
4. Customize email design (use SleepMedic colors: #16a085, #3498db)
5. Copy the embed code
6. Replace `#newsletter-form` in `blog/index.html` with Follow.it code
7. Replace `#newsletter-form-inline` in `blog/_template.html` with Follow.it code
8. Commit and push

### Step 7: Configure Custom Domain (Optional - 5 min)

If you want `sleepmedic.co/blog` instead of GitHub's default URL:

#### Option A: Subdomain (sleepmedic.co/blog) - RECOMMENDED

1. Add CNAME file in repo root:
   ```bash
   cd ~/Desktop/sleepmedic-blog
   echo "sleepmedic.co" > CNAME
   git add CNAME
   git commit -m "Add custom domain"
   git push
   ```

2. Add DNS record at your domain provider:
   ```
   Type: CNAME
   Name: blog
   Value: jadenschwartz22-ops.github.io
   TTL: 3600
   ```

3. Go to: https://github.com/jadenschwartz22-ops/sleepmedic-blog/settings/pages
4. Custom domain: `blog.sleepmedic.co`
5. Wait for DNS check (green checkmark)
6. ✅ Enforce HTTPS

**Note:** If you want the blog at the root path `/blog`, you'll need to:
- Set up a redirect from `sleepmedic.co/blog` → `blog.sleepmedic.co`
- OR use a custom server/Cloudflare Workers

#### Option B: Root Domain (sleepmedic.co)

1. Add A records at your DNS provider:
   ```
   Type: A
   Name: @
   Value: 185.199.108.153
   Value: 185.199.109.153
   Value: 185.199.110.153
   Value: 185.199.111.153
   ```

2. Follow same steps as Option A

### Step 8: Test Automation (2 min)

1. Go to: https://github.com/jadenschwartz22-ops/sleepmedic-blog/actions
2. Click "Weekly SleepMedic Blog Draft"
3. Click "Run workflow" → "Run workflow"
4. Wait 2-3 minutes
5. Check for new Pull Request
6. Review the generated post
7. Merge to publish!

## 🎉 You're Done!

After completing these steps:

- ✅ Weekly blog posts auto-generate every Monday 9am MT
- ✅ You get GitHub notifications for review
- ✅ Merge PR → Auto-deploys to live site
- ✅ Follow.it sends emails to subscribers (~30 min after merge)
- ✅ Comments work via Giscus
- ✅ RSS feed auto-updates

## 🔄 Your Weekly Workflow

1. **Monday morning**: Receive GitHub notification (PR + Issue)
2. **Review PR**: Read generated post, edit if needed
3. **Merge**: Click "Merge pull request"
4. **Done!**: Post goes live, emails sent automatically

**Time investment:** 5-10 minutes per week

## 💰 Final Cost Breakdown

| Item | Cost |
|------|------|
| GitHub Pages | Free |
| GitHub Actions | Free |
| GPT-4o-mini | ~$0.02-0.05/post |
| Follow.it | Free |
| Giscus | Free |
| **Total/year** | **~$1-2** |

**Savings vs. Ghost:** $130-298/year

## 📞 Support

If you need help:
- Read: `BLOG_SETUP.md` for detailed documentation
- Check: GitHub Actions logs for automation issues
- Test: `npm run blog:full` locally to debug generation

## 🎯 Next Steps

After your first post is live:
1. Share on social media
2. Monitor subscriber growth in Follow.it
3. Engage with comments in GitHub Discussions
4. Adjust topics/voice as needed
5. Consider adding Google Analytics

**Repo:** https://github.com/jadenschwartz22-ops/sleepmedic-blog
**Location:** ~/Desktop/sleepmedic-blog/

---

Built with ❤️ for SleepMedic by Claude Code
