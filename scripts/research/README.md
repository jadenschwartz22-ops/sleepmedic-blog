# Research corpus: expert transcripts

WS1 (docs/2026-08-22-north-star-free-value-engine.md) — a curated corpus of
expert sleep-podcast transcripts the content pipeline can cite by episode
and timestamp, instead of writing from model memory.

## How it works

1. `episodes.yaml` — curated, hand-verified list of episodes (Matt Walker's
   own podcast, his Huberman Lab guest series, Kirk Parsley on first
   responders, Peter Attia/Matt Walker episodes). Every entry's URL was
   checked real before being added (title/date cross-referenced against the
   publisher's own page, not invented).
2. `fetch-transcripts.mjs` — for each entry, downloads YouTube auto-captions
   via `yt-dlp`, cleans and merges the rolling caption fragments into
   readable paragraphs, and writes:
   - `research/transcripts/<id>.txt` — the transcript, `[hh:mm:ss]` marker
     every ~45s, **local only, never committed** (see Copyright below).
   - `research/index.json` — local-only index with the same metadata plus
     transcript file path and cue count.
   - `scripts/research/corpus-index.json` — **committed**, metadata only
     (title, expert, url, date, topics). No transcript text.

   Idempotent: an episode already in `research/index.json` with its
   transcript file present is skipped. Re-run anytime; only new or
   `--force`d entries are re-fetched.

   ```
   node scripts/research/fetch-transcripts.mjs             # fetch all new episodes
   node scripts/research/fetch-transcripts.mjs --limit 2    # first N only
   node scripts/research/fetch-transcripts.mjs --id <id>    # one episode
   node scripts/research/fetch-transcripts.mjs --force      # re-fetch everything
   ```

   Requires `yt-dlp` on PATH (`brew install yt-dlp`). If missing, the
   script prints install instructions and exits 1 without touching any
   files.

## Copyright stance

Transcripts are **research material for grounding and citation, never
republished**. They exist so the writing pipeline can quote or paraphrase
a specific, verifiable claim and point to exactly where it came from — not
so full episode text ends up on the public site or in this public repo.

- `research/` is gitignored. Transcript text never enters git history.
- Transcripts live only on the machine/runner that fetched them (local
  dev machine, or a CI runner's ephemeral workspace — regenerate there via
  `fetch-transcripts.mjs`, don't try to ship the transcript files
  themselves).
- Only `episodes.yaml` (the curated list) and `corpus-index.json` (title,
  url, date, topics) are committed — enough for a human or the pipeline to
  know the corpus exists and re-fetch it, never enough to reconstruct the
  transcript text.
- Book content (e.g. *Why We Sleep*) is never ingested as text. Cite it by
  chapter/claim, the way any secondary source is cited — no pirated or
  scanned text, ever.
- Citation format in published posts: **Expert Name, "Episode Title,"
  [hh:mm:ss]** — e.g. "Matthew Walker, PhD, 'Protocols to Improve Your
  Sleep,' [00:14:32]." Link to the original episode URL, not to anything
  in this repo.

## How the blog pipeline should use this (not wired up yet)

This is deliberately **not** wired into `generate-blog-post.mjs`. That is a
separate task. The intended future stage:

1. A research-grounding stage runs after topic selection, before drafting.
2. It greps `research/transcripts/*.txt` for passages relevant to the
   chosen topic/angle (simple keyword/topic match against `episodes.yaml`
   topics is enough to start; no need for embeddings at this scale).
3. Matching passages are handed to the writer stage as grounding material,
   each tagged with its `[hh:mm:ss]` marker and source episode.
4. The writer cites inline: expert + episode title + timestamp, exactly as
   it would cite a study. If nothing in the corpus is relevant, the writer
   falls back to Gemini grounded search (WS0 #3) — it must never fabricate
   from memory either way.

## Known environment limitation (documented, not a code defect)

On the machine this was built on, `/etc/hosts` has a **standing, deliberate
block on YouTube** (`youtube.com`, `youtu.be`, `youtubei.googleapis.com`,
etc. all point to `127.0.0.1`/`::1`, labeled "PERMANENT BLOCK" in the file).
That's a personal system setting, not something this tooling should or does
try to route around. It means `fetch-transcripts.mjs` cannot complete a
live fetch from that machine as-is. The script itself was verified
end-to-end at the unit level (VTT parsing, rolling-caption dedup,
paragraph/timestamp assembly all tested against real YouTube caption
syntax and produce clean output) and yt-dlp was confirmed installed and
functional against other reachable hosts. Run it from a machine or CI
runner without that hosts-file block (or temporarily allow YouTube) to do
the first real fetch.
