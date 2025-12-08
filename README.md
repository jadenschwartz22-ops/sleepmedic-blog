# SleepMedic Blog

> Evidence-based sleep science for shift workers, first responders, and busy humans.

Automated blog system powered by GPT-4o-mini, GitHub Actions, and proven editorial guidelines.

## 🌙 Features

- **Weekly Auto-Generation** - GPT-4o-mini creates posts every Monday
- **50+ Topics** - Rotating sleep science topics across 4 categories
- **Email Subscriptions** - Free unlimited subscribers via Follow.it
- **Comments** - GitHub Discussions via Giscus
- **RSS Feed** - Auto-generated and validated
- **Mobile-First Design** - Fast, responsive, accessible
- **Full Version Control** - Never lose content

## 🚀 Quick Start

### 1. Install

```bash
npm install
```

### 2. Set Environment Variable

```bash
export OPENAI_API_KEY="your_api_key_here"
```

### 3. Generate First Post

```bash
npm run blog:full
```

### 4. Preview

Open `blog/index.html` in your browser.

## 📝 Usage

### Manual Generation

```bash
# Full workflow (generate + RSS)
npm run blog:full

# Just generate post
npm run blog:generate

# Just update RSS
npm run blog:rss
```

### Automated Weekly

GitHub Actions runs every Monday at 9am MT:
1. Generates post
2. Creates PR for review
3. Notifies you via GitHub issue
4. Merge to publish

## 📁 Structure

```
blog/              # Published blog
  ├── index.html   # Homepage
  ├── feed.xml     # RSS feed
  └── posts/       # Individual posts
scripts/           # Generation scripts
  └── editorial/   # Topics & guidelines
.github/           # Automation workflows
```

## 🛠️ Configuration

See [BLOG_SETUP.md](BLOG_SETUP.md) for complete setup instructions.

## 🎨 Customization

- **Topics:** Edit `scripts/editorial/topics.yaml`
- **Voice:** Edit `scripts/editorial/style_guidelines.md`
- **Design:** Edit `blog/_template.html` and `blog/_shared-styles.css`
- **Schedule:** Edit `.github/workflows/weekly-blog-draft.yml`

## 💰 Costs

- **GitHub Pages:** Free
- **GitHub Actions:** Free (2,000 min/month)
- **GPT-4o-mini:** ~$0.02-0.05/post (~$1-2/year)
- **Follow.it:** Free (unlimited subscribers)
- **Giscus:** Free (open source)

**Total: ~$1-2/year** (vs. Ghost at $132-300/year)

## 📊 Stats

- 50+ rotating topics
- 6 template formats
- Evidence-based with citations
- 700-1,000 words per post
- Anti-repetition logic
- SEO optimized

## 🔗 Links

- **Live Blog:** https://sleepmedic.co/blog (after deployment)
- **RSS Feed:** https://sleepmedic.co/blog/feed.xml
- **Setup Guide:** [BLOG_SETUP.md](BLOG_SETUP.md)

## 📄 License

MIT

## 👨‍💻 Author

Built by Jaden Schwartz for SleepMedic.

---

**Built with:**
- GPT-4o-mini (OpenAI)
- GitHub Actions
- GitHub Pages
- Follow.it (email)
- Giscus (comments)
