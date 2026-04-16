# /private/

Internal data and views. Not linked from the public site. Disallowed in robots.txt. Do not link to anything in here from the blog, index, or any public page.

Contents:

- `ab-tags.json` — A/B classification of every blog post (energy, voice_intensity, vehicles, devices, etc.)
- `ab-analytics.json` — GA4 metrics joined to tags (created weekly by `ab-weekly-report.yml`)
- `ab-dashboard.html` — the internal dashboard page. Readers of the site never see voice labels. Noindex + disallowed.

If you add anything else to this directory, keep the same rules: no public links, robots.txt disallowed, noindex in the HTML.
