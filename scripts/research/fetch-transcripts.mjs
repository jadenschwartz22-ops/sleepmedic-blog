#!/usr/bin/env node

/**
 * Research corpus fetcher.
 *
 * Reads scripts/research/episodes.yaml, downloads auto-captions for each
 * episode via yt-dlp, and converts them into clean timestamped transcripts
 * the content pipeline can later grep for passages to cite as
 * "Expert, Episode Title, [hh:mm:ss]".
 *
 * COPYRIGHT: transcript text is never committed. It is written under
 * research/ (gitignored) for local/runner use only. The only thing that
 * gets committed is metadata (title, url, date, topics) in
 * scripts/research/corpus-index.json.
 *
 * Idempotent: an episode already present in research/index.json is skipped
 * unless --force is passed.
 *
 * Usage:
 *   node scripts/research/fetch-transcripts.mjs [--limit N] [--force] [--id <episode-id>]
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';
import yaml from 'yaml';
import chalk from 'chalk';

const execFile = promisify(_execFile);

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const EPISODES_PATH = path.join(ROOT, 'scripts/research/episodes.yaml');
const RESEARCH_DIR = path.join(ROOT, 'research');
const TRANSCRIPTS_DIR = path.join(RESEARCH_DIR, 'transcripts');
const CAPTIONS_TMP_DIR = path.join(RESEARCH_DIR, '.captions-tmp');
const RESEARCH_INDEX_PATH = path.join(RESEARCH_DIR, 'index.json');
const CORPUS_INDEX_PATH = path.join(ROOT, 'scripts/research/corpus-index.json');

// ── CLI args ───────────────────────────────────────────

const args = process.argv.slice(2);
const force = args.includes('--force');
const limitArg = args.indexOf('--limit');
const limit = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity;
const idArg = args.indexOf('--id');
const onlyId = idArg !== -1 ? args[idArg + 1] : null;

// ── yt-dlp availability ────────────────────────────────

async function checkYtDlp() {
  try {
    const { stdout } = await execFile('yt-dlp', ['--version']);
    return stdout.trim();
  } catch {
    return null;
  }
}

// ── VTT parsing ────────────────────────────────────────

/** Parse a WebVTT timestamp "00:01:23.456" or "01:23.456" into seconds. */
function vttTimeToSeconds(t) {
  const parts = t.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function secondsToHms(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Strip VTT/YouTube caption markup: tags, cue settings, positioning. */
function cleanCueText(text) {
  return text
    .replace(/<[^>]+>/g, '')       // <c>, <00:00:01.000>, etc.
    .replace(/\[.*?\]/g, '')       // [Music], [Applause]
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a .vtt file into a flat, deduplicated stream of { start, text: word }
 * tokens. YouTube auto-captions scroll karaoke-style: each cue repeats the
 * tail of the previous cue's words plus a few new ones. We collapse that by
 * tracking the longest word-overlap between consecutive cues and keeping
 * only each cue's new words, timestamped at the cue's start time.
 */
function parseVtt(vttContent) {
  const blocks = vttContent.split(/\r?\n\r?\n/);
  const cues = [];
  const timeRe = /(\d{2}:)?\d{2}:\d{2}\.\d{3}\s*-->\s*(\d{2}:)?\d{2}:\d{2}\.\d{3}/;

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const timeLine = lines.find(l => timeRe.test(l));
    if (!timeLine) continue;
    const start = vttTimeToSeconds(timeLine.split('-->')[0].trim());
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    const text = cleanCueText(textLines.join(' '));
    if (text) cues.push({ start, words: text.split(' ') });
  }

  const tokens = [];
  let prevWords = [];
  for (const cue of cues) {
    const overlap = longestOverlap(prevWords, cue.words);
    const newWords = cue.words.slice(overlap);
    for (const word of newWords) tokens.push({ start: cue.start, text: word });
    prevWords = cue.words;
  }
  return tokens;
}

/** Longest N such that the last N words of `a` equal the first N words of `b`. */
function longestOverlap(a, b) {
  const max = Math.min(a.length, b.length);
  for (let n = max; n > 0; n--) {
    if (a.slice(a.length - n).join(' ') === b.slice(0, n).join(' ')) return n;
  }
  return 0;
}

/**
 * Group word tokens into paragraphs with a [hh:mm:ss] marker every ~45s,
 * so the corpus reads like a transcript, not a caption dump.
 */
function cuesToParagraphs(tokens, { paragraphSeconds = 45 } = {}) {
  if (tokens.length === 0) return '';
  const paragraphs = [];
  let bucketStart = tokens[0].start;
  let bucketWords = [];

  const flush = () => {
    if (bucketWords.length === 0) return;
    paragraphs.push(`[${secondsToHms(bucketStart)}] ${bucketWords.join(' ')}`);
    bucketWords = [];
  };

  for (const token of tokens) {
    if (token.start - bucketStart >= paragraphSeconds && bucketWords.length > 0) {
      flush();
      bucketStart = token.start;
    }
    bucketWords.push(token.text);
  }
  flush();
  return paragraphs.join('\n\n');
}

// ── yt-dlp fetch ───────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}

/** Download auto-captions (vtt, en) for one episode into CAPTIONS_TMP_DIR. Returns the vtt path or null. */
async function downloadCaptions(episode) {
  await fs.mkdir(CAPTIONS_TMP_DIR, { recursive: true });
  const outTemplate = path.join(CAPTIONS_TMP_DIR, `${episode.id}.%(ext)s`);
  try {
    await execFile('yt-dlp', [
      '--skip-download',
      '--write-auto-subs',
      '--sub-langs', 'en.*,en',
      '--sub-format', 'vtt',
      '--convert-subs', 'vtt',
      '-o', outTemplate,
      episode.url,
    ], { maxBuffer: 1024 * 1024 * 50 });
  } catch (err) {
    throw new Error(`yt-dlp caption download failed: ${err.message.split('\n')[0]}`);
  }

  const files = await fs.readdir(CAPTIONS_TMP_DIR);
  const match = files.find(f => f.startsWith(`${episode.id}.`) && f.endsWith('.vtt'));
  return match ? path.join(CAPTIONS_TMP_DIR, match) : null;
}

/** Fetch canonical title/uploader from yt-dlp metadata, used to sanity-check episodes.yaml. */
async function fetchMeta(url) {
  try {
    const { stdout } = await execFile('yt-dlp', ['--skip-download', '--print', '%(title)s|||%(uploader)s|||%(upload_date)s', url]);
    const [title, uploader, uploadDate] = stdout.trim().split('|||');
    return { title, uploader, uploadDate };
  } catch {
    return null;
  }
}

// ── Index files ────────────────────────────────────────

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function saveJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
}

// ── Main ───────────────────────────────────────────────

async function main() {
  const ytDlpVersion = await checkYtDlp();
  if (!ytDlpVersion) {
    console.error(chalk.red('yt-dlp is not installed or not on PATH.'));
    console.error(chalk.yellow('Install: brew install yt-dlp (macOS) or see https://github.com/yt-dlp/yt-dlp#installation'));
    console.error(chalk.yellow('This script has been written and is ready to run once yt-dlp is available.'));
    process.exit(1);
  }
  console.log(chalk.gray(`yt-dlp ${ytDlpVersion}`));

  const episodesYaml = await fs.readFile(EPISODES_PATH, 'utf8');
  let episodes = yaml.parse(episodesYaml);
  if (onlyId) episodes = episodes.filter(e => e.id === onlyId);
  episodes = episodes.slice(0, limit);

  await fs.mkdir(TRANSCRIPTS_DIR, { recursive: true });

  const researchIndex = await loadJson(RESEARCH_INDEX_PATH, { episodes: [] });
  const corpusIndex = await loadJson(CORPUS_INDEX_PATH, { episodes: [] });
  const alreadyFetched = new Set(researchIndex.episodes.map(e => e.id));

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const episode of episodes) {
    if (!episode.id || !episode.url) {
      console.warn(chalk.yellow(`  Skipping malformed entry: ${JSON.stringify(episode).slice(0, 80)}`));
      continue;
    }

    const transcriptPath = path.join(TRANSCRIPTS_DIR, `${episode.id}.txt`);
    if (!force && alreadyFetched.has(episode.id) && existsSync(transcriptPath)) {
      console.log(chalk.gray(`  Skip (already fetched): ${episode.id}`));
      skipped++;
      continue;
    }

    console.log(chalk.cyan(`Fetching: ${episode.expert} - ${episode.title}`));
    try {
      const vttPath = await downloadCaptions(episode);
      if (!vttPath) {
        throw new Error('no auto-caption file produced (captions may be disabled for this video/source)');
      }
      const vttContent = await fs.readFile(vttPath, 'utf8');
      const cues = parseVtt(vttContent);
      if (cues.length === 0) {
        throw new Error('caption file parsed to zero cues');
      }
      const body = cuesToParagraphs(cues);
      const meta = await fetchMeta(episode.url);

      const header = [
        `Title: ${episode.title}`,
        `Expert: ${episode.expert}`,
        `Series: ${episode.series || ''}`,
        `Host: ${episode.host || ''}`,
        `URL: ${episode.url}`,
        `Published: ${episode.date}`,
        `Fetched: ${new Date().toISOString().slice(0, 10)}`,
        `Source: ${episode.source}`,
        meta?.title ? `yt-dlp title (verification): ${meta.title}` : null,
        '',
        '--- TRANSCRIPT (auto-generated captions, cleaned) ---',
        '',
      ].filter(l => l !== null).join('\n');

      await fs.writeFile(transcriptPath, header + body + '\n');
      await fs.rm(vttPath, { force: true });

      const entry = {
        id: episode.id,
        title: episode.title,
        expert: episode.expert,
        url: episode.url,
        date: episode.date,
        topics: episode.topics || [],
        transcriptFile: `transcripts/${episode.id}.txt`,
        cueCount: cues.length,
        fetchedAt: new Date().toISOString(),
      };
      upsert(researchIndex.episodes, entry, 'id');
      upsert(corpusIndex.episodes, {
        id: episode.id, title: episode.title, expert: episode.expert,
        host: episode.host, series: episode.series, url: episode.url,
        date: episode.date, topics: episode.topics || [], source: episode.source,
      }, 'id');

      console.log(chalk.green(`  Done: ${cues.length} cues -> research/transcripts/${episode.id}.txt`));
      fetched++;
    } catch (err) {
      console.error(chalk.red(`  Failed: ${err.message}`));
      failed++;
    }
  }

  await saveJson(RESEARCH_INDEX_PATH, researchIndex);
  await saveJson(CORPUS_INDEX_PATH, corpusIndex);
  await fs.rm(CAPTIONS_TMP_DIR, { recursive: true, force: true });

  console.log('');
  console.log(chalk.bold(`Fetched: ${fetched}  Skipped: ${skipped}  Failed: ${failed}`));
  console.log(chalk.gray(`research/index.json (local, gitignored): ${researchIndex.episodes.length} episodes`));
  console.log(chalk.gray(`scripts/research/corpus-index.json (committed metadata): ${corpusIndex.episodes.length} episodes`));

  if (failed > 0) process.exitCode = 1;
}

function upsert(list, entry, key) {
  const i = list.findIndex(e => e[key] === entry[key]);
  if (i === -1) list.push(entry);
  else list[i] = entry;
}

main().catch(err => {
  console.error(chalk.red(err.stack || err.message));
  process.exit(1);
});
